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

type Account = { id: string; name: string; email: string; role: "admin" | "superuser"; createdAt: string };

export default function SettingPage() {
  const [profile, setProfile] = useState({ name: "", email: "", role: "admin" });
  const [pwd, setPwd] = useState({ currentPassword: "", newPassword: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selfId, setSelfId] = useState("");
  const [showNewAccount, setShowNewAccount] = useState(false);
  const [newAccount, setNewAccount] = useState({ name: "", email: "", password: "", role: "admin" });
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", password: "", role: "admin" });
  const [hosts, setHosts] = useState<Host[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [showNewHost, setShowNewHost] = useState(false);
  const [newHost, setNewHost] = useState({ name: "", contact: "", note: "" });
  const [editHost, setEditHost] = useState<Host | null>(null);
  const [editHostForm, setEditHostForm] = useState({ name: "", contact: "", note: "" });

  const pageSize = 25;

  const loadProfile = useCallback(async () => {
    const r = await api<{ user: { name: string; email: string; role: string } }>("/api/profile");
    if (r.ok) setProfile({
      name: r.user.name,
      email: r.user.email,
      role: r.user.role === "superuser" ? "superuser" : "admin",
    });
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
  useEffect(() => {
    if (profile.role === "superuser") loadAccounts();
  }, [loadAccounts, profile.role]);

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
      setNewAccount({ name: "", email: "", password: "", role: "admin" });
      loadAccounts();
    } else setMsg(`❌ ${r.error}`);
  }

  function openEditAccount(a: Account) {
    setEditAccount(a);
    setEditForm({ name: a.name, email: a.email, password: "", role: a.role });
  }

  async function saveEditAccount() {
    if (!editAccount) return;
    const r = await api("/api/users", {
      method: "PATCH",
      body: JSON.stringify({
        id: editAccount.id,
        name: editForm.name,
        email: editForm.email,
        role: editForm.role,
        ...(editForm.password ? { password: editForm.password } : {}),
      }),
    });
    if (r.ok) {
      setMsg(`✅ Akun ${editForm.email} diperbarui${editForm.password ? " (password diganti)" : ""}`);
      setEditAccount(null);
      loadAccounts();
      if (editAccount.id === selfId) loadProfile();
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

  function openEditHost(h: Host) {
    setEditHost(h);
    setEditHostForm({ name: h.name, contact: h.contact, note: h.note });
  }

  async function saveEditHost() {
    if (!editHost || !editHostForm.name.trim()) return;
    const r = await api(`/api/hosts/${editHost.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editHostForm.name.trim(),
        contact: editHostForm.contact,
        note: editHostForm.note,
      }),
    });
    if (r.ok) {
      setMsg(`✅ Host "${editHostForm.name.trim()}" diperbarui`);
      setEditHost(null);
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
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold">Setting</h1>
          <span className={`text-[10px] rounded px-2 py-0.5 ${
            profile.role === "superuser"
              ? "bg-purple-600/20 text-purple-300"
              : "bg-zinc-700 text-zinc-300"
          }`}>
            {profile.role === "superuser" ? "SUPERUSER" : "ADMIN"}
          </span>
        </div>
        <p className="text-zinc-400 text-sm">
          {profile.role === "superuser"
            ? "Akses semua studio, report, dan akun admin"
            : "Akses terbatas ke studio dan report milik Anda"}
        </p>
      </div>

      {msg && <p className="text-sm bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2">{msg}</p>}

      {/* Panduan menghubungkan host */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <div>
          <h2 className="font-semibold">Panduan: Menghubungkan Akun Shopee Host</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Ada dua cara agar dashboard bisa mengelola keranjang/pin & menarik metrik live host.
            Pilih salah satu sesuai cara host login ke Shopee.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div className="rounded-lg border border-orange-700/40 bg-orange-950/20 p-4 space-y-1">
            <h3 className="text-sm font-semibold text-orange-300">Cara A — OAuth (resmi)</h3>
            <p className="text-xs text-zinc-400">
              Untuk host yang punya <b className="text-zinc-300">username/no. HP + password Shopee</b>.
              Paling stabil. Dipakai lewat tombol <b className="text-zinc-300">Hubungkan Shopee</b> di panel host.
            </p>
          </div>
          <div className="rounded-lg border border-sky-700/40 bg-sky-950/20 p-4 space-y-1">
            <h3 className="text-sm font-semibold text-sky-300">Cara B — Cookie / Extension</h3>
            <p className="text-xs text-zinc-400">
              Untuk host yang daftar/masuk <b className="text-zinc-300">via Google</b> (tak punya password
              Shopee). Tanpa OAuth — extension menjalankan aksi memakai cookie login host di browser.
            </p>
          </div>
        </div>

        <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4 group">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-200 select-none">
            Cara A — Hubungkan via OAuth (host punya password Shopee)
          </summary>
          <ol className="mt-3 text-sm text-zinc-400 list-decimal ml-5 space-y-1.5">
            <li>Buka menu <b className="text-zinc-300">Live</b> → pilih studio → pilih host.</li>
            <li>Klik tombol <b className="text-zinc-300">Hubungkan Shopee</b>.</li>
            <li>Di halaman resmi Shopee Open Platform, login pakai username/no. HP/email + password
              akun Seller Shopee, lalu setujui otorisasi sampai browser kembali ke dashboard.</li>
            <li>Status akun berubah jadi <span className="text-emerald-400">aktif</span> (label
              <span className="text-orange-300"> OAuth</span>). Token otomatis di-refresh; tidak perlu login ulang.</li>
          </ol>
          <p className="mt-2 text-[11px] text-zinc-500">
            Catatan: tombol Google tidak tersedia di halaman otorisasi Shopee ini. Jika host cuma punya
            login Google, buat/reset password Shopee dulu, atau gunakan Cara B.
          </p>
        </details>

        <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-200 select-none">
            Cara B — Hubungkan via Cookie/Extension (host login Google)
          </summary>
          <div className="mt-3 space-y-3 text-sm text-zinc-400">
            <p>
              Prinsipnya: <b className="text-zinc-300">dashboard yang memerintah, extension yang
              mengeksekusi</b> memakai cookie login host di browser. Cookie tidak pernah dikirim/disimpan
              di server.
            </p>
            <div>
              <p className="font-medium text-zinc-300">Persiapan (sekali per host):</p>
              <ol className="list-decimal ml-5 space-y-1.5 mt-1">
                <li>Buka panel host (menu <b className="text-zinc-300">Live</b> → studio → host).</li>
                <li>Di bagian <b className="text-zinc-300">Hubungkan via Cookie (Extension)</b>, isi
                  <b className="text-zinc-300"> username live Shopee</b> host → Simpan Username
                  (dipakai untuk mencocokkan akun otomatis).</li>
                <li>Di browser tempat host login Shopee (boleh via Google), pasang extension
                  Elyasya-Studio dan isi token (lihat menu <b className="text-zinc-300">Extension</b>).</li>
                <li>Buka popup extension → bagian <b className="text-zinc-300">Kontrol Live via Cookie</b>
                  → pilih host → klik <b className="text-zinc-300">Tautkan Akun Ini</b>.</li>
                <li>Status akun host jadi <span className="text-emerald-400">aktif</span> dengan label
                  <span className="text-sky-300"> cookie/extension</span>.</li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-zinc-300">Mengajari tombol keranjang/pin (sekali saja):</p>
              <p className="mt-1">
                Cara Shopee menyimpan aksi pin/keranjang di live tidak terdokumentasi. Agar akurat,
                cukup <b className="text-zinc-300">satu kali</b> host/operator pin atau tambah 1 produk
                secara manual di halaman Shopee Live (dengan extension aktif). Extension merekam caranya,
                lalu semua perintah pin/keranjang dari dashboard akan meniru cara yang sama.
              </p>
            </div>
            <div>
              <p className="font-medium text-zinc-300">Saat live:</p>
              <p className="mt-1">
                Klik Pin/Push/Hapus produk seperti biasa di panel host. Perintah diantre dan
                dijalankan extension dalam beberapa detik. Metrik (GMV, order, penonton, likes)
                ditarik extension memakai cookie dan tampil di panel dengan auto-refresh.
              </p>
            </div>
            <p className="text-[11px] text-zinc-500">
              Syarat: browser host tetap terbuka & login Shopee, extension terpasang + token benar,
              dan &quot;Simpan&quot; sudah dilakukan di popup.
            </p>
          </div>
        </details>
      </section>

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

      {/* Akun login dashboard — hanya superuser */}
      {profile.role === "superuser" && (
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
                {["Nama", "Email", "Role", "Dibuat", ""].map((h, i) => (
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
                  <td className="px-4 py-3">
                    <span className={`text-[10px] rounded px-1.5 py-0.5 ${
                      a.role === "superuser"
                        ? "bg-purple-600/20 text-purple-300"
                        : "bg-zinc-700 text-zinc-300"
                    }`}>
                      {a.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{new Date(a.createdAt).toLocaleDateString("id-ID")}</td>
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => openEditAccount(a)}
                      className="text-xs text-zinc-400 hover:text-orange-400">Edit</button>
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
      )}

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
                  <td className="px-4 py-3 text-right space-x-3">
                    <button onClick={() => openEditHost(h)}
                      className="text-xs text-zinc-400 hover:text-orange-400">Edit</button>
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
              <div>
                <label className="text-xs text-zinc-400">Role</label>
                <select value={newAccount.role}
                  onChange={(e) => setNewAccount({ ...newAccount, role: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500">
                  <option value="admin">Admin — hanya data miliknya</option>
                  <option value="superuser">Superuser — semua data</option>
                </select>
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

      {/* Modal edit host */}
      {editHost && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditHost(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-4">Edit Host</h2>
            <div className="space-y-3 text-sm">
              {([["name", "Nama host *"], ["contact", "Kontak (WA/telepon)"], ["note", "Catatan"]] as const).map(([key, label]) => (
                <div key={key}>
                  <label className="text-xs text-zinc-400">{label}</label>
                  <input value={editHostForm[key]} onChange={(e) => setEditHostForm({ ...editHostForm, [key]: e.target.value })}
                    className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
                </div>
              ))}
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setEditHost(null)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={saveEditHost} disabled={!editHostForm.name.trim()}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal edit akun */}
      {editAccount && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditAccount(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-lg mb-1">Edit Akun</h2>
            <p className="text-zinc-400 text-sm mb-4">
              Ubah nama/email, atau isi password baru untuk mengganti password akun ini.
            </p>
            <div className="space-y-3 text-sm">
              <div>
                <label className="text-xs text-zinc-400">Nama *</label>
                <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Email *</label>
                <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Password baru (min. 8 — kosongkan jika tidak diganti)</label>
                <input type="password" value={editForm.password} onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500" />
              </div>
              <div>
                <label className="text-xs text-zinc-400">Role</label>
                <select value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 outline-none focus:border-orange-500">
                  <option value="admin">Admin — hanya data miliknya</option>
                  <option value="superuser">Superuser — semua data</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-5">
              <button onClick={() => setEditAccount(null)} className="px-4 py-2 text-sm text-zinc-400">Batal</button>
              <button onClick={saveEditAccount}
                disabled={!editForm.name.trim() || !editForm.email.trim() || (editForm.password.length > 0 && editForm.password.length < 8)}
                className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 rounded-lg px-4 py-2 text-sm font-semibold">
                Simpan
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
