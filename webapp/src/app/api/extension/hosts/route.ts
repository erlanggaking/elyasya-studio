import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";
import { hostTenantWhere } from "@/lib/tenant";

// Daftar host untuk extension — dipakai pemilih "tautkan akun cookie ke host"
// di popup (auth Bearer token). Sertakan status akun cookie agar operator tahu
// mana yang sudah terhubung.
export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }

  const hosts = await db.host.findMany({
    where: hostTenantWhere(auth.user),
    orderBy: { name: "asc" },
    include: {
      studio: { select: { name: true } },
      shopeeAccounts: { select: { scope: true, status: true } },
    },
  });

  return NextResponse.json({
    ok: true,
    hosts: hosts.map((h) => ({
      id: h.id,
      name: h.name,
      studio: h.studio?.name ?? "",
      live_username: h.liveUsername,
      live_uid: h.liveUid,
      cookie_connected: h.shopeeAccounts.some((a) => a.scope === "cookie" && a.status === "active"),
    })),
  });
}
