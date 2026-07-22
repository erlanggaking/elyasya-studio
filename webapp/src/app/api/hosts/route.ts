import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { tokenStatus } from "@/lib/shopee-account";
import { canAccessStudio, hostTenantWhere } from "@/lib/tenant";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const studioId = url.searchParams.get("studioId") || undefined;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize")) || 25);

  const where = {
    ...hostTenantWhere(user),
    ...(q ? { name: { contains: q } } : {}),
    ...(studioId ? { studioId } : {}),
  };

  const [total, hosts] = await Promise.all([
    db.host.count({ where }),
    db.host.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        studio: { select: { id: true, name: true } },
        shopeeAccounts: true,
        liveSessions: { where: { status: "live" }, select: { id: true } },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    page,
    pageSize,
    hosts: hosts.map((h) => ({
      id: h.id,
      name: h.name,
      note: h.note,
      contact: h.contact,
      studio: h.studio,
      liveNow: h.liveSessions.length > 0,
      shopee: h.shopeeAccounts.map((a) => ({
        id: a.id,
        shopId: a.shopId,
        shopName: a.shopName,
        status: tokenStatus(a),
      })),
    })),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Nama host wajib diisi" }, { status: 400 });
  }
  const studioId = body.studioId ? String(body.studioId) : null;
  if (studioId && !(await canAccessStudio(user, studioId))) {
    return NextResponse.json({ ok: false, error: "Studio tidak ditemukan" }, { status: 404 });
  }
  const studio = studioId
    ? await db.studio.findUnique({ where: { id: studioId }, select: { ownerId: true } })
    : null;
  const host = await db.host.create({
    data: {
      name,
      note: String(body.note || ""),
      contact: String(body.contact || ""),
      studioId,
      ownerId: studio?.ownerId ?? user.id,
    },
  });
  return NextResponse.json({ ok: true, host });
}
