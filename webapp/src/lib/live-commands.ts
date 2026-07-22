import { db } from "./db";
import type { ShopeeAccount } from "@prisma/client";

/**
 * Jembatan "kontrol via cookie": saat host terhubung mode cookie (login Google
 * di browser, tanpa OAuth Partner API), aksi keranjang live tidak bisa dipanggil
 * dari server (Partner API butuh token; API internal Shopee diblokir anti-bot
 * untuk server). Sebagai gantinya server menitipkan PERINTAH ke extension yang
 * jalan di browser host — extension mengeksekusinya memakai cookie host lalu
 * melapor balik. Server tidak pernah menyimpan/menyentuh cookie.
 */

export function isCookieAccount(account: ShopeeAccount | null | undefined): boolean {
  return account?.scope === "cookie";
}

export type CommandType = "add_items" | "remove_item" | "pin_item" | "fetch_metrics";

export async function enqueueLiveCommand(args: {
  hostId: string;
  liveSessionId?: string;
  shopeeSessionId?: string;
  type: CommandType;
  payload: unknown;
}): Promise<{ id: string }> {
  const cmd = await db.liveCommand.create({
    data: {
      hostId: args.hostId,
      liveSessionId: args.liveSessionId ?? "",
      shopeeSessionId: args.shopeeSessionId ?? "",
      type: args.type,
      payload: JSON.stringify(args.payload ?? {}),
    },
  });
  return { id: cmd.id };
}

/** True bila masih ada perintah cookie yang belum selesai untuk host ini. */
export async function hasPendingCommands(hostId: string): Promise<boolean> {
  const n = await db.liveCommand.count({
    where: { hostId, status: { in: ["pending", "claimed"] } },
  });
  return n > 0;
}
