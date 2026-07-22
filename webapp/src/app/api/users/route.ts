import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { isSuperuser } from "@/lib/tenant";

function forbidden() {
  return NextResponse.json({ ok: false, error: "Hanya superuser yang boleh mengelola akun" }, { status: 403 });
}

// Daftar akun yang bisa login ke dashboard
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) return forbidden();

  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  return NextResponse.json({ ok: true, users, selfId: user.id });
}

// Buat akun login baru
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) return forbidden();

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
    data: {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      role: body.role === "superuser" ? "superuser" : "admin",
    },
  });
  return NextResponse.json({ ok: true, user: { id: created.id, name: created.name, email: created.email, role: created.role } });
}

// Edit akun: nama, email, dan/atau reset password (tanpa perlu password lama)
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id wajib diisi" }, { status: 400 });

  const target = await db.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ ok: false, error: "Akun tidak ditemukan" }, { status: 404 });

  const data: Record<string, string> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ ok: false, error: "Nama tidak boleh kosong" }, { status: 400 });
    data.name = name;
  }
  if (body.email !== undefined) {
    const email = String(body.email).toLowerCase().trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ ok: false, error: "Format email tidak valid" }, { status: 400 });
    }
    const dup = await db.user.findUnique({ where: { email } });
    if (dup && dup.id !== id) {
      return NextResponse.json({ ok: false, error: `Email ${email} sudah dipakai akun lain` }, { status: 409 });
    }
    data.email = email;
  }
  if (body.password) {
    const password = String(body.password);
    if (password.length < 8) {
      return NextResponse.json({ ok: false, error: "Password minimal 8 karakter" }, { status: 400 });
    }
    data.passwordHash = await bcrypt.hash(password, 10);
  }
  if (body.role !== undefined) {
    const role = body.role === "superuser" ? "superuser" : "admin";
    if (target.role === "superuser" && role !== "superuser") {
      const superuserCount = await db.user.count({ where: { role: "superuser" } });
      if (superuserCount <= 1) {
        return NextResponse.json({ ok: false, error: "Minimal harus ada satu superuser" }, { status: 400 });
      }
    }
    data.role = role;
  }

  const updated = await db.user.update({ where: { id }, data });
  return NextResponse.json({ ok: true, user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role } });
}

// Hapus akun — tidak bisa hapus akun sendiri
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) return forbidden();

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id wajib diisi" }, { status: 400 });
  if (id === user.id) {
    return NextResponse.json({ ok: false, error: "Tidak bisa menghapus akun sendiri" }, { status: 400 });
  }
  const target = await db.user.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ ok: false, error: "Akun tidak ditemukan" }, { status: 404 });
  if (target.role === "superuser") {
    const superuserCount = await db.user.count({ where: { role: "superuser" } });
    if (superuserCount <= 1) {
      return NextResponse.json({ ok: false, error: "Superuser terakhir tidak boleh dihapus" }, { status: 400 });
    }
  }

  await db.$transaction([
    db.studio.updateMany({ where: { ownerId: id }, data: { ownerId: user.id } }),
    db.host.updateMany({ where: { ownerId: id }, data: { ownerId: user.id } }),
    db.commissionReport.updateMany({ where: { ownerId: id }, data: { ownerId: user.id } }),
    db.user.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
}
