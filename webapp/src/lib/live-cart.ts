import { db } from "./db";
import { getActiveAccount } from "./shopee-account";
import { addItemList, SHOPEE_MOCK } from "./shopee";

/**
 * Push semua assignment pending milik host ke keranjang live sesi aktifnya
 * (add_item_list Shopee + catat LiveSessionItem). Dipanggil otomatis saat:
 *  - produk dikirim dari Koleksi ke host yang sedang live (bulk-assign)
 *  - sesi live host tertaut (auto-deteksi / link manual / setup link)
 * Aman dipanggil kapan pun — tanpa sesi aktif / tanpa assignment = no-op.
 */
export async function pushPendingAssignments(hostId: string): Promise<{ pushed: number }> {
  const session = await db.liveSession.findFirst({ where: { hostId, status: "live" } });
  if (!session) return { pushed: 0 };

  const account = await getActiveAccount(hostId);
  if (!account && !SHOPEE_MOCK) return { pushed: 0 };

  const assignments = await db.assignment.findMany({
    where: { status: "pending", targetType: "host", hostId },
    include: { collectionEntry: { include: { product: true } } },
  });
  if (assignments.length === 0) return { pushed: 0 };

  const items = assignments.map((a) => ({
    item_id: Number(a.collectionEntry.product.itemId),
    shop_id: Number(a.collectionEntry.product.shopId),
  }));

  try {
    await addItemList(
      { accessToken: account?.accessToken ?? "", shopId: account?.shopId ?? "", userId: account?.userId ?? "" },
      session.shopeeSessionId,
      items
    );
  } catch (err) {
    console.error("[live-cart] addItemList", err);
    return { pushed: 0 };
  }

  let no = await db.liveSessionItem.count({ where: { liveSessionId: session.id } });
  let pushed = 0;
  for (const a of assignments) {
    no += 1;
    await db.liveSessionItem.upsert({
      where: {
        liveSessionId_productId: {
          liveSessionId: session.id,
          productId: a.collectionEntry.productId,
        },
      },
      create: {
        liveSessionId: session.id,
        productId: a.collectionEntry.productId,
        itemNo: no,
        sourceAssignmentId: a.id,
      },
      update: {},
    });
    await db.assignment.update({ where: { id: a.id }, data: { status: "pushed" } });
    pushed += 1;
  }
  if (pushed) console.log(`[live-cart] auto-push ${pushed} produk → sesi ${session.shopeeSessionId}`);
  return { pushed };
}
