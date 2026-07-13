import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const studio = await db.studio.findUnique({
    where: { id },
    include: {
      hosts: {
        orderBy: { name: "asc" },
        include: {
          shopeeAccounts: { select: { id: true, status: true, tokenExpiresAt: true, shopId: true } },
          liveSessions: { where: { status: "live" }, select: { id: true } },
        },
      },
      assignments: {
        where: { status: "pending" },
        include: { collectionEntry: { include: { product: true } } },
        orderBy: { assignedAt: "desc" },
      },
      liveSessions: {
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
  return NextResponse.json({ ok: true, studio });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const studio = await db.studio.update({
    where: { id },
    data: {
      ...(body.name ? { name: String(body.name) } : {}),
      ...(body.location !== undefined ? { location: String(body.location) } : {}),
    },
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
  await db.studio.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
