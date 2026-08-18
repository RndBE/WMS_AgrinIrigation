# -*- coding: utf-8 -*-
"""Kebutuhan air irigasi per RUAS jaringan — D.I. Leuwigoong, hulu di Bendung Copong.

Jalankan:
    python note/hitung-jaringan-air.py            # seluruh jaringan
    python note/hitung-jaringan-air.py --uji      # tanpa unduh cuaca baru, untuk
                                                  # memeriksa graf & alokasi saja

Keluarannya CSV + GeoJSON di `note/output-jaringan-air/`, dibaca web-app apa adanya.
Metodenya dari `note/air_kp01.py`, modul yang sama dengan pipeline DI dan kecamatan,
jadi angkanya sebanding lurus.

Yang membedakan pipeline ini dari `hitung-di-garut-air.py`: di sana objeknya HAMPARAN
dan pertanyaannya "berapa air yang dipakai wilayah ini". Di sini objeknya SALURAN dan
pertanyaannya "berapa air yang harus LEWAT ruas ini" - dua angka yang berbeda, karena
satu ruas primer membawa air untuk seluruh hamparan di hilirnya, bukan cuma untuk lahan
yang kebetulan ada di sebelahnya.

Tiga langkah yang menjawab itu:

  1. GRAF. 176 ruas SISDA sebenarnya 837 penggal terpisah. Penggalnya disambungkan
     kalau ujung yang satu jatuh dalam 10 m dari simpul mana pun milik yang lain -
     bukan ujung-ke-ujung saja, karena tersier menempel di TENGAH sekunder, bukan di
     ujungnya. Arah alirnya ditetapkan dengan penelusuran lebar-dulu dari Bendung
     Copong: apa pun yang lebih jauh dari bendung berada di hilir.

  2. LAYANAN. Sawah BIG dipecah jadi sel 100 m, lalu tiap sel diberikan ke saluran
     TERSIER terdekat sejauh masih di dalam 750 m. Tersier yang dipilih karena di KP-01
     lahan memang dilayani pada tingkat itu; primer dan sekunder tidak diberi lahan
     sendiri, ia menerima beban dari tersier di hilirnya. Sel yang tidak punya tersier
     terpetakan sedekat itu TIDAK dititipkan ke saluran mana pun - luasnya dilaporkan
     terpisah sebagai sawah di luar jangkauan jaringan ini.

  3. AKUMULASI. Beban tiap penggal dijumlahkan dari hilir ke hulu, lalu dibagi efisiensi
     KUMULATIF menurut tingkat salurannya - 0,90 di tersier, 0,90x0,90 di sekunder,
     0,90x0,90x0,80 di primer. Itu sebabnya debit satu ruas primer di sini lebih besar
     daripada jumlah kebutuhan lahan di hilirnya: yang dihitung debit di HULU ruas,
     sudah termasuk air yang hilang di sepanjang jalan turunnya.

Yang TIDAK dijawab pipeline ini, dan sengaja: apakah salurannya sanggup membawa debit
itu. Penampang, kemiringan dasar, dan kekasaran saluran tidak ada di data SISDA, jadi
"debit yang dibutuhkan" di sini tidak pernah dibandingkan dengan "debit yang muat".
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
from collections import deque
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import LineString, Point, shape
from shapely.strtree import STRtree

AKAR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AKAR / "web-app"))
import data as wd                      # pembaca BIG yang sudah ada, bukan salinan baru

from air_kp01 import (                                              # noqa: E402
    EFISIENSI_IRIGASI, HARI_MUSIM, LAMA_SIAP_LAHAN, NB, PERKOLASI_MM, REZIM,
    TAHUN_AKHIR, TAHUN_AWAL, WLR_MM,
    cuaca_titik as _cuaca_titik, kebutuhan_siap_lahan, ke_l_detik_ha,
    luas_ha as _luas_ha, neraca_musim, ringkas_musim, slug,
)

SUMBER_JARINGAN = AKAR / "data" / "DI_Leuwigoong_Jaringan.geojson"
SUMBER_BANGUNAN = AKAR / "data" / "DI_Leuwigoong_Bangunan.geojson"
KELUARAN = AKAR / "note" / "output-jaringan-air"
CUACA_DIR = KELUARAN / "cuaca"

# 612 = Agrikultur Sawah seri 25K - seri yang sama dengan pipeline DI dan kecamatan,
# supaya luas sawah di ketiganya berasal dari sumber yang sama persis.
LAPISAN_SAWAH_BIG = 612
NAMA_BENDUNG = "Bendung Copong"

# Dua penggal dianggap bersambung kalau ujung yang satu berada dalam jarak ini dari
# simpul mana pun milik yang lain. 10 m dipilih dari pengukuran, bukan ditebak: pada
# 5 m graf terbesar cuma memuat 58% panjang jaringan, pada 10 m sudah 91%, dan
# menaikkannya ke 30 m hanya menambah 3% lagi sambil mulai menyambungkan saluran yang
# kebetulan bersisian tanpa benar-benar bertemu.
TOLERANSI_SAMBUNG_M = 10.0
# Sel penaksir layanan. Blok sawah RBI 25K di sini bermedian 10 ha tetapi yang terbesar
# 3.108 ha - satu poligon yang membentang melewati puluhan saluran sekaligus. Memberikan
# blok sebesar itu utuh ke satu tersier menurut titik wakilnya akan menaruh 3.108 ha di
# satu ruas dan mengosongkan tetangganya, jadi bloknya dipecah dulu.
SEL_M = 100.0
# Sejauh mana satu sel sawah masih masuk akal dilayani tersier terdekat.
#
# 750 m bukan tebakan: pada bentang ini luas sawah yang terjaring naik dari 4.638 ha
# (500 m) ke 5.501 ha (750 m) lalu 6.104 ha (1.000 m), sementara luas petak baku D.I.
# Leuwigoong yang tercatat 5.047 ha. Jadi 750 m adalah jangkauan yang memulangkan
# kembali kira-kira wilayah layanan DI-nya sendiri - bukan wilayah tetangganya yang
# kebetulan bersebelahan. Angka bandingannya ikut dicetak tiap kali skrip ini jalan
# supaya penyimpangannya kelihatan kalau datanya berubah.
SERVIS_MAKS_M = 750.0
LUAS_BAKU_DI_HA = 5047.0               # petak baku D.I. Leuwigoong (SISDA) - pembanding
TEPI_DERAJAT = 0.01                    # ~1,1 km di sekeliling jaringan, untuk sawah tepi

# Efisiensi per tingkat, KP-01. Hasil kali ketiganya harus sama dengan tetapan tunggal
# `EFISIENSI_IRIGASI` di air_kp01 - kalau tidak, debit di primer halaman ini dan debit
# di pipeline DI akan berbeda karena sebab yang tidak pernah tertulis di mana pun.
E_TERSIER, E_SEKUNDER, E_PRIMER = 0.90, 0.90, 0.80
E_KUMULATIF = {
    "Tersier": E_TERSIER,
    "Sekunder": E_TERSIER * E_SEKUNDER,
    "Primer": E_TERSIER * E_SEKUNDER * E_PRIMER,
    # Suplesi menambah air dari sumber lain ke jaringan yang sama; letaknya setara
    # saluran induk, jadi efisiensinya diperlakukan sama.
    "Suplesi": E_TERSIER * E_SEKUNDER * E_PRIMER,
}
assert abs(E_KUMULATIF["Primer"] - EFISIENSI_IRIGASI) < 0.01, (
    "efisiensi bertingkat di sini tidak sepadan dengan EFISIENSI_IRIGASI di air_kp01")


def cuaca_titik(lat, lon, nama, jeda=0.0):
    return _cuaca_titik(lat, lon, nama, CUACA_DIR, jeda, wd.BIG_UA["User-Agent"])


def berkas_cuaca(zona_kode: str) -> Path:
    """Letak simpanan cuaca satu zona - dipakai untuk memeriksa tanpa menyentuh jaringan."""
    return CUACA_DIR / f"{slug('zona-' + zona_kode)}.json"


def layanan_cuaca_siap() -> bool:
    """Sekali ketuk ringan untuk tahu layanan cuaca sedang membatasi laju atau tidak.

    Ada karena jatah Open-Meteo ditakar dari BANYAKNYA ANGKA, bukan banyaknya
    permintaan: satu permintaan di sini berisi 11 tahun x 7 peubah harian, jadi
    beberapa puluh zona sudah cukup untuk menghabiskannya. Begitu batas itu tersentuh,
    tiap zona berikutnya menempuh sembilan percobaan dengan tunggu berlipat - sekitar
    enam menit - hanya untuk gagal. Satu permintaan lima hari sebagai pengganti
    membuat seluruh sisanya diputuskan sekali, dalam hitungan detik.
    """
    url = ("https://archive-api.open-meteo.com/v1/archive?latitude=-7.10&longitude=107.95"
           "&start_date=2024-01-01&end_date=2024-01-05&daily=precipitation_sum"
           "&timezone=Asia%2FJakarta")
    try:
        urllib.request.urlopen(
            urllib.request.Request(url, headers=wd.BIG_UA), timeout=30)
        return True
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def jarak_km(a: dict, b: dict) -> float:
    """Jarak dua titik iklim, cukup dengan bidang datar - keduanya < 20 km terpisah."""
    return math.hypot((a["lon"] - b["lon"]) * 110.6, (a["lat"] - b["lat"]) * 110.9)


def luas_ha(geom):
    return _luas_ha(geom, wd._ukuran_geom)


def ringkas_plus(df):
    """`ringkas_musim` + tiga hitungan hari, persis seperti pipeline DI.

    Disalin, bukan diimpor dari sana, karena `hitung-di-garut-air.py` adalah skrip
    berdiri sendiri dengan `main()`-nya - mengimpornya berarti menjalankan argparse
    milik skrip lain.
    """
    r = ringkas_musim(df)
    tumbuh = df[df["tahap"] != "siap lahan"]
    r["hari_diairi"] = int((df["irigasi"] > 0).sum())
    r["hari_limpas"] = int((df["limpasan"] > 0).sum())
    r["hari_kering"] = int((tumbuh["tma"] < 0).sum())
    return r


# ======================================================================== geometri
class Bidang:
    """Bidang datar setempat: derajat -> meter, supaya jarak bisa dihitung apa adanya.

    Semua urusan jarak di skrip ini - menyambung penggal, mencari tersier terdekat -
    dikerjakan di bidang ini. Menghitungnya langsung pada derajat akan membuat "10 m"
    berarti dua panjang yang berbeda pada sumbu bujur dan sumbu lintang.
    """

    def __init__(self, lat0: float, lon0: float):
        phi = math.radians(lat0)
        self.lat0, self.lon0 = lat0, lon0
        self.m_lat = 111_132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
        self.m_lon = 111_412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)

    def titik(self, p):
        return ((p[0] - self.lon0) * self.m_lon, (p[1] - self.lat0) * self.m_lat)

    def garis(self, simpul):
        return [self.titik(p) for p in simpul]

    def bentuk(self, geom):
        """Satu geometri shapely, dipindah utuh ke bidang meter."""
        return shapely.transform(geom, lambda c: np.column_stack([
            (c[:, 0] - self.lon0) * self.m_lon, (c[:, 1] - self.lat0) * self.m_lat]))

    def balik(self, x, y):
        """Meter -> (bujur, lintang). Untuk menuliskan kembali titik iklim tiap zona."""
        return (self.lon0 + x / self.m_lon, self.lat0 + y / self.m_lat)


def panjang_m(simpul_m) -> float:
    return sum(math.dist(a, b) for a, b in zip(simpul_m, simpul_m[1:]))


# ==================================================================== baca jaringan
def baca_ruas() -> list[dict]:
    """176 ruas SISDA. Namanya dibuat tunggal supaya bisa jadi kunci di halaman."""
    fitur = json.loads(SUMBER_JARINGAN.read_text(encoding="utf-8"))["features"]
    ruas, terpakai = [], {}
    for i, f in enumerate(fitur):
        p = f.get("properties") or {}
        g = f.get("geometry") or {}
        isi = g.get("coordinates") or []
        bagian = [s for s in (isi if g.get("type") == "MultiLineString" else [isi])
                  if len(s) >= 2]
        if not bagian:
            continue
        jenis = (p.get("jenis") or "Tersier").strip()
        nama = (p.get("nama") or "").strip() or None
        # Nama ruas di SISDA tidak tunggal - "CP.Ka.12.Ki" muncul dua kali, dan 13 ruas
        # tidak bernama sama sekali. Halaman memakai id ini sebagai kunci lapisan, jadi
        # kembarannya diberi nomor urut dan yang kosong diberi kodenya.
        dasar = nama or f"Ruas tanpa nama R{i:03d}"
        n = terpakai.get(dasar, 0) + 1
        terpakai[dasar] = n
        ruas.append({
            "kode": f"R{i:03d}",
            "id": dasar if n == 1 else f"{dasar} ({n})",
            "nama": nama, "jenis": jenis, "bagian": bagian, "geometry": g,
        })
    return ruas


def titik_bendung() -> tuple[float, float]:
    """Letak Bendung Copong - titik masuk air ke seluruh jaringan."""
    fitur = json.loads(SUMBER_BANGUNAN.read_text(encoding="utf-8"))["features"]
    for f in fitur:
        if (f["properties"].get("name") or "").strip() == NAMA_BENDUNG:
            lon, lat = f["geometry"]["coordinates"][:2]
            return float(lon), float(lat)
    raise SystemExit(f"'{NAMA_BENDUNG}' tidak ada di {SUMBER_BANGUNAN.name}")


# ========================================================================= graf
def bangun_graf(ruas: list[dict], bidang: Bidang) -> tuple[list[dict], dict]:
    """Penggal-penggal jaringan beserta daftar tetangganya.

    Simpul tetangga dicari lewat kisi berukuran toleransi: tiap simpul dimasukkan ke
    kotaknya, lalu tiap UJUNG penggal menengok sembilan kotak di sekitarnya. Itu yang
    membuat percabangan T tertangkap - tersier yang berpangkal di tengah sekunder tidak
    punya ujung yang berimpit dengan ujung sekunder mana pun.
    """
    penggal = []
    for r in ruas:
        for s in r["bagian"]:
            simpul = bidang.garis(s)
            penggal.append({"ruas": r["kode"], "jenis": r["jenis"], "simpul": simpul,
                            "panjang_m": panjang_m(simpul)})

    tol = TOLERANSI_SAMBUNG_M
    kisi: dict[tuple[int, int], set[int]] = {}
    for k, g in enumerate(penggal):
        for x, y in g["simpul"]:
            kisi.setdefault((int(x // tol), int(y // tol)), set()).add(k)

    tetangga: dict[int, set[int]] = {k: set() for k in range(len(penggal))}
    for k, g in enumerate(penggal):
        for x, y in (g["simpul"][0], g["simpul"][-1]):
            cx, cy = int(x // tol), int(y // tol)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for y2 in kisi.get((cx + dx, cy + dy), ()):
                        if y2 != k:
                            tetangga[k].add(y2)
                            tetangga[y2].add(k)
    return penggal, tetangga


# Tingkat saluran menurut urutan air melewatinya. Suplesi disamakan dengan primer:
# ia memasukkan air dari sumber lain ke pangkal jaringan, bukan mengambil dari sekunder.
KELAS_ALIR = {"Primer": 0, "Suplesi": 0, "Sekunder": 1, "Tersier": 2}


def telusuri(penggal, tetangga, awal: int) -> tuple[dict, dict, list]:
    """Penelusuran dari penggal hulu: induk, tingkat, dan urutan kunjungan tiap penggal.

    BERTAHAP menurut tingkat saluran, bukan lebar-dulu biasa. Lebar-dulu biasa memilih
    jalur dengan penggal paling sedikit, dan itu sesekali memulangkan jalur yang
    mustahil secara irigasi: satu tersier yang kebetulan menyentuh dua sekunder akan
    dijadikan jalan pintas di antara keduanya, sehingga air terhitung mengalir dari
    tersier MASUK ke sekunder. Akibatnya bukan sekadar salah gambar - seluruh beban
    sekunder itu beserta hilirnya ikut ditumpangkan ke satu tersier, dan debit rancangan
    keduanya jadi salah sekaligus. (Pada data ini kejadiannya sekali: SS Cinanti, 579 ha,
    tersambung lewat tersier CN.6M.)

    Tahapannya menutup itu: primer dan suplesi dirambah lebih dulu sampai habis, baru
    sekunder, baru tersier. Sekunder karena itu hanya bisa beriunduk pada tersier kalau
    memang TIDAK ADA jalan lain ke sana - dan kalau begitu, memang begitulah datanya.

    Urutan kunjungan dipakai terbalik untuk menjumlah beban dari hilir ke hulu: tiap
    penggal selalu masuk daftar sesudah induknya, jadi membalik urutannya menjamin
    hitungan hilir satu penggal sudah lengkap sebelum giliran induknya tiba.
    """
    induk = {awal: None}
    tingkat = {awal: 0}
    urutan = [awal]
    for batas in (0, 1, 2):
        # Tiap tahap berangkat lagi dari SELURUH penggal yang sudah ketemu - cabang
        # sekunder bisa berpangkal di mana saja sepanjang primer, bukan cuma di ujung
        # yang terakhir dirambah tahap sebelumnya.
        antre = deque(urutan)
        while antre:
            k = antre.popleft()
            for y in tetangga[k]:
                if y in induk or KELAS_ALIR.get(penggal[y]["jenis"], 2) > batas:
                    continue
                induk[y] = k
                tingkat[y] = tingkat[k] + 1
                urutan.append(y)
                antre.append(y)
    return induk, tingkat, urutan


# ================================================================= sawah & layanan
def sawah_sel(kotak: list[float], bidang: Bidang) -> tuple[np.ndarray, np.ndarray,
                                                           np.ndarray, int, float]:
    """Sawah BIG di bentang jaringan, dipecah jadi sel 100 m -> (x, y, luas ha).

    Luas tiap sel bukan tetapan 1 ha melainkan luas bloknya dibagi jumlah selnya, dan
    itu disengaja: jumlah seluruh sel jadi persis sama dengan luas blok yang diukur
    dengan rumus repo ini. Yang dikerjakan pemecahan ini semata-mata MEMBAGI luas yang
    sudah ada ke tempat yang lebih tepat, bukan menaksirnya ulang - selisih sel yang
    terpotong di tepi blok tidak boleh diam-diam menambah atau mengurangi luas sawah.
    """
    balasan = wd._query_big(LAPISAN_SAWAH_BIG, kotak)
    fitur = balasan.get("features") or []
    if len(fitur) >= wd.BIG_MAKS_FITUR:
        print(f"  PERINGATAN: sawah BIG kena batas {wd.BIG_MAKS_FITUR} objek - "
              "luasnya kurang, bentangnya perlu dipecah")

    xs, ys, has = [], [], []
    n_blok = 0
    ha_blok = 0.0
    for f in fitur:
        g = shape(f["geometry"]).buffer(0)
        if g.is_empty:
            continue
        ha = luas_ha(g)
        if ha <= 0:
            continue
        n_blok += 1
        ha_blok += ha
        gm = bidang.bentuk(g)
        minx, miny, maxx, maxy = gm.bounds
        gx = np.arange(minx + SEL_M / 2, maxx + SEL_M, SEL_M)
        gy = np.arange(miny + SEL_M / 2, maxy + SEL_M, SEL_M)
        X, Y = (a.ravel() for a in np.meshgrid(gx, gy))
        di_dalam = shapely.contains_xy(gm, X, Y)
        X, Y = X[di_dalam], Y[di_dalam]
        if not len(X):
            # Blok yang lebih kecil daripada selnya sendiri tidak boleh hilang: ia
            # diwakili satu titik di dalam dirinya, dengan luas utuh.
            wakil = gm.representative_point()
            X, Y = np.array([wakil.x]), np.array([wakil.y])
        xs.append(X)
        ys.append(Y)
        has.append(np.full(len(X), ha / len(X)))
    return (np.concatenate(xs), np.concatenate(ys), np.concatenate(has),
            n_blok, ha_blok)


def alokasi_sawah(sel, penggal) -> tuple[dict, float, float]:
    """Tiap sel sawah -> penggal TERSIER terdekat. Yang jauh tidak dititipkan ke mana pun.

    Sel yang tersier terdekatnya lebih jauh dari SERVIS_MAKS_M sengaja DIBUANG, bukan
    diberikan ke saluran terdekat berikutnya. Sawah di seberang bukit yang kebetulan
    5 km dari ujung tersier terjauh tidak dilayani jaringan ini, dan menitipkannya ke
    ruas mana pun akan membesarkan debit rancangan ruas itu atas lahan yang airnya
    tidak pernah lewat situ.
    """
    x, y, ha = sel
    tersier = [k for k, g in enumerate(penggal) if g["jenis"] == "Tersier"]
    if not tersier:
        raise SystemExit("tidak ada penggal tersier - alokasi layanan tidak mungkin")
    garis = np.array([LineString(penggal[k]["simpul"]) for k in tersier], dtype=object)
    pohon = STRtree(garis)

    titik = shapely.points(x, y)
    dekat = pohon.nearest(titik)
    jarak = shapely.distance(garis[dekat], titik)
    kena = jarak <= SERVIS_MAKS_M

    layanan: dict[int, float] = {}
    pusat: dict[int, list] = {}
    for i in np.flatnonzero(kena):
        k = tersier[int(dekat[i])]
        layanan[k] = layanan.get(k, 0.0) + float(ha[i])
        pusat.setdefault(k, []).append((float(ha[i]), float(x[i]), float(y[i])))
    return ({"ha": layanan, "titik": pusat},
            float(ha[kena].sum()), float(ha[~kena].sum()))


def zona_cuaca(penggal, induk) -> dict[int, str]:
    """Penggal -> zona iklim, yaitu saluran non-tersier terdekat ke arah hulu.

    Iklim tidak diambil per tersier karena 139 titik ERA5-Land di wilayah selebar 17 km
    cuma akan mengulang petak grid yang sama belasan kali - dan 139 unduhan berturut-turut
    pasti menyentuh batas laju layanannya. Diambil per saluran induk/sekunder: itu satuan
    terkecil yang benar-benar berjauhan satu sama lain.
    """
    zona = {}
    for k in range(len(penggal)):
        j = k
        lihat = 0
        while j is not None and penggal[j]["jenis"] == "Tersier" and lihat < 10_000:
            j = induk.get(j)
            lihat += 1
        # Tersier yang tidak tersambung ke saluran induk mana pun berdiri sendiri:
        # zonanya ruasnya sendiri, bukan zona tetangga yang kebetulan dekat.
        zona[k] = penggal[j]["ruas"] if j is not None else penggal[k]["ruas"]
    return zona


# ============================================================================ main
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--uji", action="store_true",
                    help="berhenti sesudah graf & alokasi, tanpa menyentuh cuaca")
    # 6 detik, bukan 1. Satu permintaan di sini memuat 11 tahun x 7 peubah harian, dan
    # layanan cuaca menakar jatahnya dari BANYAKNYA ANGKA, bukan banyaknya permintaan -
    # jadi 53 zona berturut-turut menyentuh batas per-jamnya walau permintaannya cuma 53.
    # Sekali tersentuh, tunggunya berlipat sampai dua menit per percobaan, dan itu jauh
    # lebih lambat daripada berjalan pelan sejak awal.
    ap.add_argument("--jeda", type=float, default=6.0,
                    help="jeda detik antar unduhan cuaca")
    arg = ap.parse_args()

    KELUARAN.mkdir(parents=True, exist_ok=True)
    print("=" * 78)
    print("   KEBUTUHAN AIR PER RUAS JARINGAN - D.I. Leuwigoong, KP-01 / FAO-56")
    print("=" * 78)

    # ---------------------------------------------------------------- 1. graf ----
    ruas = baca_ruas()
    ruas_dari_kode = {r["kode"]: r for r in ruas}
    simpul_semua = [p for r in ruas for s in r["bagian"] for p in s]
    lat0 = sum(p[1] for p in simpul_semua) / len(simpul_semua)
    lon0 = sum(p[0] for p in simpul_semua) / len(simpul_semua)
    bidang = Bidang(lat0, lon0)

    penggal, tetangga = bangun_graf(ruas, bidang)
    panjang_total = sum(g["panjang_m"] for g in penggal)
    print(f"  {len(ruas)} ruas, {len(penggal)} penggal, "
          f"{panjang_total / 1000:,.1f} km panjang jaringan".replace(",", "."))

    lon_b, lat_b = titik_bendung()
    pb = Point(bidang.titik((lon_b, lat_b)))
    pohon_semua = STRtree([LineString(g["simpul"]) for g in penggal])
    hulu = int(pohon_semua.nearest(pb))
    jarak_hulu = LineString(penggal[hulu]["simpul"]).distance(pb)
    print(f"  Hulu: {NAMA_BENDUNG} ({lat_b:.4f}, {lon_b:.4f}) — penggal terdekat "
          f"{penggal[hulu]['ruas']} sejauh {jarak_hulu:.0f} m")

    induk, tingkat, urutan = telusuri(penggal, tetangga, hulu)
    tersambung = set(urutan)
    pj_sambung = sum(penggal[k]["panjang_m"] for k in tersambung)
    print(f"  Tersambung ke bendung: {len(tersambung)}/{len(penggal)} penggal, "
          f"{pj_sambung / 1000:,.1f} km ({100 * pj_sambung / panjang_total:.0f}% panjang)"
          .replace(",", "."))

    # ------------------------------------------------------------- 2. layanan ----
    lon = [p[0] for p in simpul_semua]
    lat = [p[1] for p in simpul_semua]
    t = TEPI_DERAJAT
    kotak = [min(lon) - t, min(lat) - t, max(lon) + t, max(lat) + t]
    x, y, ha_sel, n_blok, ha_sawah = sawah_sel(kotak, bidang)
    print(f"  Sawah BIG RBI 25K di bentang jaringan: {n_blok} blok, "
          f"{ha_sawah:,.0f} ha -> {len(x):,} sel {SEL_M:.0f} m".replace(",", "."))

    layanan, ha_terlayani, ha_jauh = alokasi_sawah((x, y, ha_sel), penggal)
    print(f"  Terlayani tersier (<= {SERVIS_MAKS_M:.0f} m): {ha_terlayani:,.0f} ha "
          f"({100 * ha_terlayani / ha_sawah:.0f}%); di luar jangkauan {ha_jauh:,.0f} ha"
          .replace(",", "."))
    print(f"  Pembanding: petak baku D.I. Leuwigoong {LUAS_BAKU_DI_HA:,.0f} ha "
          f"(selisih {100 * (ha_terlayani - LUAS_BAKU_DI_HA) / LUAS_BAKU_DI_HA:+.0f}%)"
          .replace(",", "."))

    zona = zona_cuaca(penggal, induk)
    # Titik iklim tiap zona = titik berat sawah yang dilayaninya. Zona tanpa sawah tidak
    # perlu iklim sama sekali - ia cuma mengangkut air dari hilirnya.
    zona_titik: dict[str, list] = {}
    for k, isi in layanan["titik"].items():
        zona_titik.setdefault(zona[k], []).extend(isi)
    zona_pusat = {}
    for z, isi in zona_titik.items():
        w = sum(h for h, _, _ in isi)
        lon_z, lat_z = bidang.balik(sum(h * px for h, px, _ in isi) / w,
                                    sum(h * py for h, _, py in isi) / w)
        zona_pusat[z] = {"ha": w, "lat": lat_z, "lon": lon_z}
    print(f"  {len(zona_pusat)} zona iklim (saluran induk/sekunder yang punya layanan)")

    if arg.uji:
        print("\n  --uji: berhenti sebelum cuaca. Susunan zona:")
        for z, v in sorted(zona_pusat.items(), key=lambda x: -x[1]["ha"]):
            print(f"    {ruas_dari_kode[z]['id']:<32}{v['ha']:>8,.0f} ha"
                  .replace(",", "."))
        return

    # --------------------------------------------------------------- 3. iklim ----
    musim, terlewat = [], []
    siap = None                     # keadaan layanan cuaca; None = belum diperiksa
    urut_zona = sorted(zona_pusat.items(), key=lambda x: -x[1]["ha"])
    for n, (z, v) in enumerate(urut_zona, 1):
        nama = ruas_dari_kode[z]["id"]
        # Zona yang simpanannya sudah ada tidak menyentuh jaringan sama sekali. Yang
        # belum, diputuskan sekali untuk semuanya lewat satu ketukan ringan - lihat
        # `layanan_cuaca_siap()`.
        if not berkas_cuaca(z).exists():
            if siap is None:
                siap = layanan_cuaca_siap()
                if not siap:
                    print("\n  Layanan cuaca sedang membatasi laju permintaan. Zona yang"
                          "\n  simpanannya belum ada dilewati; iklimnya dipinjam dari zona"
                          "\n  terdekat yang punya, dan pinjamannya dicatat per ruas."
                          "\n  Jalankan ulang skrip ini nanti untuk menggantinya dengan"
                          "\n  angka zona itu sendiri.\n")
            if not siap:
                terlewat.append((z, nama, "layanan cuaca membatasi laju"))
                continue
        try:
            cuaca, elev = cuaca_titik(v["lat"], v["lon"], f"zona-{z}", arg.jeda)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            terlewat.append((z, nama, str(e)))
            print(f"  [{n:>2}/{len(zona_pusat)}] {nama:<30} DILEWATI - cuaca: {e}")
            continue
        v["elev"] = elev
        v["eto_rata"] = float(cuaca["eto_pm"].mean())
        v["hujan_tahunan_mm"] = float(cuaca.groupby("tahun")["hujan"].sum().mean())
        print(f"  [{n:>2}/{len(zona_pusat)}] {nama:<30}{v['ha']:>7,.0f} ha | "
              f"{elev:>4.0f} m dpl | ETo {v['eto_rata']:.2f} | "
              f"hujan {v['hujan_tahunan_mm']:>5.0f} mm/th".replace(",", "."))
        for bulan in range(1, 13):
            for rz in REZIM:
                for th in range(TAHUN_AWAL, TAHUN_AKHIR):
                    df = neraca_musim(date(th, bulan, 1), rz, cuaca)
                    if df is None:
                        continue
                    r = ringkas_plus(df)
                    r.update({"zona": z, "rezim": rz, "bulan": bulan, "tahun_tanam": th})
                    musim.append(r)
    if not musim:
        raise SystemExit("tidak ada satu pun zona yang cuacanya terambil")
    MUSIM = pd.DataFrame(musim)
    zona_ada = set(MUSIM["zona"].unique())

    # ---- zona yang cuacanya belum terambil: meminjam zona terdekat yang punya ----
    #
    # Ini MENYIMPANG dari aturan `hitung-di-garut-air.py`, yang menolak menambal DI
    # terlewat dengan iklim tetangganya. Penyimpangan itu disengaja dan sebabnya beda
    # tingkat: di sana objeknya DI-DI se-kabupaten yang berjauhan puluhan kilometer,
    # jadi iklim tetangga memang iklim tempat lain. Di sini seluruh zona berada di
    # dalam SATU daerah irigasi selebar 17 km, dan ke-53-nya cuma menempati empat
    # petak kisi ERA5-Land - dua zona bertetangga hampir selalu berbagi petak yang
    # sama persis. Yang dipinjam karena itu bukan "iklim tempat lain", melainkan
    # keluaran petak sumber yang sama, tanpa koreksi elevasi Open-Meteo.
    #
    # Yang membuatnya tetap boleh: pinjamannya TIDAK disembunyikan. Tiap ruas membawa
    # `cuaca_dari` dan `cuaca_jarak_km`, jumlahnya dicetak di akhir dan disimpan di
    # ringkasan, dan ia hilang sendiri begitu skrip ini dijalankan ulang saat jatah
    # layanan cuaca sudah pulih.
    pinjam: dict[str, tuple[str, float]] = {}
    for z, nama, _ in terlewat:
        dekat = min(zona_ada, key=lambda y: jarak_km(zona_pusat[z], zona_pusat[y]))
        pinjam[z] = (dekat, jarak_km(zona_pusat[z], zona_pusat[dekat]))
    if pinjam:
        ha_pinjam = sum(zona_pusat[z]["ha"] for z in pinjam)
        jauh = max(d for _, d in pinjam.values())
        print(f"  {len(pinjam)} zona meminjam iklim zona terdekat "
              f"({ha_pinjam:,.0f} ha, {100 * ha_pinjam / ha_terlayani:.0f}% luas layanan; "
              f"terjauh {jauh:.1f} km)".replace(",", "."))

    # ---- bulan tanam bersama: paling hemat air, ditimbang luas layanan ----
    bobot = {z: v["ha"] for z, v in zona_pusat.items()}
    fl = MUSIM[MUSIM.rezim == "FL"]
    per_bulan = fl.groupby(["bulan", "zona"])["irigasi_mm"].median().reset_index()
    per_bulan["bobot"] = per_bulan["zona"].map(bobot)
    tertimbang = (per_bulan.assign(v=lambda x: x.irigasi_mm * x.bobot)
                  .groupby("bulan").apply(lambda x: x.v.sum() / x.bobot.sum(),
                                          include_groups=False))
    BULAN_TANAM = int(tertimbang.idxmin())
    print(f"\n  Bulan tanam bersama: {NB[BULAN_TANAM - 1]} "
          f"({tertimbang.min():.0f} mm irigasi tertimbang luas; "
          f"terboros {NB[int(tertimbang.idxmax()) - 1]} {tertimbang.max():.0f} mm)")

    # ---- angka pokok per zona, pada bulan tanam bersama ----
    ZONA = {}
    for rz in REZIM:
        for z in zona_ada:
            sel = MUSIM[(MUSIM.zona == z) & (MUSIM.rezim == rz) &
                        (MUSIM.bulan == BULAN_TANAM)]
            if sel.empty:
                continue
            med = float(sel["irigasi_mm"].median())
            etc = float(sel["etc_mm"].median())
            perk = float(sel["perkolasi_mm"].median())
            limp = float(sel["limpasan_mm"].median())
            hujan = float(sel["hujan_mm"].median())
            ZONA[(rz, z)] = {
                "irigasi_mm": med, "nfr_mm_hari": med / HARI_MUSIM,
                "irigasi_mm_andalan": float(np.percentile(sel["irigasi_mm"], 80)),
                "etc_mm": etc, "perkolasi_mm": perk, "limpasan_mm": limp,
                "hujan_mm": hujan, "keluar_mm": etc + perk + limp,
                "masuk_mm": hujan + med,
                "tma_rata": float(sel["tma_rata"].median()),
                "tma_min": float(sel["tma_min"].median()),
                "hari_diairi": float(sel["hari_diairi"].median()),
                "hari_kering": float(sel["hari_kering"].median()),
                "hari_limpas": float(sel["hari_limpas"].median()),
                "n_musim": int(len(sel)),
                "eto_rata_mm_hari": zona_pusat[z].get("eto_rata"),
                "elev_rata_m": zona_pusat[z].get("elev"),
                "hujan_tahunan_mm": zona_pusat[z].get("hujan_tahunan_mm"),
                "bulan_tanam_optimum": NB[int(
                    MUSIM[(MUSIM.zona == z) & (MUSIM.rezim == rz)]
                    .groupby("bulan")["irigasi_mm"].median().idxmin()) - 1],
                "cuaca_dari": None, "cuaca_jarak_km": 0.0,
            }
    # Zona peminjam menunjuk ke hasil zona sumbernya, beserta dari mana dan sejauh apa.
    for z, (dari, jauh) in pinjam.items():
        for rz in REZIM:
            if (rz, dari) not in ZONA:
                continue
            ZONA[(rz, z)] = {**ZONA[(rz, dari)],
                             "cuaca_dari": ruas_dari_kode[dari]["id"],
                             "cuaca_jarak_km": jauh}

    # ---------------------------------------------------------- 4. akumulasi ----
    #
    # Beban SENDIRI tiap penggal dulu, lalu dijumlahkan dari hilir ke hulu. Yang
    # diakumulasi m3 dan l/detik BERSIH - belum dibagi efisiensi - karena efisiensinya
    # berbeda menurut tingkat saluran yang dilewatinya, dan itu baru diketahui saat
    # angkanya dibacakan untuk satu ruas tertentu.
    MEDAN = ["irigasi_m3", "etc_m3", "perkolasi_m3", "limpasan_m3", "irigasi_m3_andalan"]
    baris = []
    for rz in REZIM:
        sendiri_ha = {k: layanan["ha"].get(k, 0.0) for k in range(len(penggal))}
        sendiri = {k: dict.fromkeys(MEDAN, 0.0) for k in range(len(penggal))}
        sendiri_ls = {k: 0.0 for k in range(len(penggal))}
        for k, ha in sendiri_ha.items():
            zk = ZONA.get((rz, zona[k]))
            if not ha or zk is None:
                continue
            sendiri[k] = {
                "irigasi_m3": zk["irigasi_mm"] * ha * 10.0,
                "irigasi_m3_andalan": zk["irigasi_mm_andalan"] * ha * 10.0,
                "etc_m3": zk["etc_mm"] * ha * 10.0,
                "perkolasi_m3": zk["perkolasi_mm"] * ha * 10.0,
                "limpasan_m3": zk["limpasan_mm"] * ha * 10.0,
            }
            sendiri_ls[k] = zk["nfr_mm_hari"] / 8.64 * ha      # bersih, tanpa efisiensi

        angkut_ha = dict(sendiri_ha)
        angkut = {k: dict(v) for k, v in sendiri.items()}
        angkut_ls = dict(sendiri_ls)
        n_hilir = {k: 0 for k in range(len(penggal))}
        # Terbalik dari urutan penelusuran = dari hilir ke hulu. Penggal yang tidak
        # tersambung ke bendung tidak ikut: bebannya berhenti pada dirinya sendiri, dan
        # itu ditandai `terhubung` di keluaran supaya tidak terbaca sebagai ruas ujung.
        for k in reversed(urutan):
            ind = induk.get(k)
            if ind is None:
                continue
            angkut_ha[ind] += angkut_ha[k]
            angkut_ls[ind] += angkut_ls[k]
            n_hilir[ind] += n_hilir[k] + 1
            for m in MEDAN:
                angkut[ind][m] += angkut[k][m]

        # ---- penggal -> ruas ----
        for r in ruas:
            milik = [k for k, g in enumerate(penggal) if g["ruas"] == r["kode"]]
            kepala = max(milik, key=lambda k: angkut_ls[k])
            e = E_KUMULATIF.get(r["jenis"], EFISIENSI_IRIGASI)
            pj = sum(penggal[k]["panjang_m"] for k in milik)
            ha_sendiri = sum(sendiri_ha[k] for k in milik)
            ha_angkut = angkut_ha[kepala]
            zk = ZONA.get((rz, zona[kepala])) or {}
            ls = angkut_ls[kepala]
            ls_ujung = min(angkut_ls[k] for k in milik)
            m3 = {m: angkut[kepala][m] for m in MEDAN}
            keluar_m3 = m3["etc_m3"] + m3["perkolasi_m3"] + m3["limpasan_m3"]
            pct = lambda x: 100.0 * x / keluar_m3 if keluar_m3 else None
            ind = induk.get(kepala)
            # Angka SENDIRI - hanya dari lahan yang menempel pada ruas ini. Ia yang
            # boleh dijumlahkan se-jaringan; `irigasi_m3` di sebelahnya sudah memuat
            # air seluruh hilirnya, jadi menjumlahkannya akan menghitung air yang sama
            # sekali di tersier, sekali lagi di sekunder, dan sekali lagi di primer.
            m3_sendiri = {m: sum(sendiri[k][m] for k in milik) for m in MEDAN}
            keluar_sendiri = (m3_sendiri["etc_m3"] + m3_sendiri["perkolasi_m3"] +
                              m3_sendiri["limpasan_m3"])
            baris.append({
                "petak": r["id"], "kode": r["kode"], "nama": r["nama"],
                "jenis": r["jenis"], "rezim": rz,
                "tanam": NB[BULAN_TANAM - 1],
                "bulan_tanam_optimum": zk.get("bulan_tanam_optimum"),
                "terhubung": kepala in tersambung,
                "tingkat": tingkat.get(kepala),
                "hulu": (ruas_dari_kode[penggal[ind]["ruas"]]["id"]
                         if ind is not None else None),
                "n_ruas_hilir": n_hilir[kepala],
                "panjang_m": pj, "panjang_km": pj / 1000.0,
                # `luas_ha` = luas yang AIRNYA LEWAT ruas ini, bukan luas di sebelahnya.
                # Itu yang menentukan debitnya, jadi itu pula yang jadi luas pokoknya.
                "luas_ha": ha_angkut, "luas_m2": ha_angkut * 1e4,
                "luas_layanan_sendiri_ha": ha_sendiri,
                "luas_layanan_hilir_ha": ha_angkut - ha_sendiri,
                "zona_iklim": ruas_dari_kode[zona[kepala]]["id"],
                "cuaca_dari": zk.get("cuaca_dari"),
                "cuaca_jarak_km": zk.get("cuaca_jarak_km"),
                "efisiensi_kumulatif": e,
                "nfr_mm_hari": zk.get("nfr_mm_hari"),
                "dr_l_detik_ha": (ke_l_detik_ha(zk["nfr_mm_hari"], e)
                                  if zk.get("nfr_mm_hari") else None),
                # Debit di HULU ruas: kebutuhan bersih seluruh hilirnya, dibagi
                # efisiensi kumulatif sampai tingkat saluran ini.
                "debit_l_detik": ls / e,
                "debit_l_detik_hilir": ls_ujung / e,
                "debit_l_detik_bersih": ls,
                "debit_l_detik_km": (ls / e) / (pj / 1000.0) if pj else None,
                "irigasi_m3": m3["irigasi_m3"],
                "irigasi_m3_andalan": m3["irigasi_m3_andalan"],
                "irigasi_m3_kotor": m3["irigasi_m3"] / e,
                "irigasi_m3_sendiri": m3_sendiri["irigasi_m3"],
                "etc_m3_sendiri": m3_sendiri["etc_m3"],
                "perkolasi_m3_sendiri": m3_sendiri["perkolasi_m3"],
                "limpasan_m3_sendiri": m3_sendiri["limpasan_m3"],
                "water_loss_m3_sendiri": keluar_sendiri,
                "debit_l_detik_sendiri": sum(sendiri_ls[k] for k in milik) / e,
                "irigasi_mm": zk.get("irigasi_mm"),
                "hujan_mm": zk.get("hujan_mm"),
                "masuk_mm": zk.get("masuk_mm"), "keluar_mm": zk.get("keluar_mm"),
                "etc_mm": zk.get("etc_mm"), "perkolasi_mm": zk.get("perkolasi_mm"),
                "limpasan_mm": zk.get("limpasan_mm"),
                "etc_m3": m3["etc_m3"], "perkolasi_m3": m3["perkolasi_m3"],
                "limpasan_m3": m3["limpasan_m3"], "water_loss_m3": keluar_m3,
                "etc_pct": pct(m3["etc_m3"]),
                "perkolasi_pct": pct(m3["perkolasi_m3"]),
                "limpasan_pct": pct(m3["limpasan_m3"]),
                "loss_pct_masuk": (100.0 * zk["keluar_mm"] / zk["masuk_mm"]
                                   if zk.get("masuk_mm") else None),
                "irigasi_pct_masuk": (100.0 * zk["irigasi_mm"] / zk["masuk_mm"]
                                      if zk.get("masuk_mm") else None),
                "hujan_pct_masuk": (100.0 * zk["hujan_mm"] / zk["masuk_mm"]
                                    if zk.get("masuk_mm") else None),
                "elev_rata_m": zk.get("elev_rata_m"),
                "eto_rata_mm_hari": zk.get("eto_rata_mm_hari"),
                "hujan_tahunan_mm": zk.get("hujan_tahunan_mm"),
                "tma_rata": zk.get("tma_rata"), "tma_min": zk.get("tma_min"),
                "hari_diairi": zk.get("hari_diairi"),
                "hari_kering": zk.get("hari_kering"),
                "hari_limpas": zk.get("hari_limpas"),
                "n_musim": zk.get("n_musim"),
            })
    HASIL = pd.DataFrame(baris)

    # ------------------------------------------------------------- 5. simpan ----
    HASIL.to_csv(KELUARAN / "kebutuhan_air_ruas.csv", index=False)
    MUSIM.to_csv(KELUARAN / "musim_zona.csv", index=False)
    pd.DataFrame([{"zona": ruas_dari_kode[z]["id"], "kode": z, **v}
                  for z, v in zona_pusat.items()]).to_csv(
        KELUARAN / "zona_iklim.csv", index=False)

    # Geometri ikut disimpan supaya web-app tidak perlu membangun ulang grafnya:
    # id yang dipakai di CSV harus sepadan dengan id yang digambar, dan menjamin itu
    # lewat dua jalan pembacaan yang terpisah cuma menunggu keduanya berbeda.
    (KELUARAN / "jaringan_ruas.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": wd._sederhanakan_geom(r["geometry"], wd.GC_TOLERANSI),
            "properties": {"id": r["id"], "kode": r["kode"], "nama": r["nama"],
                           "jenis": r["jenis"]},
        } for r in ruas],
    }, ensure_ascii=False), encoding="utf-8")

    fl_h = HASIL[HASIL.rezim == "FL"]
    induk_ruas = fl_h[fl_h.jenis.isin(["Primer", "Suplesi"])]
    eto_bobot = float((fl_h["eto_rata_mm_hari"].fillna(0) *
                       fl_h["luas_layanan_sendiri_ha"]).sum() /
                      max(fl_h["luas_layanan_sendiri_ha"].sum(), 1e-9))
    ir_pl = kebutuhan_siap_lahan(eto_bobot, PERKOLASI_MM)
    pd.DataFrame([{
        "n_ruas": len(ruas), "n_penggal": len(penggal),
        "n_penggal_tersambung": len(tersambung),
        "panjang_km": panjang_total / 1000.0,
        "panjang_tersambung_km": pj_sambung / 1000.0,
        "hulu": NAMA_BENDUNG, "hulu_lat": lat_b, "hulu_lon": lon_b,
        "toleransi_sambung_m": TOLERANSI_SAMBUNG_M,
        "servis_maks_m": SERVIS_MAKS_M,
        "n_zona_iklim": len(zona_pusat), "n_zona_terunduh": len(zona_ada),
        "n_zona_pinjam": len(pinjam),
        "luas_zona_pinjam_ha": sum(zona_pusat[z]["ha"] for z in pinjam),
        "pinjam_terjauh_km": max((d for _, d in pinjam.values()), default=0.0),
        "zona_pinjam": "; ".join(ruas_dari_kode[z]["id"] for z in pinjam),
        "bulan_tanam": NB[BULAN_TANAM - 1], "hari_musim": HARI_MUSIM,
        "lama_siap_lahan_hari": LAMA_SIAP_LAHAN,
        "tahun_cuaca": f"{TAHUN_AWAL}-{TAHUN_AKHIR}",
        "sumber_cuaca": "Open-Meteo ERA5-Land", "metode_eto": "FAO-56 Penman-Monteith",
        "sumber_jaringan": "SISDA Cimanuk-Cisanggarung — DI_Leuwigoong_Jaringan",
        "sumber_layanan": "BIG RBI 25K Agrikultur Sawah (612), tersier terdekat",
        "eto_rata_mm_hari": eto_bobot,
        "perkolasi_mm_hari": PERKOLASI_MM, "wlr_mm": WLR_MM,
        "efisiensi_tersier": E_TERSIER, "efisiensi_sekunder": E_SEKUNDER,
        "efisiensi_primer": E_PRIMER,
        "luas_sawah_bentang_ha": ha_sawah,
        "luas_layanan_ha": ha_terlayani,
        "luas_sawah_di_luar_jangkauan_ha": ha_jauh,
        "debit_siap_lahan_l_detik": ke_l_detik_ha(ir_pl) * ha_terlayani,
        "debit_hulu_l_detik_FL": float(induk_ruas["debit_l_detik"].max()
                                       if len(induk_ruas) else 0.0),
        # Volume se-jaringan dijumlahkan dari luas layanan SENDIRI tiap ruas, bukan dari
        # `irigasi_m3` yang sudah terakumulasi - kalau itu yang dijumlah, air yang lewat
        # primer akan terhitung ulang di tiap sekunder dan tersier di bawahnya.
        "volume_layanan_m3_FL": float(
            (fl_h["luas_layanan_sendiri_ha"] * fl_h["irigasi_mm"].fillna(0) * 10).sum()),
        "water_loss_layanan_m3_FL": float(
            (fl_h["luas_layanan_sendiri_ha"] * fl_h["keluar_mm"].fillna(0) * 10).sum()),
    }]).to_csv(KELUARAN / "ringkasan_air.csv", index=False)

    # ------------------------------------------------------------- 6. cetak ----
    t = fl_h.sort_values("debit_l_detik", ascending=False).head(20)
    print()
    print("=" * 78)
    print(f"   20 RUAS BERDEBIT TERBESAR - rezim FL, tanam {NB[BULAN_TANAM - 1]}")
    print("=" * 78)
    print(f"  {'Ruas':<28}{'jenis':<10}{'panjang':>8}{'layanan':>9}{'debit':>10}"
          f"{'hilir':>7}")
    print(f"  {'':<28}{'':<10}{'(km)':>8}{'(ha)':>9}{'(l/dt)':>10}{'(ruas)':>7}")
    print("-" * 78)
    for _, r in t.iterrows():
        print(f"  {r.petak[:27]:<28}{r.jenis:<10}{r.panjang_km:>8,.1f}"
              f"{r.luas_ha:>9,.0f}{r.debit_l_detik:>10,.0f}{r.n_ruas_hilir:>7,.0f}"
              .replace(",", "."))
    print("-" * 78)
    pj_km = fl_h["panjang_km"].sum()
    print(f"  {len(ruas)} ruas, {pj_km:,.1f} km, layanan {ha_terlayani:,.0f} ha, "
          f"debit di hulu {induk_ruas['debit_l_detik'].max():,.0f} l/detik"
          .replace(",", "."))
    print("=" * 78)
    lepas = fl_h[~fl_h["terhubung"]]
    if len(lepas):
        print(f"  {len(lepas)} ruas TIDAK tersambung ke {NAMA_BENDUNG} "
              f"({lepas['panjang_km'].sum():.1f} km, "
              f"{lepas['luas_layanan_sendiri_ha'].sum():,.0f} ha layanan) - debitnya "
              "hanya beban sendiri, tidak diakumulasi.".replace(",", "."))
    if pinjam:
        ha_pinjam = sum(zona_pusat[z]["ha"] for z in pinjam)
        print(f"  {len(pinjam)} dari {len(zona_pusat)} zona MEMINJAM iklim zona terdekat "
              f"({ha_pinjam:,.0f} ha, {100 * ha_pinjam / ha_terlayani:.0f}% luas layanan). "
              "Kolom `cuaca_dari`".replace(",", "."))
        print("  dan `cuaca_jarak_km` pada CSV menandai ruas mana saja yang kena. "
              "Jalankan ulang")
        print("  skrip ini saat jatah layanan cuaca pulih; yang sudah terunduh tidak "
              "diambil lagi.")
    print(f"  Keluaran: {KELUARAN}")


if __name__ == "__main__":
    main()
