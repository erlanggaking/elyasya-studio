# Elyasya Studio — Web App

Shopee Affiliate Live Management (lihat [PRD.md](../PRD.md)).

## Menjalankan

```bash
cd webapp
npm install
npx prisma migrate dev   # sekali saja / saat schema berubah
npm run dev              # http://localhost:3000
```

Buka `http://localhost:3000` — saat pertama kali, form **Buat Akun Admin Pertama** muncul otomatis (setelah itu invite-only, tidak ada halaman register).

## Menghubungkan Chrome Extension

1. Menu **Extension** → Download ZIP → extract → `chrome://extensions` → Load unpacked.
2. Menu **Extension** → Generate Token → salin.
3. Popup extension → isi API URL `http://localhost:3000` + token → Simpan.
4. Riset di shopee.co.id / affiliate.shopee.co.id → hasil otomatis masuk menu **Koleksi**.

## Mode Mock vs Real (Shopee Open Platform)

Selama `SHOPEE_PARTNER_ID`/`SHOPEE_PARTNER_KEY` di `.env` kosong, aplikasi berjalan **mode mock**: OAuth connect, sesi live, keranjang, dan metrik disimulasikan penuh — seluruh alur bisa dipakai/didemokan tanpa approval Shopee.

Setelah Partner App disetujui Shopee (scope LiveStream API — lihat PRD §9.1 & §14):

```env
SHOPEE_PARTNER_ID="..."
SHOPEE_PARTNER_KEY="..."
SHOPEE_API_BASE="https://partner.shopeemobile.com"
SHOPEE_REDIRECT_URL="https://elyasyastudio.com/api/shopee/callback"
```

Tidak ada perubahan kode — client di `src/lib/shopee.ts` otomatis pindah ke mode real (signature HMAC-SHA256 v2 sudah diimplementasikan).

## Database

Dev memakai SQLite (`prisma/dev.db`). Untuk produksi ganti `provider = "postgresql"` di `prisma/schema.prisma` + `DATABASE_URL` Postgres, lalu `npx prisma migrate deploy`.

## Struktur penting

- `src/lib/shopee.ts` — client Shopee v2 (mock + real), semua method livestream
- `src/lib/shopee-account.ts` — auto-refresh token per host (PRD §9.3)
- `src/app/api/extension/*` — kontrak API yang dipakai extension (JANGAN diubah tanpa update extension)
- `src/app/api/live-sessions/*` — proxy create/start/end/addItem/metrics + MetricSnapshot
- `src/proxy.ts` — auth guard semua halaman & API non-publik
