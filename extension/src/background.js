/**
 * Elyasya-Studio — background service worker (Fase 4 + capture DevTools Protocol)
 */

import { DebuggerCapture } from "./debugger-capture.js";

const DEFAULT_API_URL = "https://elyasyastudio.com";
const SYNC_ALARM = "elyasya-sync";
const QUEUE_KEY = "captureQueue";
const CACHE_KEY = "productCache";
const DEVICE_KEY = "deviceId";
const CAPTURE_PREF_KEY = "debuggerCaptureEnabled";

let syncInProgress = false;
let syncDebounceTimer = null;

// ---- Capture via chrome.debugger (DevTools Protocol) ------------------------
// Body respons yang tertangkap diteruskan ke content script tab bersangkutan,
// yang lalu memasukkannya ke pipeline parsing research-core (jalur sama dengan
// intercept fetch/XHR, jadi semua parser dipakai ulang).

DebuggerCapture.initLifecycleHooks();
chrome.debugger.onEvent.addListener((source, method, params) => {
  DebuggerCapture.handleDebuggerEvent(source, method, params);
});

function forwardCaptureToTab({ tabId, url, body }) {
  chrome.tabs
    .sendMessage(tabId, { type: "NET_CAPTURE", url, body })
    .catch(() => {
      /* tab mungkin sudah pindah/tertutup */
    });
}

async function isCaptureEnabled() {
  const { [CAPTURE_PREF_KEY]: v } = await chrome.storage.local.get(CAPTURE_PREF_KEY);
  return v !== false; // default: aktif
}

async function enableCaptureForTab(tabId) {
  if (tabId == null) return { ok: false, error: "Tab tidak diketahui" };
  if (!(await isCaptureEnabled())) return { ok: false, disabled: true };
  if (DebuggerCapture.isAttached(tabId)) return { ok: true, already: true };
  return DebuggerCapture.attachToTab(tabId, forwardCaptureToTab);
}

async function disableCaptureForTab(tabId) {
  if (tabId == null) return { ok: false };
  await DebuggerCapture.detachFromTab(tabId);
  return { ok: true };
}

async function setCaptureEnabled(enabled) {
  await chrome.storage.local.set({ [CAPTURE_PREF_KEY]: !!enabled });
  return { ok: true, enabled: !!enabled };
}

// ---- Livestream sync -------------------------------------------------------
async function syncLiveSessions(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return { ok: false, error: "empty" };
  const config = await getConfig();
  if (!config.token) return { ok: false, error: "Token belum diisi" };
  try {
    const res = await fetch(`${config.apiUrl}/api/extension/live/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ sessions }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      await chrome.storage.local.set({
        lastLiveSyncAt: new Date().toISOString(),
        lastLiveSyncCount: sessions.length,
      });
      return { ok: true, ...data };
    }
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

async function scheduleAutoSync() {
  const config = await getConfig();
  if (!config.enabled || !config.token) return;
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncNow(false).catch(() => {});
  }, 2500);
}

async function getConfig() {
  const stored = await chrome.storage.sync.get(["apiUrl", "token", "enabled", "accountLabel"]);
  return {
    apiUrl: (stored.apiUrl || DEFAULT_API_URL).replace(/\/$/, ""),
    token: stored.token || "",
    enabled: stored.enabled !== false,
    accountLabel: stored.accountLabel || "",
  };
}

async function getDeviceId() {
  const { [DEVICE_KEY]: existing } = await chrome.storage.local.get(DEVICE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_KEY]: id });
  return id;
}

async function getDeviceLabel() {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows Chrome";
  if (/Mac/i.test(ua)) return "Mac Chrome";
  if (/Linux/i.test(ua)) return "Linux Chrome";
  return "Chrome Browser";
}

async function registerDevice() {
  const config = await getConfig();
  if (!config.token) return { ok: false, error: "Token belum diisi" };

  const deviceId = await getDeviceId();
  try {
    const res = await fetch(`${config.apiUrl}/api/extension/device/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({
        device_id: deviceId,
        label: await getDeviceLabel(),
        user_agent: navigator.userAgent,
        account_label: config.accountLabel || undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      await chrome.storage.local.set({
        deviceRegistered: true,
        deviceCount: data.max_devices,
        maxDevices: data.max_devices,
      });
      return { ok: true, device: data.device, max_devices: data.max_devices };
    }
    return { ok: false, error: data.error || `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

async function getQueue() {
  const { [QUEUE_KEY]: queue } = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(queue) ? queue : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
}

async function cacheProducts(products) {
  if (!Array.isArray(products) || products.length === 0) return;
  const { [CACHE_KEY]: existing = {} } = await chrome.storage.local.get(CACHE_KEY);
  const cache = { ...existing };
  for (const p of products) {
    const key = p.key || `${p.shopId}-${p.itemId}`;
    if (key && p.itemId && p.shopId) cache[key] = p;
  }
  await chrome.storage.local.set({ [CACHE_KEY]: cache });
}

async function pushCapture(capture, products) {
  const queue = await getQueue();
  queue.push(capture);
  if (queue.length > 200) queue.splice(0, queue.length - 200);
  await setQueue(queue);
  await cacheProducts(products);
  await chrome.storage.local.set({
    lastCaptureAt: capture.captured_at || new Date().toISOString(),
    pendingCount: queue.length,
    lastCaptureProducts: Array.isArray(products) ? products.length : 0,
  });
  await scheduleAutoSync();
}

async function syncNow(flushAll = false) {
  if (syncInProgress) return { ok: false, reason: "busy" };

  const config = await getConfig();
  if (!config.token) {
    return { ok: false, error: "Token belum diisi. Klik Simpan dulu." };
  }

  let queue = await getQueue();
  if (queue.length === 0) {
    return { ok: true, synced: 0, reason: "empty", message: "Antrian kosong. Browse halaman Shopee dulu." };
  }

  syncInProgress = true;
  let totalSynced = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalTrends = 0;
  let syncedShops = 0;
  let syncedOffers = 0;
  let winningNew = 0;
  let batches = 0;
  const maxBatches = flushAll ? 10 : 1;

  try {
    while (queue.length > 0 && batches < maxBatches) {
      const batch = queue.splice(0, 20);
      batches += 1;

      const res = await fetch(`${config.apiUrl}/api/extension/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.token}`,
        },
        body: JSON.stringify({ captures: batch }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        queue = [...batch, ...queue];
        await setQueue(queue);
        await chrome.storage.local.set({
          lastSyncError: data.error || `HTTP ${res.status}`,
          pendingCount: queue.length,
        });
        return { ok: false, error: data.error || `HTTP ${res.status}` };
      }

      totalSynced += data.synced_products ?? 0;
      totalCreated += data.created ?? 0;
      totalUpdated += data.updated ?? 0;
      totalTrends += data.synced_trends ?? 0;
      syncedShops = data.synced_shops ?? syncedShops;
      syncedOffers = data.synced_offers ?? syncedOffers;
      winningNew = data.winning_new ?? winningNew;
    }

    await setQueue(queue);
    await chrome.storage.local.set({
      lastSyncAt: new Date().toISOString(),
      lastSyncError: null,
      lastSyncedProducts: totalSynced,
      lastSyncedShops: syncedShops,
      lastSyncedOffers: syncedOffers,
      lastSyncedTrends: totalTrends,
      lastWinningNew: winningNew,
      pendingCount: queue.length,
    });

    await notifyWinning(winningNew);

    return {
      ok: true,
      synced: totalSynced,
      syncedShops,
      syncedOffers,
      syncedTrends: totalTrends,
      winningNew,
      created: totalCreated,
      updated: totalUpdated,
      remaining: queue.length,
      message:
        totalSynced > 0 || totalTrends > 0
          ? `Berhasil sync ${totalSynced} produk${totalTrends ? `, ${totalTrends} keyword` : ""}`
          : "Sync selesai. Refresh halaman Shopee jika belum ada data baru.",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Network error";
    await chrome.storage.local.set({ lastSyncError: message, pendingCount: queue.length });
    return { ok: false, error: message };
  } finally {
    syncInProgress = false;
  }
}

async function notifyWinning(count) {
  const n = Number(count) || 0;
  if (n <= 0) return;
  const { lastWinningNotify } = await chrome.storage.local.get("lastWinningNotify");
  const now = Date.now();
  if (lastWinningNotify && now - lastWinningNotify < 60000) return;
  await chrome.storage.local.set({ lastWinningNotify: now });
  chrome.notifications?.create?.(`winning-${now}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Elyasya-Studio",
    message: `${n} produk potensial winning terdeteksi!`,
  });
}

async function pingServer() {
  const config = await getConfig();
  if (!config.token) return { ok: false, error: "Token belum diisi" };

  try {
    const res = await fetch(`${config.apiUrl}/api/extension/status`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok, data, status: res.status };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

async function getTrends() {
  const config = await getConfig();
  if (!config.token) return { keywords: [] };

  try {
    const res = await fetch(`${config.apiUrl}/api/research/trending?limit=15`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await res.json().catch(() => ({}));
    return { keywords: data.keywords ?? [] };
  } catch {
    return { keywords: [] };
  }
}

async function getExportData() {
  const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
  return Object.values(cache);
}

async function getDeviceInfo() {
  const deviceId = await getDeviceId();
  const { deviceRegistered, maxDevices } = await chrome.storage.local.get([
    "deviceRegistered",
    "maxDevices",
  ]);
  let deviceCount = 0;
  const config = await getConfig();
  if (config.token) {
    try {
      const res = await fetch(`${config.apiUrl}/api/extension/status`, {
        headers: { Authorization: `Bearer ${config.token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.stats) {
        deviceCount = data.stats.registered_devices ?? 0;
      }
    } catch { /* ignore */ }
  }
  return {
    deviceId,
    registered: !!deviceRegistered,
    deviceCount,
    maxDevices: maxDevices ?? 3,
  };
}

// ---- Cache komisi lintas-tab ------------------------------------------------
// Komisi hanya terlihat di portal affiliate (atau via API resmi ber-signature
// di server). Cache ini membagikan rate yang sudah ditemukan di tab mana pun
// ke tab shopee.co.id, di-key per itemId.

const COMMISSION_KEY = "commissionCache";
const COMMISSION_MAX = 5000;

async function commissionPut(entries) {
  if (!entries || typeof entries !== "object") return { ok: true, added: 0 };
  const { [COMMISSION_KEY]: cache = {} } = await chrome.storage.local.get(COMMISSION_KEY);
  let added = 0;
  for (const [id, rate] of Object.entries(entries)) {
    const r = Number(rate);
    if (!id || !(r > 0)) continue;
    if (cache[id] !== r) {
      cache[id] = r;
      added += 1;
    }
  }
  const keys = Object.keys(cache);
  if (keys.length > COMMISSION_MAX) {
    for (const k of keys.slice(0, keys.length - COMMISSION_MAX)) delete cache[k];
  }
  if (added > 0) await chrome.storage.local.set({ [COMMISSION_KEY]: cache });
  return { ok: true, added };
}

async function commissionLookup(itemIds, keyword) {
  const ids = (Array.isArray(itemIds) ? itemIds : []).map(String).filter(Boolean);
  const { [COMMISSION_KEY]: cache = {} } = await chrome.storage.local.get(COMMISSION_KEY);
  const rates = {};
  const missing = [];
  for (const id of ids) {
    if (cache[id] > 0) rates[id] = cache[id];
    else missing.push(id);
  }

  // Sisa yang tak ada di cache: tanya server (API affiliate resmi ber-signature,
  // hanya jalan bila SHOPEE_AFFILIATE_APP_ID/SECRET dikonfigurasi di server).
  if (missing.length > 0) {
    const config = await getConfig();
    if (config.token) {
      try {
        const res = await fetch(`${config.apiUrl}/api/extension/commission`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({
            keyword: keyword || "",
            items: missing.slice(0, 60).map((itemId) => ({ itemId })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.rates && typeof data.rates === "object") {
          Object.assign(rates, data.rates);
          await commissionPut(data.rates);
        }
      } catch {
        /* server tak terjangkau — pakai cache saja */
      }
    }
  }

  return { ok: true, rates };
}

// ---- Watcher live: ambil play url / metrik sesi dari browser -----------------
// API live.shopee.co.id/api/v1/session/* diblokir anti-bot untuk server, tapi
// bisa diakses dari extension (cookie + fingerprint browser asli), TANPA buka
// tab. Tiap menit: tanya server sesi live mana yang dipantau → fetch detail →
// setor play_url + viewer via live/sync.

const LIVE_WATCH_ALARM = "elyasya-live-watch";

function findPlayUrlDeep(node, depth = 0, seen = new Set()) {
  if (!node || depth > 7) return "";
  if (typeof node === "string") {
    return /^https?:\/\/[^ ]+\.(flv|m3u8)(\?|$)/i.test(node) ? node : "";
  }
  if (typeof node !== "object" || seen.has(node)) return "";
  seen.add(node);
  for (const k in node) {
    if (/play/i.test(k)) {
      const r = findPlayUrlDeep(node[k], depth + 1, seen);
      if (r) return r;
    }
  }
  for (const k in node) {
    const r = findPlayUrlDeep(node[k], depth + 1, seen);
    if (r) return r;
  }
  return "";
}

function findNumDeep(node, keyRe, depth = 0, seen = new Set()) {
  if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return 0;
  seen.add(node);
  for (const k in node) {
    if (keyRe.test(k)) {
      const n = Number(node[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  for (const k in node) {
    const r = findNumDeep(node[k], keyRe, depth + 1, seen);
    if (r) return r;
  }
  return 0;
}

function findSessionIdDeep(node, depth = 0, seen = new Set()) {
  if (!node || typeof node !== "object" || depth > 5 || seen.has(node)) return "";
  seen.add(node);
  for (const k in node) {
    if (/^session_?id$/i.test(k)) {
      const v = node[k];
      if ((typeof v === "number" || typeof v === "string") && String(v).match(/^\d{4,}$/)) {
        return String(v);
      }
    }
  }
  for (const k in node) {
    const r = findSessionIdDeep(node[k], depth + 1, seen);
    if (r) return r;
  }
  return "";
}

async function watchLiveSessions() {
  const config = await getConfig();
  if (!config.token || !config.enabled) return;

  let watched = [];
  let detectUids = [];
  try {
    const res = await fetch(`${config.apiUrl}/api/extension/live/watch`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !Array.isArray(data.sessions)) return;
    watched = data.sessions;
    detectUids = Array.isArray(data.detect_uids) ? data.detect_uids : [];
  } catch {
    return;
  }

  const updates = [];

  // 1. Deteksi live BARU per uid host (dari browser, endpoint ongoing akurat).
  for (const uid of detectUids.slice(0, 10)) {
    try {
      const res = await fetch(
        `https://live.shopee.co.id/api/v1/shop_page/live/ongoing?uid=${encodeURIComponent(uid)}`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      const d = await res.json().catch(() => null);
      const live = d?.data?.ongoing_live;
      if (!live || typeof live !== "object") continue;
      const sessionId = findSessionIdDeep(live);
      if (!sessionId) continue;
      updates.push({
        session_id: sessionId,
        uid: String(uid),
        title: String(live.title ?? live.name ?? ""),
        play_url: findPlayUrlDeep(live),
        viewers: findNumDeep(live, /^(ccu|viewer|online_count|member_cnt)/i),
      });
    } catch {
      /* skip uid ini */
    }
  }

  // 2. Perkaya sesi yang sudah dipantau (play_url + viewer).
  for (const s of watched.slice(0, 5)) {
    try {
      const res = await fetch(
        `https://live.shopee.co.id/api/v1/session/${encodeURIComponent(s.session_id)}`,
        {
          credentials: "include",
          headers: {
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            Referer: `https://live.shopee.co.id/share?from=live&session=${s.session_id}`,
          },
        }
      );
      const d = await res.json().catch(() => null);
      if (!d || (d.err_code != null && d.err_code !== 0 && !d.data)) continue;
      const playUrl = findPlayUrlDeep(d);
      const viewers = findNumDeep(d, /^(ccu|viewer|online_count|member_cnt)/i);
      const likes = findNumDeep(d, /^(like_cnt|likes|total_like)/i);
      if (!playUrl && !viewers) continue;
      updates.push({
        session_id: String(s.session_id),
        play_url: playUrl,
        viewers,
        likes,
      });
    } catch {
      /* skip sesi ini */
    }
  }
  if (updates.length) await syncLiveSessions(updates);
}

// ---- Pencarian shopee.co.id dari background ---------------------------------
// Dipakai research-core untuk melengkapi produk portal affiliate dengan data
// penuh (rating, ulasan, ctime, stok, penjualan bulanan → tren). Background
// punya host_permissions shopee.co.id sehingga cookie user ikut terkirim.
async function shopeeSearch(keyword, newest = 0, limit = 60) {
  const kw = String(keyword || "").trim();
  if (!kw) return { ok: false, error: "keyword kosong" };
  const params = new URLSearchParams({
    by: "relevancy",
    keyword: kw,
    limit: String(Math.min(60, Number(limit) || 60)),
    newest: String(Math.max(0, Number(newest) || 0)),
    order: "desc",
    page_type: "search",
    scenario: "PAGE_GLOBAL_SEARCH",
    version: "2",
  });
  try {
    const res = await fetch(`https://shopee.co.id/api/v4/search/search_items?${params}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-API-SOURCE": "pc",
        "X-Shopee-Language": "id",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, error: "bukan JSON" };
    return { ok: true, body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

// Daftar folder Koleksi dari dashboard — untuk pemilih folder "kirim ke dashboard"
async function getFolders() {
  const config = await getConfig();
  if (!config.token) return { ok: false, error: "Token belum diisi. Klik Simpan dulu." };
  try {
    const res = await fetch(`${config.apiUrl}/api/extension/folders`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, folders: Array.isArray(data.folders) ? data.folders : [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "SHOPEE_SEARCH") {
    shopeeSearch(msg.keyword, msg.newest, msg.limit)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "ENABLE_CAPTURE") {
    enableCaptureForTab(_sender.tab?.id)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "DISABLE_CAPTURE") {
    disableCaptureForTab(_sender.tab?.id)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "SET_CAPTURE_ENABLED") {
    setCaptureEnabled(msg.enabled)
      .then(async (r) => {
        // Kalau dimatikan, lepaskan semua tab yang sedang di-attach.
        if (!msg.enabled) {
          for (const tabId of [...(await chrome.tabs.query({}))].map((t) => t.id)) {
            await DebuggerCapture.detachFromTab(tabId);
          }
        }
        sendResponse(r);
      })
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "GET_CAPTURE_ENABLED") {
    isCaptureEnabled()
      .then((enabled) => sendResponse({ ok: true, enabled }))
      .catch(() => sendResponse({ ok: true, enabled: true }));
    return true;
  }

  if (msg.type === "LIVE_CAPTURE") {
    syncLiveSessions(msg.sessions)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "CAPTURE") {
    pushCapture(msg.capture, msg.products)
      .then(() => sendResponse({ queued: true }))
      .catch(() => sendResponse({ queued: false }));
    return true;
  }

  if (msg.type === "SYNC_NOW") {
    syncNow(true)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "GET_FOLDERS") {
    getFolders()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "PING") {
    pingServer()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "REGISTER_DEVICE") {
    registerDevice()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "GET_TRENDS") {
    getTrends()
      .then(sendResponse)
      .catch(() => sendResponse({ keywords: [] }));
    return true;
  }

  if (msg.type === "GET_DEVICE_INFO") {
    getDeviceInfo()
      .then(sendResponse)
      .catch(() => sendResponse({ deviceId: null }));
    return true;
  }

  if (msg.type === "GET_EXPORT_DATA") {
    getExportData()
      .then((products) => sendResponse({ ok: true, products }))
      .catch(() => sendResponse({ ok: false, products: [] }));
    return true;
  }

  if (msg.type === "GET_STATS") {
    chrome.storage.local
      .get([
        "lastSyncAt",
        "lastCaptureAt",
        "lastSyncError",
        "lastSyncedProducts",
        "pendingCount",
        "lastCaptureProducts",
      ])
      .then(async (stats) => {
        const { [CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CACHE_KEY);
        sendResponse({
          ...stats,
          cachedProducts: Object.keys(cache).length,
        });
      });
    return true;
  }

  if (msg.type === "COMMISSION_PUT") {
    commissionPut(msg.entries)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "COMMISSION_LOOKUP") {
    commissionLookup(msg.itemIds, msg.keyword)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  if (msg.type === "WINNING_DETECTED") {
    notifyWinning(msg.count)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncNow(false);
  if (alarm.name === LIVE_WATCH_ALARM) watchLiveSessions();
});

chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(LIVE_WATCH_ALARM, { periodInMinutes: 1 });
  await getDeviceId();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(LIVE_WATCH_ALARM, { periodInMinutes: 1 });
});

// Jalankan sekali tiap service worker bangun — jangan tunggu alarm pertama.
watchLiveSessions().catch(() => {});
