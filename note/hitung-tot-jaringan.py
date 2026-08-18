# -*- coding: utf-8 -*-
"""Time of Travel (ToT) aliran pada jaringan D.I. Leuwigoong, dari hulu ke hilir.

Jalankan:
    python note/hitung-tot-jaringan.py
    python note/hitung-tot-jaringan.py --ke "SS Lewo"     # telusuri satu jalur saja

Keluarannya CSV di `note/output-jaringan-air/`, sebangun dengan pipeline lain di repo ini.

===============================================================================
YANG PERLU DIBACA SEBELUM MEMAKAI ANGKANYA
===============================================================================
Ini **ToT RANCANGAN**, bukan ToT terukur, dan bedanya bukan soal ketelitian melainkan
soal apa yang sebetulnya diketahui. Dari tujuh besaran yang menentukan waktu tempuh,
SISDA hanya menyimpan dua:

    ADA      panjang tiap ruas          (geometri SISDA)
    ADA      debit tiap ruas            (akumulasi KP-01, `hitung-jaringan-air.py`)
    TIDAK    lebar dasar & penampang    - SISDA cuma menyimpan garis
    TIDAK    kedalaman air              - tidak pernah diukur
    TIDAK    kemiringan dasar saluran   - lihat catatan DEM di bawah
    TIDAK    kekasaran (Manning n)      - jenis lining tidak terdata
    TIDAK    bukaan pintu               - 289 bangunan cuma punya `name` dan `no`

Lima yang tidak ada itu DITURUNKAN dari debit dengan nilai rancangan yang lazim untuk
saluran irigasi tanah, dan tiap-tiapnya dijalankan dalam RENTANG - bukan satu angka -
supaya lebar pita ketidakpastiannya ikut terbaca. Hasilnya sah untuk menjawab "berapa
lama kira-kira, dan apa yang paling menentukannya", dan TIDAK sah untuk menyetel jadwal
gilir air di lapangan. Untuk itu perlu profil memanjang dan data pintu.

Kenapa kemiringan dasar tidak diambil dari DEM: cache DEM repo ini berkelas SRTM
(ketelitian tegak +-5..10 m). Saluran irigasi berkemiringan 1:1.000 sampai 1:10.000,
artinya turun 0,3-3 m sepanjang 3 km - lebih kecil daripada derau DEM-nya sendiri.
Beda tinggi medan antar-zona (498-690 m) juga bukan kemiringan saluran: saluran irigasi
menyusur kontur dan membuang beda tinggi di bangunan terjun, jadi memakai kemiringan
medan akan melebihkan kecepatan berlipat-lipat.

===============================================================================
TIGA WAKTU YANG BERBEDA
===============================================================================
Pertanyaan "berapa lama air sampai" punya tiga jawaban yang berbeda sampai sepuluh kali
lipat, dan ketiganya dipakai untuk hal yang berbeda:

  1. WATER TRAVEL TIME  (t_air)      - kecepatan v = Q/A.
     Waktu satu MOLEKUL air, sedimen, atau zat pelacak berpindah. Ini yang menjawab
     "kapan air dari kantong lumpur sampai di petak", dan yang dipakai untuk perunutan
     pencemaran atau sedimen.

  2. HYDRAULIC RESPONSE TIME (t_hidraulik) - kecepatan rambat gelombang kinematik,
     c_k = dQ/dA, kira-kira 1,3-1,7 kali v.
     Waktu PERUBAHAN DEBIT merambat. Ini yang menjawab "kalau pintu di hulu dibuka
     lebih besar, kapan debit di hilir benar-benar naik" - dan inilah yang dipakai
     menyusun jadwal operasi pintu. Selalu LEBIH CEPAT daripada air itu sendiri, karena
     yang merambat perubahan tinggi muka air, bukan airnya.

  3. WAKTU DATANG GANGGUAN (t_gangguan) - gelombang dinamik, c_d = v + akar(g.D).
     Riak pertama yang terasa di hilir begitu pintu digerakkan. Paling cepat, orde
     menit, dan tidak membawa perubahan debit yang berarti - ia cuma pemberitahuan.

Menyamakan (1) dengan (2) adalah kekeliruan yang paling mahal di operasi jaringan:
jadwal pintu yang disusun memakai t_air akan selalu terlambat.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.ops import nearest_points
from shapely.strtree import STRtree

AKAR = Path(__file__).resolve().parent.parent
KELUARAN = AKAR / "note" / "output-jaringan-air"
SUMBER_AIR = KELUARAN / "kebutuhan_air_ruas.csv"
SUMBER_RUAS = KELUARAN / "jaringan_ruas.geojson"
SUMBER_BANGUNAN = AKAR / "data" / "DI_Leuwigoong_Bangunan.geojson"

G = 9.81
# Hulu sistem. Kantong lumpur tidak punya nama sendiri di data bangunan SISDA; pada
# skema bendung baku ia duduk tepat sesudah intake dan sebelum saluran induk, jadi
# outlet-nya berimpit dengan pangkal SI Copong. Itu yang dipakai sebagai t = 0.
HULU = "Bendung Copong"
# Sejauh mana satu bangunan masih dianggap menandai simpul pertemuan dua ruas.
SIMPUL_MAKS_M = 150.0

# Nilai rancangan per tingkat saluran, ditulis (rendah, tengah, tinggi).
#
# BUKAN salinan tabel KP-03, dan bukan hasil ukur - ini rentang yang lazim dipakai
# merancang saluran irigasi tanah, dan dipasang sebagai rentang justru karena tidak
# ada satu pun di antaranya yang diketahui untuk jaringan ini. Yang "rendah" dan
# "tinggi" dipilih supaya masing-masing memberi waktu tempuh TERPENDEK dan TERPANJANG,
# jadi pitanya benar-benar membungkus, bukan sekadar menyebar:
#
#   waktu terpendek  <- n kecil, S besar, b/h kecil
#   waktu terpanjang <- n besar, S kecil, b/h besar
#
#   n    kekasaran Manning. 0,020-0,025 saluran tanah terpelihara; 0,030-0,035 bervegetasi.
#   S    kemiringan dasar. Makin ke hilir makin curam - saluran induk paling landai.
#   b/h  nisbah lebar dasar terhadap kedalaman. Naik mengikuti debit.
#   m    kemiringan talud (1 : m). Tetap; pengaruhnya ke ToT paling kecil.
RANCANGAN = {
    "Primer":   {"n": (0.020, 0.025, 0.030), "S": (0.0005, 0.00025, 0.00010),
                 "bh": (2.0, 2.5, 3.0), "m": 1.5},
    "Suplesi":  {"n": (0.020, 0.025, 0.030), "S": (0.0005, 0.00025, 0.00010),
                 "bh": (2.0, 2.5, 3.0), "m": 1.5},
    "Sekunder": {"n": (0.022, 0.027, 0.032), "S": (0.0010, 0.00050, 0.00025),
                 "bh": (1.5, 2.0, 2.5), "m": 1.5},
    "Tersier":  {"n": (0.025, 0.030, 0.035), "S": (0.0030, 0.00150, 0.00075),
                 "bh": (1.0, 1.2, 1.5), "m": 1.0},
}
KASUS = {"cepat": 0, "tengah": 1, "lambat": 2}

# Kecepatan minimum anti-endapan. Di bawah ini lumpur mengendap dan salurannya
# tersumbat sendiri, jadi tidak ada saluran yang DIRANCANG bekerja di situ.
#
# Ini bukan penghias: 47 % panjang jaringan ini menghasilkan kecepatan di bawahnya
# kalau debit rancangan MENERUS yang dipakai - hampir seluruh tersier dan sebagian
# sekunder. Itu bukan cacat hitungan melainkan pertanda bahwa anggapannya yang keliru:
# saluran tersier tidak dialiri terus-menerus sebesar kebutuhan rata-ratanya, melainkan
# BERGILIR - debit lebih besar dalam waktu lebih pendek. Waktu tempuh menerus karena itu
# diperlakukan sebagai BATAS ATAS, dan L/V_MIN sebagai batas bawahnya.
V_MIN = 0.25


# ============================================================ hidraulika saluran
def kedalaman_normal(Q: float, n: float, S: float, bh: float, m: float) -> float:
    """Kedalaman normal penampang trapesium, bentuk tertutup - bukan iterasi.

    Dengan lebar dasar dinyatakan b = (b/h)*h, seluruh suku Manning berpangkat h^(8/3),
    sehingga h bisa ditarik keluar langsung:

        A = h^2 (a + m)                     a = b/h
        P = h (a + 2 akar(1+m^2))
        Q = (1/n) A R^(2/3) akar(S) = (akar(S) K / n) h^(8/3)
        K = (a+m)^(5/3) / (a + 2 akar(1+m^2))^(2/3)
        h = [Q n / (akar(S) K)]^(3/8)

    Bentuk pangkat 3/8 itu sekaligus yang menerangkan seluruh hasil analisis
    sensitivitas di bawah - lihat `elastisitas()`.
    """
    K = (bh + m) ** (5 / 3) / (bh + 2 * math.sqrt(1 + m * m)) ** (2 / 3)
    return (Q * n / (math.sqrt(S) * K)) ** (3 / 8)


def penampang(h: float, b: float, m: float) -> tuple[float, float, float]:
    """(luas basah, keliling basah, lebar muka air) satu penampang trapesium."""
    return (h * (b + m * h),
            b + 2 * h * math.sqrt(1 + m * m),
            b + 2 * m * h)


def debit_manning(h: float, b: float, m: float, n: float, S: float) -> float:
    A, P, _ = penampang(h, b, m)
    return (1 / n) * A * (A / P) ** (2 / 3) * math.sqrt(S)


def hidraulika(Q: float, n: float, S: float, bh: float, m: float) -> dict:
    """Satu ruas pada satu kasus rancangan -> kecepatan dan ketiga kecepatan rambat.

    Lebar dasar `b` DIPATOK dari kedalaman rancangan lalu diperlakukan tetap. Itu bukan
    kerapian: begitu salurannya terbangun, yang berubah mengikuti debit cuma kedalaman,
    dan turunan dQ/dA hanya berarti kalau b tidak ikut bergerak.
    """
    h = kedalaman_normal(Q, n, S, bh, m)
    b = bh * h
    A, P, T = penampang(h, b, m)
    v = Q / A
    D = A / T                                  # kedalaman hidraulik

    # Gelombang kinematik: c_k = dQ/dA = (dQ/dh)/(dA/dh), dihitung numerik supaya
    # bentuk trapesiumnya ikut terhitung - bukan memakai 5/3 yang hanya berlaku untuk
    # saluran persegi sangat lebar.
    dh = h * 1e-4
    dQ = debit_manning(h + dh, b, m, n, S) - debit_manning(h - dh, b, m, n, S)
    dA = penampang(h + dh, b, m)[0] - penampang(h - dh, b, m)[0]
    c_k = dQ / dA

    return {"h": h, "b": b, "A": A, "v": v, "D": D,
            "c_k": c_k, "beta": c_k / v,
            "c_d": v + math.sqrt(G * D),
            "froude": v / math.sqrt(G * D)}


def elastisitas(bh: float, m: float) -> dict:
    """Elastisitas ToT terhadap tiap parameter - dituliskan, bukan ditaksir dari coba-coba.

    Dari v = Q/A dengan h berpangkat 3/8 di atas:

        v   ~ Q^(1/4) n^(-3/4) S^(3/8) . K^(3/4)/(a+m)
        ToT ~ L . Q^(-1/4) n^(3/4) S^(-3/8) . [(a+m)/K^(3/4)]

    sehingga d(ln ToT)/d(ln x) langsung terbaca untuk L, Q, n, dan S. Untuk nisbah
    b/h suku bentuknya tidak sesederhana itu, jadi elastisitasnya diturunkan numerik.
    """
    def bentuk(a):
        K = (a + m) ** (5 / 3) / (a + 2 * math.sqrt(1 + m * m)) ** (2 / 3)
        return (a + m) / K ** 0.75

    d = bh * 1e-4
    e_bh = ((math.log(bentuk(bh + d)) - math.log(bentuk(bh - d))) /
            (math.log(bh + d) - math.log(bh - d)))
    return {"panjang L": 1.0, "kekasaran n": 0.75, "kemiringan S": -0.375,
            "debit Q": -0.25, "nisbah b/h": e_bh}


# ==================================================================== jaringan
def baca_ruas(rezim: str) -> pd.DataFrame:
    if not SUMBER_AIR.exists():
        raise SystemExit(f"{SUMBER_AIR.name} belum ada — jalankan "
                         "`python note/hitung-jaringan-air.py` lebih dulu")
    d = pd.read_csv(SUMBER_AIR)
    d = d[d["rezim"] == rezim].copy()
    return d.set_index("petak", drop=False)


def simpul_bangunan(ruas: pd.DataFrame) -> dict[str, str]:
    """Ruas -> nama bangunan di PANGKALNYA, kalau ada yang cukup dekat.

    Simpul pertemuan dua ruas didekati dengan titik terdekat antara ruas itu dan
    induknya, lalu dicari bangunan terdekat dari situ. Yang lebih jauh dari
    SIMPUL_MAKS_M tidak dikarang namanya - dikembalikan None, dan tabelnya menuliskan
    nama ruasnya sendiri.
    """
    if not (SUMBER_RUAS.exists() and SUMBER_BANGUNAN.exists()):
        return {}
    geo = {f["properties"]["id"]: shape(f["geometry"])
           for f in json.loads(SUMBER_RUAS.read_text(encoding="utf-8"))["features"]}
    bgn = json.loads(SUMBER_BANGUNAN.read_text(encoding="utf-8"))["features"]
    nama_b = [str(f["properties"].get("name") or "").strip() or None for f in bgn]
    titik = np.array([shape(f["geometry"]) for f in bgn], dtype=object)

    # Semua urusan jarak dikerjakan di bidang meter setempat - "150 m" pada derajat
    # berarti dua panjang berbeda di sumbu bujur dan sumbu lintang.
    lat0, lon0 = -7.11, 107.97
    phi = math.radians(lat0)
    m_lat = 111_132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111_412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    M = lambda g: shapely.transform(g, lambda c: np.column_stack([
        (c[:, 0] - lon0) * m_lon, (c[:, 1] - lat0) * m_lat]))
    geo_m = {k: M(v) for k, v in geo.items()}
    titik_m = np.array([M(t) for t in titik], dtype=object)
    pohon = STRtree(titik_m)

    keluar = {}
    for nama, r in ruas.iterrows():
        induk = r.get("hulu")
        g = geo_m.get(nama)
        if g is None:
            continue
        if isinstance(induk, str) and induk in geo_m:
            p, _ = nearest_points(g, geo_m[induk])
        else:
            p = shapely.centroid(g)          # ruas hulu: tidak ada induk untuk disandari
        i = int(pohon.nearest(p))
        keluar[nama] = (nama_b[i] if shapely.distance(titik_m[i], p) <= SIMPUL_MAKS_M
                        else None)
    return keluar


def tot_per_di(T: pd.DataFrame) -> pd.DataFrame:
    """Waktu datang air di tiap Daerah Irigasi, dijembatani dari waktu per ruas.

    ToT dihitung per RUAS, sedangkan yang ditanya orang di peta "kapan air sampai di DI
    ini". Jembatannya irisan geometri: ruas mana saja yang melintasi poligon DI itu,
    lalu diambil yang PALING AWAL - itu saat air pertama masuk wilayahnya.

    Yang paling akhir ikut dibawa, dan itu bukan pelengkap: selisih keduanya adalah
    lama satu DI terisi dari ujung ke ujung. Pada DI memanjang yang dilewati saluran
    sepanjang 6 km, air di ujung hulu sudah mengalir berjam-jam sebelum ujung hilirnya
    kebagian - dan itu yang menentukan berapa lama satu giliran harus dibuka.
    """
    sumber_di = AKAR / "data" / "DI_Kewenangan_Kabupaten_Garut.geojson"
    if not (sumber_di.exists() and SUMBER_RUAS.exists()):
        return pd.DataFrame()
    di = json.loads(sumber_di.read_text(encoding="utf-8"))["features"]
    geo = {f["properties"]["id"]: shape(f["geometry"])
           for f in json.loads(SUMBER_RUAS.read_text(encoding="utf-8"))["features"]}
    nama_ruas = list(geo)
    pohon = STRtree([geo[k] for k in nama_ruas])

    baris = []
    for f in di:
        g = shape(f["geometry"]).buffer(0)
        kena = [nama_ruas[i] for i in pohon.query(g)
                if geo[nama_ruas[i]].intersects(g)]
        # Hanya ruas yang punya waktu kumulatif - yang lepas dari bendung tidak punya
        # jalur ke hulu, jadi "kapan airnya sampai" memang tidak terjawab lewat situ.
        sel = T[T.index.isin(kena) & T["kum_t_air_jam"].notna()]
        if sel.empty:
            continue
        awal = sel.loc[sel["kum_t_air_jam"].idxmin()]
        akhir = sel.loc[sel["kum_t_air_jam"].idxmax()]
        baris.append({
            "di": f["properties"]["Nama_DI"],
            "luas_cea_ha": f["properties"].get("Luas_CEA"),
            "n_ruas": len(sel),
            "tot_air_jam": awal["kum_t_air_jam"],
            "tot_hidraulik_jam": awal["kum_t_hidraulik_jam"],
            "tot_gangguan_jam": awal["kum_t_gangguan_jam"],
            "tot_air_jam_cepat": awal["kum_t_air_jam_cepat"],
            "tot_air_jam_lambat": awal["kum_t_air_jam_lambat"],
            "ruas_masuk": awal.name,
            "simpul_masuk": awal.get("node_a"),
            "tot_air_jam_ujung": akhir["kum_t_air_jam"],
            "ruas_ujung": akhir.name,
            "lama_terisi_jam": akhir["kum_t_air_jam"] - awal["kum_t_air_jam"],
        })
    return pd.DataFrame(baris)


def jalur_ke(nama: str, ruas: pd.DataFrame) -> list[str]:
    """Rangkaian ruas dari hulu sistem sampai `nama`, terurut hulu -> hilir."""
    jalur, lihat = [], 0
    while isinstance(nama, str) and nama in ruas.index and lihat < 5000:
        jalur.append(nama)
        nama = ruas.at[nama, "hulu"]
        lihat += 1
    return jalur[::-1]


# ======================================================================== main
def _id(v, d=0):
    utuh, _, pecah = f"{v:,.{d}f}".partition(".")
    utuh = utuh.replace(",", ".")
    return f"{utuh},{pecah}" if pecah else utuh


def _jam(menit):
    if menit is None or not np.isfinite(menit):
        return "—"
    if menit < 90:
        return f"{menit:.0f} mnt"
    return f"{menit / 60:.1f} jam"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rezim", default="FL", help="rezim tanam (FL / SRI)")
    ap.add_argument("--ke", default=None, help="telusuri jalur ke satu ruas saja")
    arg = ap.parse_args()

    ruas = baca_ruas(arg.rezim)
    print("=" * 78)
    print("   TIME OF TRAVEL JARINGAN D.I. LEUWIGOONG — ToT RANCANGAN, bukan terukur")
    print("=" * 78)
    print(f"  Hulu (t=0) : outlet kantong lumpur {HULU} — pangkal SI Copong")
    print(f"  Rezim      : {arg.rezim}, {len(ruas)} ruas, "
          f"{ruas.panjang_km.sum():,.1f} km".replace(",", "."))
    print("  Penampang, kemiringan, dan kekasaran DITURUNKAN dari debit — lihat")
    print("  catatan di kepala skrip sebelum memakai angkanya.")

    # ---------------------------------------------------------- per ruas ----
    baris = []
    for nama, r in ruas.iterrows():
        Q = (r["debit_l_detik"] or 0.0) / 1000.0          # l/detik -> m3/detik
        L = r["panjang_m"] or 0.0
        par = RANCANGAN.get(r["jenis"], RANCANGAN["Tersier"])
        d = {"ruas": nama, "jenis": r["jenis"], "hulu": r["hulu"],
             "terhubung": bool(r["terhubung"]), "tingkat": r["tingkat"],
             "panjang_m": L, "debit_m3_detik": Q,
             "luas_layanan_ha": r["luas_ha"]}
        if Q <= 0 or L <= 0:
            # Ruas tanpa debit rancangan tidak punya kecepatan - dikosongkan, bukan
            # diisi nol yang terbaca seperti "airnya diam".
            for k in ("v_m_detik", "h_m", "b_m", "A_m2", "froude",
                      "t_air_menit", "t_hidraulik_menit", "t_gangguan_menit"):
                d[k] = None
            baris.append(d)
            continue
        for kasus, i in KASUS.items():
            hid = hidraulika(Q, par["n"][i], par["S"][i], par["bh"][i], par["m"])
            d[f"t_air_menit_{kasus}"] = L / hid["v"] / 60
            d[f"t_hidraulik_menit_{kasus}"] = L / hid["c_k"] / 60
            if kasus == "tengah":
                # Waktu tempuh pada operasi BERGILIR: kecepatannya tidak boleh lebih
                # lambat daripada batas anti-endapan, karena saluran yang dialiri
                # selambat itu akan menutup dirinya sendiri dengan lumpur.
                d["di_bawah_v_min"] = hid["v"] < V_MIN
                d["v_operasi_m_detik"] = max(hid["v"], V_MIN)
                d["t_air_menit_giliran"] = L / max(hid["v"], V_MIN) / 60
                d.update({
                    "n": par["n"][i], "S": par["S"][i], "bh": par["bh"][i],
                    "m": par["m"], "h_m": hid["h"], "b_m": hid["b"],
                    "A_m2": hid["A"], "v_m_detik": hid["v"], "beta": hid["beta"],
                    "froude": hid["froude"],
                    "t_air_menit": L / hid["v"] / 60,
                    "t_hidraulik_menit": L / hid["c_k"] / 60,
                    "t_gangguan_menit": L / hid["c_d"] / 60,
                })
        baris.append(d)
    T = pd.DataFrame(baris).set_index("ruas", drop=False)

    # -------------------------------------------------------- kumulatif ----
    # Dijumlahkan menyusuri rantai `hulu` sampai ruas hulu sistem. Ruas yang tidak
    # tersambung ke bendung tidak punya jalur, jadi kumulatifnya dikosongkan - bukan
    # diisi waktunya sendiri, yang akan terbaca seolah ia menempel di hulu.
    for kol in ("t_air_menit", "t_hidraulik_menit", "t_gangguan_menit",
                "t_air_menit_giliran",
                "t_air_menit_cepat", "t_air_menit_lambat",
                "t_hidraulik_menit_cepat", "t_hidraulik_menit_lambat"):
        if kol not in T:
            continue
        kum = {}
        for nama in T.index:
            if not T.at[nama, "terhubung"]:
                kum[nama] = None
                continue
            jalur = jalur_ke(nama, ruas)
            nilai = [T.at[x, kol] for x in jalur if x in T.index]
            # SATU ruas tanpa waktu sudah cukup untuk membuat seluruh kumulatifnya tak
            # terjawab - waktu tempuh rantai tidak bisa dihitung kalau ada mata rantai
            # yang tidak diketahui. Dulu yang kosong dilewati begitu saja, dan jalur yang
            # SELURUH ruasnya tanpa debit rancangan memulangkan `sum([]) = 0`: DI
            # Citameng III dan IV karena itu melaporkan "air datang 0 menit", nol yang
            # terbaca persis seperti hasil.
            kum[nama] = (None if (not nilai or any(pd.isna(v) for v in nilai))
                         else sum(nilai))
        T["kum_" + kol] = pd.Series(kum)

    simpul = simpul_bangunan(ruas)
    T["simpul_hulu"] = pd.Series(simpul)
    T["node_a"] = [simpul.get(h) or h if isinstance(h, str) else HULU
                   for h in T["hulu"]]
    T["node_b"] = [simpul.get(n) or n for n in T.index]

    # Kolom jam di samping menit. Menit yang benar untuk DIJUMLAH - pembulatan jam
    # menumpuk sepanjang 7 ruas jadi kesalahan yang kelihatan - dan jam yang benar untuk
    # DIBACA: 2.040 menit dan 34 jam angka yang sama, tetapi cuma satu yang bisa
    # dibayangkan orang yang menyusun jadwal pintu.
    for kol in [c for c in T.columns if "_menit" in c]:
        T[kol.replace("_menit", "_jam")] = T[kol] / 60.0

    T.to_csv(KELUARAN / "tot_ruas.csv", index=False)

    DI = tot_per_di(T)
    if len(DI):
        DI.to_csv(KELUARAN / "tot_di.csv", index=False)
        d = DI.sort_values("tot_air_jam")
        print()
        print("=" * 96)
        print("   WAKTU DATANG AIR DI TIAP DAERAH IRIGASI — dari outlet kantong lumpur")
        print("=" * 96)
        print(f"  {'Daerah Irigasi':<22}{'luas':>7}  {'masuk lewat':<20}"
              f"{'air datang':>11}{'respons':>10}{'terisi':>10}{'selisih':>10}")
        print(f"  {'':<22}{'(ha)':>7}  {'':<20}{'':>11}{'':>10}{'penuh':>10}{'':>10}")
        print("-" * 96)
        for _, r in d.iterrows():
            print(f"  {r.di:<22}{(r.luas_cea_ha or 0):>7,.0f}  "
                  f"{str(r.ruas_masuk)[:19]:<20}{_jam(r.tot_air_jam*60):>11}"
                  f"{_jam(r.tot_hidraulik_jam*60):>10}"
                  f"{_jam(r.tot_air_jam_ujung*60):>10}"
                  f"{'+' + _jam(r.lama_terisi_jam*60):>10}".replace(",", "."))
        print("-" * 96)
        print("  'terisi penuh' = saat air mencapai ruas TERJAUH di dalam DI itu.")
        print("  Selisihnya menentukan berapa lama satu giliran harus dibuka supaya")
        print("  seluruh hamparannya kebagian, bukan cuma ujung hulunya.")

    # ------------------------------------------------------------ cetak ----
    induk = T[T.jenis.isin(["Primer", "Sekunder", "Suplesi"]) & T.terhubung
              & T.v_m_detik.notna()].sort_values("kum_t_air_menit")
    print()
    print("=" * 78)
    print("   ToT PER SEGMEN  —  Node A (hulu)  ->  Node B (hilir)")
    print("=" * 78)
    # Nama bangunan TIDAK tunggal sebagai penanda segmen - beberapa ruas berpangkal di
    # bangunan yang sama, dan tabel yang cuma menampilkan "A -> B" akan memuat baris
    # yang terlihat kembar padahal ruasnya berbeda. Nama ruasnya karena itu ikut ditulis.
    print(f"  {'Node A -> Node B':<34}{'ruas':<22}{'L':>6}{'Q':>7}{'v':>6}"
          f"{'t_air':>9}{'kumulatif':>10}")
    print(f"  {'':<34}{'':<22}{'(km)':>6}{'(m3/s)':>7}{'(m/s)':>6}{'':>9}{'(t_air)':>10}")
    print("-" * 96)
    for _, r in induk.iterrows():
        seg = f"{str(r.node_a)[:14]} -> {str(r.node_b)[:15]}"
        tanda = "*" if r.di_bawah_v_min else " "
        print(f"  {seg:<34}{str(r.ruas)[:21]:<22}{r.panjang_m/1000:>6.1f}"
              f"{r.debit_m3_detik:>7.2f}{r.v_m_detik:>5.2f}{tanda}"
              f"{_jam(r.t_air_menit):>9}{_jam(r.kum_t_air_menit):>10}")
    print("-" * 96)
    print("  * kecepatan di bawah batas anti-endapan 0,25 m/s — ruas itu tidak mungkin")
    print("    dialiri menerus sebesar debit rancangannya; lihat bagian OPERASI BERGILIR.")

    # ---- air lawan hidraulik, pada ujung-ujung terjauh ----
    ujung = T[T.terhubung & T.kum_t_air_menit.notna()].nlargest(8, "kum_t_air_menit")
    print()
    print("=" * 78)
    print("   WATER TRAVEL TIME LAWAN HYDRAULIC RESPONSE TIME — dari outlet kantong lumpur")
    print("=" * 78)
    print(f"  {'Titik hilir':<26}{'jarak':>8}{'air':>10}{'hidraulik':>11}"
          f"{'gangguan':>10}{'nisbah':>8}")
    print(f"  {'':<26}{'(km)':>8}{'(t_air)':>10}{'(t_resp)':>11}{'(riak)':>10}"
          f"{'air/resp':>8}")
    print("-" * 78)
    for _, r in ujung.iterrows():
        jarak = sum(T.at[x, "panjang_m"] for x in jalur_ke(r.ruas, ruas)
                    if x in T.index) / 1000
        nis = (r.kum_t_air_menit / r.kum_t_hidraulik_menit
               if r.kum_t_hidraulik_menit else float("nan"))
        print(f"  {str(r.ruas)[:25]:<26}{jarak:>8.1f}{_jam(r.kum_t_air_menit):>10}"
              f"{_jam(r.kum_t_hidraulik_menit):>11}"
              f"{_jam(r.kum_t_gangguan_menit):>10}{nis:>8.2f}")
    print("-" * 78)
    print("  Hidraulik SELALU lebih cepat daripada airnya sendiri: yang merambat")
    print("  perubahan tinggi muka air, bukan molekulnya. Jadwal pintu yang disusun")
    print("  memakai kolom `air` akan selalu terlambat sebesar selisih kedua kolom itu.")

    # ---- operasi bergilir ----
    lambat = T[T.di_bawah_v_min == True]                            # noqa: E712
    if len(lambat):
        pj = lambat.panjang_m.sum() / 1000
        tot_pj = T[T.v_m_detik.notna()].panjang_m.sum() / 1000
        print()
        print("=" * 96)
        print("   OPERASI BERGILIR — kenapa waktu di atas adalah BATAS ATAS")
        print("=" * 96)
        print(f"  {len(lambat)} ruas ({pj:,.1f} km, {100*pj/tot_pj:.0f} % panjang jaringan) "
              f"menghasilkan kecepatan di bawah".replace(",", "."))
        print(f"  {V_MIN} m/s kalau dialiri MENERUS sebesar debit rancangannya:")
        for j, g in lambat.groupby("jenis"):
            print(f"     {j:<10}{len(g):>4} ruas{g.panjang_m.sum()/1000:>8.1f} km")
        print()
        print("  Tidak ada saluran yang dirancang bekerja selambat itu - lumpurnya akan")
        print("  mengendap dan menutup salurannya sendiri. Yang keliru anggapannya, bukan")
        print("  hitungannya: saluran tersier memang TIDAK dialiri terus-menerus sebesar")
        print("  kebutuhan rata-ratanya, melainkan bergilir - debit lebih besar dalam waktu")
        print("  lebih pendek. Jadi waktu tempuh sesungguhnya berada di antara keduanya:")
        print()
        u = ujung.iloc[0]
        print(f"     titik terjauh {u.ruas}:")
        print(f"       dialiri menerus (batas atas) : {_jam(u.kum_t_air_menit)}")
        print(f"       dialiri bergilir (batas bawah): "
              f"{_jam(u.kum_t_air_menit_giliran)}")
        print("     Selisihnya bukan ketidakpastian hitungan, melainkan akibat CARA")
        print("     saluran dioperasikan - dan itu keputusan juru pintu, bukan sifat data.")

    # ---- pita ketidakpastian ----
    jauh = ujung.iloc[0]
    print()
    print("=" * 78)
    print(f"   PITA KETIDAKPASTIAN — titik terjauh: {jauh.ruas}")
    print("=" * 78)
    for nama, cepat, tengah, lambat in (
            ("water travel time", "kum_t_air_menit_cepat", "kum_t_air_menit",
             "kum_t_air_menit_lambat"),
            ("hydraulic response", "kum_t_hidraulik_menit_cepat",
             "kum_t_hidraulik_menit", "kum_t_hidraulik_menit_lambat")):
        c, t, l = jauh[cepat], jauh[tengah], jauh[lambat]
        print(f"  {nama:<20}{_jam(c):>10}  ..{_jam(t):>10}..  {_jam(l):>10}"
              f"   (x{l/c:.1f} dari ujung ke ujung)")
    print("  Pita selebar itu BUKAN cacat hitungan - itu ukuran seberapa banyak yang")
    print("  memang tidak diketahui. Menyempitkannya perlu data lapangan, bukan rumus.")

    # ---- sensitivitas ----
    par = RANCANGAN["Sekunder"]
    el = elastisitas(par["bh"][1], par["m"])
    print()
    print("=" * 78)
    print("   PARAMETER YANG PALING MEMENGARUHI ToT")
    print("=" * 78)
    print("  Elastisitas = berapa persen ToT berubah kalau parameternya naik 1 %.")
    print(f"  {'Parameter':<20}{'elastisitas':>13}   ToT kalau parameter +20 %")
    print("-" * 78)
    for k, v in sorted(el.items(), key=lambda x: -abs(x[1])):
        arah = "naik" if v > 0 else "turun"
        print(f"  {k:<20}{v:>+13.3f}   {arah} {abs(100*((1.2**v)-1)):>4.1f} %")
    print("-" * 78)

    # verifikasi numerik pada satu ruas nyata
    uji = induk.iloc[len(induk) // 2]
    Qu = uji.debit_m3_detik
    p = RANCANGAN[uji.jenis]
    dasar = uji.panjang_m / hidraulika(Qu, p["n"][1], p["S"][1], p["bh"][1],
                                       p["m"])["v"] / 60
    print(f"  Uji numerik pada {uji.ruas} (Q={Qu:.2f} m3/s, t={dasar:.0f} menit):")
    for label, ubah in (("n +20 %", {"n": 1.2}), ("S +20 %", {"S": 1.2}),
                        ("Q +20 %", {"Q": 1.2}), ("b/h +20 %", {"bh": 1.2})):
        nn = p["n"][1] * ubah.get("n", 1)
        SS = p["S"][1] * ubah.get("S", 1)
        bb = p["bh"][1] * ubah.get("bh", 1)
        QQ = Qu * ubah.get("Q", 1)
        t2 = uji.panjang_m / hidraulika(QQ, nn, SS, bb, p["m"])["v"] / 60
        print(f"     {label:<12}{t2:>7.0f} menit   ({100*(t2/dasar-1):>+6.1f} %)")
    print("-" * 78)
    print("  Kekasaran n paling menentukan, dan justru itu yang paling tidak diketahui:")
    print("  saluran terpelihara lawan saluran bervegetasi berselisih 40-75 % pada n,")
    print("  yang berarti ToT-nya berselisih 30-55 %. Satu hari kerja membersihkan")
    print("  saluran mengubah ToT lebih banyak daripada seluruh ketidakpastian lainnya.")
    print()
    print(f"  Keluaran: {KELUARAN / 'tot_ruas.csv'}")


if __name__ == "__main__":
    main()
