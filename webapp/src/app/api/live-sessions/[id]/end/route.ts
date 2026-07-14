import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount } from "@/lib/shopee-account";
import { endSession, SHOPEE_MOCK } from "@/lib/shopee";
import { getSessionLiveState } from "@/lib/shopee-live";

// Akhiri live host: kirim end_session ke Shopee, VERIFIKASI live benar-benar
// berhenti, baru tandai selesai di DB. Tidak ada sukses palsu — kalau Shopee
// menolak, error dikembalikan apa adanya. body.force=true → tutup sesi di
// panel saja (live asli dibiarkan; untuk sesi basi/tidak terkendali).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const force = body.force === true;

  const session = await db.liveSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak ditemukan" }, { status: 404 });
  if (session.status !== "live") {
    return NextResponse.json({ ok: false, error: "Sesi tidak sedang live" }, { status: 400 });
  }

  const markEnded = async () => {
    const updated = await db.liveSession.update({
      where: { id },
      data: { status: "ended", endedAt: new Date() },
    });
    console.log(`[audit] ${user.email} ended live session ${id}${force ? " (force)" : ""}`);
    return updated;
  };

  if (force || SHOPEE_MOCK || !session.shopeeSessionId) {
    return NextResponse.json({ ok: true, session: await markEnded(), forced: force });
  }

  // Live-nya mungkin memang sudah berakhir sendiri — cek dulu.
  const before = await getSessionLiveState(session.shopeeSessionId);
  if (before.state === "ended") {
    return NextResponse.json({ ok: true, session: await markEnded() });
  }

  const account = await getActiveAccount(session.hostId);
  if (!account) {
    return NextResponse.json(
      {
        ok: false,
        needsForce: true,
        error:
          "Akun Shopee host tidak aktif (perlu Reconnect) — perintah stop tidak bisa dikirim. Live di HP host masih berjalan.",
      },
      { status: 409 }
    );
  }

  let apiError = "";
  try {
    await endSession(
      { accessToken: account.accessToken, shopId: account.shopId, userId: account.userId },
      session.shopeeSessionId
    );
  } catch (err) {
    apiError = err instanceof Error ? err.message : "end_session gagal";
    console.error("[endSession]", apiError);
  }

  // Verifikasi hasil ke Shopee (beri jeda sebentar untuk propagasi).
  await new Promise((r) => setTimeout(r, 1500));
  const after = await getSessionLiveState(session.shopeeSessionId);

  if (after.state === "ended" || (!apiError && after.state !== "live")) {
    return NextResponse.json({ ok: true, session: await markEnded(), remoteEnded: true });
  }

  return NextResponse.json(
    {
      ok: false,
      needsForce: true,
      error: apiError
        ? `Shopee menolak menghentikan live: ${apiError}`
        : "Perintah terkirim tapi live di Shopee masih berjalan — coba lagi, atau host stop dari HP.",
    },
    { status: 502 }
  );
}
