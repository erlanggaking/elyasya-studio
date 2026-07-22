/**
 * Elyasya-Studio — Livestream capture (live.shopee.co.id)
 *
 * Merekam sesi live yang dibuka user: nama streamer, judul, viewer, like,
 * komentar, dan daftar produk yang dijual. Data respons ditangkap via dua
 * jalur (keduanya sudah aktif dari Fase 1):
 *   1. DevTools Protocol → pesan NET_CAPTURE dari background
 *   2. Intercept fetch/XHR MAIN world (injected.js) → window "message"
 * Parsing dibuat tahan-bentuk karena struktur endpoint live bisa berbeda-beda.
 */
(function () {
  if (!/(^|\.)live\.shopee\.co\.id$/i.test(location.hostname)) return;

  const SOURCE = "elyasya-studio";
  const IMG_BASE = "https://cf.shopee.co.id/file/";

  // Akumulasi per session_id selama tab live terbuka.
  const sessions = new Map();
  let flushTimer = null;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function img(raw) {
    if (!raw) return null;
    return String(raw).startsWith("http") ? raw : `${IMG_BASE}${raw}`;
  }

  function sessionIdFromPage() {
    const m = location.pathname.match(/\/share\?.*?from_source|\/(\d+)(?:\?|$)/);
    const m2 = location.href.match(/session[_=/](\d+)/i) || location.pathname.match(/(\d{6,})/);
    return (m2 && m2[1]) || (m && m[1]) || null;
  }

  // Cari objek "mirip room" di mana pun dalam JSON.
  function findRoomInfo(node, depth = 0, seen = new Set()) {
    if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return null;
    seen.add(node);
    const hasRoom =
      node.session_id != null ||
      node.sessionId != null ||
      node.room_id != null ||
      (node.streamer_username != null || node.nickname != null) &&
        (node.title != null || node.name != null);
    if (hasRoom && (node.session_id != null || node.sessionId != null || node.room_id != null)) {
      return node;
    }
    for (const k in node) {
      const r = findRoomInfo(node[k], depth + 1, seen);
      if (r) return r;
    }
    return null;
  }

  // Cari URL stream playable (.flv/.m3u8) di mana pun dalam JSON — dipakai
  // player panel dashboard (partner API tidak memberi URL yang valid untuk
  // live yang disiarkan dari aplikasi HP).
  function findPlayUrl(node, depth = 0, seen = new Set()) {
    if (!node || depth > 9) return null;
    if (typeof node === "string") {
      if (/^https?:\/\/[^ ]+\.(flv|m3u8)(\?|$)/i.test(node)) return node;
      return null;
    }
    if (typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    // Prioritaskan field bernama *play*
    for (const k in node) {
      if (/play/i.test(k)) {
        const r = findPlayUrl(node[k], depth + 1, seen);
        if (r) return r;
      }
    }
    for (const k in node) {
      const r = findPlayUrl(node[k], depth + 1, seen);
      if (r) return r;
    }
    return null;
  }

  // Cari array produk (punya itemid + price/name).
  function findProductArrays(node, depth = 0, seen = new Set(), out = []) {
    if (!node || typeof node !== "object" || depth > 9 || seen.has(node)) return out;
    seen.add(node);
    if (Array.isArray(node)) {
      const looksProduct = (o) =>
        o && typeof o === "object" &&
        (o.item_id != null || o.itemid != null || o.itemId != null) &&
        (o.price != null || o.name != null || o.product_name != null || o.price_info != null);
      const hits = node.filter(looksProduct).length;
      if (hits >= Math.max(1, Math.floor(node.length * 0.5))) {
        out.push(node);
        return out;
      }
      for (const el of node) findProductArrays(el, depth + 1, seen, out);
      return out;
    }
    for (const k in node) findProductArrays(node[k], depth + 1, seen, out);
    return out;
  }

  function mapLiveProduct(o) {
    const item_id = o.item_id ?? o.itemid ?? o.itemId;
    if (item_id == null) return null;
    const priceInfo = o.price_info ?? {};
    const price = num(
      o.price ?? priceInfo.price ?? o.price_min ?? o.discount_price ?? priceInfo.discount_price
    );
    const before = num(o.price_before_discount ?? priceInfo.price_before_discount ?? o.origin_price);
    const disc =
      before > 0 && price > 0 && before > price
        ? Math.round(((before - price) / before) * 100)
        : num(o.raw_discount ?? o.discount ?? 0) || null;
    return {
      item_id: String(item_id),
      shop_id: String(o.shop_id ?? o.shopid ?? "0"),
      name: String(o.name ?? o.product_name ?? o.title ?? "Produk"),
      image_url: img(o.image ?? o.cover ?? o.image_url),
      price: price >= 100000 ? Math.round(price / 100000) : price,
      price_before_discount: before ? (before >= 100000 ? Math.round(before / 100000) : before) : null,
      discount_pct: disc,
      sold: num(o.sold ?? o.historical_sold ?? o.item_sold ?? 0),
      stock: o.stock != null ? num(o.stock) : null,
    };
  }

  function ingest(body) {
    if (!body || typeof body !== "object") return;
    const data = body.data ?? body;

    const room = findRoomInfo(data);
    const sid = String(
      room?.session_id ?? room?.sessionId ?? room?.room_id ?? sessionIdFromPage() ?? ""
    ).trim();
    if (!sid) return;

    let rec = sessions.get(sid);
    if (!rec) {
      rec = {
        session_id: sid,
        streamer_name: "—",
        title: "Live Session",
        cover_url: null,
        viewers: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        url: location.href,
        play_url: "",
        products: new Map(),
      };
      sessions.set(sid, rec);
    }

    const playUrl = findPlayUrl(data);
    if (playUrl) rec.play_url = playUrl;

    if (room) {
      rec.streamer_name =
        room.streamer_username ?? room.nickname ?? room.username ?? rec.streamer_name;
      rec.title = room.title ?? room.name ?? rec.title;
      rec.cover_url = img(room.cover ?? room.cover_pic ?? room.images?.[0]) ?? rec.cover_url;
      rec.viewers = Math.max(rec.viewers, num(room.ccu ?? room.viewers ?? room.online_count ?? room.member_cnt));
      rec.likes = Math.max(rec.likes, num(room.like_cnt ?? room.likes ?? room.total_like));
      rec.comments = Math.max(rec.comments, num(room.comment_cnt ?? room.comments ?? room.total_comment));
      rec.shares = Math.max(rec.shares, num(room.share_cnt ?? room.shares));
    }

    for (const arr of findProductArrays(data)) {
      for (const o of arr) {
        const p = mapLiveProduct(o);
        if (p) rec.products.set(`${p.shop_id}-${p.item_id}`, p);
      }
    }

    scheduleFlush();
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 3000);
  }

  function flush() {
    const payload = [...sessions.values()]
      .filter((s) => s.products.size > 0 || s.streamer_name !== "—" || s.play_url)
      .map((s) => ({
        session_id: s.session_id,
        streamer_name: s.streamer_name,
        title: s.title,
        cover_url: s.cover_url,
        viewers: s.viewers,
        likes: s.likes,
        comments: s.comments,
        shares: s.shares,
        url: s.url,
        play_url: s.play_url,
        products: [...s.products.values()],
      }));
    if (payload.length === 0) return;
    try {
      chrome.runtime.sendMessage({ type: "LIVE_CAPTURE", sessions: payload }).catch(() => {});
    } catch {
      /* background belum siap */
    }
  }

  // Jalur 1: DevTools Protocol
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "NET_CAPTURE") ingest(msg.body);
  });

  // Jalur 2: intercept fetch/XHR (injected.js MAIN world)
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== SOURCE || d.type !== "fetch") return;
    ingest(d.body);
    learnEndpoint(d.url, d.requestBody);
  });

  // --- Pembelajaran endpoint kontrol keranjang -------------------------------
  // Saat host/operator mengelola keranjang di halaman Shopee Live, request
  // add/pin/remove item asli lewat sini. Rekam templatenya (URL + bentuk body)
  // supaya dashboard bisa me-replay perintah lewat cookie. Endpoint internal
  // Shopee tak terdokumentasi — ini bikin fitur tahan-perubahan.
  const learned = new Set();

  function classifyAction(url) {
    const u = url.toLowerCase();
    if (!/live\.shopee\.co\.id|shopee\.co\.id/.test(u)) return null;
    if (/show[_-]?item|pin[_-]?item|highlight/.test(u)) return "show_item";
    if (/(delete|remove).*item|item.*(delete|remove)/.test(u)) return "remove_item";
    if (/add.*item|item.*add|(^|\/)items?(\/|\?|$)/.test(u)) return "add_item";
    return null;
  }

  function templatize(str, sessionId) {
    let out = String(str);
    if (sessionId) out = out.split(sessionId).join("{session_id}");
    return out;
  }

  function learnEndpoint(url, requestBody) {
    try {
      if (!url || typeof url !== "string") return;
      const action = classifyAction(url);
      if (!action) return;
      // Hanya request tulis (punya body) yang berguna untuk replay.
      if (action !== "add_item" && !requestBody) return;

      const sid = sessionIdFromPage() || String(url.match(/(\d{6,})/)?.[1] || "");
      const urlTemplate = templatize(url.split("?")[0], sid);

      let bodyTemplate = "";
      let sampleBody = requestBody ?? {};
      if (requestBody && typeof requestBody === "object") {
        let json = JSON.stringify(requestBody);
        // Ganti nilai item_id/shop_id numerik dgn placeholder.
        json = json
          .replace(/("item_id"\s*:\s*)\d+/g, "$1{item_id}")
          .replace(/("itemid"\s*:\s*)\d+/g, "$1{item_id}")
          .replace(/("shop_id"\s*:\s*)\d+/g, "$1{shop_id}")
          .replace(/("shopid"\s*:\s*)\d+/g, "$1{shop_id}");
        if (sid) json = json.split(sid).join("{session_id}");
        // Bila ada array item, jadikan {item_list} untuk add banyak sekaligus.
        if (action === "add_item") {
          json = json.replace(/\[[^[\]]*\{item_id\}[^[\]]*\]/, "{item_list}");
        }
        bodyTemplate = json;
      }

      const key = `${action}|${urlTemplate}`;
      if (learned.has(key)) return;
      learned.add(key);

      const endpoint = {
        action,
        method: requestBody ? "POST" : "GET",
        url_template: urlTemplate,
        body_template: bodyTemplate,
        sample_body: sampleBody,
      };
      chrome.runtime.sendMessage({ type: "LIVE_LEARN_ENDPOINT", endpoint }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  // Nyalakan capture DevTools Protocol untuk tab live ini.
  try {
    chrome.runtime.sendMessage({ type: "ENABLE_CAPTURE" }).catch(() => {});
  } catch {
    /* ok */
  }

  // Flush terakhir saat tab ditutup.
  window.addEventListener("beforeunload", flush);
})();
