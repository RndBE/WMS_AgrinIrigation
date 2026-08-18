"""
Unduh lapisan jalur irigasi untuk AOI Daerah Irigasi Kab. Garut -> data/*.geojson.

Dua sumber, dua watak:
  - SISDA Cimancis (WFS BBWS): jaringan D.I. Leuwigoong yang sudah terklasifikasi
    primer/sekunder/tersier lengkap dengan nomenklatur saluran dan bangunannya.
    Di AOI ini cuma Leuwigoong yang punya; 31 DI lain belum diterbitkan jaringannya.
  - BIG RBI 5K: saluran irigasi baseline hasil penafsiran citra, tanpa klasifikasi
    hierarki, tapi menutup seluruh AOI. Ini yang mengisi kekosongan 31 DI tadi.

Berkas disimpan utuh (belum disederhanakan) supaya bisa dibuka langsung di QGIS.
Jalankan ulang dengan --segar untuk memaksa unduh baru.
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "web-app"))
import data as wd  # pembaca WFS/BIG yang sudah ada, bukan salinan baru

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

# Kotak AOI = bbox 32 DI kewenangan Kab. Garut, dilebihkan ~2,5 km di tiap sisi supaya
# saluran yang keluar-masuk batas petak tidak terpotong di tengah ruas.
KOTAK = [107.75, -7.40, 108.10, -6.95]

BIG_SALURAN_5K = 233  # satu-satunya seri BIG yang punya saluran irigasi di AOI ini
BIG_HAL = 1000        # maxRecordCount layanan BIG


def _big_bertahap(lapisan_id: int, kotak: list[float]) -> dict:
    """Query BIG dengan paginasi.

    `_query_big` di web-app/data.py berhenti di 1.000 fitur dan tidak memberi tahu
    kalau terpotong; untuk AOI se-kabupaten itu memotong separuh data, jadi di sini
    halamannya diambil sendiri lewat resultOffset sampai layanan bilang habis.
    """
    fitur = []
    while True:
        q = urllib.parse.urlencode({
            "where": "1=1",
            "geometry": ",".join(f"{v:.6f}" for v in kotak),
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326", "outSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "OBJECTID,NAMOBJ,REMARK",
            "orderByFields": "OBJECTID",
            "returnGeometry": "true",
            "resultOffset": str(len(fitur)),
            "resultRecordCount": str(BIG_HAL),
            "f": "geojson",
        })
        permintaan = urllib.request.Request(
            f"{wd.BIG_BASE}/{lapisan_id}/query?{q}", headers=wd.BIG_UA)
        with urllib.request.urlopen(permintaan, timeout=90) as r:
            balasan = json.loads(r.read().decode("utf-8"))
        # ArcGIS mengirim galat dengan status 200; tanpa periksa ini, galat terbaca kosong.
        if isinstance(balasan, dict) and "error" in balasan:
            raise OSError(balasan["error"].get("message", "galat tak dikenal dari BIG"))
        halaman = balasan.get("features") or []
        fitur += halaman
        print(f"    ... {len(fitur)} fitur")
        if len(halaman) < BIG_HAL:
            break
    return {"type": "FeatureCollection", "features": fitur}


def simpan(nama: str, isi: dict, segar: bool) -> dict:
    berkas = DATA / f"{nama}.geojson"
    if berkas.exists() and not segar:
        print(f"  {berkas.name}: sudah ada, dilewati")
        return json.loads(berkas.read_text(encoding="utf-8"))
    berkas.write_text(json.dumps(isi, ensure_ascii=False), encoding="utf-8")
    print(f"  {berkas.name}: {len(isi['features'])} fitur, "
          f"{berkas.stat().st_size / 1e6:.2f} MB")
    return isi


def main():
    segar = "--segar" in sys.argv
    DATA.mkdir(parents=True, exist_ok=True)

    for lapisan in ("DI_Leuwigoong_Jaringan", "DI_Leuwigoong_Bangunan", "Bendung"):
        berkas = DATA / f"{lapisan}.geojson"
        if berkas.exists() and not segar:
            print(f"  {berkas.name}: sudah ada, dilewati")
            continue
        print(f"  SISDA {lapisan} ...")
        simpan(lapisan, wd._minta_gc(lapisan, KOTAK), segar=True)

    berkas = DATA / "Saluran_Irigasi_BIG_5K.geojson"
    if berkas.exists() and not segar:
        print(f"  {berkas.name}: sudah ada, dilewati")
    else:
        print(f"  BIG RBI 5K lapisan {BIG_SALURAN_5K} ...")
        simpan("Saluran_Irigasi_BIG_5K", _big_bertahap(BIG_SALURAN_5K, KOTAK), segar=True)


if __name__ == "__main__":
    main()
