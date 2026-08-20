# -*- coding: utf-8 -*-
"""Bekukan keluaran data.py menjadi berkas statis untuk aplikasi Laravel.

Jalankan dari akar repo:

    python note/ekspor-peta.py

Hasilnya masuk ke `public/data/peta/`, dibaca langsung oleh peramban pada tab
"Peta Lokasi" tanpa melalui PHP maupun Python.

Kenapa dibekukan, bukan dihitung tiap permintaan: seluruh masukan data.py sudah
statis — CSV, JSON, dan KML keluaran notebook, yang hanya berubah kalau
notebooknya dijalankan ulang. Sementara lapisan BIG dan Daerah Irigasi diambil
dari layanan ArcGIS di luar dan terukur 1-10 detik per permintaan. Menghitung
ulang keduanya di setiap muat halaman adalah kerja yang terbuang.

Jalankan ulang skrip ini bila:
  - notebook di note/ dijalankan ulang sehingga CSV/KML keluarannya berubah,
  - konfigurasi LOKASI atau METRIK di web-app/data.py disunting,
  - lapisan BIG / Daerah Irigasi perlu disegarkan dari sumbernya.

Butuh Flask tidak, tapi butuh pandas dan sambungan internet (untuk BIG & DI).
Tambahkan --tanpa-luar untuk melewati keduanya dan hanya menulis ulang lokasi.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "web-app"))

import data  # noqa: E402  (perlu sys.path di atas lebih dulu)

TUJUAN = ROOT / "public" / "data" / "peta"


def tulis(nama: str, isi: str | dict) -> int:
    """Tulis satu berkas, kembalikan ukurannya dalam bita."""
    berkas = TUJUAN / nama
    teks = isi if isinstance(isi, str) else json.dumps(isi, ensure_ascii=False,
                                                       separators=(",", ":"))
    berkas.write_text(teks, encoding="utf-8")
    return berkas.stat().st_size


def kb(n: int) -> str:
    return f"{n / 1024:8.1f} KB"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--tanpa-luar", action="store_true",
                   help="lewati lapisan BIG & Daerah Irigasi (tanpa internet)")
    p.add_argument("--segar", action="store_true",
                   help="paksa ambil ulang lapisan BIG & DI, jangan pakai cache")
    arg = p.parse_args()

    TUJUAN.mkdir(parents=True, exist_ok=True)
    total = 0
    gagal: list[str] = []

    lokasi = data.daftar_lokasi()

    for l in lokasi:
        lid = l["id"]

        # Rezim tersedia baru diketahui setelah lokasinya dimuat sekali. Muatan
        # tanpa rezim dipakai sebagai penentu sekaligus ditulis apa adanya untuk
        # lokasi yang memang tidak punya pilihan rezim.
        t = time.time()
        try:
            dasar = data.muat(lid)
        except Exception as e:                                  # noqa: BLE001
            gagal.append(f"lokasi {lid}: {type(e).__name__}: {e}")
            print(f"  {lid:24s} GAGAL {type(e).__name__}: {str(e)[:60]}")
            continue

        rezim = dasar.get("rezim_tersedia") or []
        # Ikut ditulis ke lokasi.json. Sisi peramban perlu tahu rezim bawaan tiap
        # lokasi SEBELUM memuat apa pun, karena nama berkas beku memuat rezimnya
        # (lokasi-di-garut-FL.json, bukan lokasi-di-garut.json). Pada versi Flask
        # ini tidak perlu: muat() di sana memakai `rezim or "FL"` di server.
        l["rezim_tersedia"] = rezim

        if not rezim:
            n = tulis(f"lokasi-{lid}.json", dasar)
            total += n
            print(f"  lokasi-{lid}.json".ljust(35)
                  + f"{kb(n)}  {len(dasar['geojson']['features']):4d} fitur"
                  + f"  {time.time() - t:5.2f} s")
        else:
            for r in rezim:
                t = time.time()
                muatan = dasar if r == dasar.get("rezim") else data.muat(lid, r)
                n = tulis(f"lokasi-{lid}-{r}.json", muatan)
                total += n
                print(f"  lokasi-{lid}-{r}.json".ljust(35)
                      + f"{kb(n)}  {len(muatan['geojson']['features']):4d} fitur"
                      + f"  {time.time() - t:5.2f} s")

        # Ekspor KML: satu per rezim, mengikuti pola nama JSON-nya supaya sisi
        # peramban cukup menukar akhirannya.
        for r in (rezim or [None]):
            try:
                _, isi = data.ke_kml(lid, r)
            except Exception as e:                              # noqa: BLE001
                gagal.append(f"kml {lid}/{r}: {type(e).__name__}: {e}")
                continue
            nama = f"lokasi-{lid}.kml" if r is None else f"lokasi-{lid}-{r}.kml"
            n = tulis(nama, isi)
            total += n
            print(f"  {nama}".ljust(35) + f"{kb(n)}")

        if arg.tanpa_luar:
            continue

        for tema, fn in (("big", data.lapisan_big), ("di", data.lapisan_di)):
            t = time.time()
            try:
                n = tulis(f"{tema}-{lid}.json", fn(lid, segar=arg.segar))
            except Exception as e:                              # noqa: BLE001
                gagal.append(f"{tema} {lid}: {type(e).__name__}: {e}")
                print(f"  {tema}-{lid}.json".ljust(35)
                      + f"GAGAL {type(e).__name__}: {str(e)[:50]}")
                continue
            total += n
            print(f"  {tema}-{lid}.json".ljust(35) + f"{kb(n)}  {time.time() - t:5.2f} s")

    # Ditulis terakhir: rezim_tersedia tiap lokasi baru diketahui setelah lokasinya
    # dimuat sekali di perulangan di atas.
    n = tulis("lokasi.json", lokasi)
    total += n
    print(f"lokasi.json".ljust(35) + f"{kb(n)}  {len(lokasi)} lokasi")

    print("-" * 62)
    print(f"total {total / 1024 / 1024:.2f} MB -> {TUJUAN.relative_to(ROOT)}")
    if arg.tanpa_luar:
        print("lapisan BIG & Daerah Irigasi dilewati (--tanpa-luar)")
    if gagal:
        print(f"\n{len(gagal)} bagian gagal:")
        for g in gagal:
            print(f"  - {g}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
