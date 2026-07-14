/**
 * Elyasya-Studio — Research UI (summary panel + detail modal)
 */
window.ElyasyaResearchUI = (function () {
  const R = () => window.ElyasyaResearch;
  const HOST_ID = "elyasya-research-host";
  const PANEL_ID = "elyasya-research-panel";
  const MODAL_ID = "elyasya-detail-modal";

  // Penjelasan sumber tiap kolom — tampil sebagai tooltip saat kursor di sel/judul kolom.
  const COL_TIPS = {
    name: "Nama Produk — diambil dari API pencarian Shopee (field name); kalau API tidak tertangkap, dibaca dari teks kartu produk di halaman.",
    rating: "Peringkat — rata-rata bintang ulasan pembeli, dari API Shopee (item_rating.rating_star). — berarti data tidak tersedia.",
    reviews: "Ulasan — jumlah ulasan pembeli, dari API Shopee (rating_count).",
    trend: "Tren — dihitung: (penjualan 30 hari − rata-rata penjualan/bulan) ÷ rata-rata penjualan/bulan × 100%. Positif = penjualan terakhir di atas rata-rata bulanan.",
    created: "Dibuat — tanggal produk diunggah penjual, dari API Shopee (ctime).",
    price: "Harga — harga terendah produk dari API Shopee, atau teks Rp di kartu produk bila sumbernya halaman.",
    revenue30d: "Pendapatan 30 hari — hasil hitung: penjualan 30 hari × harga.",
    monthlyRevenue: "Rata-rata Omset/Bulan — hasil hitung: rata-rata penjualan per bulan × harga.",
    totalRevenue: "Total Pendapatan — hasil hitung: total penjualan × harga.",
    sold30d: "Penjualan (30 Hari) — dari API Shopee (monthly_sold_count / sold); kalau tidak tersedia, estimasi: total penjualan ÷ umur produk (bulan).",
    soldMonthly: "Rata-rata Penjualan per bulan — hasil hitung: total penjualan ÷ umur produk dalam bulan (sejak tanggal dibuat; dianggap 12 bulan bila tanggal tak diketahui).",
    soldTotal: "Total Penjualan — akumulasi terjual sejak produk dibuat, dari API Shopee (historical_sold) atau angka X terjual di kartu produk (10RB+ berarti minimal 10 ribu).",
    stock: "Stok — sisa stok dari API Shopee. — berarti penjual menyembunyikan stok atau data tidak tersedia.",
    stockValue: "Harga Produk — harga satuan produk dalam rupiah penuh (tanpa pembulatan rb/jt).",
    commission: "Komisi — nominal = harga × rate. Rate diambil dari produk yang pernah terlihat di portal affiliate (browse produk/keyword yang sama di affiliate.shopee.co.id dulu), atau otomatis dari Shopee Affiliate API bila server dikonfigurasi. — berarti rate belum ditemukan.",
  };

  const STAT_TIPS = {
    totalItems: "Total Item — jumlah produk yang terakumulasi dari semua halaman yang sudah dimuat.",
    totalSold: "Total Penjualan — penjumlahan total terjual seluruh produk.",
    totalRevenue: "Total Pendapatan — penjumlahan (total terjual × harga) seluruh produk.",
    avgMonthly: "Rata-rata Omset/Bulan — penjumlahan omset bulanan (rata-rata penjualan/bulan × harga) seluruh produk.",
    revenue30d: "Pendapatan 30 hari — penjumlahan (penjualan 30 hari × harga) seluruh produk.",
    avgTrend: "Tren — rata-rata persentase tren seluruh produk (penjualan 30 hari dibanding rata-rata bulanannya).",
  };

  // Tooltip per sel: penjelasan kolom + sumber baris ini (API atau teks halaman).
  function cellTip(key, p) {
    const src = p && p._dom
      ? " Sumber baris ini: teks kartu produk di halaman (DOM)."
      : " Sumber baris ini: API Shopee.";
    return escapeHtml((COL_TIPS[key] || "") + src);
  }

  const modalState = {
    selected: new Set(),
    sort: "name",
    minSold30: 0,
    minStock: 0,
    minRating: 0,
    minReviews: 0,
    mallOnly: false,
    starOnly: false,
    nonStarOnly: false,
    adsOnly: false,
    page: 1,
    perPage: 100,
  };

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "elyasya-research-panel";
    panel.innerHTML = `
      <div class="elyasya-research-panel__head">
        <span class="elyasya-research-panel__brand">Elyasya-Studio</span>
        <span class="elyasya-research-panel__title">riset data per halaman</span>
        <span class="elyasya-research-panel__keyword"></span>
        <button type="button" class="elyasya-collapse-btn" id="elyasya-btn-collapse" title="Ciutkan / buka">–</button>
      </div>
      <div class="elyasya-research-panel__grid">
        <div class="elyasya-metric" title="${escapeHtml(STAT_TIPS.totalItems)}"><span class="elyasya-metric__icon">📦</span><div><div class="elyasya-metric__val" data-k="totalItems">0</div><div class="elyasya-metric__lbl">Total Item</div></div></div>
        <div class="elyasya-metric" title="${escapeHtml(STAT_TIPS.totalSold)}"><span class="elyasya-metric__icon">🛒</span><div><div class="elyasya-metric__val" data-k="totalSold">0</div><div class="elyasya-metric__lbl">Total Penjualan</div></div></div>
        <div class="elyasya-metric" title="${escapeHtml(STAT_TIPS.totalRevenue)}"><span class="elyasya-metric__icon">💰</span><div><div class="elyasya-metric__val" data-k="totalRevenue">0</div><div class="elyasya-metric__lbl">Total Pendapatan</div></div></div>
        <div class="elyasya-metric" title="${escapeHtml(STAT_TIPS.avgMonthly)}"><span class="elyasya-metric__icon">📊</span><div><div class="elyasya-metric__val" data-k="avgMonthly">0</div><div class="elyasya-metric__lbl">Rata-rata Omset/Bulan</div></div></div>
        <div class="elyasya-metric" title="${escapeHtml(STAT_TIPS.revenue30d)}"><span class="elyasya-metric__icon">📈</span><div><div class="elyasya-metric__val" data-k="revenue30d">0</div><div class="elyasya-metric__lbl">Pendapatan 30 hari</div></div></div>
        <div class="elyasya-metric" title="${escapeHtml(STAT_TIPS.avgTrend)}"><span class="elyasya-metric__icon">🚀</span><div><div class="elyasya-metric__val" data-k="avgTrend">0%</div><div class="elyasya-metric__lbl">Tren</div></div></div>
      </div>
      <div class="elyasya-research-panel__pages"></div>
      <div class="elyasya-research-panel__actions">
        <button type="button" class="elyasya-btn elyasya-btn--orange" id="elyasya-btn-next">halaman selanjutnya</button>
        <button type="button" class="elyasya-btn elyasya-btn--orange" id="elyasya-btn-detail">detail data</button>
      </div>
    `;

    panel.querySelector("#elyasya-btn-next").addEventListener("click", onNextPage);
    panel.querySelector("#elyasya-btn-detail").addEventListener("click", openDetailModal);
    panel.querySelector("#elyasya-btn-collapse").addEventListener("click", () => {
      const collapsed = panel.classList.toggle("collapsed");
      const btn = panel.querySelector("#elyasya-btn-collapse");
      if (btn) btn.textContent = collapsed ? "+" : "–";
    });

    return panel;
  }

  function ensureHost() {
    let host = document.getElementById(HOST_ID);
    if (host) return host;
    host = document.createElement("div");
    host.id = HOST_ID;
    host.className = "elyasya-research-host";
    (document.documentElement || document.body).appendChild(host);
    return host;
  }

  function mountPanel() {
    const host = ensureHost();
    const panel = ensurePanel();
    if (!panel.parentElement || panel.parentElement !== host) {
      host.appendChild(panel);
    }
    host.style.display = "block";
    panel.style.display = "block";
    return panel;
  }

  function showLoading(keyword) {
    const panel = mountPanel();
    panel.style.display = "block";
    const kw = panel.querySelector(".elyasya-research-panel__keyword");
    if (kw) kw.textContent = keyword ? `"${keyword}"` : "";
    const pages = panel.querySelector(".elyasya-research-panel__pages");
    if (pages) pages.textContent = "Memuat data riset...";
  }

  function updatePanel(stats, keyword) {
    const panel = mountPanel();
    panel.style.display = "block";

    const kw = panel.querySelector(".elyasya-research-panel__keyword");
    if (kw) kw.textContent = keyword ? `"${keyword}"` : "";

    const pages = panel.querySelector(".elyasya-research-panel__pages");
    if (pages) {
      pages.textContent = `${stats.pagesLoaded} halaman · akumulasi ${stats.totalItems} produk`;
    }

    const map = {
      totalItems: R().formatNum(stats.totalItems),
      totalSold: R().formatNum(stats.totalSold),
      totalRevenue: R().formatIDR(stats.totalRevenue),
      avgMonthly: R().formatIDR(stats.avgMonthlyRevenue),
      revenue30d: R().formatIDR(stats.revenue30d),
      avgTrend: `${stats.avgTrend >= 0 ? "▲" : "▼"} ${Math.abs(stats.avgTrend)}%`,
    };

    panel.querySelectorAll("[data-k]").forEach((el) => {
      const k = el.getAttribute("data-k");
      if (map[k] != null) el.textContent = map[k];
    });

    const nextBtn = panel.querySelector("#elyasya-btn-next");
    if (nextBtn) {
      nextBtn.disabled = R().state.loading || !R().state.hasMore;
      nextBtn.textContent = R().state.loading
        ? "memuat..."
        : R().state.hasMore
          ? "halaman selanjutnya"
          : "semua halaman dimuat";
    }
  }

  function hidePanel() {
    const host = document.getElementById(HOST_ID);
    const panel = document.getElementById(PANEL_ID);
    if (host) host.style.display = "none";
    if (panel) panel.style.display = "none";
  }

  function keepPanelAlive() {
    if (!document.getElementById(HOST_ID) || !document.getElementById(PANEL_ID)?.isConnected) {
      mountPanel();
    }
  }

  async function onNextPage() {
    const panel = mountPanel();
    const pages = panel.querySelector(".elyasya-research-panel__pages");
    const nextBtn = panel.querySelector("#elyasya-btn-next");
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.textContent = "memuat...";
    }

    const result = await R().fetchNextPage();
    if (result.ok) {
      updatePanel(result.stats, R().state.keyword);
      await R().enrichAllCommissions();
      await R().enrichFromShopee?.();
      updatePanel(R().computeStats(R().getProducts()), R().state.keyword);
      if (document.getElementById(MODAL_ID)?.classList.contains("open")) renderModal();
    } else {
      updatePanel(R().computeStats(R().getProducts()), R().state.keyword);
      if (pages) {
        pages.textContent = `${R().state.pagesLoaded} halaman · ${result.error || "gagal memuat"}`;
      }
    }
  }

  function filterProducts(products) {
    let list = products.slice();

    if (modalState.mallOnly) list = list.filter((p) => p.isMall);
    if (modalState.starOnly) list = list.filter((p) => p.isStar);
    if (modalState.nonStarOnly) list = list.filter((p) => !p.isStar);
    if (modalState.adsOnly) list = list.filter((p) => p.isAds);
    if (modalState.minSold30 > 0) list = list.filter((p) => p.sold30d >= modalState.minSold30);
    if (modalState.minStock > 0) list = list.filter((p) => p.stock >= modalState.minStock);
    if (modalState.minRating > 0) list = list.filter((p) => p.rating >= modalState.minRating);
    if (modalState.minReviews > 0) list = list.filter((p) => p.reviews >= modalState.minReviews);

    const sortKey = modalState.sort;
    list.sort((a, b) => {
      if (sortKey === "price") return a.price - b.price;
      if (sortKey === "sold30") return b.sold30d - a.sold30d;
      if (sortKey === "soldTotal") return b.soldTotal - a.soldTotal;
      if (sortKey === "trend") return b.trend - a.trend;
      if (sortKey === "commission") return b.commissionRate - a.commissionRate;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  function renderTableRows(products) {
    const start = (modalState.page - 1) * modalState.perPage;
    const slice = products.slice(start, start + modalState.perPage);

    return slice
      .map((p) => {
        const trendCls = p.trend >= 0 ? "up" : "down";
        const trendIcon = p.trend >= 0 ? "▲" : "▼";
        const badges = [
          p.isMall ? '<span class="elyasya-badge mall">Mall</span>' : "",
          p.isStar ? '<span class="elyasya-badge star">Star+</span>' : "",
        ].join("");
        return `<tr data-key="${escapeHtml(p.key)}">
          <td class="elyasya-td-check"><input type="checkbox" class="elyasya-row-check" data-key="${escapeHtml(p.key)}"${modalState.selected.has(p.key) ? " checked" : ""} /></td>
          <td class="elyasya-td-name" title="${cellTip("name", p)}">
            <img src="${escapeHtml(p.imageUrl || "")}" alt="" class="elyasya-thumb" />
            <div>
              <div class="elyasya-pname">${badges}${escapeHtml(p.name)}</div>
              <div class="elyasya-ploc">${escapeHtml(p.shopLocation || p.shopName)}</div>
            </div>
          </td>
          <td title="${cellTip("rating", p)}">${Number.isFinite(p.rating) && p.rating > 0 ? p.rating.toFixed(1) : "—"}</td>
          <td title="${cellTip("reviews", p)}">${Number.isFinite(p.reviews) && p.reviews > 0 ? R().formatNum(p.reviews) : "—"}</td>
          <td class="elyasya-trend ${trendCls}" title="${cellTip("trend", p)}">${trendIcon} ${Math.abs(p.trend)}%</td>
          <td title="${cellTip("created", p)}">${p.createdLabel}</td>
          <td title="${cellTip("price", p)}">${R().formatIDR(p.price)}</td>
          <td title="${cellTip("revenue30d", p)}">${R().formatIDR(p.revenue30d)}</td>
          <td title="${cellTip("monthlyRevenue", p)}">${R().formatIDR(p.monthlyRevenue)}</td>
          <td title="${cellTip("totalRevenue", p)}">${R().formatIDR(p.totalRevenue)}</td>
          <td title="${cellTip("sold30d", p)}">${R().formatNum(p.sold30d)}</td>
          <td title="${cellTip("soldMonthly", p)}">${R().formatNum(p.soldMonthly)}</td>
          <td title="${cellTip("soldTotal", p)}">${R().formatNum(p.soldTotal)}</td>
          <td title="${cellTip("stock", p)}">${p.stock != null && p.stock > 0 ? R().formatNum(p.stock) : "—"}</td>
          <td title="${cellTip("stockValue", p)}">${p.price > 0 ? `Rp ${Number(p.price).toLocaleString("id-ID")}` : "—"}</td>
          <td class="elyasya-comm" title="${cellTip("commission", p)}">${p.commissionRate > 0 ? `${p.commissionRate}% · ${R().formatIDR(p.estimatedCommission)}` : "—"}</td>
        </tr>`;
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    const all = R().getProducts();
    const filtered = filterProducts(all);
    const stats = R().computeStats(filtered);
    const totalPages = Math.max(1, Math.ceil(filtered.length / modalState.perPage));
    if (modalState.page > totalPages) modalState.page = totalPages;

    const start = (modalState.page - 1) * modalState.perPage;
    const end = Math.min(start + modalState.perPage, filtered.length);

    modal.querySelector(".elyasya-modal-stats").innerHTML = `
      <div class="elyasya-stat-card blue" title="${escapeHtml(STAT_TIPS.totalItems)}"><div class="v">${R().formatNum(stats.totalItems)}</div><div class="l">Total Item</div></div>
      <div class="elyasya-stat-card purple" title="${escapeHtml(STAT_TIPS.totalSold)}"><div class="v">${R().formatNum(stats.totalSold)}</div><div class="l">Total Penjualan</div></div>
      <div class="elyasya-stat-card yellow" title="${escapeHtml(STAT_TIPS.totalRevenue)}"><div class="v">${R().formatIDR(stats.totalRevenue)}</div><div class="l">Total Pendapatan</div></div>
      <div class="elyasya-stat-card red" title="${escapeHtml(STAT_TIPS.avgMonthly)}"><div class="v">${R().formatIDR(stats.avgMonthlyRevenue)}</div><div class="l">Rata-rata Omset/Bulan</div></div>
      <div class="elyasya-stat-card green" title="${escapeHtml(STAT_TIPS.revenue30d)}"><div class="v">${R().formatIDR(stats.revenue30d)}</div><div class="l">Pendapatan 30 hari</div></div>
      <div class="elyasya-stat-card cyan" title="${escapeHtml(STAT_TIPS.avgTrend)}"><div class="v">${stats.avgTrend >= 0 ? "▲" : "▼"} ${Math.abs(stats.avgTrend)}%</div><div class="l">Tren</div></div>
    `;

    modal.querySelector(".elyasya-modal-table tbody").innerHTML = renderTableRows(filtered);

    const pag = modal.querySelector(".elyasya-modal-paginfo");
    if (pag) {
      pag.textContent = `${filtered.length ? start + 1 : 0}-${end} of ${filtered.length} items (page ${modalState.page} of ${totalPages})`;
    }

    refreshSelectionInfo();
  }

  function exportCsv() {
    const filtered = filterProducts(R().getProducts());
    const rows = [
      [
        "nama",
        "shop_id",
        "item_id",
        "rating",
        "ulasan",
        "tren",
        "dibuat",
        "harga",
        "pendapatan_30hr",
        "omset_bulan",
        "total_pendapatan",
        "sold_30hr",
        "sold_bulan",
        "total_sold",
        "stok",
        "harga_produk",
        "komisi_pct",
        "est_komisi",
      ],
    ];
    for (const p of filtered) {
      rows.push([
        p.name,
        p.shopId,
        p.itemId,
        p.rating,
        p.reviews,
        p.trend,
        p.createdLabel,
        p.price,
        p.revenue30d,
        p.monthlyRevenue,
        p.totalRevenue,
        p.sold30d,
        p.soldMonthly,
        p.soldTotal,
        p.stock,
        p.price,
        p.commissionRate,
        p.estimatedCommission,
      ]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `elyasya-riset-${R().state.keyword || "data"}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function setActionStatus(text, isError = false) {
    const el = document.getElementById("elyasya-action-status");
    if (!el) return;
    el.textContent = text;
    el.classList.toggle("err", !!isError);
  }

  function refreshSelectionInfo() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    const boxes = [...modal.querySelectorAll(".elyasya-row-check")];
    const all = modal.querySelector("#elyasya-check-all");
    if (all) all.checked = boxes.length > 0 && boxes.every((b) => b.checked);
    setActionStatus(modalState.selected.size ? `${modalState.selected.size} produk dipilih` : "");
  }

  function getSelectedProducts() {
    const out = [];
    for (const key of modalState.selected) {
      const p = R().state.products.get(key);
      if (p) out.push(p);
    }
    return out;
  }

  async function sendToDashboard() {
    const selected = getSelectedProducts();
    const list = selected.length ? selected : filterProducts(R().getProducts());
    if (!list.length) {
      setActionStatus("Tidak ada produk untuk dikirim", true);
      return;
    }
    setActionStatus(`Mengirim ${list.length} produk ke dashboard...`);
    try {
      await chrome.runtime.sendMessage({
        type: "CAPTURE",
        capture: {
          kind: "search",
          url: location.href,
          page_url: location.href,
          payload: { data: { list } },
          captured_at: new Date().toISOString(),
        },
        products: list.map((p) => ({
          key: p.key,
          itemId: p.itemId,
          shopId: p.shopId,
          name: p.name,
          price: p.price,
          commissionRate: p.commissionRate,
          estimatedCommission: p.estimatedCommission,
        })),
      });
      const res = await chrome.runtime.sendMessage({ type: "SYNC_NOW" });
      if (res?.ok) {
        setActionStatus(res.message || `Terkirim ${list.length} produk ke dashboard`);
      } else {
        setActionStatus(res?.error || "Gagal sync ke dashboard", true);
      }
    } catch {
      setActionStatus("Gagal mengirim — coba reload extension", true);
    }
  }

  function deleteSelected() {
    if (!modalState.selected.size) {
      setActionStatus("Centang dulu produk yang mau dihapus", true);
      return;
    }
    const n = modalState.selected.size;
    for (const key of modalState.selected) {
      R().state.products.delete(key);
    }
    modalState.selected.clear();
    renderModal();
    updatePanel(R().computeStats(R().getProducts()), R().state.keyword);
    setActionStatus(`${n} produk dihapus`);
  }

  function resetAllData() {
    const st = R().state;
    st.products.clear();
    st.pagesLoaded = 0;
    st.loadedOffsets.clear();
    st.hasMore = true;
    st.lastRequest = null;
    st.apiCaptured = false;
    modalState.selected.clear();
    modalState.page = 1;
    renderModal();
    updatePanel(R().computeStats([]), st.keyword);
    setActionStatus("Semua data riset direset");
  }

  function ensureModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "elyasya-detail-modal";
    modal.innerHTML = `
      <div class="elyasya-detail-modal__backdrop"></div>
      <div class="elyasya-detail-modal__box">
        <div class="elyasya-detail-modal__header">
          <span>Elyasya Riset Data</span>
          <div class="elyasya-detail-modal__header-actions">
            <button type="button" class="elyasya-icon-btn" id="elyasya-export-csv" title="Export CSV">📊</button>
            <button type="button" class="elyasya-icon-btn elyasya-close" id="elyasya-close-modal">✕</button>
          </div>
        </div>
        <div class="elyasya-modal-stats"></div>
        <div class="elyasya-modal-filters">
          <label>Sort
            <select id="elyasya-f-sort">
              <option value="name">Nama</option>
              <option value="price">Harga</option>
              <option value="sold30">Penjualan</option>
              <option value="soldTotal">Total Penjualan</option>
              <option value="trend">Tren</option>
              <option value="commission">Komisi</option>
            </select>
          </label>
          <label>Penjualan 30hr &gt; <input type="number" id="elyasya-f-sold" min="0" /></label>
          <label>Stok &gt; <input type="number" id="elyasya-f-stock" min="0" /></label>
          <label>Rating &gt;= <input type="number" id="elyasya-f-rating" min="0" max="5" step="0.1" /></label>
          <label>Ulasan &gt;= <input type="number" id="elyasya-f-reviews" min="0" /></label>
          <button type="button" class="elyasya-btn-filter" id="elyasya-apply-filter">Filter</button>
          <label class="elyasya-chk"><input type="checkbox" id="elyasya-f-mall" /> Mall</label>
          <label class="elyasya-chk"><input type="checkbox" id="elyasya-f-star" /> Star/Star+</label>
          <label class="elyasya-chk"><input type="checkbox" id="elyasya-f-nonstar" /> Non Star</label>
          <label class="elyasya-chk"><input type="checkbox" id="elyasya-f-ads" /> Tampilkan Hanya Iklan</label>
        </div>
        <div class="elyasya-modal-toolbar">
          <label>Produk Per Halaman
            <select id="elyasya-f-perpage">
              <option value="50">50</option>
              <option value="100" selected>100</option>
              <option value="200">200</option>
            </select>
          </label>
          <button type="button" class="elyasya-btn-action send" id="elyasya-send-dash" title="Kirim produk terpilih (atau semua hasil filter bila tidak ada yang dicentang) ke dashboard Elyasya Studio">kirim ke dashboard</button>
          <button type="button" class="elyasya-btn-action danger" id="elyasya-del-selected" title="Hapus baris yang dicentang dari data riset">hapus</button>
          <button type="button" class="elyasya-btn-action" id="elyasya-reset-data" title="Kosongkan semua data riset yang terakumulasi">reset</button>
          <span class="elyasya-action-status" id="elyasya-action-status"></span>
          <button type="button" class="elyasya-pag" id="elyasya-pag-first">«</button>
          <button type="button" class="elyasya-pag" id="elyasya-pag-prev">‹</button>
          <span class="elyasya-modal-paginfo"></span>
          <button type="button" class="elyasya-pag" id="elyasya-pag-next">›</button>
          <button type="button" class="elyasya-pag" id="elyasya-pag-last">»</button>
        </div>
        <div class="elyasya-modal-table-wrap">
          <table class="elyasya-modal-table">
            <thead>
              <tr>
                <th class="elyasya-th-check"><input type="checkbox" id="elyasya-check-all" title="Pilih semua di halaman ini" /></th>
                <th title="${escapeHtml(COL_TIPS.name)}">Nama Produk</th>
                <th title="${escapeHtml(COL_TIPS.rating)}">Peringkat</th>
                <th title="${escapeHtml(COL_TIPS.reviews)}">ulasan</th>
                <th title="${escapeHtml(COL_TIPS.trend)}">Tren</th>
                <th title="${escapeHtml(COL_TIPS.created)}">Dibuat</th>
                <th title="${escapeHtml(COL_TIPS.price)}">Harga</th>
                <th title="${escapeHtml(COL_TIPS.revenue30d)}">Pendapatan 30 hari</th>
                <th title="${escapeHtml(COL_TIPS.monthlyRevenue)}">Rata-rata Omset/Bulan</th>
                <th title="${escapeHtml(COL_TIPS.totalRevenue)}">Total Pendapatan</th>
                <th title="${escapeHtml(COL_TIPS.sold30d)}">Penjualan (30 Hari)</th>
                <th title="${escapeHtml(COL_TIPS.soldMonthly)}">Rata-rata Penjualan per bulan</th>
                <th title="${escapeHtml(COL_TIPS.soldTotal)}">Total Penjualan</th>
                <th title="${escapeHtml(COL_TIPS.stock)}">Stok</th>
                <th title="${escapeHtml(COL_TIPS.stockValue)}">Harga Produk</th>
                <th title="${escapeHtml(COL_TIPS.commission)}">Komisi</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    modal.querySelector(".elyasya-detail-modal__backdrop").addEventListener("click", closeDetailModal);
    modal.querySelector("#elyasya-close-modal").addEventListener("click", closeDetailModal);
    modal.querySelector("#elyasya-export-csv").addEventListener("click", exportCsv);
    modal.querySelector("#elyasya-apply-filter").addEventListener("click", () => {
      modalState.page = 1;
      readFilters(modal);
      renderModal();
    });
    modal.querySelector("#elyasya-f-perpage").addEventListener("change", (e) => {
      modalState.perPage = Number(e.target.value) || 100;
      modalState.page = 1;
      renderModal();
    });
    modal.querySelector("#elyasya-pag-prev").addEventListener("click", () => {
      modalState.page = Math.max(1, modalState.page - 1);
      renderModal();
    });
    modal.querySelector("#elyasya-pag-next").addEventListener("click", () => {
      const total = filterProducts(R().getProducts()).length;
      const max = Math.ceil(total / modalState.perPage);
      modalState.page = Math.min(max, modalState.page + 1);
      renderModal();
    });
    modal.querySelector("#elyasya-pag-first").addEventListener("click", () => {
      modalState.page = 1;
      renderModal();
    });
    modal.querySelector("#elyasya-pag-last").addEventListener("click", () => {
      const total = filterProducts(R().getProducts()).length;
      modalState.page = Math.ceil(total / modalState.perPage) || 1;
      renderModal();
    });
    modal.querySelector("#elyasya-send-dash").addEventListener("click", sendToDashboard);
    modal.querySelector("#elyasya-del-selected").addEventListener("click", deleteSelected);
    modal.querySelector("#elyasya-reset-data").addEventListener("click", () => {
      if (window.confirm("Reset semua data riset yang terakumulasi?")) resetAllData();
    });
    modal.querySelector("#elyasya-check-all").addEventListener("change", (e) => {
      const checked = e.target.checked;
      modal.querySelectorAll(".elyasya-row-check").forEach((cb) => {
        cb.checked = checked;
        if (checked) modalState.selected.add(cb.dataset.key);
        else modalState.selected.delete(cb.dataset.key);
      });
      refreshSelectionInfo();
    });
    modal.querySelector(".elyasya-modal-table tbody").addEventListener("change", (e) => {
      const cb = e.target.closest?.(".elyasya-row-check");
      if (!cb) return;
      if (cb.checked) modalState.selected.add(cb.dataset.key);
      else modalState.selected.delete(cb.dataset.key);
      refreshSelectionInfo();
    });

    document.body.appendChild(modal);
    return modal;
  }

  function readFilters(modal) {
    modalState.sort = modal.querySelector("#elyasya-f-sort").value;
    modalState.minSold30 = Number(modal.querySelector("#elyasya-f-sold").value) || 0;
    modalState.minStock = Number(modal.querySelector("#elyasya-f-stock").value) || 0;
    modalState.minRating = Number(modal.querySelector("#elyasya-f-rating").value) || 0;
    modalState.minReviews = Number(modal.querySelector("#elyasya-f-reviews").value) || 0;
    modalState.mallOnly = modal.querySelector("#elyasya-f-mall").checked;
    modalState.starOnly = modal.querySelector("#elyasya-f-star").checked;
    modalState.nonStarOnly = modal.querySelector("#elyasya-f-nonstar").checked;
    modalState.adsOnly = modal.querySelector("#elyasya-f-ads").checked;
  }

  async function openDetailModal() {
    const modal = ensureModal();
    modal.classList.add("open");
    await R().enrichAllCommissions();
    modalState.page = 1;
    renderModal();
    // Lengkapi kolom yang masih "—" dari API shopee.co.id, lalu render ulang.
    const changed = await R().enrichFromShopee?.();
    if (changed) {
      renderModal();
      updatePanel(R().computeStats(R().getProducts()), R().state.keyword);
    }
  }

  function closeDetailModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) modal.classList.remove("open");
  }

  function onSearchResult(result) {
    if (!result) return;
    updatePanel(result.stats, result.keyword);
    R().enrichAllCommissions().then(() => {
      updatePanel(R().computeStats(R().getProducts()), R().state.keyword);
    });
    // Lengkapi rating/tren/stok dari API shopee.co.id (portal affiliate saja)
    R().enrichFromShopee?.().then((changed) => {
      if (changed) {
        updatePanel(R().computeStats(R().getProducts()), R().state.keyword);
        if (document.getElementById(MODAL_ID)?.classList.contains("open")) renderModal();
      }
    });
  }

  return {
    mountPanel,
    updatePanel,
    hidePanel,
    showLoading,
    onSearchResult,
    openDetailModal,
    closeDetailModal,
    keepPanelAlive,
  };
})();
