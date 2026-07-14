import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

// Daftar sesi live aktif yang dipantau — dipakai background watcher extension
// untuk mengambil play url / metrik dari API sesi Shopee memakai cookie
// browser admin (server diblokir anti-bot untuk endpoint itu).
export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const sessions = await db.liveSession.findMany({
    where: { status: "live", shopeeSessionId: { not: "" } },
    select: { shopeeSessionId: true, playUrl: true },
    take: 10,
  });
  return NextResponse.json({
    ok: true,
    sessions: sessions.map((s) => ({
      session_id: s.shopeeSessionId,
      has_play_url: Boolean(s.playUrl),
    })),
  });
}
