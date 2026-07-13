import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { exchangeCode } from "@/lib/shopee";

// Redirect balik dari Shopee: ?code=...&shop_id=...&state=<hostId>
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") || "";
  const shopId = url.searchParams.get("shop_id") || "";
  const hostId = url.searchParams.get("state") || "";

  if (!code || !shopId || !hostId) {
    return NextResponse.redirect(new URL("/setting?shopee=error", url.origin));
  }

  const host = await db.host.findUnique({ where: { id: hostId } });
  if (!host) {
    return NextResponse.redirect(new URL("/setting?shopee=hostnotfound", url.origin));
  }

  try {
    const token = await exchangeCode(code, shopId);
    await db.shopeeAccount.upsert({
      where: { hostId_shopId: { hostId, shopId } },
      create: {
        hostId,
        shopId,
        shopName: `Shop ${shopId}`,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (token.expire_in ?? 14400) * 1000),
        status: "active",
      },
      update: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        tokenExpiresAt: new Date(Date.now() + (token.expire_in ?? 14400) * 1000),
        status: "active",
        connectedAt: new Date(),
      },
    });
    return NextResponse.redirect(new URL(`/live/host/${hostId}?shopee=connected`, url.origin));
  } catch (err) {
    console.error("[shopee/callback]", err);
    return NextResponse.redirect(new URL(`/live/host/${hostId}?shopee=failed`, url.origin));
  }
}
