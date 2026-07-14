import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount } from "@/lib/shopee-account";
import { createSession, startSession } from "@/lib/shopee";

// Buat & mulai sesi live untuk satu host (PRD §7.4):
// createSession + startSession → simpan push_url/push_key/share_url.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const hostId = String(body.hostId || "");
  const title = String(body.title || "").trim() || "Live Elyasya Studio";

  const host = await db.host.findUnique({ where: { id: hostId }, include: { studio: true } });
  if (!host) return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });

  const account = await getActiveAccount(hostId);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "Host belum connect akun Shopee (atau token expired). Connect dulu di halaman host." },
      { status: 400 }
    );
  }

  const alreadyLive = await db.liveSession.findFirst({ where: { hostId, status: "live" } });
  if (alreadyLive) {
    return NextResponse.json(
      { ok: false, error: "Host ini masih punya sesi live aktif. Akhiri dulu." },
      { status: 409 }
    );
  }

  try {
    const ctx = { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId };
    const createRes = await createSession(ctx, { title, coverImageUrl: body.coverImageUrl });
    const startRes = await startSession(ctx, createRes.session_id);

    const session = await db.liveSession.create({
      data: {
        shopeeSessionId: String(createRes.session_id),
        hostId,
        studioId: host.studioId,
        status: "live",
        title,
        pushUrl: startRes.stream_url_list?.push_url ?? "",
        pushKey: startRes.stream_url_list?.push_key ?? "",
        shareUrl: startRes.share_url ?? "",
        startedAt: new Date(),
      },
    });
    console.log(`[audit] ${user.email} start live session ${session.id} host=${host.name}`);
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    console.error("[live-sessions POST]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Gagal membuat sesi" },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const sessions = await db.liveSession.findMany({
    where: status ? { status } : {},
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      host: { select: { id: true, name: true } },
      studio: { select: { id: true, name: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      _count: { select: { items: true } },
    },
  });
  return NextResponse.json({ ok: true, sessions });
}
