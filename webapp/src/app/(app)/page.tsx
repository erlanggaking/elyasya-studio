"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, rupiah, num, tanggal, durasi } from "@/lib/ui";

type SessionRow = {
  id: string;
  title: string;
  status: string;
  host: { id: string; name: string } | null;
  studio: { id: string; name: string } | null;
  startedAt: string | null;
  durationSec: number;
  itemCount: number;
  gmv: number;
  orders: number;
  views: number;
  peakCcu: number;
  ccu: number;
  ctr: number;
  co: number;
  likes: number;
  comments: number;
  shares: number;
  avgViewingDuration: number;
  estCommission: number;
};

type Report = {
  totals: {
    gmv: number;
    orders: number;
    views: number;
    estCommission: number;
    finalCommission: number;
    sessions: number;
    liveNow: number;
  };
  sessions: SessionRow[];
  byStudio: { id: string; name: string; gmv: number; orders: number; views: number; estCommission: number; sessions: number; durationSec: number }[];
  byHost: { id: string; name: string; gmv: number; orders: number; views: number; estCommission: number; sessions: number; durationSec: number }[];
  topProducts: {
    productId: string; name: string; imageUrl: string; price: number;
    commissionRate: number; sold: number; clicks: number; revenue: number;
  }[];
};

export default function DashboardPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [group, setGroup] = useState<"session" | "studio" | "host">("session");

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await api<Report>(`/api/report?${qs}`);
    if (r.ok) setReport(r as unknown as Report);
  }, [from, to]);

  useEffect(() => {
    load();
    const t = setInterval(load, 45000); // auto-refresh utk live monitoring (PRD §11)
    return () => clearInterval(t);
  }, [load]);

  const liveSessions = report?.sessions.filter((s) => s.status === "live") ?? [];

  // ---- Kirim report ke WhatsApp -------------------------------------------
  // Dua mode: keseluruhan (isi dashboard) atau per studio (pilih studio mana
  // saja; datanya diambil ulang dari /api/report?studioId=… agar sama persis
  // dengan report per studio).
  const [waModal, setWaModal] = useState(false);
  const [waStudios, setWaStudios] = useState<Set<string>>(new Set());
  const [waBusy, setWaBusy] = useState(false);

  const periodeLabel = from || to ? `${from || "…"} s/d ${to || "…"}` : "semua waktu";

  function openWhatsApp(text: string) {
    const number = (localStorage.getItem("waReportNumber") || "").replace(/\D/g, "");
    const url = number
      ? `https://wa.me/${number}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  }

  function reportLines(r: Report, judul: string): string[] {
    const t = r.totals;
    const totalDur = r.sessions.reduce((a, s) => a + (s.durationSec || 0), 0);
    const lines: string[] = [
      `*${judul}*`,
      `• GMV: ${rupiah(t.gmv)}`,
      `• Komisi estimasi: ${rupiah(t.estCommission)}`,
      `• Order: ${num(t.orders)} | Views: ${num(t.views)}`,
      `• Sesi live: ${t.sessions}${t.liveNow ? ` (🔴 ${t.liveNow} sedang live)` : ""} | Total durasi: ${durasi(totalDur)}`,
    ];
    if (r.topProducts?.length) {
      lines.push(``, `*🏆 Produk Terlaris*`);
      r.topProducts.slice(0, 5).forEach((p, i) => {
        lines.push(`${i + 1}. ${p.name.slice(0, 45)} — ${num(p.sold)} terjual (${rupiah(p.revenue)})`);
      });
    }
    if (r.byHost?.length) {
      lines.push(``, `*Top Host*`);
      r.byHost.slice(0, 5).forEach((h, i) => {
        lines.push(`${i + 1}. ${h.name} — GMV ${rupiah(h.gmv)} (${h.sessions} sesi, ${durasi(h.durationSec)})`);
      });
    }
    const live = r.sessions.filter((s) => s.status === "live");
    if (live.length) {
      lines.push(``, `*🔴 Live Sekarang*`);
      for (const s of live.slice(0, 5)) {
        lines.push(`• ${s.host?.name ?? "?"} — GMV ${rupiah(s.gmv)}, ${num(s.ccu)} penonton`);
      }
    }
    return lines;
  }

  function sendOverallToWa() {
    if (!report) return;
    const lines = [
      `*📊 Report Elyasya Studio — Keseluruhan*`,
      `Periode: ${periodeLabel}`,
      ``,
      ...reportLines(report, "Ringkasan"),
      ``,
      `_dikirim dari elyasyastudio.com_`,
    ];
    setWaModal(false);
    openWhatsApp(lines.join("\n"));
  }

  async function sendStudiosToWa() {
    if (waStudios.size === 0) return;
    setWaBusy(true);
    const lines: string[] = [
      `*📊 Report Elyasya Studio — Per Studio*`,
      `Periode: ${periodeLabel}`,
    ];
    for (const sid of waStudios) {
      const name = report?.byStudio.find((s) => s.id === sid)?.name ?? "Studio";
      const qs = new URLSearchParams({ studioId: sid });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const r = await api<Report>(`/api/report?${qs}`);
      if (r.ok) {
        lines.push(``, `━━━━━━━━━━━━`, ...reportLines(r as unknown as Report, `🏢 ${name}`));
      }
    }
    lines.push(``, `_dikirim dari elyasyastudio.com_`);
    setWaBusy(false);
    setWaModal(false);
    openWhatsApp(lines.join("\n"));
  }

  function setWaNumber() {
    const cur = localStorage.getItem("waReportNumber") || "";
    const v = prompt(
      "Nomor WhatsApp tujuan report (format 628xxx, kosongkan untuk pilih kontak manual):",
      cur
    );
    if (v === null) return;
    localStorage.setItem("waReportNumber", v.replace(/\D/g, ""));
  }

  function exportCsv() {
    if (!report) return;
    const head = "Judul,Host,Studio,Status,Mulai,Durasi,GMV,Order,Komisi Est,Views,Peak CCU,CTR,CO\n";
    const body = report.sessions
      .map((s) =>
        [
          JSON.stringify(s.title),
          s.host?.name ?? "",
          s.studio?.name ?? "",
          s.status,
          s.startedAt ?? "",
          durasi(s.durationSec),
          s.gmv,
          s.orders,
          s.estCommission,
          s.views,
          s.peakCcu,
          s.ctr,
          s.co,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([head + body], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `elyasya-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Report Dashboard</h1>
          <p className="text-zinc-400 text-sm">GMV, komisi, view & konversi — real-time saat live</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2" />
          <span className="text-zinc-500">s/d</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2" />
          <button onClick={exportCsv}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 font-medium">
            Export CSV
          </button>
          <div className="flex">
            <button onClick={() => { setWaStudios(new Set()); setWaModal(true); }} title="Kirim ringkasan report ke WhatsApp"
              className="bg-emerald-600 hover:bg-emerald-500 rounded-l-lg px-4 py-2 font-medium">
              💬 Kirim ke WhatsApp
            </button>
            <button onClick={setWaNumber} title="Atur nomor tujuan tetap"
              className="bg-emerald-700 hover:bg-emerald-600 rounded-r-lg px-2 py-2 border-l border-emerald-800">
              ⚙
            </button>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "GMV (estimasi)", value: rupiah(report?.totals.gmv ?? 0), accent: true },
          { label: "Komisi Estimasi", value: rupiah(report?.totals.estCommission ?? 0) },
          { label: "Komisi Final", value: rupiah(report?.totals.finalCommission ?? 0) },
          { label: "Order", value: num(report?.totals.orders ?? 0) },
          { label: "Views", value: num(report?.totals.views ?? 0) },
          { label: "Sesi Live", value: `${report?.totals.sessions ?? 0}` },
        ].map((k) => (
          <div key={k.label}
            className={`rounded-xl border p-4 ${k.accent ? "border-orange-600/40 bg-orange-600/10" : "border-zinc-800 bg-zinc-900"}`}>
            <div className="text-xs text-zinc-400">{k.label}</div>
            <div className="text-xl font-bold mt-1">{k.value}</div>
          </div>
        ))}
      </div>

      {/* Live sekarang */}
      {liveSessions.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            Live Sekarang ({liveSessions.length})
          </h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {liveSessions.map((s) => (
              <Link key={s.id} href={`/live/host/${s.host?.id}`}
                className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 hover:border-red-700 transition block">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold">{s.host?.name}</div>
                    <div className="text-xs text-zinc-400">{s.studio?.name ?? "Tanpa studio"} · {s.title}</div>
                  </div>
                  <span className="text-[10px] font-bold bg-red-600 rounded px-1.5 py-0.5">LIVE</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div><div className="text-xs text-zinc-500">GMV</div><div className="font-bold text-sm">{rupiah(s.gmv)}</div></div>
                  <div><div className="text-xs text-zinc-500">Penonton</div><div className="font-bold text-sm">{num(s.ccu)}</div></div>
                  <div><div className="text-xs text-zinc-500">Order</div><div className="font-bold text-sm">{num(s.orders)}</div></div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Produk paling banyak terjual (menyeluruh, ikut filter tanggal) */}
      {(report?.topProducts?.length ?? 0) > 0 && (
        <section className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-4">
          <h2 className="font-semibold mb-3">🏆 Produk Paling Banyak Terjual</h2>
          <div className="grid md:grid-cols-2 gap-2">
            {report!.topProducts.map((p, idx) => (
              <div key={p.productId} className="flex items-center gap-3 text-sm bg-zinc-900/60 rounded-lg px-3 py-2">
                <span className="text-emerald-400 font-bold w-5">{idx + 1}.</span>
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="w-9 h-9 rounded object-cover" />
                ) : <span className="w-9 h-9 rounded bg-zinc-800 flex items-center justify-center text-xs">📦</span>}
                <div className="flex-1 min-w-0">
                  <div className="line-clamp-1">{p.name}</div>
                  <div className="text-[11px] text-zinc-500">
                    {num(p.clicks)} klik{p.commissionRate > 0 ? ` · komisi ${p.commissionRate}%` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-400 font-semibold">{num(p.sold)} terjual</div>
                  <div className="text-zinc-400 text-[11px]">{rupiah(p.revenue)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tabel */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          {(["session", "studio", "host"] as const).map((g) => (
            <button key={g} onClick={() => setGroup(g)}
              className={`px-3 py-1.5 rounded-lg text-sm ${group === g ? "bg-orange-600 font-semibold" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
              {g === "session" ? "Per Sesi" : g === "studio" ? "Per Studio" : "Per Host"}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-zinc-800 overflow-x-auto">
          {group === "session" ? (
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs">
                <tr>
                  {["Sesi", "Host / Studio", "Status", "Mulai", "Durasi", "GMV", "Order", "Komisi Est", "Views", "Peak CCU", "CTR", "Konversi"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {(report?.sessions ?? []).map((s) => (
                  <tr key={s.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3">{s.title}</td>
                    <td className="px-4 py-3 text-zinc-400">{s.host?.name} · {s.studio?.name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {s.status === "live"
                        ? <span className="text-red-400 font-semibold">● LIVE</span>
                        : <span className="text-zinc-500">Selesai</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-400 whitespace-nowrap">{tanggal(s.startedAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{durasi(s.durationSec)}</td>
                    <td className="px-4 py-3 font-semibold">{rupiah(s.gmv)}</td>
                    <td className="px-4 py-3">{num(s.orders)}</td>
                    <td className="px-4 py-3">{rupiah(s.estCommission)}</td>
                    <td className="px-4 py-3">{num(s.views)}</td>
                    <td className="px-4 py-3">{num(s.peakCcu)}</td>
                    <td className="px-4 py-3">{s.ctr}%</td>
                    <td className="px-4 py-3">{s.co}%</td>
                  </tr>
                ))}
                {(report?.sessions.length ?? 0) === 0 && (
                  <tr><td colSpan={12} className="px-4 py-10 text-center text-zinc-500">
                    Belum ada sesi live. Mulai dari menu Live Management.
                  </td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs">
                <tr>
                  {[group === "studio" ? "Studio" : "Host", "Sesi", "Total Durasi", "GMV", "Order", "Komisi Est", "Views"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {((group === "studio" ? report?.byStudio : report?.byHost) ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3">{r.sessions}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{durasi(r.durationSec)}</td>
                    <td className="px-4 py-3 font-semibold">{rupiah(r.gmv)}</td>
                    <td className="px-4 py-3">{num(r.orders)}</td>
                    <td className="px-4 py-3">{rupiah(r.estCommission)}</td>
                    <td className="px-4 py-3">{num(r.views)}</td>
                  </tr>
                ))}
                {((group === "studio" ? report?.byStudio : report?.byHost)?.length ?? 0) === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-zinc-500">Belum ada data.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          GMV & komisi estimasi dari metrik sesi live (real-time). Komisi final dari laporan affiliate Shopee (delay approval).
        </p>
      </section>

      {/* Modal pilih mode kirim WhatsApp */}
      {waModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setWaModal(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Kirim Report ke WhatsApp</h2>
            <p className="text-zinc-400 text-sm mb-4">Periode: {periodeLabel}</p>

            <button onClick={sendOverallToWa}
              className="w-full border border-zinc-700 hover:border-emerald-500 hover:bg-emerald-600/10 rounded-xl p-4 text-left transition mb-3">
              <div className="font-semibold">📊 Keseluruhan</div>
              <div className="text-xs text-zinc-400 mt-0.5">Seluruh isi dashboard — ringkasan, produk terlaris, top host, live sekarang.</div>
            </button>

            <div className="border border-zinc-700 rounded-xl p-4">
              <div className="font-semibold">🏢 Per Studio</div>
              <div className="text-xs text-zinc-400 mt-0.5 mb-3">Pilih studio yang mau di-report (bisa lebih dari satu).</div>
              <div className="space-y-1.5 max-h-44 overflow-y-auto mb-3">
                {(report?.byStudio ?? []).map((s) => (
                  <label key={s.id} className={`flex items-center gap-2 text-sm rounded-lg px-3 py-2 cursor-pointer border ${waStudios.has(s.id) ? "border-emerald-500 bg-emerald-600/10" : "border-zinc-700"}`}>
                    <input type="checkbox" className="accent-emerald-500" checked={waStudios.has(s.id)}
                      onChange={() => setWaStudios((p) => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} />
                    <span className="flex-1">{s.name}</span>
                    <span className="text-xs text-zinc-500">{s.sessions} sesi · {rupiah(s.gmv)}</span>
                  </label>
                ))}
                {(report?.byStudio.length ?? 0) === 0 && (
                  <p className="text-zinc-500 text-sm">Belum ada studio dengan sesi live di periode ini.</p>
                )}
              </div>
              <button onClick={sendStudiosToWa} disabled={waStudios.size === 0 || waBusy}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-lg py-2 text-sm font-semibold">
                {waBusy ? "Menyusun report…" : `Kirim Report ${waStudios.size} Studio`}
              </button>
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={() => setWaModal(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
