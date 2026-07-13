/**
 * Elyasya-Studio — content script v5.4
 */
(function () {
  const SOURCE = "elyasya-studio";
  let bootstrapTimer = null;
  let domScrapeTimer = null;
  let keepAliveTimer = null;

  function injectScriptFallback() {
    if (window.__elyasyaStudioInjected) return;
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("src/injected.js");
      s.onload = () => s.remove();
      (document.documentElement || document.head).appendChild(s);
    } catch {
      /* ok */
    }
  }

  function whenBodyReady(fn) {
    if (document.documentElement) {
      fn();
      return;
    }
    const done = () => {
      if (!document.documentElement) return;
      document.removeEventListener("DOMContentLoaded", done);
      obs.disconnect();
      fn();
    };
    document.addEventListener("DOMContentLoaded", done);
    const obs = new MutationObserver(done);
    obs.observe(document.documentElement, { childList: true });
  }

  function isAffiliateHost() {
    return /(^|\.)affiliate\.shopee\.co\.id$/i.test(location.hostname);
  }

  function isSearchPage() {
    try {
      const u = new URL(location.href);
      if (isAffiliateHost()) {
        // Portal affiliate: aktif di halaman penawaran/offer (data komisi native).
        return (
          u.pathname.includes("/offer") ||
          u.pathname.includes("/product") ||
          Boolean(u.searchParams.get("keyword"))
        );
      }
      return (
        u.pathname.includes("/search") ||
        Boolean(u.searchParams.get("keyword") || u.searchParams.get("q"))
      );
    } catch {
      return false;
    }
  }

  function getModules() {
    return {
      R: window.ElyasyaResearch,
      UI: window.ElyasyaResearchUI,
    };
  }

  function sendCapture(products) {
    if (!products.length) return;
    try {
      chrome.runtime.sendMessage({
        type: "CAPTURE",
        capture: {
          kind: "search",
          url: location.href,
          page_url: location.href,
          payload: { data: { list: products } },
          captured_at: new Date().toISOString(),
        },
        products: products.map((p) => ({
          key: p.key,
          itemId: p.itemId,
          shopId: p.shopId,
          name: p.name,
          price: p.price,
          commissionRate: p.commissionRate,
          estimatedCommission: p.estimatedCommission,
        })),
      });
    } catch {
      /* ok */
    }
  }

  function publishResult(result) {
    if (!result) return;
    const { R, UI } = getModules();
    if (!R || !UI) return;
    UI.onSearchResult(result);
    sendCapture(R.getProducts());
  }

  function ensureVisiblePanel(keyword, statusText) {
    const { UI } = getModules();
    if (!UI) return;
    try {
      if (keyword) UI.showLoading(keyword);
      else UI.mountPanel();
      UI.keepPanelAlive();
      if (statusText) {
        const panel = document.getElementById("elyasya-research-panel");
        const pages = panel?.querySelector(".elyasya-research-panel__pages");
        if (pages) pages.textContent = statusText;
      }
    } catch {
      /* ok */
    }
  }

  async function tryBootstrap() {
    const { R, UI } = getModules();
    if (!R || !UI || !isSearchPage()) return;

    const kw = R.getKeywordFromPage();
    if (!kw) return;

    try {
      R.resetIfNewKeyword(kw);
      ensureVisiblePanel(kw, "Memuat data riset...");

      // Sudah dapat data lengkap dari API intercept
      if (R.getProducts().length >= 40) {
        UI.updatePanel(R.computeStats(R.getProducts()), kw);
        return;
      }

      // Di portal affiliate, endpoint search shopee.co.id tak berlaku.
      // Utama: intercept respons offer. Cadangan: scrape kartu dari DOM.
      if (isAffiliateHost()) {
        const domItems = R.scrapeAffiliateDOM ? R.scrapeAffiliateDOM() : [];
        const result = R.mergeDomProducts(domItems, kw);
        if (result) UI.updatePanel(result.stats, result.keyword);
        if (R.getProducts().length > 0) {
          UI.updatePanel(R.computeStats(R.getProducts()), kw);
        } else {
          ensureVisiblePanel(kw, "Menunggu data penawaran affiliate... scroll / buka daftar produk");
        }
        return;
      }

      // Coba fetch langsung (sering diblokir — intercept yang utama)
      if (R.getProducts().length < 20) {
        const apiResult = await R.fetchSearchPage(0);
        if (apiResult && apiResult.stats.totalItems >= 20) {
          publishResult(apiResult);
          return;
        }
      }

      // DOM scrape hanya kalau belum ada data API
      if (R.getProducts().length < 15) {
        const domItems = R.scrapeFromDOM();
        if (domItems.length >= 15) {
          const result = R.ingestProducts(domItems, { keyword: kw, newest: 0 });
          if (result) publishResult(result);
        }
      }

      if (R.getProducts().length > 0) {
        UI.updatePanel(R.computeStats(R.getProducts()), kw);
      } else {
        ensureVisiblePanel(kw, "Menunggu data Shopee... tunggu sebentar");
      }
    } catch (err) {
      ensureVisiblePanel(
        kw,
        `Error: ${err instanceof Error ? err.message : "gagal memuat"}`
      );
    }
  }

  function scheduleBootstrap() {
    clearTimeout(bootstrapTimer);
    bootstrapTimer = setTimeout(tryBootstrap, 400);
    setTimeout(tryBootstrap, 2000);
    setTimeout(tryBootstrap, 5000);
    setTimeout(tryBootstrap, 9000);
  }

  function scheduleDomScrape() {
    clearInterval(domScrapeTimer);
    domScrapeTimer = setInterval(() => {
      if (!isSearchPage()) return;
      const { R, UI } = getModules();
      if (!R || !UI) return;
      UI.keepPanelAlive();

      // Affiliate: scrape kartu DOM (komisi tampil di halaman) selama API
      // belum menangkap. mergeDomProducts sendiri berhenti bila API sudah masuk.
      if (isAffiliateHost()) {
        const domItems = R.scrapeAffiliateDOM();
        const result = R.mergeDomProducts(domItems, R.getKeywordFromPage());
        if (result) UI.updatePanel(result.stats, result.keyword);
        return;
      }

      if (R.getProducts().length >= 40) return;

      const domItems = R.scrapeFromDOM();
      if (domItems.length >= 15) {
        const kw = R.getKeywordFromPage();
        const result = R.ingestProducts(domItems, { keyword: kw, newest: 0 });
        if (result) UI.updatePanel(result.stats, result.keyword);
      }
    }, 4000);
  }

  function scheduleKeepAlive() {
    clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      if (!isSearchPage()) return;
      const { UI } = getModules();
      if (UI) UI.keepPanelAlive();
    }, 1500);
  }

  async function handleMessage(msg) {
    const { R, UI } = getModules();
    if (!R || !UI) return;

    if (!isSearchPage()) {
      UI.hidePanel();
      return;
    }

    UI.keepPanelAlive();

    // Diagnostik: di portal affiliate, catat setiap respons yang tertangkap +
    // berapa produk yang berhasil di-parse. Buka DevTools Console untuk melihat.
    if (isAffiliateHost() && msg.url) {
      try {
        const n = R.extractItems(msg.body).length;
        console.log(
          `%c[Elyasya] capture: ${String(msg.url).slice(0, 120)} → ${n} produk`,
          "color:#7c3aed;font-weight:bold",
          n === 0 && msg.body ? { topKeys: Object.keys(msg.body).slice(0, 12) } : ""
        );
      } catch {
        /* ok */
      }
    }

    if (R.isPrimarySearchCapture(msg)) {
      const result = R.handleSearchCapture(msg);
      if (result) publishResult(result);
      return;
    }

    const items = R.extractItems(msg.body);
    if (
      msg.url?.includes("affiliate") ||
      msg.url?.includes("commission") ||
      msg.url?.includes("graphql")
    ) {
      for (const p of items) {
        if (p.commissionRate > 0) {
          R.applyCommissionUpdates(new Map([[p.key, p.commissionRate]]));
        }
      }
      if (R.getProducts().length) {
        UI.updatePanel(R.computeStats(R.getProducts()), R.state.keyword);
      }
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;
    handleMessage(data);
  });

  // Body respons hasil capture DevTools Protocol (dari background) — alirkan ke
  // pipeline yang sama dengan intercept fetch/XHR. Untuk GET, parameter query
  // (keyword, newest) dibaca dari URL agar pagination tetap akurat.
  function paramsFromUrl(url) {
    try {
      const u = new URL(url, location.origin);
      const p = Object.fromEntries(u.searchParams.entries());
      return Object.keys(p).length ? p : null;
    } catch {
      return null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "NET_CAPTURE") return;
    handleMessage({
      source: SOURCE,
      type: "fetch",
      url: msg.url,
      body: msg.body,
      requestBody: paramsFromUrl(msg.url),
      pageUrl: location.href,
      capturedAt: new Date().toISOString(),
    });
  });

  // Minta background menyalakan capture DevTools Protocol untuk tab ini.
  function requestCapture() {
    try {
      chrome.runtime.sendMessage({ type: "ENABLE_CAPTURE" }).catch(() => {});
    } catch {
      /* background belum siap */
    }
  }

  let lastHref = location.href;
  setInterval(() => {
    if (location.href === lastHref) return;
    lastHref = location.href;

    const { R, UI } = getModules();
    if (!R || !UI) return;

    if (!isSearchPage()) {
      UI.hidePanel();
      return;
    }

    const kw = R.getKeywordFromPage();
    if (kw) {
      R.resetIfNewKeyword(kw);
      requestCapture();
      scheduleBootstrap();
    }
  }, 500);

  injectScriptFallback();

  whenBodyReady(() => {
    if (isSearchPage()) {
      const kw = getModules().R?.getKeywordFromPage?.() || "";
      ensureVisiblePanel(kw, "Memuat data riset...");
      requestCapture();
      scheduleBootstrap();
      scheduleDomScrape();
      scheduleKeepAlive();
    }
  });
})();
