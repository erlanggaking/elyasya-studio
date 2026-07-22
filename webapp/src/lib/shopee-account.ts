import { db } from "./db";
import { refreshAccessToken } from "./shopee";
import type { ShopeeAccount } from "@prisma/client";

/**
 * Manajemen token akun host — DIRANCANG AGAR HOST TIDAK PERLU RECONNECT.
 *
 * Masalah yang dulu memaksa reconnect tiap live: Shopee MEROTASI refresh_token
 * tiap dipakai. Saat live, banyak proses (metrik 10s, auto-pin 10s, sync item
 * 2m, dsb.) memanggil getActiveAccount hampir bersamaan → dua refresh paralel
 * memakai refresh_token yang sama → satu menang & merotasi, sisanya memakai
 * token basi → Shopee menolak → akun keliru ditandai expired.
 *
 * Perbaikan:
 *  1. SINGLE-FLIGHT: refresh diserialisasi per shop (kunci in-memory). Pemanggil
 *     paralel menunggu promise yang sama & memakai hasilnya — tidak pernah ada
 *     dua refresh bertabrakan.
 *  2. RE-READ SEBELUM MENYERAH: bila refresh gagal, baca ulang akun dari DB —
 *     kemungkinan proses lain baru saja menyegarkannya.
 *  3. TIDAK menandai expired karena kegagalan sesaat. Status hanya diturunkan
 *     ke "expiring" (masih dipakai) — reconnect otomatis lewat token lama yang
 *     masih valid. Hanya bila token benar-benar sudah lewat masa berlaku + gagal
 *     refresh berkali-kali, baru butuh perhatian.
 */

// Kunci single-flight refresh, key = shopId (atau userId bila ada).
const refreshInFlight = new Map<string, Promise<ShopeeAccount | null>>();

function accountKey(account: Pick<ShopeeAccount, "shopId" | "userId">): string {
  return account.userId || account.shopId;
}

function tenantWhere(account: Pick<ShopeeAccount, "shopId" | "userId">) {
  return account.userId
    ? { userId: account.userId, status: { not: "revoked" } }
    : { shopId: account.shopId, status: { not: "revoked" } };
}

async function doRefresh(account: ShopeeAccount): Promise<ShopeeAccount | null> {
  try {
    const t = await refreshAccessToken(account.refreshToken, account.shopId, account.userId);
    const data = {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? account.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (t.expire_in ?? 14400) * 1000),
      status: "active",
    };
    // Terapkan token baru ke SEMUA baris shop/user ini sekaligus.
    await db.shopeeAccount.updateMany({ where: tenantWhere(account), data });
    return { ...account, ...data, tokenExpiresAt: data.tokenExpiresAt };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[shopee refresh]", account.id, msg);

    // Proses lain mungkin sudah menyegarkan token barusan — baca ulang.
    const fresh = await db.shopeeAccount.findFirst({
      where: { id: account.id },
    });
    if (fresh && fresh.tokenExpiresAt && fresh.tokenExpiresAt.getTime() > Date.now() + 60_000) {
      return fresh; // sudah disegarkan proses lain → pakai itu
    }

    // Jangan hard-expired karena satu kegagalan (biasanya race sesaat / jaringan).
    // Turunkan ke "expiring" saja: token lama tetap dicoba dipakai, dan siklus
    // berikutnya refresh lagi. Reconnect TIDAK dipaksa.
    if (fresh) {
      await db.shopeeAccount.updateMany({
        where: tenantWhere(account),
        data: { status: "expiring" },
      });
      return { ...fresh, status: "expiring" };
    }
    return null;
  }
}

/**
 * Ambil akun host yang bisa dipakai. Refresh otomatis (single-flight) bila token
 * hampir/sudah expired. Menerima status "active" maupun "expiring" (token lama
 * masih dicoba) supaya host tidak perlu reconnect karena race sesaat.
 */
export async function getActiveAccount(
  hostId: string,
  forceRefresh = false
): Promise<ShopeeAccount | null> {
  const account = await db.shopeeAccount.findFirst({
    where: { hostId, status: { in: ["active", "expiring"] } },
    orderBy: { connectedAt: "desc" },
  });
  if (!account) return null;

  const soon = Date.now() + 10 * 60 * 1000; // refresh kalau expired < 10 menit lagi
  const needsRefresh =
    forceRefresh || !account.tokenExpiresAt || account.tokenExpiresAt.getTime() < soon;
  if (!needsRefresh) return account;

  // Single-flight: satu refresh per shop/user, sisanya menunggu hasil yang sama.
  const key = accountKey(account);
  let flight = refreshInFlight.get(key);
  if (!flight) {
    flight = doRefresh(account).finally(() => refreshInFlight.delete(key));
    refreshInFlight.set(key, flight);
  }
  const refreshed = await flight;
  // Kalau refresh menghasilkan akun (untuk shop/user), pastikan yang dikembalikan
  // milik host yang diminta (bisa beda baris tapi token sama).
  if (refreshed) {
    return { ...account, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, tokenExpiresAt: refreshed.tokenExpiresAt, status: refreshed.status };
  }
  return account; // fallback: pakai token lama, jangan blokir
}

function isInvalidAccessToken(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /invalid[_ ]acc(?:eess|ess)[_ ]token|invalid access_token/i.test(message);
}

/**
 * Jalankan API Partner memakai akun aktif. Bila Shopee menolak token sebelum
 * waktu expiry lokal, refresh paksa (single-flight) sekali lalu ulangi operasi.
 * TIDAK menandai akun expired walau retry gagal — supaya host tidak dipaksa
 * reconnect. Error dilempar apa adanya untuk ditangani pemanggil.
 */
export async function withActiveAccount<T>(
  hostId: string,
  operation: (account: ShopeeAccount) => Promise<T>
): Promise<T> {
  const account = await getActiveAccount(hostId);
  if (!account) throw new Error("Akun Shopee host tidak aktif");
  try {
    return await operation(account);
  } catch (err) {
    if (!isInvalidAccessToken(err)) throw err;

    // PENTING (anti-cascade): Shopee membatalkan access_token LAMA setiap kali
    // ada refresh. Jadi token yang ditolak sering kali sudah digantikan proses
    // lain. Baca ULANG dari DB dulu — kalau access_token-nya sudah beda (lebih
    // baru), pakai itu TANPA refresh (menghindari badai refresh yang malah
    // saling membatalkan token).
    const latest = await db.shopeeAccount.findFirst({ where: { id: account.id } });
    if (latest && latest.accessToken && latest.accessToken !== account.accessToken) {
      try {
        return await operation(latest);
      } catch (err2) {
        if (!isInvalidAccessToken(err2)) throw err2;
        // token DB juga ditolak → lanjut ke refresh paksa di bawah.
      }
    }

    console.warn(`[shopee] token host ${hostId} ditolak — refresh paksa & retry`);
    const refreshed = await getActiveAccount(hostId, true);
    if (!refreshed) throw err;
    return await operation(refreshed);
  }
}

export function tokenStatus(account: ShopeeAccount): "active" | "expiring" | "expired" {
  if (account.status === "revoked") return "expired";
  if (account.status === "expired") return "expired";
  if (!account.tokenExpiresAt) return "active";
  const remaining = account.tokenExpiresAt.getTime() - Date.now();
  if (remaining <= 0) return "expiring"; // token lewat tapi masih auto-refresh — bukan "expired" yang minta reconnect
  if (remaining < 60 * 60 * 1000) return "expiring";
  return "active";
}
