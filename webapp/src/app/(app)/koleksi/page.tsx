"use client";

import { useCallback, useEffect, useState } from "react";
import { api, rupiah, num } from "@/lib/ui";

type Entry = {
  id: string;
  tags: string[];
  folderId: string | null;
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
    sold30d: number;
    rating: number;
    trend: number;
    source: string;
  };
  sentTo: string[];
};

type Target = { id: string; name: string };
type Folder = { id: string; name: string; count: number };

export default function KoleksiPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [sent, setSent] = useState("");
  const [minComm, setMinComm] = useState("");
  const [sort, setSort] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSend, setShowSend] = useState(false);
  const [sendMode, setSendMode] = useState<"" | "studio" | "host">("");
  const [showAdd, setShowAdd] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeFolder, setActiveFolder] = useState(""); // "" semua | "none" tanpa folder | id folder
  const [showFolder, setShowFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [showMove, setShowMove] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
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
    if (sort) qs.set("sort", sort);
    if (activeFolder) qs.set("folder", activeFolder);
    const r = await api<{ entries: Entry[]; total: number }>(`/api/collection?${qs}`);
    if (r.ok) {
      setEntries(r.entries);
      setTotal(r.total);
    }
  }, [page, q, tag, sent, minComm, sort, activeFolder]);

  const loadFolders = useCallback(async () => {
    const r = await api<{ folders: Folder[] }>("/api/collection/folders");
    if (r.ok) setFolders(r.folders);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadFolders(); }, [loadFolders]);

  async function openSend() {
    const [s, h] = await Promise.all([
      api<{ studios: Target[] }>("/api/studios"),
      api<{ hosts: Target[] }>("/api/hosts?pageSize=100"),
    ]);
    if (s.ok) setStudios(s.studios);
    if (h.ok) setHosts(h.hosts);
    setSendMode("");
    setShowSend(true);
  }

  async function doSend() {
    const r = await api<{ created: number }>("/api/collection/bulk-assign", {
      method: "POST",
      body: JSON.stringify({
        entryIds: [...selected],
        studioIds: sendMode === "studio" ? [...targetStudios] : [],
        hostIds: sendMode === "host" ? [...targetHosts] : [],
      }),
    });
    if (r.ok) {
      setMsg(`✅ ${r.created} assignment dibuat`);
      setShowSend(false);
      setSendMode("");
      setSelected(new Set());
      setTargetStudios(new Set());
      setTargetHosts(new Set());
      load();
    } else setMsg(`❌ ${r.error}`);
  }

  async function doReset() {
    setResetBusy(true);
    const r = await api<{ removed: number }>("/api/collection", {
      method: "DELETE",
      body: JSON.stringify({ all: true }),
    });
    setResetBusy(false);
    setShowReset(false);
    if (r.ok) {
      setMsg(`✅ Koleksi direset (${r.removed} produk dihapus)`);
      setSelected(new Set());
      setPage(1);
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

  async function createFolder() {
    const name = folderName.trim();
    if (!name) return;
    const r = await api<{ folder: { id: string } }>("/api/collection/folders", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (r.ok) {
      setShowFolder(false);
      setFolderName("");
      setMsg(`✅ Folder "${name}" dibuat`);
      loadFolders();
    } else setMsg(`❌ ${r.error}`);
  }

  async function renameFolder(f: Folder) {
    const name = prompt("Nama folder baru:", f.name);
    if (name === null || !name.trim()) return;
    const r = await api("/api/collection/folders", {
      method: "PATCH",
      body: JSON.stringify({ id: f.id, name: name.trim() }),
    });
    if (!r.ok) setMsg(`❌ ${r.error}`);
    loadFolders();
  }

  async function deleteFolder(f: Folder) {
    if (!confirm(`Hapus folder "${f.name}"? Produk di dalamnya tidak ikut terhapus, hanya jadi tanpa folder.`)) return;
    const r = await api("/api/collection/folders", {
      method: "DELETE",
      body: JSON.stringify({ id: f.id }),
    });
    if (r.ok) {
      if (activeFolder === f.id) setActiveFolder("");
      setMsg(`✅ Folder "${f.name}" dihapus`);
      loadFolders();
      load();
    } else setMsg(`❌ ${r.error}`);
  }

  async function moveToFolder(folderId: string | null) {
    const r = await api<{ moved: number }>("/api/collection", {
      method: "PATCH",
      body: JSON.stringify({ ids: [...selected], folderId }),
    });
    if (r.ok) {
      const target = folderId ? folders.find((f) => f.id === folderId)?.name : "Tanpa Folder";
      setMsg(`✅ ${r.moved} produk dipindah ke ${target}`);
      setShowMove(false);
      setSelected(new Set());
      loadFolders();
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
        <div className="flex gap-2">
          <button onClick={() => setShowReset(true)}
            className="bg-red-900/40 hover:bg-red-900/70 border border-red-800 text-red-300 rounded-lg px-4 py-2 text-sm font-medium">
            ↺ Reset
          </button>
          <button onClick={() => setShowFolder(true)}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
            📁 Tambah Folder
          </button>
          <button onClick={() => setShowAdd(true)}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
            + Tambah Manual
          </button>
        </div>
      </div>

      {/* Tab folder */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => { setActiveFolder(""); setPage(1); }}
          className={`rounded-lg px-3 py-1.5 border transition ${
            activeFolder === "" ? "border-orange-500 bg-orange-600/10 text-orange-300" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
          }`}>
          Semua
        </button>
        {folders.map((f) => (
          <span key={f.id}
            className={`rounded-lg border transition inline-flex items-center ${
              activeFolder === f.id ? "border-orange-500 bg-orange-600/10 text-orange-300" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
            }`}>
            <button onClick={() => { setActiveFolder(f.id); setPage(1); }} className="px-3 py-1.5">
              📁 {f.name} <span className="text-zinc-500">({f.count})</span>
            </button>
            {activeFolder === f.id && (
              <span className="flex items-center gap-1 pr-2">
                <button onClick={() => renameFolder(f)} title="Ganti nama"
                  className="text-zinc-500 hover:text-orange-400">✎</button>
                <button onClick={() => deleteFolder(f)} title="Hapus folder"
                  className="text-zinc-500 hover:text-red-400">🗑</button>
              </span>
            )}
          </span>
        ))}
        <button onClick={() => { setActiveFolder("none"); setPage(1); }}
          className={`rounded-lg px-3 py-1.5 border transition ${
            activeFolder === "none" ? "border-orange-500 bg-orange-600/10 text-orange-300" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
          }`}>
          Tanpa Folder
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
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
          <option value="">Urutkan: Terbaru</option>
          <option value="trend">Urutkan: Tren</option>
          <option value="sold30d">Urutkan: Penjualan 30 Hari</option>
          <option value="komisi">Urutkan: Komisi</option>
          <option value="rating">Urutkan: Rating</option>
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
              <input type="checkbox" checked={selected.has(e.id)} readOnly
                className="absolute top-1.5 left-1.5 w-4 h-4 accent-orange-500 cursor-pointer" />
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
              <span>{num(e.product.sold30d || e.product.sold)} /30hr</span>
            </div>
            <div className="flex justify-between text-[11px] text-zinc-400 mt-0.5">
              <span className="text-yellow-400">
                {e.product.rating > 0 ? `★ ${e.product.rating.toFixed(1)}` : "★ —"}
              </span>
              {e.product.trend !== 0 && (
                <span className={e.product.trend > 0 ? "text-emerald-400" : "text-red-400"}>
                  {e.product.trend > 0 ? "▲" : "▼"} {Math.abs(e.product.trend).toFixed(0)}%
                </span>
              )}
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
            Kirim ke Live →
          </button>
          <button onClick={() => setShowMove(true)}
            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg px-4 py-2 text-sm font-semibold">
            📁 Pindah Folder
          </button>
          <button onClick={() => setSelected(new Set())} className="text-zinc-400 text-sm hover:text-zinc-100">
            Batal
          </button>
        </div>
      )}

      {/* Modal kirim — langkah 1 pilih tujuan (host/studio), langkah 2 pilih daftarnya */}
      {showSend && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowSend(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Kirim {selected.size} produk ke Live</h2>

            {sendMode === "" && (
              <>
                <p className="text-zinc-400 text-sm mb-4">Mau dikirim ke mana?</p>
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <button onClick={() => setSendMode("host")}
                    className="border border-zinc-700 hover:border-orange-500 hover:bg-orange-600/10 rounded-xl p-5 text-center transition">
                    <div className="text-3xl mb-2">🎤</div>
                    <div className="font-semibold">Kirim ke Host</div>
                    <div className="text-xs text-zinc-400 mt-1">{hosts.length} host tersedia</div>
                  </button>
                  <button onClick={() => setSendMode("studio")}
                    className="border border-zinc-700 hover:border-orange-500 hover:bg-orange-600/10 rounded-xl p-5 text-center transition">
                    <div className="text-3xl mb-2">🏢</div>
                    <div className="font-semibold">Kirim ke Studio</div>
                    <div className="text-xs text-zinc-400 mt-1">{studios.length} studio tersedia</div>
                  </button>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setShowSend(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
                </div>
              </>
            )}

            {sendMode === "studio" && (
              <>
                <p className="text-zinc-400 text-sm mb-4">Pilih studio tujuan (bisa lebih dari satu).</p>
                <div className="grid grid-cols-2 gap-2 mb-5 max-h-64 overflow-y-auto">
                  {studios.map((s) => (
                    <label key={s.id} className={`border rounded-lg px-3 py-2 text-sm cursor-pointer ${targetStudios.has(s.id) ? "border-orange-500 bg-orange-600/10" : "border-zinc-700"}`}>
                      <input type="checkbox" className="mr-2 accent-orange-500" checked={targetStudios.has(s.id)}
                        onChange={() => setTargetStudios((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                      {s.name}
                    </label>
                  ))}
                  {studios.length === 0 && <p className="text-zinc-500 text-sm col-span-2">Belum ada studio. Buat dulu di menu Live.</p>}
                </div>
                <div className="flex gap-2 justify-between">
                  <button onClick={() => setSendMode("")} className="px-4 py-2 text-sm text-zinc-400">‹ Kembali</button>
                  <button onClick={doSend} disabled={targetStudios.size === 0}
                    className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                    Kirim ke {targetStudios.size} Studio
                  </button>
                </div>
              </>
            )}

            {sendMode === "host" && (
              <>
                <p className="text-zinc-400 text-sm mb-4">Pilih host tujuan (bisa lebih dari satu).</p>
                <div className="grid grid-cols-2 gap-2 mb-5 max-h-64 overflow-y-auto">
                  {hosts.map((h) => (
                    <label key={h.id} className={`border rounded-lg px-3 py-2 text-sm cursor-pointer ${targetHosts.has(h.id) ? "border-orange-500 bg-orange-600/10" : "border-zinc-700"}`}>
                      <input type="checkbox" className="mr-2 accent-orange-500" checked={targetHosts.has(h.id)}
                        onChange={() => setTargetHosts((p) => { const n = new Set(p); if (n.has(h.id)) n.delete(h.id); else n.add(h.id); return n; })} />
                      {h.name}
                    </label>
                  ))}
                  {hosts.length === 0 && <p className="text-zinc-500 text-sm col-span-2">Belum ada host. Buat dulu di menu Live.</p>}
                </div>
                <div className="flex gap-2 justify-between">
                  <button onClick={() => setSendMode("")} className="px-4 py-2 text-sm text-zinc-400">‹ Kembali</button>
                  <button onClick={doSend} disabled={targetHosts.size === 0}
                    className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                    Kirim ke {targetHosts.size} Host
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal tambah folder */}
      {showFolder && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowFolder(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-2">Tambah Folder</h2>
            <p className="text-zinc-400 text-sm mb-4">
              Folder dipakai untuk memisahkan produk di koleksi, mis. per kategori atau per host.
            </p>
            <input autoFocus placeholder="Nama folder…" value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createFolder(); }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowFolder(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={createFolder} disabled={!folderName.trim()}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                Buat Folder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal pindah folder */}
      {showMove && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowMove(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Pindahkan {selected.size} produk ke folder</h2>
            <div className="space-y-2">
              {folders.map((f) => (
                <button key={f.id} onClick={() => moveToFolder(f.id)}
                  className="w-full text-left border border-zinc-700 hover:border-orange-500 hover:bg-orange-600/10 rounded-lg px-4 py-2.5 text-sm transition">
                  📁 {f.name} <span className="text-zinc-500">({f.count})</span>
                </button>
              ))}
              <button onClick={() => moveToFolder(null)}
                className="w-full text-left border border-zinc-700 hover:border-orange-500 hover:bg-orange-600/10 rounded-lg px-4 py-2.5 text-sm transition text-zinc-400">
                Tanpa Folder (keluarkan dari folder)
              </button>
              {folders.length === 0 && (
                <p className="text-zinc-500 text-sm">Belum ada folder. Buat dulu lewat tombol &quot;📁 Tambah Folder&quot;.</p>
              )}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setShowMove(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal konfirmasi reset */}
      {showReset && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowReset(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-2">Reset Koleksi?</h2>
            <p className="text-zinc-400 text-sm mb-5">
              Semua {total} produk di koleksi akan dihapus, termasuk assignment yang belum dipakai.
              Produk yang sudah masuk sesi live tidak memengaruhi riwayat live.
              Hasil riset baru dari extension akan mengisi koleksi lagi. Tindakan ini tidak bisa dibatalkan.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowReset(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={doReset} disabled={resetBusy}
                className="bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                {resetBusy ? "Menghapus…" : "Ya, Reset Semua"}
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
