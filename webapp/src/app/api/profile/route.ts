import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, string> = {};
  if (body.name) data.name = String(body.name);
  if (body.email) data.email = String(body.email).toLowerCase().trim();
  if (body.newPassword) {
    if (String(body.newPassword).length < 8) {
      return NextResponse.json({ ok: false, error: "Password baru minimal 8 karakter" }, { status: 400 });
    }
    const valid = await bcrypt.compare(String(body.currentPassword || ""), user.passwordHash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "Password lama salah" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(String(body.newPassword), 10);
  }
  const updated = await db.user.update({ where: { id: user.id }, data });
  return NextResponse.json({ ok: true, user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role } });
}
