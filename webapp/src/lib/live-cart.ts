import { db } from "./db";
import { getActiveAccount, withActiveAccount } from "./shopee-account";
import { addItemList, SHOPEE_MOCK } from "./shopee";
import { isCookieAccount, enqueueLiveCommand } from "./live-commands";

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

  if (isCookieAccount(account)) {
    // Host mode cookie: titipkan ke extension (dieksekusi di browser host).
    await enqueueLiveCommand({
      hostId,
      liveSessionId: session.id,
      shopeeSessionId: session.shopeeSessionId,
      type: "add_items",
      payload: { item_list: items },
    });
  } else {
    try {
      if (SHOPEE_MOCK) {
        await addItemList({ accessToken: "", shopId: "", userId: "" }, session.shopeeSessionId, items);
      } else {
        await withActiveAccount(hostId, (active) =>
          addItemList(
            { accessToken: active.accessToken, shopId: active.shopId, userId: active.userId },
            session.shopeeSessionId,
            items
          )
        );
      }
    } catch (err) {
      console.error("[live-cart] addItemList", err);
      return { pushed: 0 };
    }
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

/**
 * Bawa produk dari sesi live sebelumnya ke sesi BARU host.
 *
 * Shopee menyimpan keranjang live host lintas sesi (di HP produk tetap ada saat
 * host live lagi keesokan harinya). Web membuat LiveSession baru tiap sesi, jadi
 * tanpa ini keranjang web kosong padahal di HP masih ada. get_item_list akan
 * menyinkronkan yang akurat bila token livestream valid — carry-over ini adalah
 * jaring pengaman agar produk TIDAK hilang di web walau token belum bisa dipakai.
 *
 * Metrik (sold/click/atc) di-reset 0 karena sesi baru. Idempotent (upsert).
 */
export async function carryOverCart(hostId: string, newSessionId: string): Promise<number> {
  const prev = await db.liveSession.findFirst({
    where: { hostId, id: { not: newSessionId }, items: { some: {} } },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { itemNo: "asc" } } },
  });
  if (!prev || prev.items.length === 0) return 0;

  let carried = 0;
  for (const it of prev.items) {
    await db.liveSessionItem.upsert({
      where: { liveSessionId_productId: { liveSessionId: newSessionId, productId: it.productId } },
      create: {
        liveSessionId: newSessionId,
        productId: it.productId,
        itemNo: it.itemNo,
        sourceAssignmentId: it.sourceAssignmentId,
      },
      update: {},
    });
    carried += 1;
  }
  console.log(`[live-cart] carry-over ${carried} produk dari sesi sebelumnya → sesi baru`);
  return carried;
}
