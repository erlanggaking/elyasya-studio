import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { tokenStatus } from "@/lib/shopee-account";
import { resolveShareLink } from "@/lib/shopee-live";
import { pushPendingAssignments, carryOverCart } from "@/lib/live-cart";
import { canAccessHost, canAccessStudio, hostTenantWhere } from "@/lib/tenant";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const host = await db.host.findFirst({
    where: { id, ...hostTenantWhere(user) },
    include: {
      studio: true,
      shopeeAccounts: true,
      assignments: {
        where: { status: "pending" },
        include: { collectionEntry: { include: { product: true } } },
        orderBy: { assignedAt: "desc" },
      },
      liveSessions: {
        orderBy: { createdAt: "desc" },
        take: 20,
        include: {
          items: { include: { product: true }, orderBy: { itemNo: "asc" } },
          snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!host) return NextResponse.json({ ok: false, error: "Tidak ditemukan" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    host: {
      ...host,
      shopeeAccounts: host.shopeeAccounts.map((a) => ({
        id: a.id,
        shopId: a.shopId,
        shopName: a.shopName,
        scope: a.scope,
        connectedAt: a.connectedAt,
        // Akun cookie tak punya token → status ditentukan flag DB, bukan expiry.
        status: a.scope === "cookie" ? a.status : tokenStatus(a),
      })),
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canAccessHost(user, id))) {
    return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  if (body.studioId && !(await canAccessStudio(user, String(body.studioId)))) {
    return NextResponse.json({ ok: false, error: "Studio tidak ditemukan" }, { status: 404 });
  }
  const targetStudio = body.studioId
    ? await db.studio.findUnique({
        where: { id: String(body.studioId) },
        select: { ownerId: true },
      })
    : null;

  // Setup link live (sekali): resolve → simpan uid streamer, dan langsung
  // tautkan sesi yang ada di link (host baru saja share = sedang live).
  let liveExtra: { liveShareLink?: string; liveUid?: string } = {};
  let autoLinked = false;
  if (body.liveShareLink !== undefined) {
    const link = String(body.liveShareLink).trim();
    liveExtra = { liveShareLink: link };
    if (link) {
      const r = await resolveShareLink(link);
      if (r.uid) liveExtra.liveUid = r.uid;
      if (r.sessionId) {
        const hostRow = await db.host.findUnique({ where: { id } });
        const known = await db.liveSession.findFirst({
          where: { hostId: id, shopeeSessionId: r.sessionId },
        });
        const activeOther = await db.liveSession.findFirst({
          where: { hostId: id, status: "live" },
        });
        if (!known && !activeOther && hostRow) {
          const created = await db.liveSession.create({
            data: {
              shopeeSessionId: r.sessionId,
              hostId: id,
              studioId: hostRow.studioId,
              status: "live",
              title: `Live ${hostRow.name} — ${new Date().toLocaleDateString("id-ID")}`,
              shareUrl: `https://live.shopee.co.id/share?from=live&session=${r.sessionId}`,
              startedAt: new Date(),
            },
          });
          autoLinked = true;
          await carryOverCart(id, created.id);
          await pushPendingAssignments(id);
        }
      }
    }
  }

  const host = await db.host.update({
    where: { id },
    data: {
      ...(body.name ? { name: String(body.name) } : {}),
      ...(body.note !== undefined ? { note: String(body.note) } : {}),
      ...(body.contact !== undefined ? { contact: String(body.contact) } : {}),
      ...(body.liveUsername !== undefined ? { liveUsername: String(body.liveUsername).trim() } : {}),
      ...(body.studioId !== undefined ? { studioId: body.studioId || null } : {}),
      ...(targetStudio?.ownerId ? { ownerId: targetStudio.ownerId } : {}),
      ...(body.autoPinEnabled !== undefined ? { autoPinEnabled: Boolean(body.autoPinEnabled) } : {}),
      ...(body.autoPinSeconds !== undefined
        ? { autoPinSeconds: Math.max(10, Math.min(3600, Number(body.autoPinSeconds) || 60)) }
        : {}),
      ...(body.autoPinMode !== undefined
        ? { autoPinMode: body.autoPinMode === "acak" ? "acak" : "urut" }
        : {}),
      ...liveExtra,
    },
  });
  return NextResponse.json({ ok: true, host, autoLinked });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canAccessHost(user, id))) {
    return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });
  }
  await db.host.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
