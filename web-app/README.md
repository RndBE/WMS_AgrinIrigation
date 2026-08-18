# Beacon SWH — peta satu halaman

Halaman tunggal untuk melihat hasil analisa sawah: peta dengan overlay batas dari KML,
kartu ringkasan menempel di dalam peta (luas, kebutuhan air, water loss), dan kartu
detail per petak di samping.

## Jalankan

```bash
python web-app/app.py
```

Alamatnya dicetak saat mulai — `http://127.0.0.1:5000` untuk PC ini, dan
`http://<IP-PC>:5000` untuk dibuka dari ponsel atau laptop lain **di jaringan yang
sama**. Windows biasanya menanyakan izin Firewall pada kali pertama: pilih **Private
networks** saja.

Butuh `Flask` dan `pandas` (lihat `requirements.txt`). Leaflet sudah disertakan di
`static/vendor/`, jadi tidak ada permintaan ke CDN.

### Pengaturan

| Variabel lingkungan | Bawaan | Guna |
|---|---|---|
| `BEACON_HOST` | `0.0.0.0` | antarmuka yang didengarkan. Pakai `127.0.0.1` untuk menutup dari jaringan |
| `BEACON_PORT` | `5000` | porta |
| `BEACON_DEBUG` | *(mati)* | `1` menyalakan debugger Werkzeug |

Menutup kembali dari jaringan:

```bash
BEACON_HOST=127.0.0.1 python web-app/app.py
```

> **Debugger Werkzeug sengaja mati secara bawaan.** Konsolnya dapat menjalankan perintah
> apa pun lewat peramban, jadi selama server terbuka ke jaringan hal itu berarti siapa
> pun di jaringan yang sama bisa menjalankan kode di PC ini. `BEACON_DEBUG=1` karena itu
> hanya berlaku kalau `BEACON_HOST` juga dikunci ke `127.0.0.1`; di luar itu permintaannya
> diabaikan dan dicetak alasannya. Muat-ulang otomatis tetap jalan tanpa debugger.
>
> Server ini tetap **server pengembangan** — cukup untuk dipakai di kantor atau di
> lapangan lewat jaringan setempat, bukan untuk dipasang di internet.

## Susunan

| Berkas | Isi |
|---|---|
| `app.py` | rute Flask: halaman, API lokasi, penerus ubin peta, API lapisan BIG & Daerah Irigasi |
| `data.py` | pembaca KML → GeoJSON, penggabung hasil notebook, pengambil lapisan BIG & Daerah Irigasi |
| `templates/index.html` | satu halaman (peta 8 : detail 2) |
| `static/css/app.css` | tema putih + biru muda pastel |
| `static/js/app.js` | peta Leaflet, kartu, legenda, daftar petak |
| `logo_beacon.png` | logo, dilayani di `/logo_beacon.png` |

## Lokasi yang tampil

| Lokasi | Keadaan | Geometri | Angka |
|---|---|---|---|
| `Jaringan D.I. Leuwigoong` | **aktif** | `note/output-jaringan-air/jaringan_ruas.geojson` (SISDA) | `note/output-jaringan-air/` — debit & kebutuhan air **per ruas saluran** |
| `DI Kab. Garut` | **aktif** | `data/DI_Kewenangan_Kabupaten_Garut.geojson` (SISDA) — 11 dari 32 DI, hanya yang dilewati jaringan | `note/output-di-garut-air/` — cuaca **nyata** 11 tahun per DI, ETo FAO-56 |
| `Leuwigoong` | **aktif** | **tidak ada** — lihat di bawah | hanya lapisan letak SISDA; **tidak ada objek terukur** |
| `SWH-011` | *beku* | `SWH-011_lengkap.kml` | `note/output-swh/` — cuaca **buatan** (deret acak berbenih tetap) |
| `SWH-JB-GRT` | *beku* | `SWH-JB-GRT.kml` | terrain & luas dari `note/output-swh-jb-grt/`, air dari `note/output-swh-jb-grt-air/` — cuaca **nyata** 11 tahun (ERA5-Land + NASA POWER), ETo FAO-56 |

**Membekukan** satu lokasi berarti ia hilang dari pemilih di halaman sementara KML,
keluaran notebook, dan pemuatnya tetap utuh. Semuanya diatur satu tanda di
`data.py`:

```python
LOKASI["swh-011"]["tampil"] = True     # tampil lagi
```

### Jaringan D.I. Leuwigoong

**176 ruas saluran, 243 km, hulu di Bendung Copong.** Ini satu-satunya lokasi yang
subjeknya **garis**, bukan bidang — dan itu mengubah pertanyaannya. Di lokasi lain yang
ditanya *"berapa air yang dipakai wilayah ini"*; di sini *"berapa air yang harus **lewat**
ruas ini"*. Dua angka yang berbeda: satu ruas primer membawa air untuk seluruh hamparan di
hilirnya, bukan cuma untuk lahan yang kebetulan ada di sebelahnya.

Karena itu `luas_ha` di sini **bukan luas objeknya** — saluran tidak punya luas —
melainkan luas lahan yang airnya lewat ruas itu. Luas yang menempel pada ruasnya sendiri
dibawa terpisah sebagai `luas_layanan_sendiri_ha`.

#### Tiga langkah hitungannya

Semuanya di `note/hitung-jaringan-air.py`; halaman cuma membacanya.

1. **Graf.** 176 ruas SISDA sebenarnya 837 penggal terpisah. Penggalnya disambungkan
   kalau ujung yang satu jatuh dalam **10 m** dari simpul mana pun milik yang lain —
   bukan ujung-ke-ujung saja, karena tersier menempel di **tengah** sekunder. Angkanya
   diukur, bukan ditebak: pada 5 m graf terbesar cuma memuat 58 % panjang jaringan, pada
   10 m sudah 91 %, dan 30 m hanya menambah 3 % lagi sambil mulai menyambungkan saluran
   yang cuma bersisian. Arah alirnya dari penelusuran lebar-dulu dari Bendung Copong:
   apa pun yang lebih jauh dari bendung ada di hilir. **28 dari 837 penggal** tidak
   tersambung; ruasnya ditandai `terhubung: false` dan debitnya hanya beban sendiri.

2. **Layanan.** Sawah BIG RBI 25K dipecah jadi sel **100 m**, tiap sel diberikan ke
   saluran **tersier** terdekat sejauh masih di dalam **750 m**. Pemecahan itu perlu:
   blok RBI di sini bermedian 10 ha tetapi yang terbesar **3.108 ha**, satu poligon yang
   membentang melewati puluhan saluran — memberikannya utuh ke satu tersier menurut titik
   wakilnya akan menaruh 3.108 ha di satu ruas dan mengosongkan tetangganya. Tersier yang
   dipilih karena di KP-01 lahan memang dilayani pada tingkat itu.

3. **Akumulasi.** Beban tiap penggal dijumlahkan dari hilir ke hulu, lalu dibagi
   efisiensi **kumulatif** menurut tingkat salurannya — 0,90 tersier, 0,90 × 0,90
   sekunder, 0,90 × 0,90 × 0,80 primer. Hasil kali ketiganya dijaga sama dengan tetapan
   tunggal `EFISIENSI_IRIGASI` di `air_kp01.py` lewat `assert`; kalau tidak, debit primer
   di sini dan debit di pipeline DI akan berbeda karena sebab yang tidak tertulis di mana
   pun.

#### Wilayah layanan tanpa petak baku

Lokasi ini **tidak memakai `DI_Leuwigoong_Baku`** — lapisan yang dibuang karena bertindihan
46,8 % dengan DI kewenangan kabupaten (lihat bagian **Leuwigoong**). Wilayah layanannya
diturunkan dari jaringannya sendiri, dan hasilnya bisa diuji:

> Terjaring **5.491 ha**, berselisih **+9 %** dari 5.047 ha petak baku D.I. Leuwigoong —
> tanpa sekali pun memakai lapisan yang bersengketa itu.

Jangkauan 750 m dipilih dari situ, bukan dari selera: luas terjaring naik 4.638 ha
(500 m) → 5.501 ha (750 m) → 6.104 ha (1.000 m), dan 750 m yang memulangkan wilayah
DI-nya sendiri alih-alih wilayah tetangganya. Angka bandingnya dicetak tiap kali skrip
jalan, jadi penyimpangannya kelihatan kalau datanya berubah.

#### Iklim per zona, dan pinjamannya

Iklim diambil per **zona** — saluran induk/sekunder beserta seluruh tersier di bawahnya —
di titik berat sawah yang dilayaninya. Bukan per tersier: 139 titik ERA5-Land di wilayah
selebar 17 km cuma mengulang petak kisi yang sama belasan kali.

Open-Meteo menakar jatahnya dari **banyaknya angka**, bukan banyaknya permintaan, dan satu
permintaan di sini memuat 11 tahun × 7 peubah harian. Kalau jatahnya habis di tengah jalan,
zona yang belum terunduh **meminjam iklim zona terdekat yang punya** — menyimpang dari
aturan `hitung-di-garut-air.py`, yang menolak menambal DI terlewat dengan iklim
tetangganya. Penyimpangannya disengaja dan sebabnya beda tingkat: di sana objeknya DI-DI
se-kabupaten yang berjauhan puluhan kilometer; di sini seluruh zona ada di dalam **satu**
DI selebar 17 km dan cuma menempati **empat** petak kisi ERA5-Land, sehingga dua zona
bertetangga hampir selalu berbagi petak yang sama persis.

Yang membuatnya tetap boleh: **pinjamannya tidak disembunyikan.** Tiap ruas membawa
`cuaca_dari` dan `cuaca_jarak_km`, jumlahnya dicetak di akhir dan disimpan di
`ringkasan_air.csv`, dan ia hilang sendiri begitu skrip dijalankan ulang saat jatah
layanan pulih:

```bash
python note/hitung-jaringan-air.py
```

#### Time of Travel

`note/hitung-tot-jaringan.py` → `tot_ruas.csv`, dibaca lewat `KOLOM_TOT`. Manning pada
penampang trapesium, kedalaman normal bentuk tertutup (semua suku berpangkat `h^(8/3)`,
jadi `h = [Qn / (√S·K)]^(3/8)` tanpa iterasi).

**Ini ToT rancangan, bukan terukur.** Dari tujuh besaran yang menentukan waktu tempuh,
SISDA hanya punya dua:

| | |
|---|---|
| **ada** | panjang ruas, debit (akumulasi KP-01) |
| **tidak ada** | penampang, kedalaman air, kemiringan dasar, kekasaran Manning, bukaan pintu |

Lima yang tidak ada diturunkan dari debit dan dijalankan dalam **rentang**, bukan satu
nilai. Kemiringan dasar sengaja **tidak** diambil dari DEM: cache DEM repo ini berkelas
SRTM (±5–10 m tegak), sedangkan saluran irigasi berkemiringan 1:1.000–1:10.000 — turun
0,3–3 m sepanjang 3 km, tenggelam di derau DEM-nya sendiri. Beda tinggi medan antar-zona
(498–690 m) juga bukan kemiringan saluran: saluran menyusur kontur dan membuang beda
tinggi di bangunan terjun.

**Tiga waktu, bukan dua**, dan halaman menampilkan ketiganya berdampingan karena
menyamakan yang pertama dengan yang kedua adalah kekeliruan yang paling mahal di operasi
jaringan:

| | kecepatan rambat | ke titik terjauh | dipakai untuk |
|---|---|---|---|
| Water travel time | `v = Q/A` | 34,0 jam | kapan air/sedimen sampai di petak |
| Hydraulic response time | `c_k = dQ/dA` = 1,37 v | 24,8 jam | kapan debit hilir naik → **jadwal pintu** |
| Waktu datang gangguan | `c_d = v + √(gD)` | 5,4 jam | riak pertama; tidak membawa debit |

`c_k` dihitung **numerik** dari bentuk trapesiumnya (`dQ/dh ÷ dA/dh` pada lebar dasar
yang dipatok), bukan memakai 5/3 yang hanya berlaku untuk saluran persegi sangat lebar.
Jadwal pintu yang disusun memakai water travel time akan terlambat 9,2 jam di titik itu.

Pitanya lebar dan itu memang jawabannya: **22,2 … 34,0 … 52,3 jam** (×2,4 ujung ke
ujung). Elastisitas ToT — diturunkan analitik dari bentuk pangkat ⅜ lalu diuji numerik,
keduanya cocok persis:

| parameter | elastisitas | ToT kalau +20 % |
|---|---:|---|
| panjang L | +1,000 | naik 20,0 % |
| **kekasaran n** | **+0,750** | naik 14,7 % |
| kemiringan S | −0,375 | turun 6,6 % |
| debit Q | −0,250 | turun 4,5 % |
| nisbah b/h | +0,036 | naik 0,7 % |

Setelah panjang — yang bukan variabel — **kekasaran Manning paling menentukan**, dan
justru itu yang paling tidak diketahui. Survei yang paling menghasilkan per usaha:
jenis lining & kondisi vegetasi, lalu profil memanjang 37 ruas primer/sekunder yang
menanggung 90 % waktu kumulatif. Penampang dan data pintu hampir tidak menggeser ToT.

**117 ruas (107,7 km, 47 % panjang) berkecepatan di bawah 0,25 m/detik** pada aliran
menerus — batas anti-endapan. Itu bukan cacat hitungan melainkan pertanda anggapannya
yang keliru: saluran tersier tidak dialiri terus-menerus sebesar kebutuhan rata-ratanya
melainkan **bergilir**. Waktu tempuhnya karena itu diperlakukan sebagai **batas atas**,
dan `L/0,25` sebagai batas bawah; ruas yang kena ditandai `di_bawah_v_min` dan
disebutkan di popup maupun kartu detail.

#### Yang tidak dijawab

Apakah salurannya **sanggup** membawa debit itu. Penampang, kemiringan dasar, dan
kekasaran saluran tidak ada di data SISDA, jadi "debit yang dibutuhkan" di sini tidak
pernah dibandingkan dengan "debit yang muat" — yang ada cuma penampang **rancangan**
yang diturunkan dari debitnya sendiri, sehingga menurut susunannya ia selalu cukup.

#### Tampilannya

Subjek bergaris memakai **skala warna sendiri** (`SKALA_GARIS`), bukan pita pastel yang
dipakai bidang. Pita itu dirancang sebagai **isian**, terang di ujung bawah supaya citra
satelit di bawahnya tetap terbaca; dipakai sebagai warna **garis**, ujung terangnya
praktis lenyap di atas citra — dan yang lenyap justru ruas berdebit kecil, yaitu tersier,
yaitu ruas yang paling banyak jumlahnya. Selain warna, **tebal garisnya** ikut mengikuti
metrik: debit yang beda seribu kali lipat antara primer dan tersier tidak akan pernah
terbaca dari warna saja.

### DI Kab. Garut

**11 Daerah Irigasi yang dilewati jaringan D.I. Leuwigoong, 3.958 ha luas baku.**
Objeknya di sini adalah **daerah irigasi**, bukan petak sawah — satu poligon = satu
hamparan layanan yang ditetapkan Permen PUPR No. 14/2015. Karena itu `istilah()`
menyebutnya "daerah irigasi", bukan "petak": satu DI seluas 800 ha yang dipanggil "petak"
menjanjikan ketelitian per pematang yang tidak ada di datanya, sekaligus salah tingkat.

#### Hanya yang dilewati jaringan

Kabupaten Garut punya **32** DI kewenangan kabupaten (11.129 ha), tetapi yang diukur
halaman ini **11** (3.958 ha). Sisanya disisihkan, dan sebabnya bukan kerapian peta:
ke-32 DI itu tersebar dari Leuwigoong di utara sampai kaki Cikuray di selatan, sedangkan
jaringan yang dipetakan di repo ini cuma satu — D.I. Leuwigoong. DI yang berjarak 7 km
dari ruas terdekatnya dilayani jaringan **lain** yang tidak ada datanya di sini, jadi
menghitungnya berdampingan menjanjikan hubungan yang tidak pernah ada di datanya.

Ambangnya **dilewati**, bukan **berdekatan** — panjang jaringan di dalam poligonnya
harus ≥ 50 m (`JARINGAN_MIN_M`). Bukan 0, karena garis batas dua DI kerap berimpit
dengan salurannya sendiri. Bedanya menentukan pada lima DI yang berada dalam 500 m tanpa
disentuh — salurannya menyusur tepi, bukan menembus:

| DI | luas | jarak ke jaringan | |
|---|---|---|---|
| DI Citameng I | 616 ha | dilewati 6,6 km | **diukur** |
| DI Cibuyutan Selatan | 266 ha | dilewati 4,2 km | **diukur** |
| … 9 DI lain | | dilewati 0,1–4,2 km | **diukur** |
| DI Badama | 427 ha | 70 m | disisihkan |
| DI Cimaragas | **801 ha** | 144 m | disisihkan |
| DI Cianten | 584 ha | 277 m | disisihkan |
| DI Cicapar | 294 ha | 322 m | disisihkan |
| DI Cidahu | 282 ha | 457 m | disisihkan |
| DI Cikamiri | 629 ha | 7.466 m | disisihkan |
| … 15 DI selatan lainnya | | 630 m – 18,5 km | disisihkan |

Yang disisihkan **tidak hilang dari peta**: lapisan `di_kab` di pemilih lapisan tetap
menggambar ke-32-nya sebagai konteks. Yang berubah cuma mana yang **diukur**. Baris
sumber menyebutkan penyisihannya di depan, bukan di ekor — pembaca yang tahu Garut punya
32 DI akan bertanya ke mana 21 sisanya pergi sebelum bertanya soal asal geometrinya.

Keputusannya dihitung `hitung-di-garut-air.py` (`ukur_jaringan()`) dan ditulis ke
`di_jalur.csv` untuk **seluruh** 32 DI, termasuk yang gugur — halaman perlu tahu berapa
yang disisihkan dan seluas apa, dan itu tidak bisa diketahui dari berkas yang cuma memuat
yang lolos. Skripnya juga berhenti menghitung air untuk DI yang gugur; `--semua`
mengembalikan ke-32-nya. Penyaringan di halaman dimatikan lewat satu tanda:

```python
LOKASI["di-garut"]["saring_jalur"] = False    # 32 DI lagi
```

Hasilnya cocok dengan pipeline jaringan yang berdiri sendiri: **1.194 l/detik** untuk
3.958 ha di sini, lawan **1.272 l/detik** untuk 4.244 ha di Bendung Copong — DR 0,302
lawan 0,300 l/detik/ha, berselisih 0,8 %.

Lokasi ini **tidak terkena sengketa** yang membuat petak baku Leuwigoong dibuang. Yang
dibuang di sana adalah `DI_Leuwigoong_Baku`, yang 46,8% petaknya bertindihan dengan
lapisan DI kewenangan kabupaten; lapisan DI kewenangan itu sendiri — yang dipakai di
sini — tidak bertindihan dengan siapa pun. Sengketanya soal petak baku mana yang benar,
bukan soal batas DI-nya.

#### Luas mana yang jadi dasar

Tiga luas dibawa berdampingan, dan bedanya penting:

| Medan | Arti | Dipakai untuk |
|---|---|---|
| `luas_ha` | **luas baku (CEA)** — angka yang *ditetapkan* Permen PUPR | dasar seluruh hitungan air |
| `luas_geom_ha` | luas hasil ukur poligonnya | pembanding |
| `luas_sawah_big_ha` | sawah BIG RBI 25K yang jatuh di dalamnya | pembanding |

`luas_ha` sengaja luas **baku**, kebalikan dari lokasi lain di halaman ini yang memakai
luas hasil ukur. Itu memang dasar yang dipakai KP-01 untuk merancang debit — Q = DR ×
luas layanan — dan memakainya menjamin `irigasi_m3 = irigasi_mm × luas_ha × 10` tetap
konsisten. Keduanya kebetulan hanya berselisih ~0,1% (mis. DI Badama 427 ha lawan
426,91 ha), tetapi selisih itu tetap ditampilkan, tidak disembunyikan.

#### mm berbeda antar-DI

Berbeda dengan SWH-JB-GRT, **mm di sini tidak seragam**: tiap DI mengambil iklimnya
sendiri di titik pusat wilayahnya. Dua akibatnya:

- `irigasi_mm` **ditawarkan** sebagai pewarna peta, karena petanya benar-benar
  menerangkan sesuatu — bukan rata satu warna seperti di SWH-JB-GRT.
- Semua medan mm pada ringkasan dirata-rata **ditimbang luas** (`_rata_bobot`), bukan
  diambil dari baris pertama. Mengambil baris pertama — cara yang benar di SWH-JB-GRT
  karena di sana mm memang seragam — di sini akan melaporkan angka satu DI sebagai
  angka seluruh kabupaten.

Susunan water loss pada ringkasan dihitung dari **jumlah m³**-nya, bukan dari rata-rata
persen tiap DI: DI Cikuray seluas 4 ha dan DI Cimaragas seluas 801 ha tidak boleh sama
beratnya dalam menjawab "ke mana air se-kabupaten ini pergi".

#### Waktu datang air per DI

ToT dihitung per **ruas** (lihat bagian Jaringan D.I. Leuwigoong), sedangkan yang ditanya
orang di peta "kapan air sampai di DI ini". Jembatannya irisan geometri — `tot_per_di()`
di `hitung-tot-jaringan.py` → `tot_di.csv`, dibaca lewat `KOLOM_TOT_DI`: ruas mana saja
yang melintasi poligon DI itu, lalu diambil yang **paling awal**.

Yang paling akhir ikut dibawa, dan itu bukan pelengkap. Selisih keduanya adalah **lama
satu DI terisi dari ujung ke ujung**, dan itulah yang menentukan berapa lama satu giliran
harus dibuka supaya seluruh hamparannya kebagian — bukan cuma ujung hulunya:

| Daerah Irigasi | masuk lewat | air datang | respons | terisi penuh | selisih |
|---|---|---:|---:|---:|---:|
| DI Ciojar | SI Copong | 2,7 j | 1,9 j | 12,7 j | **+10,1 j** |
| DI Cibuyutan Selatan | SI Copong Kiri | 4,3 j | 3,1 j | 20,6 j | **+16,3 j** |
| DI Citameng I | SI Copong Kanan | 12,7 j | 9,2 j | 15,1 j | +2,3 j |
| DI Cipacing | SS Cikarag | 25,3 j | 18,4 j | 26,1 j | +0,8 j |

DI Ciojar dan DI Citameng I sama-sama dilewati saluran induk, tetapi yang pertama perlu
**10 jam** untuk terisi ujung ke ujung dan yang kedua cukup 2,3 jam — perbedaan yang
tidak terbaca dari luas maupun dari waktu datangnya saja.

Angkanya muncul di **popup** DI (Air datang · Respons debit · Terisi penuh) dan lengkap
di kartu detail, kelompok **Waktu datang air dari bendung**.

Satu bug yang ditemukan lewat tabel ini: penjumlahan waktu sepanjang jalur dulu melewati
ruas yang tidak punya waktu, sehingga jalur yang **seluruh** ruasnya tanpa debit rancangan
memulangkan `sum([]) = 0` — DI Citameng III dan IV melaporkan "air datang 0 menit", nol
yang terbaca persis seperti hasil. Sekarang satu mata rantai yang tidak diketahui membuat
seluruh kumulatifnya kosong: waktu tempuh rantai memang tidak bisa dihitung kalau ada
ruas yang tidak diketahui.

#### Peringatan cakupan

Kartu ringkasan menyandingkan **luas** dan **angka air**, dan keduanya bisa beda cakupan:
luas dijumlahkan dari geometri (selalu 32 DI), angka air dari
`kebutuhan_air_di.csv` (sebanyak DI yang benar-benar dihitung). `hitung-di-garut-air.py`
bisa dijalankan untuk sebagian DI saja lewat `--uji N`, dan DI yang cuacanya tidak
terambil sengaja dilewati tanpa diisi angka DI lain.

Itu pernah terjadi tanpa disadari: keluaran `--uji 2` tertinggal di cakram, dan kartunya
menulis **"Luas 11.129,00 ha"** (32 DI) tepat di atas **"Kebutuhan air 3,24 jt m³"**
(2 DI, 1.430 ha) — dua angka yang benar sendiri-sendiri dan sama sekali salah kalau dibaca
berpasangan. Satu-satunya cara menemukannya adalah kebetulan mengklik satu DI dan melihat
"belum dihitung". Angka yang benar untuk 32 DI ternyata **26,02 jt m³**, delapan kali
lipat.

Sekarang `muat()` ikut mengirim `n_petak_air` dan `luas_air_ha`, dan `tulisCakupan()`
menuliskan peringatan di dalam kartu begitu keduanya lebih kecil daripada yang digambar.
Skripnya juga mencetak peringatan besar tiap kali `--uji` menimpa keluaran penuh —
peringatan di situ muncul pada orang yang sedang menimpanya, jauh lebih awal.

Popup objek yang tidak kebagian hitungan juga tidak lagi menulis *"Lokasi ini baru
dianalisa terrain & luas"* — kalimat itu benar untuk lokasi yang memang belum pernah
dihitung airnya, tetapi menyesatkan untuk satu DI yang cuma belum kebagian giliran.
Sekarang ia menyebut skrip mana yang harus dijalankan.

#### Kartu per lahan

Daftar di samping berubah bentuk kalau objeknya punya angka air: dari baris setinggi
24 px jadi **kartu** berisi luas, kebutuhan air (m³, mm, l/detik), water loss (m³ beserta
persennya terhadap air masuk), dan bilah susunan kehilangan. Satu baris cukup selama yang
dibandingkan hanya luas; begitu ada dua besaran air beserta susunannya, membacanya berarti
mengklik satu per satu lalu mengingat-ingat angka yang barusan hilang dari layar.

Bentuk ringkasnya tidak dibuang — objek tanpa angka air, termasuk batas blok, tetap
memakainya (`barisRingkas()`). Mengklik petak di peta ikut **menggulirkan kartunya ke
dalam pandangan**; tanpa itu penyorotannya jatuh di luar layar dan tidak pernah dilihat.

### Leuwigoong

**Lokasi ini tidak punya petak, dan itu disengaja** (`sumber_petak: None`). Yang tersaji
hanya lapisan letak SISDA — jaringan, bangunan, sungai, kewenangan — di atas citra.

Petak baku D.I. Leuwigoong (`DI_Leuwigoong_Baku`, 886 petak / 5.047,7 ha) sempat dipakai
sebagai subjek halaman, lalu **dibuang 13 Agustus 2026** karena bentrok dengan lapisan DI
kewenangan kabupaten **dari layanan yang sama**:

> **415 dari 886 petak — 2.330 ha dari 5.047 ha, 46,8% — pusatnya jatuh di dalam poligon
> `DI_Kewenangan_Kabupaten_Garut`.** Terbanyak di DI Citameng IV (70 petak), DI Cibuyutan
> Utara (68), DI Citameng I (64), DI Cipacing (51), DI Parigi (43).

Secara irigasi itu mustahil: satu hamparan dilayani satu jaringan, di bawah satu
kewenangan. Salah satu dari dua lapisan itu keliru, dan SISDA sendiri belum
menyelesaikannya — jadi memilih salah satunya berarti kita yang memutuskan siapa yang
benar tanpa dasar. Uji tumpang tindihnya memakai titik-dalam-poligon pada pusat tiap
petak, bukan tumpang tindih kotak pembatas.

Karena itu **lapisan `gc_petak` juga tidak dipasang** di daftar tema SISDA — bukan sekadar
dimatikan. Selama sumbernya belum menyelesaikan konflik itu, memasangnya cuma memindahkan
pertanggungan jawab ke pembaca peta.

**Yang ikut hilang dari halaman**, dan itu memang konsekuensinya: kartu Luas, pemilih
Warna peta, legenda skala, kartu detail petak, dan Unduh KML. Semuanya disembunyikan
`pasangTanpaPetak()` — kendali kosong terbaca seperti gagal memuat, padahal keadaannya
memang tidak ada yang bisa diisi.

Kartu daftar **tidak** ikut disembunyikan; ia **dialihkan ke daftar Daerah Irigasi**
(`gambarDaftarDi()`): 22 DI kewenangan Kab. Garut yang menyentuh kotak AOI, beserta luas
bakunya, terurut dari yang terluas — DI Cimaragas 801 ha, DI Citameng I 616 ha, DI Cianten
584 ha, … DI Cisalak 70 ha; total 7.652 ha. Mengklik satu baris mengarahkan peta ke DI itu
dan membuka popupnya, **menyalakan dulu lapisannya kalau sedang dimatikan** — kalau tidak,
peta bergeser ke tempat yang benar tetapi tidak ada apa pun yang tergambar di sana.

Yang didaftar hanya yang menyentuh AOI: 32 DI se-Kabupaten Garut tidak menerangkan apa pun
soal lokasi ini, dan mendaftar semuanya justru mengubur yang relevan.

Kotak AOI-nya jadi tetap — `[107.8886, -7.2165, 108.0825, -7.0021]`, extent D.I.
Leuwigoong + 0,03° konteks, diukur dari `DI_Leuwigoong_Baku` sebelum lapisan itu dibuang.
Tidak ada lagi geometri petak untuk menurunkannya. `muat()` ikut mengirim `kotak` supaya
halaman tetap bisa mengarahkan peta — tanpa itu petanya tidak tahu harus melihat ke mana.

Sumber `"big"` masih terpasang di kode (`_muat_leuwigoong_big()`, `_petak_big()`) kalau
suatu saat perlu blok tutupan lahan RBI 25K sebagai subjek: 42 blok, 4.221,71 ha, dipotong
ke kotak persegi. Mengubah `sumber_petak` ke `"big"` cukup untuk mengembalikannya.

### Lokasi beku

Semua angka **dibaca** dari keluaran notebook — tidak ada yang dihitung ulang di web,
tidak ada nilai contoh. Keduanya punya luas, kebutuhan air, dan water loss per petak dengan pilihan rezim
**FL** (genangan) dan **SRI** (intermiten). Dua hal yang perlu diketahui saat
membandingkan keduanya:

- **SWH-011 memakai cuaca buatan**, SWH-JB-GRT memakai cuaca nyata. Angka mm kedua
  lokasi karena itu tidak sebanding.
- **Di SWH-JB-GRT, mm sama untuk semua petak** — sifat tanah (perkolasi) belum diukur,
  jadi yang membedakan petak hanya luasnya. Karena itu peta lokasi ini diwarnai
  berdasarkan **m³**, bukan mm: mm akan rata satu warna dan menyesatkan.

Kalau `kebutuhan_air_petak.csv` belum ada (notebook air belum dijalankan), API mengirim
medan airnya kosong dan halaman menampilkan **"belum dihitung"** — bukan nol, supaya
tidak terbaca seperti hasil.

### Water loss dan persennya

Water loss = air yang keluar petak lewat tiga jalan, dan halaman menampilkannya dalam
m³ **beserta persennya**, di tiga tempat: kartu di dalam peta, popup petak, dan kartu
detail. Dua macam persen yang ditampilkan menjawab pertanyaan berbeda:

- **persen susunan** (menguap / meresap / mengalir keluar) — di mana air pergi;
- **persen terhadap air masuk** — seberapa ketat neracanya; bisa melebihi 100 % kalau
  petak berakhir lebih kering daripada awalnya.

## Ekspor KML

Tombol **Unduh KML** di bilah atas mengambil `/api/lokasi/<lokasi>.kml` — objek yang
sama dengan yang tergambar, angka yang sama, dan pewarnaan yang sama (termasuk skala
logaritmiknya), jadi berkasnya terlihat serupa saat dibuka di Google Earth atau QGIS.
Rezim yang sedang dipilih ikut terbawa lewat `?rezim=`.

```bash
curl -O -J http://127.0.0.1:5000/api/lokasi/swh-jb-grt.kml
```

Tombolnya **disembunyikan** untuk lokasi yang tidak punya objek terukur — tidak ada
yang bisa diekspor dari sana.

Tiap objek jadi satu `Placemark`: namanya id petak (`P-001` dan seterusnya), keterangannya tabel
berisi luas, keliling, jenis sawah, dan — untuk lokasi yang punya — angka air. Lubang
di dalam poligon ikut terbawa sebagai `innerBoundaryIs`, jadi luas yang terbaca di
Google Earth cocok dengan yang di halaman.

## Peta dasar dan lapisan luar

Pemilih di sudut kanan-atas peta **sekaligus legenda**. Tiga hal yang dibawanya masing-
masing menjawab satu kekeliruan baca yang berbeda:

- **Contoh warna** per lapisan, bentuknya mengikuti bentuk objeknya di peta — bidang,
  garis, atau titik. Bentuk itu **diturunkan dari geometri fitur pertamanya**, bukan
  didaftar di suatu tabel: satu daftar lagi yang harus ikut diperbarui tiap menambah
  lapisan adalah satu daftar lagi yang bisa lupa diperbarui.
- **Satuan objek** di sebelah angkanya. "22 DI di sini" berarti dua puluh dua daerah
  irigasi **utuh**, sedangkan "176 ruas" berarti 176 penggal saluran. Tanpa satuan,
  dua angka itu terbaca setara padahal beda tingkat sama sekali.
- **Pengelompokan menurut asal data**, bukan menurut jenis objek — asal itulah yang
  menentukan seberapa jauh angkanya boleh dipercaya. Dua lapisan yang mirip di peta bisa
  datang dari dua lembaga dengan cara kerja yang sama sekali berbeda.

Kalau lokasinya punya objek terukur, di paling atas muncul **baris subjek** — objek yang
diukur halaman ini. Tanpa baris itu warnanya jadi satu-satunya warna di peta yang tidak
diterangkan di mana pun. Contoh warnanya berupa **pita**, bukan satu kotak, karena warna
subjek bergerak mengikuti metrik yang dipilih; pitanya diisi dari JS, bukan dipatok di
CSS, karena skalanya berganti antara subjek berbidang dan bergaris. Lokasi tanpa petak —
seperti `Leuwigoong` sekarang — tidak menampilkan baris itu sama sekali.

Baris itu **punya kotak centang**, jadi isian petak/DI bisa dimatikan. Dulu sengaja tidak,
dengan alasan "ia bukan lapisan tambahan, ia isi halamannya" — alasan yang benar soal
kedudukannya tetapi salah soal akibatnya: isian biru menutupi citra satelit **dan lapisan
jaringan di bawahnya**, dan tanpa saklar tidak ada cara melihat apa yang ditutupinya.
Legendanya ikut mati saat subjeknya dimatikan; pita warna yang tidak mewakili apa pun di
peta lebih menyesatkan daripada tidak ada legenda.

Barisnya **dipakai ulang, bukan dibangun ulang** oleh `rapikanKendali()`. Fungsi itu
berjalan sekali untuk **tiap** lapisan yang masuk/keluar peta — puluhan kali dalam satu
kali centang, karena satu lapisan petak membawa ratusan bentuk — dan mengganti unsur
kotak centangnya di tengah itu akan mencabut fokus dari tangan pengguna papan ketik yang
baru saja menekannya. Judul kelompoknya tetap dibangun ulang; ia tidak bisa difokus.
Barisnya dibuang hanya saat lokasi berganti (`buangBarisSubjek()`), karena nama, jumlah,
dan skala warnanya ikut berganti.

```
SUBJEK HALAMAN
  Yang diukur di halaman ini.
  ☑ ▬ Ruas saluran (berhitungan air)  176 ruas

SISDA CIMANUK-CISANGGARUNG
  Infrastruktur & kewenangan yang ditetapkan — lapisan letak, bukan ukur.
  ☑ ─ Jaringan irigasi               176 ruas
  ☑ ● Bangunan irigasi               289 bangunan
  ☐ ─ Sungai                          62 alur
  …
  ☑ ▢ DI kewenangan Kab. Garut        22 DI di sini

RUPABUMI INDONESIA (BIG)
  Tutupan lahan hasil penafsiran citra — pembanding.
  ☐ ▢ Sawah (BIG)                    269 objek · RBI 1:25.000
```

Panelnya **terbuka sejak halaman dibuka** — legenda yang harus disentuh dulu baru muncul
sama saja dengan tidak ada, warna di peta jadi tak diterangkan sampai seseorang kebetulan
menemukan ikonnya. Di bawah 900 px ia dilipat, karena di situ peta sendiri sudah tidak
punya ruang sisa. Ukurannya ~295 × 415 px, dan keterangan tiap kelompok dijaga muat satu
baris supaya tidak memakan peta.

Tombol **×** di sudut kanan-atasnya menutup panel itu di lebar berapa pun. Sebelumnya
tidak ada: panel dipaksa terbuka di layar lebar, jadi satu-satunya cara melihat peta di
baliknya adalah menyempitkan jendela. Sesudah ditutup, panelnya kembali ke perangai
bawaan Leaflet — menyembul saat disentuh kursor, melipat lagi saat ditinggalkan;
menekan ikonnya membukanya untuk seterusnya lagi. Keadaan "ditutup pengguna" disimpan
terpisah dari "dilipat karena layar sempit" (`panelDitutup` lawan `mqSempit`): yang satu
keadaan yang dipilih, yang satu keadaan yang dipaksa.

Kartu ringkasan di sudut kiri-atas juga punya tombol **×**-nya sendiri. Saat
disembunyikan, tempatnya diambil tombol pil bernama lokasi yang sedang dibuka — bukan
ikon tanpa nama, karena satu-satunya cara tahu apa yang akan muncul dari ikon tanpa nama
adalah menekannya.

Ambang 900 px itu **diikuti terus**, lewat `matchMedia`, bukan dibaca sekali dari
`innerWidth` saat memuat. Ukuran jendela berubah sesudah halaman jadi — tablet diputar,
jendela diseret, panel peramban dibuka — dan pembacaan sekali membuat kedua arahnya salah:
yang dimuat lebar lalu disempitkan menutup **47 %** peta, yang dimuat sempit lalu
dilebarkan menyembunyikan legendanya di layar selebar apa pun.

Kendalinya dibuat `collapsed: true` supaya Leaflet ikut memasang pengendali lipatnya —
tombol buka, tutup saat kursor pergi, tutup saat peta diklik. Tanpa itu panel yang terbuka
di ponsel tidak punya jalan untuk ditutup lagi. Yang ditahan hanya penutupan **otomatis**
selama layar masih lebar, dengan mengganti `collapse()` pada instansnya. Dua hal yang
menentukan di situ:

- penggantinya dipasang **sebelum** `addTo()` — `_initLayout` menyimpan rujukan ke
  `this.collapse` saat itu juga, jadi pengganti yang dipasang sesudahnya tidak akan
  pernah terpakai oleh penangan `mouseleave` dan klik-peta;
- ditahan di JS, bukan lewat CSS — kelas `-expanded` membawa serta latar dan padding
  panelnya, jadi menahan tampilannya saja akan menyisakan daftar tanpa alas.

Judul kelompok dan baris subjek disisipkan `rapikanKendali()` ke dalam kendali bawaan
Leaflet sesudah lapisannya terpasang; fungsinya aman dipanggil berkali-kali karena judul
kelompoknya dibuang dulu tiap kali dan baris subjeknya dipakai ulang (lihat di atas).

Kendali Leaflet **membangun ulang seluruh daftarnya** tiap kali ada lapisan masuk/keluar
peta di luar klik kotak centang, dan pembangunan ulang itu membuang sisipan tadi. Karena
menambalnya di tiap tempat yang menambahkan lapisan pasti terlewat cepat atau lambat,
pemulihannya digantung langsung di kejadiannya: `peta.on("layeradd layerremove",
rapikanKendali)`. Kendali sudah terdaftar lebih dulu, jadi `_update()` miliknya selesai
sebelum pemulihan berjalan. Urutan **antar**-kelompok ditata, urutan **di
dalam** kelompok dibiarkan apa adanya — itu urutan tema di `data.py`, dan `sort` JS
stabil sehingga tidak teracak oleh lomba antara `muatBig()` dan `muatDi()`.

Rutenya:

| Pilihan | Rute | Cache |
|---|---|---|
| Citra satelit (Esri) | `/api/tile/<z>/<x>/<y>.jpg` | `note/output/tiles/` |
| Rupabumi (BIG) | `/api/tile-rbi/<z>/<x>/<y>.png` | `note/output/tiles-rbi/` |
| Sungai & saluran irigasi (BIG) | `/api/big/<lokasi>` | `note/output/big/` |
| SISDA Cimanuk-Cisanggarung | `/api/di/<lokasi>` | `note/output/di/` + `data/DI_*.geojson` |

Cache ubin BIG berhenti di zoom 18; di atas itu ubin z18 diperbesar.

Lapisan pembanding BIG memilih **seri skala paling rinci yang benar-benar punya fitur**
di AOI, lalu berhenti — RBI terbit per seri (5K, 10K, 25K, …) dan satu wilayah umumnya
hanya terliput satu seri, jadi menggambar semuanya akan menghasilkan garis ganda.
Seri yang terpakai ditulis di baris sumber. Tema yang kosong tetap muncul di pemilih
dengan keterangan **"tidak ada"** — bukan disembunyikan, supaya jelas bahwa BIG sudah
ditanya dan memang tidak punya, bukan bahwa lapisannya lupa dipasang.

Untuk lokasi yang petaknya sudah berasal dari lapisan sawah BIG, tema sawah tidak
ditawarkan lagi — poligonnya akan tergambar dua kali di atas dirinya sendiri.

#### Pembanding BIG dibekukan

Tema `sungai` dan `irigasi` pada `BIG_TEMA` diberi `tampil: False` sejak lapisan SISDA
masuk — SISDA memuat keduanya jauh lebih lengkap di wilayah ini, dan saluran irigasi
bahkan **kosong sama sekali** di RBI 25K sementara SISDA punya 113 ruas. Idiomnya sama
dengan `tampil` pada `LOKASI`: temanya hilang dari pemilih peta sementara id lapisan,
cache, dan pemuatnya tetap utuh.

```python
BIG_TEMA[1]["tampil"] = True      # pembanding sungai BIG muncul lagi
```

Tema `sawah` **tidak** ikut dibekukan: ia bukan sekadar pembanding — `_petak_big()`
memakainya sebagai geometri pokok lokasi Leuwigoong. Peta dasar Rupabumi (BIG) juga
tetap ada; yang dibekukan cuma lapisan pembandingnya.

### SISDA Cimanuk-Cisanggarung

GeoServer WFS milik BBWS Cimanuk-Cisanggarung (`geo.sisdacimancis.id`, workspace
`geocimancis`): **99 lapisan, 30 di antaranya punya fitur di AOI Leuwigoong**. Wataknya
beda dengan BIG — BIG memetakan **tutupan lahan** hasil penafsiran citra, SISDA
memetakan **infrastruktur dan kewenangan yang ditetapkan**. Bedanya terasa langsung:
saluran irigasi yang di RBI 25K terbaca "tidak ada", di sini berjumlah 113 ruas.

Semuanya lapisan **letak**, bukan lapisan ukur — yang dijawabnya "petak ini masuk DI
apa, salurannya yang mana". Tidak ada satu pun angka halaman yang diambil darinya.
`Luas baku (CEA)` dan `Luas` petak baku adalah luas **tetapan**, bukan luas sawah hasil
ukur; keduanya gampang tertukar, jadi bedanya ditulis di popup dan baris sumber.

| Tema | Lapisan WFS | Lingkup | Panel | n di AOI |
|---|---|---|---|---|
| Jaringan irigasi | `DI_Leuwigoong_Jaringan` | AOI | atas | 176 |
| Bangunan irigasi | `DI_Leuwigoong_Bangunan` | AOI | atas | 289 |
| Sungai | `sungai_orde_ln_sinkronisasi` | AOI | atas | 62 |
| Sempadan sungai | `Sempadan_Sungai_2023` | AOI | bawah | 1 |
| Mata air | `mata_air` | AOI | atas | 42 |
| Situ | `situ` | AOI | atas | 6 |
| DI kewenangan Kab. Garut | `DI_Kewenangan_Kabupaten_Garut` | kabupaten | bawah | 22 dari 32 |
| DI kewenangan Provinsi | `DI_Kewenangan_Provinsi` | kabupaten | bawah | 2 dari 2 |

Tema **petak baku** (`DI_<x>_Baku`) sengaja tidak ada di daftar ini — lihat bagian
**Leuwigoong** di atas untuk alasannya.

Lokasi menyalakannya lewat dua kunci di `data.py`, masing-masing membawa rombongan
temanya sendiri:

```python
LOKASI["leuwigoong"]["kabupaten"] = "Garut"        # batas DI kewenangan (GC_KABUPATEN)
LOKASI["leuwigoong"]["di_sisda"] = "Leuwigoong"    # jaringan, bangunan, petak (GC_DI_SISDA)
```

**Lingkup** menentukan cara pengambilannya, dan itu mengikuti peran lapisannya. Yang
`aoi` ditanyakan dengan saringan kotak, karena lapisannya se-wilayah sungai dan yang
berguna cuma sekitar lokasi. Yang `kabupaten` diunduh utuh, karena justru tetangga di
luar AOI yang jadi isinya — ia menjawab "AOI ini ada di DI sebelah mana".

**Panel** memisahkan wilayah dari garis. Batas DI, petak baku, dan sempadan masuk panel
`di` (z-index 330, di bawah semuanya): ia wadah, bukan isi. Saluran, bangunan, sungai,
mata air, dan situ masuk panel `di-atas` (450, **di atas** petak) — kalau di bawah, ia
tenggelam di balik isian petak, padahal lapisan itulah yang paling ditunggu.

`Baku`, `Fungsional`, dan `Potensial` sudah diperiksa dan isinya **persis sama** di AOI
ini: 823 poligon, 3.326,9 ha, sidik jari geometri identik. Semestinya ketiganya berbeda
(luas baku ≠ luas fungsional), jadi yang dipasang **hanya `Baku`** — memasang ketiganya
cuma menggambar satu data tiga kali dengan tiga nama yang menjanjikan tiga hal berbeda.

DI kewenangan yang **menyentuh kotak AOI** digambar bergaris tebal dan berisi tipis;
sisanya bergaris putus-putus tanpa isian — ia cuma penunjuk letak. Bedanya juga dibawa
ke ukuran data: yang kena AOI disederhanakan pada toleransi ~5,5 m karena dibaca
berdampingan dengan petak pada zoom besar, sisanya ~22 m. Bersama pembulatan 6 desimal,
321.000 simpul mentah turun jadi ~50.000 (7,6 MB → ~1 MB) tanpa memindahkan garis
sejauh ketebalan garisnya sendiri di layar — batas DI diterbitkan pada skala kabupaten,
ketelitiannya sendiri ada di orde puluhan meter. Seluruh muatan SISDA satu lokasi
~1,7 MB untuk 1.210 objek.

Nama kolom tiap lapisan berhenti di `data.py`: `_rincian()` membakukan properti WFS jadi
daftar `[label, nilai]` yang siap ditulis, lengkap dengan satuan dan angka gaya Indonesia.
`app.js` cuma menuliskan apa yang diterimanya, jadi menambah lapisan tidak perlu menyentuh
halaman — kecuali kalau ia butuh catatan penutup popup sendiri (`CATATAN_GC`).

Kena-tidaknya AOI dihitung dengan **pemotongan geometri sungguhan** (Sutherland-Hodgman,
`_potong_geom`), bukan tumpang tindih kotak-lawan-kotak: DI berbentuk memanjang mengikuti
saluran, jadi kotak pembatasnya kerap menyentuh AOI padahal wilayahnya tidak.

Unduhan mentah lapisan berlingkup kabupaten disimpan utuh — belum disederhanakan, belum
disaring — di `data/<nama-lapisan>.geojson`, jadi berkasnya bisa langsung dibuka di QGIS.
Yang dipangkas hanya salinan yang dikirim ke peramban. Lapisan berlingkup AOI tidak ikut
disimpan begitu: ia sudah kecil, dan simpanannya cukup di `note/output/di/<lokasi>.json`.

## Koordinat titik yang diklik

Klik di mana pun pada peta memunculkan kotak koordinat di sudut kiri-bawah — untuk
dicocokkan dengan sumber lain (Google Earth, QGIS, GPS lapangan). Isinya:

- **`-7.133341, 107.906683`** — desimal, urutan lintang-bujur. Sengaja ditulis
  **bertitik desimal**, bukan gaya angka Indonesia yang dipakai di seluruh halaman ini:
  angka ini bukan untuk dibaca melainkan untuk **ditempel** ke aplikasi lain, dan koma
  desimal di situ akan terbaca sebagai pemisah dua bilangan.
- **`7°08'00.0"S 107°54'24.1"E`** — DMS, berdampingan bukan menggantikan. Peta dan
  berkas memakai desimal, sementara patok lapangan dan dokumen resmi masih banyak yang
  tertulis DMS.
- Tombol **Salin**, dan penanda di peta pada titik itu. `Esc` atau tombol `×`
  menghapusnya.

Dua hal yang perlu diketahui soal cara kerjanya:

**Klik pada objek ikut tercatat.** Leaflet menjadikan peta sebagai sasaran kejadian
hanya kalau **tidak ada lapisan di bawah kursor** (`Map._findEventTargets`:
`if (!targets.length) targets = [this]`). Dengan peta yang tertutup poligon DI dan garis
jaringan, sebagian besar klik karena itu tidak pernah sampai ke peta. Karena itu
`catatKlik()` dipasang juga ke tiap kelompok lapisan — kalau tidak, pembacaannya diam di
tempat persis ketika paling dibutuhkan, yaitu saat menunjuk objek tertentu. Klik pada
poligon tetap membuka popupnya seperti biasa: satu klik menjawab dua hal sekaligus,
objek apa ini dan di koordinat mana.

**Menyalin tidak memakai `navigator.clipboard` sebagai satu-satunya jalan.** API itu
hanya ada di konteks aman, sedangkan halaman ini justru dipakai lewat **http** di alamat
jaringan setempat — di situ ia tidak tersedia sama sekali. `document.execCommand("copy")`
dipakai sebagai cadangan, dan kalau keduanya gagal tombolnya menulis **"Gagal — salin
manual"** apa adanya; angkanya ber-`user-select: all` sehingga sekali klik menyorot
seluruhnya. "Tersalin" yang bohong lebih buruk daripada tidak ada tombolnya.

## Peta tanpa jaringan

Ubin dilayani dari cache lebih dulu. Kalau belum ada, sekali diunduh lalu ikut
disimpan ke cache yang sama. Tanpa jaringan, latar petanya kosong tetapi poligon,
kartu, dan semua angka tetap tampil.

Lapisan BIG dan SISDA juga dibaca dari simpanannya lebih dulu; kalau layanannya tak
terjangkau dan simpanan belum ada, temanya dikirim kosong **beserta alasannya**, dan
halaman menuliskan alasan itu apa adanya. Menyegarkan simpanan: `?segar=1` pada
`/api/big/` atau `/api/di/` — untuk SISDA, `?segar=1` mengunduh ulang WFS-nya juga, bukan
cuma menyusun ulang dari `data/DI_*.geojson`.

Yang ditelan jadi `galat` hanya galat **jaringan** dan balasan cacat (`URLError`, `OSError`,
`TimeoutError`, `JSONDecodeError`). `ValueError` tidak ditangkap seluruhnya: kalau iya,
salah tulis di kode sendiri ikut terbaca "layanan tidak terjangkau" — dan halaman menuduh
SISDA atas kesalahan sendiri.

Semua cache unduhan ada di `.gitignore` — isinya bisa dibangun ulang kapan saja dari
layanan aslinya dan ukurannya besar (unduhan WFS SISDA saja ~16 MB).

Lokasi `Leuwigoong` adalah pengecualian — geometrinya sendiri datang dari layanan luar,
jadi pengambilan pertama harus berhasil sekali. Sesudah tersimpan
(`note/output/di/leuwigoong_petak.json` untuk sumber `"sisda"`,
`note/output/big/leuwigoong_petak.json` untuk `"big"`), ia jalan tanpa jaringan seperti
yang lain.
