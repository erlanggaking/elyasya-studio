import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canAccessHost } from "@/lib/tenant";
import { verifyCookie, normalizeCookie } from "@/lib/shopee-cookie";

// Import cookie sesi Shopee host (seperti tool serverbgs). Validasi cookie →
// ambil uid/username → simpan sebagai akun scope=cookie + set liveUid host.
// Jalur konek untuk akun AFFILIATE yang tidak bisa OAuth Partner API.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canAccessHost(user, id))) {
    return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const rawCookie = String(body.cookie ?? "").trim();
  if (!rawCookie || !/SPC_U=/.test(rawCookie)) {
    return NextResponse.json(
      { ok: false, error: "Cookie tidak valid — pastikan menyalin seluruh cookie dari cookie-editor (harus ada SPC_U, SPC_ST)." },
      { status: 400 }
    );
  }

  const identity = await verifyCookie(rawCookie);
  if (!identity) {
    return NextResponse.json(
      { ok: false, error: "Cookie kedaluwarsa / tidak login. Buka shopee.co.id di HP host, login ulang, lalu ambil cookie baru." },
      { status: 400 }
    );
  }

  const cookie = normalizeCookie(rawCookie);
  const shopId = identity.shopId || identity.uid; // affiliate: pakai uid sbg key
  const shopName = identity.username ? `@${identity.username}` : `UID ${identity.uid}`;

  await db.shopeeAccount.upsert({
    where: { hostId_shopId: { hostId: id, shopId } },
    create: {
      hostId: id,
      shopId,
      userId: identity.uid,
      shopName,
      scope: "cookie",
      cookie,
      status: "active",
    },
    update: {
      userId: identity.uid,
      shopName,
      scope: "cookie",
      cookie,
      status: "active",
      connectedAt: new Date(),
    },
  });

  // liveUid host = uid streamer → deteksi live, durasi, video langsung jalan.
  await db.host.update({ where: { id }, data: { liveUid: identity.uid } });

  console.log(`[import-cookie] host ${id} ← @${identity.username} (uid ${identity.uid}, seller=${identity.isSeller})`);
  return NextResponse.json({
    ok: true,
    identity: { uid: identity.uid, username: identity.username, isSeller: identity.isSeller },
  });
}
