/**
 * Elyasya-Studio — MAIN world interceptor
 */
(function () {
  if (window.__elyasyaStudioInjected) return;
  window.__elyasyaStudioInjected = true;

  const SOURCE = "elyasya-studio";
  const origFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;

  function shouldCapture(url) {
    if (!url || typeof url !== "string") return false;
    const u = url.toLowerCase();
    if (u.includes("susercontent.com")) return false;
    if (u.includes(".png") || u.includes(".jpg") || u.includes(".webp") || u.includes(".gif") || u.includes(".css") || u.includes(".js?")) return false;
    // Di portal affiliate, tangkap SEMUA respons (endpoint offer bisa beragam).
    if (/affiliate\.shopee\.co\.id/i.test(u)) return true;
    if (/shopee\.co\.id/i.test(u) && /\/api\//i.test(u)) return true;
    if (/\/graphql/i.test(u)) return true;
    if (/search_items|search\/search|recommend/i.test(u)) return true;
    return false;
  }

  function tryParseJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function parseReqBody(input, init) {
    const raw = init?.body ?? (input instanceof Request ? undefined : null);
    if (typeof raw === "string") return tryParseJson(raw);
    return null;
  }

  function parseUrlParams(url) {
    try {
      const u = new URL(url, location.origin);
      const params = Object.fromEntries(u.searchParams.entries());
      return Object.keys(params).length ? params : null;
    } catch {
      return null;
    }
  }

  function getRequestMeta(input, init) {
    const initObj = init ?? {};
    const method =
      (input instanceof Request ? input.method : initObj.method) || "GET";
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : String(input?.url ?? "");

    if (method.toUpperCase() === "GET") {
      return parseUrlParams(url);
    }
    if (input instanceof Request && method.toUpperCase() !== "GET") {
      return null;
    }
    return parseReqBody(input, initObj);
  }

  function emit(type, url, body, requestBody) {
    window.postMessage(
      {
        source: SOURCE,
        type,
        url,
        body,
        requestBody: requestBody ?? null,
        pageUrl: location.href,
        capturedAt: new Date().toISOString(),
      },
      "*"
    );
  }

  function handleResponse(url, text, requestBody) {
    const body = tryParseJson(text);
    if (body) emit("fetch", url, body, requestBody);
  }

  if (origFetch) {
    window.fetch = async function (...args) {
      const response = await origFetch(...args);
      try {
        const input = args[0];
        const init = args[1] ?? {};
        const url =
          typeof input === "string"
            ? input
            : input instanceof Request
              ? input.url
              : String(input?.url ?? "");
        const reqBody = getRequestMeta(input, init);

        if (shouldCapture(url) && response.ok) {
          const clone = response.clone();
          clone
            .text()
            .then((text) => handleResponse(url, text, reqBody))
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return response;
    };
  }

  try {
    const OrigXHR = window.XMLHttpRequest;
    if (typeof OrigXHR === "function" && !OrigXHR.__elyasyaPatched) {
      function PatchedXHR() {
        const xhr = new OrigXHR();
        let reqUrl = "";
        let reqBody = null;

        const origOpen = xhr.open;
        xhr.open = function (method, url, ...rest) {
          reqUrl = typeof url === "string" ? url : String(url);
          if (String(method).toUpperCase() === "GET") {
            reqBody = parseUrlParams(reqUrl);
          } else {
            reqBody = null;
          }
          return origOpen.call(this, method, url, ...rest);
        };

        const origSend = xhr.send;
        xhr.send = function (body) {
          if (typeof body === "string") reqBody = tryParseJson(body);
          return origSend.call(this, body);
        };

        xhr.addEventListener("load", function () {
          try {
            if (
              shouldCapture(reqUrl) &&
              xhr.status >= 200 &&
              xhr.status < 300 &&
              xhr.responseText
            ) {
              handleResponse(reqUrl, xhr.responseText, reqBody);
            }
          } catch {
            /* ignore */
          }
        });

        return xhr;
      }

      PatchedXHR.prototype = OrigXHR.prototype;
      // Pertahankan konstanta status (UNSENT..DONE) & identitas konstruktor,
      // agar script Shopee yang membaca `XMLHttpRequest.DONE` dsb. tetap jalan.
      for (const k of ["UNSENT", "OPENED", "HEADERS_RECEIVED", "LOADING", "DONE"]) {
        if (k in OrigXHR) PatchedXHR[k] = OrigXHR[k];
      }
      PatchedXHR.__elyasyaPatched = true;
      window.XMLHttpRequest = PatchedXHR;
    }
  } catch {
    /* fetch only */
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== "elyasya-fetch") return;

    const id = data.id;
    try {
      const fetchFn = origFetch || window.fetch.bind(window);
      const res = await fetchFn(data.url, {
        method: data.method || "GET",
        credentials: "include",
        headers: data.headers || { Accept: "application/json" },
      });
      const text = await res.text();
      window.postMessage(
        {
          source: SOURCE,
          type: "elyasya-fetch-result",
          id,
          ok: res.ok,
          status: res.status,
          text,
        },
        "*"
      );
    } catch (err) {
      window.postMessage(
        {
          source: SOURCE,
          type: "elyasya-fetch-result",
          id,
          ok: false,
          error: err instanceof Error ? err.message : "fetch error",
        },
        "*"
      );
    }
  });
})();
