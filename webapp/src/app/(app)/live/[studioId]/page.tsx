"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { api, rupiah, tanggal } from "@/lib/ui";

type StudioDetail = {
  id: string;
  name: string;
  location: string;
  hosts: {
    id: string;
    name: string;
    note: string;
    shopeeAccounts: { id: string; status: string }[];
    liveSessions: { id: string }[];
  }[];
  assignments: {
    id: string;
    assignedAt: string;
    collectionEntry: { product: { name: string; imageUrl: string; price: number; commissionRate: number } };
  }[];
  liveSessions: {
    id: string;
    title: string;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    host: { name: string };
    snapshots: { gmv: number; orders: number; views: number }[];
  }[];
};

type TopProduct = { productId: string; name: string; imageUrl: string; sold: number; revenue: number };

export default function StudioDetailPage({ params }: { params: Promise<{ studioId: string }> }) {
  const { studioId } = use(params);
  const [studio, setStudio] = useState<StudioDetail | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [tab, setTab] = useState<"host" | "produk" | "sesi">("host");
  const [showAddHost, setShowAddHost] = useState(false);
  const [allHosts, setAllHosts] = useState<{ id: string; name: string; studio: { name: string } | null }[]>([]);
  const [hostSearch, setHostSearch] = useState("");
  const [newHostName, setNewHostName] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ studio: StudioDetail; topProducts: TopProduct[] }>(`/api/studios/${studioId}`);
    if (r.ok) {
      setStudio(r.studio);
      setTopProducts(r.topProducts ?? []);
    }
  }, [studioId]);

  useEffect(() => { load(); }, [load]);

  async function openAddHost() {
    const r = await api<{ hosts: typeof allHosts }>(`/api/hosts?pageSize=100${hostSearch ? `&q=${hostSearch}` : ""}`);
    if (r.ok) setAllHosts(r.hosts);
    setShowAddHost(true);
  }

  async function searchHosts(q: string) {
    setHostSearch(q);
    const r = await api<{ hosts: typeof allHosts }>(`/api/hosts?pageSize=100&q=${encodeURIComponent(q)}`);
    if (r.ok) setAllHosts(r.hosts);
  }

  async function assignHost(hostId: string) {
    await api(`/api/hosts/${hostId}`, { method: "PATCH", body: JSON.stringify({ studioId }) });
    setShowAddHost(false);
    load();
  }

  async function createAndAssignHost() {
    if (!newHostName.trim()) return;
    const r = await api<{ host: { id: string } }>("/api/hosts", {
      method: "POST",
      body: JSON.stringify({ name: newHostName, studioId }),
    });
    if (r.ok) {
      setNewHostName("");
      setShowAddHost(false);
      load();
    }
  }

  async function renameHost(h: { id: string; name: string }) {
    const name = prompt("Nama host baru:", h.name);
    if (name === null || !name.trim() || name.trim() === h.name) return;
    await api(`/api/hosts/${h.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
    load();
  }

  async function removeHost(hostId: string) {
    if (!confirm("Lepas host dari studio ini?")) return;
    await api(`/api/hosts/${hostId}`, { method: "PATCH", body: JSON.stringify({ studioId: null }) });
    load();
  }

  if (!studio) return <div className="text-zinc-500">Memuat…</div>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/live" className="text-sm text-zinc-400 hover:text-orange-400">← Live Management</Link>
        <h1 className="text-2xl font-bold mt-1">{studio.name}</h1>
        <p className="text-zinc-400 text-sm">{studio.location || "Tanpa lokasi"}</p>
      </div>

      {/* Produk paling banyak terjual di studio ini */}
      {topProducts.length > 0 && (
        <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-4">
          <h2 className="text-sm font-semibold mb-2">🏆 Produk Paling Banyak Terjual</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
            {topProducts.map((p, idx) => (
              <div key={p.productId} className="flex items-center gap-3 text-sm bg-zinc-900/60 rounded-lg px-3 py-2">
                <span className="text-emerald-400 font-bold text-xs w-4">{idx + 1}.</span>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                ) : <span className="w-8 h-8 rounded bg-zinc-800 flex items-center justify-center text-xs">📦</span>}
                <span className="flex-1 line-clamp-1">{p.name}</span>
                <div className="text-right">
                  <div className="text-emerald-400 font-semibold text-xs">{p.sold} terjual</div>
                  <div className="text-zinc-400 text-[11px]">{rupiah(p.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex gap-2">
        {([
          ["host", `Host (${studio.hosts.length})`],
          ["produk", `Produk (${studio.assignments.length})`],
          ["sesi", `Sesi Live (${studio.liveSessions.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm ${tab === key ? "bg-orange-600 font-semibold" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "host" && (
        <div className="space-y-3">
          <button onClick={openAddHost}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
            + Tambah Host
          </button>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {studio.hosts.map((h) => {
              const connected = h.shopeeAccounts.some((a) => a.status === "active");
              const isLive = h.liveSessions.length > 0;
              return (
                <div key={h.id} className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
                  <div className="flex items-start justify-between">
                    <span className="flex items-center gap-1.5">
                      <Link href={`/live/host/${h.id}`} className="font-semibold hover:text-orange-400">
                        {h.name}
                      </Link>
                      <button onClick={() => renameHost(h)} title="Ganti nama host"
                        className="text-zinc-600 hover:text-orange-400 text-xs">✎</button>
                    </span>
                    {isLive && <span className="text-[10px] font-bold bg-red-600 rounded px-1.5 py-0.5">LIVE</span>}
                  </div>
                  <div className="text-xs mt-1">
                    {connected
                      ? <span className="text-emerald-400">● Shopee terhubung</span>
                      : h.shopeeAccounts.length > 0
                        ? <span className="text-amber-400">● Token perlu reconnect</span>
                        : <span className="text-zinc-500">○ Belum connect Shopee</span>}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <Link href={`/live/host/${h.id}`}
                      className="flex-1 text-center bg-orange-600/90 hover:bg-orange-500 rounded-lg px-3 py-1.5 text-xs font-semibold">
                      Buka Panel
                    </Link>
                    <button onClick={() => removeHost(h.id)}
                      className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-400">
                      Lepas
                    </button>
                  </div>
                </div>
              );
            })}
            {studio.hosts.length === 0 && (
              <p className="col-span-full text-zinc-500 text-sm py-8 text-center">Belum ada host di studio ini.</p>
            )}
          </div>
        </div>
      )}

      {tab === "produk" && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Produk</th>
                <th className="text-left px-4 py-3 font-medium">Harga</th>
                <th className="text-left px-4 py-3 font-medium">Komisi</th>
                <th className="text-left px-4 py-3 font-medium">Dikirim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {studio.assignments.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-3 flex items-center gap-3">
                    {a.collectionEntry.product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.collectionEntry.product.imageUrl} alt="" className="w-9 h-9 rounded object-cover" />
                    ) : <span className="w-9 h-9 rounded bg-zinc-800 flex items-center justify-center">📦</span>}
                    <span className="line-clamp-1">{a.collectionEntry.product.name}</span>
                  </td>
                  <td className="px-4 py-3">{rupiah(a.collectionEntry.product.price)}</td>
                  <td className="px-4 py-3 text-emerald-400">{a.collectionEntry.product.commissionRate}%</td>
                  <td className="px-4 py-3 text-zinc-400">{tanggal(a.assignedAt)}</td>
                </tr>
              ))}
              {studio.assignments.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-zinc-500">
                  Belum ada produk ter-assign. Kirim dari menu Koleksi (bulk action).
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "sesi" && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs">
              <tr>
                {["Sesi", "Host", "Status", "Mulai", "Selesai", "GMV"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {studio.liveSessions.map((s) => (
                <tr key={s.id}>
                  <td className="px-4 py-3">{s.title}</td>
                  <td className="px-4 py-3">{s.host.name}</td>
                  <td className="px-4 py-3">
                    {s.status === "live"
                      ? <span className="text-red-400 font-semibold">● LIVE</span>
                      : <span className="text-zinc-500">Selesai</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{tanggal(s.startedAt)}</td>
                  <td className="px-4 py-3 text-zinc-400">{tanggal(s.endedAt)}</td>
                  <td className="px-4 py-3 font-semibold">{rupiah(s.snapshots[0]?.gmv ?? 0)}</td>
                </tr>
              ))}
              {studio.liveSessions.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-500">Belum ada sesi live.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal tambah host */}
      {showAddHost && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowAddHost(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Tambah Host ke {studio.name}</h2>
            <div className="flex gap-2 mb-3">
              <input value={newHostName} onChange={(e) => setNewHostName(e.target.value)} placeholder="Nama host baru…"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              <button onClick={createAndAssignHost}
                className="bg-orange-600 hover:bg-orange-500 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap">
                Buat Baru
              </button>
            </div>
            <div className="text-xs text-zinc-500 mb-2">atau pilih host yang sudah ada:</div>
            <input value={hostSearch} onChange={(e) => searchHosts(e.target.value)} placeholder="Cari host…"
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500 mb-2" />
            <div className="overflow-y-auto space-y-1.5 flex-1">
              {allHosts.filter((h) => h.id).map((h) => (
                <button key={h.id} onClick={() => assignHost(h.id)}
                  className="w-full text-left bg-zinc-800/60 hover:bg-zinc-700 rounded-lg px-3 py-2 text-sm flex justify-between">
                  <span>{h.name}</span>
                  <span className="text-zinc-500 text-xs">{h.studio ? `di ${h.studio.name}` : "belum ter-assign"}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
