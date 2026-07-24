/**
 * Elyasya headless worker — menarik metrik live host mode COOKIE via browser
 * headless (Playwright). Browser dipakai supaya JS Shopee menghitung signature
 * anti-bot; endpoint /webapi/v1/session/{id} lalu balas data lengkap.
 *
 * Loop tiap INTERVAL: ambil daftar host cookie dari app → per host cek ongoing
 * (fetch biasa) → kalau live, buka headless & tarik session detail → lapor.
 */
const { chromium } = require("playwright");

const APP = process.env.APP_URL || "http://elyasya:3000";
const SECRET = process.env.HEADLESS_SECRET;
const INTERVAL = Number(process.env.INTERVAL_MS || 45000);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

function cookiePairs(str) {
  return str.split(/;\s*/).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return { name: p.slice(0, i), value: p.slice(i + 1), domain: ".shopee.co.id", path: "/" };
  });
}

async function ongoing(uid) {
  try {
    const r = await fetch(`https://live.shopee.co.id/api/v1/shop_page/live/ongoing?uid=${uid}&_=${Date.now()}`, {
      headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://shopee.co.id/" },
    });
    const d = await r.json();
    const ol = d?.data?.ongoing_live;
    return ol?.session_id ? String(ol.session_id) : null;
  } catch { return null; }
}

async function fetchSessionDetail(browser, cookie, sessionId) {
  const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1366, height: 768 } });
  try {
    await ctx.addCookies(cookiePairs(cookie));
    const page = await ctx.newPage();
    // Set konteks keamanan Shopee (agar signature anti-bot terpasang).
    await page.goto("https://live.shopee.co.id/pc/anchor", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const data = await page.evaluate(async (sid) => {
      try {
        const r = await fetch("https://live.shopee.co.id/webapi/v1/session/" + sid, { credentials: "include" });
        const j = await r.json();
        return j?.data?.session ?? null;
      } catch { return null; }
    }, sessionId);
    return data;
  } finally {
    await ctx.close();
  }
}

async function report(payload) {
  try {
    await fetch(`${APP}/api/internal/headless/report?secret=${SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.error("[worker] report gagal:", e.message); }
}

async function tick() {
  let targets = [];
  try {
    const r = await fetch(`${APP}/api/internal/headless/targets?secret=${SECRET}`);
    const d = await r.json();
    targets = d.targets || [];
  } catch (e) { console.error("[worker] ambil targets gagal:", e.message); return; }
  if (targets.length === 0) return;

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const t of targets) {
      const sid = await ongoing(t.uid);
      if (!sid) { await report({ hostId: t.hostId, live: false }); continue; }
      const s = await fetchSessionDetail(browser, t.cookie, sid);
      if (!s || !s.session_id) { await report({ hostId: t.hostId, live: false }); continue; }
      await report({
        hostId: t.hostId,
        live: s.status === 1,
        session: {
          sessionId: String(s.session_id),
          title: s.title || "",
          viewers: s.member_cnt || 0,
          likes: s.like_cnt || 0,
          itemsCnt: s.items_cnt || 0,
          playUrl: s.play_url || "",
          startTime: s.start_time || 0,
          status: s.status,
        },
      });
      console.log(`[worker] ${t.name}: live sesi ${sid} — ${s.member_cnt} penonton, ${s.items_cnt} produk`);
    }
  } finally {
    await browser.close();
  }
}

console.log("[worker] Elyasya headless worker start — interval", INTERVAL, "ms, app", APP);
tick().catch((e) => console.error(e));
setInterval(() => tick().catch((e) => console.error("[worker] tick error:", e.message)), INTERVAL);
