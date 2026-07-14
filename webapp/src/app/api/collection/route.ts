import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const tag = (url.searchParams.get("tag") || "").trim();
  const sent = url.searchParams.get("sent"); // "yes" | "no" | null
  const minComm = Number(url.searchParams.get("minComm")) || 0;
  const sort = url.searchParams.get("sort") || ""; // trend | sold30d | komisi | rating
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Number(url.searchParams.get("pageSize")) || 24);

  const where = {
    ...(q ? { product: { name: { contains: q } } } : {}),
    ...(tag ? { tags: { contains: tag } } : {}),
    ...(minComm > 0 ? { product: { ...(q ? { name: { contains: q } } : {}), commissionRate: { gte: minComm } } } : {}),
    ...(sent === "yes" ? { assignments: { some: {} } } : {}),
    ...(sent === "no" ? { assignments: { none: {} } } : {}),
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
          where: { status: { not: "removed" } },
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

// Tambah produk manual ke koleksi
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const itemId = String(body.itemId || "").trim();
  const shopId = String(body.shopId || "").trim();
  const name = String(body.name || "").trim();
  if (!itemId || !shopId || !name) {
    return NextResponse.json(
      { ok: false, error: "itemId, shopId, dan nama produk wajib diisi" },
      { status: 400 }
    );
  }

  const product = await db.product.upsert({
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

  const entry = await db.collectionEntry.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      tags: String(body.tags || ""),
      addedBy: user.email,
    },
    update: { tags: String(body.tags || "") },
  });

  return NextResponse.json({ ok: true, entry });
}

// Update tags / hapus entri
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const entry = await db.collectionEntry.update({
    where: { id: String(body.id) },
    data: { tags: String(body.tags ?? "") },
  });
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
    const removedEntries = await db.collectionEntry.deleteMany({});
    await db.product.deleteMany({ where: { sessionItems: { none: {} } } });
    return NextResponse.json({ ok: true, removed: removedEntries.count });
  }

  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  await db.collectionEntry.deleteMany({ where: { id: { in: ids } } });
  return NextResponse.json({ ok: true });
}
