import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { isSuperuser } from "@/lib/tenant";

// Daftar folder + jumlah produk di masing-masing
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const folders = await db.collectionFolder.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { entries: true } } },
  });

  return NextResponse.json({
    ok: true,
    folders: folders.map((f) => ({ id: f.id, name: f.name, count: f._count.entries })),
  });
}

// Buat folder baru
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) {
    return NextResponse.json(
      { ok: false, error: "Hanya superuser yang boleh membuat folder bersama" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Nama folder wajib diisi" }, { status: 400 });
  }

  const existing = await db.collectionFolder.findUnique({ where: { name } });
  if (existing) {
    return NextResponse.json({ ok: false, error: `Folder "${name}" sudah ada` }, { status: 409 });
  }

  const folder = await db.collectionFolder.create({ data: { name } });
  return NextResponse.json({ ok: true, folder });
}

// Rename folder
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) {
    return NextResponse.json(
      { ok: false, error: "Hanya superuser yang boleh mengganti nama folder bersama" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  const name = String(body.name || "").trim();
  if (!id || !name) {
    return NextResponse.json({ ok: false, error: "id dan nama folder wajib diisi" }, { status: 400 });
  }

  const dup = await db.collectionFolder.findUnique({ where: { name } });
  if (dup && dup.id !== id) {
    return NextResponse.json({ ok: false, error: `Folder "${name}" sudah ada` }, { status: 409 });
  }

  const folder = await db.collectionFolder.update({ where: { id }, data: { name } });
  return NextResponse.json({ ok: true, folder });
}

// Hapus folder — produk di dalamnya tidak ikut terhapus, hanya jadi tanpa folder
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSuperuser(user)) {
    return NextResponse.json(
      { ok: false, error: "Hanya superuser yang boleh menghapus folder bersama" },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "");
  if (!id) return NextResponse.json({ ok: false, error: "id folder wajib diisi" }, { status: 400 });

  await db.collectionFolder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
