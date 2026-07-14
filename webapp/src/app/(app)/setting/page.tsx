"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/ui";

type Host = {
  id: string;
  name: string;
  note: string;
  contact: string;
  studio: { id: string; name: string } | null;
  liveNow: boolean;
  shopee: { id: string; shopId: string; shopName: string; status: string }[];
};

type Account = { id: string; name: string; email: string; createdAt: string };

export default function SettingPage() {
  const [profile, setProfile] = useState({ name: "", email: "" });
  const [pwd, setPwd] = useState({ currentPassword: "", newPassword: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selfId, setSelfId] = useState("");
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: "", email: "", password: "" });
  const [hosts, setHosts] = useState<Host[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [showNewHost, setShowNewHost] = useState(false);
  const [newHost, setNewHost] = useState({ name: "", contact: "", note: "" });

  const pageSize = 25;

  const loadProfile = useCallback(async () => {
    const r = await api<{ user: { name: string; email: string } }>("/api/profile");
    if (r.ok) setProfile({ name: r.user.name, email: r.user.email });
  }, []);

  const loadHosts = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) qs.set("q", q);
    const r = await api<{ hosts: Host[]; total: number }>(`/api/hosts?${qs}`);
    if (r.ok) {
      setHosts(r.hosts);
      setTotal(r.total);
    }
  }, [page, q]);

  const loadAccounts = useCallback(async () => {
    const r = await api<{ users: Account[]; selfId: string }>("/api/users");
    if (r.ok) {
      setAccounts(r.users);
      setSelfId(r.selfId);
    }
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadHosts(); }, [loadHosts]);
  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  async function saveProfile() {
    const r = await api("/api/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: profile.name, email: profile.email }),
    });
    setMsg(r.ok ? "✅ Profil disimpan" : `❌ ${r.error}`);
  }

  async function changePassword() {
    const r = await api("/api/profile", { method: "PATCH", body: JSON.stringify(pwd) });
    setMsg(r.ok ? "✅ Password diganti" : `❌ ${r.error}`);
    if (r.ok) setPwd({ currentPassword: "", newPassword: "" });
  }

  async function createAccount() {
    const r = await api("/api/users", { method: "POST", body: JSON.stringify(newAccount) });
    if (r.ok) {
      setShowNewAccount(false);
      setMsg(`✅ Akun ${newAccount.email} dibuat — bisa langsung dipakai login`);
      setNewAccount({ name: "", email: "", password: "" });
      loadAccounts();
    } else setMsg(`❌ ${r.error}`);
  }

  async function deleteAccount(a: Account) {
    if (!confirm(`Hapus akun "${a.email}"? Akun ini tidak bisa login lagi.`)) return;
    const r = await api("/api/users", { method: "DELETE", body: JSON.stringify({ id: a.id }) });
    if (r.ok) {
      setMsg(`✅ Akun ${a.email} dihapus`);
      loadAccounts();
    } else setMsg(`❌ ${r.error}`);
  }

  async function createHost() {
    const r = await api("/api/hosts", { method: "POST", body: JSON.stringify(newHost) });
    if (r.ok) {
      setShowNewHost(false);
      setNewHost({ name: "", contact: "", note: "" });
      loadHosts();
    } else setMsg(`❌ ${r.error}`);
  }

  async function deleteHost(id: string, name: string) {
    if (!confirm(`Hapus host "${name}"? Assignment & riwayat sesinya ikut terhapus.`)) return;
    await api(`/api/hosts/${id}`, { method: "DELETE" });
    loadHosts();
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Setting</h1>
        <p className="text-zinc-400 text-sm">Profil, host, dan preferensi</p>
      </div>

      {msg && <p className="text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">{msg}</p>}

      {/* Profil */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <h2 className="font-semibold">Profil Akun</h2>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-zinc-400">Nama</label>
            <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Email</label>
            <input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
          </div>
        </div>
        <button onClick={saveProfile} className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
          Simpan Profil
        </button>

        <div className="border-t border-zinc-800 pt-4 grid md:grid-cols-2 gap-3 text-sm">
          <div>
            <label className="text-xs text-zinc-400">Password lama</label>
            <input type="password" value={pwd.currentPassword}
              onChange={(e) => setPwd({ ...pwd, currentPassword: e.target.value })}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
          </div>
          <div>
            <label className="text-xs text-zinc-400">Password baru (min. 8)</label>
            <input type="password" value={pwd.newPassword}
              onChange={(e) => setPwd({ ...pwd, newPassword: e.target.value })}
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
          </div>
        </div>
        <button onClick={changePassword} className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
          Ganti Password
        </button>
      </section>

      {/* Akun login dashboard */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Akun Login Dashboard ({accounts.length})</h2>
          <button onClick={() => setShowNewAccount(true)}
            className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
            + Buat Akun
          </button>
        </div>
        <p className="text-sm text-zinc-400">
          Akun untuk masuk ke dashboard ini, mis. untuk admin lain atau tim studio.
        </p>
        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-zinc-400 text-xs">
              <tr>
                {["Nama", "Email", "Dibuat", ""].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {accounts.map((a) => (
                <tr key={a.id} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3 font-medium">
                    {a.name}
                    {a.id === selfId && <span className="ml-2 text-[10px] font-bold bg-orange-600/30 text-orange-300 rounded px-1.5 py-0.5">Anda</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{a.email}</td>
                  <td className="px-4 py-3 text-zinc-400">{new Date(a.createdAt).toLocaleDateString("id-ID")}</td>
                  <td className="px-4 py-3 text-right">
                    {a.id !== selfId && (
                      <button onClick={() => deleteAccount(a)}
                        className="text-xs text-red-400/70 hover:text-red-400">Hapus</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Kelola Host */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Kelola Host ({total})</h2>
          <button onClick={() => setShowNewHost(true)}
            className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
            + Host Baru
          </button>
        </div>
        <input placeholder="Cari host…" value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm w-64 outline-none focus:border-orange-500" />

        <div className="rounded-lg border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-950/60 text-zinc-400 text-xs">
              <tr>
                {["Host", "Studio", "Shopee", "Kontak", ""].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/70">
              {hosts.map((h) => (
                <tr key={h.id} className="hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <Link href={`/live/host/${h.id}`} className="font-medium hover:text-orange-400">
                      {h.name}
                    </Link>
                    {h.liveNow && <span className="ml-2 text-[10px] font-bold bg-red-600 rounded px-1.5 py-0.5">LIVE</span>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{h.studio?.name ?? "—"}</td>
                  <td className="px-4 py-3">
                    {h.shopee.length === 0 ? (
                      <span className="text-zinc-500 text-xs">belum connect</span>
                    ) : (
                      h.shopee.map((a) => (
                        <span key={a.id} className={`text-xs ${
                          a.status === "active" ? "text-emerald-400" :
                          a.status === "expiring" ? "text-amber-400" : "text-red-400"
                        }`}>
                          ● {a.status === "active" ? "aktif" : a.status === "expiring" ? "hampir expired" : "expired"}
                        </span>
                      ))
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{h.contact || "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => deleteHost(h.id, h.name)}
                      className="text-xs text-red-400/70 hover:text-red-400">Hapus</button>
                  </td>
                </tr>
              ))}
              {hosts.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-500">Belum ada host.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}
              className="bg-zinc-800 rounded px-3 py-1.5 disabled:opacity-40">‹</button>
            <span className="text-zinc-400">Hal {page}/{totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}
              className="bg-zinc-800 rounded px-3 py-1.5 disabled:opacity-40">›</button>
          </div>
        )}
      </section>

      {/* Info konfigurasi Shopee */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="font-semibold mb-2">Integrasi Shopee Open Platform</h2>
        <p className="text-sm text-zinc-400">
          Kredensial Partner (SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY) diatur lewat environment variable server,
          bukan lewat UI — sesuai kebijakan keamanan (PRD §12). Selama kredensial kosong, aplikasi berjalan
          dalam <b className="text-amber-400">mode demo/mock</b>: sesi live, keranjang, dan metrik disimulasikan
          supaya seluruh alur bisa dipakai tanpa approval Shopee.
        </p>
      </section>

      {/* Modal buat akun */}
      {showNewAccount && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowNewAccount(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Buat Akun Login</h2>
            <p className="text-zinc-400 text-sm mb-4">Akun baru langsung bisa dipakai login ke dashboard.</p>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-zinc-400">Nama *</label>
                <input value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Email *</label>
                <input type="email" value={newAccount.email} onChange={(e) => setNewAccount({ ...newAccount, email: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Password (min. 8 karakter) *</label>
                <input type="password" value={newAccount.password} onChange={(e) => setNewAccount({ ...newAccount, password: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowNewAccount(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={createAccount}
                disabled={!newAccount.name.trim() || !newAccount.email.trim() || newAccount.password.length < 8}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                Buat Akun
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal host baru */}
      {showNewHost && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setShowNewHost(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Host Baru</h2>
            <div className="space-y-3 text-sm">
              {([["name", "Nama host *"], ["contact", "Kontak (WA/telepon)"], ["note", "Catatan"]] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-zinc-400">{label}</label>
                  <input value={newHost[key]} onChange={(e) => setNewHost({ ...newHost, [key]: e.target.value })}
                    className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setShowNewHost(false)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={createHost} className="bg-orange-600 hover:bg-orange-500 rounded-lg px-4 py-2 text-sm font-semibold">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
