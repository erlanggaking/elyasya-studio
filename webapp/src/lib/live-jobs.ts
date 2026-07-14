import { db } from "./db";
import { refreshAccessToken, getSessionItemMetric, updateShowItem, deleteItemList, SHOPEE_MOCK } from "./shopee";
import { getActiveAccount } from "./shopee-account";

/**
 * Background jobs (dijalankan dari instrumentation.ts saat server start):
 *  - refreshTokensJob   : refresh token akun host SEBELUM expired (anti "hampir expired")
 *  - syncItemMetricsJob : tarik sold_items/clicks/atc per produk untuk sesi live
 *  - autoPinJob         : rotasi pin produk otomatis (urut/acak) sesuai setting host
 *  - pruneUnsoldJob     : buang produk yang 7 hari tidak terjual dari keranjang live
 */

// ---- 1. Token akun host jangan sampai expired --------------------------------
export async function refreshTokensJob() {
  if (SHOPEE_MOCK) return;
  const soon = new Date(Date.now() + 60 * 60 * 1000); // refresh bila sisa < 60 menit
  const accounts = await db.shopeeAccount.findMany({
    where: { status: { not: "revoked" }, tokenExpiresAt: { lt: soon } },
    orderBy: { connectedAt: "desc" },
    take: 30,
  });

  // Satu shop bisa dipakai beberapa host (baris akun berbeda). Shopee MEROTASI
  // refresh token tiap dipakai — jadi refresh SEKALI per shop (pakai baris
  // terbaru), lalu terapkan token baru ke SEMUA baris shop itu.
  const byShop = new Map<string, (typeof accounts)[number]>();
  for (const acc of accounts) if (!byShop.has(acc.shopId)) byShop.set(acc.shopId, acc);

  for (const acc of byShop.values()) {
    try {
      const t = await refreshAccessToken(acc.refreshToken, acc.shopId);
      await db.shopeeAccount.updateMany({
        where: { shopId: acc.shopId, status: { not: "revoked" } },
        data: {
          accessToken: t.access_token,
          refreshToken: t.refresh_token ?? acc.refreshToken,
          tokenExpiresAt: new Date(Date.now() + (t.expire_in ?? 14400) * 1000),
          status: "active",
        },
      });
      console.log(`[jobs] token shop ${acc.shopId} diperpanjang (semua baris)`);
    } catch (err) {
      // Refresh token mati permanen (mis. tergeser rotasi lama) → tandai
      // expired supaya tidak spam retry; host tinggal Reconnect sekali.
      const msg = err instanceof Error ? err.message : String(err);
      if (/refresh token|invalid/i.test(msg)) {
        await db.shopeeAccount.updateMany({
          where: { shopId: acc.shopId, status: { not: "revoked" } },
          data: { status: "expired" },
        });
        console.error(`[jobs] token shop ${acc.shopId} mati permanen → tandai expired (perlu Reconnect)`);
      } else {
        console.error(`[jobs] refresh token shop ${acc.shopId} gagal:`, msg);
      }
    }
  }
}

// ---- 2. Metrik penjualan per produk (sesi live) -------------------------------
export async function syncItemMetricsJob() {
  if (SHOPEE_MOCK) return;
  const sessions = await db.liveSession.findMany({
    where: { status: "live", shopeeSessionId: { not: "" } },
    take: 10,
  });
  for (const session of sessions) {
    const account = await getActiveAccount(session.hostId);
    if (!account?.userId) continue;
    const ctx = { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId };
    try {
      let offset = 0;
      for (let page = 0; page < 5; page += 1) {
        const res = await getSessionItemMetric(ctx, session.shopeeSessionId, offset, 100);
        for (const row of res.list ?? []) {
          const itemId = String(row.item?.item_id ?? "");
          if (!itemId) continue;
          await db.liveSessionItem.updateMany({
            where: { liveSessionId: session.id, product: { itemId } },
            data: {
              soldItems: Number(row.metric?.sold_items) || 0,
              itemClicks: Number(row.metric?.item_clicks) || 0,
              atc: Number(row.metric?.atc) || 0,
            },
          });
        }
        if (!res.more) break;
        offset = Number(res.next_offset) || offset + 100;
      }
    } catch (err) {
      console.error(`[jobs] item metric sesi ${session.shopeeSessionId}:`, err);
    }
  }
}

// ---- 3. Auto-pin rotasi produk -------------------------------------------------
// Jejak waktu pin terakhir per sesi (in-memory — reset saat server restart, aman).
const lastPinAt = new Map<string, number>();

export async function autoPinJob() {
  const sessions = await db.liveSession.findMany({
    where: { status: "live" },
    include: {
      host: { select: { id: true, autoPinEnabled: true, autoPinSeconds: true, autoPinMode: true } },
      items: { orderBy: { itemNo: "asc" }, include: { product: true } },
    },
    take: 20,
  });

  for (const session of sessions) {
    const { host } = session;
    if (!host.autoPinEnabled || session.items.length < 2) continue;

    const interval = Math.max(10, host.autoPinSeconds || 60) * 1000;
    const last = lastPinAt.get(session.id) ?? 0;
    if (Date.now() - last < interval) continue;

    const current = session.items.findIndex((i) => i.isShowing);
    let nextIndex: number;
    if (host.autoPinMode === "acak") {
      do {
        nextIndex = Math.floor(Math.random() * session.items.length);
      } while (nextIndex === current && session.items.length > 1);
    } else {
      nextIndex = (current + 1) % session.items.length;
    }
    const target = session.items[nextIndex];
    if (!target) continue;

    const account = await getActiveAccount(host.id);
    if (!account && !SHOPEE_MOCK) continue;
    try {
      await updateShowItem(
        { accessToken: account?.accessToken ?? "", shopId: account?.shopId ?? "", userId: account?.userId ?? "" },
        session.shopeeSessionId,
        { item_id: Number(target.product.itemId), shop_id: Number(target.product.shopId) }
      );
      await db.liveSessionItem.updateMany({ where: { liveSessionId: session.id }, data: { isShowing: false } });
      await db.liveSessionItem.update({ where: { id: target.id }, data: { isShowing: true } });
      lastPinAt.set(session.id, Date.now());
      console.log(`[jobs] auto-pin ${host.autoPinMode} → item #${target.itemNo} sesi ${session.shopeeSessionId}`);
    } catch (err) {
      console.error(`[jobs] auto-pin sesi ${session.shopeeSessionId}:`, err);
      lastPinAt.set(session.id, Date.now()); // jangan spam retry tiap tick
    }
  }
}

// ---- 4. Buang produk tak terjual > 7 hari dari keranjang ----------------------
export async function pruneUnsoldJob() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  // Assignment yang sudah dipush > 7 hari dan total penjualannya nol di semua
  // sesi live → tandai removed + keluarkan dari keranjang sesi aktif.
  const stale = await db.assignment.findMany({
    where: { status: "pushed", targetType: "host", assignedAt: { lt: weekAgo } },
    include: { collectionEntry: { include: { product: true } } },
    take: 50,
  });

  for (const a of stale) {
    const soldTotal = await db.liveSessionItem.aggregate({
      where: { sourceAssignmentId: a.id },
      _sum: { soldItems: true },
    });
    if ((soldTotal._sum.soldItems ?? 0) > 0) continue;

    // Keluarkan dari keranjang sesi yang masih live
    const activeItems = await db.liveSessionItem.findMany({
      where: { sourceAssignmentId: a.id, liveSession: { status: "live" } },
      include: { liveSession: true, product: true },
    });
    for (const it of activeItems) {
      const account = await getActiveAccount(it.liveSession.hostId);
      if (account || SHOPEE_MOCK) {
        try {
          await deleteItemList(
            { accessToken: account?.accessToken ?? "", shopId: account?.shopId ?? "", userId: account?.userId ?? "" },
            it.liveSession.shopeeSessionId,
            [{ item_id: Number(it.product.itemId), shop_id: Number(it.product.shopId) }]
          );
        } catch (err) {
          console.error("[jobs] prune deleteItemList:", err);
        }
      }
      await db.liveSessionItem.delete({ where: { id: it.id } });
    }

    if (a.hostId) {
      await db.assignment.update({ where: { id: a.id }, data: { status: "removed" } });
      console.log(`[jobs] prune: "${a.collectionEntry.product.name.slice(0, 40)}" 7 hari tanpa penjualan → dikeluarkan`);
    }
  }
}

// ---- Scheduler -----------------------------------------------------------------
let started = false;

export function startLiveJobs() {
  if (started) return;
  started = true;
  console.log("[jobs] background jobs aktif (token refresh, item metrics, auto-pin, prune)");

  const safe = (fn: () => Promise<void>, label: string) => () =>
    fn().catch((err) => console.error(`[jobs] ${label}:`, err));

  setInterval(safe(autoPinJob, "autoPin"), 10 * 1000);
  setInterval(safe(syncItemMetricsJob, "itemMetrics"), 2 * 60 * 1000);
  setInterval(safe(refreshTokensJob, "refreshTokens"), 15 * 60 * 1000);
  setInterval(safe(pruneUnsoldJob, "pruneUnsold"), 6 * 60 * 60 * 1000);

  // Jalankan sekali saat start (token & metrik biar langsung segar)
  setTimeout(safe(refreshTokensJob, "refreshTokens-init"), 5 * 1000);
  setTimeout(safe(syncItemMetricsJob, "itemMetrics-init"), 10 * 1000);
  setTimeout(safe(pruneUnsoldJob, "pruneUnsold-init"), 30 * 1000);
}
