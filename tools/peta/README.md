# Tab "Peta Lokasi" — cara datanya dan tampilannya masuk ke Laravel

Tab Peta Lokasi berasal dari aplikasi Flask `web-app/` ("Beacon SWH"). Yang
dipindahkan ke Laravel adalah **tampilannya**; mesin analisanya tetap Python dan
tetap tinggal di tempatnya.

Pembagiannya begini:

| Bagian | Dulu (Flask) | Sekarang (Laravel) |
|---|---|---|
| GeoJSON + ringkasan + metrik per lokasi | `GET /api/lokasi/<id>?rezim=` dihitung `data.py` tiap permintaan | berkas beku `public/data/peta/lokasi-<id>-<rezim>.json` |
| Ekspor KML | `GET /api/lokasi/<id>.kml` | berkas beku `public/data/peta/lokasi-<id>-<rezim>.kml` |
| Lapisan BIG & Daerah Irigasi | `GET /api/big/<id>`, `/api/di/<id>`, ambil dari ArcGIS | berkas beku `public/data/peta/big-<id>.json`, `di-<id>.json` |
| Ubin peta dasar | `GET /api/tile/...`, penerus + cache (threaded) | berkas statis di `public/data/peta-ubin/`, PHP hanya saat cache miss |
| Halaman | `templates/index.html` (Jinja) | `resources/views/skema/partials/peta.blade.php` |
| Gaya | `static/css/app.css` | `public/css/peta.css` (dihasilkan) |
| Skrip | `static/js/app.js` | `public/js/peta.js` (dihasilkan) |
| Leaflet | `static/vendor/` | `public/vendor/leaflet/` (disalin apa adanya) |

## Kenapa dibekukan, bukan diport ke PHP

`web-app/data.py` panjangnya ~1950 baris: penggabungan pandas, penyederhanaan
Douglas-Peucker, pemotongan cincin poligon, hitungan luas planar. Menulis ulang
itu di PHP berminggu-minggu, dan hasilnya berisiko berbeda angka dari notebook.

Tidak perlu, karena **seluruh masukannya sudah statis** — CSV, JSON, dan KML
keluaran notebook di `note/`, yang hanya berubah kalau notebooknya dijalankan
ulang. Sementara lapisan BIG dan Daerah Irigasi diambil dari layanan ArcGIS di
luar dan terukur 1–10 detik per permintaan. Menghitung ulang keduanya di setiap
muat halaman adalah kerja yang terbuang.

Jadi Python tetap dipakai, tetapi sebagai **alat build**, bukan dependensi
runtime. Server produksi cukup PHP.

Satu-satunya yang tidak bisa dibekukan sepenuhnya adalah ubin peta: jumlahnya
bergantung zoom dan geseran, dan isinya milik penyedia peta, bukan hasil analisa.
Bagian itu diport ke PHP — dan memang pendek, karena isinya cuma unduh sekali
lalu simpan.

## Kenapa simpanan ubin duduk di dalam `public/`

Ini bagian yang paling menentukan kecepatan peta, dan alamat rutenya sengaja
dibuat **sama dengan jalan berkasnya**:

```
GET  /data/peta-ubin/satelit/13/6550/4255.jpg
->   public/data/peta-ubin/satelit/13/6550/4255.jpg
```

Begitu satu ubin tersimpan, web server melayaninya sebagai berkas statis dan PHP
tidak dijalankan lagi untuk ubin itu — `RewriteCond %{REQUEST_FILENAME} !-f` di
`public/.htaccess`, `try_files $uri` pada nginx, dan server bawaan PHP semuanya
mendahulukan berkas yang ada sebelum memanggil `index.php`. Rute `peta.ubin` di
`routes/web.php` karena itu hanya melayani cache miss: sekali per ubin, selamanya.

Terukur di mesin ini, satu viewport 36 ubin diminta berbarengan:

| Cara | Waktu |
|---|---|
| lewat PHP, simpanan di `storage/app` (rancangan pertama) | ~6,8 s |
| dingin, harus diunduh dari penyedia | ~20,8 s |
| **berkas statis, simpanan di `public/`** | **0,11 s** |

Dua hal yang menyusun selisih itu:

1. **Boot Laravel penuh per ubin.** Autoload, config, seluruh service provider,
   router — hanya untuk mengirim berkas 746 bita. Terukur 0,19 s lewat PHP lawan
   0,002 s sebagai berkas statis.
2. **`php artisan serve` di Windows melayani satu permintaan pada satu waktu.**
   `PHP_CLI_SERVER_WORKERS` memakai `fork()`, dan balasannya *"forking is not
   supported on this platform"*. Jadi seluruh ubin satu viewport diantrekan satu
   per satu. Aplikasi Flask asalnya tidak kena ini karena `app.run(threaded=True)`.

Konsekuensi yang perlu disadari: ubin di `public/` **bisa diakses siapa pun yang
bisa membuka aplikasi**, tanpa lewat auth Laravel. Untuk peta dasar Esri/BIG itu
tidak masalah — isinya publik. Lapisan yang tidak boleh publik harus tetap lewat
PHP.

## Memanaskan simpanan ubin

```bash
php artisan peta:panaskan-ubin
```

Mengunduh seluruh ubin wilayah kerja lebih dulu, supaya tidak ada cache miss sama
sekali saat dipakai — dan petanya juga jalan penuh tanpa jaringan.

Batas wilayahnya **tidak dipatok di kode**: dibaca dari medan `kotak` seluruh
`public/data/peta/lokasi-*.json`, jadi ia otomatis mengikuti lokasi yang benar-benar
tampil di pemilih. Sekarang gabungannya ~36 x 44 km.

Unduhannya paralel (`Http::pool`, 12 sekaligus). Bawaan zoom 12–15 = 1.602 ubin
per tema, 3.204 seluruhnya, **51 MB, ~2 menit**. Serial akan makan ~27 menit.

Pilihan yang tersedia:

| Pilihan | Guna |
|---|---|
| `--kering` | hitung jumlahnya saja, jangan mengunduh |
| `--zmax=16` | naikkan zoom tertinggi (lihat tabel di bawah dulu) |
| `--tema=satelit` | satu tema saja |
| `--kotak="B,S,T,U"` | batas sendiri, derajat |
| `--serentak=20` | ubah jumlah unduhan berbarengan |
| `--ulang` | unduh ulang walau sudah tersimpan |

Zoom bawaan berhenti di 15 karena tiap kenaikan satu zoom mengalikan jumlah ubin
dengan empat:

| Zoom | Ubin (kumulatif, per tema) | Ukuran |
|---|---|---|
| 12–14 | 424 | 5 MB |
| **12–15 (bawaan)** | **1.602** | **19 MB** |
| 12–16 | 6.177 | 72 MB |
| 12–17 | 24.085 | 282 MB |
| 12–19 | 380.097 | 4,4 GB |

Zoom 16 ke atas hanya terpakai kalau seseorang memperbesar sampai satu petak, jadi
lebih murah membiarkannya diunduh saat itu terjadi — sekali, lalu ikut tersimpan.

Simpanannya tidak ikut repo (lihat `.gitignore`), jadi jalankan perintah ini
setelah clone atau setelah deploy. Kalau `public/` read-only di produksi, jalankan
perintahnya saat deploy: ubin tetap terkirim tanpa simpanan, tetapi setiap
permintaan akan mengulang unduhannya, dan itu dicatat sekali ke log.

## Menyegarkan data

Jalankan dari akar repo:

```bash
python note/ekspor-peta.py
```

Perlu `pandas` dan sambungan internet (untuk BIG & Daerah Irigasi). Tambahkan
`--tanpa-luar` untuk melewati keduanya, atau `--segar` untuk memaksa mengambil
ulang alih-alih memakai cache.

Jalankan ulang bila:

- notebook di `note/` dijalankan ulang sehingga CSV/KML keluarannya berubah,
- konfigurasi `LOKASI` atau `METRIK` di `web-app/data.py` disunting,
- lapisan BIG / Daerah Irigasi perlu disegarkan.

## Menyegarkan tampilan

`public/css/peta.css` dan `public/js/peta.js` **dihasilkan** — jangan disunting
langsung. Sunting sumbernya di `web-app/static/`, lalu:

```bash
node tools/peta/salin-css.cjs
node tools/peta/salin-js.cjs
```

Sumbernya tetap berkas Flask supaya tidak ada dua salinan yang harus disunting
bergantian, dan aplikasi Flask-nya tetap bisa dijalankan sendiri seperti biasa.

Yang diubah skrip penyalin, dan alasannya:

**`salin-css.cjs`** — empat selector global (`:root`, `*`, `[hidden]`,
`html/body`) dilingkupi ke `#view-peta`, plus satu penetral aturan `button {}`
telanjang milik `wms.css`. 106 nama kelas sisanya sudah bergaya BEM dan sudah
diperiksa tidak ada yang sama dengan nama kelas maupun variabel `:root` di
`wms.css`. `html/body { height: 100% }` diganti tinggi pasti karena Leaflet perlu
kontainer yang tingginya terhitung.

**`salin-js.cjs`** — tiga hal:

1. Alamat data tidak lagi ditulis mutlak, semuanya lewat `window.PETA` yang
   disuntik Blade dari `SkemaIrigasiController::petaRoutes()`. Pola yang sama
   dengan `window.WMS_VIEW` untuk bilah nav.
2. Endpoint Flask diganti berkas beku.
3. Peta tidak lagi dibangun di `DOMContentLoaded`, tetapi lewat
   `window.petaMulai()` yang idempoten.

## Kenapa petanya menunggu dipanggil

`resources/views/skema/index.blade.php` meng-`@include` **semua** partial tab
sekaligus lalu menyembunyikannya dengan `display:none`; penukaran tab tidak
memuat ulang halaman. Kalau `L.map()` dijalankan saat itu, kontainernya masih
0 × 0 piksel dan `fitBounds` memilih zoom yang salah.

Jadi `activateView()` di `public/js/simhidro.js` memanggil `window.petaMulai()`
saat tab Peta Lokasi pertama kali tampil — persis pola yang sudah dipakai
`resizeCharts()` untuk Chart.js di tab Tren Data. Perubahan ukuran setelahnya
diurus `ResizeObserver` di dalam `peta.js` sendiri.

## Rezim di nama berkas

Nama berkas beku memuat rezimnya (`lokasi-di-garut-FL.json`), sementara muatan
pertama terjadi sebelum `peta.js` tahu rezim apa saja yang tersedia — daftar itu
justru datang dari muatan pertama tersebut. Pada Flask hal ini tidak masalah
karena `muat()` di server memakai `rezim or "FL"` sebagai bawaan.

Karena itu `note/ekspor-peta.py` menuliskan `rezim_tersedia` ke `lokasi.json`,
Blade memasangnya sebagai `data-rezim` di tiap `<option>`, dan `peta.js`
membacanya lewat `rezimBawaan()` saat rezim belum dipilih.

## Sertifikat SSL untuk penerus ubin

PHP di Windows sering terpasang tanpa CA bundle (`curl.cainfo` kosong di
`php.ini`), dan tanpa itu **setiap** permintaan HTTPS dari Laravel gagal dengan
`cURL error 60: unable to get local issuer certificate` — bukan hanya ubin peta.
Perbaikan yang benar ada di `php.ini`:

```ini
curl.cainfo = "C:\path\ke\cacert.pem"
openssl.cafile = "C:\path\ke\cacert.pem"
```

Untuk mesin yang `php.ini`-nya tidak bisa disunting (perlu hak administrator),
sediakan bundle-nya di proyek lalu tunjuk lewat `.env`:

```bash
curl -o storage/app/cacert.pem https://curl.se/ca/cacert.pem
```

```dotenv
PETA_TILE_CAINFO=storage/app/cacert.pem
```

Jalan relatif diselesaikan terhadap akar proyek, bukan terhadap direktori kerja
proses PHP. Berkasnya tidak ikut repo: ia per-mesin dan kedaluwarsa.

Tanpa CA bundle petanya **tetap terbuka** — penerus ubin membalas 204, peta dasar
kosong, dan seluruh poligon di atasnya tetap tergambar. Alasannya dicatat sekali
ke log Laravel supaya tidak terbaca seperti "memang belum ada ubinnya".
