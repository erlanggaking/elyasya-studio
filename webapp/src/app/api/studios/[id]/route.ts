import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  canAccessStudio,
  hostTenantWhere,
  isSuperuser,
  sessionTenantWhere,
  studioTenantWhere,
} from "@/lib/tenant";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const studio = await db.studio.findFirst({
    where: { id, ...studioTenantWhere(user) },
    include: {
      hosts: {
        where: hostTenantWhere(user),
        orderBy: { name: "asc" },
        include: {
          shopeeAccounts: { select: { id: true, status: true, tokenExpiresAt: true, shopId: true } },
          liveSessions: { where: { status: "live" }, select: { id: true, startedAt: true } },
        },
      },
      assignments: {
        where: { status: "pending" },
        include: { collectionEntry: { include: { product: true } } },
        orderBy: { assignedAt: "desc" },
      },
      liveSessions: {
        where: sessionTenantWhere(user),
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          host: { select: { name: true } },
          snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!studio) return NextResponse.json({ ok: false, error: "Tidak ditemukan" }, { status: 404 });

  // Produk paling banyak terjual di studio ini (agregat semua sesi live-nya)
  const soldGroups = await db.liveSessionItem.groupBy({
    by: ["productId"],
    where: {
      soldItems: { gt: 0 },
      liveSession: { studioId: id, ...sessionTenantWhere(user) },
    },
    _sum: { soldItems: true },
    orderBy: { _sum: { soldItems: "desc" } },
    take: 5,
  });
  const soldProducts = await db.product.findMany({
    where: { id: { in: soldGroups.map((g) => g.productId) } },
    select: { id: true, name: true, imageUrl: true, price: true },
  });
  const topProducts = soldGroups.map((g) => {
    const p = soldProducts.find((x) => x.id === g.productId);
    const sold = g._sum.soldItems ?? 0;
    return {
      productId: g.productId,
      name: p?.name ?? "Produk",
      imageUrl: p?.imageUrl ?? "",
      sold,
      revenue: Math.round(sold * (p?.price ?? 0)),
    };
  });

  return NextResponse.json({ ok: true, studio, topProducts });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canAccessStudio(user, id))) {
    return NextResponse.json({ ok: false, error: "Studio tidak ditemukan" }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const newOwnerId = isSuperuser(user) && body.ownerId ? String(body.ownerId) : "";
  if (newOwnerId) {
    const owner = await db.user.findUnique({ where: { id: newOwnerId }, select: { id: true } });
    if (!owner) {
      return NextResponse.json({ ok: false, error: "Pemilik baru tidak ditemukan" }, { status: 404 });
    }
  }
  const studio = await db.$transaction(async (tx) => {
    const updated = await tx.studio.update({
      where: { id },
      data: {
        ...(body.name ? { name: String(body.name) } : {}),
        ...(body.location !== undefined ? { location: String(body.location) } : {}),
        ...(newOwnerId ? { ownerId: newOwnerId } : {}),
      },
    });
    // Kepemilikan host mengikuti studio agar tidak ada data silang antar-admin.
    if (newOwnerId) {
      await tx.host.updateMany({ where: { studioId: id }, data: { ownerId: newOwnerId } });
    }
    return updated;
  });
  return NextResponse.json({ ok: true, studio });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await canAccessStudio(user, id))) {
    return NextResponse.json({ ok: false, error: "Studio tidak ditemukan" }, { status: 404 });
  }
  await db.studio.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
