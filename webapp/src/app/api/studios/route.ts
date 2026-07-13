import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const studios = await db.studio.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { hosts: true } },
      liveSessions: { where: { status: "live" }, select: { id: true } },
      assignments: { where: { status: "pending" }, select: { id: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    studios: studios.map((s) => ({
      id: s.id,
      name: s.name,
      location: s.location,
      hostCount: s._count.hosts,
      liveNow: s.liveSessions.length,
      pendingProducts: s.assignments.length,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Nama studio wajib diisi" }, { status: 400 });
  }
  const studio = await db.studio.create({
    data: { name, location: String(body.location || "") },
  });
  return NextResponse.json({ ok: true, studio });
}
