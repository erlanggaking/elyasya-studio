import { db } from "./db";
import {
  refreshAccessToken,
  getItemList,
  getSessionItemMetric,
  getShowItem,
  updateShowItem,
  deleteItemList,
  SHOPEE_MOCK,
} from "./shopee";
import { getActiveAccount, withActiveAccount } from "./shopee-account";
import { getSessionLiveState, probeOngoing, getPublicPlayUrl } from "./shopee-live";
import { pushPendingAssignments, carryOverCart } from "./live-cart";

/**
 * Background jobs (dijalankan dari instrumentation.ts saat server start):
 *  - refreshTokensJob   : refresh token akun host SEBELUM expired (anti "hampir expired")
 *  - syncItemMetricsJob : tarik sold_items/clicks/atc per produk untuk sesi live
 *  - autoPinJob         : rotasi pin produk otomatis (urut/acak) sesuai setting host
 *  - pruneUnsoldJob     : buang produk yang 7 hari tidak terjual dari keranjang live
 */

// ---- 1. Token akun host jangan sampai expired --------------------------------
// Lewat getActiveAccount (single-flight) supaya TIDAK bertabrakan dengan refresh
// yang dipicu metrik/auto-pin/keranjang. Refresh sekali per host; tidak pernah
// menandai expired (biar host tak dipaksa reconnect — lihat shopee-account.ts).
export async function refreshTokensJob() {
  if (SHOPEE_MOCK) return;
  const soon = new Date(Date.now() + 60 * 60 * 1000); // refresh bila sisa < 60 menit
  const accounts = await db.shopeeAccount.findMany({
    where: { status: { in: ["active", "expiring"] }, tokenExpiresAt: { lt: soon } },
    orderBy: { connectedAt: "desc" },
    take: 30,
  });

  // Satu host per identitas (user/shop) cukup — getActiveAccount menyebarkan
  // token baru ke semua baris identitas itu.
  const seen = new Set<string>();
  for (const acc of accounts) {
    const key = acc.userId || acc.shopId;
    if (seen.has(key)) continue;
    seen.add(key);
    const refreshed = await getActiveAccount(acc.hostId, true);
    if (refreshed) console.log(`[jobs] token user ${key} diperpanjang`);
  }

  await recoverExpiredAccountsJob();
}

// ---- 1b. PEMULIHAN OTOMATIS akun expired -------------------------------------
// Refresh_token Shopee valid ~30 hari. Jadi akun yang sempat ditandai "expired"
// (mis. korban race lama, atau server sempat mati saat token lewat) MASIH bisa
// dipulihkan pakai refresh_token tersimpan — TANPA host reconnect manual.
// Job ini menyapu akun expired dan mencoba menghidupkannya lagi.
export async function recoverExpiredAccountsJob() {
  if (SHOPEE_MOCK) return;
  const expired = await db.shopeeAccount.findMany({
    where: { status: "expired", scope: { not: "cookie" }, refreshToken: { not: "" } },
    orderBy: { connectedAt: "desc" },
    take: 30,
  });
  const seen = new Set<string>();
  for (const acc of expired) {
    const key = acc.userId || acc.shopId;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const t = await refreshAccessToken(acc.refreshToken, acc.shopId, acc.userId);
      await db.shopeeAccount.updateMany({
        where: acc.userId
          ? { userId: acc.userId, scope: { not: "cookie" } }
          : { shopId: acc.shopId, scope: { not: "cookie" } },
        data: {
          accessToken: t.access_token,
          refreshToken: t.refresh_token ?? acc.refreshToken,
          tokenExpiresAt: new Date(Date.now() + (t.expire_in ?? 14400) * 1000),
          status: "active",
        },
      });
      console.log(`[jobs] akun ${key} PULIH otomatis (tanpa reconnect)`);
    } catch {
      // refresh_token benar-benar mati (mis. shop cabut izin app) → biarkan
      // expired; ini kasus langka yang memang butuh reconnect satu kali.
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
    const activeAccount = await getActiveAccount(session.hostId);
    if (!activeAccount || activeAccount.scope === "cookie") continue;
    try {
      await withActiveAccount(session.hostId, async (account) => {
        if (!account.userId) throw new Error("user_id akun Shopee kosong");
        const ctx = { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId };

        // 1) Sinkronkan keranjang aktual. Ini mendeteksi produk yang host
        // tambahkan langsung dari HP, bukan hanya produk kiriman dashboard.
        let offset = 0;
        for (let page = 0; page < 5; page += 1) {
          const res = await getItemList(ctx, session.shopeeSessionId, offset, 100);
          const rows = res.list ?? res.item_list ?? [];
          for (const raw of rows) {
            const row = (raw.item && typeof raw.item === "object"
              ? raw.item
              : raw) as Record<string, unknown>;
            const itemId = String(row.item_id ?? row.itemid ?? "");
            const shopId = String(row.shop_id ?? row.shopid ?? account.shopId);
            if (!itemId || !shopId) continue;
            const priceInfo = (row.price_info && typeof row.price_info === "object"
              ? row.price_info
              : {}) as Record<string, unknown>;
            const product = await db.product.upsert({
              where: { itemId_shopId: { itemId, shopId } },
              create: {
                itemId,
                shopId,
                name: String(row.name ?? row.item_name ?? "Produk Shopee"),
                imageUrl: String(row.image_url ?? row.image ?? ""),
                price: Number(priceInfo.current_price ?? row.price ?? 0) || 0,
                commissionRate:
                  (Number(
                    ((row.affiliate_info as Record<string, unknown> | undefined)?.commission_rate) ?? 0
                  ) || 0) * 100,
                source: "shopee-live",
              },
              update: {
                ...(row.name || row.item_name
                  ? { name: String(row.name ?? row.item_name) }
                  : {}),
                ...(row.image_url || row.image
                  ? { imageUrl: String(row.image_url ?? row.image) }
                  : {}),
              },
            });
            await db.liveSessionItem.upsert({
              where: {
                liveSessionId_productId: {
                  liveSessionId: session.id,
                  productId: product.id,
                },
              },
              create: {
                liveSessionId: session.id,
                productId: product.id,
                itemNo: Number(row.item_no ?? row.itemNo ?? 0),
              },
              update: {
                itemNo: Number(row.item_no ?? row.itemNo ?? 0),
              },
            });
          }
          if (!res.more) break;
          offset = Number(res.next_offset) || offset + 100;
        }

        // 2) Sinkronkan produk yang sedang dipin dari HP.
        const shown = await getShowItem(ctx, session.shopeeSessionId).catch(() => null);
        const shownNode = (shown?.item ?? shown) as Record<string, unknown> | null;
        const shownItemId = String(shownNode?.item_id ?? shownNode?.itemid ?? "");
        await db.liveSessionItem.updateMany({
          where: { liveSessionId: session.id },
          data: { isShowing: false },
        });
        if (shownItemId) {
          await db.liveSessionItem.updateMany({
            where: { liveSessionId: session.id, product: { itemId: shownItemId } },
            data: { isShowing: true },
          });
        }

        // 3) Sinkronkan sold/click/ATC per produk.
        offset = 0;
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
      });
    } catch (err) {
      console.error(`[jobs] sinkron sesi ${session.shopeeSessionId}:`, err);
    }
  }
}

// ---- 3. Status sesi aktual (agar durasi tidak terus berjalan setelah HP stop) ---
export async function syncLiveSessionStateJob() {
  const sessions = await db.liveSession.findMany({
    where: { status: "live", shopeeSessionId: { not: "" } },
    select: { id: true, shopeeSessionId: true, playUrl: true },
    take: 30,
  });
  for (const session of sessions) {
    const state = await getSessionLiveState(session.shopeeSessionId);
    if (state.state === "ended") {
      await db.liveSession.updateMany({
        where: { id: session.id, status: "live" },
        data: { status: "ended", endedAt: new Date() },
      });
      console.log(`[jobs] sesi ${session.shopeeSessionId} berakhir (sinkron HP)`);
    } else if (state.state === "live" && state.playUrl && state.playUrl !== session.playUrl) {
      await db.liveSession.update({
        where: { id: session.id },
        data: { playUrl: state.playUrl },
      });
    }
  }
}

// ---- 3b. DETEKSI GLOBAL live baru --------------------------------------------
// Sebelumnya deteksi live baru hanya jalan saat panel host dibuka atau extension
// aktif → host yang tak dilihat siapa pun tidak terdeteksi ("5 live di HP, cuma
// 3 di tools"). Job ini menyapu SEMUA host ber-liveUid yang belum punya sesi
// aktif, cek apakah sedang live, dan menautkannya otomatis.
export async function detectNewLivesJob() {
  const hosts = await db.host.findMany({
    where: {
      liveUid: { not: "" },
      liveSessions: { none: { status: "live" } },
    },
    select: { id: true, name: true, liveUid: true, studioId: true },
    take: 60,
  });

  for (const host of hosts) {
    let ongoing: Awaited<ReturnType<typeof probeOngoing>> = null;
    try {
      ongoing = await probeOngoing(host.liveUid);
    } catch {
      continue;
    }
    if (!ongoing) continue;

    // Sesi ini sudah pernah dikenal & ditandai berakhir → jangan bangkitkan lagi.
    const known = await db.liveSession.findFirst({
      where: { hostId: host.id, shopeeSessionId: ongoing.sessionId },
    });
    if (known) {
      if (known.status !== "live") continue;
      continue;
    }

    const playUrl = ongoing.playUrl || (await getPublicPlayUrl(ongoing.sessionId));
    const created = await db.liveSession.create({
      data: {
        shopeeSessionId: ongoing.sessionId,
        hostId: host.id,
        studioId: host.studioId,
        status: "live",
        title: ongoing.title || `Live ${host.name} — ${new Date().toLocaleDateString("id-ID")}`,
        shareUrl: `https://live.shopee.co.id/share?from=live&session=${ongoing.sessionId}`,
        playUrl,
        startedAt: ongoing.startedAt ?? new Date(),
      },
    });
    console.log(`[jobs] DETEKSI GLOBAL: ${host.name} live → sesi ${ongoing.sessionId} ditautkan`);
    await carryOverCart(host.id, created.id);
    await pushPendingAssignments(host.id);
  }
}

// ---- 4. Auto-pin rotasi produk -------------------------------------------------
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
    if ((!account || account.scope === "cookie") && !SHOPEE_MOCK) continue;
    try {
      const pinItem = {
        item_id: Number(target.product.itemId),
        shop_id: Number(target.product.shopId),
      };
      if (SHOPEE_MOCK) {
        await updateShowItem({ accessToken: "", shopId: "", userId: "" }, session.shopeeSessionId, pinItem);
      } else {
        await withActiveAccount(host.id, (active) =>
          updateShowItem(
            { accessToken: active.accessToken, shopId: active.shopId, userId: active.userId },
            session.shopeeSessionId,
            pinItem
          )
        );
      }
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

// ---- 5. Buang produk tak terjual > 7 hari dari keranjang ----------------------
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
  setInterval(safe(detectNewLivesJob, "detectNewLives"), 30 * 1000);
  setInterval(safe(syncItemMetricsJob, "itemMetrics"), 30 * 1000);
  setInterval(safe(syncLiveSessionStateJob, "sessionState"), 30 * 1000);
  setInterval(safe(refreshTokensJob, "refreshTokens"), 15 * 60 * 1000);
  setInterval(safe(pruneUnsoldJob, "pruneUnsold"), 6 * 60 * 60 * 1000);

  // Jalankan sekali saat start (token & metrik biar langsung segar)
  setTimeout(safe(refreshTokensJob, "refreshTokens-init"), 5 * 1000);
  setTimeout(safe(detectNewLivesJob, "detectNewLives-init"), 8 * 1000);
  setTimeout(safe(syncItemMetricsJob, "itemMetrics-init"), 10 * 1000);
  setTimeout(safe(syncLiveSessionStateJob, "sessionState-init"), 12 * 1000);
  setTimeout(safe(pruneUnsoldJob, "pruneUnsold-init"), 30 * 1000);
}
