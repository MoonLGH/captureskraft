# Capturs Photobooth

Fondasi aplikasi photobooth desktop berbasis Electron dan React dengan antarmuka kiosk yang bisa dioperasikan lewat layar sentuh.

## Menjalankan aplikasi

```bash
npm install
npm run dev
```

Mode pengembangan membuka jendela Electron. Jalankan `npm run build` untuk membuat bundle React, dan `npm run dist:win` untuk menghasilkan installer Windows.

## Menu admin

Di halaman utama, tekan **Ctrl+Z** lalu masukkan password awal `admin`. Password ini hanya untuk prototipe dan perlu diganti sebelum aplikasi dipakai di lokasi usaha.

## Status integrasi

- Alur booth mendukung pratinjau kamera yang tersedia di perangkat, pengambilan foto, dan mode demo tanpa kamera.
- Pengaturan MongoDB, identitas booth, dan harga disimpan di `Documents/Capturs/config/store-config.json`. Pengaturan lama di direktori data Electron disalin ke lokasi ini saat pertama dibuka setelah pembaruan. URI MongoDB dan Midtrans Server Key dienkripsi melalui `safeStorage` milik Electron.
- Token Telegram untuk log WebAdmin bisa dimasukkan di **Admin → Sinkronisasi cloud**. Token dienkripsi dengan Electron `safeStorage` hanya di perangkat; WebAdmin menerima Chat ID tanpa token.
- Foto sesi disimpan di `Documents/Capturs/storage/<timestamp>/` saat tombol **Simpan & cetak foto** ditekan. Folder sesi berisi `Hasil.png`, `Foto 01.png` dan seterusnya, `Boomerang.gif`, serta `info.json` dengan nama, email, status pembayaran, dan waktu sesi. Di Windows, folder Documents bisa diarahkan ke OneDrive; aplikasi memakai lokasi Documents dari sistem.
- Manifest frame dan thumbnail disimpan di `Documents/Capturs/config/frame-manifest.json`; PNG penuh disimpan sebagai file terpisah di `Documents/Capturs/config/frame-assets/`. Config utama dan sinkronisasi setelan tidak memuat koleksi PNG. Konfigurasi lama dipindahkan ke format ini sekali saat aplikasi dibuka; sesudahnya Web Admin hanya mengunduh frame yang dipilih dan mengunggah gambar yang berubah.
- Alur pelanggan: pilih format → pembayaran (langkah 2) → nama dan email (langkah 3) → pilih frame → ambil foto. **DEV mode** menyediakan Midtrans sandbox/production dan opsi skip; **Booth mode** mewajibkan pembayaran Midtrans; **Event mode** melewati pembayaran karena sesi sudah dibayar penyelenggara.
- Pengaturan Midtrans ada di Admin → **Koneksi data**. Electron membuat Snap token dan memeriksa status transaksi otomatis ke API Midtrans, jadi pembayaran tidak memerlukan URL atau port backend lokal. Transaksi tetap memerlukan internet. Server Key disimpan terenkripsi di komputer booth; batasi akses fisik ke perangkat tersebut.
- Nama dan email pelanggan disimpan di `info.json` bersama setiap sesi foto. Email juga disinkronkan ke web admin untuk laporan transaksi; foto tersimpan lokal di booth dan tidak diunggah ke server web.
- Upload Google Drive memakai Google Drive API melalui Node.js; tidak perlu instal executable atau file config tambahan. Buat OAuth Client ID jenis **Desktop app** di Google Cloud dan aktifkan Google Drive API, lalu masukkan Client ID sekali dan hubungkan akun di Admin → **Koneksi data**. Client Secret tidak perlu dimasukkan. Set consent screen ke Production untuk pemakaian rutin; refresh token dari mode Testing berakhir setelah 7 hari. Refresh token disimpan terenkripsi di perangkat. Setelah upload, aplikasi membuat QR publik untuk folder gambar sesi; `info.json` tidak ikut diupload. Atur retensi folder Drive dari config booth (default 7 hari, rentang 1–3650 hari); Electron mencatat upload baru dan menghapus folder sesi tersebut secara permanen setelah jatuh tempo. Penghapusan dijalankan saat booth online. Upload sebelum fitur retensi diaktifkan tidak dihapus otomatis.
- Gunakan API/backend untuk menghubungkan booth ke website. Jangan menyimpan kredensial database di aplikasi web Vercel.

## Palet global

`Rose Kiss` `#fa699e` · `Baby Pink` `#ff9fc7` · `White` `#ffffff` · `Lavender Blush` `#ffe7f0` · `Cloudy Sky` `#4298ed`

## Web admin dan sinkronisasi cloud

Folder `webadmin/` adalah aplikasi React/Vite terpisah di dalam repo yang sama, dengan API serverless di Vercel dan MongoDB Atlas sebagai penyimpanan konfigurasi toko serta ringkasan sesi. Set root directory Vercel ke `webadmin`; booth desktop dan web admin berkomunikasi melalui endpoint `/api`.

Web admin mencatat waktu aplikasi mulai pada tiap booth, pesanan Midtrans setelah pembayarannya terverifikasi, serta sesi yang selesai. Email pelanggan dan tautan folder Google Drive ikut dikirim setelah sesi selesai; file foto dan `info.json` tetap lokal di booth.

Setelan dikelola per booth dan menggunakan revisi agar perubahan dari web admin tidak tertimpa oleh data lokal yang usang. Web admin dapat mengubah nama, harga, mode operasi, environment dan Client Key Midtrans, tujuan dan retensi Google Drive, pengaturan kamera, serta frame PNG. Perubahan lokal pada admin booth juga dipublikasikan ke konfigurasi booth tersebut dan tersedia untuk dikirim kembali dari web admin. Saat idle atau sesudah sesi berakhir, booth memeriksa revisi cloud kira-kira setiap 8–10 detik dan langsung menarik perubahan yang terdeteksi.

Midtrans Server Key, rahasia OAuth Google, refresh token Drive, direktori foto, dan URI MongoDB tidak dikirim ke web admin. Kunci identitas booth dibuat otomatis di perangkat dan private key disimpan memakai Electron `safeStorage`. Permintaan memakai tanda tangan Ed25519 dengan timestamp dan nonce; booth baru muncul sebagai menunggu persetujuan sebelum boleh mengirim log. Pairing bearer token versi lama dimigrasikan otomatis saat koneksi berikutnya.

### Menjalankan web admin

Jalankan `npm run dev:webadmin` dari root untuk UI dan API lokal di `http://127.0.0.1:4114`; Vercel CLI dan project link tidak diperlukan. Isi environment lokal di `webadmin/.env.local`. API lokal memakai handler yang sama dengan deployment Vercel. Preview UI statis tersedia lewat `npm run build:webadmin` lalu `npm run preview:webadmin` di port `4114`.

### Deploy ke Vercel

1. Buat MongoDB Atlas database, database user khusus, dan atur akses jaringan untuk function Vercel.
2. Import repo ke Vercel, lalu isi **Root Directory** dengan `webadmin`.
3. Tambahkan environment variables `MONGODB_URI`, `MONGODB_DATABASE` (mis. `capturs`), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, dan `SESSION_SECRET`. Gunakan password admin kuat dan secret acak minimal 32 byte; simpan nilainya di Vercel, jangan di frontend atau Git.
4. Deploy. Vercel membangun frontend dan membuat function dari file di `webadmin/api/`. Domain production Vercel menggunakan HTTPS standar; Vercel tidak menyediakan pengaturan agar deployment publik mengikat port `4114`.
5. Login ke web admin, lalu di aplikasi Electron buka **Admin → Sinkronisasi cloud**, isi URL deployment dan tekan **Simpan koneksi**. Aplikasi membuat identitas booth otomatis.
6. Buka **Perangkat booth** di web admin dan setujui booth baru. Tiap booth dapat dipilih dan dikonfigurasi sendiri, termasuk kamera dan frame. Perubahan diterapkan saat booth kembali ke menu utama.

App memeriksa revisi cloud tiap 8–10 detik, termasuk selama sesi, tetapi tidak menerapkan config/frame saat pelanggan sedang memakai booth. WebAdmin menandai awal dan akhir penyimpanan config/frame; app menunggu transaksi WebAdmin selesai, lalu menampilkan **MAINTENANCE MODE** setelah sesi dan halaman cetak 30 detik berakhir. App menyinkronkan config, manifest serta PNG frame yang belum ada, dan semua antrean sesi/pembayaran/run; Electron hanya restart setelah revisi cloud cocok, antrean lokal kosong, dan tidak ada sesi aktif. Jika koneksi putus atau masih ada antrean, maintenance tetap tampil dan sync dicoba lagi. Manifest frame memakai hash SHA-256: aset PNG yang sama tidak dikirim ulang, dan manifest yang tidak berubah tidak membuat revisi baru. WebAdmin memeriksa revisi booth terpilih tiap 5 detik saat halaman pengaturan terbuka. Pendapatan mengikuti pesanan paid yang diverifikasi; data lokal menunggu koneksi kembali. Revisi mencegah salinan lokal usang menimpa config cloud yang lebih baru.

Bot Telegram berjalan langsung di Electron dari kode `tele/bot.cjs`; tidak perlu host worker atau encryption key tambahan. Operator memasukkan token di **Admin → Sinkronisasi cloud**, simpan, lalu kirim `/id` ke bot dari chat tujuan. App menyimpan Chat ID otomatis; tujuan log dapat dilihat dan diubah di **WebAdmin → Telegram**. Token terenkripsi hanya di perangkat. WebAdmin hanya menerima Chat ID dan menyimpan antrean log sesi, pembayaran, aktivitas booth, perubahan pengaturan/perangkat, dan perubahan frame. Electron mengirim antrean saat aplikasi berjalan dan tersambung ke WebAdmin; log tertunda dikirim saat booth online kembali.

File `.env.example` memberi nama variabel untuk pengembangan lokal. Data MongoDB hanya diakses function server, cookie admin bersifat `HttpOnly`, private key identitas booth dienkripsi memakai `safeStorage`, dan catatan transaksi cloud menyimpan email pelanggan serta tautan folder Google Drive.
