# -*- coding: utf-8 -*-
"""Daftar saluran irigasi per Daerah Irigasi yang DILEWATI jaringan D.I. Leuwigoong.

Jalankan:
    python note/daftar-irigasi.py
    python note/daftar-irigasi.py --rezim SRI
    python note/daftar-irigasi.py --di "DI Parigi"     # rincian satu DI saja
    python note/daftar-irigasi.py --semua              # rincian seluruh DI

Keluarannya CSV di `note/output-jaringan-air/`:
    daftar_irigasi_di.csv     satu baris per DI - rekap salurannya
    daftar_irigasi_ruas.csv   satu baris per (saluran x DI) - daftar rincinya

===============================================================================
APA YANG DIDAFTAR, DAN APA YANG TIDAK
===============================================================================
`di_jalur.csv` sudah menjawab DI MANA SAJA yang dilewati jaringan ini - 11 dari 32 DI
kewenangan Kabupaten Garut. Yang belum dijawab di mana pun: DI itu dialiri SALURAN YANG
MANA. Skrip ini menjembatani keduanya lewat irisan geometri - ruas mana saja yang
menembus poligon tiap DI - lalu menempelkan atribut ruasnya dari pipeline yang sudah ada:

    nama, kode, jenis, tingkat, hulu     `jaringan_ruas.geojson` (SISDA)
    panjang, debit, luas layanan         `kebutuhan_air_ruas.csv` (KP-01)
    waktu datang air                     `tot_ruas.csv` (ToT rancangan)

Ambangnya 50 m irisan, angka yang sama dengan `JARINGAN_MIN_M` di
`hitung-di-garut-air.py`, supaya daftar ini dan `di_jalur.csv` menyebut himpunan DI yang
sama persis. Konsekuensinya `n_saluran` di sini LEBIH KECIL daripada `n_ruas` di
`tot_di.csv`: di sana dipakai `intersects` tanpa ambang, jadi ruas yang cuma menyerempet
batas sepanjang beberapa meter ikut terhitung. Untuk menjawab "kapan air pertama masuk"
serempetan itu tidak apa-apa; untuk daftar yang dibaca orang, ia cuma derau garis batas.

DUA HAL YANG PERLU DIBACA SEBELUM MEMAKAI ANGKANYA

  1. "Dilewati" bukan "dilayani". Poligon DI kewenangan kabupaten dan jaringan D.I.
     Leuwigoong berasal dari dua pendataan yang berbeda dan bertampalan di lapangan:
     Leuwigoong sendiri DI kewenangan pusat, dan poligonnya tidak ada di data repo ini.
     Jadi satu saluran yang menembus DI Parigi tidak dengan sendirinya milik DI Parigi -
     yang pasti hanya bahwa ia melintas di sana. Daftar ini menjawab "saluran apa yang
     ada di wilayah DI ini", bukan "saluran ini kewenangan siapa".

  2. Luas layanan dibagi menurut PANGSA PANJANG. Satu ruas tersier yang separuh
     panjangnya di dalam DI A dan separuh di DI B dicatat separuh-separuh luas
     layanannya. Sel sawah 100 m yang jadi dasar luas itu sebetulnya diketahui letaknya
     di `hitung-jaringan-air.py`, tapi tidak disimpan per sel, jadi pembagian ini
     pendekatan - bukan penjumlahan ulang sel per DI. Kolom `luas_layanan_ha` (luas
     penuh ruas) disimpan berdampingan supaya selisihnya kelihatan; pada ruas primer
     yang panjang, selisih itu paling besar.

Total luas layanan seluruh DI dalam daftar ini TIDAK sama dengan luas layanan jaringan:
sebagian sawah yang dilayani berada di luar semua poligon DI kabupaten. Selisihnya
dicetak di akhir, bukan disembunyikan.
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
from shapely.strtree import STRtree

AKAR = Path(__file__).resolve().parent.parent
KELUARAN = AKAR / "note" / "output-jaringan-air"
SUMBER_AIR = KELUARAN / "kebutuhan_air_ruas.csv"
SUMBER_RUAS = KELUARAN / "jaringan_ruas.geojson"
SUMBER_TOT = KELUARAN / "tot_ruas.csv"
SUMBER_DI = AKAR / "data" / "DI_Kewenangan_Kabupaten_Garut.geojson"

# Ambang irisan. Sama dengan JARINGAN_MIN_M di `hitung-di-garut-air.py` - dua daftar yang
# mengaku menyebut himpunan DI yang sama harus memakai ambang yang sama.
IRIS_MIN_M = 50.0

URUT_JENIS = {"Primer": 0, "Sekunder": 1, "Tersier": 2, "Suplesi": 3}


# ======================================================================= geometri
def bidang(lat0: float, lon0: float):
    """Derajat -> meter pada bidang datar setempat, sebangun dengan pipeline lain.

    Ambang 50 m tidak boleh berarti dua panjang yang berbeda tergantung arah salurannya,
    dan pada derajat memang begitu: di lintang 7 derajat, satu derajat bujur 1,3 % lebih
    pendek daripada satu derajat lintang.
    """
    phi = math.radians(lat0)
    m_lat = 111_132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111_412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    return lambda geom: shapely.transform(geom, lambda c: np.column_stack([
        (c[:, 0] - lon0) * m_lon, (c[:, 1] - lat0) * m_lat]))


# ==================================================================== baca sumber
def baca_ruas(rezim: str) -> pd.DataFrame:
    if not SUMBER_AIR.exists():
        raise SystemExit(f"{SUMBER_AIR.name} belum ada — jalankan "
                         "`python note/hitung-jaringan-air.py` lebih dulu")
    d = pd.read_csv(SUMBER_AIR)
    d = d[d["rezim"] == rezim].copy()
    if d.empty:
        raise SystemExit(f"rezim {rezim} tidak ada di {SUMBER_AIR.name}")
    d = d.set_index("petak", drop=False)
    # Waktu datang air ikut kalau ToT sudah dijalankan; kalau belum, kolomnya dikosongkan -
    # daftarnya tetap sah, cuma tanpa jadwal.
    if SUMBER_TOT.exists():
        t = pd.read_csv(SUMBER_TOT).set_index("ruas")
        for k in ("kum_t_air_jam", "kum_t_hidraulik_jam"):
            if k in t.columns:
                d[k] = t[k]
    return d


def geometri_ruas() -> dict:
    if not SUMBER_RUAS.exists():
        raise SystemExit(f"{SUMBER_RUAS.name} belum ada — jalankan "
                         "`python note/hitung-jaringan-air.py` lebih dulu")
    return {f["properties"]["id"]: shape(f["geometry"])
            for f in json.loads(SUMBER_RUAS.read_text(encoding="utf-8"))["features"]}


def geometri_di() -> list[dict]:
    if not SUMBER_DI.exists():
        raise SystemExit(f"{SUMBER_DI.name} tidak ada")
    return [{"nama": f["properties"]["Nama_DI"],
             "kewenangan": f["properties"].get("Kewenangan"),
             "luas_cea_ha": f["properties"].get("Luas_CEA"),
             "geom": shape(f["geometry"]).buffer(0)}
            for f in json.loads(SUMBER_DI.read_text(encoding="utf-8"))["features"]]


# ====================================================================== pasangkan
def pasangkan(ruas: pd.DataFrame) -> pd.DataFrame:
    """Tiap (saluran x DI) yang irisannya >= IRIS_MIN_M, beserta panjang irisannya."""
    geo = geometri_ruas()
    di = geometri_di()
    lat0 = sum(d["geom"].centroid.y for d in di) / len(di)
    lon0 = sum(d["geom"].centroid.x for d in di) / len(di)
    ke_m = bidang(lat0, lon0)

    nama_ruas = [k for k in geo if k in ruas.index]
    garis_m = [ke_m(geo[k]) for k in nama_ruas]
    pohon = STRtree(garis_m)

    baris = []
    for d in di:
        g = ke_m(d["geom"])
        for i in pohon.query(g):
            iris = garis_m[i].intersection(g)
            if iris.is_empty or iris.length < IRIS_MIN_M:
                continue
            nama = nama_ruas[i]
            r = ruas.loc[nama]
            panjang = float(r["panjang_m"])
            pangsa = min(1.0, iris.length / panjang) if panjang > 0 else 0.0
            layanan = float(r["luas_layanan_sendiri_ha"] or 0.0)
            butuh = float(r["debit_l_detik_sendiri"] or 0.0)
            baris.append({
                "di": d["nama"],
                "saluran": nama,
                "kode": r["kode"],
                "jenis": r["jenis"],
                "tingkat": r["tingkat"],
                "hulu": r["hulu"],
                "terhubung": bool(r["terhubung"]),
                "panjang_saluran_m": panjang,
                "panjang_di_di_m": float(iris.length),
                "pangsa_di_di": pangsa,
                "luas_layanan_ha": layanan,
                "luas_layanan_di_di_ha": layanan * pangsa,
                # Dua debit yang berbeda dan sering tertukar: yang LEWAT ruas ini
                # (termasuk air untuk hilirnya), dan yang habis di lahan ruas ini sendiri.
                "debit_l_detik": float(r["debit_l_detik"]),
                "debit_lahan_l_detik": butuh,
                "debit_lahan_di_di_l_detik": butuh * pangsa,
                "kum_t_air_jam": r["kum_t_air_jam"] if "kum_t_air_jam" in r else None,
            })
    P = pd.DataFrame(baris)
    if P.empty:
        return P
    P["_urut"] = P["jenis"].map(URUT_JENIS).fillna(9)
    P = P.sort_values(["di", "_urut", "panjang_di_di_m"],
                      ascending=[True, True, False]).drop(columns="_urut")
    return P.reset_index(drop=True)


def rekap_di(P: pd.DataFrame) -> pd.DataFrame:
    """Satu baris per DI. Saluran masuknya yang airnya paling dulu datang.

    Kalau ToT belum dijalankan, "saluran masuk" jatuh ke saluran tingkat paling hulu yang
    terpanjang di dalam DI itu - pilihan cadangan yang benar hampir selalu, tapi tidak
    selalu, karena satu DI bisa disentuh dua cabang sekunder yang berbeda jalur.
    """
    info = {d["nama"]: d for d in geometri_di()}
    punya_tot = "kum_t_air_jam" in P.columns and P["kum_t_air_jam"].notna().any()

    baris = []
    for nama, g in P.groupby("di", sort=False):
        ada = g[g["kum_t_air_jam"].notna()] if punya_tot else g.iloc[0:0]
        if not ada.empty:
            masuk = ada.loc[ada["kum_t_air_jam"].idxmin()]
            ujung = ada.loc[ada["kum_t_air_jam"].idxmax()]
        else:
            urut = g.assign(_u=g["jenis"].map(URUT_JENIS).fillna(9))
            masuk = urut.sort_values(["_u", "panjang_di_di_m"],
                                     ascending=[True, False]).iloc[0]
            ujung = None
        n = g["jenis"].value_counts()
        km = g.groupby("jenis")["panjang_di_di_m"].sum() / 1000.0
        d = info.get(nama, {})
        baris.append({
            "di": nama,
            "kewenangan": d.get("kewenangan"),
            "luas_cea_ha": d.get("luas_cea_ha"),
            "n_saluran": len(g),
            "n_primer": int(n.get("Primer", 0)),
            "n_sekunder": int(n.get("Sekunder", 0)),
            "n_tersier": int(n.get("Tersier", 0)),
            "n_suplesi": int(n.get("Suplesi", 0)),
            "panjang_km": g["panjang_di_di_m"].sum() / 1000.0,
            "panjang_primer_km": float(km.get("Primer", 0.0)),
            "panjang_sekunder_km": float(km.get("Sekunder", 0.0)),
            "panjang_tersier_km": float(km.get("Tersier", 0.0)),
            "luas_layanan_ha": g["luas_layanan_di_di_ha"].sum(),
            "debit_lahan_l_detik": g["debit_lahan_di_di_l_detik"].sum(),
            "debit_lewat_maks_l_detik": g["debit_l_detik"].max(),
            "saluran_masuk": masuk["saluran"],
            "debit_masuk_l_detik": float(masuk["debit_l_detik"]),
            "tot_air_jam": masuk["kum_t_air_jam"] if not ada.empty else None,
            "saluran_ujung": ujung["saluran"] if ujung is not None else None,
            "tot_air_jam_ujung": ujung["kum_t_air_jam"] if ujung is not None else None,
            "saluran": "; ".join(g["saluran"]),
        })
    R = pd.DataFrame(baris).sort_values("panjang_km", ascending=False)
    return R.reset_index(drop=True)


# ========================================================================== cetak
def _id(v, d=0):
    if v is None or pd.isna(v):
        return "-"
    utuh, _, pecah = f"{v:,.{d}f}".partition(".")
    utuh = utuh.replace(",", ".")
    return f"{utuh},{pecah}" if pecah else utuh


def cetak_di(nama: str, R: pd.DataFrame, P: pd.DataFrame) -> None:
    r = R[R["di"] == nama].iloc[0]
    g = P[P["di"] == nama]
    print()
    print(f"  {nama} - {_id(r['luas_cea_ha'])} ha baku, "
          f"{_id(r['panjang_km'], 1)} km saluran, {r['n_saluran']} ruas, "
          f"layanan {_id(r['luas_layanan_ha'])} ha")
    print(f"    masuk lewat {r['saluran_masuk']}"
          + (f", air datang {_id(r['tot_air_jam'], 1)} jam dari Bendung Copong"
             if pd.notna(r["tot_air_jam"]) else "")
          + (f"; terjauh {r['saluran_ujung']} pada {_id(r['tot_air_jam_ujung'], 1)} jam"
             if pd.notna(r["tot_air_jam_ujung"]) else ""))
    print(f"    {'saluran':<34}{'jenis':<10}{'panjang':>9}{'layanan':>9}"
          f"{'Q lahan':>9}{'Q lewat':>9}")
    print(f"    {'':<34}{'':<10}{'m di DI':>9}{'ha':>9}{'l/detik':>9}{'l/detik':>9}")
    for _, s in g.iterrows():
        print(f"    {s['saluran'][:33]:<34}{s['jenis']:<10}"
              f"{_id(s['panjang_di_di_m']):>9}"
              f"{_id(s['luas_layanan_di_di_ha']):>9}"
              f"{_id(s['debit_lahan_di_di_l_detik']):>9}"
              f"{_id(s['debit_l_detik']):>9}")


# =========================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rezim", default="FL", help="rezim tanam (FL / SRI)")
    ap.add_argument("--di", default=None, help="cetak rincian satu DI saja")
    ap.add_argument("--semua", action="store_true",
                    help="cetak rincian saluran seluruh DI, bukan cuma rekapnya")
    arg = ap.parse_args()

    ruas = baca_ruas(arg.rezim)
    P = pasangkan(ruas)
    if P.empty:
        raise SystemExit("tidak ada saluran yang mengiris poligon DI mana pun")
    R = rekap_di(P)

    print("=" * 78)
    print("   DAFTAR SALURAN IRIGASI PER DAERAH IRIGASI - jaringan D.I. Leuwigoong")
    print("=" * 78)
    print(f"  Sumber   : SISDA {len(ruas)} ruas / "
          f"{_id(ruas.panjang_m.sum() / 1000, 1)} km, rezim {arg.rezim}")
    print(f"  Ambang   : irisan >= {_id(IRIS_MIN_M)} m - 'dilewati', bukan 'berdekatan'")
    print(f"  Terdaftar: {len(R)} DI dari {len(geometri_di())} DI kewenangan Kab. Garut, "
          f"{P['saluran'].nunique()} saluran")

    print()
    print(f"  {'daerah irigasi':<24}{'baku':>7}{'ruas':>6}{'P/S/T':>10}"
          f"{'panjang':>9}{'layanan':>9}{'Q lahan':>9}{'datang':>8}")
    print(f"  {'':<24}{'ha':>7}{'':>6}{'':>10}{'km':>9}{'ha':>9}{'l/detik':>9}{'jam':>8}")
    print("  " + "-" * 82)
    for _, r in R.iterrows():
        pst = f"{r['n_primer']}/{r['n_sekunder']}/{r['n_tersier']}"
        tanda = "*" if r["luas_layanan_ha"] > (r["luas_cea_ha"] or 0) else ""
        print(f"  {(r['di'] + tanda)[:23]:<24}{_id(r['luas_cea_ha']):>7}{r['n_saluran']:>6}"
              f"{pst:>10}{_id(r['panjang_km'], 1):>9}{_id(r['luas_layanan_ha']):>9}"
              f"{_id(r['debit_lahan_l_detik']):>9}{_id(r['tot_air_jam'], 1):>8}")
    print("  " + "-" * 82)
    print(f"  {'JUMLAH':<24}{_id(R['luas_cea_ha'].sum()):>7}"
          f"{P['saluran'].nunique():>6}{'':>10}{_id(R['panjang_km'].sum(), 1):>9}"
          f"{_id(R['luas_layanan_ha'].sum()):>9}{_id(R['debit_lahan_l_detik'].sum()):>9}")
    print()
    print("  'Q lahan' = debit untuk sawah yang dilayani DI DALAM DI itu, diukur di pintu")
    print("  tersier. Bukan debit yang LEWAT - ruas primer yang menembus satu DI membawa")
    print("  air untuk seluruh jaringan di hilirnya, dan angka itu ada di kolom")
    print("  `debit_lewat_maks_l_detik` pada CSV, bukan di tabel ini.")
    lebih = R[R["luas_layanan_ha"] > R["luas_cea_ha"].fillna(0)]
    if not lebih.empty:
        print()
        print(f"  (*) {len(lebih)} DI berluas layanan melebihi luas bakunya, dan itu bukan")
        print("  salah hitung: yang dijumlah luas layanan SALURAN yang melintas di situ, dan")
        print("  tersier yang pangkalnya di dalam DI ini bisa mengairi sawah di seberang")
        print("  batasnya. Untuk luas sawah menurut WILAYAH, pakai `kebutuhan_air_di.csv` -")
        print("  di sana yang diiris poligon DI-nya, bukan salurannya.")

    # Yang tidak masuk daftar - dicetak, bukan didiamkan.
    luar = sorted(set(ruas.index) - set(P["saluran"]))
    layanan_total = float(ruas["luas_layanan_sendiri_ha"].sum())
    layanan_dalam = float(R["luas_layanan_ha"].sum())
    print()
    print("  DI LUAR DAFTAR")
    print(f"    {len(luar)} saluran tidak menembus poligon DI kabupaten mana pun sejauh "
          f"{_id(IRIS_MIN_M)} m -")
    print(f"    {_id(float(ruas.loc[luar, 'panjang_m'].sum()) / 1000, 1)} km, melayani "
          f"{_id(float(ruas.loc[luar, 'luas_layanan_sendiri_ha'].sum()))} ha.")
    print(f"    Luas layanan jaringan {_id(layanan_total)} ha, yang jatuh di dalam DI "
          f"kabupaten {_id(layanan_dalam)} ha ({_id(100 * layanan_dalam / layanan_total)} %);")
    print("    sisanya sawah di wilayah D.I. Leuwigoong sendiri, yang kewenangannya pusat")
    print("    dan poligonnya tidak ada di data repo ini.")

    if arg.di:
        cocok = [n for n in R["di"] if arg.di.lower() in n.lower()]
        if not cocok:
            raise SystemExit(f"DI '{arg.di}' tidak ada dalam daftar")
        for n in cocok:
            cetak_di(n, R, P)
    elif arg.semua:
        for n in R["di"]:
            cetak_di(n, R, P)

    R.to_csv(KELUARAN / "daftar_irigasi_di.csv", index=False)
    P.to_csv(KELUARAN / "daftar_irigasi_ruas.csv", index=False)
    print()
    print(f"  Keluaran: {KELUARAN / 'daftar_irigasi_di.csv'}")
    print(f"            {KELUARAN / 'daftar_irigasi_ruas.csv'}")


if __name__ == "__main__":
    main()
