import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { probeOngoing, resolveShareLink } from "@/lib/shopee-live";

// Tautkan sesi live dari link share host (PRD §7.4 alternatif tanpa OAuth):
// host membagikan link live Shopee-nya → parse session id → jadi LiveSession
// yang bisa dipantau (metrik mock/extension) & dikelola keranjangnya.

function extractSessionId(u: string): string | null {
  const patterns = [
    /[?&]session[=/](\d{4,})/i,
    /session[_-]?id[=/](\d{4,})/i,
    /\/live\/(\d{4,})/i,
    /\/(\d{7,})(?:[?#]|$)/,
  ];
  for (const p of patterns) {
    const m = u.match(p);
    if (m) return m[1];
  }
  return null;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hostId = String(body.hostId || "");
  const rawUrl = String(body.url || "").trim();
  if (!hostId || !rawUrl) {
    return NextResponse.json({ ok: false, error: "hostId dan link live wajib diisi" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(rawUrl)) {
    return NextResponse.json({ ok: false, error: "Link tidak valid — mulai dengan https://" }, { status: 400 });
  }

  const host = await db.host.findUnique({ where: { id: hostId } });
  if (!host) return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });

  const directPlayUrl = /\.(?:flv|m3u8)(?:\?|$)/i.test(rawUrl) ? rawUrl : "";
  const resolved = directPlayUrl
    ? { sessionId: null, uid: null, playUrl: directPlayUrl, finalUrl: rawUrl }
    : await resolveShareLink(rawUrl);
  let sessionId = resolved.sessionId ?? extractSessionId(rawUrl);
  const finalUrl = resolved.finalUrl;
  let playUrl = resolved.playUrl;

  // Endpoint publik ongoing bisa memberikan URL CDN video tanpa OAuth/login.
  if (!playUrl && resolved.uid) {
    const ongoing = await probeOngoing(resolved.uid);
    if (ongoing && (!sessionId || ongoing.sessionId === sessionId)) {
      sessionId = sessionId || ongoing.sessionId;
      playUrl = ongoing.playUrl;
    }
  }

  if (!playUrl) {
    return NextResponse.json(
      { ok: false, error: "URL video tidak ditemukan. Pakai link share live yang sedang aktif atau URL stream .flv/.m3u8." },
      { status: 400 }
    );
  }

  // Sudah tertaut & masih live → pakai yang ada.
  const existing = await db.liveSession.findFirst({
    where: { hostId, status: "live", playUrl },
  });
  if (existing) return NextResponse.json({ ok: true, session: existing, existing: true });

  const alreadyLive = await db.liveSession.findFirst({ where: { hostId, status: "live" } });
  if (alreadyLive) {
    return NextResponse.json(
      { ok: false, error: "Host ini masih punya sesi live aktif. Akhiri dulu sebelum menautkan yang baru." },
      { status: 409 }
    );
  }

  const title =
    String(body.title || "").trim() ||
    `Live ${host.name} — ${new Date().toLocaleDateString("id-ID")}`;

  const session = await db.liveSession.create({
    data: {
      // Sesi ini sengaja video-only; ID kosong mencegah seluruh Partner API.
      shopeeSessionId: "",
      hostId,
      studioId: host.studioId,
      status: "live",
      title,
      shareUrl: finalUrl,
      playUrl,
      startedAt: new Date(),
    },
  });
  console.log(`[audit] ${user.email} linked video-only session host=${host.name}`);
  return NextResponse.json({ ok: true, session });
}
