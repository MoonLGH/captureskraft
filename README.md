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
- Pengaturan MongoDB, FTP, identitas toko, harga, dan URL backend disimpan di komputer booth. URI MongoDB dan password FTP dienkripsi melalui `safeStorage` milik Electron.
- Koneksi database, transfer FTP, printer, pembayaran, dan sinkronisasi dashboard belum diaktifkan pada fondasi ini.
- Gunakan API/backend untuk menghubungkan booth ke website. Jangan menyimpan kredensial database di aplikasi web Vercel.

## Palet global

`Rose Kiss` `#fa699e` · `Baby Pink` `#ff9fc7` · `White` `#ffffff` · `Lavender Blush` `#ffe7f0` · `Cloudy Sky` `#4298ed`
