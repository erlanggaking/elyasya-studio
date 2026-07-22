import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { canAccessHost } from "@/lib/tenant";

// Diagnostik jalur "kontrol via cookie" untuk satu host: apakah akun cookie
// terhubung, endpoint kontrol keranjang mana yang sudah dipelajari extension,
// dan hasil beberapa perintah terakhir. Dipakai panel host agar operator bisa
// melihat kesiapan pin/keranjang tanpa menebak.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!(await canAccessHost(user, id))) {
    return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });
  }

  const cookieAccount = await db.shopeeAccount.findFirst({
    where: { hostId: id, scope: "cookie", status: "active" },
    orderBy: { connectedAt: "desc" },
  });

  const endpoints = await db.shopeeLiveEndpoint.findMany({
    select: { action: true, learnedAt: true },
  });
  const learned = Object.fromEntries(endpoints.map((e) => [e.action, e.learnedAt]));

  const recent = await db.liveCommand.findMany({
    where: { hostId: id },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { type: true, status: true, result: true, createdAt: true, finishedAt: true },
  });

  return NextResponse.json({
    ok: true,
    cookieConnected: !!cookieAccount,
    shopName: cookieAccount?.shopName ?? "",
    lastSeen: cookieAccount?.connectedAt ?? null,
    // Aksi kritis untuk pin/keranjang: add_item + show_item. Dianggap "siap"
    // jika keduanya sudah dipelajari dari trafik live asli host.
    endpointsLearned: {
      add_item: !!learned.add_item,
      show_item: !!learned.show_item,
      remove_item: !!learned.remove_item,
      metrics: !!learned.metrics,
    },
    controlReady: !!learned.add_item && !!learned.show_item,
    recentCommands: recent.map((c) => ({
      type: c.type,
      status: c.status,
      error: safeError(c.result),
      at: c.finishedAt ?? c.createdAt,
    })),
  });
}

function safeError(s: string): string {
  try {
    const o = JSON.parse(s);
    return typeof o?.error === "string" ? o.error : "";
  } catch {
    return "";
  }
}
