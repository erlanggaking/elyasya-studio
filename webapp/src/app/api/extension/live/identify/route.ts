import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";
import { hostTenantWhere } from "@/lib/tenant";

// Extension melaporkan identitas akun Shopee yang SEDANG login di browser host
// (hasil baca cookie: uid streamer, username, shop). Server menautkannya ke host
// dan membuat ShopeeAccount mode "cookie" — host jadi "terhubung" tanpa OAuth /
// tanpa halaman login username-password Shopee.
//
// Body: { uid, username?, shopId?, shopName?, deviceId?, hostId? }
export async function POST(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid ?? "").trim();
  const username = String(body.username ?? "").trim();
  const shopId = String(body.shopId ?? "").trim() || uid;
  const shopName = String(body.shopName ?? "").trim();
  const deviceId = String(body.deviceId ?? "").trim();
  const wantHostId = String(body.hostId ?? "").trim();

  if (!uid && !username) {
    return NextResponse.json(
      { ok: false, error: "uid/username kosong — pastikan sudah login Shopee di browser ini" },
      { status: 400 }
    );
  }

  // Tentukan host tujuan: eksplisit (dari popup) atau cocokkan uid/username.
  const tenantWhere = hostTenantWhere(auth.user);
  let host = wantHostId
    ? await db.host.findFirst({ where: { id: wantHostId, ...tenantWhere } })
    : null;
  if (!host && uid) host = await db.host.findFirst({ where: { liveUid: uid, ...tenantWhere } });
  if (!host && username) {
    const all = await db.host.findMany({
      where: { liveUsername: { not: "" }, ...tenantWhere },
    });
    host = all.find((h) => h.liveUsername.toLowerCase() === username.toLowerCase()) ?? null;
  }
  if (!host) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Host belum dikenali. Buka panel host di dashboard lalu klik 'Hubungkan via Cookie', " +
          "atau isi username live host lebih dulu.",
        uid,
        username,
      },
      { status: 404 }
    );
  }

  await db.host.update({
    where: { id: host.id },
    data: {
      ...(uid ? { liveUid: uid } : {}),
      ...(username && !host.liveUsername ? { liveUsername: username } : {}),
    },
  });

  const account = await db.shopeeAccount.upsert({
    where: { hostId_shopId: { hostId: host.id, shopId } },
    create: {
      hostId: host.id,
      shopId,
      userId: uid,
      shopName: shopName || (username ? `@${username}` : `Shop ${shopId}`),
      scope: "cookie",
      status: "active",
      connectorDeviceId: deviceId,
    },
    update: {
      userId: uid || undefined,
      ...(shopName ? { shopName } : {}),
      scope: "cookie",
      status: "active",
      connectorDeviceId: deviceId,
      connectedAt: new Date(),
    },
  });

  console.log(`[live/identify] host ${host.name} ← cookie akun uid=${uid} shop=${shopId}`);
  return NextResponse.json({
    ok: true,
    host: { id: host.id, name: host.name },
    account: { id: account.id, scope: account.scope, shopName: account.shopName },
  });
}
