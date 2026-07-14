import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

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

    // Sesi belum dikenal → auto-tautkan ke host yang liveUsername-nya cocok
    // dengan nama streamer (setup sekali di profil host, tanpa copy-paste link).
    if (!existing) {
      const streamer = String(s.streamer_name ?? s.streamerName ?? "").trim();
      if (!streamer || streamer === "—") continue;
      const candidates = await db.host.findMany({
        where: { liveUsername: { not: "" } },
        select: { id: true, name: true, studioId: true, liveUsername: true },
      });
      const host = candidates.find(
        (h) => h.liveUsername.toLowerCase() === streamer.toLowerCase()
      );
      if (!host) continue;
      const stillLive = await db.liveSession.findFirst({ where: { hostId: host.id, status: "live" } });
      if (stillLive) continue; // jangan dobel — akhiri sesi lama dulu
      existing = await db.liveSession.create({
        data: {
          shopeeSessionId,
          hostId: host.id,
          studioId: host.studioId,
          status: "live",
          title: String(s.title ?? `Live ${host.name}`),
          shareUrl:
            String(s.url ?? "") ||
            `https://live.shopee.co.id/share?from=live&session=${shopeeSessionId}`,
          startedAt: new Date(),
        },
      });
      linked += 1;
      console.log(`[live/sync] auto-link session ${shopeeSessionId} → host ${host.name}`);
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
