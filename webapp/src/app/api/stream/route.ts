import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPublicPlayUrl } from "@/lib/shopee-live";

// Proxy stream FLV/HLS live Shopee → player panel. CDN Shopee tidak selalu
// mengirim header CORS untuk origin kita, jadi dialirkan lewat server.
// Hanya domain streaming Shopee yang diizinkan (anti-SSRF).
const ALLOWED_HOST_SUFFIXES = ["shopee.co.id", "shopee.com", "shopee.sg", "shopeemobile.com"];

function isAllowedHost(hostname: string) {
  const host = hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const params = new URL(req.url).searchParams;
  const localSessionId = params.get("session") || "";
  let raw = params.get("u") || "";

  // Untuk fallback player, resolve ulang URL CDN agar signature yang sudah
  // kedaluwarsa di browser/DB tidak ikut dipakai oleh proxy.
  if (localSessionId) {
    const session = await db.liveSession.findUnique({
      where: { id: localSessionId },
      select: { status: true, shopeeSessionId: true, playUrl: true },
    });
    if (!session || session.status !== "live") {
      return new Response("Sesi live tidak ditemukan", { status: 404 });
    }
    raw = session.shopeeSessionId
      ? await getPublicPlayUrl(session.shopeeSessionId)
      : session.playUrl;
    if (!raw) return new Response("URL stream belum tersedia", { status: 404 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (
    target.protocol !== "https:" ||
    !isAllowedHost(target.hostname)
  ) {
    return new Response("Domain tidak diizinkan", { status: 400 });
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36",
      Referer: "https://live.shopee.co.id/",
      ...(req.headers.get("range") ? { Range: req.headers.get("range")! } : {}),
    },
    signal: req.signal,
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("Stream tidak tersedia", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "video/x-flv";
  const isManifest = /mpegurl/i.test(contentType) || /\.m3u8(?:\?|$)/i.test(target.toString());
  if (isManifest) {
    const manifest = await upstream.text();
    const rewritten = manifest
      .split("\n")
      .map((line) => {
        const value = line.trim();
        if (!value || value.startsWith("#")) return line;
        return `/api/stream?u=${encodeURIComponent(new URL(value, target).toString())}`;
      })
      .join("\n");
    return new Response(rewritten, {
      headers: { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      ...(upstream.headers.get("content-range")
        ? { "Content-Range": upstream.headers.get("content-range")! }
        : {}),
    },
  });
}
