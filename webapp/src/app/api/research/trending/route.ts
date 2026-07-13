import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTokenUser } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await getTokenUser(req);
  if (!auth) {
    return NextResponse.json({ ok: false, error: "Token tidak valid" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(50, Number(url.searchParams.get("limit")) || 15);
  const rows = await db.trendKeyword.findMany({
    orderBy: [{ count: "desc" }, { lastSeen: "desc" }],
    take: limit,
  });
  return NextResponse.json({
    ok: true,
    keywords: rows.map((r) => ({ keyword: r.keyword, count: r.count })),
  });
}
