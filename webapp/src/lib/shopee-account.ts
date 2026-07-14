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
      const data = {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? account.refreshToken,
        tokenExpiresAt: new Date(Date.now() + (t.expire_in ?? 14400) * 1000),
        status: "active",
      };
      // Shopee MEROTASI refresh token tiap dipakai. Satu shop bisa dipakai
      // beberapa host (baris akun berbeda) — terapkan token baru ke SEMUA
      // baris shop ini supaya salinan di baris lain tidak mati.
      await db.shopeeAccount.updateMany({
        where: { shopId: account.shopId, status: { not: "revoked" } },
        data,
      });
      return { ...account, ...data, tokenExpiresAt: data.tokenExpiresAt };
    } catch (err) {
      console.error("[shopee refresh]", account.id, err);
      const msg = err instanceof Error ? err.message : String(err);
      // Hanya tandai expired bila refresh token benar-benar ditolak Shopee —
      // error jaringan/sementara jangan sampai "mereset" credential host.
      if (/refresh token|invalid/i.test(msg)) {
        await db.shopeeAccount.updateMany({
          where: { shopId: account.shopId, status: { not: "revoked" } },
          data: { status: "expired" },
        });
      }
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
