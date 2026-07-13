import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Personal access token untuk extension (menu Extension, PRD §7.5).
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const [tokens, devices] = await Promise.all([
    db.apiToken.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { devices: true },
    }),
    db.device.findMany({ where: { userId: user.id }, orderBy: { registeredAt: "desc" } }),
  ]);

  return NextResponse.json({
    ok: true,
    tokens: tokens.map((t) => ({
      id: t.id,
      label: t.label,
      token: t.token,
      createdAt: t.createdAt,
      revoked: !!t.revokedAt,
      deviceCount: t.devices.length,
    })),
    devices,
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const token = await db.apiToken.create({
    data: {
      token: `ely_${crypto.randomBytes(24).toString("hex")}`,
      label: String(body.label || "Extension token"),
      userId: user.id,
    },
  });
  return NextResponse.json({ ok: true, token });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const token = await db.apiToken.findFirst({ where: { id, userId: user.id } });
  if (!token) return NextResponse.json({ ok: false, error: "Token tidak ditemukan" }, { status: 404 });

  await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
