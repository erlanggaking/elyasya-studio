import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

// Buat akun admin pertama — hanya boleh saat belum ada user sama sekali
// (invite-only sesudahnya, sesuai PRD §4).
export async function POST(req: Request) {
  const count = await db.user.count();
  if (count > 0) {
    return NextResponse.json(
      { ok: false, error: "Setup sudah dilakukan. Silakan login." },
      { status: 403 }
    );
  }
  const { email, password, name } = await req.json().catch(() => ({}));
  if (!email || !password || password.length < 8) {
    return NextResponse.json(
      { ok: false, error: "Email wajib diisi & password minimal 8 karakter." },
      { status: 400 }
    );
  }
  const user = await db.user.create({
    data: {
      email: String(email).toLowerCase().trim(),
      name: name || "Admin",
      passwordHash: await bcrypt.hash(password, 10),
      role: "superuser",
    },
  });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const count = await db.user.count();
  return NextResponse.json({ ok: true, needsSetup: count === 0 });
}
