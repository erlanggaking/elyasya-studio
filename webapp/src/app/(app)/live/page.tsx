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
  owner: { id: string; name: string; email: string } | null;
};

type Account = { id: string; name: string; email: string; role: string };

export default function LivePage() {
  const [studios, setStudios] = useState<Studio[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState("");
  const [editStudio, setEditStudio] = useState<Studio | null>(null);
  const [editForm, setEditForm] = useState({ name: "", location: "", ownerId: "" });
  const [role, setRole] = useState("admin");
  const [accounts, setAccounts] = useState<Account[]>([]);

  const load = useCallback(async () => {
    const r = await api<{ studios: Studio[] }>("/api/studios");
    if (r.ok) setStudios(r.studios);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      const p = await api<{ user: { role: string } }>("/api/profile");
      if (!p.ok) return;
      setRole(p.user.role);
      if (p.user.role === "superuser") {
        const u = await api<{ users: Account[] }>("/api/users");
        if (u.ok) setAccounts(u.users);
      }
    })();
  }, []);

  function openEditStudio(s: Studio) {
    setEditStudio(s);
    setEditForm({ name: s.name, location: s.location, ownerId: s.owner?.id ?? "" });
    setError("");
  }

  async function saveEditStudio() {
    if (!editStudio || !editForm.name.trim()) return;
    const r = await api(`/api/studios/${editStudio.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editForm.name.trim(),
        location: editForm.location,
        ...(role === "superuser" && editForm.ownerId ? { ownerId: editForm.ownerId } : {}),
      }),
    });
    if (r.ok) {
      setEditStudio(null);
      load();
    } else setError(r.error || "Gagal menyimpan");
  }

  async function deleteStudio(s: Studio) {
    if (s.liveNow > 0) {
      alert(`Studio "${s.name}" sedang ada ${s.liveNow} sesi live. Akhiri dulu live-nya sebelum menghapus.`);
      return;
    }
    if (!confirm(
      `Hapus studio "${s.name}"?\n\nHost di dalamnya tidak ikut terhapus (jadi tanpa studio), ` +
      `tapi produk yang dikirim ke studio ini akan dihapus dari antrian. Riwayat sesi live tetap tersimpan.`
    )) return;
    const r = await api(`/api/studios/${s.id}`, { method: "DELETE" });
    if (r.ok) load();
    else alert(r.error || "Gagal menghapus studio");
  }

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
                {s.owner && (
                  <div className="text-[11px] text-purple-300/80 mt-1">
                    Pemilik: {s.owner.name}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {s.liveNow > 0 && (
                  <span className="text-[10px] font-bold bg-red-600 rounded px-2 py-1 animate-pulse">
                    {s.liveNow} LIVE
                  </span>
                )}
                <button title="Edit studio"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEditStudio(s); }}
                  className="text-zinc-600 hover:text-orange-400 text-sm leading-none p-1 -m-1">
                  ✎
                </button>
                <button title="Hapus studio"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); deleteStudio(s); }}
                  className="text-zinc-600 hover:text-red-400 text-sm leading-none p-1 -m-1">
                  🗑
                </button>
              </div>
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

      {/* Modal edit studio */}
      {editStudio && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditStudio(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Edit Studio</h2>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-zinc-400">Nama studio *</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Lokasi / deskripsi</label>
                <input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              {role === "superuser" && (
                <div>
                  <label className="text-xs text-zinc-400">Pemilik studio</label>
                  <select value={editForm.ownerId}
                    onChange={(e) => setEditForm({ ...editForm, ownerId: e.target.value })}
                    className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-purple-500">
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({a.role})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Semua host di studio ini ikut dipindahkan ke pemilik baru.
                  </p>
                </div>
              )}
              {error && <p className="text-red-400">{error}</p>}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setEditStudio(null)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={saveEditStudio} disabled={!editForm.name.trim()}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

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
