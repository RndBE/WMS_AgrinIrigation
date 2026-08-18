# -*- coding: utf-8 -*-
"""Metode kebutuhan air irigasi KP-01 / FAO-56 — dipakai bersama beberapa pipeline.

Isinya disalin utuh dari `note/note-swh-jb_grt-air.ipynb`: rumus, tetapan, dan urutan
langkahnya, bukan tafsir ulang. Modul ini lahir dari peringatan yang sudah tertulis di
`hitung-kecamatan-air.py` sendiri — "jangan diubah sebelah sini saja, kalau salah satu
digeser angka kedua pipeline berhenti sebanding". Selama metodenya disalin, peringatan
itu bergantung pada seseorang yang ingat; disatukan begini, ia dijamin susunan berkas.

Yang TIDAK ada di sini: cara memilih objek dan cara mengukur luasnya. Itu justru yang
membedakan tiap pipeline — kecamatan diiris dari batas administrasi, Daerah Irigasi
punya luas baku yang sudah ditetapkan — dan menyatukannya cuma akan melahirkan satu
fungsi bercabang yang tidak menerangkan apa pun.
"""
from __future__ import annotations

import json
import math
import re
import time
import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from shapely.geometry import mapping

# ============================ TETAPAN (KP-01 & FAO-56) ============================
TAHUN_AWAL, TAHUN_AKHIR = 2015, 2025
ZONA_WAKTU = "Asia/Jakarta"
ALBEDO = 0.23
PERKOLASI_MM = 2.0                 # mm/hari - acuan KP-01
PERK_KERING_RASIO = 0.60           # perkolasi saat petak tidak tergenang
EFISIENSI_IRIGASI = 0.65           # 0,90 tersier x 0,90 sekunder x 0,80 primer
WLR_MM = 50.0                      # penggantian lapisan air, 2x semusim
LAMA_SIAP_LAHAN = 30               # hari
AIR_JENUH_S = 250.0                # mm - penjenuhan + lapisan air awal
FASE = [("awal", 20), ("pertumbuhan", 30), ("reproduktif", 40), ("pemasakan", 20)]
N_TUMBUH = sum(d for _, d in FASE)
HARI_MUSIM = LAMA_SIAP_LAHAN + N_TUMBUH        # 140 hari

KC = {"FL":  {"awal": 1.01, "pertumbuhan": 1.02, "reproduktif": 1.09, "pemasakan": 1.05},
      "SRI": {"awal": 1.00, "pertumbuhan": 0.96, "reproduktif": 1.02, "pemasakan": 1.04}}
ATURAN_TMA = {
    "FL":  {"awal": (20, 10, 50), "pertumbuhan": (20, 10, 50),
            "reproduktif": (10, 5, 40), "pemasakan": (10, 0, 40)},
    "SRI": {"awal": (10, 0, 40), "pertumbuhan": (10, -20, 40),
            "reproduktif": (5, -25, 30), "pemasakan": (0, -30, 30)}}
REZIM = {"FL":  {"nama": "FL (genangan)", "perk_faktor": 1.00, "wlr": WLR_MM},
         "SRI": {"nama": "SRI (intermiten)", "perk_faktor": 0.60, "wlr": 0.0}}

FASE_HARIAN = np.concatenate([[nm] * d for nm, d in FASE])
NB = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
      "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


# ================================ ETo (FAO-56) ================================
def radiasi_ekstra(doy, lat_deg):
    """Ra - radiasi ekstraterestrial (MJ m-2 hari-1). FAO-56 pers. (21)."""
    phi_ = math.radians(lat_deg)
    dr = 1 + 0.033 * np.cos(2 * np.pi * doy / 365)
    dec = 0.409 * np.sin(2 * np.pi * doy / 365 - 1.39)
    ws = np.arccos(np.clip(-np.tan(phi_) * np.tan(dec), -1, 1))
    return (24 * 60 / np.pi) * 0.0820 * dr * (ws * np.sin(phi_) * np.sin(dec) +
                                              np.cos(phi_) * np.cos(dec) * np.sin(ws))


def eto_penman_monteith(tmaks, tmin, rh, u2, rs, doy, lat_deg, z):
    """ETo harian (mm/hari) menurut FAO-56 pers. (6)."""
    tmean = (tmaks + tmin) / 2
    P = 101.3 * ((293 - 0.0065 * z) / 293) ** 5.26
    gamma = 0.000665 * P
    delta = (4098 * (0.6108 * np.exp(17.27 * tmean / (tmean + 237.3))) / (tmean + 237.3) ** 2)
    e_maks = 0.6108 * np.exp(17.27 * tmaks / (tmaks + 237.3))
    e_min = 0.6108 * np.exp(17.27 * tmin / (tmin + 237.3))
    es = (e_maks + e_min) / 2
    ea = es * rh / 100
    Ra = radiasi_ekstra(doy, lat_deg)
    Rso = (0.75 + 2e-5 * z) * Ra
    Rns = (1 - ALBEDO) * rs
    Rnl = (4.903e-9 * (((tmaks + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2) *
           (0.34 - 0.14 * np.sqrt(np.maximum(ea, 0))) *
           (1.35 * np.clip(rs / Rso, 0, 1) - 0.35))
    Rn = Rns - Rnl                      # G diabaikan untuk langkah harian
    return np.maximum((0.408 * delta * Rn + gamma * (900 / (tmean + 273)) * u2 * (es - ea)) /
                      (delta + gamma * (1 + 0.34 * u2)), 0)


def kebutuhan_siap_lahan(eto_mm, perkolasi, T=LAMA_SIAP_LAHAN, S=AIR_JENUH_S):
    """IR penyiapan lahan (mm/hari) - Van de Goor & Zijlstra, KP-01."""
    M = 1.1 * eto_mm + perkolasi
    k = M * T / S
    return M * math.exp(k) / (math.exp(k) - 1.0)


def ke_l_detik_ha(nfr_mm_hari, efisiensi=EFISIENSI_IRIGASI):
    return nfr_mm_hari / (8.64 * efisiensi)


# ============================== neraca air semusim ==============================
def neraca_musim(tanam, rezim, cuaca):
    """Neraca harian satu musim (penyiapan lahan + masa tumbuh) -> DataFrame.

    Jangan disederhanakan. Yang tampak seperti perkalian sederhana di sini sebetulnya
    urutan keputusan harian - kapan diairi, kapan melimpas, kapan tanahnya kering - dan
    urutan itulah yang menentukan hasilnya.
    """
    perk_tumbuh = PERKOLASI_MM * REZIM[rezim]["perk_faktor"]
    wlr_total = REZIM[rezim]["wlr"]
    mulai = tanam - timedelta(days=LAMA_SIAP_LAHAN)
    n = LAMA_SIAP_LAHAN + N_TUMBUH

    m = cuaca.set_index("tanggal")
    idx = pd.date_range(mulai, periods=n, freq="D")
    if not idx.isin(m.index).all():
        return None                     # cuaca musim ini tidak lengkap
    cm = m.loc[idx]
    eto_h = cm["eto_pm"].to_numpy()
    hj_h = cm["hujan"].to_numpy()

    h = 0.0
    baris = []
    for i in range(n):
        eto, hj = float(eto_h[i]), float(hj_h[i])
        if i < LAMA_SIAP_LAHAN:                        # ---- penyiapan lahan ----
            ir = kebutuhan_siap_lahan(eto, PERKOLASI_MM)
            irig = max(ir - hj, 0.0)
            etc = 1.1 * eto                            # Eo: penguapan permukaan air
            perk = PERKOLASI_MM
            simpan = max(ir - etc - perk, 0.0)
            limp = max(hj - ir, 0.0)
            tahap, wlr, tma = "siap lahan", 0.0, 0.0
        else:                                          # ---- masa tumbuh ----
            k = i - LAMA_SIAP_LAHAN
            tahap = FASE_HARIAN[k]
            target, pemicu, hd = ATURAN_TMA[rezim][tahap]
            h += hj
            irig = 0.0
            if h < pemicu:
                irig = target - h
                h = float(target)
            etc = KC[rezim][tahap] * eto
            perk = perk_tumbuh if h > 0 else perk_tumbuh * PERK_KERING_RASIO
            wlr = wlr_total / 15.0 if (30 <= k < 45) or (60 <= k < 75) else 0.0
            irig += wlr
            h += wlr
            h -= (etc + perk)
            limp = 0.0
            if h > hd:
                limp = h - hd
                h = float(hd)
            h = max(h, -150.0)
            simpan, tma = 0.0, h
        baris.append({"hari_ke": i - LAMA_SIAP_LAHAN, "tanggal": idx[i], "tahap": tahap,
                      "eto": eto, "hujan": hj, "irigasi": irig, "etc": etc,
                      "perkolasi": perk, "limpasan": limp, "wlr": wlr,
                      "penjenuhan": simpan, "tma": tma})
    return pd.DataFrame(baris)


def ringkas_musim(df):
    """Satu baris angka pokok dari neraca harian satu musim."""
    tumbuh = df[df["tahap"] != "siap lahan"]
    return {
        "hujan_mm": df["hujan"].sum(), "irigasi_mm": df["irigasi"].sum(),
        "irigasi_pl_mm": df[df["tahap"] == "siap lahan"]["irigasi"].sum(),
        "etc_mm": df["etc"].sum(), "perkolasi_mm": df["perkolasi"].sum(),
        "limpasan_mm": df["limpasan"].sum(), "wlr_mm": df["wlr"].sum(),
        "masuk_mm": df["hujan"].sum() + df["irigasi"].sum(),
        "keluar_mm": df["etc"].sum() + df["perkolasi"].sum() + df["limpasan"].sum(),
        "tma_rata": tumbuh["tma"].mean(), "tma_min": tumbuh["tma"].min(),
        "hari_kering": int((tumbuh["tma"] < 0).sum()),
    }


# ================================ pengambilan data ================================
def unduh_json(url, berkas, jeda=0.0, percobaan=9, user_agent=None):
    """Sekali unduh lalu disimpan; jalankan ulang tidak menanyai layanan lagi.

    Open-Meteo membatasi laju permintaan dan membalas 429 begitu terlampaui - satu
    permintaan di sini berisi 11 tahun data harian, jadi batas itu gampang tersentuh.
    Karena tiap balasan langsung disimpan, menjalankan ulang skrip ini akan melanjutkan
    dari objek yang belum terambil, bukan mengulang dari awal. Tunggunya berlipat ganda:
    menunggu lebih lama sekali jauh lebih cepat daripada ditolak berkali-kali.

    `percobaan` sengaja 9, bukan 6. Dengan tunggu berlipat yang dibatasi 120 detik,
    6 percobaan hanya menempuh ~62 detik total - lebih pendek daripada jendela batas
    per-menit Open-Meteo, sehingga seluruh jatah percobaan bisa habis di dalam satu
    jendela yang sama dan pipeline gugur padahal cukup ditunggu sebentar lagi.
    Sembilan percobaan menempuh ~6 menit, melewati jendela itu dengan selamat.
    """
    berkas = Path(berkas)
    berkas.parent.mkdir(parents=True, exist_ok=True)
    if berkas.exists():
        return json.loads(berkas.read_text(encoding="utf-8"))
    permintaan = urllib.request.Request(
        url, headers={"User-Agent": user_agent} if user_agent else {})
    tunggu = max(jeda, 1.0)
    for ke in range(1, percobaan + 1):
        time.sleep(tunggu)
        try:
            with urllib.request.urlopen(permintaan, timeout=120) as r:
                isi = json.loads(r.read().decode("utf-8"))
            berkas.write_text(json.dumps(isi), encoding="utf-8")
            return isi
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503, 504) or ke == percobaan:
                raise
            tunggu = min(tunggu * 2, 120.0)
            print(f"      layanan cuaca membalas {e.code}; menunggu {tunggu:.0f} detik "
                  f"lalu mencoba lagi ({ke}/{percobaan - 1})")
        # Sambungan yang putus atau kehabisan waktu ikut diulang. Satu pipeline bisa
        # menempuh puluhan unduhan berturut-turut, dan di situ satu timeout sudah cukup
        # untuk menggugurkan seluruh jalannya - padahal sebabnya sementara dan yang
        # sudah terunduh tetap tersimpan. HTTPError diperiksa lebih dulu karena ia
        # turunan URLError: dibalik urutannya, 404 pun ikut diulang enam kali.
        except (urllib.error.URLError, TimeoutError) as e:
            if ke == percobaan:
                raise
            tunggu = min(tunggu * 2, 120.0)
            print(f"      sambungan ke layanan cuaca gagal ({e}); menunggu "
                  f"{tunggu:.0f} detik lalu mencoba lagi ({ke}/{percobaan - 1})")


def slug(teks):
    return re.sub(r"[^a-z0-9]+", "-", teks.lower()).strip("-")


def cuaca_titik(lat, lon, nama, cuaca_dir, jeda=0.0, user_agent=None):
    """Cuaca harian ERA5-Land di satu titik -> (DataFrame beserta ETo FAO-56, elevasi)."""
    url = ("https://archive-api.open-meteo.com/v1/archive?"
           f"latitude={lat:.4f}&longitude={lon:.4f}"
           f"&start_date={TAHUN_AWAL}-01-01&end_date={TAHUN_AKHIR}-12-31"
           "&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,"
           "et0_fao_evapotranspiration,shortwave_radiation_sum,"
           "relative_humidity_2m_mean,wind_speed_10m_mean"
           f"&timezone={ZONA_WAKTU.replace('/', '%2F')}"
           "&wind_speed_unit=ms&precipitation_unit=mm&temperature_unit=celsius")
    d = unduh_json(url, Path(cuaca_dir) / f"{slug(nama)}.json", jeda, user_agent=user_agent)
    dd = d["daily"]
    df = pd.DataFrame({
        "tanggal": pd.to_datetime(dd["time"]),
        "tmaks": dd["temperature_2m_max"], "tmin": dd["temperature_2m_min"],
        "hujan": dd["precipitation_sum"], "rs": dd["shortwave_radiation_sum"],
        "rh": dd["relative_humidity_2m_mean"], "u10": dd["wind_speed_10m_mean"],
        "eto_om": dd["et0_fao_evapotranspiration"],
    }).dropna()
    # 10 m -> 2 m, FAO-56 pers. (47)
    df["u2"] = df["u10"] * 4.87 / np.log(67.8 * 10 - 5.42)
    df["doy"] = df["tanggal"].dt.dayofyear
    df["tahun"] = df["tanggal"].dt.year
    elev = float(d.get("elevation") or 0.0)
    df["eto_pm"] = eto_penman_monteith(df["tmaks"], df["tmin"], df["rh"], df["u2"],
                                       df["rs"], df["doy"], lat, elev)
    return df, elev


def luas_ha(geom, ukur):
    """Luas memakai rumus yang sama dengan seluruh repo - bukan luas bawaan shapely,
    yang menghitung derajat persegi dan tidak berarti apa-apa.

    `ukur` = `web-app/data.py:_ukuran_geom`, disuntikkan supaya modul ini tidak ikut
    menyeret seluruh web-app hanya untuk satu rumus luas.
    """
    if geom.is_empty:
        return 0.0
    return ukur(mapping(geom))[0] / 1e4
