"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/ui";

type Studio = {
  id: string;
  name: string;
  location: string;
  hostCount: number;
  liveNow: number;
  pendingProducts: number;
};

export default function LivePage() {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ studios: Studio[] }>("/api/studios");
    if (r.ok) setStudios(r.studios);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createStudio() {
    const r = await api("/api/studios", {
      method: "POST",
      body: JSON.stringify({ name, location }),
    });
    if (r.ok) {
      setShowNew(false);
      setName("");
      setLocation("");
      load();
    } else setError(r.error || "Gagal");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Management</h1>
          <p className="text-zinc-400 text-sm">Kelola studio, host, dan sesi live</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
          + Studio Baru
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {studios.map((s) => (
          <Link key={s.id} href={`/live/${s.id}`}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 hover:border-orange-600/60 transition block">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-bold">{s.name}</div>
                <div className="text-xs text-zinc-400">{s.location || "Tanpa lokasi"}</div>
              </div>
              {s.liveNow > 0 && (
                <span className="text-[10px] font-bold bg-red-600 rounded px-2 py-1 animate-pulse">
                  {s.liveNow} LIVE
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{s.hostCount}</div>
                <div className="text-[11px] text-zinc-400">Host</div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3 text-center">
                <div className="text-xl font-bold">{s.pendingProducts}</div>
                <div className="text-[11px] text-zinc-400">Produk siap live</div>
              </div>
            </div>
          </Link>
        ))}
        {studios.length === 0 && (
          <div className="col-span-full py-16 text-center text-zinc-500">
            Belum ada studio. Buat studio pertama kamu.
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowNew(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Studio Baru</h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-zinc-400">Nama studio *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Studio A"
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Lokasi / deskripsi</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Lantai 2, ruang kiri"
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              {error && <p className="text-red-400">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowNew(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={createStudio} className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
                Buat Studio
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
