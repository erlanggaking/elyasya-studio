"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/ui";

export default function LoginPage() {
  const router = useRouter();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ needsSetup: boolean }>("/api/auth/setup").then((r) =>
      setNeedsSetup(!!r.needsSetup)
    );
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const url = needsSetup ? "/api/auth/setup" : "/api/auth/login";
    const r = await api(url, {
      method: "POST",
      body: JSON.stringify({ email, password, name }),
    });
    setBusy(false);
    if (r.ok) router.push("/");
    else setError(r.error || "Gagal");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-3xl font-bold tracking-tight">
            elyasya<span className="text-orange-500">studio</span>
          </div>
          <p className="text-zinc-400 text-sm mt-1">
            Shopee Affiliate Live Management
          </p>
        </div>

        <form
          onSubmit={submit}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4"
        >
          <h1 className="font-semibold text-lg">
            {needsSetup === null ? "…" : needsSetup ? "Buat Akun Admin Pertama" : "Masuk"}
          </h1>

          {needsSetup && (
            <div>
              <label className="text-xs text-zinc-400">Nama</label>
              <input
                className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama kamu"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-zinc-400">Email</label>
            <input
              type="email"
              required
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@elyasyastudio.com"
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400">
              Password {needsSetup && "(min. 8 karakter)"}
            </label>
            <input
              type="password"
              required
              className="mt-1 w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-500"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            disabled={busy || needsSetup === null}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded-lg py-2.5 text-sm font-semibold transition"
          >
            {busy ? "Memproses…" : needsSetup ? "Buat Akun & Masuk" : "Masuk"}
          </button>
        </form>
      </div>
    </div>
  );
}
