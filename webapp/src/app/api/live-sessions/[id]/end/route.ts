import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount } from "@/lib/shopee-account";
import { endSession } from "@/lib/shopee";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.liveSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak ditemukan" }, { status: 404 });
  if (session.status !== "live") {
    return NextResponse.json({ ok: false, error: "Sesi tidak sedang live" }, { status: 400 });
  }

  const account = await getActiveAccount(session.hostId);
  if (account) {
    try {
      await endSession(
        { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId },
        session.shopeeSessionId
      );
    } catch (err) {
      // Tetap tandai ended di DB — sesi Shopee bisa saja sudah berakhir sendiri.
      console.error("[endSession]", err);
    }
  }

  const updated = await db.liveSession.update({
    where: { id },
    data: { status: "ended", endedAt: new Date() },
  });
  console.log(`[audit] ${user.email} ended live session ${id}`);
  return NextResponse.json({ ok: true, session: updated });
}
