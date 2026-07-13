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

loadConfig();
