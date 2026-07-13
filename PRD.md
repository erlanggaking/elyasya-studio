# PRD — Elyasya Studio
Shopee Affiliate Live Management Platform

Versi: 1.0 (Draft)
Tanggal: 2026-07-13
Status: Draft untuk review — lihat §14 Asumsi & Risiko Terbuka sebelum development dimulai

---

## 1. Ringkasan

Elyasya Studio adalah platform internal untuk mengelola operasional live streaming affiliate Shopee dari hulu ke hilir: riset produk winning (via Chrome extension yang sudah ada), kurasi ke koleksi, distribusi bulk produk ke studio/host yang akan live, sampai pelaporan performa (GMV, komisi, view, konversi).

Aplikasi terdiri dari 3 komponen:
1. **Chrome Extension** (sudah ada, `extension/`, v6.1.0) — riset produk Shopee + capture data komisi.
2. **Web App** (baru, dibangun dari nol) — dashboard, koleksi, live management, report.
3. **Backend API** (baru) — menjembatani extension ⇄ web app ⇄ Shopee Open API (LiveStream API & Affiliate API).

## 2. Latar Belakang & Masalah

Tim Elyasya Studio menjalankan live streaming affiliate Shopee dengan skala besar: **10 studio, ~300 host**. Saat ini proses riset produk (pakai extension), penentuan produk mana yang dibawakan host mana, dan pemantauan performa live dilakukan manual/terpisah-pisah. Dibutuhkan satu sistem yang menyatukan alur riset → kurasi → distribusi ke live → pelaporan, dengan integrasi langsung ke Shopee Open API supaya produk bisa otomatis masuk ke keranjang live saat host mulai siaran.

## 3. Tujuan & Non-Goals

**Goals (MVP):**
- Satu tempat untuk riset produk (via extension) → simpan ke Koleksi → kirim bulk ke Studio/Host.
- Produk yang dikirim ke host otomatis push ke live cart Shopee saat sesi live aktif (via Shopee LiveStream API).
- Dashboard report GMV, komisi, view, konversi — real-time saat live berlangsung + histori.
- Kelola 10 studio & ~300 host beserta akun Shopee masing-masing host.

**Non-Goals (di luar scope v1):**
- Bukan alat streaming/broadcast itu sendiri (OBS, kamera, dsb tetap dipakai host di luar app; app hanya menyediakan push URL/key dan mengontrol data produk & metrik).
- Bukan sistem payroll/komisi-ke-host (perhitungan bonus/gaji host tidak termasuk).
- Bukan multi-tenant SaaS di v1 (internal Elyasya Studio saja) — namun data model dibuat agar bisa di-multi-tenant-kan nanti (lihat §13).
- Tidak menangani produk dari platform selain Shopee (TikTok Shop, dll) di v1.

## 4. Pengguna & Model Akses

- **Model akses v1: single role, akses penuh.** Tidak ada permission granular per menu di MVP. Semua user yang login adalah admin/ops dengan akses penuh ke semua menu.
- **Host BUKAN user aplikasi.** Host adalah *entitas data* yang dikelola admin (nama, studio assignment, akun Shopee terhubung), bukan akun login terpisah. Host tidak membuka app ini — mereka hanya live streaming di Shopee seperti biasa, dan produk yang dikirim admin otomatis masuk ke live cart mereka.
- Login pakai **email/password milik app** (bukan akun Shopee). Setelah login, admin **menghubungkan (connect) akun Shopee** — baik akun Shopee milik host (untuk API LiveStream & push produk) maupun opsional akun affiliate Shopee (untuk data komisi) — lewat OAuth Shopee Open Platform, per host.
- ⚠️ Karena role flat di v1, pertimbangkan tetap membatasi jumlah akun admin (mis. lewat invite-only) supaya token OAuth 300 akun Shopee host tidak diakses sembarang orang — ini krusial secara keamanan meski tidak ada "role" formal.

## 5. Arsitektur Sistem (High-level)

```
[Chrome Extension]                [Web App: elyasyastudio.com]
  riset produk Shopee                Login, Koleksi, Live Mgmt,
  capture komisi                     Report Dashboard, Setting
        │                                     │
        │  Bearer token (per device)          │  session cookie/JWT
        ▼                                     ▼
              [Backend API — Next.js API routes]
                        │
        ┌───────────────┼────────────────────────┐
        ▼                                          ▼
[Postgres DB]                          [Shopee Open Platform API]
 users, studios, hosts,                 - LiveStream API (v2.livestream.*)
 shopee_accounts, products,               → createSession, addItemList,
 collection_items, live_sessions,          getSessionMetric, dst.
 live_session_items,                    - Affiliate Open API
 metric_snapshots, devices                → commission, conversion report
```

Backend adalah satu-satunya pihak yang menyimpan `access_token`/`refresh_token` Shopee per host dan memanggil Shopee API — baik extension maupun web app tidak pernah bicara langsung ke Shopee API bersignature (kecuali extension yang membaca DOM/network Shopee di browser, itu tetap seperti sekarang).

## 6. Informasi Arsitektur Menu

| Menu | Fungsi utama |
|---|---|
| Login | Email/password + (setelah login) hub koneksi akun Shopee |
| Report Dashboard | GMV, komisi, view, konversi — real-time & historis |
| Koleksi | Daftar flat produk hasil riset, dengan tag/filter |
| Live Management | Card Studio (bikin studio, assign host), kontrol sesi live, bulk-send produk |
| Extension | Download extension + generate token koneksi |
| Setting | Profil, kelola host & akun Shopee, kelola device, preferensi sync |

## 7. Spesifikasi Fitur per Menu

### 7.1 Login

- Form email + password. Lupa password via email reset link.
- Setelah login pertama kali, diarahkan ke onboarding ringan: buat studio pertama (opsional, bisa skip).
- Tidak ada Shopee OAuth di layar login — koneksi akun Shopee dilakukan per-host di menu **Setting → Host** atau **Live Management → Studio**, bukan saat login (karena 1 akun app bisa mengelola ratusan akun Shopee host).

### 7.2 Report Dashboard

**Sumber data (lihat §9 untuk detail API):**
- Metrik sesi live real-time & final → Shopee **LiveStream API** (`getSessionMetric`, `getSessionItemMetric`).
- Komisi affiliate final/approved → Shopee **Affiliate Open API** (conversion/commission report). ⚠️ Nilai komisi dari Affiliate API biasanya baru "approved" beberapa hari setelah order (lazimnya program affiliate Shopee) — dashboard harus membedakan **GMV/komisi estimasi** (dari live session, real-time) vs **komisi final approved** (dari affiliate report, delay).

**Level agregasi:**
- Per sesi live (per host per tanggal/jam)
- Per host (akumulasi semua sesi)
- Per studio (akumulasi semua host di studio itu)
- Per produk (dari `getSessionItemMetric`, lintas sesi)
- Per periode (harian/mingguan/bulanan) — untuk filter tanggal

**Metrik yang ditampilkan:**
GMV, jumlah order, komisi (estimasi & final), views, peak viewer (CCU), average viewing duration, likes, comments, shares, click-to-cart (ATC), CTR, conversion rate (CO) — semua field ini sudah tersedia native di `getSessionMetric` Shopee, tidak perlu dihitung manual.

**Mode tampilan:**
- **Live monitoring**: saat ada sesi live aktif, tampilkan kartu "Live Sekarang" per studio dengan metrik yang auto-refresh (polling ~30–60 detik, lihat §11).
- **Histori**: tabel + chart tren, bisa filter per studio/host/produk/rentang tanggal, export CSV.

### 7.3 Koleksi

- Satu daftar flat berisi semua produk yang tersimpan dari hasil riset extension (via `/api/extension/sync`) ditambah produk yang ditambahkan manual.
- Setiap item koleksi: nama produk, gambar, item_id + shop_id (kunci untuk push ke live cart), harga, rate komisi, tag bebas (mis. "winning", "skincare", "live-malam-ini"), sumber (dari riset/manual), tanggal ditambahkan, status (baru/sudah dikirim ke studio mana saja).
- Filter & search: by tag, by rentang komisi, by rentang harga, by status terkirim/belum, by tanggal riset.
- **Bulk action**: pilih banyak produk (checkbox) → tombol "Kirim ke Live Management" → pilih target studio dan/atau host tertentu (multi-select) → konfirmasi.
  - Item koleksi tidak "pindah" saat dikirim — tetap ada di Koleksi, hanya membuat *assignment* baru ke studio/host (many-to-many: satu produk bisa dikirim ke banyak host sekaligus).

### 7.4 Live Management

**Card Studio:**
- Grid/list card, satu card = satu studio: nama, lokasi (opsional), jumlah host ter-assign, status (ada sesi live aktif / tidak), jumlah produk ter-assign belum terpakai.
- Tombol "+ Studio Baru" → form: nama studio, lokasi/deskripsi (opsional).
- Klik card studio → halaman detail studio:
  - **Tab Host**: daftar host yang ter-assign ke studio ini, tombol "+ Tambah Host" (assign host existing dari database 300 host, atau buat host baru di tempat). Assignment host↔studio **tanpa jadwal/kalender** — cukup daftar host aktif di studio itu (sesuai keputusan: assignment bebas).
  - **Tab Produk**: daftar produk yang sudah di-assign ke studio ini (dari bulk action Koleksi) yang belum "dipakai" host manapun, siap ditarik ke sesi live siapapun host di studio ini.
  - **Tab Sesi Live**: histori sesi live yang pernah berjalan di studio ini (lintas host).

**Detail Host** (halaman/panel, bisa diakses dari Studio atau dari Setting → Host):
- Info host: nama, kontak (opsional), akun Shopee terhubung (bisa lebih dari satu shop per host), status koneksi (terhubung/token expired/belum connect).
- Tombol **"Connect Akun Shopee"** → generate link OAuth authorize Shopee, host (atau admin atas nama host) membuka link tsb, login & authorize di Shopee, redirect balik → backend exchange code jadi `access_token`/`refresh_token`, simpan terkait host tsb. Lihat §9.3.
- **Kontrol Sesi Live**:
  - Tombol "Buat & Mulai Sesi" → panggil `createSession` + `startSession` Shopee API pakai token host → tampilkan `push_url` & `push_key` (RTMP) agar host bisa mulai streaming pakai OBS/app Shopee, plus `share_url`.
  - Selama sesi aktif: tampilkan keranjang live saat ini (`getItemList`), tombol "Tambah dari Produk Ter-assign" (bulk push pakai `addItemList`), drag-reorder (`updateItemList`), hapus item (`deleteItemList`), tandai item sedang ditampilkan (`updateShowItem`).
  - Metrik real-time sesi ini ditarik dari `getSessionMetric` (polling, lihat §11), ditampilkan sebagai mini-dashboard di panel host.
  - Tombol "Akhiri Sesi" → `endSession`.

**Bulk send dari Koleksi ke sini** membuat baris di tabel *assignment* (studio_id atau host_id + item_id/shop_id), yang baru benar-benar dieksekusi (`addItemList`) ke Shopee saat:
  (a) host mengklik "Tambah dari Produk Ter-assign" saat sesi live aktif, atau
  (b) opsi auto-push: begitu sesi live berstatus aktif, semua produk ter-assign yang belum ter-push otomatis di-push (perlu dikonfirmasi preferensi UX — default: manual approve dulu supaya host bisa kontrol urutan).

### 7.5 Extension

- Halaman ini **hanya**: tombol download extension (ZIP/link ke Chrome Web Store atau load-unpacked), dan tombol **"Generate Token"** yang membuat personal access token untuk ditempel di popup extension (field `apiUrl` + `token` yang sudah ada di `popup.js`/`background.js`).
- Menampilkan status: device yang sudah connect (dari `deviceRegistered`, `deviceId`, `deviceCount`/`maxDevices` yang sudah ada di kode extension), last sync time, last capture time — semua data ini sudah dikirim extension lewat `/api/extension/status`, tinggal ditampilkan.
- Tombol "Revoke Token" untuk device tertentu (invalidasi token, device itu berhenti sync).

### 7.6 Setting

- Profil akun (nama, email, ganti password).
- **Kelola Host**: CRUD 300 host (nama, catatan), lihat status koneksi Shopee per host, reconnect/disconnect akun Shopee.
- **Kelola Device**: daftar device extension terhubung (mirror dari menu Extension, untuk kontrol terpusat), termasuk `max_devices` per akun (default disarankan: tidak terlalu ketat karena satu admin bisa buka banyak browser/PC — misal default 5, configurable).
- Preferensi sync: interval auto-sync extension (default 1 menit sesuai `chrome.alarms` yang sudah ada), interval polling live metrics (default 30–60 detik saat live aktif).
- Kredensial Shopee Open Platform App (Partner ID/Key) — level aplikasi, bukan per host, disimpan di server env/secret manager, bukan di UI biasa (lihat §12 keamanan).

## 8. Model Data (Entities)

Ringkas — field detail disesuaikan saat implementasi:

- **User** — id, email, password_hash, name, created_at. (v1: semua User = admin, tidak ada kolom role, tapi tabel dibuat siap ditambah role nanti.)
- **Device** — id, user_id, device_id (UUID dari extension), label, token, max_devices scope, last_sync_at, last_capture_at, registered_at.
- **Studio** — id, name, location, created_at.
- **Host** — id, studio_id (nullable — host bisa belum ter-assign), name, note, created_at.
- **ShopeeAccount** — id, host_id, shop_id, shop_name, access_token, refresh_token, token_expires_at, scope (livestream/affiliate), connected_at, status (active/expired/revoked).
- **Product** — id, item_id, shop_id, name, image_url, price, commission_rate, source (extension/manual), first_seen_at, raw_payload (json, dari capture extension).
- **CollectionEntry** — id, product_id, tags (array), added_at, added_by.
- **Assignment** — id, collection_entry_id (→ product), target_type (studio/host), target_id, assigned_at, status (pending/pushed/removed).
- **LiveSession** — id, shopee_session_id, host_id, studio_id, status (not_started/live/ended), title, push_url, push_key, share_url, started_at, ended_at.
- **LiveSessionItem** — id, live_session_id, product_id, item_no, pushed_at, source_assignment_id.
- **MetricSnapshot** — id, live_session_id, captured_at, gmv, orders, ccu, peak_ccu, views, atc, ctr, co, likes, comments, shares, avg_viewing_duration. (time-series, satu baris per polling tick → dipakai untuk chart tren selama live)
- **CommissionReport** — id, shopee_account_id, order_id, product_id, commission_amount, status (pending/approved/rejected), period, synced_at. (dari Affiliate Open API, terpisah dari live session karena delay approval)

## 9. Integrasi Shopee API

### 9.1 LiveStream API (Shopee Open Platform, `v2.livestream.*`)

Dikonfirmasi tersedia untuk region ID. Endpoint yang dipakai:

| Method Shopee | Dipakai di fitur |
|---|---|
| `createSession` | Live Management → "Buat & Mulai Sesi" |
| `startSession` | Live Management → mulai sesi (dapat push_url/push_key) |
| `updateSession` | Edit judul/cover sesi |
| `endSession` | Live Management → "Akhiri Sesi" |
| `getSessionDetail` | Ambil push_url/push_key/share_url/status |
| `getSessionMetric` | Report Dashboard real-time & final (GMV, order, CCU, views, dst) |
| `getSessionItemMetric` | Report per-produk dalam sesi |
| `addItemList` | Koleksi → bulk send → push ke live cart |
| `updateItemList` | Reorder produk di live cart |
| `deleteItemList` | Hapus produk dari live cart |
| `getItemList` | Tampilkan keranjang live saat ini |
| `updateShowItem` / `getShowItem` | Highlight produk yang sedang dibahas |
| `getLikeItemList`, `getLatestCommentList` | (opsional v2) — insight engagement tambahan |

⚠️ **Risiko/prasyarat kritis**: LiveStream API adalah scope khusus di Shopee Open Platform yang **butuh approval terpisah dari Shopee** (tidak otomatis aktif untuk semua Partner App). Sebelum development dimulai, pastikan Partner ID Elyasya Studio sudah/bisa disetujui Shopee untuk scope ini — ini blocker terbesar di luar kendali development, sebaiknya diajukan ke Shopee paling awal secara paralel dengan development dimulai.

### 9.2 Affiliate Open API

Dipakai untuk data komisi final/approved (beda dari GMV live session yang real-time tapi estimasi). ⚠️ Detail endpoint persis (conversion report, commission report) belum divalidasi di percakapan ini — direkomendasikan tim engineering mengecek dokumentasi resmi `open.shopee.com` bagian Affiliate API saat mulai implementasi §9.2, karena API ini terpisah dari LiveStream API dan mungkin punya App/Partner ID berbeda (extension sudah punya placeholder `SHOPEE_AFFILIATE_APP_ID/SECRET`, kemungkinan ini API yang sama).

### 9.3 OAuth & Token Management per Host

Karena tiap host live pakai akun Shopee sendiri (keputusan §di atas), setiap `ShopeeAccount` butuh authorize terpisah:

1. Admin klik "Connect Akun Shopee" di halaman Host → backend generate authorize URL Shopee (Partner ID + redirect URI + state berisi host_id).
2. Link dibuka di browser yang sedang login sebagai akun Shopee host tsb (host sendiri, atau admin yang pegang akses akun host) → Shopee minta konfirmasi otorisasi.
3. Shopee redirect balik ke backend dengan `code` + `shop_id` → backend tukar jadi `access_token`/`refresh_token`, simpan di `ShopeeAccount` terkait host.
4. Token Shopee Open Platform biasanya expire dalam beberapa jam (`access_token`) dengan `refresh_token` lebih panjang (~30 hari) — perlu **cron job refresh token** berjalan otomatis sebelum expired, per semua ShopeeAccount aktif (skala 300 akun → perlu batching agar tidak kena rate limit).
5. Setting → Kelola Host harus menampilkan status token (`active` / `expiring soon` / `expired — perlu reconnect`) supaya admin bisa proaktif reconnect sebelum host live dan gagal karena token mati.

## 10. API Internal (Backend)

Kontrak berikut **sudah ditentukan** oleh extension yang sudah dibangun (`extension/src/background.js`) — backend v1 wajib mengimplementasikan endpoint ini persis sesuai ekspektasi extension:

| Endpoint | Method | Fungsi |
|---|---|---|
| `/api/extension/device/register` | POST | Registrasi device baru, cek `max_devices` |
| `/api/extension/sync` | POST | Terima batch `captures` hasil riset produk (max 20/batch dari extension) |
| `/api/extension/live/sync` | POST | Terima `sessions` data live yang di-capture extension dari `content-live.js` |
| `/api/extension/status` | GET | Ping status + `stats.registered_devices` |
| `/api/extension/commission` | POST | Lookup rate komisi untuk item_id yang belum ada di cache extension |
| `/api/research/trending` | GET | Keyword trending untuk panel riset |

Endpoint baru yang dibutuhkan web app (di luar kontrak extension), disusun mengikuti pola sama (Bearer/session auth, JSON):

- `POST/GET /api/collection` — CRUD koleksi, filter by tag
- `POST /api/collection/bulk-assign` — kirim produk terpilih ke studio/host
- `POST/GET /api/studios`, `/api/hosts` — CRUD studio & host
- `POST /api/hosts/:id/shopee/connect` — mulai OAuth flow
- `GET /api/hosts/:id/shopee/callback` — terima redirect Shopee
- `POST /api/live-sessions` — proxy `createSession`+`startSession` ke Shopee
- `POST /api/live-sessions/:id/items` — proxy `addItemList`
- `POST /api/live-sessions/:id/end` — proxy `endSession`
- `GET /api/live-sessions/:id/metrics` — proxy `getSessionMetric` (dipanggil polling dari frontend)
- `GET /api/report` — agregasi dari `MetricSnapshot` + `CommissionReport` sesuai filter

## 11. Real-time & Sync Strategy

- **Extension → backend**: sudah ada, event-driven + alarm 1 menit + debounce 2.5 detik setelah capture baru (`scheduleAutoSync`). Tidak perlu diubah.
- **Live metrics saat sesi aktif**: **polling**, bukan webhook (Shopee LiveStream API tidak terkonfirmasi punya webhook/push untuk metrik). Frontend polling `getSessionMetric` tiap 30–60 detik selama sesi berstatus live, backend simpan tiap tick ke `MetricSnapshot` untuk histori/chart. Hentikan polling otomatis saat `endSession`.
- **Rate limit**: dengan potensi banyak sesi live bersamaan (sampai 300 host), polling per-sesi harus di-throttle/batch di backend (job queue), jangan polling langsung dari browser tiap client — supaya tidak melanggar rate limit Shopee Partner API dan supaya token refresh terpusat.
- **Komisi final (Affiliate API)**: sync berkala (cron harian), bukan real-time — sesuai sifat data yang delayed-approval.

## 12. Non-Functional Requirements

- **Skala**: 10 studio, ~300 host, tiap host punya ≥1 ShopeeAccount dengan token yang perlu di-refresh berkala. Desain list/tabel Host & Studio harus mendukung search + pagination sejak awal (jangan render 300 baris sekaligus).
- **Keamanan**: `access_token`/`refresh_token` 300 akun Shopee adalah data paling sensitif di sistem ini — enkripsi at-rest, jangan pernah dikirim ke frontend, audit log siapa connect/disconnect akun mana.
- **Reliabilitas token**: job refresh token otomatis + alerting kalau ada ShopeeAccount gagal refresh (supaya tidak ketahuan pas host sudah mau live).
- **Observability**: log semua pemanggilan Shopee API (khususnya `addItemList`/`endSession`) karena ini aksi yang berefek langsung ke live yang sedang berjalan — perlu jejak audit kalau ada komplain "produk kok nggak masuk".

## 13. Tech Stack Rekomendasi

Konsisten dengan yang sudah tersirat di extension (`elyasyastudio.com`, `localhost:3000`):

- **Frontend + Backend**: Next.js (App Router) — API routes sekaligus web app, satu deployment.
- **Database**: PostgreSQL + Prisma ORM (relasi banyak: studio–host–shopee_account–live_session cocok relasional).
- **Auth**: NextAuth (credentials provider) untuk login email/password; custom OAuth flow manual untuk Shopee (NextAuth provider custom atau handle sendiri karena per-host bukan per-login-user).
- **Job/queue**: untuk polling metrics & refresh token — mulai dari cron sederhana (Vercel Cron / node-cron), upgrade ke queue (BullMQ + Redis) kalau jumlah sesi live bersamaan mulai signifikan.
- **Hosting**: Vercel (cocok untuk Next.js) atau VPS kalau butuh long-running worker untuk polling (Vercel serverless kurang cocok untuk polling terus-menerus >60 detik — pertimbangkan worker terpisah/VPS kecil khusus job polling & token refresh).
- Data model dipisahkan per konsep (`Studio`, `Host` bukan `User`) sejak awal — memudahkan kalau nanti mau multi-tenant, tinggal tambah kolom `organization_id`.

## 14. Asumsi & Risiko Terbuka

Ditandai eksplisit karena belum divalidasi saat PRD ini ditulis:

1. **Approval Shopee untuk scope LiveStream API** belum dipastikan didapat — ini prasyarat keras, ajukan ke Shopee Partner Support sesegera mungkin, paralel dengan development.
2. **Endpoint pasti Affiliate Open API** untuk commission/conversion report belum divalidasi — perlu dicek dokumentasi resmi saat implementasi §9.2.
3. **Auto-push vs manual-approve** saat sesi live aktif (§7.4) — didesain default manual-approve, perlu dikonfirmasi preferensi operasional tim.
4. **Siapa yang klik "Connect Akun Shopee"** — asumsi admin melakukannya atas nama host (butuh akses login Shopee host itu sendiri secara langsung/dibantu), bukan host login sendiri ke app ini. Kalau ternyata host perlu self-service connect, perlu portal login terpisah untuk host (di luar scope v1 saat ini).
5. Rate limit exact Shopee Open Platform (request/detik per Partner) belum diketahui — penting untuk desain job polling skala 300 host, cek saat approval Partner App.

## 15. Roadmap / Fase Pengembangan

**Fase 1 — Fondasi**: Login, Setting dasar, Koleksi (baca data extension yang sudah sync), CRUD Studio & Host tanpa integrasi Shopee.

**Fase 2 — Koneksi Shopee**: OAuth flow per host, `createSession`/`startSession`/`endSession`, tampilkan push_url/push_key.

**Fase 3 — Bulk send & live cart**: Bulk action Koleksi → Assignment, `addItemList`/`updateItemList`/`deleteItemList` di panel host.

**Fase 4 — Report real-time**: Polling `getSessionMetric`, MetricSnapshot, live monitoring dashboard.

**Fase 5 — Report historis & komisi**: Integrasi Affiliate Open API, agregasi historis, export.

## 16. Metrik Keberhasilan

- Waktu dari "riset produk di extension" sampai "produk masuk live cart host" — target signifikan lebih cepat dari proses manual sekarang.
- % host yang berhasil terhubung & tokennya tetap valid tanpa perlu reconnect manual berulang.
- Adopsi bulk-send (jumlah produk terkirim via bulk action vs manual per-host).
- Akurasi report dashboard dibanding data asli Shopee Seller/Affiliate Center (untuk validasi data tidak melenceng).
