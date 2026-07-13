import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth";

export async function POST(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email dan password wajib diisi." },
      { status: 400 }
    );
  }
  const user = await db.user.findUnique({
    where: { email: String(email).toLowerCase().trim() },
  });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return NextResponse.json(
      { ok: false, error: "Email atau password salah." },
      { status: 401 }
    );
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
