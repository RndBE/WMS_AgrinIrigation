# Gambar CCTV beranda

Kartu **Pantauan CCTV — Bangunan Bendung** di beranda menampilkan berkas gambar
dari folder ini. Belum ada pengambilan otomatis dari IPCAM: berkasnya ditaruh
manual, lalu diganti kapan saja tanpa menyentuh kode.

## Nama berkas yang dibaca

| Pos | Berkas | Node skema |
|---|---|---|
| Intake | `intake.jpg` | `PG_INTAKE_1` |
| Spillway | `spillway.jpg` | — |
| Scouring Gate | `scouring.jpg` | `PG_SCOURING` |
| Floodway Gate | `floodway.jpg` | `PG_FLOODWAY_1` |

Pos yang berkasnya belum ada tampil sebagai bingkai kosong bertuliskan nama
berkas yang ditunggu — bukan ikon gambar rusak, jadi kartunya tetap rapi selama
gambar dilengkapi satu per satu.

## Catatan

- **Perbandingan sisi** dipangkas ke 16:9 (`object-fit: cover`), jadi gambar
  dengan perbandingan lain tidak gepeng — hanya terpangkas di sisi terpanjang.
  Foto lanskap 1280×720 atau 1920×1080 paling pas.
- **Cache peramban** tidak perlu diurus: alamat gambar diberi query `?v=` berisi
  waktu ubah berkas, jadi mengganti berkas langsung terlihat tanpa hard refresh.
- **Waktu** yang tertulis di bawah gambar adalah waktu ubah berkas, bukan waktu
  pengambilan gambar oleh kamera. Ditampilkan dalam WIB
  (`SkemaIrigasiController::CCTV_TZ`), bukan UTC seperti `config('app.timezone')`
  — supaya angkanya cocok dengan yang terlihat di penjelajah berkas.
- **Ukuran berkas** sebaiknya ditekan. Bingkai di beranda cuma ±300 px lebar,
  jadi foto 2560×1440 (0,5 MB per pos) jauh lebih besar daripada yang dipakai.
  Menskalakannya ke 1280×720 memangkas muatan halaman tanpa perubahan yang
  terlihat. Tidak wajib: gambar dimuat `lazy` dan kartunya bisa dilipat.

## Menambah pos

Tambah satu baris di `SkemaIrigasiController::CCTV_POS`, lalu taruh berkasnya di
sini dengan nama yang sama. Isi `node` dengan id simpul skema agar muncul pranala
"Detail pintu", atau `null` kalau pos itu bukan bangunan berpintu.
