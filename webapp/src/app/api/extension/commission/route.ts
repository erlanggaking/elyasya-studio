import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

// Lookup rate komisi untuk item yang belum ada di cache extension.
// v1: jawab dari database produk yang pernah tersinkron (rate > 0).
// Kalau nanti SHOPEE_AFFILIATE_APP_ID/SECRET dikonfigurasi, endpoint ini
// bisa ditambah fallback ke Affiliate Open API resmi (PRD §9.2).
export async function POST(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const items: Array<{ itemId?: string | number }> = Array.isArray(body.items)
    ? body.items
    : [];
  const ids = items.map((i) => String(i.itemId ?? "")).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({ ok: true, rates: {} });

  const products = await db.product.findMany({
    where: { itemId: { in: ids }, commissionRate: { gt: 0 } },
    select: { itemId: true, commissionRate: true },
  });

  const rates: Record<string, number> = {};
  for (const p of products) rates[p.itemId] = p.commissionRate;

  return NextResponse.json({ ok: true, rates });
}
