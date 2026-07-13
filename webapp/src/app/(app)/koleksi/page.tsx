"use client";

import { useCallback, useEffect, useState } from "react";
import { api, rupiah, num } from "@/lib/ui";

type Entry = {
  id: string;
  tags: string[];
  addedAt: string;
  product: {
    id: string;
    itemId: string;
    shopId: string;
    name: string;
    imageUrl: string;
    price: number;
    commissionRate: number;
    sold: number;
    source: string;
  };
  sentTo: string[];
};

type Target = { id: string; name: string };

export default function KoleksiPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [sent, setSent] = useState("");
  const [minComm, setMinComm] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSend, setShowSend] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [studios, setStudios] = useState<Target[]>([]);
  const [hosts, setHosts] = useState<Target[]>([]);
  const [targetStudios, setTargetStudios] = useState<Set<string>>(new Set());
  const [targetHosts, setTargetHosts] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [manual, setManual] = useState({ itemId: "", shopId: "", name: "", price: "", commissionRate: "", tags: "" });

  const pageSize = 24;

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) qs.set("q", q);
    if (tag) qs.set("tag", tag);
    if (sent) qs.set("sent", sent);
    if (minComm) qs.set("minComm", minComm);
    const r = await api<{ entries: Entry[]; total: number }>(`/api/collection?${qs}`);
    if (r.ok) {
      setEntries(r.entries);
      setTotal(r.total);
    }
  }, [page, q, tag, sent, minComm]);

  useEffect(() => { load(); }, [load]);

  async function openSend() {
    const [s, h] = await Promise.all([
      api<{ studios: Target[] }>("/api/studios"),
      api<{ hosts: Target[] }>("/api/hosts?pageSize=100"),
    ]);
    if (s.ok) setStudios(s.studios);
    if (h.ok) setHosts(h.hosts);
    setShowSend(true);
  }

  async function doSend() {
    const r = await api<{ created: number }>("/api/collection/bulk-assign", {
      method: "POST",
      body: JSON.stringify({
        entryIds: [...selected],
        studioIds: [...targetStudios],
        hostIds: [...targetHosts],
      }),
    });
    if (r.ok) {
      setMsg(`✅ ${r.created} assignment dibuat`);
      setShowSend(false);
      setSelected(new Set());
      setTargetStudios(new Set());
      setTargetHosts(new Set());
      load();
    } else setMsg(`❌ ${r.error}`);
  }

  async function addManual() {
    const r = await api("/api/collection", {
      method: "POST",
      body: JSON.stringify({
        ...manual,
        price: Number(manual.price) || 0,
        commissionRate: Number(manual.commissionRate) || 0,
      }),
    });
    if (r.ok) {
      setShowAdd(false);
      setManual({ itemId: "", shopId: "", name: "", price: "", commissionRate: "", tags: "" });
      load();
    } else setMsg(`❌ ${r.error}`);
  }

  async function updateTags(entry: Entry) {
    const t = prompt("Tags (pisahkan dengan koma):", entry.tags.join(","));
    if (t === null) return;
    await api("/api/collection", {
      method: "PATCH",
      body: JSON.stringify({ id: entry.id, tags: t }),
    });
    load();
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Koleksi</h1>
          <p className="text-zinc-400 text-sm">{total} produk hasil riset & manual</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
          + Tambah Manual
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 text-sm">
        <input placeholder="Cari nama produk…" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 w-56 outline-none focus:border-orange-500" />
        <input placeholder="Tag…" value={tag}
          onChange={(e) => { setTag(e.target.value); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 w-32 outline-none focus:border-orange-500" />
        <input placeholder="Min. komisi %" type="number" value={minComm}
          onChange={(e) => { setMinComm(e.target.value); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 w-32 outline-none focus:border-orange-500" />
        <select value={sent} onChange={(e) => { setSent(e.target.value); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
          <option value="">Semua status</option>
          <option value="no">Belum dikirim</option>
          <option value="yes">Sudah dikirim</option>
        </select>
      </div>

      {msg && <p className="text-sm">{msg}</p>}

      {/* Grid produk */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {entries.map((e) => (
          <div key={e.id}
            onClick={() => toggle(e.id)}
            className={`rounded-xl border p-3 cursor-pointer transition ${
              selected.has(e.id)
                ? "border-orange-500 bg-orange-600/10"
                : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
            }`}>
            <div className="aspect-square rounded-lg bg-zinc-800 overflow-hidden mb-2 relative">
              {e.product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={e.product.imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl">📦</div>
              )}
              {selected.has(e.id) && (
                <div className="absolute top-1.5 right-1.5 bg-orange-500 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">✓</div>
              )}
            </div>
            <div className="text-xs line-clamp-2 h-8">{e.product.name}</div>
            <div className="font-bold text-sm mt-1">{rupiah(e.product.price)}</div>
            <div className="flex justify-between text-[11px] text-zinc-400 mt-0.5">
              <span className="text-emerald-400 font-semibold">
                {e.product.commissionRate > 0 ? `${e.product.commissionRate}% komisi` : "komisi —"}
              </span>
              <span>{num(e.product.sold)} terjual</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5 min-h-5">
              {e.tags.map((t) => (
                <span key={t} className="text-[10px] bg-zinc-800 rounded px-1.5 py-0.5 text-zinc-300">{t}</span>
              ))}
              <button onClick={(ev) => { ev.stopPropagation(); updateTags(e); }}
                className="text-[10px] text-zinc-500 hover:text-orange-400">+tag</button>
            </div>
            {e.sentTo.length > 0 && (
              <div className="text-[10px] text-sky-400 mt-1 line-clamp-1" title={e.sentTo.join(", ")}>
                → {e.sentTo.join(", ")}
              </div>
            )}
          </div>
        ))}
        {entries.length === 0 && (
          <div className="col-span-full py-16 text-center text-zinc-500">
            Belum ada produk. Riset pakai extension di Shopee, atau tambah manual.
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}
            className="bg-zinc-800 rounded px-3 py-1.5 disabled:opacity-40">‹ Prev</button>
          <span className="text-zinc-400">Hal {page}/{totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
            className="bg-zinc-800 rounded px-3 py-1.5 disabled:opacity-40">Next ›</button>
        </div>
      )}

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4 z-40">
          <span className="text-sm font-medium">{selected.size} produk dipilih</span>
          <button onClick={openSend}
            className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
            Kirim ke Live Management →
          </button>
          <button onClick={() => setSelected(new Set())} className="text-zinc-400 text-sm hover:text-zinc-100">
            Batal
          </button>
        </div>
      )}

      {/* Modal kirim */}
      {showSend && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowSend(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Kirim {selected.size} produk</h2>
            <p className="text-zinc-400 text-sm mb-4">Pilih studio dan/atau host tujuan (bisa lebih dari satu).</p>

            <h3 className="text-sm font-semibold mb-2">Studio</h3>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {studios.map((s) => (
                <label key={s.id} className={`border rounded-lg px-3 py-2 text-sm cursor-pointer ${targetStudios.has(s.id) ? "border-orange-500 bg-orange-600/10" : "border-zinc-700"}`}>
                  <input type="checkbox" className="mr-2" checked={targetStudios.has(s.id)}
                    onChange={() => setTargetStudios((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                  {s.name}
                </label>
              ))}
              {studios.length === 0 && <p className="text-zinc-500 text-sm col-span-2">Belum ada studio.</p>}
            </div>

            <h3 className="text-sm font-semibold mb-2">Host</h3>
            <div className="grid grid-cols-2 gap-2 mb-5 max-h-48 overflow-y-auto">
              {hosts.map((h) => (
                <label key={h.id} className={`border rounded-lg px-3 py-2 text-sm cursor-pointer ${targetHosts.has(h.id) ? "border-orange-500 bg-orange-600/10" : "border-zinc-700"}`}>
                  <input type="checkbox" className="mr-2" checked={targetHosts.has(h.id)}
                    onChange={() => setTargetHosts((p) => { const n = new Set(p); if (n.has(h.id)) n.delete(h.id); else n.add(h.id); return n; })} />
                  {h.name}
                </label>
              ))}
              {hosts.length === 0 && <p className="text-zinc-500 text-sm col-span-2">Belum ada host.</p>}
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSend(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={doSend}
                disabled={targetStudios.size === 0 && targetHosts.size === 0}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                Kirim Sekarang
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal tambah manual */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Tambah Produk Manual</h2>
            <div className="space-y-3 text-sm">
              {([
                ["name", "Nama produk *"],
                ["itemId", "Item ID Shopee *"],
                ["shopId", "Shop ID Shopee *"],
                ["price", "Harga (Rp)"],
                ["commissionRate", "Rate komisi (%)"],
                ["tags", "Tags (pisah koma)"],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-zinc-400">{label}</label>
                  <input value={manual[key]} onChange={(e) => setManual({ ...manual, [key]: e.target.value })}
                    className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={addManual} className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
