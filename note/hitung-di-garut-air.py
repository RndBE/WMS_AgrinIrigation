# -*- coding: utf-8 -*-
"""Kebutuhan air irigasi per Daerah Irigasi — 32 DI kewenangan Kabupaten Garut.

Jalankan:
    python note/hitung-di-garut-air.py            # semua DI
    python note/hitung-di-garut-air.py --uji 2    # dua DI, untuk memeriksa cepat

Keluarannya CSV di `note/output-di-garut-air/`, dibaca web-app apa adanya. Tidak ada satu
pun angka di sini yang dihitung ulang di halaman - aturan yang sama dengan seluruh repo.

Metodenya dari `note/air_kp01.py`, modul yang sama dengan `hitung-kecamatan-air.py` dan
notebook SWH-JB-GRT, jadi angkanya sebanding lurus. Yang membedakan pipeline ini:

  1. Objeknya DAERAH IRIGASI, bukan kecamatan atau petak. Luas acuannya `Luas_CEA` -
     luas baku yang DITETAPKAN Permen PUPR, bukan luas sawah hasil ukur. Itu memang
     dasar yang dipakai KP-01 untuk merancang debit: Q = DR x luas layanan. Luas sawah
     hasil penafsiran citra BIG tetap ikut dihitung sebagai pembanding, di kolom
     terpisah, supaya selisih tetapan-lawan-ukur terlihat dan tidak diam-diam tertukar.
  2. Iklimnya diambil PER DI, di titik pusat wilayahnya masing-masing. Kalau satu titik
     dipakai untuk semua, tiap DI hanya akan berbeda karena luasnya - dan tabel
     "kebutuhan air per DI" itu berubah jadi tabel luas dikali satu tetapan. Ini juga
     yang membuat mm di sini BERBEDA antar-DI, tidak seperti SWH-JB-GRT.
  3. Bulan tanamnya SATU untuk semua DI, dipilih dari yang paling hemat air se-wilayah
     dan ditimbang luas. Bulan optimum tiap DI tetap dicatat, tetapi memakai bulan yang
     berbeda-beda akan membuat angkanya tidak bisa dijumlahkan maupun dibandingkan.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.error
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

AKAR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AKAR / "web-app"))
import data as wd                      # pembaca BIG yang sudah ada, bukan salinan baru

from air_kp01 import (                                              # noqa: E402
    EFISIENSI_IRIGASI, HARI_MUSIM, LAMA_SIAP_LAHAN, NB, PERKOLASI_MM, REZIM,
    TAHUN_AKHIR, TAHUN_AWAL, WLR_MM,
    cuaca_titik as _cuaca_titik, kebutuhan_siap_lahan, ke_l_detik_ha,
    luas_ha as _luas_ha, neraca_musim, ringkas_musim,
)

SUMBER_DI = AKAR / "data" / "DI_Kewenangan_Kabupaten_Garut.geojson"
SUMBER_JARINGAN = AKAR / "data" / "DI_Leuwigoong_Jaringan.geojson"
KELUARAN = AKAR / "note" / "output-di-garut-air"
CUACA_DIR = KELUARAN / "cuaca"

# Panjang jaringan minimum di dalam satu DI supaya DI itu terhitung "di jalur irigasi".
# Bukan 0: garis batas dua DI kerap berimpit dengan salurannya sendiri, dan tanpa ambang
# ini satu simpul yang kebetulan tergeser semeter ke dalam sudah cukup untuk memasukkan
# DI yang sebenarnya cuma bersebelahan.
JARINGAN_MIN_M = 50.0

# 612 = Agrikultur Sawah seri 25K. Di bentang 32 DI ia berisi 504 objek - di bawah batas
# 1.000 per permintaan, jadi tidak perlu dipecah. Seri 10K (224) punya 32.875 objek di
# sini, jauh lebih rinci, tetapi dipakai 25K supaya sebanding dengan pipeline kecamatan.
LAPISAN_SAWAH_BIG = 612


def cuaca_titik(lat, lon, nama, jeda=0.0):
    return _cuaca_titik(lat, lon, nama, CUACA_DIR, jeda, wd.BIG_UA["User-Agent"])


def luas_ha(geom):
    return _luas_ha(geom, wd._ukuran_geom)


def ringkas_plus(df):
    """`ringkas_musim` + tiga hitungan hari yang dipakai kartu per lahan.

    Ditambahkan di sini, bukan di `air_kp01.ringkas_musim`, karena menambah kunci di
    sana akan menambah kolom pada `musim_kecamatan.csv` - keluaran pipeline lain yang
    sudah jadi. Perubahan yang tidak perlu menyentuhnya, jangan menyentuhnya.
    """
    r = ringkas_musim(df)
    tumbuh = df[df["tahap"] != "siap lahan"]
    r["hari_diairi"] = int((df["irigasi"] > 0).sum())
    r["hari_limpas"] = int((df["limpasan"] > 0).sum())
    r["hari_kering"] = int((tumbuh["tma"] < 0).sum())
    return r


def _ke_meter(geom, lat0: float, lon0: float):
    """Satu geometri dipindah ke bidang datar setempat, supaya panjang dan jaraknya
    langsung terbaca dalam meter - bukan dalam derajat, yang pada sumbu bujur dan
    sumbu lintang berarti dua panjang yang berbeda."""
    phi = math.radians(lat0)
    m_lat = 111_132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111_412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    return shapely.transform(geom, lambda c: np.column_stack([
        (c[:, 0] - lon0) * m_lon, (c[:, 1] - lat0) * m_lat]))


def ukur_jaringan(di: list[dict]) -> None:
    """Berapa panjang jaringan irigasi yang melintasi tiap DI, dan sejauh apa yang tidak.

    Ini yang memutuskan DI mana yang jadi subjek halaman. Sebabnya bukan kerapian peta:
    32 DI kewenangan kabupaten tersebar dari Leuwigoong di utara sampai kaki Cikuray di
    selatan, sedangkan jaringan yang dipetakan di repo ini cuma satu - D.I. Leuwigoong.
    DI yang berjarak 7 km dari ruas terdekatnya dilayani jaringan LAIN yang tidak ada
    datanya di sini, jadi menampilkannya berdampingan menjanjikan hubungan yang tidak
    pernah ada di datanya.

    Yang dipakai "dilewati", bukan "berdekatan". Bedanya menentukan pada lima DI yang
    berada dalam 500 m tanpa disentuh - salurannya menyusur tepi, bukan menembus - dan
    yang terbesar di antaranya 801 ha.
    """
    if not SUMBER_JARINGAN.exists():
        print(f"  {SUMBER_JARINGAN.name} tidak ada - kolom jalur irigasi dikosongkan; "
              "jalankan web-app sekali untuk mengunduhnya dari SISDA")
        for d in di:
            d["jaringan_m"] = d["jarak_jaringan_m"] = None
            d["di_jalur"] = True          # tanpa data, jangan sampai menggugurkan siapa pun
        return

    fitur = json.loads(SUMBER_JARINGAN.read_text(encoding="utf-8"))["features"]
    lat0 = sum(d["geom"].centroid.y for d in di) / len(di)
    lon0 = sum(d["geom"].centroid.x for d in di) / len(di)
    jaringan = _ke_meter(unary_union([shape(f["geometry"]) for f in fitur]), lat0, lon0)

    for d in di:
        g = _ke_meter(d["geom"], lat0, lon0)
        d["jaringan_m"] = float(g.intersection(jaringan).length)
        d["jarak_jaringan_m"] = float(g.distance(jaringan))
        d["di_jalur"] = d["jaringan_m"] >= JARINGAN_MIN_M


def daerah_irigasi():
    """32 DI beserta luas bakunya, luas sawah BIG pembanding, dan titik iklimnya."""
    fitur = json.loads(SUMBER_DI.read_text(encoding="utf-8"))["features"]
    di = []
    for f in fitur:
        p = f["properties"]
        g = shape(f["geometry"]).buffer(0)          # buffer(0) merapikan cincin cacat
        di.append({
            "di": p["Nama_DI"], "kewenangan": p["Kewenangan"], "status": p["Status"],
            "geom": g,
            "luas_cea_ha": float(p["Luas_CEA"] or 0.0),
            "luas_geom_ha": luas_ha(g),
        })

    # Sawah diambil sesuai bentang GABUNGAN seluruh DI, lalu diiris per DI dengan
    # pemotongan poligon sungguhan - bukan penetapan lewat titik pusat, yang pada blok
    # sawah memanjang gampang jatuh ke DI sebelah.
    bb = [min(d["geom"].bounds[0] for d in di), min(d["geom"].bounds[1] for d in di),
          max(d["geom"].bounds[2] for d in di), max(d["geom"].bounds[3] for d in di)]
    balasan = wd._query_big(LAPISAN_SAWAH_BIG, bb)
    sawah = [shape(f["geometry"]).buffer(0) for f in balasan.get("features") or []]
    sawah = [g for g in sawah if not g.is_empty]
    if len(sawah) >= wd.BIG_MAKS_FITUR:
        print(f"  PERINGATAN: sawah BIG kena batas {wd.BIG_MAKS_FITUR} objek - "
              "luasnya kurang, bentangnya perlu dipecah")
    print(f"  sawah BIG RBI 25K: {len(sawah)} objek pada bentang gabungan 32 DI")

    pohon = STRtree(sawah)
    for d in di:
        potong = [sawah[i].intersection(d["geom"]) for i in pohon.query(d["geom"])]
        d["luas_sawah_big_ha"] = sum(luas_ha(p) for p in potong if not p.is_empty)
        pusat = d["geom"].representative_point()    # selalu DI DALAM poligon
        d["lat"], d["lon"] = float(pusat.y), float(pusat.x)
    return di


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--uji", type=int, default=0, help="hanya N DI pertama")
    ap.add_argument("--semua", action="store_true",
                    help="hitung SELURUH DI, termasuk yang tidak dilewati jaringan")
    ap.add_argument("--jeda", type=float, default=1.0,
                    help="jeda detik antar unduhan cuaca")
    arg = ap.parse_args()

    KELUARAN.mkdir(parents=True, exist_ok=True)
    print("=" * 78)
    print("   KEBUTUHAN AIR IRIGASI PER DAERAH IRIGASI - Kab. Garut, KP-01 / FAO-56")
    print("=" * 78)

    di = daerah_irigasi()
    ukur_jaringan(di)
    di.sort(key=lambda d: -d["luas_cea_ha"])

    # Daftar jalur ditulis untuk SELURUH DI, termasuk yang digugurkan - halaman perlu
    # tahu berapa yang disisihkan dan seluas apa, dan itu tidak bisa diketahui dari
    # berkas yang cuma memuat yang lolos.
    pd.DataFrame([{
        "di": d["di"], "luas_cea_ha": d["luas_cea_ha"],
        "jaringan_m": d["jaringan_m"], "jarak_jaringan_m": d["jarak_jaringan_m"],
        "di_jalur": d["di_jalur"],
    } for d in di]).to_csv(KELUARAN / "di_jalur.csv", index=False)

    if not arg.semua:
        luar = [d for d in di if not d["di_jalur"]]
        di = [d for d in di if d["di_jalur"]]
        print(f"  {len(luar)} DI DISISIHKAN - tidak dilewati jaringan D.I. Leuwigoong "
              f"({sum(d['luas_cea_ha'] for d in luar):,.0f} ha). Dilayani jaringan lain"
              .replace(",", "."))
        print("  yang tidak ada datanya di repo ini. Pakai --semua untuk tetap "
              "menghitungnya.")
        dekat = sorted((d for d in luar if (d["jarak_jaringan_m"] or 9e9) < 500),
                       key=lambda d: d["jarak_jaringan_m"])
        if dekat:
            print("  Yang paling dekat tapi tetap tidak dilewati: " +
                  ", ".join(f"{d['di']} {d['jarak_jaringan_m']:.0f} m" for d in dekat))
    if arg.uji:
        di = di[:arg.uji]
    print(f"  {len(di)} Daerah Irigasi diproses, "
          f"{sum(d['luas_cea_ha'] for d in di):,.0f} ha luas baku\n".replace(",", "."))

    # ---- cuaca + pindai bulan tanam per DI ----
    #
    # Satu DI yang cuacanya gagal diambil TIDAK menggugurkan seluruh jalan. Layanan
    # cuaca berkuota, dan 32 unduhan berturut-turut cukup untuk menyentuhnya; kalau
    # satu penolakan membuang 31 hasil yang sudah benar, pipeline ini praktis tidak
    # bisa diselesaikan pada hari yang sibuk. DI yang terlewat dicatat namanya,
    # dilaporkan di akhir, dan TIDAK diisi angka dari DI lain - halaman sudah punya
    # cara menampilkan "belum dihitung", dan itu jauh lebih jujur daripada menambal
    # dengan iklim tetangga yang kelihatan seperti hasil.
    musim, terlewat = [], []
    for n, d in enumerate(di, 1):
        try:
            cuaca, elev = cuaca_titik(d["lat"], d["lon"], d["di"], arg.jeda)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            terlewat.append((d["di"], str(e)))
            print(f"  [{n:>2}/{len(di)}] {d['di']:<24} DILEWATI - cuaca tak terambil: {e}")
            continue
        d["elevasi_m"] = elev
        d["eto_rata"] = float(cuaca["eto_pm"].mean())
        d["hujan_tahunan_mm"] = float(cuaca.groupby("tahun")["hujan"].sum().mean())
        print(f"  [{n:>2}/{len(di)}] {d['di']:<24} "
              f"{d['luas_cea_ha']:>6,.0f} ha baku | {d['luas_sawah_big_ha']:>6,.0f} ha sawah BIG"
              f" | {elev:>4.0f} m dpl | ETo {d['eto_rata']:.2f} | "
              f"hujan {d['hujan_tahunan_mm']:>5.0f} mm/th")
        for bulan in range(1, 13):
            for rz in REZIM:
                for th in range(TAHUN_AWAL, TAHUN_AKHIR):
                    df = neraca_musim(date(th, bulan, 1), rz, cuaca)
                    if df is None:
                        continue
                    r = ringkas_plus(df)
                    r.update({"di": d["di"], "rezim": rz, "bulan": bulan,
                              "tahun_tanam": th})
                    musim.append(r)
    MUSIM = pd.DataFrame(musim)

    # ---- bulan tanam bersama: paling hemat air se-wilayah, ditimbang luas baku ----
    luas = {d["di"]: d["luas_cea_ha"] for d in di}
    fl = MUSIM[MUSIM.rezim == "FL"]
    per_bulan = fl.groupby(["bulan", "di"])["irigasi_mm"].median().reset_index()
    per_bulan["bobot"] = per_bulan["di"].map(luas)
    tertimbang = (per_bulan.assign(v=lambda x: x.irigasi_mm * x.bobot)
                  .groupby("bulan").apply(lambda x: x.v.sum() / x.bobot.sum(),
                                          include_groups=False))
    BULAN_TANAM = int(tertimbang.idxmin())
    print(f"\n  Bulan tanam bersama: {NB[BULAN_TANAM - 1]} "
          f"({tertimbang.min():.0f} mm irigasi tertimbang luas; "
          f"terboros {NB[int(tertimbang.idxmax()) - 1]} {tertimbang.max():.0f} mm)")

    # ---- ringkas per DI pada bulan tanam bersama ----
    baris = []
    for d in di:
        for rz in REZIM:
            sel = MUSIM[(MUSIM.di == d["di"]) & (MUSIM.rezim == rz) &
                        (MUSIM.bulan == BULAN_TANAM)]
            if sel.empty:
                continue
            ha = d["luas_cea_ha"]
            med = float(sel["irigasi_mm"].median())
            and80 = float(np.percentile(sel["irigasi_mm"], 80))
            nfr, nfr_and = med / HARI_MUSIM, and80 / HARI_MUSIM
            opt = (MUSIM[(MUSIM.di == d["di"]) & (MUSIM.rezim == rz)]
                   .groupby("bulan")["irigasi_mm"].median().idxmin())

            # Tiga jalan keluarnya air. Diambil median tahun-ke-tahun masing-masing,
            # bukan diturunkan dari satu musim tertentu, supaya sebangun dengan cara
            # irigasi_mm diambil di baris di atas.
            etc = float(sel["etc_mm"].median())
            perk = float(sel["perkolasi_mm"].median())
            limp = float(sel["limpasan_mm"].median())
            hujan = float(sel["hujan_mm"].median())
            keluar, masuk = etc + perk + limp, hujan + med
            m3 = lambda mm: mm * ha * 10.0          # 1 mm x 1 ha = 10 m3
            pct = lambda x: 100.0 * x / keluar if keluar else None

            baris.append({
                "petak": d["di"], "di": d["di"], "rezim": rz,
                "kewenangan": d["kewenangan"], "status": d["status"],
                "jaringan_m": d["jaringan_m"],
                "jarak_jaringan_m": d["jarak_jaringan_m"],
                "tanam": NB[BULAN_TANAM - 1], "bulan_tanam_optimum": NB[int(opt) - 1],
                "luas_ha": ha, "luas_m2": ha * 1e4,
                "luas_cea_ha": ha, "luas_geom_ha": d["luas_geom_ha"],
                "luas_sawah_big_ha": d["luas_sawah_big_ha"],
                "lat": d["lat"], "lon": d["lon"], "elev_rata_m": d["elevasi_m"],
                "eto_rata_mm_hari": d["eto_rata"],
                "hujan_tahunan_mm": d["hujan_tahunan_mm"],
                "n_musim": int(len(sel)),
                "hujan_mm": hujan,
                "irigasi_mm": med, "irigasi_m3": m3(med),
                "irigasi_mm_andalan": and80, "irigasi_m3_andalan": m3(and80),
                "nfr_mm_hari": nfr, "dr_l_detik_ha": ke_l_detik_ha(nfr),
                "debit_l_detik": ke_l_detik_ha(nfr) * ha,
                "debit_l_detik_andalan": ke_l_detik_ha(nfr_and) * ha,
                "etc_mm": etc, "etc_m3": m3(etc),
                "perkolasi_mm": perk, "perkolasi_m3": m3(perk),
                "limpasan_mm": limp, "limpasan_m3": m3(limp),
                "masuk_mm": masuk, "keluar_mm": keluar,
                "water_loss_m3": m3(keluar),
                "etc_pct": pct(etc), "perkolasi_pct": pct(perk), "limpasan_pct": pct(limp),
                "loss_pct_masuk": 100.0 * keluar / masuk if masuk else None,
                "irigasi_pct_masuk": 100.0 * med / masuk if masuk else None,
                "hujan_pct_masuk": 100.0 * hujan / masuk if masuk else None,
                "tma_rata": float(sel["tma_rata"].median()),
                "tma_min": float(sel["tma_min"].median()),
                "hari_diairi": float(sel["hari_diairi"].median()),
                "hari_kering": float(sel["hari_kering"].median()),
                "hari_limpas": float(sel["hari_limpas"].median()),
            })
    HASIL = pd.DataFrame(baris)

    # ---- simpan ----
    HASIL.to_csv(KELUARAN / "kebutuhan_air_di.csv", index=False)
    MUSIM.to_csv(KELUARAN / "musim_di.csv", index=False)

    # `--uji` MENIMPA keluaran penuh dengan hasil sebagian, dan berkasnya tidak
    # kelihatan berbeda dari luar. Sudah kejadian: keluaran `--uji 2` tertinggal di
    # cakram, lalu halaman web menyandingkan luas 32 DI dengan air 2 DI selama entah
    # berapa lama - dua angka yang benar sendiri-sendiri dan salah kalau dibaca
    # berpasangan. Halaman sekarang menandainya sendiri, tetapi peringatan di sini
    # jauh lebih awal: ia muncul pada orang yang sedang menimpanya.
    if arg.uji:
        print()
        print("  " + "!" * 74)
        print(f"  PERHATIAN: --uji {arg.uji} baru saja MENIMPA kebutuhan_air_di.csv "
              f"dengan {len(di)} DI saja.")
        print("  Web-app akan menampilkan luas 32 DI berdampingan dengan air "
              f"{len(di)} DI, dan menandainya")
        print("  sebagai cakupan belum penuh. Jalankan tanpa --uji untuk memulihkan:")
        print("      python note/hitung-di-garut-air.py")
        print("  " + "!" * 74)

    fl_h = HASIL[HASIL.rezim == "FL"]
    ha_tot = float(fl_h["luas_ha"].sum())
    # Debit penyiapan lahan dihitung dari ETo rata-rata tertimbang luas: fase ini
    # memakai rumus Van de Goor & Zijlstra, bukan neraca harian, jadi ia tidak ikut
    # keluar dari `neraca_musim` sebagai satu angka puncak.
    eto_bobot = float((fl_h["eto_rata_mm_hari"] * fl_h["luas_ha"]).sum() / ha_tot)
    ir_pl = kebutuhan_siap_lahan(eto_bobot, PERKOLASI_MM)
    pd.DataFrame([{
        "n_di": len(di) - len(terlewat), "n_di_terlewat": len(terlewat),
        "di_terlewat": "; ".join(n for n, _ in terlewat),
        "bulan_tanam": NB[BULAN_TANAM - 1], "hari_musim": HARI_MUSIM,
        "lama_siap_lahan_hari": LAMA_SIAP_LAHAN,
        "tahun_cuaca": f"{TAHUN_AWAL}-{TAHUN_AKHIR}",
        "sumber_cuaca": "Open-Meteo ERA5-Land", "metode_eto": "FAO-56 Penman-Monteith",
        "sumber_luas": "Luas_CEA (Permen PUPR No. 14/2015) via SISDA",
        "sumber_sawah_pembanding": "BIG RBI 25K Agrikultur Sawah (612)",
        "eto_rata_mm_hari": eto_bobot,
        "perkolasi_mm_hari": PERKOLASI_MM, "efisiensi_jaringan": EFISIENSI_IRIGASI,
        "wlr_mm": WLR_MM,
        "luas_baku_total_ha": ha_tot,
        "luas_sawah_big_total_ha": float(fl_h["luas_sawah_big_ha"].sum()),
        "debit_siap_lahan_l_detik": ke_l_detik_ha(ir_pl) * ha_tot,
        "debit_total_l_detik_FL": float(fl_h["debit_l_detik"].sum()),
        "volume_total_m3_FL": float(fl_h["irigasi_m3"].sum()),
        "water_loss_total_m3_FL": float(fl_h["water_loss_m3"].sum()),
    }]).to_csv(KELUARAN / "ringkasan_air.csv", index=False)

    # ---- cetak tabel ----
    t = fl_h.sort_values("debit_l_detik", ascending=False)
    print()
    print("=" * 78)
    print(f"   KEBUTUHAN AIR PER DI - rezim FL, tanam {NB[BULAN_TANAM - 1]}, "
          f"musim {HARI_MUSIM} hari")
    print("=" * 78)
    print(f"  {'Daerah Irigasi':<24}{'baku':>8}{'irigasi':>9}{'DR':>11}"
          f"{'debit':>10}{'loss':>12}")
    print(f"  {'':<24}{'(ha)':>8}{'(mm)':>9}{'(l/dt/ha)':>11}{'(l/dt)':>10}{'(ribu m3)':>12}")
    print("-" * 78)
    for _, r in t.iterrows():
        print(f"  {r.di:<24}{r.luas_ha:>8,.0f}{r.irigasi_mm:>9,.0f}"
              f"{r.dr_l_detik_ha:>11.2f}{r.debit_l_detik:>10,.0f}"
              f"{r.water_loss_m3/1000:>12,.0f}")
    print("-" * 78)
    print(f"  {'TOTAL':<24}{t.luas_ha.sum():>8,.0f}{'':>9}{'':>11}"
          f"{t.debit_l_detik.sum():>10,.0f}{t.water_loss_m3.sum()/1000:>12,.0f}")
    print("=" * 78)
    print(f"  Sawah BIG pembanding: {fl_h['luas_sawah_big_ha'].sum():,.0f} ha "
          f"({100*fl_h['luas_sawah_big_ha'].sum()/ha_tot:.0f}% dari luas baku)")
    if terlewat:
        luas_lewat = sum(d["luas_cea_ha"] for d in di
                         if d["di"] in {n for n, _ in terlewat})
        print()
        print(f"  {len(terlewat)} DI BELUM terhitung ({luas_lewat:,.0f} ha, "
              f"{100*luas_lewat/(ha_tot+luas_lewat):.1f}% dari luas baku) - cuacanya "
              "tidak terambil:")
        for nama, sebab in terlewat:
            print(f"    - {nama}: {sebab}")
        print("  Jalankan ulang skrip ini nanti; yang sudah terunduh tidak diambil lagi.")
    print(f"  Keluaran: {KELUARAN}")


if __name__ == "__main__":
    main()
