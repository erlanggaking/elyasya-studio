import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

// Daftar folder Koleksi untuk extension — dipakai pemilih folder
// saat "kirim ke dashboard" (auth pakai Bearer token, bukan session).
export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }

  const folders = await db.collectionFolder.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { entries: true } } },
  });

  return NextResponse.json({
    ok: true,
    folders: folders.map((f) => ({ id: f.id, name: f.name, count: f._count.entries })),
  });
}
