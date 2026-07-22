import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { buildAuthorizeUrl, SHOPEE_MOCK } from "@/lib/shopee";
import { hostTenantWhere } from "@/lib/tenant";

// Mulai OAuth flow Shopee untuk satu host (PRD §9.3).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const host = await db.host.findFirst({ where: { id, ...hostTenantWhere(user) } });
  if (!host) return NextResponse.json({ ok: false, error: "Host tidak ditemukan" }, { status: 404 });

  try {
    const authorizeUrl = buildAuthorizeUrl(host.id, user.id);
    return NextResponse.json({ ok: true, authorizeUrl, mock: SHOPEE_MOCK });
  } catch (err) {
    console.error("[shopee/connect]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Konfigurasi Shopee tidak valid" },
      { status: 500 }
    );
  }
}
