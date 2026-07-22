/**
 * Shopee Open Platform client (v2) — LiveStream API.
 *
 * Dua mode:
 *  - REAL : SHOPEE_PARTNER_ID + SHOPEE_PARTNER_KEY terisi → panggil partner.shopeemobile.com
 *           dengan signature HMAC-SHA256 sesuai spec Shopee Open Platform v2.
 *  - MOCK : kredensial kosong → simulasi penuh (session, live cart, metrik yang tumbuh
 *           seiring waktu) supaya seluruh alur aplikasi bisa dipakai/di-demo tanpa
 *           approval Shopee. Ganti env → otomatis pindah ke REAL tanpa ubah kode.
 */

import crypto from "crypto";

const PARTNER_ID = process.env.SHOPEE_PARTNER_ID || "";
const PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || "";
const API_BASE = process.env.SHOPEE_API_BASE || "https://partner.shopeemobile.com";
const REDIRECT_URL =
  process.env.SHOPEE_REDIRECT_URL || "http://localhost:3000/api/shopee/callback";
const STATE_SECRET =
  process.env.SHOPEE_STATE_SECRET || process.env.AUTH_SECRET || PARTNER_KEY || "elyasya-dev-oauth-state";

export const SHOPEE_MOCK = !PARTNER_ID || !PARTNER_KEY;

function redirectUrl() {
  let url: URL;
  try {
    url = new URL(REDIRECT_URL);
  } catch {
    throw new Error("SHOPEE_REDIRECT_URL bukan URL yang valid");
  }
  if (url.search || url.hash) {
    throw new Error("SHOPEE_REDIRECT_URL tidak boleh memiliki query atau hash");
  }
  return url;
}

// ---------- Signature & transport (mode REAL) --------------------------------

function sign(path: string, timestamp: number, accessToken = "", idValue = "") {
  // idValue: shop_id untuk API shop, user_id untuk API livestream.
  const base = `${PARTNER_ID}${path}${timestamp}${accessToken}${idValue}`;
  return crypto.createHmac("sha256", PARTNER_KEY).update(base).digest("hex");
}

async function callShopee(
  path: string,
  {
    method = "POST",
    accessToken = "",
    shopId = "",
    userId = "",
    body,
    query = {},
  }: {
    method?: "GET" | "POST";
    accessToken?: string;
    shopId?: string;
    userId?: string;
    body?: unknown;
    query?: Record<string, string | number>;
  }
) {
  const timestamp = Math.floor(Date.now() / 1000);
  // Endpoint /api/v2/livestream/* memakai user_id streamer (signature & query);
  // endpoint shop biasa memakai shop_id. Kalau userId terisi, itu yang dipakai.
  const idValue = userId || shopId;
  const params = new URLSearchParams({
    partner_id: PARTNER_ID,
    timestamp: String(timestamp),
    sign: sign(path, timestamp, accessToken, idValue),
    ...(accessToken ? { access_token: accessToken } : {}),
    ...(userId ? { user_id: userId } : shopId ? { shop_id: shopId } : {}),
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(`${API_BASE}${path}?${params}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" && body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`Shopee API ${path}: ${data.error || res.status} ${data.message || ""}`);
  }
  return data.response ?? data;
}

// ---------- OAuth ------------------------------------------------------------

function createOAuthState(hostId: string, userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  const payload = Buffer.from(
    JSON.stringify({ hostId, userId, expiresAt, nonce: crypto.randomBytes(12).toString("hex") })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", STATE_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Verifikasi state callback agar akun tidak bisa ditautkan ke host lewat URL palsu. */
export function readOAuthState(state: string): { hostId: string; userId: string } | null {
  const [payload, suppliedSignature] = state.split(".");
  if (!payload || !suppliedSignature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(payload)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      hostId?: unknown;
      userId?: unknown;
      expiresAt?: unknown;
    };
    if (typeof parsed.hostId !== "string" || !parsed.hostId) return null;
    if (typeof parsed.userId !== "string" || !parsed.userId) return null;
    if (typeof parsed.expiresAt !== "number" || parsed.expiresAt < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { hostId: parsed.hostId, userId: parsed.userId };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(hostId: string, userId: string) {
  const signedState = createOAuthState(hostId, userId);
  const callbackUrl = redirectUrl();
  if (SHOPEE_MOCK) {
    // Mode mock: langsung ke callback lokal dengan shop_id palsu.
    const shopId = String(100000 + Math.floor(Math.random() * 900000));
    callbackUrl.searchParams.set("code", "MOCKCODE");
    callbackUrl.searchParams.set("shop_id", shopId);
    callbackUrl.searchParams.set("state", signedState);
    return callbackUrl.toString();
  }

  // TERBUKTI JALAN (jangan diubah tanpa uji ulang): otorisasi shop via
  // auth_partner ber-signature. Callback membawa shop_id; user_id streamer
  // diturunkan dari uid pemilik shop (get_shop_base) — kombinasi token shop +
  // user_id=uid diterima semua endpoint /livestream (pin/keranjang/metrik
  // sudah terverifikasi tembus ke live asli host).
  callbackUrl.searchParams.set("state", signedState);
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const params = new URLSearchParams({
    partner_id: PARTNER_ID,
    timestamp: String(timestamp),
    sign: sign(path, timestamp),
    redirect: callbackUrl.toString(),
  });
  return `${API_BASE}${path}?${params}`;
}

export async function exchangeCode(
  code: string,
  ids: { shopId?: string; mainAccountId?: string }
) {
  if (SHOPEE_MOCK) {
    return {
      access_token: `mock-access-${crypto.randomUUID()}`,
      refresh_token: `mock-refresh-${crypto.randomUUID()}`,
      expire_in: 4 * 3600,
    };
  }
  return callShopee("/api/v2/auth/token/get", {
    body: {
      code,
      partner_id: Number(PARTNER_ID),
      ...(ids.mainAccountId
        ? { main_account_id: Number(ids.mainAccountId) }
        : { shop_id: Number(ids.shopId) }),
    },
  });
}

export async function refreshAccessToken(
  refreshToken: string,
  shopId: string,
  userId = ""
) {
  if (SHOPEE_MOCK) {
    return {
      access_token: `mock-access-${crypto.randomUUID()}`,
      refresh_token: `mock-refresh-${crypto.randomUUID()}`,
      expire_in: 4 * 3600,
    };
  }
  // TERBUKTI JALAN: refresh SELALU pakai shop_id (token kita otorisasi shop).
  // Varian user_id ditolak Shopee: "refresh token or user_id is wrong".
  void userId;
  return callShopee("/api/v2/auth/access_token/get", {
    body: {
      refresh_token: refreshToken,
      partner_id: Number(PARTNER_ID),
      shop_id: Number(shopId),
    },
  });
}

// ---------- Mock engine -------------------------------------------------------
// Metrik mock deterministik per (sessionId, menit berjalan) supaya angka naik
// mulus antar-polling, tidak loncat acak.

function seededRand(seed: string) {
  let h = 2166136261;
  for (const c of seed) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function mockMetrics(sessionId: string, startedAt: Date) {
  const minutes = Math.max(1, (Date.now() - startedAt.getTime()) / 60000);
  const rand = seededRand(sessionId);
  const viewRate = 40 + rand() * 160; // viewer masuk per menit
  const buyRate = 0.4 + rand() * 1.6; // order per menit
  const aov = 45000 + rand() * 155000; // nilai order rata-rata
  const views = Math.floor(minutes * viewRate);
  const orders = Math.floor(minutes * buyRate);
  const gmv = Math.floor(orders * aov);
  const ccu = Math.max(3, Math.floor(viewRate * (0.5 + 0.5 * Math.sin(minutes / 7)) * 1.4));
  const atc = Math.floor(orders * (2.2 + rand()));
  return {
    gmv,
    orders,
    ccu,
    peak_ccu: Math.floor(viewRate * 1.9),
    views,
    atc,
    ctr: Number((8 + rand() * 12).toFixed(2)),
    co: views > 0 ? Number(((orders / views) * 100).toFixed(2)) : 0,
    likes: Math.floor(views * (0.25 + rand() * 0.3)),
    comments: Math.floor(views * 0.06),
    shares: Math.floor(views * 0.015),
    avg_viewing_duration: Math.floor(90 + rand() * 240),
  };
}

// ---------- LiveStream API ----------------------------------------------------

export type ShopeeCtx = { accessToken: string; shopId: string; userId?: string };

export async function createSession(
  ctx: ShopeeCtx,
  { title, coverImageUrl }: { title: string; coverImageUrl?: string }
) {
  if (SHOPEE_MOCK) {
    return { session_id: Math.floor(Date.now() / 1000) };
  }
  return callShopee("/api/v2/livestream/create_session", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: {
      title,
      cover_image_url: coverImageUrl || "https://placehold.co/720x1280",
    },
  });
}

export async function startSession(ctx: ShopeeCtx, sessionId: string | number) {
  if (SHOPEE_MOCK) {
    return {
      session_id: sessionId,
      stream_url_list: {
        push_url: `rtmp://mock-live.shopee.co.id/live/${sessionId}`,
        push_key: `mockkey-${crypto.randomBytes(8).toString("hex")}`,
        play_url: `https://mock-live.shopee.co.id/play/${sessionId}.flv`,
        domain_id: 1,
      },
      share_url: `https://live.shopee.co.id/share?session=${sessionId}`,
    };
  }
  // Real: startSession butuh domain_id dari getSessionDetail
  const detail = await callShopee("/api/v2/livestream/get_session_detail", {
    method: "GET",
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    query: { session_id: sessionId },
  });
  const domainId = detail?.stream_url_list?.domain_id ?? 1;
  await callShopee("/api/v2/livestream/start_session", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: { session_id: Number(sessionId), domain_id: domainId },
  });
  return {
    session_id: sessionId,
    stream_url_list: detail?.stream_url_list ?? {},
    share_url: detail?.share_url ?? "",
  };
}

export async function getSessionDetail(ctx: ShopeeCtx, sessionId: string | number) {
  if (SHOPEE_MOCK) {
    return { session_id: Number(sessionId), status: 1 };
  }
  return callShopee("/api/v2/livestream/get_session_detail", {
    method: "GET",
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    query: { session_id: sessionId },
  });
}

export async function endSession(ctx: ShopeeCtx, sessionId: string | number) {
  if (SHOPEE_MOCK) return { ok: true };
  return callShopee("/api/v2/livestream/end_session", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: { session_id: Number(sessionId) },
  });
}

export async function addItemList(
  ctx: ShopeeCtx,
  sessionId: string | number,
  items: { item_id: number; shop_id: number }[]
) {
  if (SHOPEE_MOCK) return { ok: true, added: items.length };
  return callShopee("/api/v2/livestream/add_item_list", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: { session_id: Number(sessionId), item_list: items },
  });
}

export async function deleteItemList(
  ctx: ShopeeCtx,
  sessionId: string | number,
  items: { item_id: number; shop_id: number }[]
) {
  if (SHOPEE_MOCK) return { ok: true };
  return callShopee("/api/v2/livestream/delete_item_list", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: { session_id: Number(sessionId), item_list: items },
  });
}

export async function updateItemList(
  ctx: ShopeeCtx,
  sessionId: string | number,
  items: { item_id: number; shop_id: number; item_no: number }[]
) {
  if (SHOPEE_MOCK) return { ok: true };
  return callShopee("/api/v2/livestream/update_item_list", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: { session_id: Number(sessionId), item_list: items },
  });
}

export async function updateShowItem(
  ctx: ShopeeCtx,
  sessionId: string | number,
  item: { item_id: number; shop_id: number }
) {
  if (SHOPEE_MOCK) return { ok: true };
  return callShopee("/api/v2/livestream/update_show_item", {
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    body: { session_id: Number(sessionId), ...item },
  });
}

/** Daftar keranjang aktual sesi — termasuk produk yang ditambahkan host dari HP. */
export async function getItemList(
  ctx: ShopeeCtx,
  sessionId: string | number,
  offset = 0,
  pageSize = 100
): Promise<{
  more?: boolean;
  next_offset?: number;
  list?: Array<Record<string, unknown>>;
  item_list?: Array<Record<string, unknown>>;
}> {
  if (SHOPEE_MOCK) return { more: false, next_offset: 0, list: [] };
  return callShopee("/api/v2/livestream/get_item_list", {
    method: "GET",
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    query: { session_id: sessionId, offset, page_size: pageSize },
  });
}

/** Produk yang sedang dipin/ditampilkan di room. */
export async function getShowItem(ctx: ShopeeCtx, sessionId: string | number) {
  if (SHOPEE_MOCK) return {};
  return callShopee("/api/v2/livestream/get_show_item", {
    method: "GET",
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    query: { session_id: sessionId },
  });
}

/** Metrik per-item keranjang live: item_clicks, atc, sold_items (per halaman). */
export async function getSessionItemMetric(
  ctx: ShopeeCtx,
  sessionId: string | number,
  offset = 0,
  pageSize = 100
): Promise<{
  more: boolean;
  next_offset: number;
  list: Array<{
    item: { item_id: number; shop_id: number; name: string; image_url: string };
    metric: { item_clicks: number; atc: number; sold_items: number };
  }>;
}> {
  if (SHOPEE_MOCK) {
    return { more: false, next_offset: 0, list: [] };
  }
  return callShopee("/api/v2/livestream/get_session_item_metric", {
    method: "GET",
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    query: { session_id: sessionId, offset, page_size: pageSize },
  });
}

export async function getSessionMetric(
  ctx: ShopeeCtx,
  sessionId: string | number,
  mockStartedAt?: Date
) {
  if (SHOPEE_MOCK) {
    return mockMetrics(String(sessionId), mockStartedAt ?? new Date(Date.now() - 60000));
  }
  return callShopee("/api/v2/livestream/get_session_metric", {
    method: "GET",
    accessToken: ctx.accessToken,
    shopId: ctx.shopId,
    userId: ctx.userId ?? "",
    query: { session_id: sessionId },
  });
}
