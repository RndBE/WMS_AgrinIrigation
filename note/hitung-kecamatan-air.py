# -*- coding: utf-8 -*-
"""Kebutuhan air irigasi per kecamatan — D.I. Leuwigoong dan sekitarnya.

Jalankan:
    python note/hitung-kecamatan-air.py            # semua kecamatan
    python note/hitung-kecamatan-air.py --uji 1    # satu kecamatan, untuk memeriksa

Keluarannya CSV di `note/output-kecamatan-air/`, dibaca web-app apa adanya. Tidak ada
satu pun angka di sini yang dihitung ulang di halaman - aturan yang sama dengan seluruh
repo ini.

Metodenya PERSIS pipeline `note/note-swh-jb_grt-air.ipynb` - rumus, tetapan, dan urutan
langkahnya sekarang tinggal di `note/air_kp01.py` dan dipakai bersama, bukan disalin lagi
ke tiap pipeline - supaya angkanya sebanding lurus dengan hasil SWH-JB-GRT dan dengan
`hitung-di-garut-air.py`. Yang berbeda hanya tiga hal:

  1. Objeknya KECAMATAN, bukan petak. Luas sawahnya dari irisan poligon sungguhan antara
     `batas_kec_cimancis` (SISDA) dan lapisan Agrikultur Sawah BIG RBI 25K.
  2. Iklimnya diambil PER KECAMATAN, di titik pusat wilayahnya masing-masing. Kalau satu
     titik dipakai untuk semua, tiap kecamatan hanya akan berbeda karena luasnya - dan
     tabel "kebutuhan air per kecamatan" itu berubah jadi tabel luas dikali satu tetapan.
  3. Bulan tanamnya SATU untuk semua kecamatan, dipilih dari yang paling hemat air
     se-wilayah. Bulan optimum tiap kecamatan tetap ikut dicatat, tetapi memakai bulan
     yang berbeda-beda akan membuat angkanya tidak bisa dijumlahkan maupun dibandingkan.
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import shape
from shapely.strtree import STRtree

AKAR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AKAR / "web-app"))
import data as wd                      # pembaca WFS/BIG yang sudah ada, bukan salinan baru

KELUARAN = AKAR / "note" / "output-kecamatan-air"
CUACA_DIR = KELUARAN / "cuaca"

# Metode, tetapan, dan pengambil cuaca dipakai bersama - lihat note/air_kp01.py.
from air_kp01 import (                                              # noqa: E402
    EFISIENSI_IRIGASI, HARI_MUSIM, LAMA_SIAP_LAHAN, NB, PERKOLASI_MM, REZIM,
    TAHUN_AKHIR, TAHUN_AWAL, WLR_MM,
    cuaca_titik as _cuaca_titik, ke_l_detik_ha, luas_ha as _luas_ha,
    neraca_musim, ringkas_musim,
)

# Lapisan sumber. 612 = Agrikultur Sawah seri 25K; seri lain kosong di wilayah ini
# (sudah diuji, lihat catatan di web-app/data.py).
LAPISAN_SAWAH_BIG = 612
LAPISAN_KECAMATAN = "batas_kec_cimancis"
# Kecamatan yang wilayahnya di bawah ini cuma serpihan potongan batas wilayah sungai,
# bukan kecamatan yang benar-benar ada di sini - tiga di antaranya seluas 2-8 ha.
LUAS_KEC_MINIMUM_HA = 100.0


def cuaca_titik(lat, lon, nama, jeda=0.0):
    return _cuaca_titik(lat, lon, nama, CUACA_DIR, jeda, wd.BIG_UA["User-Agent"])


def luas_ha(geom):
    return _luas_ha(geom, wd._ukuran_geom)


def kecamatan_dan_sawah():
    """Kecamatan beserta luas sawahnya, dari irisan poligon sungguhan."""
    kotak = wd.LOKASI["leuwigoong"]["kotak"]
    fitur = wd._minta_gc(LAPISAN_KECAMATAN, kotak)["features"]
    kec = []
    for f in fitur:
        g = shape(f["geometry"]).buffer(0)
        p = f["properties"]
        kec.append({"kecamatan": p["WADMKC"], "kabupaten": p["WADMKK"],
                    "provinsi": p["WADMPR"], "geom": g, "luas_wilayah_ha": luas_ha(g)})
    dibuang = [k for k in kec if k["luas_wilayah_ha"] < LUAS_KEC_MINIMUM_HA]
    kec = [k for k in kec if k["luas_wilayah_ha"] >= LUAS_KEC_MINIMUM_HA]
    if dibuang:
        print(f"  {len(dibuang)} kecamatan dilewati karena di layanannya cuma serpihan "
              f"potongan batas wilayah sungai: " +
              ", ".join(f"{d['kecamatan']} {d['luas_wilayah_ha']:.0f} ha" for d in dibuang))

    # Sawah diambil sesuai bentang KECAMATAN, bukan kotak AOI - kalau memakai kotak AOI,
    # kecamatan yang menjulur keluar akan kehilangan sawahnya tanpa ada yang tahu.
    bb = [min(k["geom"].bounds[0] for k in kec), min(k["geom"].bounds[1] for k in kec),
          max(k["geom"].bounds[2] for k in kec), max(k["geom"].bounds[3] for k in kec)]
    balasan = wd._query_big(LAPISAN_SAWAH_BIG, bb)
    sawah = [shape(f["geometry"]).buffer(0) for f in balasan.get("features") or []]
    sawah = [g for g in sawah if not g.is_empty]
    if len(sawah) >= wd.BIG_MAKS_FITUR:
        print(f"  PERINGATAN: sawah BIG kena batas {wd.BIG_MAKS_FITUR} objek — "
              "luasnya kurang, bentangnya perlu dipecah")
    print(f"  sawah BIG RBI 25K: {len(sawah)} objek pada bentang gabungan kecamatan")

    pohon = STRtree(sawah)
    for k in kec:
        potong = [sawah[i].intersection(k["geom"]) for i in pohon.query(k["geom"])]
        k["luas_sawah_ha"] = sum(luas_ha(p) for p in potong if not p.is_empty)
        pusat = k["geom"].representative_point()      # selalu DI DALAM poligon
        k["lat"], k["lon"] = float(pusat.y), float(pusat.x)
    return kec


# ==================================== jalankan ====================================
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--uji", type=int, default=0,
                    help="hanya N kecamatan pertama (untuk memeriksa dengan cepat)")
    ap.add_argument("--jeda", type=float, default=1.0,
                    help="jeda detik antar unduhan cuaca")
    arg = ap.parse_args()

    KELUARAN.mkdir(parents=True, exist_ok=True)
    print("=" * 78)
    print("     KEBUTUHAN AIR IRIGASI PER KECAMATAN — metode KP-01 / FAO-56")
    print("=" * 78)

    kec = kecamatan_dan_sawah()
    kec.sort(key=lambda k: -k["luas_sawah_ha"])
    if arg.uji:
        kec = kec[:arg.uji]
    print(f"  {len(kec)} kecamatan diproses\n")

    # ---- cuaca + pindai bulan tanam per kecamatan ----
    musim = []                          # satu baris per (kecamatan, rezim, bulan, tahun)
    for n, k in enumerate(kec, 1):
        cuaca, elev = cuaca_titik(k["lat"], k["lon"], k["kecamatan"], arg.jeda)
        k["elevasi_m"] = elev
        k["eto_rata"] = float(cuaca["eto_pm"].mean())
        k["hujan_tahunan_mm"] = float(cuaca.groupby("tahun")["hujan"].sum().mean())
        print(f"  [{n:>2}/{len(kec)}] {k['kecamatan']:<20} "
              f"{k['luas_sawah_ha']:>7.0f} ha sawah | {elev:>4.0f} m dpl | "
              f"ETo {k['eto_rata']:.2f} mm/hari | hujan {k['hujan_tahunan_mm']:>5.0f} mm/th")
        for bulan in range(1, 13):
            for rz in REZIM:
                for th in range(TAHUN_AWAL, TAHUN_AKHIR):
                    df = neraca_musim(date(th, bulan, 1), rz, cuaca)
                    if df is None:
                        continue
                    r = ringkas_musim(df)
                    r.update({"kecamatan": k["kecamatan"], "rezim": rz,
                              "bulan": bulan, "tahun_tanam": th})
                    musim.append(r)
    MUSIM = pd.DataFrame(musim)

    # ---- bulan tanam bersama: paling hemat air se-wilayah, ditimbang luas sawah ----
    luas = {k["kecamatan"]: k["luas_sawah_ha"] for k in kec}
    fl = MUSIM[MUSIM.rezim == "FL"].copy()
    fl["bobot"] = fl["kecamatan"].map(luas)
    per_bulan = (fl.groupby(["bulan", "kecamatan"])["irigasi_mm"].median().reset_index())
    per_bulan["bobot"] = per_bulan["kecamatan"].map(luas)
    tertimbang = (per_bulan.assign(v=lambda d: d.irigasi_mm * d.bobot)
                  .groupby("bulan").apply(lambda d: d.v.sum() / d.bobot.sum(),
                                          include_groups=False))
    BULAN_TANAM = int(tertimbang.idxmin())
    print(f"\n  Bulan tanam bersama: {NB[BULAN_TANAM - 1]} "
          f"({tertimbang.min():.0f} mm irigasi tertimbang luas; "
          f"terboros {NB[int(tertimbang.idxmax()) - 1]} {tertimbang.max():.0f} mm)")

    # ---- ringkas per kecamatan pada bulan tanam bersama ----
    baris = []
    for k in kec:
        for rz in REZIM:
            sel = MUSIM[(MUSIM.kecamatan == k["kecamatan"]) & (MUSIM.rezim == rz) &
                        (MUSIM.bulan == BULAN_TANAM)]
            if sel.empty:
                continue
            med = float(sel["irigasi_mm"].median())
            and80 = float(np.percentile(sel["irigasi_mm"], 80))
            opt = (MUSIM[(MUSIM.kecamatan == k["kecamatan"]) & (MUSIM.rezim == rz)]
                   .groupby("bulan")["irigasi_mm"].median().idxmin())
            nfr = med / HARI_MUSIM
            nfr_and = and80 / HARI_MUSIM
            ha = k["luas_sawah_ha"]
            baris.append({
                "kecamatan": k["kecamatan"], "kabupaten": k["kabupaten"], "rezim": rz,
                "luas_sawah_ha": ha, "luas_wilayah_ha": k["luas_wilayah_ha"],
                "lat": k["lat"], "lon": k["lon"], "elevasi_m": k["elevasi_m"],
                "eto_rata_mm_hari": k["eto_rata"],
                "hujan_tahunan_mm": k["hujan_tahunan_mm"],
                "bulan_tanam": NB[BULAN_TANAM - 1],
                "bulan_tanam_optimum": NB[int(opt) - 1],
                "n_musim": int(len(sel)),
                "hujan_musim_mm": float(sel["hujan_mm"].median()),
                "etc_mm": float(sel["etc_mm"].median()),
                "perkolasi_mm": float(sel["perkolasi_mm"].median()),
                "limpasan_mm": float(sel["limpasan_mm"].median()),
                "irigasi_mm": med, "irigasi_mm_andalan": and80,
                "nfr_mm_hari": nfr, "nfr_mm_hari_andalan": nfr_and,
                "dr_l_detik_ha": ke_l_detik_ha(nfr),
                "dr_l_detik_ha_andalan": ke_l_detik_ha(nfr_and),
                "debit_l_detik": ke_l_detik_ha(nfr) * ha,
                "debit_l_detik_andalan": ke_l_detik_ha(nfr_and) * ha,
                "volume_m3": med * ha * 10.0,          # 1 mm x 1 ha = 10 m3
                "volume_m3_andalan": and80 * ha * 10.0,
            })
    HASIL = pd.DataFrame(baris)

    # ---- simpan ----
    HASIL.to_csv(KELUARAN / "kebutuhan_air_kecamatan.csv", index=False)
    MUSIM.to_csv(KELUARAN / "musim_kecamatan.csv", index=False)
    pd.DataFrame([{
        "n_kecamatan": len(kec), "n_musim_per_kecamatan": int(MUSIM["tahun_tanam"].nunique()),
        "tahun_cuaca": f"{TAHUN_AWAL}-{TAHUN_AKHIR}",
        "sumber_cuaca": "Open-Meteo ERA5-Land", "metode_eto": "FAO-56 Penman-Monteith",
        "sumber_sawah": "BIG RBI 25K lapisan Agrikultur Sawah (612)",
        "sumber_batas": f"SISDA {LAPISAN_KECAMATAN}",
        "bulan_tanam": NB[BULAN_TANAM - 1], "hari_musim": HARI_MUSIM,
        "perkolasi_mm_hari": PERKOLASI_MM, "efisiensi_jaringan": EFISIENSI_IRIGASI,
        "wlr_mm": WLR_MM, "lama_siap_lahan_hari": LAMA_SIAP_LAHAN,
        "luas_sawah_total_ha": sum(k["luas_sawah_ha"] for k in kec),
        "debit_total_l_detik_FL": float(
            HASIL[HASIL.rezim == "FL"]["debit_l_detik"].sum()),
        "volume_total_m3_FL": float(HASIL[HASIL.rezim == "FL"]["volume_m3"].sum()),
    }]).to_csv(KELUARAN / "ringkasan_kecamatan_air.csv", index=False)

    # ---- cetak tabel ----
    fl = HASIL[HASIL.rezim == "FL"].sort_values("debit_l_detik", ascending=False)
    print()
    print("=" * 78)
    print(f"   KEBUTUHAN AIR PER KECAMATAN — rezim FL, tanam {NB[BULAN_TANAM - 1]}, "
          f"musim {HARI_MUSIM} hari")
    print("=" * 78)
    print(f"  {'kecamatan':<19}{'sawah':>9}{'irigasi':>10}{'DR':>13}{'debit':>12}{'volume':>13}")
    print(f"  {'':<19}{'(ha)':>9}{'(mm)':>10}{'(l/dt/ha)':>13}{'(l/detik)':>12}{'(ribu m3)':>13}")
    print("-" * 78)
    for _, r in fl.iterrows():
        print(f"  {r.kecamatan:<19}{r.luas_sawah_ha:>9,.0f}{r.irigasi_mm:>10,.0f}"
              f"{r.dr_l_detik_ha:>13.2f}{r.debit_l_detik:>12,.0f}{r.volume_m3/1000:>13,.0f}")
    print("-" * 78)
    print(f"  {'TOTAL':<19}{fl.luas_sawah_ha.sum():>9,.0f}{'':>10}{'':>13}"
          f"{fl.debit_l_detik.sum():>12,.0f}{fl.volume_m3.sum()/1000:>13,.0f}")
    print("=" * 78)
    print(f"  Keluaran: {KELUARAN}")


if __name__ == "__main__":
    main()
