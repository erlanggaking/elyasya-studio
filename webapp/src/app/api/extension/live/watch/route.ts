import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

// Kontrak watcher background extension (jalan tiap menit, tanpa buka tab):
//  - sessions    : sesi live aktif → extension ambil play_url + viewer dari
//                  API sesi Shopee (butuh cookie browser; server diblokir).
//  - detect_uids : uid host yang TIDAK punya sesi aktif → extension cek apakah
//                  mereka mulai live (endpoint ongoing lebih akurat dari
//                  browser ber-cookie; dari server selalu null untuk akun
//                  affiliate).
export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }

  const sessions = await db.liveSession.findMany({
    where: { status: "live", shopeeSessionId: { not: "" } },
    select: { shopeeSessionId: true },
    take: 10,
  });
  const hostsNoLive = await db.host.findMany({
    where: {
      liveUid: { not: "" },
      liveSessions: { none: { status: "live" } },
    },
    select: { liveUid: true },
    take: 20,
  });

  console.log(
    `[live/watch] extension polling — ${sessions.length} sesi dipantau, ${hostsNoLive.length} uid dicek`
  );

  return NextResponse.json({
    ok: true,
    sessions: sessions.map((s) => ({
      session_id: s.shopeeSessionId,
    })),
    detect_uids: hostsNoLive.map((h) => h.liveUid),
  });
}
