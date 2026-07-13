import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { tokenStatus } from "@/lib/shopee-account";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const host = await db.host.findUnique({
    where: { id },
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
        connectedAt: a.connectedAt,
        status: tokenStatus(a),
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
  const body = await req.json().catch(() => ({}));
  const host = await db.host.update({
    where: { id },
    data: {
      ...(body.name ? { name: String(body.name) } : {}),
      ...(body.note !== undefined ? { note: String(body.note) } : {}),
      ...(body.contact !== undefined ? { contact: String(body.contact) } : {}),
      ...(body.studioId !== undefined ? { studioId: body.studioId || null } : {}),
    },
  });
  return NextResponse.json({ ok: true, host });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await db.host.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
