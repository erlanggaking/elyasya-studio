import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

type RawProduct = {
  itemId?: string | number;
  shopId?: string | number;
  name?: string;
  imageUrl?: string;
  price?: number;
  commissionRate?: number;
  soldTotal?: number;
  sold30d?: number;
  rating?: number;
  trend?: number;
  monthlyRevenue?: number;
  revenue30d?: number;
  [k: string]: unknown;
};

function extractKeyword(url: string): string {
  try {
    const u = new URL(url);
    return (u.searchParams.get("keyword") || u.searchParams.get("q") || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

// Terima batch captures dari extension (max 20/batch, lihat background.js syncNow).
export async function POST(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const captures: Array<{
    kind?: string;
    url?: string;
    payload?: { data?: { list?: RawProduct[] } };
    captured_at?: string;
    // Folder Koleksi tujuan — dipilih user di extension saat "kirim ke dashboard"
    folder_id?: string;
    folder_name?: string;
  }> = Array.isArray(body.captures) ? body.captures : [];

  let created = 0;
  let updated = 0;
  let syncedTrends = 0;
  let winningNew = 0;

  for (const cap of captures) {
    const list = cap?.payload?.data?.list ?? [];
    const keyword = extractKeyword(cap?.url || "");
    if (keyword) {
      await db.trendKeyword.upsert({
        where: { keyword },
        create: { keyword },
        update: { count: { increment: 1 }, lastSeen: new Date() },
      });
      syncedTrends += 1;
    }

    // Resolve folder tujuan: pakai id kalau masih ada; nama baru dibuatkan foldernya
    let folderId: string | null = null;
    if (cap.folder_id) {
      const f = await db.collectionFolder.findUnique({ where: { id: String(cap.folder_id) } });
      folderId = f?.id ?? null;
    }
    if (!folderId && cap.folder_name) {
      const name = String(cap.folder_name).trim();
      if (name) {
        const f = await db.collectionFolder.upsert({
          where: { name },
          create: { name },
          update: {},
        });
        folderId = f.id;
      }
    }

    for (const p of list) {
      const itemId = String(p.itemId ?? "");
      const shopId = String(p.shopId ?? "");
      if (!itemId || !shopId) continue;

      const data = {
        name: String(p.name || "Produk"),
        imageUrl: String(p.imageUrl || ""),
        price: Number(p.price) || 0,
        commissionRate: Number(p.commissionRate) || 0,
        sold: Number(p.sold30d ?? p.soldTotal) || 0,
        sold30d: Number(p.sold30d) || 0,
        rating: Number(p.rating) || 0,
        trend: Number(p.trend) || 0,
        revenue: Number(p.revenue30d ?? p.monthlyRevenue) || 0,
        rawPayload: JSON.stringify(p),
      };

      const existing = await db.product.findUnique({
        where: { itemId_shopId: { itemId, shopId } },
      });

      if (existing) {
        await db.product.update({
          where: { id: existing.id },
          data: {
            ...data,
            // jangan timpa nilai yang sudah terisi dengan 0
            commissionRate: data.commissionRate || existing.commissionRate,
            imageUrl: data.imageUrl || existing.imageUrl,
            rating: data.rating || existing.rating,
            trend: Number.isFinite(Number(p.trend)) ? Number(p.trend) : existing.trend,
          },
        });
        // Kalau entri koleksi sudah dihapus (mis. tombol Reset), buat lagi
        // supaya hasil riset ulang tetap muncul di Koleksi.
        await db.collectionEntry.upsert({
          where: { productId: existing.id },
          create: { productId: existing.id, addedBy: auth.user.email, folderId },
          update: folderId ? { folderId } : {},
        });
        updated += 1;
      } else {
        const product = await db.product.create({
          data: { itemId, shopId, source: "extension", ...data },
        });
        // Semua produk hasil riset otomatis masuk Koleksi (PRD §7.3)
        await db.collectionEntry.create({
          data: { productId: product.id, addedBy: auth.user.email, folderId },
        });
        created += 1;
        // heuristik "winning": komisi >= 5% dan terjual 30hr >= 100
        if (data.commissionRate >= 5 && data.sold >= 100) winningNew += 1;
      }
    }
  }

  // Update statistik device pengirim
  const deviceId = req.headers.get("x-device-id");
  await db.device.updateMany({
    where: deviceId ? { deviceId } : { apiTokenId: auth.apiToken.id },
    data: { lastSyncAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    synced_products: created + updated,
    created,
    updated,
    synced_trends: syncedTrends,
    synced_shops: 0,
    synced_offers: 0,
    winning_new: winningNew,
  });
}
