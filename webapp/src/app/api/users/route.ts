import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Daftar akun yang bisa login ke dashboard
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, users, selfId: user.id });
}

// Buat akun login baru
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "");

  if (!name || !email) {
    return NextResponse.json({ ok: false, error: "Nama dan email wajib diisi" }, { status: 400 });
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Format email tidak valid" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ ok: false, error: "Password minimal 8 karakter" }, { status: 400 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ ok: false, error: `Email ${email} sudah terdaftar` }, { status: 409 });
  }

  const created = await db.user.create({
    data: { name, email, passwordHash: await bcrypt.hash(password, 10) },
  });
  return NextResponse.json({ ok: true, user: { id: created.id, name: created.name, email: created.email } });
}

// Hapus akun — tidak bisa hapus akun sendiri
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id wajib diisi" }, { status: 400 });
  if (id === user.id) {
    return NextResponse.json({ ok: false, error: "Tidak bisa menghapus akun sendiri" }, { status: 400 });
  }

  await db.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
