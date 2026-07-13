import { db } from "./db";
import { refreshAccessToken } from "./shopee";
import type { ShopeeAccount } from "@prisma/client";

/**
 * Ambil ShopeeAccount aktif milik host, refresh token otomatis kalau
 * hampir/atau sudah expired (PRD §9.3 poin 4).
 */
export async function getActiveAccount(hostId: string): Promise<ShopeeAccount | null> {
  const account = await db.shopeeAccount.findFirst({
    where: { hostId, status: { not: "revoked" } },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) return null;

  const soon = Date.now() + 10 * 60 * 1000; // refresh kalau expired < 10 menit lagi
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < soon) {
    try {
      const t = await refreshAccessToken(account.refreshToken, account.shopId);
      return await db.shopeeAccount.update({
        where: { id: account.id },
        data: {
          accessToken: t.access_token,
          refreshToken: t.refresh_token,
          tokenExpiresAt: new Date(Date.now() + (t.expire_in ?? 14400) * 1000),
          status: "active",
        },
      });
    } catch (err) {
      console.error("[shopee refresh]", account.id, err);
      await db.shopeeAccount.update({
        where: { id: account.id },
        data: { status: "expired" },
      });
      return null;
    }
  }
  return account;
}

export function tokenStatus(account: ShopeeAccount): "active" | "expiring" | "expired" {
  if (account.status === "expired" || account.status === "revoked") return "expired";
  if (!account.tokenExpiresAt) return "active";
  const remaining = account.tokenExpiresAt.getTime() - Date.now();
  if (remaining <= 0) return "expired";
  if (remaining < 60 * 60 * 1000) return "expiring";
  return "active";
}
