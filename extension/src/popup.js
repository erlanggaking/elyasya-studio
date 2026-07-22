const apiUrlEl = document.getElementById("apiUrl");
const tokenEl = document.getElementById("token");
const saveBtn = document.getElementById("saveBtn");
const pingBtn = document.getElementById("pingBtn");
const statusEl = document.getElementById("status");

function setStatus(text, type = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${type}`.trim();
}

const accountLabelEl = document.getElementById("accountLabel");

async function loadConfig() {
  const stored = await chrome.storage.sync.get(["apiUrl", "token", "accountLabel"]);
  apiUrlEl.value = stored.apiUrl || "https://elyasyastudio.com";
  tokenEl.value = stored.token || "";
  if (accountLabelEl) accountLabelEl.value = stored.accountLabel || "";
}

saveBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiUrl: apiUrlEl.value.trim().replace(/\/$/, ""),
    token: tokenEl.value.trim(),
    accountLabel: accountLabelEl?.value.trim() || "",
  });
  setStatus("Konfigurasi disimpan.", "ok");
  // Re-register agar server tahu label akun terbaru.
  try {
    await chrome.runtime.sendMessage({ type: "REGISTER_DEVICE" });
  } catch {
    /* ok */
  }
});

pingBtn.addEventListener("click", async () => {
  await chrome.storage.sync.set({
    apiUrl: apiUrlEl.value.trim().replace(/\/$/, ""),
    token: tokenEl.value.trim(),
  });
  setStatus("Mengetes...");
  // Selalu tampilkan versi extension yang terpasang (bukan versi server remote).
  const extVersion = chrome.runtime.getManifest().version;
  try {
    const result = await chrome.runtime.sendMessage({ type: "PING" });
    if (result?.ok) {
      const serverV = result.data?.version;
      const serverNote = serverV && serverV !== extVersion ? ` (server v${serverV})` : "";
      setStatus(`Terhubung · v${extVersion}${serverNote}`, "ok");
    } else {
      setStatus(result?.error || "Gagal koneksi", "err");
    }
  } catch {
    setStatus("Reload extension", "err");
  }
});

// Versi extension aktual di subtitle.
try {
  const v = chrome.runtime.getManifest().version;
  const sub = document.getElementById("subtitle");
  if (sub) sub.textContent = `v${v} · Riset & Live`;
} catch {
  /* ok */
}

// Toggle capture DevTools Protocol.
const captureToggle = document.getElementById("captureToggle");
if (captureToggle) {
  chrome.runtime
    .sendMessage({ type: "GET_CAPTURE_ENABLED" })
    .then((r) => {
      if (r && typeof r.enabled === "boolean") captureToggle.checked = r.enabled;
    })
    .catch(() => {});
  captureToggle.addEventListener("change", async () => {
    await chrome.runtime
      .sendMessage({ type: "SET_CAPTURE_ENABLED", enabled: captureToggle.checked })
      .catch(() => {});
    setStatus(
      captureToggle.checked
        ? "Capture presisi aktif — reload tab Shopee."
        : "Capture presisi dimatikan — reload tab Shopee.",
      "ok"
    );
  });
}

// --- Kontrol Live via cookie: tautkan akun Shopee yang login ke host ---------
const hostSelect = document.getElementById("hostSelect");
const refreshHostsBtn = document.getElementById("refreshHostsBtn");
const identifyBtn = document.getElementById("identifyBtn");

async function loadHosts() {
  const stored = await chrome.storage.sync.get(["apiUrl", "token"]);
  const apiUrl = (stored.apiUrl || "https://elyasyastudio.com").replace(/\/$/, "");
  const token = stored.token || "";
  if (!token) {
    setStatus("Isi token dulu untuk memuat host.", "err");
    return;
  }
  try {
    const res = await fetch(`${apiUrl}/api/extension/hosts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setStatus(data.error || "Gagal memuat host", "err");
      return;
    }
    hostSelect.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "";
    auto.textContent = "— Auto-cocokkan (uid/username) —";
    hostSelect.appendChild(auto);
    for (const h of data.hosts || []) {
      const o = document.createElement("option");
      o.value = h.id;
      o.textContent = `${h.cookie_connected ? "● " : ""}${h.name}${h.studio ? ` · ${h.studio}` : ""}`;
      hostSelect.appendChild(o);
    }
    setStatus(`${(data.hosts || []).length} host dimuat.`, "ok");
  } catch {
    setStatus("Tidak bisa menghubungi dashboard.", "err");
  }
}

if (refreshHostsBtn) refreshHostsBtn.addEventListener("click", loadHosts);

if (identifyBtn) {
  identifyBtn.addEventListener("click", async () => {
    setStatus("Membaca akun Shopee yang login…");
    try {
      const r = await chrome.runtime.sendMessage({
        type: "IDENTIFY_LIVE",
        hostId: hostSelect?.value || "",
      });
      if (r?.ok) {
        setStatus(`Tertaut: ${r.host?.name || "host"} ← ${r.account?.shopName || "akun"}`, "ok");
        loadHosts();
      } else {
        setStatus(r?.error || "Gagal menautkan", "err");
      }
    } catch {
      setStatus("Reload extension lalu coba lagi.", "err");
    }
  });
}

loadConfig();
loadHosts();
