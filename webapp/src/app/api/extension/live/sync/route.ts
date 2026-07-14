import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";
import { pushPendingAssignments } from "@/lib/live-cart";

// Terima data sesi live yang di-capture extension dari live.shopee.co.id
// (content-live.js). Disimpan sebagai LiveSession "eksternal" (tanpa host)
// bila belum ada padanannya — dipakai untuk pelengkap report.
export async function POST(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const sessions: Array<Record<string, unknown>> = Array.isArray(body.sessions)
    ? body.sessions
    : [];

  let stored = 0;
  let linked = 0;
  for (const s of sessions) {
    const shopeeSessionId = String(s.sessionId ?? s.session_id ?? "");
    if (!shopeeSessionId) continue;

    let existing = await db.liveSession.findFirst({ where: { shopeeSessionId } });

    // Sesi belum dikenal → auto-tautkan ke host: cocokkan uid (dari watcher
    // background) atau nama streamer (dari capture halaman live).
    if (!existing) {
      const uid = String(s.uid ?? "").trim();
      const streamer = String(s.streamer_name ?? s.streamerName ?? "").trim();
      const candidates = await db.host.findMany({
        where: { OR: [{ liveUid: { not: "" } }, { liveUsername: { not: "" } }] },
        select: { id: true, name: true, studioId: true, liveUsername: true, liveUid: true },
      });
      const host =
        (uid ? candidates.find((h) => h.liveUid === uid) : undefined) ??
        (streamer && streamer !== "—"
          ? candidates.find((h) => h.liveUsername.toLowerCase() === streamer.toLowerCase())
          : undefined);
      if (!host) continue;
      const stillLive = await db.liveSession.findFirst({ where: { hostId: host.id, status: "live" } });
      if (stillLive) continue; // jangan dobel — akhiri sesi lama dulu
      existing = await db.liveSession.create({
        data: {
          shopeeSessionId,
          hostId: host.id,
          studioId: host.studioId,
          status: "live",
          title: String(s.title ?? "") || `Live ${host.name}`,
          shareUrl:
            String(s.url ?? "") ||
            `https://live.shopee.co.id/share?from=live&session=${shopeeSessionId}`,
          playUrl: String(s.play_url ?? s.playUrl ?? ""),
          startedAt: new Date(),
        },
      });
      linked += 1;
      console.log(`[live/sync] auto-link session ${shopeeSessionId} → host ${host.name}`);
      // Produk ter-assign langsung masuk keranjang live.
      await pushPendingAssignments(host.id);
    }

    // URL stream asli dari halaman live (hasil capture browser) → player panel.
    const playUrl = String(s.play_url ?? s.playUrl ?? "");
    if (playUrl && existing.playUrl !== playUrl && existing.status === "live") {
      await db.liveSession.update({ where: { id: existing.id }, data: { playUrl } });
    }

    const gmv = Number(s.gmv ?? 0);
    const ccu = Number(s.ccu ?? s.viewers ?? 0);
    if (gmv || ccu) {
      await db.metricSnapshot.create({
        data: {
          liveSessionId: existing.id,
          gmv,
          ccu,
          views: Number(s.views ?? 0),
          orders: Number(s.orders ?? 0),
          likes: Number(s.likes ?? 0),
          comments: Number(s.comments ?? 0),
        },
      });
      stored += 1;
    }
  }

  return NextResponse.json({ ok: true, stored, linked });
}
