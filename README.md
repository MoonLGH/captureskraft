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
- Foto sesi disimpan di `Documents/Capturs/storage/<timestamp>/` saat tombol **Simpan & cetak foto** ditekan. Folder sesi berisi `Hasil.png`, `Foto 01.png` dan seterusnya, `Boomerang.gif`, serta `info.json` dengan nama, email, status pembayaran, dan waktu sesi. Di Windows, folder Documents bisa diarahkan ke OneDrive; aplikasi memakai lokasi Documents dari sistem.
- Alur pelanggan: pilih format → pembayaran (langkah 2) → nama dan email (langkah 3) → pilih frame → ambil foto. **DEV mode** menyediakan Midtrans sandbox/production dan opsi skip; **Booth mode** mewajibkan pembayaran Midtrans; **Event mode** melewati pembayaran karena sesi sudah dibayar penyelenggara.
- Pengaturan Midtrans ada di Admin → **Koneksi data**. Electron membuat Snap token dan memeriksa status transaksi otomatis ke API Midtrans, jadi pembayaran tidak memerlukan URL atau port backend lokal. Transaksi tetap memerlukan internet. Server Key disimpan terenkripsi di komputer booth; batasi akses fisik ke perangkat tersebut.
- Nama dan email pelanggan disimpan di `info.json` bersama setiap sesi foto. Foto tersimpan lokal di booth; aplikasi tidak mengirim hasil foto lewat email.
- Backup Google Drive opsional menggunakan rclone. Instal rclone, siapkan remote Google Drive dengan `rclone config`, lalu isi executable, nama remote, folder, dan bila perlu lokasi file config pada Admin → **Koneksi data**. Nyalakan backup otomatis dan gunakan **Tes koneksi rclone** sebelum sesi produksi.
- Gunakan API/backend untuk menghubungkan booth ke website. Jangan menyimpan kredensial database di aplikasi web Vercel.

## Palet global

`Rose Kiss` `#fa699e` · `Baby Pink` `#ff9fc7` · `White` `#ffffff` · `Lavender Blush` `#ffe7f0` · `Cloudy Sky` `#4298ed`
