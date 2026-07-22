import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { isSuperuser } from "@/lib/tenant";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const tag = (url.searchParams.get("tag") || "").trim();
  const sent = url.searchParams.get("sent"); // "yes" | "no" | null
  const folder = url.searchParams.get("folder"); // id folder | "none" | null (semua)
  const minComm = Number(url.searchParams.get("minComm")) || 0;
  const sort = url.searchParams.get("sort") || ""; // trend | sold30d | komisi | rating
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize")) || 24);
  const visibleAssignmentWhere = isSuperuser(user)
    ? {}
    : { OR: [{ host: { ownerId: user.id } }, { studio: { ownerId: user.id } }] };

  const where = {
    ...(q ? { product: { name: { contains: q } } } : {}),
    ...(tag ? { tags: { contains: tag } } : {}),
    ...(minComm > 0 ? { product: { ...(q ? { name: { contains: q } } : {}), commissionRate: { gte: minComm } } } : {}),
    ...(sent === "yes" ? { assignments: { some: visibleAssignmentWhere } } : {}),
    ...(sent === "no" ? { assignments: { none: visibleAssignmentWhere } } : {}),
    ...(folder === "none" ? { folderId: null } : folder ? { folderId: folder } : {}),
  };

  const orderBy =
    sort === "trend" ? { product: { trend: "desc" as const } } :
    sort === "sold30d" ? { product: { sold30d: "desc" as const } } :
    sort === "komisi" ? { product: { commissionRate: "desc" as const } } :
    sort === "rating" ? { product: { rating: "desc" as const } } :
    { addedAt: "desc" as const };

  const [total, entries] = await Promise.all([
    db.collectionEntry.count({ where }),
    db.collectionEntry.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        product: true,
        assignments: {
          where: { status: { not: "removed" }, ...visibleAssignmentWhere },
          include: {
            studio: { select: { name: true } },
            host: { select: { name: true } },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    total,
    page,
    pageSize,
    entries: entries.map((e) => ({
      id: e.id,
      tags: e.tags ? e.tags.split(",").filter(Boolean) : [],
      folderId: e.folderId,
      addedAt: e.addedAt,
      product: {
        id: e.product.id,
        itemId: e.product.itemId,
        shopId: e.product.shopId,
        name: e.product.name,
        imageUrl: e.product.imageUrl,
        price: e.product.price,
        commissionRate: e.product.commissionRate,
        sold: e.product.sold,
        sold30d: e.product.sold30d,
        rating: e.product.rating,
        trend: e.product.trend,
        source: e.product.source,
      },
      sentTo: e.assignments.map((a) =>
        a.targetType === "studio" ? `Studio: ${a.studio?.name}` : `Host: ${a.host?.name}`
      ),
    })),
  });
}

// Tambah produk ke koleksi — manual (itemId+shopId+nama) atau produk yang
// sudah ada di DB via productId (mis. dari daftar terlaris di dashboard).
// folderId opsional: langsung menempatkan entri ke folder tsb.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const folderId = body.folderId ? String(body.folderId) : null;
  if (folderId) {
    const folder = await db.collectionFolder.findUnique({ where: { id: folderId } });
    if (!folder) {
      return NextResponse.json({ ok: false, error: "Folder tidak ditemukan" }, { status: 404 });
    }
  }

  let product;
  if (body.productId) {
    product = await db.product.findUnique({ where: { id: String(body.productId) } });
    if (!product) {
      return NextResponse.json({ ok: false, error: "Produk tidak ditemukan" }, { status: 404 });
    }
  } else {
    const itemId = String(body.itemId || "").trim();
    const shopId = String(body.shopId || "").trim();
    const name = String(body.name || "").trim();
    if (!itemId || !shopId || !name) {
      return NextResponse.json(
        { ok: false, error: "itemId, shopId, dan nama produk wajib diisi" },
        { status: 400 }
      );
    }

    product = await db.product.upsert({
      where: { itemId_shopId: { itemId, shopId } },
      create: {
        itemId,
        shopId,
        name,
        imageUrl: String(body.imageUrl || ""),
        price: Number(body.price) || 0,
        commissionRate: Number(body.commissionRate) || 0,
        source: "manual",
      },
      update: { name },
    });
  }

  const existingEntry = await db.collectionEntry.findUnique({ where: { productId: product.id } });
  if (existingEntry && !isSuperuser(user) && existingEntry.addedBy !== user.email) {
    // Koleksi masih berupa katalog bersama. Admin boleh memakai produk yang
    // sudah ada, tetapi tidak boleh mengubah tag/folder milik pengunggah lain.
    return NextResponse.json({ ok: true, entry: existingEntry, shared: true });
  }

  const entry = await db.collectionEntry.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      tags: String(body.tags || ""),
      folderId,
      addedBy: user.email,
    },
    update: {
      ...(body.tags !== undefined ? { tags: String(body.tags) } : {}),
      ...("folderId" in body ? { folderId } : {}),
    },
  });

  return NextResponse.json({ ok: true, entry });
}

// Update tags / pindahkan entri ke folder
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  // Bulk pindah folder: { ids: [...], folderId: "..." | null }
  if (Array.isArray(body.ids) && "folderId" in body) {
    const folderId = body.folderId ? String(body.folderId) : null;
    if (folderId) {
      const folder = await db.collectionFolder.findUnique({ where: { id: folderId } });
      if (!folder) {
        return NextResponse.json({ ok: false, error: "Folder tidak ditemukan" }, { status: 404 });
      }
    }
    const moved = await db.collectionEntry.updateMany({
      where: {
        id: { in: body.ids.map(String) },
        ...(!isSuperuser(user) ? { addedBy: user.email } : {}),
      },
      data: { folderId },
    });
    return NextResponse.json({ ok: true, moved: moved.count });
  }

  const updated = await db.collectionEntry.updateMany({
    where: {
      id: String(body.id),
      ...(!isSuperuser(user) ? { addedBy: user.email } : {}),
    },
    data: { tags: String(body.tags ?? "") },
  });
  if (updated.count === 0) {
    return NextResponse.json({ ok: false, error: "Produk bukan milik Anda" }, { status: 403 });
  }
  const entry = await db.collectionEntry.findUnique({ where: { id: String(body.id) } });
  return NextResponse.json({ ok: true, entry });
}

export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  // Reset seluruh koleksi. Produk yang pernah dipakai di sesi live tetap
  // disimpan (riwayat live aman); sisanya ikut terhapus. Hasil riset ulang
  // dari extension akan mengisi Koleksi lagi.
  if (body.all === true) {
    if (!isSuperuser(user)) {
      return NextResponse.json(
        { ok: false, error: "Hanya superuser yang boleh mereset seluruh koleksi" },
        { status: 403 }
      );
    }
    const removedEntries = await db.collectionEntry.deleteMany({});
    await db.product.deleteMany({ where: { sessionItems: { none: {} } } });
    return NextResponse.json({ ok: true, removed: removedEntries.count });
  }

  // Reset per folder: hapus semua entri di folder tsb ("none" = tanpa folder).
  // Folder-nya sendiri tidak dihapus. Pembersihan produk sama seperti reset
  // penuh: produk yang tidak pernah dipakai sesi live ikut terhapus.
  if (body.folderId) {
    if (!isSuperuser(user)) {
      return NextResponse.json(
        { ok: false, error: "Hanya superuser yang boleh mereset satu folder" },
        { status: 403 }
      );
    }
    const folderId = String(body.folderId);
    const removedEntries = await db.collectionEntry.deleteMany({
      where: folderId === "none" ? { folderId: null } : { folderId },
    });
    await db.product.deleteMany({ where: { collection: null, sessionItems: { none: {} } } });
    return NextResponse.json({ ok: true, removed: removedEntries.count });
  }

  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  await db.collectionEntry.deleteMany({
    where: {
      id: { in: ids },
      ...(!isSuperuser(user) ? { addedBy: user.email } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
