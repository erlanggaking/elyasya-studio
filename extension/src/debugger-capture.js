/**
 * Elyasya-Studio — Penangkap data via Chrome DevTools Protocol (chrome.debugger)
 *
 * Metode ini menempel debugger ke tab Shopee, mengaktifkan domain Network,
 * lalu membaca body respons apa pun yang cocok (search_items, get_shop,
 * item/get, pdp, offer affiliate). Lebih tahan-banting dibanding hook fetch/XHR
 * karena membaca di lapisan jaringan — tidak bisa "dimatikan" script halaman.
 *
 * Konsekuensi: Chrome menampilkan bar "Elyasya-Studio started debugging this
 * browser". Itu wajar & memang harga dari metode ini.
 */

const PROTOCOL_VERSION = "1.3";

// Pola URL yang body respons-nya kita ambil.
const CAPTURE_PATTERNS = [
  /\/api\/v4\/search\/search_items/i,
  /\/api\/v4\/search\/search_filter/i,
  /\/api\/v4\/recommend/i,
  /\/api\/v4\/pdp\//i,
  /\/api\/v4\/item\/get/i,
  /\/api\/v4\/shop\//i,
  /\/api\/v4\/pages\/get_category_tree/i,
  /affiliate\.shopee\.co\.id.*(offer|product|graphql)/i,
  /open-api\.affiliate\.shopee\.co\.id/i,
  /\/graphql/i,
  // Livestream (live.shopee.co.id) — info room, daftar produk, statistik.
  /live\.shopee\.co\.id\/api\//i,
  /\/api\/v[0-9]+\/session\//i,
  /get_one_room|get_room|room_info|streamer|entity\/get|item_list|product_list/i,
];

function shouldCaptureUrl(url) {
  if (!url) return false;
  const u = String(url);
  if (/susercontent\.com|\.(png|jpg|jpeg|webp|gif|css|woff|svg)(\?|$)/i.test(u)) {
    return false;
  }
  return CAPTURE_PATTERNS.some((re) => re.test(u));
}

// State per tab yang di-attach.
const attached = new Map(); // tabId -> { requests: Map<requestId, {url}> }

function isAttached(tabId) {
  return attached.has(tabId);
}

async function sendCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

/**
 * Tempel debugger ke tab & aktifkan Network. onCapture dipanggil dengan
 * ({ tabId, url, body }) setiap kali body respons yang cocok berhasil dibaca.
 */
async function attachToTab(tabId, onCapture) {
  if (attached.has(tabId)) return { ok: true, already: true };

  const entry = { requests: new Map(), onCapture };
  attached.set(tabId, entry);

  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
        const err = chrome.runtime.lastError;
        // "Another debugger is already attached" → anggap sukses & lanjut.
        if (err && !/already attached/i.test(err.message)) reject(new Error(err.message));
        else resolve();
      });
    });
    await sendCommand(tabId, "Network.enable", {
      maxResourceBufferSize: 20 * 1024 * 1024,
      maxTotalBufferSize: 100 * 1024 * 1024,
    });
    return { ok: true };
  } catch (err) {
    attached.delete(tabId);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function detachFromTab(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await new Promise((resolve) => {
      chrome.debugger.detach({ tabId }, () => {
        void chrome.runtime.lastError; // abaikan bila sudah terlepas
        resolve();
      });
    });
  } catch {
    /* sudah terlepas */
  }
}

// Handler event debugger — dipasang sekali di background.
function handleDebuggerEvent(source, method, params) {
  const tabId = source.tabId;
  const entry = attached.get(tabId);
  if (!entry) return;

  if (method === "Network.responseReceived") {
    const url = params.response?.url;
    if (shouldCaptureUrl(url)) {
      entry.requests.set(params.requestId, { url });
    }
    return;
  }

  if (method === "Network.loadingFinished") {
    const req = entry.requests.get(params.requestId);
    if (!req) return;
    entry.requests.delete(params.requestId);
    sendCommand(tabId, "Network.getResponseBody", { requestId: params.requestId })
      .then((res) => {
        if (!res || !res.body) return;
        const text = res.base64Encoded ? atob(res.body) : res.body;
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          return; // bukan JSON — lewati
        }
        entry.onCapture({ tabId, url: req.url, body });
      })
      .catch(() => {
        /* body sudah tidak tersedia di buffer */
      });
  }
}

// Bersihkan bila tab ditutup atau debugger terlepas (mis. user klik "cancel").
function initLifecycleHooks() {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null) attached.delete(source.tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
  });
}

export const DebuggerCapture = {
  attachToTab,
  detachFromTab,
  isAttached,
  handleDebuggerEvent,
  initLifecycleHooks,
  shouldCaptureUrl,
};
