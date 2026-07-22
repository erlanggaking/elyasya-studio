import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

const MAX_DEVICES = Number(process.env.EXTENSION_MAX_DEVICES || 5);

export async function POST(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const deviceId = String(body.device_id || "");
  if (!deviceId) {
    return NextResponse.json({ ok: false, error: "device_id wajib" }, { status: 400 });
  }

  const existing = await db.device.findUnique({ where: { deviceId } });
  if (existing && existing.userId !== auth.user.id) {
    return NextResponse.json(
      { ok: false, error: "Device ini sudah terdaftar pada akun lain" },
      { status: 403 }
    );
  }
  if (!existing) {
    const count = await db.device.count({ where: { userId: auth.user.id } });
    if (count >= MAX_DEVICES) {
      return NextResponse.json(
        { ok: false, error: `Maksimal ${MAX_DEVICES} device. Revoke device lama dulu.` },
        { status: 403 }
      );
    }
  }

  const device = await db.device.upsert({
    where: { deviceId },
    create: {
      deviceId,
      label: String(body.label || "Chrome Browser"),
      userAgent: String(body.user_agent || ""),
      accountLabel: String(body.account_label || ""),
      userId: auth.user.id,
      apiTokenId: auth.apiToken.id,
    },
    update: {
      label: String(body.label || "Chrome Browser"),
      userAgent: String(body.user_agent || ""),
      accountLabel: String(body.account_label || ""),
      apiTokenId: auth.apiToken.id,
    },
  });

  return NextResponse.json({
    ok: true,
    device: { id: device.deviceId, label: device.label },
    max_devices: MAX_DEVICES,
  });
}
