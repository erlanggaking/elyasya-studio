"use client";

import { useCallback, useEffect, useState } from "react";
import { api, tanggal } from "@/lib/ui";

type Token = {
  id: string;
  label: string;
  token: string;
  createdAt: string;
  revoked: boolean;
  deviceCount: number;
};

type Device = {
  id: string;
  deviceId: string;
  label: string;
  accountLabel: string;
  lastSyncAt: string | null;
  registeredAt: string;
};

export default function ExtensionPage() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [copied, setCopied] = useState("");
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const load = useCallback(async () => {
    const r = await api<{ tokens: Token[]; devices: Device[] }>("/api/tokens");
    if (r.ok) {
      setTokens(r.tokens);
      setDevices(r.devices);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    await api("/api/tokens", { method: "POST", body: JSON.stringify({}) });
    load();
  }

  async function revoke(id: string) {
    if (!confirm("Revoke token ini? Device yang memakainya akan berhenti sync.")) return;
    await api("/api/tokens", { method: "DELETE", body: JSON.stringify({ id }) });
    load();
  }

  function copy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(""), 1500);
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Extension</h1>
        <p className="text-zinc-400 text-sm">Chrome extension untuk riset produk Shopee</p>
      </div>

      {/* Langkah instalasi */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4">
        <h2 className="font-semibold">Cara Install</h2>
        <ol className="text-sm text-zinc-300 space-y-2 list-decimal list-inside">
          <li>Download ZIP extension di bawah, lalu extract.</li>
          <li>Buka <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs">chrome://extensions</code> → aktifkan <b>Developer mode</b> → <b>Load unpacked</b> → pilih folder hasil extract.</li>
          <li>Generate token di bawah, buka popup extension, isi <b>API URL</b> (<code className="bg-zinc-800 px-1.5 py-0.5 rounded text-xs">{origin || "http://localhost:3000"}</code>) dan <b>Token</b>, klik Simpan.</li>
          <li>Buka <b>shopee.co.id</b> / <b>affiliate.shopee.co.id</b> dan mulai riset — hasil otomatis masuk menu Koleksi.</li>
        </ol>
        <a href="/api/extension/download"
          className="inline-block bg-orange-600 hover:bg-orange-500 rounded-lg px-5 py-2.5 text-sm font-semibold">
          ⬇ Download Extension (ZIP)
        </a>
      </section>

      {/* Token */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Token Koneksi</h2>
          <button onClick={generate}
            className="bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 text-sm font-medium">
            + Generate Token
          </button>
        </div>
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id}
              className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${t.revoked ? "border-zinc-800 opacity-50" : "border-zinc-700"}`}>
              <code className="text-xs flex-1 break-all">{t.revoked ? "(revoked)" : t.token}</code>
              <span className="text-xs text-zinc-500 whitespace-nowrap">{t.deviceCount} device</span>
              {!t.revoked && (
                <>
                  <button onClick={() => copy(t.token, t.id)}
                    className="text-xs bg-zinc-800 hover:bg-zinc-700 rounded px-2.5 py-1.5 whitespace-nowrap">
                    {copied === t.id ? "✓ Tersalin" : "Salin"}
                  </button>
                  <button onClick={() => revoke(t.id)}
                    className="text-xs text-red-400 hover:text-red-300">Revoke</button>
                </>
              )}
            </div>
          ))}
          {tokens.length === 0 && (
            <p className="text-zinc-500 text-sm">Belum ada token. Generate dulu untuk menghubungkan extension.</p>
          )}
        </div>
      </section>

      {/* Devices */}
      <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
        <h2 className="font-semibold mb-3">Device Terhubung ({devices.length})</h2>
        <div className="space-y-2">
          {devices.map((d) => (
            <div key={d.id} className="rounded-lg bg-zinc-800/60 px-4 py-3 flex items-center justify-between text-sm">
              <div>
                <div className="font-medium">{d.label} {d.accountLabel && <span className="text-zinc-400">· {d.accountLabel}</span>}</div>
                <div className="text-xs text-zinc-500">Terdaftar {tanggal(d.registeredAt)}</div>
              </div>
              <div className="text-xs text-zinc-400">
                Last sync: {d.lastSyncAt ? tanggal(d.lastSyncAt) : "belum pernah"}
              </div>
            </div>
          ))}
          {devices.length === 0 && (
            <p className="text-zinc-500 text-sm">Belum ada device. Install extension lalu klik &quot;Daftarkan Device&quot; di popup-nya.</p>
          )}
        </div>
      </section>
    </div>
  );
}
