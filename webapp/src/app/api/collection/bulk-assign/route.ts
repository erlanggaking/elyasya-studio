import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

// Bulk action Koleksi → kirim ke studio dan/atau host (PRD §7.3).
// Item tetap di Koleksi; hanya membuat Assignment (many-to-many).
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const entryIds: string[] = Array.isArray(body.entryIds) ? body.entryIds : [];
  const studioIds: string[] = Array.isArray(body.studioIds) ? body.studioIds : [];
  const hostIds: string[] = Array.isArray(body.hostIds) ? body.hostIds : [];

  if (entryIds.length === 0 || (studioIds.length === 0 && hostIds.length === 0)) {
    return NextResponse.json(
      { ok: false, error: "Pilih produk dan minimal satu studio/host tujuan" },
      { status: 400 }
    );
  }

  let created = 0;
  for (const entryId of entryIds) {
    for (const studioId of studioIds) {
      const exists = await db.assignment.findFirst({
        where: { collectionEntryId: entryId, targetType: "studio", studioId, status: "pending" },
      });
      if (!exists) {
        await db.assignment.create({
          data: { collectionEntryId: entryId, targetType: "studio", studioId },
        });
        created += 1;
      }
    }
    for (const hostId of hostIds) {
      const exists = await db.assignment.findFirst({
        where: { collectionEntryId: entryId, targetType: "host", hostId, status: "pending" },
      });
      if (!exists) {
        await db.assignment.create({
          data: { collectionEntryId: entryId, targetType: "host", hostId },
        });
        created += 1;
      }
    }
  }

  return NextResponse.json({ ok: true, created });
}
