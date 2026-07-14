import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { pushPendingAssignments } from "@/lib/live-cart";

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

// Link share sering berupa short-link (sv.shopee.co.id / s.shopee.co.id) —
// ikuti redirect untuk menemukan URL live final.
async function resolveShareUrl(raw: string): Promise<string> {
  try {
    const res = await fetch(raw, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 10) Mobile" },
    });
    return res.url || raw;
  } catch {
    return raw;
  }
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

  let sessionId = extractSessionId(rawUrl);
  let finalUrl = rawUrl;
  if (!sessionId) {
    finalUrl = await resolveShareUrl(rawUrl);
    sessionId = extractSessionId(finalUrl);
  }
  if (!sessionId) {
    return NextResponse.json(
      { ok: false, error: "Session id tidak ditemukan di link. Pakai link share dari aplikasi Shopee (live.shopee.co.id/share?session=...)" },
      { status: 400 }
    );
  }

  // Sudah tertaut & masih live → pakai yang ada.
  const existing = await db.liveSession.findFirst({
    where: { hostId, shopeeSessionId: sessionId, status: "live" },
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
      shopeeSessionId: sessionId,
      hostId,
      studioId: host.studioId,
      status: "live",
      title,
      shareUrl: finalUrl,
      startedAt: new Date(),
    },
  });
  console.log(`[audit] ${user.email} linked live session ${sessionId} host=${host.name}`);
  await pushPendingAssignments(hostId);
  return NextResponse.json({ ok: true, session });
}
