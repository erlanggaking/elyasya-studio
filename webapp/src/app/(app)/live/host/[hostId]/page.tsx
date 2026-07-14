"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { api, rupiah, num, tanggal } from "@/lib/ui";
import LivePlayer from "./LivePlayer";

type HostDetail = {
  id: string;
  name: string;
  note: string;
  contact: string;
  liveUsername: string;
  liveShareLink: string;
  liveUid: string;
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
    playUrl: string;
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
  const [liveLink, setLiveLink] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [playerKey, setPlayerKey] = useState(0);
  // Alur konek mock: tab login affiliate dibuka → host login → tandai terhubung.
  const [pendingConnect, setPendingConnect] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ host: HostDetail }>(`/api/hosts/${hostId}`);
    if (r.ok) {
      setHost(r.host);
      setShareLink(r.host.liveShareLink || "");
    }
  }, [hostId]);

  useEffect(() => { load(); }, [load]);

  const activeSession = host?.liveSessions.find((s) => s.status === "live") ?? null;

  // Auto-deteksi live: saat tidak ada sesi aktif, cek tiap 20 dtk apakah host
  // mulai live (via uid tersimpan). Saat live, verifikasi tiap 60 dtk apakah
  // live aslinya masih jalan — kalau berakhir, panel ikut menutup sesi.
  useEffect(() => {
    if (!host) return;
    let stop = false;
    async function refresh() {
      const r = await api<{ live: boolean; autoLinked?: boolean; ended?: boolean; session?: { playUrl?: string } }>(
        `/api/hosts/${hostId}/live/refresh`, { method: "POST" });
      if (stop || !r.ok) return;
      if (r.autoLinked) { setMsg("🔴 Live host terdeteksi — sesi tertaut otomatis"); load(); }
      else if (r.ended) { setMsg("Live host sudah berakhir — sesi ditutup"); setMetrics(null); load(); }
      // Stream video tersedia → muat ulang supaya player berganti ke video.
      else if (r.session?.playUrl && r.session.playUrl !== activeSession?.playUrl) load();
    }
    refresh();
    const t = setInterval(refresh, activeSession ? 60000 : 20000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, !!host, !!activeSession]);

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
    if (!r.ok) { setMsg(`❌ ${r.error}`); return; }
    if (r.mock) {
      window.open("https://affiliate.shopee.co.id/", "_blank", "noopener");
      setPendingConnect(r.authorizeUrl);
    } else {
      window.location.href = r.authorizeUrl;
    }
  }

  async function saveShareLink() {
    const r = await api<{ autoLinked: boolean }>(`/api/hosts/${hostId}`, {
      method: "PATCH",
      body: JSON.stringify({ liveShareLink: shareLink }),
    });
    if (r.ok) {
      setMsg(r.autoLinked
        ? "✅ Link tersimpan & live host langsung tertaut"
        : "✅ Link tersimpan — live berikutnya akan terdeteksi otomatis");
      load();
    } else setMsg(`❌ ${r.error}`);
  }

  async function linkLive() {
    if (!liveLink.trim()) return;
    setBusy(true);
    const r = await api(`/api/live-sessions/link`, {
      method: "POST",
      body: JSON.stringify({ hostId, url: liveLink.trim() }),
    });
    setBusy(false);
    if (r.ok) { setMsg("✅ Video live berhasil ditautkan"); setLiveLink(""); load(); }
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

  // Push satu produk assigned langsung ke keranjang + pin sekaligus.
  async function pushAndPin(assignmentId: string) {
    if (!activeSession) return;
    setBusy(true);
    const r = await api(`/api/live-sessions/${activeSession.id}/items`, {
      method: "POST",
      body: JSON.stringify({ assignmentIds: [assignmentId], pin: true }),
    });
    setBusy(false);
    if (r.ok) { setMsg("📌 Produk masuk keranjang & dipin"); load(); }
    else setMsg(`❌ ${r.error}`);
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

      {/* Akun Shopee (dibutuhkan buat pin/keranjang) + setup link live */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Akun Shopee Affiliate</h2>
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
            className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
            {connected ? "Reconnect" : "Konek Host"}
          </button>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <label className="text-xs text-zinc-400">
            Link live host (setup sekali — live berikutnya terdeteksi otomatis)
          </label>
          <div className="flex gap-2 mt-1.5">
            <input value={shareLink} onChange={(e) => setShareLink(e.target.value)}
              placeholder="https://id.shp.ee/… atau https://live.shopee.co.id/share?session=…"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
            <button onClick={saveShareLink}
              className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
              Simpan
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1.5">
            {host.liveUid
              ? `✓ Akun live host sudah dikenali (uid ${host.liveUid}) — tiap host mulai live, panel ini otomatis menautkannya.`
              : "Minta host share link live-nya sekali (tombol Share di aplikasi Shopee). Setelah disimpan, panel mengenali akunnya dan live berikutnya tertaut otomatis."}
          </p>
        </div>

        {pendingConnect && (
          <div className="rounded-lg border border-orange-600/40 bg-orange-600/10 p-4 text-sm space-y-3">
            <p className="font-medium">Tab login Shopee Affiliate sudah dibuka.</p>
            <ol className="list-decimal list-inside text-zinc-300 space-y-1 text-[13px]">
              <li>Minta <b>{host.name}</b> login dengan akun Shopee Affiliate miliknya di tab tersebut.</li>
              <li>Setelah berhasil login, kembali ke sini dan klik tombol di bawah.</li>
            </ol>
            <div className="flex gap-2">
              <button onClick={() => { window.location.href = pendingConnect; }}
                className="bg-emerald-600 hover:bg-emerald-500 rounded-lg px-4 py-2 text-sm font-semibold">
                ✓ Host Sudah Login — Tandai Terhubung
              </button>
              <button onClick={() => setPendingConnect(null)} className="px-3 py-2 text-sm text-zinc-400">Batal</button>
            </div>
          </div>
        )}
      </section>

      {/* Kontrol sesi live */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Sesi Live</h2>
          {activeSession && (
            <button onClick={endLive} disabled={busy}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg px-4 py-2 text-sm font-semibold">
              ■ Akhiri Sesi
            </button>
          )}
        </div>

        {!activeSession && (
          <div className="rounded-lg bg-zinc-800/50 p-4">
            <h3 className="text-sm font-semibold">Ambil Video Live</h3>
            <p className="text-xs text-zinc-400 mt-1 mb-3">
              Biasanya live host terdeteksi otomatis (±20 detik). Kalau perlu manual: tempel link
              share live dari HP host — panel hanya mengambil videonya, tidak membuka halaman Shopee.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={liveLink} onChange={(e) => setLiveLink(e.target.value)}
                placeholder="https://live.shopee.co.id/share?session=… atau https://id.shp.ee/…"
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500" />
              <button onClick={linkLive} disabled={busy || !liveLink.trim()}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap">
                Ambil Video
              </button>
            </div>
          </div>
        )}

        {activeSession && (
          <>
            {/* Panel live: video kiri, produk kanan */}
            <div className="grid lg:grid-cols-5 gap-4">
              {/* Player — murni video, tidak pernah memuat halaman Shopee */}
              <div className="lg:col-span-2 space-y-2">
                <div className="rounded-xl overflow-hidden bg-black border border-zinc-800 aspect-[9/16] max-h-[70vh] mx-auto w-full">
                  <LivePlayer key={playerKey} playUrl={activeSession.playUrl} />
                </div>
                <div className="flex justify-center gap-4 text-xs">
                  <button onClick={() => setPlayerKey((k) => k + 1)}
                    className="text-zinc-400 hover:text-orange-400">
                    ↻ Muat ulang player
                  </button>
                </div>
              </div>

              {/* Produk: keranjang + assigned dengan pin */}
              <div className="lg:col-span-3 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Keranjang Live ({activeSession.items.length})</h3>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {activeSession.items.map((it) => (
                      <div key={it.id}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${it.isShowing ? "bg-orange-600/15 border border-orange-600/40" : "bg-zinc-800/60"}`}>
                        <span className="text-zinc-500 text-xs w-5">#{it.itemNo}</span>
                        {it.product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.product.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                        ) : <span className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-xs">📦</span>}
                        <span className="flex-1 line-clamp-1">{it.product.name}</span>
                        <span className="text-zinc-400 text-xs">{rupiah(it.product.price)}</span>
                        {it.isShowing ? (
                          <span className="text-[10px] font-bold text-orange-400 whitespace-nowrap">📌 DIPIN</span>
                        ) : (
                          <button onClick={() => itemAction(it.id, "show")}
                            className="text-xs bg-zinc-700 hover:bg-orange-600 rounded px-2 py-1 whitespace-nowrap">📌 Pin</button>
                        )}
                        <button onClick={() => itemAction(it.id, "remove")}
                          className="text-xs text-red-400 hover:text-red-300 px-1">✕</button>
                      </div>
                    ))}
                    {activeSession.items.length === 0 && (
                      <p className="text-zinc-500 text-sm">Keranjang kosong — produk kiriman Koleksi akan masuk otomatis.</p>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-2">Produk Ter-assign ({host.assignments.length})</h3>
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {host.assignments.map((a) => (
                      <div key={a.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm bg-zinc-800/60">
                        {a.collectionEntry.product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.collectionEntry.product.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                        ) : <span className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-xs">📦</span>}
                        <span className="flex-1 line-clamp-1">{a.collectionEntry.product.name}</span>
                        <span className="text-emerald-400 text-xs">{a.collectionEntry.product.commissionRate}%</span>
                        <span className="text-zinc-400 text-xs">{rupiah(a.collectionEntry.product.price)}</span>
                        <button onClick={() => pushAndPin(a.id)} disabled={busy}
                          className="text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded px-2 py-1 whitespace-nowrap">
                          📌 Pin ke Live
                        </button>
                      </div>
                    ))}
                    {host.assignments.length === 0 && (
                      <p className="text-zinc-500 text-sm">
                        Belum ada produk. Kirim dari menu Koleksi → Kirim ke Live → pilih host ini.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>

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
          </>
        )}
      </section>

      {/* Produk ter-assign (saat tidak live) */}
      {!activeSession && (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
          <h2 className="font-semibold mb-3">Produk Ter-assign ({host.assignments.length})</h2>
          {host.assignments.length > 0 && (
            <p className="text-xs text-amber-400/80 mb-3">
              Produk ini otomatis masuk keranjang live begitu live host terdeteksi.
            </p>
          )}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2">
            {host.assignments.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm bg-zinc-800/60">
                {a.collectionEntry.product.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.collectionEntry.product.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                ) : <span className="w-8 h-8 rounded bg-zinc-700 flex items-center justify-center text-xs">📦</span>}
                <span className="flex-1 line-clamp-1">{a.collectionEntry.product.name}</span>
                <span className="text-emerald-400 text-xs">{a.collectionEntry.product.commissionRate}%</span>
              </div>
            ))}
            {host.assignments.length === 0 && (
              <p className="col-span-full text-zinc-500 text-sm">
                Belum ada produk. Kirim dari menu Koleksi → pilih produk → Kirim ke Live → pilih host ini.
              </p>
            )}
          </div>
        </section>
      )}

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
