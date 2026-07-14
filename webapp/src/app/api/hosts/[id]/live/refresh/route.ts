import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount } from "@/lib/shopee-account";
import { getSessionDetail, SHOPEE_MOCK } from "@/lib/shopee";
import { probeOngoing, uidFromShop } from "@/lib/shopee-live";
import { pushPendingAssignments } from "@/lib/live-cart";

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
  const host = await db.host.findUnique({ where: { id } });
  if (!host) return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });

  const account = await getActiveAccount(id);

  // 1. liveUid — derive sekali dari shop OAuth kalau belum ada.
  let liveUid = host.liveUid;
  if (!liveUid && account?.shopId) {
    liveUid = (await uidFromShop(account.shopId)) ?? "";
    if (liveUid) await db.host.update({ where: { id }, data: { liveUid } });
  }

  const active = await db.liveSession.findFirst({ where: { hostId: id, status: "live" } });
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
      // Probe bawa play url segar untuk sesi yang sama → simpan.
      if (ongoing?.playUrl && ongoing.playUrl !== active.playUrl) {
        const updated = await db.liveSession.update({
          where: { id: active.id },
          data: { playUrl: ongoing.playUrl },
        });
        return NextResponse.json({ ok: true, live: true, session: updated });
      }
      // Verifikasi via partner API: status asli + play_url untuk player panel.
      // (status get_session_detail: 1 = live, 2 = sudah berakhir)
      if (!SHOPEE_MOCK && account?.userId) {
        try {
          const detail = await getSessionDetail(
            { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId },
            active.shopeeSessionId
          );
          const status = String(detail?.status ?? "").toLowerCase();
          if (["2", "3", "ended", "end", "finished", "finish"].includes(status)) {
            await db.liveSession.update({
              where: { id: active.id },
              data: { status: "ended", endedAt: new Date() },
            });
            return NextResponse.json({ ok: true, live: false, ended: true });
          }
          // Partner API hanya mengisi kalau masih kosong (URL-nya tidak valid
          // untuk live dari aplikasi HP — jangan menimpa hasil capture browser).
          const playUrl = String(
            detail?.stream_url_list?.[0]?.play_url ?? detail?.stream_url_list?.play_url ?? ""
          );
          if (playUrl && !active.playUrl) {
            const updated = await db.liveSession.update({
              where: { id: active.id },
              data: { playUrl },
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
    let playUrl = ongoing.playUrl || "";
    if (!playUrl && !SHOPEE_MOCK && account?.userId) {
      try {
        const detail = await getSessionDetail(
          { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId },
          ongoing.sessionId
        );
        playUrl = String(
          detail?.stream_url_list?.[0]?.play_url ?? detail?.stream_url_list?.play_url ?? ""
        );
      } catch (err) {
        console.error("[live/refresh] detail playUrl", err);
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
          startedAt: new Date(),
        },
      }));
    if (!known) {
      console.log(`[live/refresh] auto-link session ${ongoing.sessionId} → ${host.name}`);
      // Produk yang sudah di-assign langsung masuk keranjang live.
      await pushPendingAssignments(id);
    }
    return NextResponse.json({ ok: true, live: true, session, autoLinked: !known });
  }

  return NextResponse.json({ ok: true, live: false });
}
