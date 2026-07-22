/**
 * Elyasya-Studio — eksekutor "kontrol via cookie".
 *
 * Menjalankan perintah dari dashboard (add/remove/pin item, fetch metrik) di
 * dalam browser host memakai cookie host (credentials: "include"). Endpoint
 * internal live Shopee TIDAK terdokumentasi, jadi dipakai dua sumber:
 *   1. Template "hasil belajar" (learnedEndpoints) — direkam dari trafik live
 *      asli saat host/operator mengelola keranjang di halaman Shopee Live.
 *   2. Template default (fallback) — tebakan berbasis pola API v1 publik.
 * Setiap hasil (termasuk error mentah dari Shopee) dilaporkan balik supaya
 * bisa didiagnosa & endpoint dikoreksi tanpa ubah kode.
 */

// Fallback default — kemungkinan perlu dikoreksi dari trafik asli (learned).
const DEFAULT_ENDPOINTS = {
  add_item: {
    method: "POST",
    url_template: "https://live.shopee.co.id/api/v1/session/{session_id}/items",
    body_template: '{"item_list":{item_list}}',
  },
  remove_item: {
    method: "POST",
    url_template: "https://live.shopee.co.id/api/v1/session/{session_id}/items/delete",
    body_template: '{"item_list":[{"item_id":{item_id},"shop_id":{shop_id}}]}',
  },
  show_item: {
    method: "POST",
    url_template: "https://live.shopee.co.id/api/v1/session/{session_id}/show_item",
    body_template: '{"item_id":{item_id},"shop_id":{shop_id}}',
  },
  metrics: {
    method: "GET",
    url_template: "https://live.shopee.co.id/api/v1/session/{session_id}",
    body_template: "",
  },
};

function pick(endpoints, action) {
  const learned = (endpoints || []).find((e) => e.action === action);
  return learned || DEFAULT_ENDPOINTS[action] || null;
}

function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{(\w+)\}/g, (m, k) =>
    k in vars ? (typeof vars[k] === "string" ? vars[k] : JSON.stringify(vars[k])) : m
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// Cari angka pertama untuk key yang cocok, di mana pun dalam objek.
function findNum(node, keyRe, depth = 0, seen = new Set()) {
  if (!node || typeof node !== "object" || depth > 6 || seen.has(node)) return 0;
  seen.add(node);
  for (const k in node) {
    if (keyRe.test(k)) {
      const n = Number(node[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  for (const k in node) {
    const r = findNum(node[k], keyRe, depth + 1, seen);
    if (r) return r;
  }
  return 0;
}

/** Ekstrak metrik selengkap mungkin dari respons sesi live (tahan-bentuk). */
export function parseLiveMetrics(...nodes) {
  const out = {
    ccu: 0, views: 0, likes: 0, comments: 0, shares: 0,
    gmv: 0, orders: 0, atc: 0, peak_ccu: 0,
  };
  for (const node of nodes) {
    if (!node) continue;
    out.ccu = Math.max(out.ccu, findNum(node, /^(ccu|viewer|online_count|member_cnt)/i));
    out.views = Math.max(out.views, findNum(node, /^(view_count|views|total_view|pv)/i));
    out.likes = Math.max(out.likes, findNum(node, /^(like_cnt|likes|total_like)/i));
    out.comments = Math.max(out.comments, findNum(node, /^(comment_cnt|comments|total_comment)/i));
    out.shares = Math.max(out.shares, findNum(node, /^(share_cnt|shares)/i));
    out.gmv = Math.max(out.gmv, findNum(node, /^(gmv|total_gmv|placed_gmv|confirmed_gmv)/i));
    out.orders = Math.max(out.orders, findNum(node, /^(order|orders|order_cnt|placed_order)/i));
    out.atc = Math.max(out.atc, findNum(node, /^(atc|add_to_cart|add_cart)/i));
    out.peak_ccu = Math.max(out.peak_ccu, findNum(node, /^(peak_ccu|max_ccu|peak_view)/i));
  }
  return out;
}

async function authedFetch(url, method, body) {
  const headers = {
    Accept: "application/json",
    "X-Requested-With": "XMLHttpRequest",
    "X-API-SOURCE": "pc",
    "X-Shopee-Language": "id",
  };
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers,
    body: body != null ? body : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, ok: res.ok, json, text: text.slice(0, 500) };
}

/**
 * Eksekusi satu perintah. Balikan { ok, data?, error? } untuk dilaporkan ke
 * server. `endpoints` = template hasil belajar dari server.
 */
export async function executeCommand(cmd, endpoints) {
  const sessionId = String(cmd.session_id || cmd.payload?.session_id || "");
  if (!sessionId) return { ok: false, error: "session_id kosong" };

  try {
    if (cmd.type === "add_items") {
      const ep = pick(endpoints, "add_item");
      const list = cmd.payload?.item_list || [];
      const url = fillTemplate(ep.url_template, { session_id: sessionId });
      const body = ep.body_template
        ? fillTemplate(ep.body_template, { session_id: sessionId, item_list: list })
        : null;
      const r = await authedFetch(url, ep.method || "POST", body);
      return interpret(r);
    }

    if (cmd.type === "remove_item" || cmd.type === "pin_item") {
      const action = cmd.type === "remove_item" ? "remove_item" : "show_item";
      const ep = pick(endpoints, action);
      const item = cmd.payload?.item || {};
      const vars = { session_id: sessionId, item_id: num(item.item_id), shop_id: num(item.shop_id) };
      const url = fillTemplate(ep.url_template, vars);
      const body = ep.body_template ? fillTemplate(ep.body_template, vars) : null;
      const r = await authedFetch(url, ep.method || "POST", body);
      return interpret(r);
    }

    if (cmd.type === "fetch_metrics") {
      const ep = pick(endpoints, "metrics");
      const detailUrl = fillTemplate(ep.url_template, { session_id: sessionId });
      const [detail, play] = await Promise.all([
        authedFetch(detailUrl, ep.method || "GET", null),
        authedFetch(
          `https://live.shopee.co.id/api/v1/session/${sessionId}/play_url`,
          "GET",
          null
        ),
      ]);
      const metrics = parseLiveMetrics(detail.json, play.json);
      return { ok: true, data: metrics };
    }

    return { ok: false, error: `type tidak dikenal: ${cmd.type}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "fetch error" };
  }
}

function interpret(r) {
  const code = r.json?.err_code ?? r.json?.error ?? (r.ok ? 0 : r.status);
  if (r.ok && (code === 0 || code === undefined)) {
    return { ok: true, data: r.json?.data ?? {} };
  }
  return {
    ok: false,
    error: `Shopee err_code=${code} status=${r.status} ${r.json?.err_msg ?? r.json?.message ?? r.text ?? ""}`.trim(),
  };
}

export { DEFAULT_ENDPOINTS };
