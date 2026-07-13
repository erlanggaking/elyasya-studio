import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const [devices, products] = await Promise.all([
    db.device.count({ where: { userId: auth.user.id } }),
    db.product.count(),
  ]);
  return NextResponse.json({
    ok: true,
    stats: {
      registered_devices: devices,
      products,
      server_time: new Date().toISOString(),
    },
  });
}
