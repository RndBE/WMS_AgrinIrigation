# Rangkuman Data dan Sumber Peta Irigasi Leuwigoong, Kabupaten Garut

> **STATUS: VERIFIED / DOUBLE-CHECKED — 13 Agustus 2026**
>
> Dokumen ini merupakan hasil pemeriksaan ulang terhadap versi sebelumnya. Sumber utama dicek kembali ke BIG, Ditjen SDA, BBWS Cimanuk Cisanggarung, Ina-Geoportal, dan dokumen teknis pendukung.
>
> **Koreksi utama hasil audit:**
>
> 1. Luas D.I. Leuwigoong **5.313 ha** dan cakupan **11 kecamatan** terverifikasi dari sumber resmi Ditjen SDA/BBWS.
> 2. Progres **74,4%** hanya valid sebagai kondisi yang dilaporkan pada **22 Oktober 2025**, bukan progres terkini Agustus 2026.
> 3. BIG **Saluran Irigasi (garis) ID 358** memang valid, tetapi merupakan salah satu dari beberapa layer saluran irigasi pada kelompok skala berbeda.
> 4. BIG **Bendung (Titik) ID 293** valid sebagai layer BIG, tetapi extent metadata layer tersebut **tidak mencakup wilayah Garut**. Layer ini tidak direkomendasikan sebagai referensi Bendung Copong.
> 5. BIG layer sawah ID **224** dan **612** beserta atribut `JNSSWH`, `AQDATE`, `PUDATE`, `TNMSWH`, `SHAPE_Length`, dan `SHAPE_Area` terverifikasi.
> 6. Ditambahkan **GeoCimancis**, aplikasi geospasial BBWS Cimanuk Cisanggarung yang diperkenalkan secara resmi pada 23 April 2026.
> 7. Dokumen DED yang beredar melalui Scribd mengandung inkonsistensi angka system planning **2.703 ha vs 2.073 ha**; angka ini tidak diperlakukan sebagai data final.
> 8. Definisi layer BIG telah diverifikasi, tetapi **fitur spesifik yang benar-benar beririsan dengan Kecamatan Leuwigoong belum dikonfirmasi dengan spatial query langsung**. Untuk implementasi, lakukan query/clip di QGIS atau minta dataset resmi BBWS.


**Tanggal verifikasi sumber:** 13 Agustus 2026  
**Wilayah fokus:** Kecamatan Leuwigoong dan Daerah Irigasi (D.I.) Leuwigoong, Kabupaten Garut, Jawa Barat  
**Tujuan:** Referensi awal untuk pemetaan GIS, analisis jaringan irigasi, identifikasi sawah, dan pengembangan Water Management System (WMS).

---

## 1. Ringkasan Utama

D.I. Leuwigoong merupakan salah satu sistem irigasi penting di Kabupaten Garut. Sumber resmi Direktorat Jenderal Sumber Daya Air menyebut luas layanan D.I. Leuwigoong sekitar **5.313 ha** dan melayani wilayah pada **11 kecamatan**.

Sistem ini terkait dengan **Bendung Copong** di Sungai Cimanuk. Bendung tersebut dibangun pada periode **2010–2014** untuk menaikkan dan mempertahankan muka air Sungai Cimanuk agar air dapat dialirkan ke jaringan irigasi, termasuk pada musim kemarau.

Secara historis, pembangunan jaringan primer dan sekunder dimulai pada 2013 dan menurut publikasi Ditjen SDA telah selesai pada 2018. Pembangunan jaringan tersier kemudian direncanakan/dilanjutkan pada periode berikutnya.

Publikasi resmi BBWS Cimanuk Cisanggarung tanggal **22 Oktober 2025** menyebut pekerjaan jaringan D.I. Leuwigoong pada saat itu mencapai **74,4%**, mencakup pekerjaan pada saluran primer, sekunder, dan tersier. Karena ini adalah angka pada Oktober 2025, angka tersebut **tidak boleh dianggap sebagai progres terkini Agustus 2026** tanpa konfirmasi terbaru dari BBWS.

---

## 2. Struktur Sistem Irigasi yang Perlu Dipetakan

Untuk memahami sistem irigasi Leuwigoong, peta idealnya tidak hanya berisi garis saluran.

Struktur data yang disarankan:

```text
Sungai Cimanuk
      ↓
Bendung Copong
      ↓
Saluran Primer
      ↓
Saluran Sekunder
      ↓
Bangunan Bagi / Sadap
      ↓
Saluran Tersier
      ↓
Petak Tersier
      ↓
Petak Sawah
      ↓
Drainase / Saluran Pembuang
```

Layer GIS minimum yang sebaiknya dikumpulkan:

1. Batas administrasi Kecamatan Leuwigoong
2. Batas desa
3. Sungai
4. Bendung
5. Saluran irigasi
6. Saluran primer
7. Saluran sekunder
8. Saluran tersier
9. Bangunan bagi/sadap
10. Area/petak sawah
11. DEM/elevasi
12. Jalan akses
13. Citra satelit
14. Drainase/saluran pembuang jika tersedia

---

# 3. Sumber Resmi Utama

## 3.1 BIG — ArcGIS REST Service Rupabumi Indonesia

**Instansi:** Badan Informasi Geospasial (BIG)  
**Jenis sumber:** Data geospasial resmi / ArcGIS REST MapServer  
**Prioritas:** Sangat tinggi untuk baseline GIS

### Halaman utama service

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer

Service ini memuat banyak layer Rupabumi Indonesia pada beberapa kelompok/skala. Karena terdapat beberapa layer dengan nama serupa pada ID berbeda, jangan memilih layer hanya berdasarkan nama. Pastikan extent dan skala layer mencakup wilayah Garut.

---

## 3.2 BIG — Saluran Irigasi (Garis)

### Layer ID 358

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/358

Informasi layer:

- Nama: **Saluran Irigasi (garis)**
- Tipe: Feature Layer
- Geometry: Polyline
- Display field: `NAMOBJ`
- Mendukung query: Ya
- Format query: JSON dan GeoJSON
- Spatial Reference service: Web Mercator / EPSG:3857
- Max record count per request: 1.000

Atribut penting:

| Field | Keterangan |
|---|---|
| `OBJECTID` | ID objek |
| `NAMOBJ` | Nama objek |
| `REMARK` | Catatan |
| `FCODE` | Feature code |
| `SRS_ID` | Spatial Reference System Identifier |
| `LCODE` | Layer code |
| `METADATA` | Metadata |
| `SHAPE_Length` | Panjang geometri |

### Catatan multi-skala BIG

Service Rupabumi Indonesia memuat feature sejenis pada beberapa kelompok skala. Untuk saluran irigasi, ID yang teridentifikasi pada service antara lain:

| Kelompok skala BIG | Layer | ID |
|---|---|---:|
| 1:5.000 | Saluran Irigasi (garis) | 233 |
| 1:10.000 | Saluran Irigasi (garis) | 358 |
| 1:25.000 | Saluran Irigasi | 564 |
| 1:50.000 | Saluran Irigasi | 671 |
| 1:100.000 | Irigasi (garis) | 750 |
| 1:250.000 | Irigasi (garis) | 797 |
| 1:500.000 | Irigasi (garis) | 840 |
| 1:1.000.000 | Irigasi (garis) | 869 |

Untuk studi lokal Leuwigoong, jangan otomatis memilih ID 358 hanya karena namanya sesuai. Uji terlebih dahulu layer paling detail yang memiliki data pada AOI, dimulai dari 1:5.000, 1:10.000, dan 1:25.000.

Keberadaan suatu layer di service BIG **tidak menjamin seluruh wilayah Indonesia memiliki feature pada skala tersebut**. Validasi harus dilakukan dengan spatial query atau clip terhadap batas Leuwigoong.

### Kegunaan

Layer ini dapat digunakan untuk:

- melihat trase saluran irigasi;
- membuat overlay dengan sawah;
- mengecek kedekatan petak sawah dengan saluran;
- membangun network awal sistem distribusi air;
- menjadi baseline sebelum membedakan primer, sekunder, dan tersier melalui data BBWS atau survei.

### Catatan

Data RBI tidak selalu memberi klasifikasi operasional jaringan secara lengkap sebagai primer/sekunder/tersier. Untuk klasifikasi teknis D.I. Leuwigoong, data BBWS/desain teknis tetap lebih kuat.

---

## 3.3 BIG — Saluran Irigasi Area

### Layer ID 241

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/241

Informasi:

- Nama pada service: **Saluraan Irigasi (Area)**
- Tipe: Feature Layer
- Geometry: Polygon
- Mendukung JSON dan GeoJSON
- Memiliki cakupan service yang luas
- Effective minimum scale pada metadata service: sekitar 1:10.000

Atribut utama:

- `OBJECTID`
- `NAMOBJ`
- `FCODE`
- `LCODE`
- `REMARK`
- `SRS_ID`
- `METADATA`
- `SHAPE_Length`
- `SHAPE_Area`

### Kegunaan

Berguna apabila saluran atau elemen hidrografi direpresentasikan sebagai polygon/area, terutama untuk objek yang cukup lebar pada skala pemetaan detail.

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/241

---

## 3.4 BIG — Agrikultur Sawah

### Layer ID 224

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/224

Informasi:

- Nama: **Agrikultur Sawah**
- Geometry: Polygon
- Tipe: Feature Layer
- Mendukung JSON dan GeoJSON

Atribut yang sangat berguna:

| Field | Keterangan |
|---|---|
| `NAMOBJ` | Nama objek |
| `JNSSWH` | Jenis sawah |
| `AQDATE` | Tanggal pengamatan |
| `PUDATE` | Tanggal publikasi |
| `REMARK` | Catatan |
| `KODLCO` | Kode tutupan lahan |
| `TNMSWH` | Pola/jenis tanaman sawah |
| `SHAPE_Area` | Luas polygon |
| `SHAPE_Length` | Keliling/panjang batas |

Contoh kategori `JNSSWH` yang ditampilkan pada metadata BIG antara lain:

- Pasang surut
- Tadah hujan
- Polder
- kategori lain sesuai coded value service

Contoh kategori `TNMSWH`:

- ditanami padi terus-menerus;
- diselingi palawija atau tanaman lain;
- tanaman semusim lahan basah lain.

### Kegunaan untuk WMS

Layer ini sangat penting untuk:

- mengekstrak area sawah;
- menghitung luas sawah;
- overlay dengan jaringan irigasi;
- menentukan sawah yang berpotensi terlayani jaringan;
- melakukan analisis kebutuhan air per polygon/petak.

---

## 3.5 BIG — Agrikultur Sawah skala lain

### Layer ID 612

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/612

Layer ini juga bernama **Agrikultur Sawah**, tetapi berada pada kelompok/skala service yang berbeda.

Metadata menunjukkan:

- Geometry: Polygon
- Mendukung JSON/GeoJSON
- Effective minimum scale: 1:100.000
- Atribut mencakup `JNSSWH`, `AQDATE`, `PUDATE`, `KODLCO`, `TNMSWH`, `SHAPE_Area`, dan lain-lain.

Untuk analisis lokal Kecamatan Leuwigoong, prioritaskan layer dengan detail paling tinggi yang benar-benar tersedia pada area studi. Layer 1:100.000 lebih cocok sebagai referensi regional dibanding delineasi petak sawah yang presisi.

---

## 3.6 BIG — Sungai

Salah satu layer sungai pada service:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/566

Nama:

**Sungai (Garis)**

Geometry:

Polyline

Kegunaan:

- memetakan Sungai Cimanuk;
- memahami sumber air utama;
- analisis koneksi bendung → saluran;
- analisis elevasi dan arah aliran.

Karena service BIG memiliki beberapa layer sungai pada skala berbeda, pilih layer paling detail yang tersedia untuk AOI Leuwigoong.

---

## 3.7 BIG — Bendung

### ID 293 — tidak direkomendasikan untuk Bendung Copong

URL:

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/293

Metadata resmi BIG mengonfirmasi:

- Nama: **Bendung (Titik)**
- Geometry: Point
- Tipe: Feature Layer
- Spatial reference: EPSG:3857
- Effective minimum scale: sekitar 1:50.000

Namun, setelah diperiksa ulang, **extent layer ID 293 tidak mencapai wilayah Garut**. Extent Web Mercator layer tersebut jika dikonversi secara kasar berada sekitar **102,28°–102,62° BT dan 3,95°–4,20° LS**, sedangkan situs resmi Pemerintah Kabupaten Garut menempatkan Kabupaten Garut pada kisaran **107°25'08"–108°07'30" BT dan 6°56'49"–7°45'00" LS**. Karena itu, layer ID 293 tidak boleh diperlakukan sebagai sumber posisi Bendung Copong.

### Layer bendung lain yang lebih layak diuji

BIG juga memiliki antara lain:

**Bendung (garis) ID 236**

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/236

**Bendung (area) ID 258**

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/258

Kedua layer tersebut memiliki extent yang jauh lebih luas daripada ID 293. Namun, **keberadaan feature bernama Bendung Copong belum dikonfirmasi melalui spatial/name query dalam audit ini**.

Untuk lokasi dan identitas Bendung Copong, prioritas sumber tetap:

1. BBWS Cimanuk Cisanggarung;
2. GeoCimancis;
3. dokumen resmi D.I. Leuwigoong;
4. BIG setelah spatial query;
5. survei lapangan/GNSS jika memerlukan koordinat engineering.

---

# 4. Ina-Geoportal / TanahAir Indonesia

## Portal utama

https://tanahair.indonesia.go.id/

Ina-Geoportal merupakan portal resmi BIG untuk pencarian, visualisasi, dan pengunduhan informasi geospasial.

Menu yang relevan:

- Webmap
- Unduh Data
- Data RBI
- DEMNAS
- Batas Wilayah
- Metadata

---

## 4.1 Halaman Unduh Data

URL:

https://tanahair.indonesia.go.id/portal-web/unduh

Pada halaman unduh tersedia kategori antara lain:

- DEMNAS
- RBI per wilayah
- Batas wilayah
- RBI cetak 25K
- dataset geospasial lainnya

---

## 4.2 DEMNAS

URL:

https://tanahair.indonesia.go.id/portal-web/unduh/demnas

Pada saat verifikasi, halaman khusus DEMNAS mengarahkan ke mekanisme login portal.

### Kegunaan DEMNAS

DEM/elevasi dibutuhkan untuk:

- mengetahui beda tinggi antar area;
- mengidentifikasi arah aliran gravitasi;
- menentukan area lebih tinggi dan rendah;
- memahami mengapa satu petak menerima air lebih dahulu;
- analisis jaringan irigasi gravitasi;
- mengevaluasi potensi genangan;
- membedakan kondisi lahan relatif datar dan lahan bertingkat.

### Catatan

DEMNAS tidak menggantikan survei elevasi presisi untuk desain hidrolik detail. Untuk desain bangunan/pintu air, dibutuhkan data topografi yang lebih akurat.

---


## 4.3 GeoCimancis — BBWS Cimanuk Cisanggarung

**Status:** Sumber resmi dan sangat relevan  
**Tanggal publikasi resmi yang terverifikasi:** 23 April 2026

Halaman resmi BBWS:

https://sda.pu.go.id/balai/bbwscimancis/guest/galeri-video

BBWS Cimanuk Cisanggarung menjelaskan GeoCimancis sebagai aplikasi geospasial untuk mempermudah akses informasi sumber daya air dan infrastruktur pengairan di wilayah kerjanya.

Manfaat yang disebut BBWS antara lain:

- akses informasi jaringan infrastruktur sumber daya air;
- peningkatan transparansi dan akurasi data;
- dukungan pengambilan keputusan;
- kolaborasi pemerintah, stakeholder, dan masyarakat.

### Relevansi untuk Leuwigoong

Karena D.I. Leuwigoong berada di wilayah kerja BBWS Cimanuk Cisanggarung, GeoCimancis menjadi salah satu sumber yang sangat layak ditelusuri untuk:

- jaringan irigasi;
- infrastruktur pengairan;
- bendung;
- bangunan air;
- konteks wilayah pengelolaan SDA.

Pada audit ini belum ditemukan URL publik langsung menuju viewer GeoCimancis dari halaman resmi tersebut. Jika viewer tidak terbuka untuk publik, minta akses atau data melalui layanan informasi BBWS.

---

# 5. Informasi Resmi D.I. Leuwigoong

## 5.1 Ditjen SDA — “DI Leuwigoong Naikkan Panen di Garut”

**Instansi:** Direktorat Jenderal Sumber Daya Air  
**Tanggal publikasi:** 18 Mei 2019

URL:

https://sda.pu.go.id/post/detail/di_leuwigoong_naikkan_panen_di_garut

### Informasi penting

Sumber ini menyebut luas D.I. Leuwigoong sekitar:

**5.313 ha**

D.I. tersebut merupakan gabungan beberapa sistem irigasi teknis:

| Irigasi | Luas |
|---|---:|
| Ciojar | 73 ha |
| Cibuyutan Utara | 531 ha |
| Situ Bagendit | 409 ha |
| Citikey | 528 ha |
| Cermot | 107 ha |
| Citameng II | 82 ha |
| Citameng III | 91 ha |
| Citameng IV | 498 ha |
| Cipacing | 593 ha |
| Cibuyut | 89 ha |
| Situhiang | 70 ha |
| Sawah tadah hujan pada uraian sumber | 2.242 ha |

Sumber tersebut juga menjelaskan beberapa masalah historis:

- kondisi sebagian jaringan irigasi mengalami kerusakan;
- terjadi pendangkalan saluran;
- beberapa pintu saluran mengalami kerusakan;
- debit dari sungai-sungai kecil tidak lagi mencukupi;
- sawah hilir seluas 2.242 ha disebut sebelumnya sangat bergantung pada hujan.

### Riwayat pembangunan menurut publikasi tersebut

- Bendung Copong: **2010–2014**
- Jaringan primer dan sekunder: mulai **2013**
- Primer/sekunder dinyatakan selesai: **2018**
- Jaringan tersier: pada publikasi tersebut direncanakan/dikerjakan pada periode **2019–2021**

### Wilayah layanan

Disebut melayani areal sawah pada **11 kecamatan di Kabupaten Garut**.

---

# 6. Bendung Copong

## 6.1 BBWS Cimanuk Cisanggarung — Optimalisasi Bendung Copong

**Tanggal:** 4 November 2020

URL:

https://sda.pu.go.id/balai/bbwscimancis/guest/detail-berita/35

### Informasi penting

Bendung Copong disebut berada di:

**Desa Sukasenang, Kecamatan Garut Kota, Kabupaten Garut**

Bendung ini melayani:

**D.I. Leuwigoong ±5.313 ha di 11 kecamatan**

Fungsi utama yang dijelaskan BBWS:

- menaikkan tinggi muka air Sungai Cimanuk;
- mempertahankan muka air;
- memungkinkan air dialirkan ke saluran irigasi;
- membantu suplai air hingga musim kemarau.

BBWS juga mencatat persoalan historis berupa:

- kehilangan air akibat kondisi saluran;
- pendangkalan;
- kerusakan bangunan air;
- pintu air yang tidak dapat dioperasikan pada sebagian jaringan.

---

# 7. Informasi Pembangunan Primer dan Sekunder

## 7.1 Kementerian PUPR — Penyelesaian Saluran Irigasi Primer dan Sekunder Leuwigoong

**Tanggal:** 21 Januari 2019

URL:

https://pu.go.id/berita/dukung-ketahanan-pangan-kementerian-pupr-selesaikan-saluran-irigasi-primer-dan-sekunder-di-leuwigoong-garut

Publikasi ini merupakan sumber resmi Kementerian PUPR terkait pembangunan dan rehabilitasi jaringan primer dan sekunder D.I. Leuwigoong.

Gunakan sumber ini sebagai referensi historis pembangunan fisik jaringan.

---

# 8. Update Resmi 2025

## 8.1 Progres Jaringan D.I. Leuwigoong 74,4%

**Instansi:** BBWS Cimanuk Cisanggarung  
**Tanggal:** 22 Oktober 2025

URL:

https://sda.pu.go.id/balai/bbwscimancis/guest/detail-berita/780

### Informasi utama

Pada tanggal publikasi tersebut, BBWS menyebut progres fisik pekerjaan jaringan D.I. Leuwigoong mencapai:

**74,4%**

Pekerjaan mencakup:

- saluran primer;
- saluran sekunder;
- saluran tersier.

Publikasi tersebut juga mengaitkan pekerjaan dengan peningkatan distribusi air ke lahan pertanian di Kecamatan Leuwigoong dan sekitarnya.

### Catatan status

Angka 74,4% adalah **snapshot per 22 Oktober 2025**.

Pada pencarian hingga 13 Agustus 2026, belum ditemukan publikasi resmi yang secara jelas memberikan **persentase progres terbaru 2026** untuk paket yang sama.

Karena itu:

> Jangan menulis “progres D.I. Leuwigoong saat ini 74,4%”.

Lebih aman menulis:

> “BBWS Cimanuk Cisanggarung melaporkan progres fisik sebesar 74,4% pada 22 Oktober 2025.”

---

# 9. Informasi Leuwigoong Lain yang Relevan

## 9.1 Situ Sarkanjut, Kecamatan Leuwigoong

Sumber BBWS:

https://sda.pu.go.id/balai/bbwscimancis/guest/detail-berita/808

Publikasi BBWS tanggal 26 Oktober 2025 menyebut Situ Sarkanjut di Kelurahan Dungusiku, Kecamatan Leuwigoong sebagai sumber daya air yang mendukung pertanian lokal.

Informasi dalam sumber tersebut antara lain:

- luas layanan irigasi: **116 ha**
- volume tampungan: **124.099 m³**
- luas genangan: **4 ha**

Data ini penting karena sistem air pertanian di Kecamatan Leuwigoong tidak selalu harus dipahami hanya dari Bendung Copong. Tampungan lokal seperti situ juga dapat berpengaruh pada blok layanan tertentu.

---

# 10. Dokumen Desain Teknis Pendukung

## 10.1 Review Desain Jaringan Irigasi Kiri D.I. Leuwigoong

**Platform:** Scribd  
**Status:** Dokumen pihak ketiga / user-uploaded  
**Prioritas validasi:** Menengah — harus dibandingkan dengan dokumen resmi BBWS

URL:

https://id.scribd.com/document/812968855/0-KATA-PENGANTAR

Dokumen yang terindeks memuat judul:

**Review Desain Jaringan Irigasi Kiri D.I. Leuwigoong**

Dokumen menyebut pekerjaan konsultansi terkait BBWS Cimanuk Cisanggarung dan memuat referensi gambar:

- Peta Lokasi Pekerjaan
- Peta Tata Guna Lahan Eksisting Kabupaten Garut
- **Peta Situasi Jaringan Tersier Kiri D.I. Leuwigoong**
- foto/identifikasi bangunan utama
- bangunan sadap
- Bendung Copong

Daftar saluran/bangunan yang tercantum dalam dokumen antara lain:

- Copong
- Copong Kiri
- Ciduga
- Cikukuk
- Ciseureuh
- Leuwigoong
- Kawung Luwuk
- Citikey Kiri
- Citikey Kanan
- Parigi
- Bagendit
- Ranca Ucing
- Cinanti
- Sawah Bera
- Cikananga

### Catatan

Scribd bukan sumber otoritatif pemerintah. Dokumen ini sangat berguna untuk mencari nama saluran dan memahami skema teknis, tetapi data final untuk desain atau keputusan lapangan harus dikonfirmasi ke BBWS Cimanuk Cisanggarung.

---


## 10.2 DED Jaringan Tersier D.I. Leuwigoong — sumber pendukung

**Platform:** Scribd  
**Status:** Dokumen pihak ketiga / bukan portal publik resmi BBWS

URL:

https://id.scribd.com/document/739026541/trsierLWiGOONG-5-313Ha-lapPEND

Dokumen yang terindeks memuat antara lain:

- Bendung Copong sebagai bendung utama;
- sumber air Sungai Cimanuk;
- luas D.I. 5.313 ha;
- skema detail desain jaringan tersier 3.240 ha;
- pemetaan saluran primer, sekunder, tersier, kuarter, dan pembuang;
- pengukuran topografi dan inventori bangunan.

### Inkonsistensi yang ditemukan saat audit

Pada daftar gambar tertulis:

**Skema System Planning Jaringan Irigasi seluas 2.703 ha**

Namun pada bagian lingkup pekerjaan tertulis:

**Pembuatan system planning areal seluas 2.073 ha**

Karena terdapat perbedaan **2.703 vs 2.073 ha dalam dokumen yang sama**, angka tersebut tidak boleh dipakai sebagai angka final tanpa memeriksa dokumen kontrak/desain resmi dari BBWS.

Sebaliknya, angka **5.313 ha untuk luas D.I. Leuwigoong** konsisten dengan sumber resmi Ditjen SDA dan BBWS.

---

# 11. Sumber Historis Tambahan

## 11.1 Majalah Air — Direktorat Jenderal SDA, 2012

URL PDF:

https://sda.pu.go.id/assets/uploads/files/Majalah%20Air%20Jan-Feb%202012.pdf

Dokumen historis ini menyebut riwayat perencanaan Bendung Copong/D.I. Leuwigoong, termasuk:

- perencanaan awal pada awal 1990-an;
- review design sistem saluran;
- perubahan/penetapan luasan D.I.;
- latar belakang pengembangan Bendung Copong.

Sumber ini berguna untuk memahami sejarah desain, bukan untuk menggantikan data kondisi jaringan terbaru.

---

# 12. Sumber Peta yang Direkomendasikan

Urutan prioritas pengumpulan data:

| Prioritas | Data | Sumber |
|---:|---|---|
| 1 | Jaringan primer/sekunder/tersier resmi | BBWS Cimanuk Cisanggarung |
| 2 | Bangunan bagi/sadap dan nomenklatur saluran | BBWS / gambar desain D.I. |
| 3 | Saluran irigasi baseline | BIG RBI |
| 4 | Polygon sawah | BIG RBI |
| 5 | Sungai | BIG RBI |
| 6 | DEM/elevasi | DEMNAS BIG |
| 7 | Batas administrasi | Ina-Geoportal/BIG |
| 8 | Citra resolusi tinggi | citra satelit/basemap yang memiliki lisensi penggunaan sesuai kebutuhan |
| 9 | Petak sawah aktual | digitasi + survei lapangan |
| 10 | Posisi pintu dan kondisi bangunan | survei lapangan / BBWS |

---

# 13. Workflow QGIS yang Disarankan

## Tahap 1 — Tentukan Area of Interest

Gunakan batas:

```text
Kabupaten Garut
    ↓
Kecamatan Leuwigoong
    ↓
Desa
```

Jangan langsung memotong berdasarkan nama “D.I. Leuwigoong”, karena luas D.I. tidak sama dengan batas Kecamatan Leuwigoong.

---

## Tahap 2 — Masukkan Basemap

Gunakan satu basemap citra sebagai referensi visual.

Tujuan:

- mengenali petak sawah;
- melihat jalan inspeksi;
- mengidentifikasi saluran yang tidak tercatat;
- memvalidasi jalur saluran RBI.

---

## Tahap 3 — Masukkan Data BIG

Layer minimum:

```text
Saluran Irigasi
Sungai
Sawah
Bendung
```

Kemudian lakukan:

```text
Clip → batas AOI Leuwigoong
```

---

## Tahap 4 — Tambahkan DEMNAS

Turunkan informasi:

```text
DEM
 ↓
Slope
 ↓
Flow Direction
 ↓
Flow Accumulation
```

Gunakan hasil untuk memahami topografi dan arah aliran potensial.

Catatan: aliran kanal irigasi tidak selalu mengikuti flow accumulation alami karena saluran merupakan infrastruktur buatan.

---

## Tahap 5 — Validasi dengan Peta BBWS

Overlay:

```text
RBI Saluran
+
Peta Desain BBWS
+
Citra Satelit
```

Tujuan:

- klasifikasi primer;
- klasifikasi sekunder;
- klasifikasi tersier;
- nama saluran;
- posisi bangunan bagi;
- posisi sadap;
- hubungan antarjaringan.

---

## Tahap 6 — Digitasi Petak Sawah

Jika petak individu tidak tersedia sebagai polygon:

1. gunakan citra resolusi tinggi;
2. digitasi batas pematang;
3. buat ID petak;
4. hitung luas;
5. hubungkan dengan saluran tersier terdekat.

Contoh atribut:

| Field | Contoh |
|---|---|
| `petak_id` | LW-001 |
| `desa` | ... |
| `luas_ha` | 0.42 |
| `saluran` | Tersier A |
| `elevasi` | ... |
| `inlet_id` | IN-001 |
| `outlet_id` | OUT-001 |
| `status_irigasi` | teknis |
| `komoditas` | padi |

---

# 14. Struktur Database untuk WMS

Untuk pengembangan Water Management System, data GIS dapat disusun seperti:

## Tabel `irrigation_channel`

```text
channel_id
channel_name
channel_type
upstream_id
downstream_id
length_m
design_discharge
geometry
```

`channel_type`:

```text
primary
secondary
tertiary
drainage
```

---

## Tabel `irrigation_structure`

```text
structure_id
structure_name
structure_type
channel_id
latitude
longitude
elevation
status
```

`structure_type`:

```text
weir
intake
division_gate
turnout
check_gate
culvert
measurement_structure
```

---

## Tabel `rice_field`

```text
field_id
area_ha
village
tertiary_channel_id
elevation
crop
planting_date
water_requirement
geometry
```

---

# 15. Potensi Analisis WMS

Setelah data spasial tersedia, sistem dapat menjawab pertanyaan seperti:

### 15.1 Berapa luas sawah yang dilayani suatu saluran?

```text
Saluran Tersier A
        ↓
Petak 01 = 0,4 ha
Petak 02 = 0,7 ha
Petak 03 = 0,5 ha
        ↓
Total = 1,6 ha
```

---

## 15.2 Berapa kebutuhan debit?

Konsep sederhana:

```text
Q = DR × A
```

dengan:

- `Q` = kebutuhan debit, L/s
- `DR` = Diversion Requirement, L/s/ha
- `A` = luas layanan, ha

Contoh:

```text
DR = 1,5 L/s/ha
A  = 10 ha

Q = 1,5 × 10
  = 15 L/s
```

Nilai DR tidak boleh dianggap konstan untuk semua kondisi. Nilainya dipengaruhi kebutuhan tanaman, efisiensi jaringan, hujan efektif, perkolasi, kondisi tanah, musim, dan pola operasi irigasi.

---

# 16. Data Sensor yang Bisa Ditambahkan

Jika peta akan digunakan untuk WMS/telemetry, titik sensor dapat ditempatkan pada:

```text
Bendung
↓
Saluran Primer
↓
Bangunan Bagi
↓
Saluran Sekunder
↓
Bangunan Sadap
↓
Saluran Tersier
```

Parameter potensial:

| Parameter | Sensor |
|---|---|
| Tinggi muka air | Radar/ultrasonic water level |
| Kecepatan air | Current meter / STIV / velocity sensor |
| Debit | hasil Q = A × V atau rating curve |
| Posisi pintu | encoder/position sensor |
| Curah hujan | tipping bucket |
| Suhu/kelembapan | weather sensor |
| Status perangkat | logger telemetry |

Untuk sistem distribusi irigasi, titik paling bernilai biasanya tidak harus ada di setiap petak. Prioritaskan node yang mengontrol atau membagi debit.

---

# 17. Pertanyaan yang Dapat Dijawab Setelah GIS Lengkap

Dataset yang baik memungkinkan analisis:

1. Sawah mana yang menerima air dari Bendung Copong?
2. Saluran primer mana yang menuju Kecamatan Leuwigoong?
3. Berapa luas layanan tiap saluran sekunder?
4. Saluran tersier mana yang menyuplai petak tertentu?
5. Berapa luas tiap petak?
6. Berapa kebutuhan air tiap petak?
7. Berapa debit yang harus melewati suatu pintu?
8. Area mana yang paling jauh dari sumber air?
9. Area mana yang berpotensi mengalami kekurangan air?
10. Apakah distribusi air hulu dan hilir seimbang?
11. Bagaimana elevasi memengaruhi distribusi?
12. Di mana sensor debit/water level paling efektif dipasang?

---

# 18. Hal yang Tidak Bisa Dipastikan Hanya dari Peta RBI

Peta RBI sangat berguna sebagai baseline, tetapi umumnya belum cukup untuk memastikan:

- nama operasional setiap saluran;
- status primer/sekunder/tersier secara aktual;
- debit desain;
- debit aktual;
- bukaan pintu;
- kondisi saluran;
- efisiensi saluran;
- siapa P3A yang mengoperasikan tiap blok;
- jadwal pembagian air;
- batas petak tersier operasional;
- kehilangan air aktual;
- perubahan jaringan terbaru.

Untuk hal tersebut dibutuhkan:

- skema jaringan BBWS;
- data DI;
- data operasi dan pemeliharaan;
- data P3A/GP3A/IP3A;
- survei lapangan.

---

# 19. Hal Penting tentang “Leuwigoong”

Bedakan tiga konsep berikut:

### Kecamatan Leuwigoong

Wilayah administratif.

### D.I. Leuwigoong

Wilayah layanan sistem irigasi, yang dapat melintasi beberapa kecamatan.

### Jaringan/saluran Leuwigoong

Infrastruktur yang terdiri dari bendung, primer, sekunder, tersier, bangunan bagi/sadap, dan saluran pembuang.

Jadi:

```text
Kecamatan Leuwigoong ≠ D.I. Leuwigoong
```

Ini penting agar analisis GIS tidak salah memotong data hanya pada batas kecamatan jika tujuan sebenarnya adalah memahami keseluruhan sistem D.I.

---

# 20. Rekomendasi Dataset Minimum untuk Studi Kasus

Jika tujuan awal hanya membuat prototype WMS, gunakan:

```text
1. Batas Kecamatan Leuwigoong
2. Polygon sawah
3. Saluran irigasi
4. Sungai Cimanuk
5. Bendung Copong
6. DEMNAS
7. Citra satelit
```

Versi selanjutnya:

```text
+ primer/sekunder/tersier resmi
+ bangunan bagi/sadap
+ petak tersier
+ data debit
+ data water level
+ data pintu
+ pola tanam
+ DR/NFR/ETc/Re/perkolasi
```

---

# 21. URL Lengkap Sumber

## Badan Informasi Geospasial

### Ina-Geoportal

https://tanahair.indonesia.go.id/

### Unduh data

https://tanahair.indonesia.go.id/portal-web/unduh

### DEMNAS

https://tanahair.indonesia.go.id/portal-web/unduh/demnas

### RBI ArcGIS REST MapServer

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer

### Saluran Irigasi Garis ID 358

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/358

### Saluran Irigasi Area ID 241

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/241

### Agrikultur Sawah ID 224

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/224

### Agrikultur Sawah ID 612

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/612

### Sungai Garis ID 566

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/566

### Bendung Titik ID 293 — metadata valid, tetapi extent tidak mencakup Garut

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/293

### Bendung Garis ID 236 — kandidat untuk spatial query

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/236

### Bendung Area ID 258 — kandidat untuk spatial query

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/258

### Saluran Irigasi 5K ID 233

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/233

### Saluran Irigasi 25K ID 564

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/564

### Saluran Irigasi 50K ID 671

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/671

### Irigasi Garis 100K ID 750

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/750

### Irigasi Garis 250K ID 797

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/797

### Irigasi Garis 500K ID 840

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/840

### Irigasi Garis 1M ID 869

https://geoservices.big.go.id/rbi/rest/services/BASEMAP/Rupabumi_Indonesia/MapServer/869

---

## Direktorat Jenderal Sumber Daya Air / Kementerian PU

### DI Leuwigoong Naikkan Panen di Garut

https://sda.pu.go.id/post/detail/di_leuwigoong_naikkan_panen_di_garut

### Optimalisasi Bendung Copong

https://sda.pu.go.id/balai/bbwscimancis/guest/detail-berita/35

### Progres D.I. Leuwigoong 74,4% — 22 Oktober 2025

https://sda.pu.go.id/balai/bbwscimancis/guest/detail-berita/780

### Pembangunan Primer dan Sekunder Leuwigoong

https://pu.go.id/berita/dukung-ketahanan-pangan-kementerian-pupr-selesaikan-saluran-irigasi-primer-dan-sekunder-di-leuwigoong-garut

### Informasi Situ Sarkanjut, Leuwigoong

https://sda.pu.go.id/balai/bbwscimancis/guest/detail-berita/808

### GeoCimancis — publikasi resmi BBWS

https://sda.pu.go.id/balai/bbwscimancis/guest/galeri-video

### Majalah Air 2012 — sejarah Bendung Copong/Leuwigoong

https://sda.pu.go.id/assets/uploads/files/Majalah%20Air%20Jan-Feb%202012.pdf

---

## Dokumen pendukung pihak ketiga

### Review Desain Jaringan Irigasi Kiri D.I. Leuwigoong

https://id.scribd.com/document/812968855/0-KATA-PENGANTAR

### DED Jaringan Tersier D.I. Leuwigoong

https://id.scribd.com/document/739026541/trsierLWiGOONG-5-313Ha-lapPEND

---

# 22. Kontak BBWS Cimanuk Cisanggarung

Berdasarkan halaman resmi BBWS yang diverifikasi pada 13 Agustus 2026:

**BBWS Cimanuk Cisanggarung**  
Jalan Pemuda No. 40, Kel. Sunyaragi, Kec. Kesambi, Kota Cirebon 45132

Email:

bbwscimancis@pu.go.id

Telepon:

(0231) 205875

WhatsApp yang tercantum pada situs:

08131561737

Website:

https://sda.pu.go.id/balai/bbwscimancis/

Untuk permintaan data teknis, data yang paling bernilai untuk diminta adalah:

```text
1. General Layout D.I. Leuwigoong
2. Skema Jaringan Irigasi
3. Skema Bangunan
4. Data Saluran Primer
5. Data Saluran Sekunder
6. Data Saluran Tersier
7. Petak Tersier
8. Luas layanan tiap bangunan sadap
9. Nomenklatur bangunan
10. Data debit rencana
11. Data debit operasi
12. Data pintu air
13. Data P3A/GP3A
14. Data geospasial SHP/KML/DWG jika dapat diberikan
```

---

# 23. Kesimpulan

Untuk pemetaan irigasi Leuwigoong, sumber terbaik bukan satu peta tunggal.

Pendekatan yang paling kuat adalah:

```text
BIG RBI
    +
DEMNAS
    +
Citra Satelit
    +
Data Teknis BBWS
    +
Survei Lapangan
```

BIG dapat menjadi baseline untuk **saluran, sungai, sawah, dan hidrografi**, sedangkan BBWS diperlukan untuk memahami **hierarki jaringan, nama saluran, petak tersier, bangunan bagi/sadap, debit, dan operasi jaringan**.

Untuk pengembangan WMS, model data ideal adalah:

```text
Bendung Copong
      ↓
Primer
      ↓
Sekunder
      ↓
Bangunan Bagi/Sadap
      ↓
Tersier
      ↓
Petak Sawah
      ↓
Luas
      ↓
Kebutuhan Air
      ↓
Debit yang Harus Dialirkan
```

Dengan struktur tersebut, peta tidak hanya berfungsi sebagai visualisasi, tetapi dapat menjadi basis perhitungan distribusi air, kebutuhan debit, penempatan sensor, monitoring pintu, dan analisis kekurangan air dari hulu sampai hilir.

---

## Catatan Validasi

- Informasi luas **5.313 ha**, cakupan **11 kecamatan**, sejarah pembangunan, dan fungsi Bendung Copong telah dicek ulang terhadap publikasi resmi Ditjen SDA/BBWS.
- Angka progres **74,4%** adalah kondisi yang dilaporkan pada **22 Oktober 2025**, bukan klaim progres terkini Agustus 2026.
- Pada audit hingga **13 Agustus 2026**, tidak ditemukan publikasi resmi BBWS yang memberikan persentase progres yang lebih baru untuk paket yang sama.
- Pencarian ulang sumber resmi BBWS/Kementerian PU pada 13 Agustus 2026 masih menemukan publikasi **22 Oktober 2025** sebagai sumber persentase 74,4%; tidak ditemukan persentase D.I. Leuwigoong yang lebih baru dalam hasil resmi yang terindeks.
- BIG menyediakan beberapa layer irigasi pada kelompok skala berbeda. ID 358 valid, tetapi bukan satu-satunya layer yang harus digunakan.
- BIG Bendung (Titik) ID 293 valid secara metadata, tetapi extent-nya tidak mencakup Garut dan **tidak direkomendasikan untuk Bendung Copong**.
- Atribut sawah BIG `JNSSWH`, `AQDATE`, `PUDATE`, `TNMSWH`, `SHAPE_Length`, dan `SHAPE_Area` pada ID 224 dan 612 telah diverifikasi.
- Definisi dan extent layer BIG telah diperiksa, tetapi feature spesifik yang beririsan langsung dengan Kecamatan Leuwigoong belum dibuktikan melalui query spasial pada audit ini.
- GeoCimancis ditambahkan sebagai sumber resmi BBWS yang relevan per publikasi 23 April 2026.
- Dokumen Scribd hanya dipakai sebagai sumber pendukung. DED yang terindeks memiliki inkonsistensi angka **2.703 ha vs 2.073 ha**, sehingga angka tersebut tidak boleh dipakai sebagai nilai final.
- Untuk engineering design atau keputusan operasi air, verifikasi menggunakan data terbaru BBWS, skema D.I., data operasi, dan survei lapangan.
