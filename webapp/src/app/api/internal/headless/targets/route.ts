import { NextResponse } from "next/server";
import { db } from "@/lib/db";

// Kontrak worker headless (container Playwright terpisah). Dilindungi
// HEADLESS_SECRET — hanya worker internal yang boleh akses cookie host.
//
// GET → daftar host cookie + cookie-nya, agar worker menarik metrik live
// (session detail) via browser headless memakai cookie host.
export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret") || "";
  if (!process.env.HEADLESS_SECRET || secret !== process.env.HEADLESS_SECRET) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const accounts = await db.shopeeAccount.findMany({
    where: { scope: "cookie", status: { in: ["active", "expiring"] }, cookie: { not: "" } },
    select: { hostId: true, userId: true, cookie: true, host: { select: { name: true } } },
    take: 50,
  });

  return NextResponse.json({
    ok: true,
    targets: accounts.map((a) => ({
      hostId: a.hostId,
      name: a.host?.name ?? "",
      uid: a.userId,
      cookie: a.cookie,
    })),
  });
}
