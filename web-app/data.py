# -*- coding: utf-8 -*-
"""Pembaca data lokasi SWH: KML -> GeoJSON, lalu digabung dengan hasil hitungan notebook.

Semua angka di sini DIBACA dari keluaran notebook di `note/output-*`. Tidak ada angka
yang dihitung ulang, ditaksir, atau diisi nilai contoh: kalau satu lokasi belum punya
hitungan air, medannya dikirim `None` dan halaman menampilkannya sebagai
"belum dihitung" - bukan angka nol yang terlihat seperti hasil.
"""
from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent


# --------------------------------------------------------------------------- KML
def _koordinat(blok: str) -> list[list[float]]:
    """Isi <coordinates> -> [[lon, lat], ...]."""
    keluar = []
    for tok in blok.split():
        bag = tok.split(",")
        if len(bag) >= 2:
            keluar.append([float(bag[0]), float(bag[1])])
    return keluar


def baca_kml(berkas: Path) -> list[dict]:
    """Ambil semua poligon dari KML -> [{nama, cincin}]. Cincin dalam urutan lon, lat."""
    teks = berkas.read_text(encoding="utf-8")
    hasil = []
    for m in re.finditer(r"<Placemark[^>]*>(.*?)</Placemark>", teks, re.S):
        isi = m.group(1)
        nm = re.search(r"<name>(.*?)</name>", isi, re.S)
        nama = nm.group(1).strip() if nm else "(tanpa nama)"
        for cd in re.findall(
            r"<outerBoundaryIs>\s*<LinearRing>.*?<coordinates>(.*?)</coordinates>", isi, re.S
        ):
            cincin = _koordinat(cd)
            if len(cincin) >= 4:
                hasil.append({"nama": nama, "cincin": cincin})
    return hasil


def _tutup(cincin: list[list[float]]) -> list[list[float]]:
    """GeoJSON menuntut cincin tertutup; KML tidak selalu menutupnya."""
    if cincin and cincin[0] != cincin[-1]:
        return cincin + [cincin[0]]
    return cincin


def _luas_datar_m2(cincin: list[list[float]]) -> float:
    """Luas (m2) lewat proyeksi bidang datar lokal - cara yang sama dipakai notebook."""
    if len(cincin) < 3:
        return 0.0
    lat0 = sum(p[1] for p in cincin) / len(cincin)
    lon0 = sum(p[0] for p in cincin) / len(cincin)
    phi = math.radians(lat0)
    m_lat = 111_132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111_412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    xy = [((p[0] - lon0) * m_lon, (p[1] - lat0) * m_lat) for p in cincin]
    if xy[0] == xy[-1]:
        xy = xy[:-1]
    a = 0.0
    for i in range(len(xy)):
        x1, y1 = xy[i]
        x2, y2 = xy[(i + 1) % len(xy)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def _keliling_datar_m(cincin: list[list[float]]) -> float:
    """Keliling (m) dengan proyeksi datar lokal yang sama seperti _luas_datar_m2."""
    if len(cincin) < 2:
        return 0.0
    lat0 = sum(p[1] for p in cincin) / len(cincin)
    phi = math.radians(lat0)
    m_lat = 111_132.92 - 559.82 * math.cos(2 * phi) + 1.175 * math.cos(4 * phi)
    m_lon = 111_412.84 * math.cos(phi) - 93.5 * math.cos(3 * phi)
    total = 0.0
    for i in range(len(cincin) - 1):
        dx = (cincin[i + 1][0] - cincin[i][0]) * m_lon
        dy = (cincin[i + 1][1] - cincin[i][1]) * m_lat
        total += math.hypot(dx, dy)
    return total


def _cincin_luar(geom: dict) -> list[list[list[float]]]:
    """Cincin terluar tiap bagian poligon. Polygon dan MultiPolygon sama-sama dilayani."""
    if not geom:
        return []
    if geom.get("type") == "Polygon":
        return [geom["coordinates"][0]] if geom.get("coordinates") else []
    if geom.get("type") == "MultiPolygon":
        return [bagian[0] for bagian in geom.get("coordinates", []) if bagian]
    return []


def _ukuran_geom(geom: dict) -> tuple[float, float]:
    """(luas m2, keliling m) satu geometri. Lubang di dalam poligon ikut dikurangkan -
    poligon sawah BIG kadang berlubang di tempat ada bangunan atau saluran."""
    luas = keliling = 0.0
    bagian = ([geom["coordinates"]] if geom.get("type") == "Polygon"
              else geom.get("coordinates", []) if geom.get("type") == "MultiPolygon"
              else [])
    for cincin in bagian:
        if not cincin:
            continue
        luas += _luas_datar_m2(cincin[0])
        keliling += _keliling_datar_m(cincin[0])
        for lubang in cincin[1:]:
            luas -= _luas_datar_m2(lubang)
    return max(luas, 0.0), keliling


def _potong_cincin(cincin: list[list[float]], kotak: list[float]) -> list[list[float]]:
    """Sutherland-Hodgman: satu cincin dipotong ke kotak AOI. [] kalau habis.

    Kotaknya cembung, jadi algoritma ini tepat untuk luas. Pada poligon cekung ia bisa
    meninggalkan sisi yang berimpit menyusuri tepi kotak - tidak mengubah luas maupun
    tampilan, hanya perlu diingat kalau geometrinya nanti dipakai untuk topologi.
    """
    W, S, E, N = kotak

    def dalam(p, tepi):
        return (p[0] >= W if tepi == "W" else p[0] <= E if tepi == "E"
                else p[1] >= S if tepi == "S" else p[1] <= N)

    def silang(a, b, tepi):
        if tepi in ("W", "E"):
            x = W if tepi == "W" else E
            t = (x - a[0]) / (b[0] - a[0])
            return [x, a[1] + t * (b[1] - a[1])]
        y = S if tepi == "S" else N
        t = (y - a[1]) / (b[1] - a[1])
        return [a[0] + t * (b[0] - a[0]), y]

    # cincin GeoJSON tertutup; titik terakhir digugurkan supaya tidak terhitung dua kali
    sisa = cincin[:-1] if len(cincin) > 1 and cincin[0] == cincin[-1] else list(cincin)
    for tepi in ("W", "E", "S", "N"):
        masuk, sisa = sisa, []
        if not masuk:
            break
        for i in range(len(masuk)):
            a, b = masuk[i - 1], masuk[i]
            if dalam(b, tepi):
                if not dalam(a, tepi):
                    sisa.append(silang(a, b, tepi))
                sisa.append(b)
            elif dalam(a, tepi):
                sisa.append(silang(a, b, tepi))
    return sisa + [sisa[0]] if len(sisa) >= 3 else []


def _potong_geom(geom: dict, kotak: list[float]) -> dict | None:
    """Geometri dipotong ke kotak AOI. None kalau tidak ada sisa di dalam kotak."""
    bagian = ([geom["coordinates"]] if geom.get("type") == "Polygon"
              else geom.get("coordinates", []) if geom.get("type") == "MultiPolygon"
              else [])
    hasil = []
    for cincin in bagian:
        if not cincin:
            continue
        luar = _potong_cincin(cincin[0], kotak)
        if not luar:
            continue
        lubang = [h for h in (_potong_cincin(x, kotak) for x in cincin[1:]) if h]
        hasil.append([luar] + lubang)
    if not hasil:
        return None
    if len(hasil) == 1:
        return {"type": "Polygon", "coordinates": hasil[0]}
    return {"type": "MultiPolygon", "coordinates": hasil}


def _sederhanakan(simpul: list[list[float]], toleransi: float,
                  minimal: int = 4) -> list[list[float]]:
    """Douglas-Peucker: simpul yang tidak mengubah bentuk lebih dari `toleransi` dibuang.

    Toleransinya dalam derajat dan diukur tegak lurus tali busur, jadi bentuknya
    dijamin tidak bergeser lebih jauh dari itu - beda dengan menipiskan tiap simpul
    ke-n, yang bisa memotong tikungan. Dipakai untuk lapisan SISDA: batasnya berskala
    kabupaten dengan ratusan ribu simpul, sementara ketelitian petanya sendiri ada di
    orde puluhan meter.

    `minimal` berbeda menurut bentuknya - cincin poligon butuh 4 simpul (titik awal
    ditulis ulang di akhir), garis cukup 2. Di bawah itu hasilnya dibatalkan dan bentuk
    aslinya dikembalikan, supaya objek kecil tidak lenyap begitu saja.
    """
    if len(simpul) < 3:
        return simpul
    simpan = [False] * len(simpul)
    simpan[0] = simpan[-1] = True
    tumpuk = [(0, len(simpul) - 1)]
    while tumpuk:
        i, j = tumpuk.pop()
        ax, ay = simpul[i][:2]
        bx, by = simpul[j][:2]
        dx, dy = bx - ax, by - ay
        panjang2 = dx * dx + dy * dy
        terjauh, k = 0.0, -1
        for m in range(i + 1, j):
            px, py = simpul[m][:2]
            if panjang2 == 0:                       # ruas berpangkal-berujung sama
                jarak2 = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / panjang2
                t = 0.0 if t < 0 else 1.0 if t > 1 else t
                jarak2 = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if jarak2 > terjauh:
                terjauh, k = jarak2, m
        if k > 0 and terjauh > toleransi * toleransi:
            simpan[k] = True
            tumpuk += [(i, k), (k, j)]
    keluar = [p for p, ya in zip(simpul, simpan) if ya]
    return keluar if len(keluar) >= minimal else simpul


def _sederhanakan_geom(geom: dict, toleransi: float) -> dict:
    """`_sederhanakan` untuk satu geometri utuh. Titik dilewatkan apa adanya."""
    jenis = geom.get("type")
    isi = geom.get("coordinates")
    if not isi:
        return geom
    if jenis == "Polygon":
        return {"type": jenis,
                "coordinates": [_sederhanakan(c, toleransi) for c in isi]}
    if jenis == "MultiPolygon":
        return {"type": jenis,
                "coordinates": [[_sederhanakan(c, toleransi) for c in poligon]
                                for poligon in isi]}
    if jenis == "LineString":
        return {"type": jenis, "coordinates": _sederhanakan(isi, toleransi, minimal=2)}
    if jenis == "MultiLineString":
        return {"type": jenis,
                "coordinates": [_sederhanakan(g, toleransi, minimal=2) for g in isi]}
    return geom                          # Point/MultiPoint: tidak ada yang bisa dipangkas


def _pusat(cincin: list[list[float]]) -> list[float]:
    lon = sum(p[0] for p in cincin) / len(cincin)
    lat = sum(p[1] for p in cincin) / len(cincin)
    return [lon, lat]


def _angka(v):
    """Bilangan siap-JSON, atau None kalau kosong/NaN/tak hingga."""
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# --------------------------------------------------------------- definisi lokasi
# `tampil: False` membekukan satu lokasi: ia hilang dari pemilih di halaman, tetapi
# KML, keluaran notebook, dan pemuatnya tetap utuh. Menyalakannya kembali cukup
# mengubah satu tanda ini - tidak ada berkas yang perlu dipulihkan.
LOKASI = {
    "swh-011": {
        "id": "swh-011",
        "nama": "SWH-011",
        "keterangan": "Sawah berpetak hasil digitasi, lengkap dengan hitungan air per petak",
        "kml": "SWH-011_lengkap.kml",
        "keluaran": "note/output-swh",
        "notebook": "note/note-swh.ipynb",
        "punya_air": True,
        "sumber_petak": "notebook",
        "tampil": False,          # dibekukan - lihat catatan di atas
    },
    "swh-jb-grt": {
        "id": "swh-jb-grt",
        "nama": "SWH-JB-GRT",
        "keterangan": "4 hamparan terpisah; terrain, luas, dan hitungan air lengkap",
        "kml": "SWH-JB-GRT.kml",
        "keluaran": "note/output-swh-jb-grt",
        "keluaran_air": "note/output-swh-jb-grt-air",
        "notebook": "note/note-swh-jb_grt.ipynb + note-swh-jb_grt-air.ipynb",
        "punya_air": True,
        "sumber_petak": "notebook",
        "tampil": False,          # dibekukan - lihat catatan di atas
    },
    # Objeknya DAERAH IRIGASI, bukan petak sawah - satu poligon = satu hamparan layanan
    # yang ditetapkan Permen PUPR No. 14/2015.
    #
    # Lokasi ini TIDAK terkena sengketa yang membuat petak baku Leuwigoong dibuang.
    # Yang dibuang di sana adalah `DI_Leuwigoong_Baku`, yang 46,8% petaknya bertindihan
    # dengan lapisan DI kewenangan kabupaten; lapisan DI kewenangan itu sendiri - yang
    # dipakai di sini - tidak bertindihan dengan siapa pun. Jadi sengketanya soal petak
    # baku mana yang benar, bukan soal batas DI-nya.
    #
    # Luas acuannya `Luas_CEA`, luas baku yang DITETAPKAN, bukan luas sawah hasil ukur.
    # Itu memang dasar yang dipakai KP-01 untuk merancang debit. Luas sawah BIG ikut
    # dibawa di kolom terpisah sebagai pembanding, supaya keduanya tidak tertukar.
    "di-garut": {
        "id": "di-garut",
        "nama": "DI Kab. Garut",
        "keterangan": "32 Daerah Irigasi kewenangan Kab. Garut — kebutuhan air "
                      "& water loss per DI",
        "sumber_geojson": "data/DI_Kewenangan_Kabupaten_Garut.geojson",
        "keluaran_air": "note/output-di-garut-air",
        "notebook": "note/hitung-di-garut-air.py",
        # Extent 32 DI + ~0,03 derajat konteks. Ditulis tetap karena lokasi ini tidak
        # punya KML untuk diturunkan `_kotak_lokasi()`.
        "kotak": [107.7525, -7.3806, 108.0711, -6.9795],
        "punya_air": True,
        "sumber_petak": "sisda",
        "tampil": True,
        # Hanya DI yang DILEWATI jaringan D.I. Leuwigoong yang jadi subjek halaman.
        # 32 DI kewenangan kabupaten tersebar dari Leuwigoong di utara sampai kaki
        # Cikuray di selatan, sedangkan jaringan yang dipetakan di repo ini cuma satu.
        # DI yang berjarak 7 km dari ruas terdekatnya dilayani jaringan LAIN yang tidak
        # ada datanya di sini; menghitungnya berdampingan menjanjikan hubungan yang
        # tidak pernah ada di datanya. Daftar lolosnya dihitung `hitung-di-garut-air.py`
        # dan dibaca dari `di_jalur.csv` - halaman ini tidak mengukur apa pun sendiri.
        #
        # Yang disisihkan TIDAK hilang dari peta: lapisan `di_kab` di pemilih lapisan
        # tetap menggambar ke-32-nya sebagai konteks. Yang berubah cuma mana yang
        # DIUKUR halaman ini.
        "saring_jalur": True,
        "kabupaten": "Garut",
        "di_sisda": "Leuwigoong",
    },
    # Objeknya SALURAN, bukan hamparan - dan itu mengubah pertanyaannya. Di lokasi
    # lain yang ditanya "berapa air yang dipakai wilayah ini"; di sini "berapa air yang
    # harus LEWAT ruas ini", yaitu kebutuhan seluruh lahan di hilirnya, dibagi efisiensi
    # kumulatif sampai tingkat salurannya. Karena itu `luas_ha` di sini luas yang
    # DILAYANI lewat ruas tersebut, bukan luas di sebelahnya.
    #
    # Wilayah layanannya tidak diambil dari petak baku SISDA yang bersengketa itu,
    # melainkan diturunkan dari jaringannya sendiri: sawah BIG dipecah sel 100 m lalu
    # tiap sel diberikan ke tersier terdekat sejauh masih di dalam 750 m. Hasilnya
    # 5.491 ha - berselisih +9% dari luas petak baku D.I. Leuwigoong yang tercatat
    # 5.047 ha, tanpa sekali pun memakai lapisan yang bersengketa itu.
    "jaringan-leuwigoong": {
        "id": "jaringan-leuwigoong",
        "nama": "Jaringan D.I. Leuwigoong",
        "keterangan": "176 ruas saluran dari Bendung Copong — kebutuhan air & debit "
                      "yang lewat tiap ruas",
        "sumber_geojson": "note/output-jaringan-air/jaringan_ruas.geojson",
        "keluaran_air": "note/output-jaringan-air",
        "notebook": "note/hitung-jaringan-air.py",
        # Bentang jaringan + ~1,1 km konteks. Tetap, karena geometrinya keluaran skrip.
        "kotak": [107.9015, -7.1988, 108.0581, -7.0284],
        "punya_air": True,
        "sumber_petak": "jaringan",
        "tampil": True,
        "kabupaten": "Garut",
        "di_sisda": "Leuwigoong",
    },
    # Geometrinya datang dari layanan luar, bukan dari digitasi sendiri, jadi tidak ada
    # KML dan tidak ada keluaran notebook. Kolom air sengaja dibiarkan kosong.
    #
    # LOKASI INI TIDAK PUNYA PETAK, dan itu disengaja.
    #
    # Petak baku D.I. Leuwigoong (`DI_Leuwigoong_Baku`) pernah dipakai di sini, lalu
    # dibuang 13 Agustus 2026 karena BENTROK dengan lapisan DI kewenangan kabupaten
    # dari layanan yang sama: 415 dari 886 petaknya - 2.330 ha dari 5.047 ha, 46,8% -
    # pusatnya jatuh di dalam poligon DI kewenangan Kab. Garut (terbanyak DI Citameng IV
    # 70 petak, DI Cibuyutan Utara 68, DI Citameng I 64). Secara irigasi itu mustahil:
    # satu hamparan dilayani satu jaringan, di bawah satu kewenangan. Salah satu dari
    # dua lapisan itu keliru, dan SISDA sendiri belum menyelesaikannya - jadi memilih
    # salah satunya berarti kita yang memutuskan siapa yang benar tanpa dasar.
    #
    # `sumber_petak: None` = halaman ini menampilkan LETAK saja (jaringan, bangunan,
    # kewenangan) tanpa objek terukur. Sumber "big" masih terpasang di kode kalau suatu
    # saat perlu blok tutupan lahan RBI - lihat `_muat_leuwigoong_big()`.
    "leuwigoong": {
        "id": "leuwigoong",
        "nama": "Leuwigoong",
        "keterangan": "Jaringan & bangunan D.I. Leuwigoong dari SISDA — tanpa petak terukur",
        # Extent D.I. Leuwigoong + 0,03 derajat konteks. Ditulis tetap karena tidak ada
        # lagi geometri petak untuk menurunkannya; angkanya diukur dari
        # `DI_Leuwigoong_Baku` sebelum lapisan itu dibuang.
        "kotak": [107.8886, -7.2165, 108.0825, -7.0021],
        "sumber_petak": None,
        "notebook": None,
        "punya_air": False,
        "tampil": True,
        # Menyalakan lapisan SISDA Cimanuk-Cisanggarung - lihat lapisan_di() di bawah.
        # `kabupaten` membawa batas DI kewenangan (daftarnya di GC_KABUPATEN), `di_sisda`
        # membawa jaringan, bangunan, dan petak baku satu DI (daftarnya di GC_DI_SISDA).
        "kabupaten": "Garut",
        "di_sisda": "Leuwigoong",
    },
}

# Metrik yang boleh dipakai mewarnai peta. `kunci` = nama medan pada properti petak.
METRIK = {
    "swh-011": [
        {"kunci": "irigasi_mm", "label": "Kebutuhan air (mm)", "satuan": "mm"},
        {"kunci": "debit_l_detik", "label": "Debit (l/detik)", "satuan": "l/s"},
        {"kunci": "keluar_mm", "label": "Water loss (mm)", "satuan": "mm"},
        {"kunci": "luas_ha", "label": "Luas (ha)", "satuan": "ha"},
    ],
    # irigasi_mm sengaja tidak ditawarkan untuk lokasi ini: nilainya sama untuk semua
    # petak (sifat tanah belum diukur), jadi petanya akan rata satu warna dan menyesatkan.
    "swh-jb-grt": [
        {"kunci": "irigasi_m3", "label": "Kebutuhan air (m³)", "satuan": "m³"},
        {"kunci": "water_loss_m3", "label": "Water loss (m³)", "satuan": "m³"},
        {"kunci": "debit_l_detik", "label": "Debit (l/detik)", "satuan": "l/s"},
        {"kunci": "luas_ha", "label": "Luas (ha)", "satuan": "ha"},
        {"kunci": "lereng_persen", "label": "Kemiringan (%)", "satuan": "%"},
        {"kunci": "elev_rata_m", "label": "Ketinggian (m dpl)", "satuan": "m"},
    ],
    # Kosong: lokasi ini tidak punya objek terukur sama sekali (lihat catatan di LOKASI),
    # jadi tidak ada yang bisa diwarnai. Sumber "big" mengembalikannya ke `luas_ha`.
    "leuwigoong": [],
    # Di sini irigasi_mm JUSTRU ditawarkan, kebalikan dari swh-jb-grt: tiap DI punya
    # titik iklimnya sendiri, jadi mm-nya benar-benar berbeda antar-DI dan petanya
    # menerangkan sesuatu. m³ tetap yang pertama karena ia yang menjawab "berapa air
    # yang harus dialirkan ke sini", sedangkan mm menjawab "seberapa haus lahannya".
    "di-garut": [
        {"kunci": "irigasi_m3", "label": "Kebutuhan air (m³)", "satuan": "m³"},
        {"kunci": "irigasi_mm", "label": "Kebutuhan air (mm)", "satuan": "mm"},
        {"kunci": "water_loss_m3", "label": "Water loss (m³)", "satuan": "m³"},
        {"kunci": "keluar_mm", "label": "Water loss (mm)", "satuan": "mm"},
        {"kunci": "debit_l_detik", "label": "Debit (l/detik)", "satuan": "l/s"},
        {"kunci": "dr_l_detik_ha", "label": "DR (l/detik/ha)", "satuan": "l/s/ha"},
        {"kunci": "luas_ha", "label": "Luas baku (ha)", "satuan": "ha"},
        {"kunci": "elev_rata_m", "label": "Ketinggian (m dpl)", "satuan": "m"},
    ],
    # Debit yang pertama, dan itu bukan kebiasaan yang diteruskan begitu saja dari
    # lokasi lain: di lokasi hamparan yang ditanya "berapa air yang dipakai di sini",
    # sedangkan saluran dirancang dari "berapa yang harus lewat" - dan itu debit.
    # Volume m³ tetap ditawarkan, tetapi ia besaran semusim yang tidak menentukan
    # ukuran satu pun saluran.
    "jaringan-leuwigoong": [
        {"kunci": "debit_l_detik", "label": "Debit yang lewat (l/detik)", "satuan": "l/s"},
        # Dua peta waktu yang menjawab dua pertanyaan berbeda, dan bedanya sampai 1,4x:
        # yang pertama "kapan airnya sampai", yang kedua "kapan debitnya berubah".
        {"kunci": "kum_t_air_jam", "label": "Waktu tempuh air dari bendung (jam)",
         "satuan": "jam"},
        {"kunci": "kum_t_hidraulik_jam", "label": "Waktu respons hidraulik (jam)",
         "satuan": "jam"},
        {"kunci": "v_m_detik", "label": "Kecepatan aliran (m/detik)", "satuan": "m/s"},
        {"kunci": "t_air_jam", "label": "Waktu tempuh ruas ini saja (jam)",
         "satuan": "jam"},
        {"kunci": "luas_ha", "label": "Luas dilayani (ha)", "satuan": "ha"},
        {"kunci": "luas_layanan_sendiri_ha", "label": "Layanan sendiri (ha)",
         "satuan": "ha"},
        {"kunci": "irigasi_m3", "label": "Kebutuhan air lewat ruas (m³)", "satuan": "m³"},
        {"kunci": "water_loss_m3", "label": "Water loss di hilirnya (m³)", "satuan": "m³"},
        {"kunci": "panjang_km", "label": "Panjang ruas (km)", "satuan": "km"},
        {"kunci": "n_ruas_hilir", "label": "Jumlah ruas di hilirnya", "satuan": "ruas"},
        {"kunci": "elev_rata_m", "label": "Ketinggian (m dpl)", "satuan": "m"},
    ],
}


# ------------------------------------------------------------------ SWH-011
def _muat_swh011(rezim: str) -> dict:
    """Petak dari petak_geometri.json (id-nya sepadan dengan CSV), batas dari KML."""
    keluaran = ROOT / LOKASI["swh-011"]["keluaran"]
    geo = json.loads((keluaran / "petak_geometri.json").read_text(encoding="utf-8"))

    hilang = pd.read_csv(keluaran / "water_loss.csv")
    hilang = hilang[hilang["rezim"] == rezim].set_index("id_petak")

    # Kolom debit hanya ada untuk rezim yang dihitung di notebook debitnya.
    debit = pd.DataFrame()
    berkas_debit = keluaran / "kebutuhan_air_debit.csv"
    if berkas_debit.exists():
        d = pd.read_csv(berkas_debit)
        d = d[d["rezim"] == rezim]
        if len(d):
            debit = d.set_index("id_petak")

    fitur = []
    for p in geo["petak"]:
        pid = p["id_petak"]
        b = hilang.loc[pid] if pid in hilang.index else None
        c = debit.loc[pid] if len(debit) and pid in debit.index else None
        cincin = [[float(x), float(y)] for x, y in p["koordinat"]]
        luas_m2 = _angka(p.get("luas_petak_m2"))
        prop = {
            "id": pid,
            "jenis": "petak",
            "luas_m2": luas_m2,
            "luas_ha": (luas_m2 / 1e4) if luas_m2 is not None else None,
            "rezim": rezim,
        }
        if b is not None:
            prop.update({
                "hujan_mm": _angka(b.get("hujan_mm")),
                "irigasi_mm": _angka(b.get("irigasi_mm")),
                "irigasi_m3": _angka(b.get("irigasi_m3")),
                "etc_mm": _angka(b.get("etc_mm")),
                "etc_m3": _angka(b.get("etc_m3")),
                "perkolasi_mm": _angka(b.get("perkolasi_mm")),
                "perkolasi_m3": _angka(b.get("perkolasi_m3")),
                "limpasan_mm": _angka(b.get("limpasan_mm")),
                "limpasan_m3": _angka(b.get("limpasan_m3")),
                "masuk_mm": _angka(b.get("masuk_mm")),
                "keluar_mm": _angka(b.get("keluar_mm")),
                "etc_pct": _angka(b.get("etc_pct")),
                "perkolasi_pct": _angka(b.get("perkolasi_pct")),
                "limpasan_pct": _angka(b.get("limpasan_pct")),
                "tma_rata": _angka(b.get("tma_rata")),
                "tma_min": _angka(b.get("tma_min")),
                "hari_diairi": _angka(b.get("hari_diairi")),
                "hari_kering": _angka(b.get("hari_kering")),
            })
            masuk, keluar = prop.get("masuk_mm"), prop.get("keluar_mm")
            prop["loss_pct_masuk"] = (100*keluar/masuk) if (masuk and keluar) else None
            bagian = [prop.get("etc_m3"), prop.get("perkolasi_m3"), prop.get("limpasan_m3")]
            prop["water_loss_m3"] = (sum(bagian) if all(v is not None for v in bagian)
                                     else None)
        if c is not None:
            prop.update({
                "nfr_mm_hari": _angka(c.get("nfr_mm_hari")),
                "dr_l_detik_ha": _angka(c.get("dr_l_detik_ha")),
                "debit_l_detik": _angka(c.get("debit_l_detik")),
                "diameter_cm": _angka(c.get("diameter_cm")),
            })
        fitur.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [_tutup(cincin)]},
            "properties": prop,
        })

    # batas lahan = poligon terluas di dalam KML
    batas = None
    poligon = baca_kml(ROOT / LOKASI["swh-011"]["kml"])
    if poligon:
        besar = max(poligon, key=lambda g: _luas_datar_m2(g["cincin"]))
        batas = {
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [_tutup(besar["cincin"])]},
            "properties": {"id": besar["nama"], "jenis": "batas"},
        }

    ringkas = {
        "luas_ha": _angka(geo.get("luas_petak_total_ha")),
        "luas_batas_ha": _angka(geo.get("luas_total_ha")),
        "n_petak": len(fitur),
        "cakupan_petak_pct": _angka(geo.get("cakupan_petak_pct")),
    }
    if len(hilang):
        luas_ha = hilang["luas_ha"]
        ringkas.update({
            "irigasi_m3": _angka(hilang["irigasi_m3"].sum()),
            "irigasi_mm": _angka((hilang["irigasi_mm"] * luas_ha).sum() / luas_ha.sum()),
            "water_loss_m3": _angka(
                (hilang["etc_m3"] + hilang["perkolasi_m3"] + hilang["limpasan_m3"]).sum()),
            "keluar_mm": _angka((hilang["keluar_mm"] * luas_ha).sum() / luas_ha.sum()),
            "masuk_mm": _angka((hilang["masuk_mm"] * luas_ha).sum() / luas_ha.sum()),
            "etc_m3": _angka(hilang["etc_m3"].sum()),
            "perkolasi_m3": _angka(hilang["perkolasi_m3"].sum()),
            "limpasan_m3": _angka(hilang["limpasan_m3"].sum()),
            "hujan_mm": _angka(hilang["hujan_mm"].max()),
        })
        # persen susunan water loss + persen terhadap air masuk, dihitung dari total
        tot_loss = sum(ringkas[k] for k in ("etc_m3", "perkolasi_m3", "limpasan_m3"))
        for k, nama in (("etc_m3", "etc_pct"), ("perkolasi_m3", "perkolasi_pct"),
                        ("limpasan_m3", "limpasan_pct")):
            ringkas[nama] = _angka(100*ringkas[k]/tot_loss) if tot_loss else None
        if ringkas.get("masuk_mm"):
            ringkas["loss_pct_masuk"] = _angka(100*ringkas["keluar_mm"]/ringkas["masuk_mm"])
    if len(debit):
        ringkas.update({
            "debit_l_detik": _angka(debit["debit_l_detik"].sum()),
            "nfr_mm_hari": _angka(
                (debit["nfr_mm_hari"] * debit["luas_ha"]).sum() / debit["luas_ha"].sum()),
        })
    return {"fitur": fitur, "batas": batas, "ringkasan": ringkas,
            "rezim_tersedia": sorted(pd.read_csv(keluaran / "water_loss.csv")["rezim"].unique())}


# ------------------------------------------------------------------ SWH-JB-GRT
def _muat_jb_grt(rezim: str) -> dict:
    """Poligon langsung dari KML - namanya (SWH-00..44) sepadan dengan CSV terrain."""
    cfg = LOKASI["swh-jb-grt"]
    keluaran = ROOT / cfg["keluaran"]
    terrain = pd.read_csv(keluaran / "terrain_per_petak.csv").set_index("petak")

    # ---- hitungan air (note-swh-jb_grt-air.ipynb); belum tentu sudah dijalankan ----
    dir_air = ROOT / cfg.get("keluaran_air", "")
    f_air = dir_air / "kebutuhan_air_petak.csv"
    air = pd.DataFrame()
    rezim_ada: list[str] = []
    if f_air.exists():
        semua = pd.read_csv(f_air)
        rezim_ada = sorted(semua["rezim"].unique())
        pilih = rezim if rezim in rezim_ada else (rezim_ada[0] if rezim_ada else None)
        if pilih is not None:
            air = semua[semua["rezim"] == pilih].set_index("petak")
            rezim = pilih

    KOLOM_AIR = [
        "hujan_mm", "irigasi_mm", "irigasi_m3", "irigasi_mm_andalan", "irigasi_m3_andalan",
        "nfr_mm_hari", "dr_l_detik_ha", "debit_l_detik", "debit_l_detik_andalan",
        "Q_isi_l_detik", "diameter_cm", "etc_mm", "etc_m3", "perkolasi_mm", "perkolasi_m3",
        "limpasan_mm", "limpasan_m3", "masuk_mm", "keluar_mm", "water_loss_m3",
        "etc_pct", "perkolasi_pct", "limpasan_pct", "loss_pct_masuk",
        "irigasi_pct_masuk", "hujan_pct_masuk",
        "tma_rata", "tma_min", "hari_diairi", "hari_kering", "hari_limpas",
    ]

    fitur = []
    for g in baca_kml(ROOT / cfg["kml"]):
        nama = g["nama"]
        t = terrain.loc[nama] if nama in terrain.index else None
        jenis = "petak"
        if t is not None and str(t.get("jenis", "")).startswith("batas"):
            jenis = "blok"
        prop = {
            "id": nama,
            "jenis": jenis,
            "luas_m2": _angka(t.get("luas_m2")) if t is not None
                       else _angka(_luas_datar_m2(g["cincin"])),
            "luas_ha": _angka(t.get("luas_ha")) if t is not None
                       else _angka(_luas_datar_m2(g["cincin"]) / 1e4),
            "rezim": None,
        }
        if t is not None:
            prop.update({
                "hamparan": t.get("hamparan"),
                "elev_rata_m": _angka(t.get("elev_rata_m")),
                "elev_min_m": _angka(t.get("elev_min_m")),
                "elev_maks_m": _angka(t.get("elev_maks_m")),
                "beda_tinggi_m": _angka(t.get("beda_tinggi_m")),
                "lereng_persen": _angka(t.get("lereng_persen")),
                "kelas_lereng": t.get("kelas_lereng"),
                "arah_hadap": t.get("arah_hadap"),
                "arah_hadap_deg": _angka(t.get("arah_hadap_deg")),
                "keliling_m": _angka(t.get("keliling_m")),
                "piksel_sumber": _angka(t.get("piksel_sumber")),
                "keandalan_terrain": t.get("keandalan_terrain"),
                "tangkapan_ha": _angka(t.get("tangkapan_ha")),
            })
        # Batas blok tidak diberi angka air: luasnya sudah terwakili petak di dalamnya,
        # jadi mengisinya akan menghitung air yang sama dua kali.
        if len(air) and nama in air.index and jenis == "petak":
            a = air.loc[nama]
            prop["rezim"] = rezim
            prop["tanam"] = a.get("tanam")
            prop.update({k: _angka(a.get(k)) for k in KOLOM_AIR})
        fitur.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [_tutup(g["cincin"])]},
            "properties": prop,
        })

    ring = pd.read_csv(keluaran / "ringkasan_lokasi.csv").iloc[0]
    ringkas = {
        "luas_ha": _angka(ring.get("luas_petak_union_ha")),
        "luas_batas_ha": _angka(ring.get("luas_union_ha")),
        "luas_naif_ha": _angka(ring.get("luas_naif_ha")),
        "n_petak": int(ring.get("n_petak")),
        "n_hamparan": int(ring.get("n_hamparan")),
        "elev_min_m": _angka(ring.get("elev_min_m")),
        "elev_maks_m": _angka(ring.get("elev_maks_m")),
        "lereng_rerata_persen": _angka(ring.get("lereng_rerata_persen")),
        "kelas_lereng_dominan": ring.get("kelas_lereng_dominan"),
        # Kalau hitungan air belum dijalankan, medan ini tetap None - halaman
        # menampilkannya "belum dihitung", bukan nol.
        "irigasi_m3": None, "irigasi_mm": None, "debit_l_detik": None,
        "water_loss_m3": None, "keluar_mm": None,
    }
    f_ring_air = dir_air / "ringkasan_air.csv"
    if len(air) and f_ring_air.exists():
        ra = pd.read_csv(f_ring_air).iloc[0]
        ringkas.update({
            "rezim": rezim, "tanam": ra.get("bulan_tanam"),
            "hari_musim": _angka(ra.get("hari_musim")),
            "irigasi_mm": _angka(air["irigasi_mm"].iloc[0]),
            "irigasi_m3": _angka(air["irigasi_m3"].sum()),
            "irigasi_m3_andalan": _angka(air["irigasi_m3_andalan"].sum()),
            "debit_l_detik": _angka(air["debit_l_detik"].sum()),
            "debit_siap_lahan_l_detik": _angka(ra.get("debit_siap_lahan_l_detik")),
            "water_loss_m3": _angka(air["water_loss_m3"].sum()),
            "keluar_mm": _angka(air["keluar_mm"].iloc[0]),
            "masuk_mm": _angka(air["masuk_mm"].iloc[0]),
            "hujan_mm": _angka(air["hujan_mm"].iloc[0]),
            "etc_pct": _angka(air["etc_pct"].iloc[0]),
            "perkolasi_pct": _angka(air["perkolasi_pct"].iloc[0]),
            "limpasan_pct": _angka(air["limpasan_pct"].iloc[0]),
            "loss_pct_masuk": _angka(air["loss_pct_masuk"].iloc[0]),
            "sumber_cuaca": ra.get("sumber_cuaca"),
            "tahun_cuaca": ra.get("tahun_cuaca"),
            "eto_rata_mm_hari": _angka(ra.get("eto_rata_mm_hari")),
        })
    return {"fitur": fitur, "batas": None, "ringkasan": ringkas,
            "rezim_tersedia": rezim_ada}


# ------------------------------------------------------------- DI Kab. Garut
# ~5,5 m, toleransi yang sama dengan lapisan SISDA berlingkup AOI. Batas DI diterbitkan
# pada skala kabupaten - ketelitiannya sendiri ada di orde puluhan meter - jadi 321.000
# simpul mentahnya tidak menerangkan apa pun di layar, cuma memberatkan.
DI_GARUT_TOLERANSI = 0.00005

# Kolom yang disalin apa adanya dari `kebutuhan_air_di.csv` ke properti tiap DI.
KOLOM_AIR_DI = [
    "hujan_mm", "irigasi_mm", "irigasi_m3", "irigasi_mm_andalan", "irigasi_m3_andalan",
    "nfr_mm_hari", "dr_l_detik_ha", "debit_l_detik", "debit_l_detik_andalan",
    "etc_mm", "etc_m3", "perkolasi_mm", "perkolasi_m3", "limpasan_mm", "limpasan_m3",
    "masuk_mm", "keluar_mm", "water_loss_m3",
    "etc_pct", "perkolasi_pct", "limpasan_pct", "loss_pct_masuk",
    "irigasi_pct_masuk", "hujan_pct_masuk",
    "tma_rata", "tma_min", "hari_diairi", "hari_kering", "hari_limpas",
    "luas_sawah_big_ha", "elev_rata_m", "eto_rata_mm_hari", "hujan_tahunan_mm",
    "bulan_tanam_optimum", "n_musim",
    # Panjang jaringan yang melintasi DI ini, beserta jaraknya kalau tidak melintas.
    # Dua-duanya keluaran `ukur_jaringan()`, dan keduanya yang memutuskan DI ini jadi
    # subjek halaman atau tidak - jadi angkanya harus bisa dilihat, bukan cuma akibatnya.
    "jaringan_m", "jarak_jaringan_m",
]


# Waktu datang air per DI, dari `tot_di.csv`. Dipisah dari KOLOM_AIR_DI karena asalnya
# beda dan bedanya harus tetap kelihatan: yang di atas dihitung dari data, yang di sini
# diturunkan dari nilai rancangan saluran - lihat catatan panjang di
# `note/hitung-tot-jaringan.py`.
KOLOM_TOT_DI = [
    "tot_air_jam", "tot_hidraulik_jam", "tot_gangguan_jam",
    "tot_air_jam_cepat", "tot_air_jam_lambat",
    "tot_air_jam_ujung", "lama_terisi_jam", "n_ruas",
    "ruas_masuk", "simpul_masuk", "ruas_ujung",
]


def _rata_bobot(kolom: pd.Series, bobot: pd.Series) -> float | None:
    """Rata-rata ditimbang luas.

    Dipakai untuk semua medan mm di lokasi ini, dan itu bukan kerapian belaka: tiap DI
    punya titik iklimnya sendiri sehingga mm-nya BERBEDA antar-DI. Mengambil baris
    pertama - cara yang benar di swh-jb-grt, karena di sana mm memang seragam - di sini
    akan melaporkan angka satu DI sebagai angka seluruh kabupaten.
    """
    b = bobot.sum()
    return _angka((kolom * bobot).sum() / b) if b else None


def _muat_di_garut(rezim: str) -> dict:
    """32 poligon DI dari SISDA, digabung dengan hitungan air per DI."""
    cfg = LOKASI["di-garut"]
    sumber = json.loads(
        (ROOT / cfg["sumber_geojson"]).read_text(encoding="utf-8"))["features"]

    dir_air = ROOT / cfg["keluaran_air"]
    f_air = dir_air / "kebutuhan_air_di.csv"
    air = pd.DataFrame()
    rezim_ada: list[str] = []
    if f_air.exists():
        semua = pd.read_csv(f_air)
        rezim_ada = sorted(semua["rezim"].unique())
        pilih = rezim if rezim in rezim_ada else (rezim_ada[0] if rezim_ada else None)
        if pilih is not None:
            air = semua[semua["rezim"] == pilih].set_index("petak")
            rezim = pilih

    # DI mana yang dilewati jaringan - dibaca, bukan diukur ulang di sini. Kalau
    # berkasnya belum ada (skrip belum pernah jalan sesudah penyaringan ini masuk),
    # semuanya dilewatkan: lebih baik menampilkan 32 DI apa adanya daripada
    # menyembunyikan 21 di antaranya karena satu berkas yang kebetulan belum ditulis.
    # Waktu datang air per DI, dijembatani dari waktu per ruas oleh
    # `hitung-tot-jaringan.py`. Menyusul terpisah: skrip itu belum tentu sudah
    # dijalankan, dan halaman harus tetap utuh tanpanya.
    tot = pd.DataFrame()
    f_tot = ROOT / "note" / "output-jaringan-air" / "tot_di.csv"
    if f_tot.exists():
        tot = pd.read_csv(f_tot).set_index("di")

    jalur, luar = None, []
    f_jalur = dir_air / "di_jalur.csv"
    if cfg.get("saring_jalur") and f_jalur.exists():
        dj = pd.read_csv(f_jalur)
        jalur = set(dj[dj["di_jalur"].astype(bool)]["di"])
        luar = dj[~dj["di_jalur"].astype(bool)]

    fitur = []
    for f in sumber:
        p = f["properties"]
        nama = p["Nama_DI"]
        if jalur is not None and nama not in jalur:
            continue
        # Luas diukur dari geometri ASLI, penyederhanaan hanya untuk yang dikirim ke
        # peramban - kalau diukur sesudahnya, luas di halaman bergeser mengikuti
        # toleransi gambar, dan itu angka yang tidak pernah ada di sumbernya.
        luas_m2, keliling_m = _ukuran_geom(f["geometry"])
        prop = {
            "id": nama,
            "jenis": "petak",
            # `luas_ha` = luas BAKU, karena itu yang jadi dasar seluruh hitungan airnya.
            # Luas hasil ukur geometri dibawa terpisah supaya selisihnya bisa dilihat,
            # bukan diam-diam menggantikan yang satunya.
            "luas_ha": _angka(p.get("Luas_CEA")),
            "luas_m2": _angka((p.get("Luas_CEA") or 0) * 1e4),
            "luas_geom_ha": _angka(luas_m2 / 1e4),
            "keliling_m": _angka(keliling_m),
            "kewenangan": p.get("Kewenangan"),
            "status": p.get("Status"),
            "rezim": None,
        }
        if len(air) and nama in air.index:
            a = air.loc[nama]
            prop["rezim"] = rezim
            prop["tanam"] = a.get("tanam")
            for k in KOLOM_AIR_DI:
                nilai = a.get(k)
                prop[k] = nilai if isinstance(nilai, str) else _angka(nilai)
        if len(tot) and nama in tot.index:
            t = tot.loc[nama]
            for k in KOLOM_TOT_DI:
                nilai = t.get(k)
                prop[k] = nilai if isinstance(nilai, str) else _angka(nilai)
        fitur.append({
            "type": "Feature",
            "geometry": _sederhanakan_geom(f["geometry"], DI_GARUT_TOLERANSI),
            "properties": prop,
        })

    luas = pd.Series([f["properties"]["luas_ha"] or 0.0 for f in fitur])
    ringkas = {
        "luas_ha": _angka(float(luas.sum())),
        "n_petak": len(fitur),
        # Yang disisihkan ikut dilaporkan, tidak dihilangkan diam-diam: pembaca yang
        # tahu Kab. Garut punya 32 DI harus bisa melihat ke mana 21 sisanya pergi.
        "n_di_luar_jalur": int(len(luar)) if len(luar) else None,
        "luas_luar_jalur_ha": (_angka(float(luar["luas_cea_ha"].sum()))
                               if len(luar) else None),
        # Tetap None kalau hitungan airnya belum dijalankan - halaman menuliskannya
        # "belum dihitung", bukan nol yang terlihat seperti hasil.
        "irigasi_m3": None, "irigasi_mm": None, "debit_l_detik": None,
        "water_loss_m3": None, "keluar_mm": None,
    }
    f_ring = dir_air / "ringkasan_air.csv"
    if len(air):
        ha = air["luas_ha"]
        ringkas.update({
            "rezim": rezim,
            # Berapa DI yang BENAR-BENAR punya angka air, di samping berapa DI yang
            # digambar. Keduanya tidak selalu sama - `hitung-di-garut-air.py` bisa
            # dijalankan untuk sebagian DI saja (`--uji N`), dan DI yang cuacanya tidak
            # terambil sengaja dilewati tanpa diisi angka DI lain. Tanpa dua medan ini,
            # kartu ringkasan menyandingkan luas SELURUH DI dengan air SEBAGIAN DI dan
            # tidak ada apa pun di halaman yang menunjukkan keduanya beda cakupan.
            "n_petak_air": int(len(air)),
            "luas_air_ha": _angka(ha.sum()),
            "irigasi_m3": _angka(air["irigasi_m3"].sum()),
            "irigasi_m3_andalan": _angka(air["irigasi_m3_andalan"].sum()),
            "water_loss_m3": _angka(air["water_loss_m3"].sum()),
            "debit_l_detik": _angka(air["debit_l_detik"].sum()),
            "irigasi_mm": _rata_bobot(air["irigasi_mm"], ha),
            "hujan_mm": _rata_bobot(air["hujan_mm"], ha),
            "masuk_mm": _rata_bobot(air["masuk_mm"], ha),
            "keluar_mm": _rata_bobot(air["keluar_mm"], ha),
            "nfr_mm_hari": _rata_bobot(air["nfr_mm_hari"], ha),
            "luas_sawah_big_ha": _angka(air["luas_sawah_big_ha"].sum()),
        })
        # Susunan water loss dihitung dari JUMLAH m³-nya, bukan dari rata-rata persen
        # tiap DI: DI seluas 4 ha dan DI seluas 801 ha tidak boleh sama beratnya dalam
        # menjawab "ke mana air se-kabupaten ini pergi".
        tot = sum(air[f"{k}_m3"].sum() for k in ("etc", "perkolasi", "limpasan"))
        for k in ("etc", "perkolasi", "limpasan"):
            ringkas[f"{k}_pct"] = _angka(100 * air[f"{k}_m3"].sum() / tot) if tot else None
        if ringkas.get("masuk_mm"):
            ringkas["loss_pct_masuk"] = _angka(
                100 * ringkas["keluar_mm"] / ringkas["masuk_mm"])
    if f_ring.exists():
        ra = pd.read_csv(f_ring).iloc[0]
        ringkas.update({
            "tanam": ra.get("bulan_tanam"),
            "hari_musim": _angka(ra.get("hari_musim")),
            "debit_siap_lahan_l_detik": _angka(ra.get("debit_siap_lahan_l_detik")),
            "sumber_cuaca": ra.get("sumber_cuaca"),
            "tahun_cuaca": ra.get("tahun_cuaca"),
            "eto_rata_mm_hari": _angka(ra.get("eto_rata_mm_hari")),
        })
    return {"fitur": fitur, "batas": None, "ringkasan": ringkas,
            "rezim_tersedia": rezim_ada}


# ------------------------------------------------- Jaringan D.I. Leuwigoong
# Kolom yang disalin apa adanya dari `kebutuhan_air_ruas.csv` ke properti tiap ruas.
KOLOM_AIR_RUAS = [
    "panjang_m", "panjang_km", "luas_layanan_sendiri_ha", "luas_layanan_hilir_ha",
    "n_ruas_hilir", "tingkat", "efisiensi_kumulatif",
    "hujan_mm", "irigasi_mm", "irigasi_m3", "irigasi_m3_andalan", "irigasi_m3_kotor",
    "irigasi_m3_sendiri", "nfr_mm_hari", "dr_l_detik_ha",
    "debit_l_detik", "debit_l_detik_hilir", "debit_l_detik_km", "debit_l_detik_sendiri",
    "etc_mm", "etc_m3", "perkolasi_mm", "perkolasi_m3", "limpasan_mm", "limpasan_m3",
    "masuk_mm", "keluar_mm", "water_loss_m3", "water_loss_m3_sendiri",
    "etc_pct", "perkolasi_pct", "limpasan_pct", "loss_pct_masuk",
    "irigasi_pct_masuk", "hujan_pct_masuk",
    "tma_rata", "tma_min", "hari_diairi", "hari_kering", "hari_limpas",
    "elev_rata_m", "eto_rata_mm_hari", "hujan_tahunan_mm", "n_musim",
]
# Kolom Time of Travel, dari `tot_ruas.csv` (`hitung-tot-jaringan.py`). Dipisah dari
# KOLOM_AIR_RUAS karena wataknya berbeda dan bedanya harus tetap kelihatan: yang di atas
# DIHITUNG dari data, yang di sini DITURUNKAN dari nilai rancangan - penampang,
# kemiringan dasar, dan kekasaran saluran tidak ada satu pun di SISDA.
KOLOM_TOT = [
    "v_m_detik", "v_operasi_m_detik", "h_m", "b_m", "A_m2", "froude", "beta",
    "n", "S", "bh", "m",
    "t_air_jam", "t_hidraulik_jam", "t_gangguan_jam", "t_air_jam_giliran",
    "kum_t_air_jam", "kum_t_hidraulik_jam", "kum_t_gangguan_jam",
    "kum_t_air_jam_giliran", "kum_t_air_jam_cepat", "kum_t_air_jam_lambat",
    "kum_t_hidraulik_jam_cepat", "kum_t_hidraulik_jam_lambat",
]
KOLOM_TEKS_TOT = ["node_a", "node_b", "simpul_hulu"]

# Kolom teks - dilewatkan apa adanya, bukan lewat `_angka`.
#
# Kolom `jenis` pada CSV SENGAJA TIDAK ikut: di CSV ia berarti tingkat saluran
# (Primer/Sekunder/Tersier), sedangkan `jenis` pada properti fitur menandai peran objek
# di halaman ("petak" = subjek yang diukur). Menyalinnya akan menimpa penanda itu, dan
# akibatnya tidak kelihatan seperti sebab: `hitungRentang()` di app.js hanya menghitung
# fitur ber-`jenis` "petak", jadi rentang warnanya jadi kosong dan SELURUH ruas
# tergambar abu-abu tanpa satu pun pesan galat. Tingkat salurannya sudah dibawa
# terpisah sebagai `jenis_saluran`, dibaca dari GeoJSON-nya.
KOLOM_TEKS_RUAS = ["hulu", "zona_iklim", "tanam", "bulan_tanam_optimum"]


def _muat_jaringan(rezim: str) -> dict:
    """176 ruas saluran, digabung dengan hitungan air per ruas.

    Beda pokok dengan pemuat lain: `luas_ha` di sini BUKAN luas objeknya sendiri -
    saluran tidak punya luas - melainkan luas lahan yang airnya lewat ruas itu. Itu
    yang menentukan debitnya, jadi itu pula yang jadi luas pokoknya; luas yang menempel
    pada ruas itu sendiri dibawa terpisah di `luas_layanan_sendiri_ha`.
    """
    cfg = LOKASI["jaringan-leuwigoong"]
    berkas = ROOT / cfg["sumber_geojson"]
    if not berkas.exists():
        raise FileNotFoundError(
            f"{cfg['sumber_geojson']} belum ada — jalankan `python {cfg['notebook']}`")
    sumber = json.loads(berkas.read_text(encoding="utf-8"))["features"]

    dir_air = ROOT / cfg["keluaran_air"]
    f_air = dir_air / "kebutuhan_air_ruas.csv"
    air = pd.DataFrame()
    rezim_ada: list[str] = []
    if f_air.exists():
        semua = pd.read_csv(f_air)
        rezim_ada = sorted(semua["rezim"].unique())
        pilih = rezim if rezim in rezim_ada else (rezim_ada[0] if rezim_ada else None)
        if pilih is not None:
            air = semua[semua["rezim"] == pilih].set_index("petak")
            rezim = pilih

    # Time of Travel menyusul terpisah: ia keluaran skrip lain yang belum tentu sudah
    # dijalankan, dan halaman harus tetap utuh tanpanya - sama seperti lokasi yang
    # hitungan airnya belum ada.
    tot = pd.DataFrame()
    f_tot = dir_air / "tot_ruas.csv"
    if f_tot.exists():
        tot = pd.read_csv(f_tot).set_index("ruas")

    fitur = []
    for f in sumber:
        p = f["properties"]
        nama = p["id"]
        prop = {
            "id": nama,
            "jenis": "petak",              # subjek halaman - lihat gayaPetak() di app.js
            "kode": p.get("kode"),
            "nama_ruas": p.get("nama"),
            "jenis_saluran": p.get("jenis"),
            "rezim": None,
            # Saluran tidak punya luas maupun keliling. Dikirim None, bukan 0, supaya
            # halaman melewatinya alih-alih menuliskan "0 ha" yang terbaca seperti hasil.
            "luas_ha": None, "luas_m2": None, "keliling_m": None,
        }
        if len(air) and nama in air.index:
            a = air.loc[nama]
            prop["rezim"] = rezim
            prop["luas_ha"] = _angka(a.get("luas_ha"))
            prop["luas_m2"] = _angka(a.get("luas_m2"))
            prop["terhubung"] = bool(a.get("terhubung"))
            for k in KOLOM_TEKS_RUAS:
                nilai = a.get(k)
                prop[k] = nilai if isinstance(nilai, str) else None
            for k in KOLOM_AIR_RUAS:
                prop[k] = _angka(a.get(k))
        if len(tot) and nama in tot.index:
            t = tot.loc[nama]
            for k in KOLOM_TEKS_TOT:
                nilai = t.get(k)
                prop[k] = nilai if isinstance(nilai, str) else None
            for k in KOLOM_TOT:
                prop[k] = _angka(t.get(k))
            # Sama seperti di ringkasan: kosong berarti "tidak punya kecepatan",
            # bukan "kecepatannya rendah".
            v_min = t.get("di_bawah_v_min")
            prop["di_bawah_v_min"] = (None if pd.isna(v_min) else bool(v_min))
        fitur.append({"type": "Feature", "geometry": f["geometry"],
                      "properties": prop})

    ringkas = {
        "n_petak": len(fitur),
        "luas_ha": None, "irigasi_m3": None, "irigasi_mm": None,
        "debit_l_detik": None, "water_loss_m3": None, "keluar_mm": None,
    }
    if len(air):
        # Yang dijumlahkan kolom SENDIRI, bukan kolom terakumulasi: air yang lewat satu
        # primer sudah memuat air seluruh tersier di hilirnya, jadi menjumlah kolom
        # terakumulasi akan menghitung volume yang sama tiga kali - sekali di tiap
        # tingkat saluran yang dilewatinya.
        ha = air["luas_layanan_sendiri_ha"]
        ringkas.update({
            "rezim": rezim,
            "luas_ha": _angka(ha.sum()),
            "panjang_km": _angka(air["panjang_km"].sum()),
            "irigasi_m3": _angka(air["irigasi_m3_sendiri"].sum()),
            "water_loss_m3": _angka(air["water_loss_m3_sendiri"].sum()),
            # Debit se-jaringan = debit di ruas paling hulu, BUKAN jumlah seluruh ruas.
            # Menjumlahkannya akan melaporkan debit belasan kali lipat dari yang
            # benar-benar lewat bendung.
            "debit_l_detik": _angka(air["debit_l_detik"].max()),
            "irigasi_mm": _rata_bobot(air["irigasi_mm"], ha),
            "hujan_mm": _rata_bobot(air["hujan_mm"], ha),
            "masuk_mm": _rata_bobot(air["masuk_mm"], ha),
            "keluar_mm": _rata_bobot(air["keluar_mm"], ha),
            "nfr_mm_hari": _rata_bobot(air["nfr_mm_hari"], ha),
            "n_ruas_lepas": int((~air["terhubung"].astype(bool)).sum()),
        })
    if len(tot):
        # Titik TERJAUH menurut waktu, bukan menurut jarak - itu yang menentukan berapa
        # lama satu perintah pintu di bendung baru selesai berlaku di seluruh jaringan.
        jauh = tot.loc[tot["kum_t_air_jam"].idxmax()] if tot["kum_t_air_jam"].notna().any() \
            else None
        # `fillna(False)` bukan kerapian: ruas tanpa debit rancangan tidak punya
        # kecepatan sama sekali, jadi kolomnya kosong - dan `bool(NaN)` di Python
        # bernilai True, sehingga tanpa ini ruas yang tidak punya kecepatan ikut
        # terhitung sebagai ruas yang kecepatannya terlalu rendah.
        bawah = tot["di_bawah_v_min"].fillna(False).astype(bool)
        ringkas.update({
            "tot_titik_terjauh": (str(jauh.name) if jauh is not None else None),
            "tot_air_jam": _angka(jauh.get("kum_t_air_jam")) if jauh is not None else None,
            "tot_hidraulik_jam": (_angka(jauh.get("kum_t_hidraulik_jam"))
                                  if jauh is not None else None),
            "tot_gangguan_jam": (_angka(jauh.get("kum_t_gangguan_jam"))
                                 if jauh is not None else None),
            "tot_air_jam_cepat": (_angka(jauh.get("kum_t_air_jam_cepat"))
                                  if jauh is not None else None),
            "tot_air_jam_lambat": (_angka(jauh.get("kum_t_air_jam_lambat"))
                                   if jauh is not None else None),
            "n_ruas_bawah_v_min": int(bawah.sum()),
            "km_bawah_v_min": _angka(tot.loc[bawah, "panjang_m"].sum() / 1000),
        })
        tot = sum(air[f"{k}_m3_sendiri"].sum() for k in ("etc", "perkolasi", "limpasan"))
        for k in ("etc", "perkolasi", "limpasan"):
            ringkas[f"{k}_pct"] = (_angka(100 * air[f"{k}_m3_sendiri"].sum() / tot)
                                   if tot else None)
        if ringkas.get("masuk_mm"):
            ringkas["loss_pct_masuk"] = _angka(
                100 * ringkas["keluar_mm"] / ringkas["masuk_mm"])
    f_ring = dir_air / "ringkasan_air.csv"
    if f_ring.exists():
        ra = pd.read_csv(f_ring).iloc[0]
        ringkas.update({
            "tanam": ra.get("bulan_tanam"),
            "hari_musim": _angka(ra.get("hari_musim")),
            "debit_siap_lahan_l_detik": _angka(ra.get("debit_siap_lahan_l_detik")),
            "sumber_cuaca": ra.get("sumber_cuaca"),
            "tahun_cuaca": ra.get("tahun_cuaca"),
            "eto_rata_mm_hari": _angka(ra.get("eto_rata_mm_hari")),
            "hulu": ra.get("hulu"),
            "servis_maks_m": _angka(ra.get("servis_maks_m")),
            "luas_sawah_di_luar_jangkauan_ha": _angka(
                ra.get("luas_sawah_di_luar_jangkauan_ha")),
            "panjang_tersambung_km": _angka(ra.get("panjang_tersambung_km")),
            # Zona yang iklimnya dipinjam dari zona terdekat, karena jatah layanan
            # cuaca habis saat skripnya jalan. Dibawa ke halaman supaya cakupan yang
            # belum penuh terbaca dari kartunya, bukan cuma dari CSV.
            "n_zona_pinjam": _angka(ra.get("n_zona_pinjam")),
            "n_zona_iklim": _angka(ra.get("n_zona_iklim")),
            "luas_zona_pinjam_ha": _angka(ra.get("luas_zona_pinjam_ha")),
        })
    return {"fitur": fitur, "batas": None, "ringkasan": ringkas,
            "rezim_tersedia": rezim_ada}


# ------------------------------------------------------------------ Leuwigoong
def _muat_leuwigoong(rezim: str | None = None) -> dict:
    """Petak Leuwigoong dari layanan luar - SISDA atau BIG, menurut `sumber_petak`.

    Tidak ada satu pun angka air di sini dan itu memang keadaannya: kedua layanan
    menyimpan bentuk dan penetapan, bukan hasil hitungan neraca air. Luas dan keliling
    diturunkan dari geometri dengan rumus yang sama seperti lokasi lain. Sisanya
    dikirim None supaya halaman menuliskannya "belum dihitung".
    """
    cfg = LOKASI["leuwigoong"]
    if cfg.get("sumber_petak") == "big":
        return _muat_leuwigoong_big(cfg)
    return _muat_leuwigoong_kosong(cfg)


def _muat_leuwigoong_kosong(cfg: dict) -> dict:
    """Lokasi tanpa objek terukur - yang tersaji hanya lapisan letak dari SISDA.

    Bukan kegagalan memuat, melainkan keadaan yang dipilih: alasannya ditulis di
    `catatan_air` supaya halaman menyampaikannya sendiri, bukan menampilkan peta yang
    kosong tanpa keterangan. Lihat catatan panjang di LOKASI["leuwigoong"].
    """
    ringkas = {
        "luas_ha": None,
        "n_petak": 0,
        "irigasi_m3": None, "irigasi_mm": None, "debit_l_detik": None,
        "water_loss_m3": None, "keluar_mm": None,
        "catatan_air": (
            "tanpa petak terukur — petak baku SISDA dibuang karena 415 dari 886 petaknya "
            "(2.330 ha, 46,8%) bertindihan dengan DI kewenangan Kab. Garut dari layanan "
            "yang sama; yang tersaji di sini letak jaringan, bangunan, dan kewenangan"),
    }
    return {"fitur": [], "batas": None, "ringkasan": ringkas, "rezim_tersedia": []}


def _muat_leuwigoong_big(cfg: dict) -> dict:
    """Blok tutupan lahan sawah RBI 25K, dipotong ke kotak persegi AOI."""
    kotak = list(cfg["kotak"])          # wajib ada untuk sumber ini - lihat catatan LOKASI
    tema = _petak_big("leuwigoong", cfg)

    # BIG mengembalikan poligon UTUH begitu ia menyentuh kotak, jadi satu blok sawah
    # bisa menjulur jauh ke luar Leuwigoong dan membuat luasnya tak masuk akal. Tanpa
    # pemotongan ini, jumlah luasnya melebihi seluruh D.I. Leuwigoong.
    diukur = []
    for f in tema["geojson"]["features"]:
        geom = _potong_geom(f.get("geometry") or {}, kotak)
        if geom is None:
            continue
        luas_m2, keliling_m = _ukuran_geom(geom)
        if luas_m2 <= 0:
            continue
        diukur.append((luas_m2, keliling_m, geom, f))
    # Nomor diurutkan dari yang terluas supaya LW-001 selalu objek yang sama selama
    # data BIG-nya tidak berubah. Penomoran ini milik kita, bukan dari BIG.
    diukur.sort(key=lambda x: x[0], reverse=True)

    fitur = []
    for nomor, (luas_m2, keliling_m, geom, f) in enumerate(diukur, start=1):
        p = f.get("properties") or {}
        fitur.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "id": f"LW-{nomor:03d}",
                "jenis": "petak",
                "luas_m2": _angka(luas_m2),
                "luas_ha": _angka(luas_m2 / 1e4),
                "keliling_m": _angka(keliling_m),
                "jenis_sawah": p.get("keterangan"),
                "nama_big": p.get("nama"),
                "lapisan_big": p.get("lapisan"),
                "seri_big": p.get("seri"),
                "rezim": None,
            },
        })

    luas_total_m2 = sum(f["properties"]["luas_m2"] for f in fitur)
    jenis = {}
    for f in fitur:
        j = f["properties"]["jenis_sawah"] or "tanpa keterangan"
        jenis[j] = jenis.get(j, 0) + 1
    rincian = " · ".join(f"{n} {j.lower()}" for j, n in
                         sorted(jenis.items(), key=lambda x: -x[1]))

    ringkas = {
        "luas_ha": _angka(luas_total_m2 / 1e4),
        "n_petak": len(fitur),
        "seri_big": tema.get("seri"),
        "terpotong": tema.get("terpotong"),
        # Medan air sengaja None, bukan 0 - halaman menampilkannya "belum dihitung".
        "irigasi_m3": None, "irigasi_mm": None, "debit_l_detik": None,
        "water_loss_m3": None, "keluar_mm": None,
        # Ditulis apa adanya supaya tidak ada yang mengira ini petak hasil digitasi:
        # RBI menyimpan BLOK tutupan lahan, satu poligonnya bisa memuat puluhan petak.
        "catatan_air": f"blok tutupan lahan BIG RBI {tema.get('seri') or '-'}, "
                       "bukan petak per pematang"
                       f"{'; ' + rincian if rincian else ''}"
                       "; dipotong ke kotak AOI (persegi, bukan batas kecamatan)",
    }
    return {"fitur": fitur, "batas": None, "ringkasan": ringkas, "rezim_tersedia": []}


PEMUAT = {"swh-011": _muat_swh011, "swh-jb-grt": _muat_jb_grt,
          "leuwigoong": _muat_leuwigoong, "di-garut": _muat_di_garut,
          "jaringan-leuwigoong": _muat_jaringan}


KUNCI_LOKASI = ("id", "nama", "keterangan", "notebook", "punya_air", "sumber_petak")


def daftar_lokasi() -> list[dict]:
    """Lokasi yang tampil dan datanya benar-benar bisa dibaca."""
    keluar = []
    for lid, cfg in LOKASI.items():
        if not cfg.get("tampil", True):
            continue
        if cfg.get("kml"):
            ada = (ROOT / cfg["kml"]).exists() and (ROOT / cfg["keluaran"]).is_dir()
        elif cfg.get("sumber_geojson"):
            # Geometrinya keluaran skrip yang belum tentu sudah dijalankan. Lebih baik
            # lokasinya tidak muncul di pemilih daripada muncul lalu gagal dibuka.
            ada = (ROOT / cfg["sumber_geojson"]).exists()
        else:
            # Tanpa KML berarti geometrinya dari layanan luar - atau memang tidak ada
            # geometri sama sekali. Keduanya tidak punya berkas yang wajib hadir.
            ada = True
        if ada:
            keluar.append({k: cfg.get(k) for k in KUNCI_LOKASI})
    return keluar


def muat(lokasi_id: str, rezim: str | None = None) -> dict:
    """GeoJSON + ringkasan + daftar metrik untuk satu lokasi."""
    if lokasi_id not in PEMUAT:
        raise KeyError(lokasi_id)
    cfg = LOKASI[lokasi_id]
    hasil = PEMUAT[lokasi_id](rezim or "FL")
    fitur = hasil["fitur"]
    if hasil["batas"] is not None:
        fitur = fitur + [hasil["batas"]]
    metrik = [m for m in METRIK[lokasi_id]
              if any(f["properties"].get(m["kunci"]) is not None for f in hasil["fitur"])]
    return {
        "lokasi": {k: cfg.get(k) for k in KUNCI_LOKASI},
        "kml": cfg.get("kml"),
        # Kotak AOI ikut dikirim supaya halaman tetap bisa mengarahkan peta pada lokasi
        # yang TIDAK punya petak - tanpa ini petanya tidak tahu harus melihat ke mana.
        "kotak": _kotak_lokasi(lokasi_id) if cfg.get("kotak") else None,
        "rezim": rezim or ("FL" if hasil["rezim_tersedia"] else None),
        "rezim_tersedia": hasil["rezim_tersedia"],
        "ringkasan": hasil["ringkasan"],
        "metrik": metrik,
        "geojson": {"type": "FeatureCollection", "features": fitur},
    }


# --------------------------------------------------------------------- KML keluar
# Palet dan aturan skala ini sengaja disamakan dengan `SKALA`/`skalaLog` di app.js,
# supaya berkas yang dibuka di Google Earth terlihat sama dengan peta di halaman.
KML_SKALA = ["#eef7fb", "#d5e9f4", "#b3d5e9", "#8dbcdb", "#68a3c9", "#417fa5"]

# Medan yang ikut ditulis ke keterangan tiap objek, beserut label, satuan, dan jumlah
# angka di belakang koma. Urutannya = urutan tampil. Medan yang kosong dilewati, jadi
# satu tabel ini melayani lokasi BIG maupun lokasi hasil notebook.
KML_MEDAN = [
    ("luas_ha", "Luas", "ha", 4),
    ("luas_m2", "Luas", "m²", 0),
    ("keliling_m", "Keliling", "m", 0),
    ("jenis_saluran", "Jenis saluran", "", None),
    ("panjang_km", "Panjang", "km", 2),
    ("hulu", "Ruas di hulunya", "", None),
    ("n_ruas_hilir", "Ruas di hilirnya", "ruas", 0),
    ("luas_layanan_sendiri_ha", "Layanan menempel ruas", "ha", 1),
    ("jenis_sawah", "Jenis sawah", "", None),
    ("nama_big", "Nama di BIG", "", None),
    ("lapisan_big", "Lapisan BIG", "", None),
    ("seri_big", "Seri RBI", "", None),
    ("hamparan", "Hamparan", "", None),
    ("elev_rata_m", "Tinggi rata-rata", "m dpl", 1),
    ("lereng_persen", "Kemiringan", "%", 1),
    ("kelas_lereng", "Kelas lereng", "", None),
    ("rezim", "Rezim", "", None),
    ("irigasi_m3", "Kebutuhan air", "m³", 0),
    ("irigasi_mm", "Kebutuhan air", "mm", 0),
    ("debit_l_detik", "Debit", "l/detik", 2),
    ("nfr_mm_hari", "NFR", "mm/hari", 2),
    ("water_loss_m3", "Water loss", "m³", 0),
    ("keluar_mm", "Water loss", "mm", 0),
    # Time of Travel. Dua waktu ditulis berdampingan dengan sengaja: berkas ini dibuka
    # di Google Earth tanpa kalimat penjelas apa pun di sekelilingnya, jadi kalau cuma
    # satu yang ada, yang mana pun akan disalahpakai untuk yang lain.
    ("kum_t_air_jam", "Air sampai dari bendung", "jam", 1),
    ("kum_t_hidraulik_jam", "Respons hidraulik dari bendung", "jam", 1),
    ("t_air_jam", "Waktu tempuh ruas ini", "jam", 2),
    ("v_m_detik", "Kecepatan aliran", "m/detik", 3),
    ("h_m", "Kedalaman air (rancangan)", "m", 2),
]


def _xml(t) -> str:
    """Teks aman untuk XML. Nama objek BIG kadang memuat & atau tanda kutip."""
    return (str(t).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _angka_id(v: float, desimal: int) -> str:
    """Angka bergaya Indonesia: titik ribuan, koma desimal."""
    utuh, _, pecahan = f"{v:,.{desimal}f}".partition(".")
    utuh = utuh.replace(",", ".")
    return f"{utuh},{pecahan}" if pecahan else utuh


def _kml_warna(hex_warna: str, alfa: str = "b4") -> str:
    """#rrggbb -> aabbggrr, urutan yang dipakai KML (bukan urutan CSS)."""
    r, g, b = hex_warna[1:3], hex_warna[3:5], hex_warna[5:7]
    return f"{alfa}{b}{g}{r}".lower()


def _kml_cincin(cincin: list[list[float]]) -> str:
    return " ".join(f"{p[0]:.6f},{p[1]:.6f},0" for p in cincin)


def _kml_poligon(geom: dict) -> str:
    """Geometri GeoJSON -> Polygon/MultiGeometry KML, lubang ikut terbawa."""
    bagian = ([geom["coordinates"]] if geom.get("type") == "Polygon"
              else geom.get("coordinates", []) if geom.get("type") == "MultiPolygon"
              else [])
    poligon = []
    for cincin in bagian:
        if not cincin:
            continue
        isi = ("<outerBoundaryIs><LinearRing><coordinates>"
               f"{_kml_cincin(cincin[0])}"
               "</coordinates></LinearRing></outerBoundaryIs>")
        for lubang in cincin[1:]:
            isi += ("<innerBoundaryIs><LinearRing><coordinates>"
                    f"{_kml_cincin(lubang)}"
                    "</coordinates></LinearRing></innerBoundaryIs>")
        poligon.append(f"<Polygon><tessellate>1</tessellate>{isi}</Polygon>")
    if not poligon:
        return ""
    if len(poligon) == 1:
        return poligon[0]
    return "<MultiGeometry>" + "".join(poligon) + "</MultiGeometry>"


def _kml_garis(geom: dict) -> str:
    """Geometri GeoJSON bergaris -> LineString/MultiGeometry KML."""
    isi = geom.get("coordinates") or []
    bagian = ([isi] if geom.get("type") == "LineString"
              else isi if geom.get("type") == "MultiLineString" else [])
    garis = [f"<LineString><tessellate>1</tessellate>"
             f"<coordinates>{_kml_cincin(s)}</coordinates></LineString>"
             for s in bagian if len(s) >= 2]
    if not garis:
        return ""
    if len(garis) == 1:
        return garis[0]
    return "<MultiGeometry>" + "".join(garis) + "</MultiGeometry>"


def _kml_geom(geom: dict) -> tuple[str, str]:
    """(XML geometri, keluarga gaya). Keluarganya beda karena warnanya menumpang medan
    yang berbeda: pada bidang warna metrik ada di PolyStyle, pada garis di LineStyle -
    satu berkas KML tidak bisa memakai satu susunan gaya untuk keduanya."""
    bidang = _kml_poligon(geom)
    if bidang:
        return bidang, "w"
    return _kml_garis(geom), "g"


# Label yang berubah arti menurut subjek halamannya. Satu ruas saluran tidak punya luas
# sendiri, jadi "Luas" di situ berarti luas yang DILAYANI lewatnya - dan "Kebutuhan air"
# berarti air yang LEWAT, bukan air yang dipakai di tempat itu. Menulis label yang sama
# untuk dua arti yang berbeda adalah cara tercepat membuat berkas ini disalahbaca.
KML_LABEL = {
    "jaringan": {
        "luas_ha": "Luas dilayani", "luas_m2": "Luas dilayani",
        "irigasi_m3": "Kebutuhan air lewat ruas",
        "irigasi_mm": "Kebutuhan air lahan layanannya",
        "debit_l_detik": "Debit di hulu ruas",
        "water_loss_m3": "Water loss di hilirnya",
    },
}


def _kml_keterangan(prop: dict, sumber_petak: str | None = None) -> str:
    khusus = KML_LABEL.get(sumber_petak or "", {})
    baris = []
    for kunci, label, satuan, desimal in KML_MEDAN:
        v = prop.get(kunci)
        if v is None or v == "":
            continue
        teks = _angka_id(float(v), desimal) if desimal is not None else str(v)
        baris.append(f"<tr><td>{_xml(khusus.get(kunci, label))}</td>"
                     f"<td align='right'><b>{_xml(teks)}</b> {_xml(satuan)}</td></tr>")
    return "<table>" + "".join(baris) + "</table>"


def ke_kml(lokasi_id: str, rezim: str | None = None) -> tuple[str, str]:
    """Satu lokasi -> (nama berkas, isi KML) siap dibuka di Google Earth.

    Isinya persis yang tergambar di halaman: objek yang sama, pewarnaan yang sama,
    dan angka yang sama - tidak ada yang dihitung ulang di sini.
    """
    hasil = muat(lokasi_id, rezim)
    lok, ring = hasil["lokasi"], hasil["ringkasan"]
    fitur = [f for f in hasil["geojson"]["features"]
             if f["properties"].get("jenis") != "batas"]

    # pewarnaan mengikuti metrik pertama, sama seperti yang dipilih halaman saat dibuka
    metrik = (hasil["metrik"] or [{"kunci": "luas_ha", "label": "Luas (ha)"}])[0]
    nilai = [f["properties"].get(metrik["kunci"]) for f in fitur]
    nilai = [v for v in nilai if isinstance(v, (int, float)) and math.isfinite(v)]
    lo, hi = (min(nilai), max(nilai)) if nilai else (0.0, 0.0)
    # Batas bawah ramp = nilai POSITIF terkecil, sepadan dengan `hitungRentang()` di
    # app.js. Memakai nilai terkecil apa adanya membuat satu objek bernilai nol
    # mematikan skala log untuk semuanya - dan di jaringan itu pasti terjadi, karena
    # ruas ujung yang tidak melayani lahan memang berdebit 0.
    bawah = min((v for v in nilai if v > 0), default=0.0)
    pakai_log = bool(nilai) and bawah > 0 and hi / bawah >= 100

    def indeks_warna(v):
        if v is None or not nilai:
            return 0
        a, b, x = lo, hi, v
        if pakai_log:
            if v <= 0:
                return 0
            a, b, x = math.log(bawah), math.log(hi), math.log(max(v, bawah))
        t = (x - a) / (b - a) if b > a else 0.5
        return max(0, min(len(KML_SKALA) - 1, round(t * (len(KML_SKALA) - 1))))

    gaya = "".join(
        f"<Style id='w{i}'>"
        f"<LineStyle><color>{_kml_warna('#417fa5', 'ff')}</color><width>1.2</width></LineStyle>"
        f"<PolyStyle><color>{_kml_warna(w)}</color></PolyStyle>"
        f"</Style>"
        # Garis dibuat lebih tebal dan pekat daripada tepi poligon: di sini warnanya
        # BUKAN hiasan tepi melainkan satu-satunya pembawa nilai metriknya.
        f"<Style id='g{i}'>"
        f"<LineStyle><color>{_kml_warna(w, 'ff')}</color><width>3</width></LineStyle>"
        f"</Style>"
        for i, w in enumerate(KML_SKALA))

    tanda = []
    for f in fitur:
        p = f["properties"]
        geom, keluarga = _kml_geom(f.get("geometry") or {})
        if not geom:
            continue
        tanda.append(
            f"<Placemark><name>{_xml(p.get('id'))}</name>"
            f"<styleUrl>#{keluarga}{indeks_warna(p.get(metrik['kunci']))}</styleUrl>"
            f"<description><![CDATA["
            f"{_kml_keterangan(p, lok.get('sumber_petak'))}]]></description>"
            f"{geom}</Placemark>")

    catatan = ring.get("catatan_air") or ""
    asal = ("Poligon Agrikultur Sawah BIG RBI, dipotong ke kotak AOI"
            if lok.get("sumber_petak") == "big"
            else f"Lapisan {ring.get('sumber_lapisan')} SISDA, wilayah DI utuh"
            if lok.get("sumber_petak") == "sisda"
            else f"Keluaran notebook {lok.get('notebook')}")
    luas_teks = ("luas dilayani " if lok.get("sumber_petak") == "jaringan" else "")
    ringkas = (f"{lok.get('keterangan')}. {asal}. "
               f"{ring.get('n_petak')} objek, "
               f"{luas_teks}{_angka_id(float(ring.get('luas_ha') or 0), 2)} ha. "
               f"Warna mengikuti {metrik['label']}"
               f"{' (skala logaritmik)' if pakai_log else ''}."
               + (f" {catatan}." if catatan else ""))

    kml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
        f"<name>{_xml(lok.get('nama'))}</name>"
        f"<description><![CDATA[{_xml(ringkas)}]]></description>"
        f"{gaya}{''.join(tanda)}"
        "</Document></kml>")
    return f"{lokasi_id}.kml", kml


# ------------------------------------------------- Rupabumi Indonesia (BIG)
# Peta dasar resmi BIG, dilayani sebagai ArcGIS REST. Dua hal dipakai di sini:
#   - petak ubinnya  -> lihat rute /api/tile-rbi di app.py
#   - fiturnya       -> di-query jadi GeoJSON oleh lapisan_big() di bawah
# Ini data PEMBANDING, bukan sumber angka: tidak ada satu pun hitungan halaman
# yang berubah karenanya. Gunanya melihat sawah & sungai versi BIG berimpit atau
# tidak dengan petak hasil digitasi sendiri.
BIG_BASE = ("https://geoservices.big.go.id/rbi/rest/services/"
            "BASEMAP/Rupabumi_Indonesia/MapServer")
BIG_UA = {"User-Agent": "WMS-AgrinIrigation/1.0 (beacon swh viewer)"}
BIG_MAKS_FITUR = 1000          # sama dengan maxRecordCount service-nya
BIG_TEPI_DERAJAT = 0.03        # ~3,3 km di sekeliling AOI, supaya ada konteks

# Rupabumi terbit per seri skala (5K, 25K, 50K, ...) dan satu wilayah umumnya hanya
# terliput SATU seri. Karena itu seri diperiksa dari yang paling rinci ke yang paling
# kasar lalu berhenti pada seri pertama yang benar-benar punya fitur; kalau semuanya
# digambar sekaligus, wilayah yang kebetulan terliput dua seri akan tergambar ganda.
#
# `tampil: False` membekukan satu tema - sama idiomnya dengan `tampil` pada LOKASI:
# ia hilang dari pemilih di peta, sementara id lapisan, cache, dan pemuatnya tetap
# utuh. Sungai dan saluran irigasi dibekukan sejak SISDA masuk, karena SISDA memuat
# keduanya dengan jauh lebih lengkap di wilayah ini - saluran irigasi bahkan kosong
# sama sekali di RBI 25K. Tema `sawah` tidak ikut dibekukan: ia bukan cuma pembanding,
# `_petak_big()` memakainya sebagai geometri pokok lokasi Leuwigoong.
BIG_TEMA = [
    {
        "kunci": "sawah",
        "nama": "Sawah (BIG)",
        "warna": "#7faa78",
        "tampil": True,
        "seri": [("5K", [224]), ("10K", [403]), ("25K", [612]),
                 ("50K", [720]), ("100K", [764]), ("250K", [821])],
    },
    {
        "kunci": "sungai",
        "nama": "Sungai (BIG)",
        "warna": "#3f93c4",
        "tampil": False,        # digantikan `gc_sungai` dari SISDA
        "seri": [("5K", [237, 257]), ("25K", [566, 598]), ("50K", [673, 707]),
                 ("100K", [749, 757]), ("250K", [798, 811])],
    },
    {
        "kunci": "irigasi",
        "nama": "Saluran irigasi (BIG)",
        "warna": "#b8792b",
        "tampil": False,        # digantikan `gc_jaringan` dari SISDA
        "seri": [("5K", [233, 241, 106, 150]), ("25K", [564, 602, 571]),
                 ("50K", [671, 715, 712]), ("100K", [750]), ("250K", [797])],
    },
]


def _kotak_lokasi(lokasi_id: str) -> list[float]:
    """Kotak pembatas AOI: [W, S, E, N].

    Lokasi yang punya `kotak` sendiri memakainya apa adanya - itu memang batas yang
    dipilih, bukan turunan dari geometri. Sisanya diturunkan dari petaknya lalu
    dilebarkan BIG_TEPI_DERAJAT supaya ada konteks di sekelilingnya.
    """
    cfg = LOKASI[lokasi_id]
    if cfg.get("kotak"):
        return list(cfg["kotak"])
    poligon = baca_kml(ROOT / cfg["kml"])
    titik = [p for g in poligon for p in g["cincin"]]
    if not titik:
        raise FileNotFoundError(f"lokasi '{lokasi_id}' tidak berisi poligon")
    lon = [p[0] for p in titik]
    lat = [p[1] for p in titik]
    t = BIG_TEPI_DERAJAT
    return [min(lon) - t, min(lat) - t, max(lon) + t, max(lat) + t]


def _bulatkan(simpul):
    """Koordinat GeoJSON dirapikan: bulat 6 desimal (~11 cm) dan tanpa ordinat Z.

    Dua-duanya memangkas ukuran balasan tanpa membuang satu pun keterangan. BIG
    mengirim presisi penuh float padahal ketelitian RBI 1:25.000 ada di orde 10 m,
    jadi angka di belakang desimal keenam murni derau; dan Z-nya selalu 0 - lapisan
    ini datar, tingginya sudah dihitung sendiri dari DEM.
    """
    if isinstance(simpul, list):
        if simpul and all(isinstance(v, (int, float)) for v in simpul):
            return [round(v, 6) for v in simpul[:2]]     # satu titik: [lon, lat]
        return [_bulatkan(s) for s in simpul]
    return simpul


def _query_big(lapisan_id: int, kotak: list[float]) -> dict:
    """Satu lapisan BIG -> GeoJSON. Melempar OSError kalau layanannya tak terjangkau."""
    q = urllib.parse.urlencode({
        "where": "1=1",
        "geometry": ",".join(f"{v:.6f}" for v in kotak),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "NAMOBJ,REMARK",
        "returnGeometry": "true",
        "resultRecordCount": str(BIG_MAKS_FITUR),
        "f": "geojson",
    })
    permintaan = urllib.request.Request(f"{BIG_BASE}/{lapisan_id}/query?{q}", headers=BIG_UA)
    with urllib.request.urlopen(permintaan, timeout=40) as r:
        balasan = json.loads(r.read().decode("utf-8"))
    # ArcGIS mengirim galat dengan status 200; tanpa periksa ini, galat terbaca kosong.
    if isinstance(balasan, dict) and "error" in balasan:
        raise OSError(balasan["error"].get("message", "galat tak dikenal dari BIG"))
    return balasan


def _tema_big(tema: dict, kotak: list[float], nama_lapisan: dict[int, str]) -> dict:
    """Seri paling rinci yang punya fitur untuk satu tema, sudah jadi GeoJSON."""
    hasil = {"kunci": tema["kunci"], "nama": tema["nama"], "warna": tema["warna"],
             "seri": None, "n": 0, "lapisan": [], "terpotong": False,
             "geojson": {"type": "FeatureCollection", "features": []}}
    for seri, ids in tema["seri"]:
        fitur, dipakai, terpotong = [], [], False
        for lid in ids:
            balasan = _query_big(lid, kotak)
            f = balasan.get("features") or []
            if len(f) >= BIG_MAKS_FITUR:
                terpotong = True
            for x in f:
                p = x.setdefault("properties", {}) or {}
                nama = (p.get("NAMOBJ") or "").strip()
                geom = x.get("geometry") or {}
                if "coordinates" in geom:
                    geom["coordinates"] = _bulatkan(geom["coordinates"])
                x["properties"] = {
                    "nama": nama or None,
                    "keterangan": (p.get("REMARK") or "").strip() or None,
                    "tema": tema["kunci"],
                    "lapisan": nama_lapisan.get(lid, str(lid)),
                    "lapisan_id": lid,
                    "seri": seri,
                }
                fitur.append(x)
            if f:
                dipakai.append({"id": lid, "nama": nama_lapisan.get(lid, str(lid))})
        if fitur:
            hasil.update({"seri": seri, "n": len(fitur), "lapisan": dipakai,
                          "terpotong": terpotong,
                          "geojson": {"type": "FeatureCollection", "features": fitur}})
            break
    return hasil


def _nama_lapisan_big() -> dict[int, str]:
    """id -> nama lapisan, dibaca sekali dari keterangan service lalu disimpan."""
    simpanan = ROOT / "note" / "output" / "big" / "_lapisan.json"
    if simpanan.exists():
        return {int(k): v for k, v in json.loads(simpanan.read_text("utf-8")).items()}
    permintaan = urllib.request.Request(f"{BIG_BASE}?f=json", headers=BIG_UA)
    with urllib.request.urlopen(permintaan, timeout=40) as r:
        info = json.loads(r.read().decode("utf-8"))
    peta = {int(l["id"]): l["name"] for l in info.get("layers", [])}
    simpanan.parent.mkdir(parents=True, exist_ok=True)
    simpanan.write_text(json.dumps({str(k): v for k, v in peta.items()}), "utf-8")
    return peta


def _petak_big(lokasi_id: str, cfg: dict, segar: bool = False) -> dict:
    """Poligon sawah BIG yang dipakai SEBAGAI petak lokasi, bukan sebagai pembanding.

    Disimpan terpisah dari `lapisan_big()` karena perannya berbeda: yang ini geometri
    pokok halaman, jadi kalau tidak terambil, lokasinya memang tidak bisa ditampilkan
    dan galatnya harus naik - bukan diam-diam jadi peta kosong.
    """
    simpanan = ROOT / "note" / "output" / "big" / f"{lokasi_id}_petak.json"
    if simpanan.exists() and not segar:
        return json.loads(simpanan.read_text(encoding="utf-8"))
    tema = next(t for t in BIG_TEMA if t["kunci"] == "sawah")
    hasil = _tema_big(tema, list(cfg["kotak"]), _nama_lapisan_big())
    simpanan.parent.mkdir(parents=True, exist_ok=True)
    simpanan.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
    return hasil


def lapisan_big(lokasi_id: str, segar: bool = False) -> dict:
    """Sawah, sungai, dan saluran irigasi versi BIG di sekitar satu lokasi.

    Hasilnya disimpan di `note/output/big/<lokasi>.json` supaya halaman tetap terbuka
    tanpa jaringan. Kalau BIG tak terjangkau dan simpanan belum ada, yang dikirim
    adalah tema kosong beserta `galat` - halaman menampilkannya apa adanya, bukan
    berpura-pura BIG memang tidak punya data di situ.
    """
    if lokasi_id not in LOKASI:
        raise KeyError(lokasi_id)
    simpanan = ROOT / "note" / "output" / "big" / f"{lokasi_id}.json"
    if simpanan.exists() and not segar:
        return json.loads(simpanan.read_text(encoding="utf-8"))

    kotak = _kotak_lokasi(lokasi_id)
    # Untuk lokasi yang petaknya SUDAH berasal dari lapisan sawah BIG, menawarkan tema
    # sawah lagi berarti menggambar poligon yang sama dua kali di atas dirinya sendiri.
    diminta = [t for t in BIG_TEMA
               if t.get("tampil", True)
               and not (t["kunci"] == "sawah"
                        and LOKASI[lokasi_id].get("sumber_petak") == "big")]
    try:
        nama_lapisan = _nama_lapisan_big()
        tema = [_tema_big(t, kotak, nama_lapisan) for t in diminta]
        galat = None
    except (urllib.error.URLError, OSError, TimeoutError, ValueError) as e:
        tema = [{"kunci": t["kunci"], "nama": t["nama"], "warna": t["warna"],
                 "seri": None, "n": 0, "lapisan": [], "terpotong": False,
                 "geojson": {"type": "FeatureCollection", "features": []}}
                for t in diminta]
        galat = f"layanan BIG tidak terjangkau: {e}"

    hasil = {"lokasi": lokasi_id, "kotak": kotak, "tema": tema, "galat": galat,
             "sumber": "Badan Informasi Geospasial — Rupabumi Indonesia 2019",
             "layanan": BIG_BASE}
    if galat is None:                       # simpanan hanya diisi hasil yang sah
        simpanan.parent.mkdir(parents=True, exist_ok=True)
        simpanan.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
    return hasil




# ------------------------------------ SISDA Cimanuk-Cisanggarung (geo.sisdacimancis)
# GeoServer WFS milik BBWS Cimanuk-Cisanggarung: 99 lapisan, 30 di antaranya punya
# fitur di AOI Leuwigoong. Sumbernya beda watak dengan BIG - BIG memetakan TUTUPAN
# LAHAN hasil penafsiran citra, SISDA memetakan INFRASTRUKTUR dan KEWENANGAN yang
# ditetapkan. Bedanya terasa langsung: saluran irigasi yang di RBI 25K terbaca
# "tidak ada" di sini berjumlah 113 ruas, karena RBI memang tidak menyimpannya.
#
# Semuanya lapisan LETAK, bukan lapisan ukur: tidak ada satu pun angka halaman yang
# diambil dari sini. Yang dijawabnya "petak ini masuk DI apa, salurannya yang mana".
GC_WFS = "https://geo.sisdacimancis.id/geoserver/geocimancis/ows"
GC_RUANG = "geocimancis"                # workspace GeoServer-nya
# Layanannya di belakang Cloudflare dan menolak User-Agent bawaan urllib dengan 403.
# Identitas apa pun yang wajar diterima, jadi dipakai yang sama dengan permintaan BIG.
GC_UA = BIG_UA
# Dua toleransi penyederhanaan, karena dua perannya berbeda: apa pun yang berada di
# dalam AOI dibaca berdampingan dengan petak pada zoom besar, jadi digambar ~5,5 m;
# batas DI di luar AOI cuma konteks "DI sebelah mana" yang tidak pernah ditilik dari
# dekat, cukup ~22 m. Keduanya masih di bawah ketelitian sumbernya sendiri, yang
# diterbitkan pada skala kabupaten.
GC_TOLERANSI = 0.00005
GC_TOLERANSI_LUAR = 0.0002

# Kabupaten yang punya lapisan DI kewenangan sendiri di layanan ini.
GC_KABUPATEN = ("Brebes", "Cirebon", "Garut", "Indramayu", "Kuningan", "Majalengka")
# Daerah Irigasi yang punya berkas jaringan/bangunan/petak sendiri, dengan penamaan
# berhuruf besar (`DI_<nama>_Jaringan`). Layanan ini juga memuat keluarga DI berhuruf
# kecil (`di_cikeusik_*`, `di_kamun_*`, ...) yang polanya beda, jadi tidak dicampur.
GC_DI_SISDA = ("Leuwigoong", "Rengrang", "Rentang", "Seuseupan", "Waduk_Malahayu")


def _rincian(prop: dict, medan: list) -> list[list[str]]:
    """Properti WFS -> daftar [label, nilai] yang siap ditulis di popup.

    Penyusunannya di sini, bukan di app.js, supaya pengetahuan tentang nama kolom tiap
    lapisan berhenti di satu berkas - halaman cuma menuliskan apa yang diterimanya.
    Medan kosong digugurkan: baris "Panjang: -" tidak memberi tahu apa pun.
    """
    keluar = []
    for label, kolom, *sisa in medan:
        satuan = sisa[0] if len(sisa) > 0 else ""
        desimal = sisa[1] if len(sisa) > 1 else 0
        nilai = prop.get(kolom)
        if nilai is None or (isinstance(nilai, str) and not nilai.strip()):
            continue
        if isinstance(nilai, (int, float)) and not isinstance(nilai, bool):
            angka = _angka(nilai)
            if angka is None:
                continue
            nilai = _angka_id(angka, desimal)
        else:
            nilai = str(nilai).strip()
        keluar.append([label, f"{nilai} {satuan}".strip()])
    return keluar


def _tema_gc(kabupaten: str | None, di_sisda: str | None) -> list[dict]:
    """Susunan tema SISDA untuk satu lokasi, terurut seperti di pemilih lapisan.

    `lingkup` menentukan cara pengambilannya, dan itu mengikuti peran lapisannya:
      - "aoi"       ditanyakan dengan saringan kotak, karena lapisannya se-wilayah
                    sungai dan yang berguna hanya yang di sekitar lokasi;
      - "kabupaten" diunduh utuh, karena justru tetangga di luar AOI yang jadi isinya -
                    ia menjawab "AOI ini ada di DI sebelah mana".
    `atas` menaruh lapisan di panel di atas petak: garis saluran dan titik bangunan
    akan tenggelam di bawah isian petak kalau tidak.
    """
    tema = []
    if di_sisda:
        # Lapisan petak baku (`DI_<x>_Baku`) SENGAJA TIDAK DIPASANG. Untuk Leuwigoong ia
        # bertindihan dengan DI kewenangan kabupaten dari layanan yang sama - 46,8% dari
        # petaknya - sehingga dua lapisan itu saling menyangkal soal siapa yang melayani
        # hamparan yang mana. Selama sumbernya belum menyelesaikan itu, memasang keduanya
        # cuma memindahkan pertanggungan jawab ke pembaca peta. Catatan lengkapnya di
        # LOKASI["leuwigoong"]. (Baku, Fungsional, dan Potensial juga sudah diperiksa dan
        # isinya persis sama - sidik jari geometrinya identik.)
        tema += [
            {"kunci": "gc_jaringan", "nama": "Jaringan irigasi", "warna": "#0f766e",
             "lingkup": "aoi", "atas": True,
             "lapisan": f"DI_{di_sisda}_Jaringan", "judul": "nama", "satuan": "ruas",
             "medan": [["Jenis", "jenis"], ["Panjang", "panjang_km", "km", 2]]},
            {"kunci": "gc_bangunan", "nama": "Bangunan irigasi", "warna": "#b45309",
             "lingkup": "aoi", "atas": True,
             "lapisan": f"DI_{di_sisda}_Bangunan", "judul": "name", "satuan": "bangunan",
             "medan": [["Nomor", "no"]]},
        ]
    tema += [
        {"kunci": "gc_sungai", "nama": "Sungai", "warna": "#2563eb",
         "lingkup": "aoi", "atas": True,
         "lapisan": "sungai_orde_ln_sinkronisasi", "judul": "nama", "satuan": "alur",
         "medan": [["Nama BIG", "namobj"], ["Orde", "orde"], ["DAS", "das"],
                   ["Panjang", "panjang_km", "km", 2], ["Keterangan", "remark"]]},
        {"kunci": "gc_sempadan", "nama": "Sempadan sungai", "warna": "#93c5fd",
         "lingkup": "aoi", "atas": False,
         "lapisan": "Sempadan_Sungai_2023", "judul": "Name", "satuan": "kawasan",
         "medan": []},
        {"kunci": "gc_mata_air", "nama": "Mata air", "warna": "#0891b2",
         "lingkup": "aoi", "atas": True, "lapisan": "mata_air", "judul": "Nama",
         "satuan": "titik",
         "medan": [["Desa", "Desa"], ["Kecamatan", "Kecamatan"], ["Status", "Status"]]},
        {"kunci": "gc_situ", "nama": "Situ", "warna": "#1d4ed8",
         "lingkup": "aoi", "atas": True, "lapisan": "situ", "judul": "nama_aset",
         "satuan": "situ",
         "medan": [["Kewenangan", "kewenangan"], ["DAS", "daerah_aliran_sungai"]]},
    ]
    if kabupaten:
        tema += [
            {"kunci": "di_kab", "nama": f"DI kewenangan Kab. {kabupaten}",
             "warna": "#d98324", "lingkup": "kabupaten", "atas": False,
             "lapisan": f"DI_Kewenangan_Kabupaten_{kabupaten}", "saring": None,
             "judul": "Nama_DI", "satuan": "DI",
             "medan": [["Kewenangan", "Kewenangan"], ["Luas baku (CEA)", "Luas_CEA", "ha"],
                       ["Status", "Status"]]},
            # Lapisan provinsi memuat seluruh Jawa Barat; kolom `Kabupaten`-nya yang
            # memilah mana yang berada di wilayah ini.
            {"kunci": "di_prov", "nama": "DI kewenangan Provinsi", "warna": "#8f5fc4",
             "lingkup": "kabupaten", "atas": False,
             "lapisan": "DI_Kewenangan_Provinsi", "saring": kabupaten,
             "judul": "Nama_DI", "satuan": "DI",
             "medan": [["Kewenangan", "Kewenangan"], ["Luas baku (CEA)", "Luas_CEA", "ha"],
                       ["Kabupaten", "Kabupaten"], ["Status", "Status"]]},
        ]
    return tema


def _minta_gc(nama_lapisan: str, kotak: list[float] | None) -> dict:
    """Satu permintaan WFS -> GeoJSON. `kotak` None berarti lapisannya diambil utuh.

    `maxFeatures` sengaja tidak dipasang - bawaan aplikasi web SISDA sendiri 200, dan
    itu memotong diam-diam begitu satu lapisan punya lebih banyak fitur.
    """
    minta = {"service": "WFS", "version": "1.1.0", "request": "GetFeature",
             "typeName": f"{GC_RUANG}:{nama_lapisan}",
             "outputFormat": "application/json", "srsName": "EPSG:4326"}
    if kotak is not None:
        # Sumbu ditulis bujur-lintang; itu yang dipakai GeoServer begitu SRS-nya
        # disebut gaya "EPSG:4326" dan bukan gaya URN.
        minta["bbox"] = ",".join(f"{v:.6f}" for v in kotak) + ",EPSG:4326"
    permintaan = urllib.request.Request(f"{GC_WFS}?{urllib.parse.urlencode(minta)}",
                                        headers=GC_UA)
    with urllib.request.urlopen(permintaan, timeout=90) as r:
        balasan = json.loads(r.read().decode("utf-8"))
    if not isinstance(balasan, dict) or "features" not in balasan:
        raise OSError(f"balasan WFS untuk '{nama_lapisan}' bukan FeatureCollection")
    return balasan


def _unduh_gc_utuh(nama_lapisan: str, segar: bool = False) -> dict:
    """Lapisan berlingkup kabupaten, disimpan apa adanya di `data/`.

    Sengaja disimpan utuh - belum disederhanakan, belum disaring - supaya berkasnya
    bisa langsung dibuka di QGIS dan jadi arsip; yang dipangkas cuma salinan yang
    dikirim ke peramban. Lapisan berlingkup AOI tidak ikut disimpan begini: ia sudah
    kecil, dan simpanannya cukup di `note/output/di/<lokasi>.json`.
    """
    simpanan = ROOT / "data" / f"{nama_lapisan}.geojson"
    if simpanan.exists() and not segar:
        return json.loads(simpanan.read_text(encoding="utf-8"))
    balasan = _minta_gc(nama_lapisan, None)
    simpanan.parent.mkdir(parents=True, exist_ok=True)
    simpanan.write_text(json.dumps(balasan, ensure_ascii=False), encoding="utf-8")
    return balasan


def _satu_tema_gc(tema: dict, kotak: list[float], segar: bool = False) -> dict:
    """Satu tema SISDA: diambil, disaring, disederhanakan, dan dibakukan propertinya."""
    lingkup_kabupaten = tema["lingkup"] == "kabupaten"
    mentah = (_unduh_gc_utuh(tema["lapisan"], segar=segar) if lingkup_kabupaten
              else _minta_gc(tema["lapisan"], kotak))

    fitur, n_aoi, luas_aoi = [], 0, 0.0
    for x in mentah.get("features") or []:
        p = x.get("properties") or {}
        saring = tema.get("saring")
        if saring and saring.lower() not in (p.get("Kabupaten") or "").lower():
            continue
        asli = x.get("geometry") or {}
        # Lapisan berlingkup AOI sudah disaring layanannya, jadi semuanya "dalam".
        # Untuk yang diunduh utuh, kena-tidaknya dihitung dengan pemotongan geometri
        # sungguhan pada bentuk ASLI - bukan tumpang tindih kotak-lawan-kotak, karena
        # DI memanjang mengikuti saluran sehingga kotak pembatasnya kerap menyentuh
        # AOI padahal wilayahnya tidak. Diputuskan sebelum penyederhanaan supaya DI
        # yang cuma menyerempet tepi tidak berpindah status gara-gara garisnya digeser.
        dalam = True if not lingkup_kabupaten else _potong_geom(asli, kotak) is not None
        geom = _sederhanakan_geom(asli, GC_TOLERANSI if dalam else GC_TOLERANSI_LUAR)
        if "coordinates" in geom:
            geom["coordinates"] = _bulatkan(geom["coordinates"])
        if dalam:
            n_aoi += 1
            luas_aoi += _angka(p.get("Luas_CEA")) or 0.0
        fitur.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "nama": (str(p.get(tema["judul"]) or "").strip() or None),
                "tema": tema["kunci"],
                "rincian": _rincian(p, tema["medan"]),
                # Luas sebagai ANGKA, di samping bentuk terformatnya di `rincian`.
                # Halaman perlu mengurutkan daftarnya, dan mengurutkan teks "1.234 ha"
                # akan menaruh 999 ha di atas 1.234 ha.
                "luas_ha": _angka(p.get("Luas_CEA") or p.get("Luas_Ha")),
                "dalam_aoi": dalam,
            },
        })
    # Yang menyentuh AOI digambar paling akhir supaya garisnya tidak tertimbun
    # tetangganya yang kebetulan berimpit di tepi.
    fitur.sort(key=lambda f: f["properties"]["dalam_aoi"])
    return {"kunci": tema["kunci"], "nama": tema["nama"], "warna": tema["warna"],
            "lingkup": tema["lingkup"], "atas": tema["atas"], "lapisan": tema["lapisan"],
            # Satuan objeknya ikut dikirim karena tanpa itu angka di pemilih lapisan
            # menyesatkan: "22" pada DI kewenangan berarti 22 daerah irigasi UTUH,
            # sedangkan "886" pada petak berarti 886 bidang di dalam SATU daerah irigasi.
            "satuan": tema.get("satuan"),
            "n": len(fitur), "n_aoi": n_aoi, "luas_aoi_ha": luas_aoi,
            "geojson": {"type": "FeatureCollection", "features": fitur}}


def lapisan_di(lokasi_id: str, segar: bool = False) -> dict:
    """Lapisan SISDA di sekitar satu lokasi, siap digambar.

    Balasannya sebangun dengan `lapisan_big()` - tema, hitungan, GeoJSON, `galat` -
    supaya halaman memperlakukan keduanya dengan kode yang sama. Lokasi tanpa kunci
    `kabupaten` maupun `di_sisda` membalas daftar tema kosong, bukan galat: tidak semua
    lokasi berada di wilayah yang dilayani BBWS Cimanuk-Cisanggarung.
    """
    if lokasi_id not in LOKASI:
        raise KeyError(lokasi_id)
    cfg = LOKASI[lokasi_id]
    kabupaten = cfg.get("kabupaten") if cfg.get("kabupaten") in GC_KABUPATEN else None
    di_sisda = cfg.get("di_sisda") if cfg.get("di_sisda") in GC_DI_SISDA else None
    if not kabupaten and not di_sisda:
        return {"lokasi": lokasi_id, "kotak": None, "tema": [], "galat": None,
                "sumber": None, "layanan": GC_WFS}

    simpanan = ROOT / "note" / "output" / "di" / f"{lokasi_id}.json"
    if simpanan.exists() and not segar:
        return json.loads(simpanan.read_text(encoding="utf-8"))

    kotak = _kotak_lokasi(lokasi_id)
    diminta = _tema_gc(kabupaten, di_sisda)
    try:
        tema = [_satu_tema_gc(t, kotak, segar=segar) for t in diminta]
        galat = None
    # Sengaja hanya galat JARINGAN dan balasan cacat yang ditelan jadi `galat`. Kalau
    # ValueError ditangkap seluruhnya, salah tulis di kode ini sendiri ikut terbaca
    # "layanan tidak terjangkau" - dan halaman menuduh SISDA atas kesalahan sendiri.
    except (urllib.error.URLError, OSError, TimeoutError,
            json.JSONDecodeError) as e:
        tema = [{"kunci": t["kunci"], "nama": t["nama"], "warna": t["warna"],
                 "lingkup": t["lingkup"], "atas": t["atas"], "lapisan": t["lapisan"],
                 "satuan": t.get("satuan"), "n": 0, "n_aoi": 0, "luas_aoi_ha": 0,
                 "geojson": {"type": "FeatureCollection", "features": []}}
                for t in diminta]
        galat = f"layanan SISDA tidak terjangkau: {e}"

    hasil = {"lokasi": lokasi_id, "kotak": kotak, "tema": tema, "galat": galat,
             "kabupaten": kabupaten, "di_sisda": di_sisda,
             "sumber": "BBWS Cimanuk-Cisanggarung — SISDA (geo.sisdacimancis.id); "
                       "batas DI mengikuti Permen PUPR No. 14/2015",
             "layanan": GC_WFS}
    if galat is None:
        simpanan.parent.mkdir(parents=True, exist_ok=True)
        simpanan.write_text(json.dumps(hasil, ensure_ascii=False), encoding="utf-8")
    return hasil
