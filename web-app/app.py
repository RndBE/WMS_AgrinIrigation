# -*- coding: utf-8 -*-
"""Beacon SWH — peta satu halaman untuk hasil analisa sawah dan pengairan.

Jalankan:
    python web-app/app.py
Alamatnya dicetak saat mulai: http://127.0.0.1:5000 dan http://<IP-PC>:5000, sehingga
bisa dibuka dari ponsel atau laptop lain di jaringan yang sama.

Pengaturan lewat variabel lingkungan (semuanya ada nilai bawaan):
    BEACON_HOST   antarmuka yang didengarkan (bawaan 0.0.0.0 = semua)
    BEACON_PORT   porta (bawaan 5000)
    BEACON_DEBUG  1 untuk menyalakan debugger Werkzeug - HANYA kalau host 127.0.0.1

Backend-nya mengerjakan tiga hal: membaca KML dan mengubahnya jadi GeoJSON,
menggabungkannya dengan hasil hitungan notebook, dan meneruskan tile citra satelit
lewat cache lokal `note/output/tiles` supaya peta tetap terbuka walau tanpa jaringan.
"""
from __future__ import annotations

import os
import socket
import urllib.error
import urllib.request
from pathlib import Path

from flask import Flask, Response, jsonify, render_template, send_from_directory

import data

APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
TILE_DIR = ROOT / "note" / "output" / "tiles"
TILE_URL = ("https://server.arcgisonline.com/ArcGIS/rest/services/"
            "World_Imagery/MapServer/tile/{z}/{y}/{x}")
# Peta dasar Rupabumi Indonesia (BIG). Cache-nya ubin tetap, jadi pola alamatnya
# sama persis dengan Esri di atas - {z}/{y}/{x}, bukan {z}/{x}/{y}.
RBI_DIR = ROOT / "note" / "output" / "tiles-rbi"
RBI_URL = ("https://geoservices.big.go.id/rbi/rest/services/"
           "BASEMAP/Rupabumi_Indonesia/MapServer/tile/{z}/{y}/{x}")
UA = {"User-Agent": "WMS-AgrinIrigation/1.0 (beacon swh viewer)"}

app = Flask(__name__)
# Tanpa debug, Jinja menyimpan template di ingatan dan suntingan index.html tidak
# terlihat sampai server dimatikan. Debuggernya tetap mati - hanya pemuatan ulang
# template yang dinyalakan.
app.config["TEMPLATES_AUTO_RELOAD"] = True


@app.get("/")
def halaman():
    return render_template("index.html", lokasi=data.daftar_lokasi())


@app.get("/api/lokasi")
def api_daftar():
    return jsonify(data.daftar_lokasi())


@app.get("/api/lokasi/<lokasi_id>")
def api_lokasi(lokasi_id: str):
    from flask import request
    rezim = request.args.get("rezim") or None
    try:
        return jsonify(data.muat(lokasi_id, rezim))
    except KeyError:
        return jsonify({"galat": f"lokasi '{lokasi_id}' tidak dikenal"}), 404
    except FileNotFoundError as e:
        return jsonify({"galat": f"berkas hasil analisa tidak ditemukan: {e}"}), 500


def _tile(direktori: Path, pola: str, z: int, x: int, y: int, ext: str, mime: str):
    """Satu ubin dari cache; kalau belum ada, diunduh sekali lalu ikut disimpan."""
    direktori.mkdir(parents=True, exist_ok=True)
    berkas = direktori / f"{z}_{x}_{y}.{ext}"
    if not berkas.exists():
        try:
            permintaan = urllib.request.Request(pola.format(z=z, x=x, y=y), headers=UA)
            with urllib.request.urlopen(permintaan, timeout=20) as r:
                isi = r.read()
            berkas.write_bytes(isi)
        except (urllib.error.URLError, TimeoutError, OSError):
            # Tanpa jaringan peta tetap jalan: ubin kosong, poligon tetap tergambar.
            return Response(status=204)
    return send_from_directory(direktori, berkas.name, mimetype=mime,
                               max_age=60 * 60 * 24 * 30)


@app.get("/api/lokasi/<lokasi_id>.kml")
def api_kml(lokasi_id: str):
    """Lokasi yang sedang dilihat, sebagai KML untuk Google Earth / QGIS."""
    from flask import request
    rezim = request.args.get("rezim") or None
    try:
        nama, isi = data.ke_kml(lokasi_id, rezim)
    except KeyError:
        return jsonify({"galat": f"lokasi '{lokasi_id}' tidak dikenal"}), 404
    except FileNotFoundError as e:
        return jsonify({"galat": f"berkas hasil analisa tidak ditemukan: {e}"}), 500
    return Response(isi, mimetype="application/vnd.google-earth.kml+xml",
                    headers={"Content-Disposition": f'attachment; filename="{nama}"'})


@app.get("/api/tile/<int:z>/<int:x>/<int:y>.jpg")
def api_tile(z: int, x: int, y: int):
    """Citra satelit Esri, lewat cache notebook `note/output/tiles`."""
    return _tile(TILE_DIR, TILE_URL, z, x, y, "jpg", "image/jpeg")


@app.get("/api/tile-rbi/<int:z>/<int:x>/<int:y>.png")
def api_tile_rbi(z: int, x: int, y: int):
    """Peta dasar Rupabumi BIG. Cache-nya berhenti di zoom 18; di atas itu BIG
    membalas 404 dan rute ini mengirim 204 supaya Leaflet diam saja."""
    return _tile(RBI_DIR, RBI_URL, z, x, y, "png", "image/png")


@app.get("/api/big/<lokasi_id>")
def api_big(lokasi_id: str):
    """Sawah, sungai, dan saluran irigasi versi BIG di sekitar lokasi."""
    from flask import request
    segar = request.args.get("segar") == "1"
    try:
        return jsonify(data.lapisan_big(lokasi_id, segar=segar))
    except KeyError:
        return jsonify({"galat": f"lokasi '{lokasi_id}' tidak dikenal"}), 404
    except FileNotFoundError as e:
        return jsonify({"galat": str(e)}), 500


@app.get("/api/di/<lokasi_id>")
def api_di(lokasi_id: str):
    """Batas Daerah Irigasi (SISDA Cimanuk-Cisanggarung) di sekitar lokasi."""
    from flask import request
    segar = request.args.get("segar") == "1"
    try:
        return jsonify(data.lapisan_di(lokasi_id, segar=segar))
    except KeyError:
        return jsonify({"galat": f"lokasi '{lokasi_id}' tidak dikenal"}), 404
    except FileNotFoundError as e:
        return jsonify({"galat": str(e)}), 500


@app.get("/logo_beacon.png")
@app.get("/favicon.ico")            # peramban tetap meminta ini walau <link rel=icon> ada
def logo():
    return send_from_directory(APP_DIR, "logo_beacon.png")


def alamat_lokal() -> list[str]:
    """Alamat IPv4 mesin ini, supaya URL-nya tidak perlu dicari sendiri."""
    keluar: list[str] = []
    # Alamat yang dipakai keluar - cara paling andal di mesin dengan banyak antarmuka.
    # Tidak ada paket yang benar-benar dikirim; UDP connect hanya memilih rute.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        keluar.append(s.getsockname()[0])
    except OSError:
        pass
    finally:
        s.close()
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if ip not in keluar and not ip.startswith("127."):
                keluar.append(ip)
    except OSError:
        pass
    return keluar


if __name__ == "__main__":
    host = os.environ.get("BEACON_HOST", "0.0.0.0")
    port = int(os.environ.get("BEACON_PORT", "5000"))
    minta_debug = os.environ.get("BEACON_DEBUG", "") == "1"

    # Debugger Werkzeug boleh menjalankan kode apa pun lewat peramban. Selama server
    # ini bisa dijangkau dari jaringan, itu lubang yang terbuka untuk siapa saja di
    # jaringan yang sama - jadi debugger hanya dinyalakan kalau host memang terkunci
    # ke localhost DAN diminta secara eksplisit. Muat-ulang otomatis tetap jalan.
    lokal_saja = host in ("127.0.0.1", "localhost")
    pakai_debugger = minta_debug and lokal_saja

    print("=" * 62)
    print("  Beacon SWH — Peta Sawah & Pengairan")
    print("=" * 62)
    print(f"  Di PC ini      : http://127.0.0.1:{port}")
    if not lokal_saja:
        for ip in alamat_lokal():
            print(f"  Dari perangkat : http://{ip}:{port}")
        if not alamat_lokal():
            print("  (alamat jaringan tidak terbaca - periksa sambungan)")
    print("-" * 62)
    print(f"  Mendengarkan   : {host}:{port}")
    print(f"  Muat ulang otomatis : nyala")
    print(f"  Debugger Werkzeug   : {'NYALA' if pakai_debugger else 'mati'}")
    if minta_debug and not lokal_saja:
        print("     BEACON_DEBUG=1 diabaikan: debugger tidak dinyalakan selama server")
        print("     terbuka ke jaringan. Jalankan dengan BEACON_HOST=127.0.0.1 kalau perlu.")
    if not lokal_saja:
        print("-" * 62)
        print("  Server ini terbuka ke jaringan setempat. Isinya hanya hasil analisa")
        print("  (tidak ada data pribadi) dan tidak ada rute yang mengubah berkas, tetapi")
        print("  siapa pun di jaringan yang sama bisa membukanya. Kalau tidak dikehendaki,")
        print("  jalankan: BEACON_HOST=127.0.0.1 python web-app/app.py")
        print("  Windows mungkin menanyakan izin Firewall pada kali pertama - pilih")
        print("  'Private networks' saja, jangan 'Public networks'.")
    print("=" * 62)

    app.run(host=host, port=port, debug=pakai_debugger,
            use_reloader=True, threaded=True)
