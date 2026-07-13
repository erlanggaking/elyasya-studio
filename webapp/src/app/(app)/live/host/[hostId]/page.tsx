"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { api, rupiah, num, tanggal } from "@/lib/ui";

type HostDetail = {
  id: string;
  name: string;
  note: string;
  contact: string;
  studio: { id: string; name: string } | null;
  shopeeAccounts: { id: string; shopId: string; shopName: string; status: string; connectedAt: string }[];
  assignments: {
    id: string;
    collectionEntry: { product: { name: string; imageUrl: string; price: number; commissionRate: number } };
  }[];
  liveSessions: {
    id: string;
    title: string;
    status: string;
    pushUrl: string;
    pushKey: string;
    shareUrl: string;
    startedAt: string | null;
    endedAt: string | null;
    items: { id: string; itemNo: number; isShowing: boolean; product: { name: string; imageUrl: string; price: number } }[];
    snapshots: { gmv: number; orders: number; views: number }[];
  }[];
};

type Metrics = {
  gmv: number; orders: number; ccu: number; peakCcu: number; views: number;
  atc: number; ctr: number; co: number; likes: number; comments: number;
  shares: number; avgViewingDuration: number; estCommission: number;
} | null;

export default function HostPanelPage({ params }: { params: Promise<{ hostId: string }> }) {
  const { hostId } = use(params);
  const [host, setHost] = useState<HostDetail | null>(null);
  const [metrics, setMetrics] = useState<Metrics>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedAssignments, setSelectedAssignments] = useState<Set<string>>(new Set());
  const [showKey, setShowKey] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{ host: HostDetail }>(`/api/hosts/${hostId}`);
    if (r.ok) setHost(r.host);
  }, [hostId]);

  useEffect(() => { load(); }, [load]);

  const activeSession = host?.liveSessions.find((s) => s.status === "live") ?? null;

  // Polling metrik saat live (PRD §11)
  useEffect(() => {
    if (!activeSession) return;
    let stop = false;
    async function poll() {
      const r = await api<{ metrics: Metrics }>(`/api/live-sessions/${activeSession!.id}/metrics`);
      if (!stop && r.ok && r.metrics) setMetrics(r.metrics);
    }
    poll();
    const t = setInterval(poll, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [activeSession]);

  async function connectShopee() {
    const r = await api<{ authorizeUrl: string; mock: boolean }>(`/api/hosts/${hostId}/shopee/connect`, { method: "POST" });
    if (r.ok) {
      // Mode mock: langsung redirect ke callback lokal. Mode real: buka halaman authorize Shopee.
      window.location.href = r.authorizeUrl;
    } else setMsg(`❌ ${r.error}`);
  }

  async function startLive() {
    const title = prompt("Judul sesi live:", `Live ${host?.name} — ${new Date().toLocaleDateString("id-ID")}`);
    if (title === null) return;
    setBusy(true);
    const r = await api(`/api/live-sessions`, {
      method: "POST",
      body: JSON.stringify({ hostId, title }),
    });
    setBusy(false);
    if (r.ok) { setMsg("✅ Sesi live dimulai"); load(); }
    else setMsg(`❌ ${r.error}`);
  }

  async function endLive() {
    if (!activeSession || !confirm("Akhiri sesi live ini?")) return;
    setBusy(true);
    const r = await api(`/api/live-sessions/${activeSession.id}/end`, { method: "POST" });
    setBusy(false);
    if (r.ok) { setMsg("✅ Sesi diakhiri"); setMetrics(null); load(); }
    else setMsg(`❌ ${r.error}`);
  }

  async function pushSelected() {
    if (!activeSession) return;
    setBusy(true);
    const r = await api<{ pushed: number }>(`/api/live-sessions/${activeSession.id}/items`, {
      method: "POST",
      body: JSON.stringify({ assignmentIds: [...selectedAssignments] }),
    });
    setBusy(false);
    if (r.ok) {
      setMsg(`✅ ${r.pushed} produk masuk keranjang live`);
      setSelectedAssignments(new Set());
      load();
    } else setMsg(`❌ ${r.error}`);
  }

  async function itemAction(itemId: string, action: "remove" | "show") {
    if (!activeSession) return;
    const r = await api(`/api/live-sessions/${activeSession.id}/items`, {
      method: "PATCH",
      body: JSON.stringify({ itemId, action }),
    });
    if (r.ok) load();
    else setMsg(`❌ ${r.error}`);
  }

  if (!host) return <div className="text-zinc-500">Memuat…</div>;

  const connected = host.shopeeAccounts.some((a) => a.status === "active");

  return (
    <div className="space-y-6">
      <div>
        <Link href={host.studio ? `/live/${host.studio.id}` : "/live"} className="text-sm text-zinc-400 hover:text-orange-400">
          ← {host.studio?.name ?? "Live Management"}
        </Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-bold">{host.name}</h1>
          {activeSession && <span className="text-xs font-bold bg-red-600 rounded px-2 py-1 animate-pulse">SEDANG LIVE</span>}
        </div>
        <p className="text-zinc-400 text-sm">{host.note || host.contact || "Host"}</p>
      </div>

      {msg && <p className="text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">{msg}</p>}

      {/* Akun Shopee */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Akun Shopee</h2>
            {host.shopeeAccounts.length === 0 ? (
              <p className="text-sm text-zinc-500 mt-1">Belum ada akun terhubung.</p>
            ) : (
              <div className="mt-2 space-y-1">
                {host.shopeeAccounts.map((a) => (
                  <div key={a.id} className="text-sm flex items-center gap-2">
                    <span className={
                      a.status === "active" ? "text-emerald-400" :
                      a.status === "expiring" ? "text-amber-400" : "text-red-400"
                    }>●</span>
                    <span>{a.shopName || `Shop ${a.shopId}`}</span>
                    <span className="text-xs text-zinc-500">
                      ({a.status === "active" ? "aktif" : a.status === "expiring" ? "hampir expired" : "expired — reconnect"})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={connectShopee}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
            {connected ? "Reconnect" : "Connect Akun Shopee"}
          </button>
        </div>
      </section>

      {/* Kontrol sesi live */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Sesi Live</h2>
          {activeSession ? (
            <button onClick={endLive} disabled={busy}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-semibold">
              ■ Akhiri Sesi
            </button>
          ) : (
            <button onClick={startLive} disabled={busy || !connected}
              title={connected ? "" : "Connect akun Shopee dulu"}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-semibold">
              ▶ Buat & Mulai Sesi
            </button>
          )}
        </div>

        {activeSession && (
          <>
            {/* Stream credentials */}
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <div className="text-xs text-zinc-400 mb-1">RTMP Push URL (untuk OBS)</div>
                <code className="text-xs break-all text-orange-300">{activeSession.pushUrl || "—"}</code>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <div className="text-xs text-zinc-400 mb-1 flex justify-between">
                  Push Key
                  <button onClick={() => setShowKey(!showKey)} className="text-zinc-500 hover:text-zinc-300">
                    {showKey ? "sembunyikan" : "tampilkan"}
                  </button>
                </div>
                <code className="text-xs break-all text-orange-300">
                  {showKey ? activeSession.pushKey || "—" : "••••••••••••"}
                </code>
              </div>
            </div>
            {activeSession.shareUrl && (
              <a href={activeSession.shareUrl} target="_blank" className="text-xs text-sky-400 hover:underline">
                🔗 Share URL live
              </a>
            )}

            {/* Metrik real-time */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {[
                ["GMV", rupiah(metrics?.gmv ?? 0)],
                ["Komisi Est.", rupiah(metrics?.estCommission ?? 0)],
                ["Order", num(metrics?.orders ?? 0)],
                ["Penonton", num(metrics?.ccu ?? 0)],
                ["Peak CCU", num(metrics?.peakCcu ?? 0)],
                ["Views", num(metrics?.views ?? 0)],
                ["ATC", num(metrics?.atc ?? 0)],
                ["CTR", `${metrics?.ctr ?? 0}%`],
                ["Konversi", `${metrics?.co ?? 0}%`],
                ["Likes", num(metrics?.likes ?? 0)],
                ["Komentar", num(metrics?.comments ?? 0)],
                ["Avg. Nonton", `${Math.round(metrics?.avgViewingDuration ?? 0)}s`],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-zinc-800/60 rounded-lg p-2.5 text-center">
                  <div className="text-[10px] text-zinc-400">{label}</div>
                  <div className="font-bold text-sm mt-0.5">{value}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-zinc-500">Metrik auto-refresh tiap 30 detik.</p>

            {/* Keranjang live */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Keranjang Live ({activeSession.items.length})</h3>
              <div className="space-y-1.5">
                {activeSession.items.map((it) => (
                  <div key={it.id}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${it.isShowing ? "bg-orange-600/15 border border-orange-600/40" : "bg-zinc-800/60"}`}>
                    <span className="text-zinc-500 text-xs w-5">#{it.itemNo}</span>
                    {it.product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.product.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : <span className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-xs">📦</span>}
                    <span className="flex-1 line-clamp-1">{it.product.name}</span>
                    <span className="text-zinc-400">{rupiah(it.product.price)}</span>
                    {it.isShowing && <span className="text-[10px] font-bold text-orange-400">SEDANG DITAMPILKAN</span>}
                    <button onClick={() => itemAction(it.id, "show")}
                      className="text-xs bg-zinc-700 hover:bg-zinc-600 rounded px-2 py-1">Tampilkan</button>
                    <button onClick={() => itemAction(it.id, "remove")}
                      className="text-xs text-red-400 hover:text-red-300 px-1">✕</button>
                  </div>
                ))}
                {activeSession.items.length === 0 && (
                  <p className="text-zinc-500 text-sm">Keranjang kosong. Push produk ter-assign di bawah.</p>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Produk ter-assign */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Produk Ter-assign ({host.assignments.length})</h2>
          {activeSession && selectedAssignments.size > 0 && (
            <button onClick={pushSelected} disabled={busy}
              className="bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-semibold">
              Push {selectedAssignments.size} ke Keranjang Live →
            </button>
          )}
        </div>
        {!activeSession && host.assignments.length > 0 && (
          <p className="text-xs text-amber-400/80 mb-3">Mulai sesi live dulu untuk bisa push produk ke keranjang.</p>
        )}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
          {host.assignments.map((a) => (
            <label key={a.id}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm cursor-pointer border ${
                selectedAssignments.has(a.id) ? "border-orange-500 bg-orange-600/10" : "border-transparent bg-zinc-800/60 hover:bg-zinc-800"
              }`}>
              <input type="checkbox" disabled={!activeSession} checked={selectedAssignments.has(a.id)}
                onChange={() => setSelectedAssignments((p) => {
                  const n = new Set(p);
                  if (n.has(a.id)) n.delete(a.id); else n.add(a.id);
                  return n;
                })} />
              {a.collectionEntry.product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.collectionEntry.product.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
              ) : <span className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-xs">📦</span>}
              <span className="flex-1 line-clamp-1">{a.collectionEntry.product.name}</span>
              <span className="text-emerald-400 text-xs">{a.collectionEntry.product.commissionRate}%</span>
            </label>
          ))}
          {host.assignments.length === 0 && (
            <p className="col-span-full text-zinc-500 text-sm">
              Belum ada produk. Kirim dari menu Koleksi → pilih produk → Kirim ke Live Management → pilih host ini.
            </p>
          )}
        </div>
      </section>

      {/* Riwayat sesi */}
      <section className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400 text-xs">
            <tr>
              {["Sesi", "Status", "Mulai", "Selesai", "GMV terakhir"].map((h) => (
                <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/70">
            {host.liveSessions.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.title}</td>
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
            {host.liveSessions.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Belum ada riwayat sesi.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
