import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount, withActiveAccount } from "@/lib/shopee-account";
import { getSessionMetric, SHOPEE_MOCK } from "@/lib/shopee";
import { isCookieAccount, enqueueLiveCommand } from "@/lib/live-commands";
import { sessionTenantWhere } from "@/lib/tenant";

// Polling metrik sesi live (PRD §11): proxy getSessionMetric + simpan snapshot.
// Throttle ringan: panel polling 10 detik, snapshot < 8 detik cukup segar.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const session = await db.liveSession.findFirst({
    where: { id, ...sessionTenantWhere(user) },
    include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak ditemukan" }, { status: 404 });

  const last = session.snapshots[0];
  const fresh = last && Date.now() - last.capturedAt.getTime() < 8000;

  if (session.status !== "live" || fresh) {
    return NextResponse.json({ ok: true, metrics: last ?? null, live: session.status === "live" });
  }

  if (!session.shopeeSessionId) {
    return NextResponse.json({ ok: true, metrics: last ?? null, live: true });
  }

  // Sesi hasil "tautkan link live" tidak punya akun OAuth — di mode mock tetap
  // hasilkan metrik simulasi; di mode real balas snapshot terakhir saja.
  const account = await getActiveAccount(session.hostId);

  // Host mode cookie: metrik diambil extension via cookie host. Titipkan perintah
  // fetch_metrics (dikonsumsi extension), lalu balas snapshot terakhir yang sudah
  // disetor extension. Panel auto-refresh akan menampilkan angka terbaru.
  if (isCookieAccount(account)) {
    // Hindari menumpuk: hanya titip 1 perintah fetch_metrics yang belum selesai.
    const pendingFetch = await db.liveCommand.findFirst({
      where: { liveSessionId: session.id, type: "fetch_metrics", status: { in: ["pending", "claimed"] } },
    });
    if (!pendingFetch) {
      await enqueueLiveCommand({
        hostId: session.hostId,
        liveSessionId: session.id,
        shopeeSessionId: session.shopeeSessionId,
        type: "fetch_metrics",
        payload: { session_id: session.shopeeSessionId },
      });
    }
    return NextResponse.json({ ok: true, metrics: last ?? null, live: true, source: "cookie" });
  }

  if (!account && !SHOPEE_MOCK) {
    return NextResponse.json({ ok: true, metrics: last ?? null, live: true, warning: "token" });
  }

  try {
    const m = SHOPEE_MOCK
      ? await getSessionMetric(
          { accessToken: "", shopId: "", userId: "" },
          session.shopeeSessionId,
          session.startedAt ?? undefined
        )
      : await withActiveAccount(session.hostId, (active) =>
          getSessionMetric(
            { accessToken: active.accessToken, shopId: active.shopId, userId: active.userId },
            session.shopeeSessionId,
            session.startedAt ?? undefined
          )
        );

    // estimasi komisi = Σ (gmv proporsional × rata-rata rate item di cart)
    const items = await db.liveSessionItem.findMany({
      where: { liveSessionId: id },
      include: { product: { select: { commissionRate: true } } },
    });
    const avgRate =
      items.length > 0
        ? items.reduce((s, i) => s + i.product.commissionRate, 0) / items.length
        : 0;
    const estCommission = Math.round(((m.gmv ?? 0) * avgRate) / 100);

    const snapshot = await db.metricSnapshot.create({
      data: {
        liveSessionId: id,
        gmv: m.gmv ?? 0,
        orders: m.orders ?? 0,
        ccu: m.ccu ?? 0,
        peakCcu: m.peak_ccu ?? 0,
        views: m.views ?? 0,
        atc: m.atc ?? 0,
        ctr: m.ctr ?? 0,
        co: m.co ?? 0,
        likes: m.likes ?? 0,
        comments: m.comments ?? 0,
        shares: m.shares ?? 0,
        avgViewingDuration: m.avg_viewing_duration ?? 0,
        estCommission,
      },
    });
    return NextResponse.json({ ok: true, metrics: snapshot, live: true });
  } catch (err) {
    console.error("[metrics]", err);
    return NextResponse.json({ ok: true, metrics: last ?? null, live: true, warning: "api" });
  }
}
