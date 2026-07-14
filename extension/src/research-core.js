/**
 * Elyasya-Studio — Research engine (parse, stats, pagination)
 */
window.ElyasyaResearch = (function () {
  const IMG_BASE = "https://down-id.img.susercontent.com/file/";

  const state = {
    keyword: "",
    products: new Map(),
    pagesLoaded: 0,
    loadedOffsets: new Set(),
    lastRequest: null,
    lastSearchUrl: "",
    // Request offer-list affiliate terakhir yang tertangkap — dipakai tombol
    // "halaman selanjutnya" untuk me-replay dengan nomor halaman berikutnya.
    lastAffiliateCapture: null,
    hasMore: true,
    loading: false,
    apiCaptured: false,
  };

  // Keyword default portal affiliate saat tidak ada pencarian aktif (feed
  // "Penawaran Produk"). Dianggap wildcard: tidak pernah me-reset hasil
  // pencarian yang sedang berjalan.
  const AFFILIATE_DEFAULT_KW = "penawaran-affiliate";

  function normPrice(raw) {
    const n = Number(raw) || 0;
    if (n >= 1_000_000) return Math.round(n / 100_000);
    return Math.round(n);
  }

  function parseCommissionRate(raw) {
    if (raw == null || raw === "") return 0;
    const n =
      typeof raw === "string"
        ? parseFloat(raw.replace("%", "").replace(",", ".").trim())
        : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n > 0 && n < 1) return Math.round(n * 10000) / 100;
    if (n >= 100) return n / 100;
    return n;
  }

  function monthsSince(ctime) {
    if (!ctime) return 12;
    const ageSec = Date.now() / 1000 - Number(ctime);
    return Math.max(1, ageSec / (30 * 24 * 3600));
  }

  function parseRatingCount(ratingObj, basic, raw) {
    const rc =
      ratingObj?.rating_count ??
      ratingObj?.rcount ??
      basic?.rating_count ??
      raw?.rating_count ??
      basic?.cmt_count ??
      raw?.cmt_count;
    if (Array.isArray(rc)) {
      const total = Number(rc[0]);
      if (Number.isFinite(total) && total > 0) return total;
      const sum = rc.slice(1).reduce((s, v) => s + (Number(v) || 0), 0);
      return sum > 0 ? sum : 0;
    }
    const n = Number(rc);
    return Number.isFinite(n) ? n : 0;
  }

  function parseSold30d(basic, raw, soldTotal, months) {
    const display =
      basic.item_card_display_sold_count ??
      raw.item_card_display_sold_count ??
      basic.display_sold_count ??
      raw.display_sold_count;
    if (display && typeof display === "object") {
      const monthly = Number(display.monthly_sold_count ?? display.monthly_sold);
      if (monthly > 0) return monthly;
    }

    const sold = Number(basic.sold ?? raw.sold ?? 0);
    if (sold > 0) return sold;

    if (soldTotal > 0) {
      return Math.max(1, Math.round(soldTotal / months));
    }
    return 0;
  }

  function parseStock(basic, raw) {
    const hide = Boolean(basic.is_hide_stock ?? raw.is_hide_stock);
    const stock = Number(
      basic.stock ??
        basic.normal_stock ??
        raw.stock ??
        basic.stock_info?.total_stock ??
        raw.stock_info?.total_stock ??
        0
    );
    if (hide && stock <= 1) return null;
    return stock > 0 ? stock : null;
  }

  function getTotalCount(body) {
    if (!body || typeof body !== "object") return null;
    const n = Number(
      body.total_count ??
        body.data?.total_count ??
        body.data?.total ??
        body.ori_total_count ??
        null
    );
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  function getNoMore(body) {
    if (!body || typeof body !== "object") return false;
    return Boolean(body.nomore ?? body.data?.no_more ?? body.data?.nomore);
  }

  let fetchSeq = 0;

  function mainWorldFetch(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const id = `elyasya-fetch-${Date.now()}-${++fetchSeq}`;
      const timer = setTimeout(() => {
        window.removeEventListener("message", onMsg);
        reject(new Error("Timeout memuat halaman"));
      }, 12000);

      function onMsg(event) {
        const data = event.data;
        if (
          !data ||
          data.source !== "elyasya-studio" ||
          data.type !== "elyasya-fetch-result" ||
          data.id !== id
        ) {
          return;
        }
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
        if (!data.ok) {
          reject(new Error(data.error || `HTTP ${data.status ?? "error"}`));
          return;
        }
        try {
          resolve(JSON.parse(data.text));
        } catch {
          reject(new Error("Response bukan JSON"));
        }
      }

      window.addEventListener("message", onMsg);
      window.postMessage(
        {
          source: "elyasya-studio",
          type: "elyasya-fetch",
          id,
          url,
          method: opts.method || "GET",
          body: opts.body ?? null,
          headers: opts.headers || {
            Accept: "application/json",
            "X-API-SOURCE": "pc",
            "X-Shopee-Language": "id",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
        "*"
      );
    });
  }

  async function directFetchSearch(url) {
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-API-SOURCE": "pc",
          "X-Shopee-Language": "id",
          "X-Requested-With": "XMLHttpRequest",
        },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function fetchSearchData(req) {
    try {
      return await mainWorldFetch(req.url);
    } catch {
      return directFetchSearch(req.url);
    }
  }

  function mapSearchItem(raw) {
    // Affiliate offer list membungkus data produk di batch_item_for_item_card_full,
    // sedangkan komisi ada di level luar (raw.seller_commission_rate).
    const basic =
      raw.batch_item_for_item_card_full ??
      raw.item_basic ??
      raw.item_data ??
      raw.item ??
      raw;
    const itemId =
      basic.itemid ??
      basic.item_id ??
      basic.itemId ??
      raw.itemid ??
      raw.item_id ??
      raw.itemId ??
      raw.item_data?.itemid ??
      raw.item_data?.item_id;
    const shopId =
      basic.shopid ??
      basic.shop_id ??
      basic.shopId ??
      raw.shopid ??
      raw.shop_id ??
      raw.shopId ??
      raw.item_data?.shopid ??
      raw.item_data?.shop_id;
    if (!itemId || !shopId) return null;

    const priceRaw =
      basic.item_card_display_price?.price ??
      basic.item_card_display_price?.price_min ??
      basic.price_min ??
      basic.priceMin ??
      basic.price ??
      raw.price_min ??
      raw.priceMin ??
      raw.price ??
      0;
    const price = normPrice(priceRaw);
    const soldTotal = Number(
      basic.historical_sold ??
        raw.historical_sold ??
        basic.global_sold_count ??
        raw.global_sold_count ??
        basic.item_card_display_sold_count?.display_sold_count ??
        basic.item_card_display_sold_count?.historical_sold_count ??
        basic.sales ??
        raw.sales ??
        basic.sold_count ??
        raw.sold_count ??
        0
    );
    const ctime = basic.ctime ?? raw.ctime ?? null;
    const months = monthsSince(ctime);
    const soldMonthly =
      soldTotal > 0 ? Math.max(1, Math.round(soldTotal / months)) : 0;
    const sold30d = parseSold30d(basic, raw, soldTotal, months);
    const ratingObj = basic.item_rating ?? raw.item_rating ?? {};
    const rating = Number(
      ratingObj.rating_star ??
        basic.rating_star ??
        basic.ratingStar ??
        raw.rating_star ??
        raw.ratingStar ??
        0
    );
    const reviews = parseRatingCount(ratingObj, basic, raw);
    const stock = parseStock(basic, raw);
    const rawImg = basic.image ?? basic.image_url ?? basic.imageUrl ?? raw.image ?? raw.image_url ?? raw.imageUrl ?? "";
    const imageUrl = rawImg
      ? rawImg.startsWith("http")
        ? rawImg
        : `${IMG_BASE}${rawImg}`
      : "";

    const aff = raw.affiliate_info ?? basic.affiliate_info;
    const commRate = parseCommissionRate(
      aff?.commission_rate ??
        raw.seller_commission_rate ??
        raw.default_commission_rate ??
        raw.commission_rate ??
        raw.commissionRate ??
        basic.commission_rate ??
        basic.commissionRate ??
        basic.default_commission_rate ??
        0
    );

    const isMall = Boolean(basic.is_official_shop ?? raw.is_official_shop);
    const isStar = Boolean(basic.shopee_verified ?? raw.shopee_verified);
    const isAds = Boolean(raw.adsid ?? raw.ads_id ?? basic.adsid);

    const monthlyRevenue = Math.round(soldMonthly * price);
    const revenue30d = Math.round(sold30d * price);
    const totalRevenue = Math.round(soldTotal * price);
    const trend =
      soldMonthly > 0
        ? Math.round(((sold30d - soldMonthly) / soldMonthly) * 10000) / 100
        : sold30d > 0
          ? 100
          : 0;

    return {
      key: `${shopId}-${itemId}`,
      itemId: String(itemId),
      shopId: String(shopId),
      name: String(
        basic.name ??
          basic.product_name ??
          basic.productName ??
          basic.item_name ??
          raw.name ??
          raw.product_name ??
          raw.productName ??
          "Produk"
      ),
      shopName: String(basic.shop_name ?? basic.shopName ?? raw.shop_name ?? raw.shopName ?? ""),
      shopLocation: String(basic.shop_location ?? raw.shop_location ?? ""),
      imageUrl,
      price,
      soldTotal,
      sold30d,
      soldMonthly,
      rating,
      reviews,
      stock,
      stockValue: stock != null ? price * stock : 0,
      ctime,
      createdLabel: ctime
        ? new Date(Number(ctime) * 1000).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })
        : "—",
      commissionRate: commRate,
      estimatedCommission: commRate > 0 ? Math.round((price * commRate) / 100) : 0,
      monthlyRevenue,
      revenue30d,
      totalRevenue,
      trend,
      isMall,
      isStar,
      isAds,
      isAffiliate: commRate > 0,
    };
  }

  function extractItems(body) {
    if (!body || typeof body !== "object") return [];
    const lists = [];

    if (Array.isArray(body.items)) lists.push(body.items);

    const data = body.data ?? body;

    if (Array.isArray(data.items)) lists.push(data.items);
    if (Array.isArray(data.products)) lists.push(data.products);
    // Affiliate portal (affiliate.shopee.co.id) — list produk sudah membawa komisi.
    if (Array.isArray(data.offers)) lists.push(data.offers);
    if (Array.isArray(data.product_list)) lists.push(data.product_list);
    if (Array.isArray(data.productOfferV2?.nodes)) lists.push(data.productOfferV2.nodes);
    if (Array.isArray(data.units)) {
      for (const unit of data.units) {
        if (Array.isArray(unit?.items)) lists.push(unit.items);
        if (unit?.item) lists.push([unit.item]);
      }
    }

    if (Array.isArray(data.sections)) {
      for (const sec of data.sections) {
        const items = sec?.data?.item ?? sec?.items ?? sec?.data?.items;
        if (Array.isArray(items)) lists.push(items);
        else if (items && typeof items === "object") lists.push([items]);
      }
    }

    if (Array.isArray(data.list)) lists.push(data.list);

    const products = [];
    for (const list of lists) {
      for (const item of list) {
        const mapped = mapSearchItem(item);
        if (mapped) products.push(mapped);
      }
    }

    // Fallback tahan-bentuk: kalau path yang dikenal kosong, telusuri seluruh
    // JSON untuk menemukan array objek yang "mirip produk" (portal affiliate
    // sering memakai struktur/endpoint tak terduga).
    if (products.length === 0) {
      for (const list of deepFindItemArrays(body)) {
        for (const item of list) {
          const mapped = mapSearchItem(item);
          if (mapped) products.push(mapped);
        }
      }
    }
    return products;
  }

  function looksLikeProduct(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    const id =
      o.itemid ?? o.item_id ?? o.itemId ??
      o.item_data?.itemid ?? o.item_data?.item_id ??
      o.item_basic?.itemid ?? o.item_basic?.item_id;
    if (id == null) return false;
    const signal =
      o.commission_rate ?? o.commissionRate ?? o.default_commission_rate ??
      o.seller_commission_rate ?? o.batch_item_for_item_card_full ??
      o.price ?? o.price_min ?? o.priceMin ?? o.item_card_display_price ??
      o.product_name ?? o.productName ?? o.name ?? o.item_basic ??
      o.sales ?? o.historical_sold;
    return signal != null;
  }

  function deepFindItemArrays(root, maxDepth = 8) {
    const found = [];
    const seen = new Set();
    function walk(node, depth) {
      if (depth > maxDepth || node == null || typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        const hits = node.filter(looksLikeProduct).length;
        if (hits >= Math.max(1, Math.floor(node.length * 0.5))) {
          found.push(node);
          return; // sudah array produk — jangan turun lebih dalam
        }
        for (const el of node) walk(el, depth + 1);
        return;
      }
      for (const k in node) walk(node[k], depth + 1);
    }
    walk(root, 0);
    return found;
  }

  function isAffiliatePage() {
    return /(^|\.)affiliate\.shopee\.co\.id$/i.test(location.hostname);
  }

  function isAffiliateOfferUrl(url) {
    const u = (url || "").toLowerCase();
    return (
      u.includes("offer/product/list") ||
      u.includes("offer/product_offer") ||
      u.includes("productofferv2") ||
      (u.includes("affiliate.shopee.co.id") && u.includes("/api/") && u.includes("offer"))
    );
  }

  function isSearchUrl(url) {
    const u = (url || "").toLowerCase();
    return (
      u.includes("search_items") ||
      u.includes("search_filter") ||
      u.includes("/search/search") ||
      u.includes("search?") ||
      isAffiliateOfferUrl(u) ||
      (u.includes("/search/") && u.includes("/api/"))
    );
  }

  function isPrimarySearchCapture(msg) {
    const url = (msg.url || "").toLowerCase();
    const items = extractItems(msg.body);
    if (items.length === 0) return false;

    if (url.includes("search_items")) return true;
    // Affiliate offer list: sudah pasti data komisi — terima apa adanya.
    if (isAffiliateOfferUrl(url)) return true;
    // Di portal affiliate, capture apa pun yang menghasilkan produk diterima.
    if (isAffiliatePage() && items.length > 0) return true;

    const pageKw = getKeywordFromPage().toLowerCase();
    const reqKw = String(
      msg.requestBody?.keyword ?? msg.requestBody?.query ?? ""
    ).toLowerCase();
    if (pageKw && reqKw && pageKw !== reqKw) return false;

    return items.length >= 20;
  }

  function updateHasMore(items, newest, limit, body) {
    const total = body ? getTotalCount(body) : null;
    const nomore = body ? getNoMore(body) : false;
    const fullPage = items.length >= Math.min(limit, 60) * 0.85;

    if (body && nomore) {
      state.hasMore = false;
      return;
    }
    if (body && total != null) {
      state.hasMore = newest + items.length < total;
      return;
    }
    if (!body || !fullPage) {
      // Data DOM / partial — masih ada halaman Shopee
      state.hasMore = true;
      return;
    }
    state.hasMore = true;
  }

  function buildSearchRequest(keyword, newest = 0, limit = 60) {
    const params = new URLSearchParams({
      by: "relevancy",
      keyword: keyword || "",
      limit: String(limit),
      newest: String(newest),
      order: "desc",
      page_type: "search",
      scenario: "PAGE_GLOBAL_SEARCH",
      version: "2",
    });
    const path = `/api/v4/search/search_items?${params}`;
    return {
      keyword,
      newest,
      limit,
      offset: newest,
      order: "desc",
      page_type: "search",
      scenario: "PAGE_GLOBAL_SEARCH",
      version: 2,
      by: "relevancy",
      path,
      url: `${location.origin}${path}`,
    };
  }

  function ingestProducts(items, meta = {}) {
    if (!items.length) return null;
    const keyword = meta.keyword || getKeywordFromPage();
    resetIfNewKeyword(keyword);

    const newest = Number(meta.newest ?? meta.offset ?? 0);
    // Selalu merge — mergeProducts sudah dedup per produk. Dulu capture dengan
    // offset yang pernah terlihat di-skip total, padahal portal affiliate
    // sering melaporkan offset 0 untuk semua halaman → halaman 2+ hilang.
    state.loadedOffsets.add(newest);
    mergeProducts(items);
    state.pagesLoaded = state.loadedOffsets.size;

    const limit = Number(meta.limit ?? items.length ?? 60);
    if (meta.url) state.lastSearchUrl = meta.url;
    state.lastRequest = meta.requestBody
      ? { ...meta.requestBody, newest, limit, offset: newest }
      : buildSearchRequest(state.keyword, newest, limit);

    updateHasMore(items, newest, limit, meta.body ?? null);

    return {
      added: items.length,
      pageCount: items.length,
      stats: computeStats(getProducts()),
      keyword: state.keyword,
    };
  }

  function scrapeFromDOM() {
    const products = [];
    const seen = new Set();

    const roots = [
      document.querySelector('[class*="shopee-search-item-result"]'),
      document.querySelector('[class*="search-result"]'),
      document.querySelector("#main"),
      document.querySelector("main"),
    ].filter(Boolean);
    const root = roots[0] || document.body;

    root.querySelectorAll('a[href*="-i."], a[href*="/product/"]').forEach((link) => {
      if (link.closest('[class*="related"], [class*="shop-recommend"], [class*="shop-search"]')) {
        return;
      }

      const href = link.getAttribute("href") || link.href || "";
      let shopId, itemId;
      const m1 = href.match(/-i\.(\d+)\.(\d+)/);
      const m2 = href.match(/product\/(\d+)\/(\d+)/);
      if (m1) { shopId = m1[1]; itemId = m1[2]; }
      else if (m2) { shopId = m2[1]; itemId = m2[2]; }
      else return;

      const key = `${shopId}-${itemId}`;
      if (seen.has(key)) return;
      seen.add(key);

      const card = link.closest("[data-sqe], li, div") || link.parentElement;
      const text = card?.textContent || "";
      // Harga dibaca sebagai grup ribuan agar tidak menelan digit lain yang
      // menempel tanpa spasi di teks kartu (mis. "Rp52.00010RB+ terjual").
      const priceMatch = text.match(/Rp\s*(\d{1,3}(?:\.\d{3})*)/);
      let price = 0;
      if (priceMatch) {
        price = Number(priceMatch[1].replace(/\./g, "")) || 0;
      }

      // Buang token harga dulu supaya angka terjual tidak tercampur digit harga.
      const soldText = text.replace(/Rp\s*\d{1,3}(?:\.\d{3})*/g, " ");
      const soldMatch =
        soldText.match(/(\d+(?:[.,]\d+)?)\s*(rb|jt|k)?\s*\+?\s*terjual/i) ||
        soldText.match(/terjual\s*(\d+(?:[.,]\d+)?)\s*(rb|jt|k)?/i);
      let soldTotal = 0;
      if (soldMatch) {
        soldTotal = Number(soldMatch[1].replace(/\./g, "").replace(",", ".")) || 0;
        const unit = (soldMatch[2] || "").toLowerCase();
        if (unit === "rb" || unit === "k") soldTotal *= 1000;
        if (unit === "jt") soldTotal *= 1_000_000;
      }

      const mapped = mapSearchItem({
        itemid: itemId,
        shopid: shopId,
        name: (link.getAttribute("title") || link.textContent || "Produk").trim().slice(0, 200),
        // DOM memberi harga rupiah asli; API memakai satuan-mikro (×100.000).
        // Skalakan agar normPrice memperlakukannya konsisten (fix harga ≥ Rp 1jt).
        price_min: price > 0 ? price * 100000 : 0,
        historical_sold: soldTotal,
      });
      if (mapped) products.push(mapped);
    });

    return products;
  }

  function clickShopeeNextPage() {
    const selectors = [
      ".shopee-page-controller__next:not(.shopee-icon-button--disabled)",
      ".shopee-page-controller .shopee-icon-button--right:not(.shopee-icon-button--disabled)",
      'button[aria-label="Next"]:not([disabled])',
      ".shopee-icon-button.shopee-icon-button--right:not(.shopee-icon-button--disabled)",
      // Portal affiliate memakai pagination antd
      ".ant-pagination-next:not(.ant-pagination-disabled) button",
      ".ant-pagination-next:not(.ant-pagination-disabled)",
      'li[title="Next Page"]:not(.ant-pagination-disabled)',
      'button[aria-label="Next page"]:not([disabled])',
      '[class*="pagination"] button[aria-label*="ext"]:not([disabled])',
    ];
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled && !btn.getAttribute("aria-disabled")) {
        btn.click();
        return true;
      }
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    return false;
  }

  function waitForMoreProducts(beforeCount, timeoutMs = 10000) {
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (state.products.size > beforeCount || Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(state.products.size > beforeCount);
        }
      }, 400);
    });
  }

  async function fetchSearchPage(newest = 0) {
    const keyword = getKeywordFromPage();
    if (!keyword) return null;

    const req = buildSearchRequest(keyword, newest, 60);
    try {
      const data = await fetchSearchData(req);
      if (!data) return null;
      const items = extractItems(data);
      if (items.length === 0) return null;

      return ingestProducts(items, {
        keyword,
        newest,
        limit: 60,
        url: req.path,
        requestBody: req,
        body: data,
      });
    } catch {
      return null;
    }
  }

  // Baca keyword dari kotak pencarian portal affiliate (SPA — nilai pencarian
  // tidak selalu masuk ke URL).
  function getAffiliateSearchInput() {
    try {
      const inputs = document.querySelectorAll(
        'input[type="search"], input[type="text"], input:not([type])'
      );
      for (const el of inputs) {
        const hint = (
          (el.getAttribute("placeholder") || "") +
          " " +
          (el.getAttribute("aria-label") || "")
        ).toLowerCase();
        const looksSearch = el.type === "search" || /cari|search|keyword|produk/.test(hint);
        if (!looksSearch) continue;
        const v = (el.value || "").trim();
        if (v) return v;
      }
    } catch {
      /* ok */
    }
    return "";
  }

  function getKeywordFromPage() {
    try {
      const u = new URL(location.href);
      const kw = (
        u.searchParams.get("keyword") ??
        u.searchParams.get("q") ??
        u.searchParams.get("search") ??
        ""
      ).trim();
      if (kw) return kw;
      if (isAffiliatePage()) {
        // Nilai kotak pencarian dulu; kalau kosong berarti feed penawaran biasa.
        const domKw = getAffiliateSearchInput();
        if (domKw) return domKw;
        return AFFILIATE_DEFAULT_KW;
      }
      return "";
    } catch {
      return "";
    }
  }

  function resetIfNewKeyword(keyword) {
    const kw = (keyword || getKeywordFromPage()).toLowerCase();
    if (!kw) return;
    // Capture tanpa keyword (feed/rekomendasi) jangan me-reset hasil pencarian
    // yang sedang aktif — merge saja ke kumpulan yang ada.
    if (kw === AFFILIATE_DEFAULT_KW && state.keyword && state.keyword !== kw) return;
    if (state.keyword && state.keyword !== kw) {
      state.products.clear();
      state.pagesLoaded = 0;
      state.loadedOffsets.clear();
      state.hasMore = true;
      state.lastRequest = null;
      state.lastAffiliateCapture = null;
      state.apiCaptured = false;
    }
    state.keyword = kw;
  }

  function mergeProductData(existing, incoming) {
    const pickNum = (a, b, higher = false) => {
      const na = Number(a) || 0;
      const nb = Number(b) || 0;
      if (higher) return nb > na ? nb : na;
      return nb > 0 ? nb : na;
    };
    const pickStr = (a, b) => (b && b !== "—" && b !== "Produk" ? b : a);
    return {
      ...existing,
      ...incoming,
      name: pickStr(existing.name, incoming.name),
      imageUrl: incoming.imageUrl || existing.imageUrl,
      price: pickNum(existing.price, incoming.price),
      soldTotal: pickNum(existing.soldTotal, incoming.soldTotal, true),
      sold30d: pickNum(existing.sold30d, incoming.sold30d, true),
      soldMonthly: pickNum(existing.soldMonthly, incoming.soldMonthly, true),
      rating: pickNum(existing.rating, incoming.rating, true),
      reviews: pickNum(existing.reviews, incoming.reviews, true),
      stock: incoming.stock != null ? incoming.stock : existing.stock,
      monthlyRevenue: pickNum(existing.monthlyRevenue, incoming.monthlyRevenue, true),
      revenue30d: pickNum(existing.revenue30d, incoming.revenue30d, true),
      totalRevenue: pickNum(existing.totalRevenue, incoming.totalRevenue, true),
      trend: Number.isFinite(incoming.trend) ? incoming.trend : existing.trend,
      commissionRate:
        incoming.commissionRate > 0 ? incoming.commissionRate : existing.commissionRate,
      estimatedCommission:
        incoming.estimatedCommission > 0
          ? incoming.estimatedCommission
          : existing.estimatedCommission,
      isMall: incoming.isMall || existing.isMall,
      isStar: incoming.isStar || existing.isStar,
      isAds: incoming.isAds || existing.isAds,
      stockValue:
        (incoming.stock != null ? incoming.stock : existing.stock) != null
          ? (incoming.price || existing.price) *
            (incoming.stock != null ? incoming.stock : existing.stock)
          : 0,
    };
  }

  function mergeProducts(items) {
    let added = 0;
    for (const p of items) {
      if (!state.products.has(p.key)) {
        state.products.set(p.key, p);
        added += 1;
      } else {
        const merged = mergeProductData(state.products.get(p.key), p);
        state.products.set(p.key, merged);
      }
    }
    // Komisi yang ikut terbawa (mis. dari portal affiliate) dibagikan ke
    // cache lintas-tab agar tab shopee.co.id ikut kebagian.
    publishCommissions(items);
    return added;
  }

  // Scrape kartu produk langsung dari DOM portal affiliate (nama, harga,
  // "Komisi hingga X%", "N terjual"). Tidak bergantung pada intercept jaringan.
  function scrapeAffiliateDOM() {
    const byId = new Map();
    const links = document.querySelectorAll(
      'a[href*="/product/"], a[href*="/offer/product_offer/"]'
    );

    links.forEach((link) => {
      const href = link.getAttribute("href") || link.href || "";
      let shopId = "0";
      let itemId = "";
      let m = href.match(/\/product\/(\d+)\/(\d+)/);
      if (m) {
        shopId = m[1];
        itemId = m[2];
      } else {
        m = href.match(/\/offer\/product_offer\/(\d+)/);
        if (m) itemId = m[1];
      }
      if (!itemId) return;

      // Naik ke kontainer kartu (yang memuat harga + komisi).
      let card = link;
      for (let i = 0; i < 8 && card; i += 1) {
        const t = card.textContent || "";
        if (/Rp\s?[\d.]/.test(t) && /omisi/i.test(t)) break;
        card = card.parentElement;
      }
      const text = (card && card.textContent) || "";
      // Teks kartu menempel tanpa spasi ("Rp52.00010RB+ terjual"), jadi harga
      // harus dibaca sebagai grup ribuan (1-3 digit lalu .ddd) agar tidak
      // menelan digit awal jumlah terjual.
      const priceM = text.match(/Rp\s?(\d{1,3}(?:\.\d{3})*)/);
      const commM = text.match(/omisi[^%]*?([\d.,]+)\s*%/i);
      if (!priceM && !commM) return;

      const rec =
        byId.get(itemId) ||
        { itemId, shopId, name: "", price: 0, comm: 0, sold: 0 };
      if (shopId !== "0") rec.shopId = shopId;

      let linkText = (link.getAttribute("title") || link.textContent || "").trim();
      // Buang embel-embel kartu yang ikut menempel di teks link
      // ("…Rp52.00010RB+ terjualKomisi hingga 80%Buat Link").
      linkText = linkText
        .replace(/Rp\s?\d{1,3}(?:\.\d{3})*(?=[\s\S]*(?:terjual|omisi|Buat Link))[\s\S]*$/i, "")
        .replace(/(?:Komisi hingga|Buat Link)[\s\S]*$/i, "")
        .trim();
      if (linkText.length > rec.name.length && !/^Rp/i.test(linkText)) {
        rec.name = linkText.slice(0, 200);
      }
      if (priceM) rec.price = Number(priceM[1].replace(/\./g, "")) || rec.price;
      if (commM) rec.comm = parseFloat(commM[1].replace(",", ".")) || rec.comm;

      // Hapus semua token harga dulu supaya angka terjual tidak tercampur digit harga.
      const soldText = text.replace(/Rp\s?\d{1,3}(?:\.\d{3})*/g, " ");
      const soldM = soldText.match(/(\d+(?:[.,]\d+)?)\s*(rb|jt)?\s*\+?\s*terjual/i);
      if (soldM) {
        let s = parseFloat(soldM[1].replace(/\./g, "").replace(",", ".")) || 0;
        const u = (soldM[2] || "").toLowerCase();
        if (u === "rb") s *= 1000;
        if (u === "jt") s *= 1_000_000;
        rec.sold = Math.max(rec.sold, s);
      }
      byId.set(itemId, rec);
    });

    const products = [];
    for (const r of byId.values()) {
      const mapped = mapSearchItem({
        itemid: r.itemId,
        shopid: r.shopId || "0",
        name: r.name || "Produk",
        price_min: r.price > 0 ? r.price * 100000 : 0, // ke satuan-mikro
        historical_sold: r.sold,
        default_commission_rate: r.comm,
      });
      if (mapped) {
        mapped._dom = true;
        products.push(mapped);
      }
    }
    return products;
  }

  function mergeDomProducts(items, keyword) {
    if (!items || !items.length) return null;
    // Jangan timpa data akurat dari API.
    if (state.apiCaptured) return null;
    resetIfNewKeyword(keyword || getKeywordFromPage());
    mergeProducts(items);
    state.pagesLoaded = Math.max(state.pagesLoaded, 1);
    return {
      added: items.length,
      pageCount: items.length,
      stats: computeStats(getProducts()),
      keyword: state.keyword,
    };
  }

  function purgeDomProducts() {
    for (const [key, val] of state.products) {
      if (val && val._dom) state.products.delete(key);
    }
  }

  function computeStats(products) {
    const list = products;
    const totalItems = list.length;
    const totalSold = list.reduce((s, p) => s + p.soldTotal, 0);
    const totalRevenue = list.reduce((s, p) => s + p.totalRevenue, 0);
    const revenue30d = list.reduce((s, p) => s + p.revenue30d, 0);
    const avgMonthlyRevenue = list.reduce((s, p) => s + p.monthlyRevenue, 0);
    const trends = list.map((p) => p.trend).filter((t) => Number.isFinite(t));
    const avgTrend =
      trends.length > 0
        ? Math.round((trends.reduce((a, b) => a + b, 0) / trends.length) * 100) / 100
        : 0;

    return {
      totalItems,
      totalSold,
      totalRevenue,
      avgMonthlyRevenue,
      revenue30d,
      avgTrend,
      pagesLoaded: state.pagesLoaded,
    };
  }

  function getProducts() {
    return [...state.products.values()];
  }

  function formatIDR(n) {
    if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toFixed(2)}M`;
    if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1)}jt`;
    if (n >= 1_000) return `Rp ${Math.round(n / 1000)}rb`;
    return `Rp ${n}`;
  }

  function formatNum(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}jt`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}rb`;
    return String(Math.round(n));
  }

  // Ambil keyword pencarian dari body/param request. Hati-hati: pada GraphQL,
  // field `query` berisi teks query GraphQL (panjang, ada kurung kurawal) —
  // bukan keyword pencarian.
  function extractKeywordFromRequest(rb) {
    if (!rb || typeof rb !== "object") return "";
    const vars = rb.variables && typeof rb.variables === "object" ? rb.variables : {};
    const candidates = [
      rb.keyword, rb.searchKeyword, rb.search_keyword, rb.q, rb.search,
      vars.keyword, vars.searchKeyword, vars.search_keyword, vars.query,
      rb.query,
    ];
    for (const c of candidates) {
      if (typeof c === "string") {
        const s = c.trim();
        if (s && s.length <= 64 && !s.includes("{") && !s.includes("\n")) return s;
      }
    }
    return "";
  }

  // Hitung offset (newest) & limit dari param request, apa pun gaya
  // penamaannya (newest/offset gaya shopee.co.id, atau page/pageSize gaya
  // portal affiliate — termasuk di dalam variables GraphQL).
  function metaFromRequest(rb, itemCount) {
    const vars = rb && typeof rb.variables === "object" ? rb.variables : {};
    const v = { ...vars, ...(rb && typeof rb === "object" ? rb : {}) };
    const limit =
      Number(
        v.limit ?? v.pageSize ?? v.page_size ?? v.size ?? v.page_limit ??
        vars.limit ?? vars.pageSize
      ) || itemCount || 20;
    let newest = Number(v.newest ?? v.offset ?? v.page_offset ?? v.from ?? v.start ?? NaN);
    if (!Number.isFinite(newest)) {
      const page = Number(
        v.page ?? v.pageNo ?? v.page_no ?? v.pageIndex ?? v.page_index ??
        v.pageNum ?? v.current ?? NaN
      );
      newest = Number.isFinite(page) && page > 0 ? (page - 1) * limit : 0;
    }
    return { newest, limit };
  }

  function handleSearchCapture(msg) {
    if (!isPrimarySearchCapture(msg)) return null;

    // Data API akurat menggantikan hasil DOM sementara.
    if (!state.apiCaptured) {
      state.apiCaptured = true;
      purgeDomProducts();
    }

    const items = extractItems(msg.body);
    const keyword = extractKeywordFromRequest(msg.requestBody) || getKeywordFromPage();
    const { newest, limit } = metaFromRequest(msg.requestBody, items.length);

    // Simpan request offer affiliate terakhir untuk replay "halaman selanjutnya".
    if (isAffiliatePage() && msg.url) {
      state.lastAffiliateCapture = { url: msg.url, requestBody: msg.requestBody };
    }

    return ingestProducts(items, {
      keyword,
      newest,
      limit,
      url: msg.url,
      requestBody: msg.requestBody,
      body: msg.body,
    });
  }

  // Naikkan parameter halaman pada objek param request (page+1, atau
  // offset+limit). Return objek baru, atau null bila tidak ada param halaman.
  function bumpPageInParams(src) {
    if (!src || typeof src !== "object") return null;
    const PAGE_KEYS = ["page", "pageNo", "page_no", "pageIndex", "page_index", "pageNum", "current"];
    const OFFSET_KEYS = ["offset", "newest", "from", "start", "page_offset"];
    const LIMIT_KEYS = ["limit", "pageSize", "page_size", "size", "page_limit"];
    const out = { ...src };
    for (const k of PAGE_KEYS) {
      if (out[k] != null && Number.isFinite(Number(out[k]))) {
        out[k] = Number(out[k]) + 1;
        return out;
      }
    }
    let limit = 20;
    for (const k of LIMIT_KEYS) {
      if (out[k] != null && Number(out[k]) > 0) {
        limit = Number(out[k]);
        break;
      }
    }
    for (const k of OFFSET_KEYS) {
      if (out[k] != null && Number.isFinite(Number(out[k]))) {
        out[k] = Number(out[k]) + limit;
        return out;
      }
    }
    return null;
  }

  // Portal affiliate: replay request offer-list terakhir dengan halaman
  // berikutnya (GET → naikkan param di URL; GraphQL POST → naikkan variables).
  async function replayAffiliateNext() {
    const cap = state.lastAffiliateCapture;
    if (!cap || !cap.url) return null;
    const rb = cap.requestBody;
    const isGraphql =
      rb && typeof rb === "object" && typeof rb.query === "string" && rb.query.includes("{");

    try {
      if (isGraphql) {
        const vars = rb.variables && typeof rb.variables === "object" ? rb.variables : {};
        const bumpedVars = bumpPageInParams(vars);
        if (!bumpedVars) return null;
        const nextBody = { ...rb, variables: bumpedVars };
        const data = await mainWorldFetch(cap.url, {
          method: "POST",
          body: JSON.stringify(nextBody),
          headers: { Accept: "application/json", "Content-Type": "application/json" },
        });
        const items = extractItems(data || {});
        if (!items.length) return null;
        state.lastAffiliateCapture = { url: cap.url, requestBody: nextBody };
        const { newest, limit } = metaFromRequest(nextBody, items.length);
        return ingestProducts(items, {
          keyword: state.keyword,
          newest,
          limit,
          url: cap.url,
          requestBody: nextBody,
          body: data,
        });
      }

      const u = new URL(cap.url, location.origin);
      const params = Object.fromEntries(u.searchParams.entries());
      const bumped = bumpPageInParams(params);
      if (!bumped) return null;
      for (const [k, val] of Object.entries(bumped)) u.searchParams.set(k, String(val));
      const nextUrl = u.toString();
      const data = await mainWorldFetch(nextUrl);
      const items = extractItems(data || {});
      if (!items.length) return null;
      state.lastAffiliateCapture = { url: nextUrl, requestBody: bumped };
      const { newest, limit } = metaFromRequest(bumped, items.length);
      return ingestProducts(items, {
        keyword: state.keyword,
        newest,
        limit,
        url: nextUrl,
        requestBody: bumped,
        body: data,
      });
    } catch {
      return null;
    }
  }

  async function fetchNextPage() {
    if (state.loading) {
      return { ok: false, error: "Sedang memuat..." };
    }

    const keyword = state.keyword || getKeywordFromPage();
    if (!keyword) {
      return { ok: false, error: "Keyword tidak ditemukan" };
    }

    if (!state.hasMore) {
      return { ok: false, error: "Semua halaman sudah dimuat" };
    }

    // Portal affiliate: replay request offer-list terakhir dengan halaman
    // berikutnya. Fallback: klik pagination portal & tunggu intercept.
    if (isAffiliatePage()) {
      state.loading = true;
      const before = state.products.size;

      const replayed = await replayAffiliateNext();
      if (replayed) {
        state.loading = false;
        return {
          ok: true,
          stats: replayed.stats,
          pageCount: replayed.pageCount,
        };
      }

      clickShopeeNextPage();
      const gotMore = await waitForMoreProducts(before, 12000);
      state.loading = false;
      if (gotMore) {
        return {
          ok: true,
          stats: computeStats(getProducts()),
          pageCount: state.products.size - before,
        };
      }
      return {
        ok: false,
        error: "Scroll daftar penawaran / klik halaman berikutnya untuk memuat lagi",
      };
    }

    state.loading = true;
    const limit = Number(state.lastRequest?.limit ?? 60);
    const currentNewest = Number(
      state.lastRequest?.newest ?? state.lastRequest?.offset ?? 0
    );
    const nextNewest = currentNewest + limit;
    const req = buildSearchRequest(keyword, nextNewest, limit);
    const beforeCount = state.products.size;

    try {
      const data = await fetchSearchData(req);
      const items = extractItems(data || {});

      if (items.length > 0) {
        await enrichCommissions(items);
        mergeProducts(items);
        state.loadedOffsets.add(nextNewest);
        state.pagesLoaded = state.loadedOffsets.size;
        state.lastRequest = { ...req, newest: nextNewest, offset: nextNewest };
        state.lastSearchUrl = req.path;
        updateHasMore(items, nextNewest, limit, data);
        state.loading = false;
        return { ok: true, stats: computeStats(getProducts()), pageCount: items.length };
      }

      // Fallback: klik pagination Shopee & tunggu intercept API
      clickShopeeNextPage();
      const gotMore = await waitForMoreProducts(beforeCount, 12000);
      state.loading = false;

      if (gotMore) {
        state.hasMore = true;
        return {
          ok: true,
          stats: computeStats(getProducts()),
          pageCount: state.products.size - beforeCount,
        };
      }

      return {
        ok: false,
        error: "Gagal memuat — coba scroll ke bawah lalu klik lagi",
      };
    } catch (err) {
      state.loading = false;
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Gagal memuat halaman berikutnya",
      };
    }
  }

  // Bagikan rate komisi yang sudah diketahui (mis. hasil scrape portal
  // affiliate) ke cache lintas-tab di background worker.
  function publishCommissions(items) {
    const entries = {};
    let count = 0;
    for (const p of items) {
      if (p && p.itemId && p.commissionRate > 0) {
        entries[String(p.itemId)] = p.commissionRate;
        count += 1;
      }
    }
    if (!count) return;
    try {
      chrome.runtime.sendMessage({ type: "COMMISSION_PUT", entries });
    } catch {
      /* background tak tersedia */
    }
  }

  // Endpoint GraphQL open-api butuh signature App ID (bukan cookie), jadi
  // lookup dilakukan via background: cache lintas-tab dulu, lalu server
  // (API resmi) bila dikonfigurasi.
  async function enrichCommissions(products) {
    const needing = products.filter((p) => !p.commissionRate);
    if (needing.length === 0) return;

    try {
      const res = await chrome.runtime.sendMessage({
        type: "COMMISSION_LOOKUP",
        itemIds: needing.map((p) => String(p.itemId)),
        keyword: state.keyword || "",
      });
      const rates = res?.rates || {};
      const updates = new Map();
      for (const p of needing) {
        const rate = parseCommissionRate(rates[String(p.itemId)]);
        if (rate > 0) {
          p.commissionRate = rate;
          p.estimatedCommission = Math.round((p.price * rate) / 100);
          p.isAffiliate = true;
          updates.set(p.key, rate);
        }
      }
      if (updates.size) applyCommissionUpdates(updates);
    } catch {
      /* background tak tersedia (extension baru di-reload) */
    }
  }

  async function enrichAllCommissions() {
    const list = getProducts();
    await enrichCommissions(list);
    return computeStats(list);
  }

  // Data offer portal affiliate tidak membawa rating/ulasan/ctime/stok/penjualan
  // bulanan (makanya kolom detail "—" dan tren 0%). Lengkapi dari API pencarian
  // shopee.co.id (via background worker — punya izin host + cookie), match per
  // itemId dengan keyword yang sama.
  let enrichShopeeBusy = false;
  let enrichShopeeAt = 0;
  let enrichShopeeKw = "";

  async function enrichFromShopee() {
    if (!isAffiliatePage()) return false;
    const keyword = state.keyword;
    if (!keyword || keyword === AFFILIATE_DEFAULT_KW) return false;

    const needing = getProducts().filter((p) => !p.rating || !p.ctime);
    if (!needing.length) return false;

    if (enrichShopeeBusy) return false;
    const now = Date.now();
    if (keyword === enrichShopeeKw && now - enrichShopeeAt < 8000) return false;
    enrichShopeeBusy = true;
    enrichShopeeAt = now;
    enrichShopeeKw = keyword;

    let changed = 0;
    try {
      const wanted = new Map(); // itemId -> key produk kita
      for (const p of needing) wanted.set(String(p.itemId), p.key);

      for (let pageIdx = 0; pageIdx < 3 && wanted.size > 0; pageIdx += 1) {
        const res = await chrome.runtime.sendMessage({
          type: "SHOPEE_SEARCH",
          keyword,
          newest: pageIdx * 60,
          limit: 60,
        });
        if (!res?.ok || !res.body) break;
        const items = extractItems(res.body);
        if (!items.length) break;

        for (const item of items) {
          const key = wanted.get(String(item.itemId));
          if (!key) continue;
          const existing = state.products.get(key);
          if (!existing) continue;
          const merged = mergeProductData(existing, item);
          merged.key = key; // jaga key asli (shopId dari portal bisa "0")
          merged._dom = false; // sudah berisi data API — jangan ikut purge DOM
          state.products.set(key, merged);
          wanted.delete(String(item.itemId));
          changed += 1;
        }
        if (getNoMore(res.body)) break;
      }
    } catch {
      /* background tak tersedia / Shopee menolak — biarkan data apa adanya */
    }
    enrichShopeeBusy = false;
    return changed > 0;
  }

  function applyCommissionUpdates(updates) {
    for (const [key, rate] of updates) {
      const p = state.products.get(key);
      if (p && rate > 0) {
        state.products.set(key, {
          ...p,
          commissionRate: rate,
          estimatedCommission: Math.round((p.price * rate) / 100),
          isAffiliate: true,
        });
      }
    }
  }

  return {
    state,
    isSearchUrl,
    isAffiliatePage,
    isPrimarySearchCapture,
    getKeywordFromPage,
    handleSearchCapture,
    fetchNextPage,
    enrichAllCommissions,
    enrichFromShopee,
    enrichCommissions,
    applyCommissionUpdates,
    getProducts,
    computeStats,
    formatIDR,
    formatNum,
    extractItems,
    parseCommissionRate,
    scrapeFromDOM,
    scrapeAffiliateDOM,
    mergeDomProducts,
    fetchSearchPage,
    ingestProducts,
    buildSearchRequest,
    buildSearchBody: buildSearchRequest,
    resetIfNewKeyword,
  };
})();
