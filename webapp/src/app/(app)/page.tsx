"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, rupiah, num, tanggal } from "@/lib/ui";

type SessionRow = {
  id: string;
  title: string;
  status: string;
  host: { id: string; name: string } | null;
  studio: { id: string; name: string } | null;
  startedAt: string | null;
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
  byStudio: { id: string; name: string; gmv: number; orders: number; views: number; estCommission: number; sessions: number }[];
  byHost: { id: string; name: string; gmv: number; orders: number; views: number; estCommission: number; sessions: number }[];
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

  function exportCsv() {
    if (!report) return;
    const head = "Judul,Host,Studio,Status,Mulai,GMV,Order,Komisi Est,Views,Peak CCU,CTR,CO\n";
    const body = report.sessions
      .map((s) =>
        [
          JSON.stringify(s.title),
          s.host?.name ?? "",
          s.studio?.name ?? "",
          s.status,
          s.startedAt ?? "",
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
                  {["Sesi", "Host / Studio", "Status", "Mulai", "GMV", "Order", "Komisi Est", "Views", "Peak CCU", "CTR", "Konversi"].map((h) => (
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
                  <tr><td colSpan={11} className="px-4 py-10 text-center text-zinc-500">
                    Belum ada sesi live. Mulai dari menu Live Management.
                  </td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs">
                <tr>
                  {[group === "studio" ? "Studio" : "Host", "Sesi", "GMV", "Order", "Komisi Est", "Views"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {((group === "studio" ? report?.byStudio : report?.byHost) ?? []).map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-900/50">
                    <td className="px-4 py-3 font-medium">{r.name}</td>
                    <td className="px-4 py-3">{r.sessions}</td>
                    <td className="px-4 py-3 font-semibold">{rupiah(r.gmv)}</td>
                    <td className="px-4 py-3">{num(r.orders)}</td>
                    <td className="px-4 py-3">{rupiah(r.estCommission)}</td>
                    <td className="px-4 py-3">{num(r.views)}</td>
                  </tr>
                ))}
                {((group === "studio" ? report?.byStudio : report?.byHost)?.length ?? 0) === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-zinc-500">Belum ada data.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          GMV & komisi estimasi dari metrik sesi live (real-time). Komisi final dari laporan affiliate Shopee (delay approval).
        </p>
      </section>
    </div>
  );
}
