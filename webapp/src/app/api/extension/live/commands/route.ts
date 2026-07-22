import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";
import { hostTenantWhere } from "@/lib/tenant";

// Kontrak "kontrol via cookie" extension:
//
//  GET  → klaim perintah pending (add/remove/pin item, fetch metrik) untuk host
//         yang terhubung mode cookie. Balas juga template endpoint internal live
//         yang sudah "dipelajari" extension, supaya bisa me-replay perintah.
//
//  POST → lapor hasil eksekusi perintah + (opsional) endpoint yang baru dipelajari
//         + metrik hasil fetch. Body: { results: [...], endpoints: [...] }

const CLAIM_LIMIT = 15;

export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });

  const deviceId = new URL(req.url).searchParams.get("device_id") ?? "";

  const pending = await db.liveCommand.findMany({
    where: { status: "pending", host: hostTenantWhere(auth.user) },
    orderBy: { createdAt: "asc" },
    take: CLAIM_LIMIT,
  });

  if (pending.length > 0) {
    await db.liveCommand.updateMany({
      where: { id: { in: pending.map((c) => c.id) } },
      data: {
        status: "claimed",
        claimedByDevice: deviceId,
        claimedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
  }

  const endpoints = await db.shopeeLiveEndpoint.findMany();

  return NextResponse.json({
    ok: true,
    commands: pending.map((c) => ({
      id: c.id,
      type: c.type,
      host_id: c.hostId,
      live_session_id: c.liveSessionId,
      session_id: c.shopeeSessionId,
      payload: safeParse(c.payload),
    })),
    endpoints: endpoints.map((e) => ({
      action: e.action,
      method: e.method,
      url_template: e.urlTemplate,
      body_template: e.bodyTemplate,
    })),
  });
}

export async function POST(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const results: Array<Record<string, unknown>> = Array.isArray(body.results) ? body.results : [];
  const endpoints: Array<Record<string, unknown>> = Array.isArray(body.endpoints) ? body.endpoints : [];

  // 1) Simpan endpoint internal yang dipelajari extension dari trafik live.
  for (const e of endpoints) {
    const action = String(e.action ?? "").trim();
    const urlTemplate = String(e.url_template ?? e.urlTemplate ?? "").trim();
    if (!/^(add_item|remove_item|show_item|metrics)$/.test(action) || !urlTemplate) continue;
    await db.shopeeLiveEndpoint.upsert({
      where: { action },
      create: {
        action,
        method: String(e.method ?? "POST").toUpperCase(),
        urlTemplate,
        bodyTemplate: String(e.body_template ?? e.bodyTemplate ?? ""),
        sampleBody: JSON.stringify(e.sample_body ?? e.sampleBody ?? {}),
      },
      update: {
        method: String(e.method ?? "POST").toUpperCase(),
        urlTemplate,
        bodyTemplate: String(e.body_template ?? e.bodyTemplate ?? ""),
        sampleBody: JSON.stringify(e.sample_body ?? e.sampleBody ?? {}),
        learnedAt: new Date(),
      },
    });
  }

  // 2) Terapkan hasil tiap perintah.
  let applied = 0;
  for (const r of results) {
    const id = String(r.id ?? "");
    if (!id) continue;
    const ok = r.ok === true;
    const cmd = await db.liveCommand.findFirst({
      where: { id, host: hostTenantWhere(auth.user) },
    });
    if (!cmd) continue;

    await db.liveCommand.update({
      where: { id },
      data: {
        status: ok ? "done" : "failed",
        result: JSON.stringify(r.error ? { error: r.error } : (r.data ?? {})),
        finishedAt: new Date(),
      },
    });
    applied += 1;

    // Perintah fetch_metrics sukses → simpan snapshot metrik (dari cookie host).
    if (ok && cmd.type === "fetch_metrics" && cmd.liveSessionId) {
      const m = (r.data ?? {}) as Record<string, unknown>;
      const gmv = Number(m.gmv ?? 0);
      const ccu = Number(m.ccu ?? m.viewers ?? 0);
      const hasAny =
        gmv || ccu || Number(m.orders ?? 0) || Number(m.views ?? 0) || Number(m.likes ?? 0);
      if (hasAny) {
        const items = await db.liveSessionItem.findMany({
          where: { liveSessionId: cmd.liveSessionId },
          include: { product: { select: { commissionRate: true } } },
        });
        const avgRate =
          items.length > 0
            ? items.reduce((s, i) => s + i.product.commissionRate, 0) / items.length
            : 0;
        await db.metricSnapshot.create({
          data: {
            liveSessionId: cmd.liveSessionId,
            gmv,
            orders: Number(m.orders ?? 0),
            ccu,
            peakCcu: Number(m.peak_ccu ?? m.peakCcu ?? 0),
            views: Number(m.views ?? 0),
            atc: Number(m.atc ?? 0),
            ctr: Number(m.ctr ?? 0),
            co: Number(m.co ?? 0),
            likes: Number(m.likes ?? 0),
            comments: Number(m.comments ?? 0),
            shares: Number(m.shares ?? 0),
            avgViewingDuration: Number(m.avg_viewing_duration ?? m.avgViewingDuration ?? 0),
            estCommission: Math.round((gmv * avgRate) / 100),
          },
        });
      }
    }
  }

  return NextResponse.json({ ok: true, applied });
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
