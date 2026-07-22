import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeCode, readOAuthState } from "@/lib/shopee";
import { uidFromShop } from "@/lib/shopee-live";
import { isSuperuser } from "@/lib/tenant";

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

// Redirect balik dari Shopee: ?code=...&shop_id=...&state=<signed-state>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = publicOrigin(req);
  const code = url.searchParams.get("code") || "";
  const shopId = url.searchParams.get("shop_id") || "";
  const mainAccountId = url.searchParams.get("main_account_id") || "";
  const oauthError = url.searchParams.get("error") || url.searchParams.get("error_auth") || "";
  let userId =
    url.searchParams.get("user_id") ||
    "";
  const oauthState = readOAuthState(url.searchParams.get("state") || "");
  const hostId = oauthState?.hostId ?? "";

  // Log semua param (tanpa code) — untuk diagnosa bentuk callback Shopee.
  const debugParams = Object.fromEntries(
    [...url.searchParams.entries()].filter(([k]) => k !== "code")
  );
  console.log("[shopee/callback] params:", JSON.stringify(debugParams));

  if (!hostId) {
    return NextResponse.redirect(new URL("/setting?shopee=invalid_state", origin));
  }

  const [host, initiator] = await Promise.all([
    db.host.findUnique({ where: { id: hostId } }),
    oauthState
      ? db.user.findUnique({ where: { id: oauthState.userId } })
      : Promise.resolve(null),
  ]);
  if (!host || !initiator || (!isSuperuser(initiator) && host.ownerId !== initiator.id)) {
    return NextResponse.redirect(new URL("/setting?shopee=hostnotfound", origin));
  }

  if (oauthError || !code || (!shopId && !mainAccountId)) {
    return NextResponse.redirect(new URL(`/live/host/${hostId}?shopee=denied`, origin));
  }

  try {
    const token = await exchangeCode(code, { shopId, mainAccountId });
    const resolvedShopId = shopId || String(token.shop_id_list?.[0] ?? mainAccountId);
    // TERBUKTI JALAN: callback Shopee hanya mengirim shop_id; user_id untuk
    // endpoint livestream = uid pemilik shop via get_shop_base.
    userId = userId || String(token.user_id_list?.[0] ?? "");
    if (!userId) userId = (await uidFromShop(resolvedShopId)) ?? "";
    await db.shopeeAccount.upsert({
      where: { hostId_shopId: { hostId, shopId: resolvedShopId } },
      create: {
        hostId,
        shopId: resolvedShopId,
        userId,
        shopName: `Shop ${resolvedShopId}`,
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
