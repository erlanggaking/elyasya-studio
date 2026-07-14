import { getSessionUser } from "@/lib/auth";

// Proxy stream FLV live Shopee → player panel (flv.js). CDN Shopee tidak
// mengirim header CORS untuk origin kita, jadi dialirkan lewat server.
// Hanya domain streaming Shopee yang diizinkan (anti-SSRF).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const raw = new URL(req.url).searchParams.get("u") || "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (
    target.protocol !== "https:" ||
    !/(^|\.)shopee\.co\.id$/i.test(target.hostname)
  ) {
    return new Response("Domain tidak diizinkan", { status: 400 });
  }

  const upstream = await fetch(target.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36",
      Referer: "https://live.shopee.co.id/",
    },
    signal: req.signal,
  }).catch(() => null);

  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("Stream tidak tersedia", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "video/x-flv",
      "Cache-Control": "no-store",
    },
  });
}
