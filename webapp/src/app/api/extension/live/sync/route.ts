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
  for (const s of sessions) {
    const shopeeSessionId = String(s.sessionId ?? s.session_id ?? "");
    if (!shopeeSessionId) continue;
    const existing = await db.liveSession.findFirst({ where: { shopeeSessionId } });
    if (!existing) continue; // hanya perkaya sesi yang dikenal app (v1)
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

  return NextResponse.json({ ok: true, stored });
}
