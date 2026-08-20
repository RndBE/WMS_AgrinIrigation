# WMS Agrin Irigasi

Satu repositori, dua aplikasi yang menjawab dua pertanyaan berbeda tentang jaringan
irigasi yang sama (D.I. Leuwigoong, Kab. Garut):

| Folder | Aplikasi | Pertanyaan yang dijawab | Stack |
|---|---|---|---|
| `web-app/` | Beacon SWH — peta satu halaman | Berapa air yang **dibutuhkan** petak & ruas saluran (musiman, hasil hitungan notebook) | Flask + pandas + Leaflet |
| *(akar repo)* | Monitoring WMS — dasbor telemetri & kendali pintu | Berapa air yang **sedang mengalir** sekarang, dan bagaimana pintu diatur | Laravel + MySQL |

Keduanya berdiri sendiri: bisa dijalankan terpisah, tidak saling memanggil, dan tidak
berbagi basis data. Yang dibagi adalah **datanya** — hasil analisa di `note/output*` dan
geometri jaringan di `data/`.

Peta Beacon SWH juga tersedia **di dalam** dasbor Laravel sebagai tab **Peta Lokasi**,
tanpa menjalankan Flask: tampilannya dipindahkan ke Blade, dan datanya dibekukan jadi
berkas statis oleh `python note/ekspor-peta.py`. Alur, alasan, dan cara menyegarkannya
ada di [`tools/peta/README.md`](tools/peta/README.md). Aplikasi Flask-nya tetap utuh dan
tetap bisa dijalankan sendiri.

Aplikasi Laravel duduk langsung di akar repo (`app/`, `config/`, `public/`, `routes/`,
`artisan`, `composer.json`), jadi perintah `php artisan` dijalankan dari sini tanpa
berpindah folder. Beacon SWH tetap terkumpul di `web-app/` karena isinya cuma empat
berkas.

## Susunan folder

| Folder | Isi |
|---|---|
| `note/` | Notebook & skrip analisa: cuaca (Open-Meteo ERA5-Land), ETo FAO-56, NFR, DR, water loss, waktu tempuh air per ruas |
| `note/output*/` | Hasil hitungan notebook: CSV, GeoJSON, KML. Ini sumber angka untuk kedua aplikasi |
| `data/` | Geometri jaringan SISDA Cimanuk-Cisanggarung, batas Daerah Irigasi, sawah BIG 25K |
| `docs/` | Rangkuman peta irigasi terverifikasi + paper rujukan |
| `idea/` | Catatan tujuan proyek & glosarium istilah (ETo, Kc, NFR, DR, WLR, …) |
| `tools/peta/` | Skrip penyalin gaya & skrip tab Peta Lokasi dari `web-app/` ke `public/`, beserta catatan alurnya |
| `public/data/peta/` | Berkas beku untuk tab Peta Lokasi, keluaran `note/ekspor-peta.py` |
| `*.kml`, `*.kmz` | Berkas peta mentah dari SISDA / BIG / Google Earth |

## Menjalankan

**Beacon SWH** (peta analisa)

```bash
pip install -r web-app/requirements.txt
python web-app/app.py          # http://127.0.0.1:5000
```

**Monitoring WMS** (dasbor telemetri)

```bash
composer install
npm install
cp .env.example .env           # isi kredensial MySQL
php artisan key:generate
php artisan migrate --seed
php artisan serve              # http://127.0.0.1:8000
```

Tab **Peta Lokasi** perlu berkas bekunya lebih dulu (sekali saja, atau tiap kali
notebook di `note/` dijalankan ulang):

```bash
python note/ekspor-peta.py       # -> public/data/peta/ (~14 MB)
php artisan peta:panaskan-ubin   # -> public/data/peta-ubin/ (~51 MB, ~2 menit)
```

Tanpa yang pertama tab-nya tetap terbuka, hanya pemilih lokasinya kosong. Tanpa
yang kedua petanya tetap jalan, hanya ubin peta dasarnya diunduh saat pertama
dilihat — dan `php artisan serve` di Windows mengerjakannya satu per satu, jadi
viewport pertama bisa menggantung ~20 detik.

Rincian Beacon SWH ada di `web-app/README.md`; `README-laravel.md` adalah README bawaan Laravel.

## Hubungan antar keduanya

Nama saluran di kedua sisi berasal dari jaringan SISDA yang sama (SS Parigi,
Saluran Cikananga, SS Ciduga, SS Ranca Ucing, SS Leuwigoong), jadi angka analisa
dapat dipasangkan ke simpul dasbor lewat padanan `node_skema_id` ↔ `kode` ruas.

Saat ini dasbor Laravel masih memakai angka dummy dari `SkemaIrigasiDummySeeder`
(kebutuhan air dipatok 1,5 l/dtk/ha untuk semua petak), sedangkan `note/output-jaringan-air/`
sudah menyimpan kebutuhan nyata per ruas per rezim tanam (FL/SRI) beserta geometri
saluran, efisiensi, dan kehilangan air. Menyambungkan keduanya adalah langkah lanjutan
yang direncanakan, bukan sesuatu yang sudah berjalan.
