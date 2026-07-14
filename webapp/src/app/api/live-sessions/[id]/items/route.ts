import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getActiveAccount } from "@/lib/shopee-account";
import { addItemList, deleteItemList, updateShowItem, SHOPEE_MOCK } from "@/lib/shopee";

// Push produk (dari assignment atau langsung) ke live cart Shopee.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const assignmentIds: string[] = Array.isArray(body.assignmentIds) ? body.assignmentIds : [];

  const session = await db.liveSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak ditemukan" }, { status: 404 });
  if (session.status !== "live") {
    return NextResponse.json({ ok: false, error: "Sesi tidak sedang live" }, { status: 400 });
  }

  // Mode mock: sesi hasil tautan link tetap bisa kelola keranjang tanpa OAuth.
  const account = await getActiveAccount(session.hostId);
  if (!account && !SHOPEE_MOCK) {
    return NextResponse.json({ ok: false, error: "Akun Shopee host tidak aktif" }, { status: 400 });
  }

  const assignments = await db.assignment.findMany({
    where: { id: { in: assignmentIds }, status: "pending" },
    include: { collectionEntry: { include: { product: true } } },
  });
  if (assignments.length === 0) {
    return NextResponse.json({ ok: false, error: "Tidak ada produk valid untuk di-push" }, { status: 400 });
  }

  const items = assignments.map((a) => ({
    item_id: Number(a.collectionEntry.product.itemId),
    shop_id: Number(a.collectionEntry.product.shopId),
  }));

  try {
    const ctx = { accessToken: account?.accessToken ?? "", shopId: account?.shopId ?? "", userId: account?.userId ?? "" };
    await addItemList(ctx, session.shopeeSessionId, items);
  } catch (err) {
    console.error("[addItemList]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Shopee addItemList gagal" },
      { status: 502 }
    );
  }

  const maxNo = await db.liveSessionItem.count({ where: { liveSessionId: id } });
  let no = maxNo;
  let pushed = 0;
  for (const a of assignments) {
    no += 1;
    await db.liveSessionItem.upsert({
      where: {
        liveSessionId_productId: {
          liveSessionId: id,
          productId: a.collectionEntry.productId,
        },
      },
      create: {
        liveSessionId: id,
        productId: a.collectionEntry.productId,
        itemNo: no,
        sourceAssignmentId: a.id,
      },
      update: {},
    });
    await db.assignment.update({ where: { id: a.id }, data: { status: "pushed" } });
    pushed += 1;
  }

  // pin: true → langsung tampilkan (pin) produk pertama yang barusan di-push.
  if (body.pin === true && assignments.length > 0) {
    const target = await db.liveSessionItem.findUnique({
      where: {
        liveSessionId_productId: {
          liveSessionId: id,
          productId: assignments[0].collectionEntry.productId,
        },
      },
      include: { product: true },
    });
    if (target) {
      try {
        await updateShowItem(
          { accessToken: account?.accessToken ?? "", shopId: account?.shopId ?? "", userId: account?.userId ?? "" },
          session.shopeeSessionId,
          { item_id: Number(target.product.itemId), shop_id: Number(target.product.shopId) }
        );
        await db.liveSessionItem.updateMany({ where: { liveSessionId: id }, data: { isShowing: false } });
        await db.liveSessionItem.update({ where: { id: target.id }, data: { isShowing: true } });
      } catch (err) {
        console.error("[push+pin]", err);
      }
    }
  }

  console.log(`[audit] ${user.email} pushed ${pushed} items to session ${id}`);
  return NextResponse.json({ ok: true, pushed });
}

// Hapus item dari live cart / tandai show item
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const itemDbId = String(body.itemId || "");

  const session = await db.liveSession.findUnique({ where: { id } });
  if (!session) return NextResponse.json({ ok: false, error: "Sesi tidak ditemukan" }, { status: 404 });

  const item = await db.liveSessionItem.findUnique({
    where: { id: itemDbId },
    include: { product: true },
  });
  if (!item) return NextResponse.json({ ok: false, error: "Item tidak ditemukan" }, { status: 404 });

  const account = await getActiveAccount(session.hostId);
  if (!account && !SHOPEE_MOCK) {
    return NextResponse.json({ ok: false, error: "Akun Shopee host tidak aktif" }, { status: 400 });
  }
  const ctx = { accessToken: account?.accessToken ?? "", shopId: account?.shopId ?? "", userId: account?.userId ?? "" };
  const shopeeItem = {
    item_id: Number(item.product.itemId),
    shop_id: Number(item.product.shopId),
  };

  try {
    if (action === "remove") {
      await deleteItemList(ctx, session.shopeeSessionId, [shopeeItem]);
      await db.liveSessionItem.delete({ where: { id: itemDbId } });
      if (item.sourceAssignmentId) {
        await db.assignment.update({
          where: { id: item.sourceAssignmentId },
          data: { status: "pending" },
        });
      }
    } else if (action === "show") {
      await updateShowItem(ctx, session.shopeeSessionId, shopeeItem);
      await db.liveSessionItem.updateMany({
        where: { liveSessionId: id },
        data: { isShowing: false },
      });
      await db.liveSessionItem.update({
        where: { id: itemDbId },
        data: { isShowing: true },
      });
    } else {
      return NextResponse.json({ ok: false, error: "Action tidak dikenal" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[items PATCH]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Shopee API gagal" },
      { status: 502 }
    );
  }
}
