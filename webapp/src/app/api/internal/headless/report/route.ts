import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { carryOverCart } from "@/lib/live-cart";

// Worker headless melapor hasil tarik metrik live via cookie host.
// Body: { hostId, live: bool, session?: { sessionId, title, viewers, likes,
//   itemsCnt, playUrl, startTime, status, gmv?, orders? } }
export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret") || "";
  if (!process.env.HEADLESS_SECRET || secret !== process.env.HEADLESS_SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const hostId = String(body.hostId ?? "");
  if (!hostId) return NextResponse.json({ ok: false, error: "hostId wajib" }, { status: 400 });

  const host = await db.host.findUnique({ where: { id: hostId } });
  if (!host) return NextResponse.json({ ok: false, error: "host tidak ada" }, { status: 404 });

  const s = body.session as Record<string, unknown> | undefined;
  const isLive = body.live === true && s && s.sessionId;

  const active = await db.liveSession.findFirst({ where: { hostId, status: "live" } });

  // Live berakhir menurut worker → tutup sesi aktif.
  if (!isLive) {
    if (active) {
      await db.liveSession.update({ where: { id: active.id }, data: { status: "ended", endedAt: new Date() } });
    }
    return NextResponse.json({ ok: true, live: false });
  }

  const sessionId = String(s!.sessionId);
  const startedAt = s!.startTime ? new Date(Number(s!.startTime)) : new Date();
  const playUrl = String(s!.playUrl ?? "");

  // Sesi aktif beda id → tutup yang lama.
  if (active && active.shopeeSessionId !== sessionId) {
    await db.liveSession.update({ where: { id: active.id }, data: { status: "ended", endedAt: new Date() } });
  }

  // Upsert sesi live.
  let session = await db.liveSession.findFirst({ where: { hostId, shopeeSessionId: sessionId } });
  let created = false;
  if (!session) {
    session = await db.liveSession.create({
      data: {
        shopeeSessionId: sessionId,
        hostId,
        studioId: host.studioId,
        status: "live",
        title: String(s!.title ?? `Live ${host.name}`),
        shareUrl: `https://live.shopee.co.id/share?from=live&session=${sessionId}`,
        playUrl,
        startedAt,
      },
    });
    created = true;
  } else {
    session = await db.liveSession.update({
      where: { id: session.id },
      data: {
        status: "live",
        ...(playUrl ? { playUrl } : {}),
        // Koreksi waktu mulai bila meleset > 5 dtk (durasi = HP host).
        ...(!session.startedAt || Math.abs(session.startedAt.getTime() - startedAt.getTime()) > 5000
          ? { startedAt }
          : {}),
      },
    });
  }

  if (created) {
    await carryOverCart(hostId, session.id);
  }

  // Simpan snapshot metrik (penonton, likes; GMV/order bila worker kirim).
  const prev = await db.metricSnapshot.findFirst({
    where: { liveSessionId: session.id },
    orderBy: { capturedAt: "desc" },
  });
  const viewers = Number(s!.viewers) || 0;
  await db.metricSnapshot.create({
    data: {
      liveSessionId: session.id,
      gmv: Number(s!.gmv ?? prev?.gmv ?? 0),
      orders: Number(s!.orders ?? prev?.orders ?? 0),
      ccu: viewers,
      peakCcu: Math.max(viewers, prev?.peakCcu ?? 0),
      views: Math.max(viewers, prev?.views ?? 0),
      atc: Number(s!.atc ?? prev?.atc ?? 0),
      likes: Number(s!.likes) || prev?.likes || 0,
      comments: prev?.comments ?? 0,
      shares: prev?.shares ?? 0,
      estCommission: prev?.estCommission ?? 0,
    },
  });

  return NextResponse.json({ ok: true, live: true, sessionId, created });
}
