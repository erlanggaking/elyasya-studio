import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeCode } from "@/lib/shopee";
import { uidFromShop } from "@/lib/shopee-live";

// Origin publik app. Di belakang proxy (nginx), req.url terbaca sebagai origin
// internal (localhost:3000) — pakai header X-Forwarded-* dari nginx, dengan
// fallback ke origin SHOPEE_REDIRECT_URL.
function publicOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (host && !/^localhost[:$]/i.test(host)) return `${proto}://${host}`;
  try {
    return new URL(process.env.SHOPEE_REDIRECT_URL || "").origin;
  } catch {
    return "http://localhost:3000";
  }
}

// Redirect balik dari Shopee: ?code=...&shop_id=...&state=<hostId>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const code = url.searchParams.get("code") || "";
  const shopId = url.searchParams.get("shop_id") || "";
  // API livestream butuh user_id streamer. Callback Shopee hanya mengirim
  // shop_id (diverifikasi dari log), jadi user_id diturunkan dari uid pemilik
  // shop via get_shop_base — terbukti diterima endpoint livestream.
  let userId =
    url.searchParams.get("user_id") ||
    url.searchParams.get("main_account_id") ||
    "";
  const hostId = url.searchParams.get("state") || "";

  // Log semua param (tanpa code) — untuk diagnosa bentuk callback Shopee.
  const debugParams = Object.fromEntries(
    [...url.searchParams.entries()].filter(([k]) => k !== "code")
  );
  console.log("[shopee/callback] params:", JSON.stringify(debugParams));

  if (!code || !shopId || !hostId) {
    return NextResponse.redirect(new URL("/setting?shopee=error", origin));
  }

  const host = await db.host.findUnique({ where: { id: hostId } });
  if (!host) {
    return NextResponse.redirect(new URL("/setting?shopee=hostnotfound", origin));
  }

  try {
    const token = await exchangeCode(code, shopId);
    if (!userId) userId = (await uidFromShop(shopId)) ?? "";
    await db.shopeeAccount.upsert({
      where: { hostId_shopId: { hostId, shopId } },
      create: {
        hostId,
        shopId,
        userId,
        shopName: `Shop ${shopId}`,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (token.expire_in ?? 14400) * 1000),
        status: "active",
      },
      update: {
        ...(userId ? { userId } : {}),
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (token.expire_in ?? 14400) * 1000),
        status: "active",
        connectedAt: new Date(),
      },
    });
    return NextResponse.redirect(new URL(`/live/host/${hostId}?shopee=connected`, origin));
  } catch (err) {
    console.error("[shopee/callback]", err);
    return NextResponse.redirect(new URL(`/live/host/${hostId}?shopee=failed`, origin));
  }
}
