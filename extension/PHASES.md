# Elyasya-Studio Extension v5

## Riset Search Shopee (Shoptik-style)

### Cara pakai
1. Download ZIP dari dashboard → reload extension
2. Buka `shopee.co.id` → cari produk (Enter)
3. Panel **riset data per halaman** muncul otomatis
4. **halaman selanjutnya** — akumulasi halaman 1+2+...
5. **detail data** — tabel lengkap + filter + kolom **Komisi**

### v5.0.8
- **Jalur cadangan DOM**: baca produk + "Komisi hingga X%" langsung dari kartu halaman affiliate, tak bergantung intercept jaringan
- Data API (bila tertangkap) otomatis menggantikan hasil DOM sementara (`apiCaptured` + purge)

### v5.0.7
- **FIX komisi affiliate kosong**: baca data produk dari `batch_item_for_item_card_full` & komisi dari `seller_commission_rate`/`default_commission_rate` (bentuk asli `/api/v3/offer/product/list`)
- Log diagnostik `[Elyasya] capture` pakai `console.log` (dulu `console.debug` tersembunyi di level Verbose)

### v5.0.6
- Interceptor menangkap **semua** respons di portal affiliate (endpoint offer beragam)
- Ekstraksi produk **rekursif** — temukan array produk di struktur JSON tak terduga
- Diagnostik konsol `[Elyasya] capture: <url> → N produk` untuk debug
- Panel di-**dock** ke pojok kanan-bawah (tidak lagi floating menutupi produk) + tombol ciutkan
- Popup menampilkan versi extension terpasang (bukan versi server remote)

### v5.0.5
- **Panel riset kini aktif di `affiliate.shopee.co.id`** — data komisi dibaca native dari respons offer list, tak lagi kosong
  - Buka Penawaran Produk / browse offer → panel akumulasi otomatis (komisi terisi)
  - "halaman selanjutnya" di affiliate memicu lazy-load lalu akumulasi via intercept
- Komisi affiliate juga bisa diambil **per-item** (`productOfferV2` itemId+shopId) untuk halaman shopee.co.id biasa
- Popup menampilkan versi extension terpasang (bukan versi server remote)
- Notifikasi produk winning aktif otomatis saat sync (`winning_new`)
- Izin manifest dirapikan (`notifications` ditambah, `tabs` yang mubazir dibuang)
- Patch XMLHttpRequest mempertahankan konstanta status (fix kompatibilitas script Shopee)
- Fix harga fallback DOM untuk produk ≥ Rp 1jt
- Escape `imageUrl` pada tabel detail

### v5.0.0
- Rebuild UI riset search dari awal
- Ringkasan 6 metrik (item, penjualan, pendapatan, omset, 30hr, tren)
- Modal detail dengan filter Mall/Star/Ads
- Export CSV dari detail data
- Komisi via affiliate GraphQL (login affiliate di browser)
