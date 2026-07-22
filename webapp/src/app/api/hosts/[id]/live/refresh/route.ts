import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount, withActiveAccount } from "@/lib/shopee-account";
import { getSessionDetail, SHOPEE_MOCK } from "@/lib/shopee";
import { getPublicPlayUrl, getSessionLiveState, probeOngoing, uidFromShop } from "@/lib/shopee-live";
import { pushPendingAssignments, carryOverCart } from "@/lib/live-cart";
import { hostTenantWhere } from "@/lib/tenant";

function dateFromShopee(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n < 10_000_000_000 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Auto-deteksi live host (dipanggil panel saat load + polling):
//  1. Pastikan liveUid host terisi (derive dari shop OAuth bila kosong).
//  2. Verifikasi sesi aktif di DB — kalau live aslinya sudah berakhir, tandai ended.
//  3. Kalau tidak ada sesi aktif: probe live yang sedang berjalan → tautkan otomatis.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const host = await db.host.findFirst({ where: { id, ...hostTenantWhere(user) } });
  if (!host) return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });

  const account = await getActiveAccount(id);

  // 1. liveUid — derive sekali dari shop OAuth kalau belum ada.
  let liveUid = host.liveUid;
  if (!liveUid && account?.shopId) {
    liveUid = (await uidFromShop(account.shopId)) ?? "";
    if (liveUid) await db.host.update({ where: { id }, data: { liveUid } });
  }

  const active = await db.liveSession.findFirst({ where: { hostId: id, status: "live" } });

  // Sesi dari URL FLV/HLS langsung bersifat video-only dan tidak perlu OAuth,
  // probing status, atau Partner API Shopee.
  if (active && !active.shopeeSessionId) {
    return NextResponse.json({ ok: true, live: true, session: active });
  }
  const ongoing = liveUid ? await probeOngoing(liveUid) : null;

  // 2. Sesi aktif di DB
  if (active) {
    // Live baru terdeteksi berbeda → sesi lama pasti sudah berakhir.
    if (ongoing && ongoing.sessionId !== active.shopeeSessionId) {
      await db.liveSession.update({
        where: { id: active.id },
        data: { status: "ended", endedAt: new Date() },
      });
    } else {
      // Samakan durasi web dengan durasi di HP host: pakai start_time ASLI dari
      // endpoint publik "ongoing" (tersedia untuk semua host, tanpa OAuth).
      if (
        ongoing?.startedAt &&
        (!active.startedAt ||
          Math.abs(active.startedAt.getTime() - ongoing.startedAt.getTime()) > 5000)
      ) {
        const fixed = await db.liveSession.update({
          where: { id: active.id },
          data: { startedAt: ongoing.startedAt },
        });
        active.startedAt = fixed.startedAt;
      }

      // Cek liveness via endpoint publik (terbuka untuk server, tanpa token):
      // "ended" = pasti berakhir → tutup sesi; "live" = segarkan play url.
      const liveState = await getSessionLiveState(active.shopeeSessionId);
      if (liveState.state === "ended") {
        await db.liveSession.update({
          where: { id: active.id },
          data: { status: "ended", endedAt: new Date() },
        });
        return NextResponse.json({ ok: true, live: false, ended: true });
      }
      if (liveState.playUrl && liveState.playUrl !== active.playUrl) {
        const updated = await db.liveSession.update({
          where: { id: active.id },
          data: { playUrl: liveState.playUrl },
        });
        return NextResponse.json({ ok: true, live: true, session: updated });
      }
      // Verifikasi via partner API: status asli + play_url untuk player panel.
      // (status get_session_detail: 1 = live, 2 = sudah berakhir)
      if (!SHOPEE_MOCK && account?.userId && account.scope !== "cookie") {
        try {
          const detail = await withActiveAccount(id, (fresh) =>
            getSessionDetail(
              { accessToken: fresh.accessToken, shopId: fresh.shopId, userId: fresh.userId },
              active.shopeeSessionId
            )
          );
          const status = String(detail?.status ?? "").toLowerCase();
          if (["2", "3", "ended", "end", "finished", "finish"].includes(status)) {
            await db.liveSession.update({
              where: { id: active.id },
              data: { status: "ended", endedAt: new Date() },
            });
            return NextResponse.json({ ok: true, live: false, ended: true });
          }
          // Partner API hanya mengisi kalau masih kosong. URL publik di atas tetap
          // diprioritaskan untuk live dari aplikasi HP.
          const playUrl = String(
            detail?.stream_url_list?.[0]?.play_url ?? detail?.stream_url_list?.play_url ?? ""
          );
          const actualStartedAt = dateFromShopee(
            detail?.start_time ?? detail?.started_at ?? detail?.startTime
          );
          const shouldFixStart =
            actualStartedAt &&
            (!active.startedAt ||
              Math.abs(active.startedAt.getTime() - actualStartedAt.getTime()) > 5000);
          if ((playUrl && !active.playUrl) || shouldFixStart) {
            const updated = await db.liveSession.update({
              where: { id: active.id },
              data: {
                ...(playUrl && !active.playUrl ? { playUrl } : {}),
                ...(shouldFixStart && actualStartedAt ? { startedAt: actualStartedAt } : {}),
              },
            });
            return NextResponse.json({ ok: true, live: true, session: updated });
          }
        } catch (err) {
          console.error("[live/refresh] get_session_detail", err);
        }
      }
      return NextResponse.json({ ok: true, live: true, session: active });
    }
  }

  // 3. Tidak ada sesi aktif → tautkan live yang sedang berjalan (kalau ada).
  if (ongoing) {
    const known = await db.liveSession.findFirst({
      where: { hostId: id, shopeeSessionId: ongoing.sessionId },
    });
    if (known && known.status === "ended") {
      return NextResponse.json({ ok: true, live: false });
    }
    // Ambil play_url sekalian supaya player langsung tampil — prioritas dari
    // probe publik (valid untuk live aplikasi HP), partner API sebagai cadangan.
    let playUrl = ongoing.playUrl || (await getPublicPlayUrl(ongoing.sessionId));
    let actualStartedAt: Date | null = null;
    if (!SHOPEE_MOCK && account?.userId && account.scope !== "cookie") {
      try {
        const detail = await withActiveAccount(id, (fresh) =>
          getSessionDetail(
            { accessToken: fresh.accessToken, shopId: fresh.shopId, userId: fresh.userId },
            ongoing.sessionId
          )
        );
        playUrl =
          playUrl ||
          String(detail?.stream_url_list?.[0]?.play_url ?? detail?.stream_url_list?.play_url ?? "");
        actualStartedAt = dateFromShopee(
          detail?.start_time ?? detail?.started_at ?? detail?.startTime
        );
      } catch (err) {
        console.error("[live/refresh] detail sesi", err);
      }
    }

    const session =
      known ??
      (await db.liveSession.create({
        data: {
          shopeeSessionId: ongoing.sessionId,
          hostId: id,
          studioId: host.studioId,
          status: "live",
          title: ongoing.title || `Live ${host.name} — ${new Date().toLocaleDateString("id-ID")}`,
          shareUrl: `https://live.shopee.co.id/share?from=live&session=${ongoing.sessionId}`,
          playUrl,
          // Prioritas: start_time asli dari endpoint publik (durasi = HP host).
          startedAt: ongoing.startedAt ?? actualStartedAt ?? new Date(),
        },
      }));
    if (!known) {
      console.log(`[live/refresh] auto-link session ${ongoing.sessionId} → ${host.name}`);
      // Bawa produk dari sesi sebelumnya (di HP masih ada) + assign pending.
      await carryOverCart(id, session.id);
      await pushPendingAssignments(id);
    }
    return NextResponse.json({ ok: true, live: true, session, autoLinked: !known });
  }

  return NextResponse.json({ ok: true, live: false });
}
