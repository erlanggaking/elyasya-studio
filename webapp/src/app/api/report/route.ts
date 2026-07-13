import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Agregasi report (PRD §7.2): per sesi → per host → per studio, filter tanggal.
// GMV/komisi diambil dari snapshot TERAKHIR tiap sesi (metrik Shopee kumulatif).
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const studioId = url.searchParams.get("studioId") || undefined;
  const hostId = url.searchParams.get("hostId") || undefined;

  const sessions = await db.liveSession.findMany({
    where: {
      ...(studioId ? { studioId } : {}),
      ...(hostId ? { hostId } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(`${to}T23:59:59`) } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      host: { select: { id: true, name: true } },
      studio: { select: { id: true, name: true } },
      snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
      _count: { select: { items: true } },
    },
  });

  const rows = sessions.map((s) => {
    const m = s.snapshots[0];
    return {
      id: s.id,
      title: s.title,
      status: s.status,
      host: s.host,
      studio: s.studio,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      itemCount: s._count.items,
      gmv: m?.gmv ?? 0,
      orders: m?.orders ?? 0,
      views: m?.views ?? 0,
      peakCcu: m?.peakCcu ?? 0,
      ccu: m?.ccu ?? 0,
      atc: m?.atc ?? 0,
      ctr: m?.ctr ?? 0,
      co: m?.co ?? 0,
      likes: m?.likes ?? 0,
      comments: m?.comments ?? 0,
      shares: m?.shares ?? 0,
      avgViewingDuration: m?.avgViewingDuration ?? 0,
      estCommission: m?.estCommission ?? 0,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      gmv: t.gmv + r.gmv,
      orders: t.orders + r.orders,
      views: t.views + r.views,
      estCommission: t.estCommission + r.estCommission,
      sessions: t.sessions + 1,
      liveNow: t.liveNow + (r.status === "live" ? 1 : 0),
    }),
    { gmv: 0, orders: 0, views: 0, estCommission: 0, sessions: 0, liveNow: 0 }
  );

  // Komisi final approved (Affiliate API — PRD §9.2; kosong sampai integrasi aktif)
  const finalCommission = await db.commissionReport.aggregate({
    where: { status: "approved" },
    _sum: { commissionAmount: true },
  });

  // Agregasi per studio & per host
  const byKey = (key: "studio" | "host") => {
    const map = new Map<string, { name: string; gmv: number; orders: number; views: number; estCommission: number; sessions: number }>();
    for (const r of rows) {
      const ent = key === "studio" ? r.studio : r.host;
      if (!ent) continue;
      const cur = map.get(ent.id) ?? { name: ent.name, gmv: 0, orders: 0, views: 0, estCommission: 0, sessions: 0 };
      cur.gmv += r.gmv;
      cur.orders += r.orders;
      cur.views += r.views;
      cur.estCommission += r.estCommission;
      cur.sessions += 1;
      map.set(ent.id, cur);
    }
    return [...map.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.gmv - a.gmv);
  };

  return NextResponse.json({
    ok: true,
    totals: { ...totals, finalCommission: finalCommission._sum.commissionAmount ?? 0 },
    sessions: rows,
    byStudio: byKey("studio"),
    byHost: byKey("host"),
  });
}
