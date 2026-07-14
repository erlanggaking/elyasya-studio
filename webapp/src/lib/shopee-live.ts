/**
 * Deteksi live Shopee publik (tanpa OAuth) — dipakai fitur "setup link sekali":
 *  - resolveShareLink : link share (termasuk short link id.shp.ee) → session id + uid
 *  - probeOngoing     : cek live yang sedang berjalan milik uid (polling panel)
 *  - uidFromShop      : mapping shop_id OAuth → uid pemilik (get_shop_base)
 *
 * Catatan: endpoint session detail live.shopee.co.id diblokir anti-bot untuk
 * server, tapi shop_page/live/* dan get_shop_base terbuka (diverifikasi).
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<{ text: string; finalUrl: string } | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9",
      },
    });
    return { text: await res.text(), finalUrl: res.url || url };
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://shopee.co.id/" },
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Resolve link share live → { sessionId, uid }. Menangani:
 *  - link langsung: live.shopee.co.id/share?session=123&share_user_id=456
 *  - short link (id.shp.ee/xxx): target URL tertanam di HTML interstitial
 *    dalam bentuk ter-encode (session%3D123 ... share_user_id%3D456).
 */
export async function resolveShareLink(
  raw: string
): Promise<{ sessionId: string | null; uid: string | null; finalUrl: string }> {
  const out: { sessionId: string | null; uid: string | null; finalUrl: string } = {
    sessionId: null,
    uid: null,
    finalUrl: raw,
  };

  const grab = (s: string) => {
    const sess =
      s.match(/session(?:%3D|=)(\d{4,})/i) ?? s.match(/\/live\/(\d{4,})/i);
    const uid = s.match(/share_user_id(?:%3D|=)(\d{4,})/i) ?? s.match(/[?&]uid=(\d{4,})/i);
    if (sess && !out.sessionId) out.sessionId = sess[1];
    if (uid && !out.uid) out.uid = uid[1];
  };

  grab(raw);
  if (out.sessionId && out.uid) return out;

  const page = await fetchText(raw);
  if (page) {
    out.finalUrl = page.finalUrl;
    grab(page.finalUrl);
    grab(page.text);
  }
  return out;
}

/** Cari URL stream playable (.flv/.m3u8) di mana pun dalam objek. */
export function findPlayUrl(node: unknown, depth = 0, seen = new Set<object>()): string {
  if (!node || depth > 6) return "";
  if (typeof node === "string") {
    return /^https?:\/\/[^ ]+\.(flv|m3u8)(\?|$)/i.test(node) ? node : "";
  }
  if (typeof node !== "object" || seen.has(node as object)) return "";
  seen.add(node as object);
  const entries = Object.entries(node as Record<string, unknown>);
  // Prioritaskan field bernama *play*
  for (const [k, v] of entries) {
    if (/play/i.test(k)) {
      const r = findPlayUrl(v, depth + 1, seen);
      if (r) return r;
    }
  }
  for (const [, v] of entries) {
    const r = findPlayUrl(v, depth + 1, seen);
    if (r) return r;
  }
  return "";
}

/**
 * Cek live yang sedang berjalan milik uid. Return session id (+ play url bila
 * ikut terbawa). Respons: { err_code: 0, data: { ongoing_live: null | {...} } }
 */
export async function probeOngoing(
  uid: string
): Promise<{ sessionId: string; title: string; playUrl: string } | null> {
  if (!uid) return null;
  const d = await fetchJson(
    `https://live.shopee.co.id/api/v1/shop_page/live/ongoing?uid=${encodeURIComponent(uid)}`
  );
  const data = d?.data as Record<string, unknown> | undefined;
  const live = data?.ongoing_live as Record<string, unknown> | null | undefined;
  if (!live || typeof live !== "object") return null;

  // Cari field session id di mana pun dalam objek (bentuk pasti belum
  // terdokumentasi — tahan-bentuk).
  let sessionId = "";
  const walk = (node: unknown, depth: number) => {
    if (sessionId || depth > 4 || !node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (/^(session_?id)$/i.test(k) && (typeof v === "number" || typeof v === "string")) {
        sessionId = String(v);
        return;
      }
      walk(v, depth + 1);
    }
  };
  walk(live, 0);
  if (!sessionId) return null;
  const title = String(
    (live.title as string) ?? (live.name as string) ?? ""
  );
  return { sessionId, title, playUrl: findPlayUrl(live) };
}

/** Mapping shop_id → uid pemilik shop (dipakai fallback saat setup). */
export async function uidFromShop(shopId: string): Promise<string | null> {
  if (!shopId) return null;
  const d = await fetchJson(
    `https://shopee.co.id/api/v4/shop/get_shop_base?shopid=${encodeURIComponent(shopId)}`
  );
  const data = d?.data as Record<string, unknown> | undefined;
  const uid = data?.userid;
  return uid != null ? String(uid) : null;
}
