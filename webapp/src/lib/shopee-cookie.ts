/**
 * Klien cookie Shopee — konek host lewat cookie sesi (seperti tool serverbgs).
 *
 * Cookie diambil host dari extension "cookie-editor" di browser mereka, lalu
 * di-import ke dashboard. Server memakainya untuk memanggil API INTERNAL Shopee
 * atas nama host. Ini SATU-SATUNYA jalur untuk akun AFFILIATE (is_seller=false)
 * yang tidak bisa OAuth Partner API sama sekali.
 *
 * Cookie penting: SPC_U (user_id/uid), SPC_ST (session token), SPC_R_T_ID, dst.
 */

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

/** Normalisasi string cookie: buang spasi, pastikan pemisah `; `. */
export function normalizeCookie(raw: string): string {
  return raw
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join("; ");
}

/** Ambil satu nilai cookie berdasarkan nama (mis. SPC_U). */
export function cookieValue(raw: string, name: string): string {
  const m = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : "";
}

export type ShopeeCookieIdentity = {
  uid: string;
  username: string;
  shopId: string;
  isSeller: boolean;
};

/**
 * Validasi cookie via get_account_info. Return identitas host bila cookie
 * masih login; null bila kedaluwarsa/invalid.
 */
export async function verifyCookie(rawCookie: string): Promise<ShopeeCookieIdentity | null> {
  const cookie = normalizeCookie(rawCookie);
  try {
    const res = await fetch("https://shopee.co.id/api/v4/account/basic/get_account_info", {
      headers: {
        Cookie: cookie,
        "User-Agent": MOBILE_UA,
        Referer: "https://shopee.co.id/",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    const d = await res.json().catch(() => null);
    const data = d?.data;
    if (!data || Number(d?.error ?? -1) !== 0) return null;
    const uid = String(data.userid ?? data.user_id ?? "");
    if (!uid) return null;
    return {
      uid,
      username: String(data.username ?? ""),
      shopId: String(data.shopid ?? ""),
      isSeller: Boolean(data.is_seller),
    };
  } catch {
    return null;
  }
}

/** Fetch JSON ke API internal Shopee memakai cookie host. */
export async function cookieFetch(
  rawCookie: string,
  url: string,
  init?: { method?: string; body?: unknown; referer?: string }
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const cookie = normalizeCookie(rawCookie);
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        Cookie: cookie,
        "User-Agent": MOBILE_UA,
        Referer: init?.referer ?? "https://live.shopee.co.id/",
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        "x-api-source": "pc",
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Cek apakah cookie masih valid (dipakai job pemantau). */
export async function cookieStillValid(rawCookie: string): Promise<boolean> {
  return (await verifyCookie(rawCookie)) !== null;
}

/**
 * Metrik live yang BISA diambil server-side untuk akun cookie/affiliate.
 * Endpoint detail live (gmv/order/keranjang) diblokir anti-scraping Shopee
 * (error 90309999), tapi endpoint publik `shop_page/live/ongoing` memberi
 * jumlah penonton (view_count) — itu yang disinkronkan.
 *
 * Return null bila host tidak sedang live atau session_id tak cocok.
 */
export async function getCookieLiveMetrics(
  uid: string,
  expectSessionId?: string
): Promise<{ sessionId: string; viewers: number; title: string; startTime: number } | null> {
  if (!uid) return null;
  try {
    const res = await fetch(
      `https://live.shopee.co.id/api/v1/shop_page/live/ongoing?uid=${encodeURIComponent(uid)}&_=${Date.now()}`,
      {
        headers: {
          "User-Agent": MOBILE_UA,
          Accept: "application/json",
          Referer: "https://shopee.co.id/",
        },
        signal: AbortSignal.timeout(10000),
      }
    );
    const d = await res.json().catch(() => null);
    const live = d?.data?.ongoing_live;
    if (!live || !live.session_id) return null;
    const sessionId = String(live.session_id);
    if (expectSessionId && sessionId !== expectSessionId) return null;
    return {
      sessionId,
      viewers: Number(live.view_count) || 0,
      title: String(live.title ?? ""),
      startTime: Number(live.start_time) || 0,
    };
  } catch {
    return null;
  }
}
