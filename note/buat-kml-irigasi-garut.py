"""
Bangun KML/KMZ irigasi Kabupaten Garut untuk Google Earth, dari berkas di data/.

Dua keluaran, karena dua pemakaian yang berbeda:
  DI_Kewenangan_Kabupaten_Garut.kml  - 32 petak DI saja, buat lihat sebaran layanan
  Irigasi_Kabupaten_Garut.kml        - petak DI + jalur + bangunan + bendung

Urutan folder di berkas gabungan bukan selera: Google Earth menggambar mengikuti
urutan dokumen, jadi poligon petak harus ditulis lebih dulu supaya garis saluran dan
titik bangunan tidak tenggelam di bawah isiannya.

Jalankan `unduh-jalur-irigasi.py` lebih dulu kalau berkas jalurnya belum ada.
"""

import colorsys
import json
import math
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

from shapely.geometry import shape

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

NDIGIT = 6  # ~0.1 m, lebih dari cukup untuk batas petak maupun trase saluran

# Warna per jenis saluran, mengikuti kelaziman gambar teknik irigasi: yang makin ke
# hulu makin tebal dan makin panas warnanya.
JENIS = {
    "Primer":   ("#dc2626", 5.0),
    "Sekunder": ("#ea580c", 3.5),
    "Suplesi":  ("#7c3aed", 3.0),
    "Tersier":  ("#16a34a", 1.8),
}
WARNA_BIG = "#0891b2"
WARNA_BANGUNAN = "#b45309"
WARNA_BENDUNG = "#dc2626"

IKON_TITIK = "http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png"
IKON_BENDUNG = "http://maps.google.com/mapfiles/kml/shapes/triangle.png"


# ---------------------------------------------------------------- alat bantu kecil

def kml_warna(rgb: str, alpha: str = "ff") -> str:
    """'#rrggbb' -> 'aabbggrr'. KML membalik urutan kanalnya, ini sumber salah warna."""
    r, g, b = rgb[1:3], rgb[3:5], rgb[5:7]
    return f"{alpha}{b}{g}{r}".lower()


def warna_di(i: int) -> tuple[str, str]:
    """Warna unik per DI, disebar dengan sudut emas supaya indeks berurutan kontras."""
    r, g, b = colorsys.hsv_to_rgb((i * 0.618033988749895) % 1.0, 0.78, 0.95)
    return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}", ""


def angka_id(x: float, desimal: int = 0) -> str:
    return f"{x:,.{desimal}f}".replace(",", "#").replace(".", ",").replace("#", ".")


def xy(c) -> tuple[float, float]:
    """Ambil bujur-lintang saja.

    Sumbernya tidak seragam: SISDA mengirim XY, BIG mengirim XYZM dengan M null.
    Menyalin apa adanya membuat KML memuat kolom keempat yang tidak sah.
    """
    return round(c[0], NDIGIT), round(c[1], NDIGIT)


def garis_ke_teks(garis) -> str:
    return " ".join(f"{a},{b}" for a, b in (xy(c) for c in garis))


def panjang_km(garis_garis) -> float:
    """Panjang kasar dalam km, proyeksi datar lokal.

    Di lintang 7° selisihnya terhadap hitungan elipsoid di bawah 0,1% - jauh lebih
    kecil daripada ketelitian trase sumbernya, dan ini cuma dipakai untuk isi popup.
    """
    total = 0.0
    for garis in garis_garis:
        g = [xy(c) for c in garis]  # BIG mengirim XYZM, jadi dipangkas dulu
        for (x1, y1), (x2, y2) in zip(g, g[1:]):
            dy = (y2 - y1) * 110.574
            dx = (x2 - x1) * 111.320 * math.cos(math.radians((y1 + y2) / 2))
            total += math.hypot(dx, dy)
    return total


def balon(baris: list[tuple[str, str]], catatan: str) -> str:
    sel = "".join(
        f'<tr><td style="padding:3px 10px 3px 0;color:#555">{escape(str(k))}</td>'
        f'<td style="padding:3px 0"><b>{escape(str(v))}</b></td></tr>'
        for k, v in baris if v not in (None, "", "-")
    )
    return (
        '<![CDATA[<div style="font-family:Arial,sans-serif;font-size:13px">'
        f"<table>{sel}</table>"
        f'<p style="color:#777;font-size:11px;margin-top:8px">{catatan}</p></div>]]>'
    )


def muat(nama: str) -> list[dict]:
    berkas = DATA / f"{nama}.geojson"
    if not berkas.exists():
        raise SystemExit(f"{berkas} belum ada - jalankan note/unduh-jalur-irigasi.py dulu")
    return json.loads(berkas.read_text(encoding="utf-8"))["features"]


def garis_dari(geom: dict) -> list[list]:
    """LineString / MultiLineString -> daftar garis."""
    return ([geom["coordinates"]] if geom["type"] == "LineString"
            else list(geom["coordinates"]))


# ------------------------------------------------------------------- bagian isi

def bagian_di(alpha: str) -> tuple[list[str], list[str], dict]:
    """Petak DI: satu Placemark per DI, dikelompokkan menurut status penetapannya."""
    fitur = sorted(muat("DI_Kewenangan_Kabupaten_Garut"),
                   key=lambda f: -(f["properties"]["Luas_CEA"] or 0))
    gaya, per_status = [], {}
    batas = [180.0, 90.0, -180.0, -90.0]
    total = 0

    for i, f in enumerate(fitur):
        p = f["properties"]
        rgb, _ = warna_di(i)
        isi, garis = kml_warna(rgb, alpha), kml_warna(rgb)
        sid = f"di_{i}"
        gaya.append(
            f"""	<Style id="{sid}">
		<IconStyle><scale>0</scale><Icon><href/></Icon></IconStyle>
		<LabelStyle><color>{garis}</color><scale>0.75</scale></LabelStyle>
		<LineStyle><color>{garis}</color><width>1.6</width></LineStyle>
		<PolyStyle><color>{isi}</color><fill>1</fill><outline>1</outline></PolyStyle>
	</Style>""")

        geom = shape(f["geometry"])
        b = geom.bounds
        batas = [min(batas[0], b[0]), min(batas[1], b[1]),
                 max(batas[2], b[2]), max(batas[3], b[3])]
        titik = max(geom.geoms, key=lambda g: g.area).representative_point()
        total += p["Luas_CEA"] or 0

        badan = ["    <MultiGeometry>",
                 "      <Point><altitudeMode>clampToGround</altitudeMode><coordinates>"
                 f"{round(titik.x, NDIGIT)},{round(titik.y, NDIGIT)}"
                 "</coordinates></Point>"]
        for poly in f["geometry"]["coordinates"]:
            luar, *dalam = poly
            bag = ["      <Polygon>", "        <tessellate>1</tessellate>",
                   "        <altitudeMode>clampToGround</altitudeMode>",
                   "        <outerBoundaryIs><LinearRing><coordinates>"
                   f"{garis_ke_teks(luar)}</coordinates></LinearRing></outerBoundaryIs>"]
            bag += ["        <innerBoundaryIs><LinearRing><coordinates>"
                    f"{garis_ke_teks(h)}</coordinates></LinearRing></innerBoundaryIs>"
                    for h in dalam]
            bag.append("      </Polygon>")
            badan.append("\n".join(bag))
        badan.append("    </MultiGeometry>")

        ket = balon([
            ("Nama Daerah Irigasi", p["Nama_DI"]),
            ("Kewenangan", p["Kewenangan"]),
            ("Status", p["Status"]),
            ("Luas baku (CEA)", f"{angka_id(p['Luas_CEA'])} ha"),
            ("Luas geometri", f"{angka_id(p['Shape_Area'] / 10000, 1)} ha"),
            ("Keliling", f"{angka_id(p['Shape_Leng'] / 1000, 1)} km"),
        ], "Sumber: SISDA / Permen PUPR No. 14 Tahun 2015")

        per_status.setdefault(p["Status"], []).append(
            f"""    <Placemark>
      <name>{escape(p['Nama_DI'])}</name>
      <styleUrl>#{sid}</styleUrl>
      <description>{ket}</description>
      <ExtendedData>
        <Data name="Nama_DI"><value>{escape(p['Nama_DI'])}</value></Data>
        <Data name="Kewenangan"><value>{escape(p['Kewenangan'])}</value></Data>
        <Data name="Status"><value>{escape(p['Status'])}</value></Data>
        <Data name="Luas_CEA_ha"><value>{p['Luas_CEA']}</value></Data>
        <Data name="Shape_Area_m2"><value>{p['Shape_Area']}</value></Data>
        <Data name="Shape_Leng_m"><value>{p['Shape_Leng']}</value></Data>
      </ExtendedData>
{chr(10).join(badan)}
    </Placemark>""")

    isi = []
    for status in ("Sesuai Permen PUPR No. 14/2015", "Usulan Baru"):
        if status in per_status:
            isi.append(f"""  <Folder>
    <name>{escape(status)} ({len(per_status[status])} DI)</name>
{chr(10).join(per_status[status])}
  </Folder>""")
    return gaya, isi, {"n": len(fitur), "luas": total, "batas": batas}


def bagian_jaringan() -> tuple[list[str], list[str], dict]:
    """Jaringan SISDA: satu Placemark per ruas, difolderkan menurut jenis salurannya."""
    fitur = muat("DI_Leuwigoong_Jaringan")
    gaya = [f"""	<Style id="jar_{j.lower()}">
		<LineStyle><color>{kml_warna(rgb)}</color><width>{lebar}</width></LineStyle>
		<LabelStyle><scale>0.7</scale></LabelStyle>
	</Style>""" for j, (rgb, lebar) in JENIS.items()]

    per_jenis, panjang = {}, {}
    batas = [180.0, 90.0, -180.0, -90.0]
    for f in fitur:
        p = f["properties"] or {}
        jenis = p.get("jenis") or "Tersier"
        garis = garis_dari(f["geometry"])
        km = p.get("panjang_km") or panjang_km(garis)
        panjang[jenis] = panjang.get(jenis, 0.0) + km
        for g in garis:
            for x, y in (xy(c) for c in g):
                batas = [min(batas[0], x), min(batas[1], y),
                         max(batas[2], x), max(batas[3], y)]
        ket = balon([
            ("Nama saluran", p.get("nama")),
            ("Jenis", jenis),
            ("Panjang", f"{angka_id(km, 2)} km"),
            ("Daerah Irigasi", "D.I. Leuwigoong"),
        ], "Sumber: SISDA BBWS Cimanuk-Cisanggarung")
        geo = "\n".join(
            "      <LineString><tessellate>1</tessellate>"
            "<altitudeMode>clampToGround</altitudeMode><coordinates>"
            f"{garis_ke_teks(g)}</coordinates></LineString>" for g in garis)
        per_jenis.setdefault(jenis, []).append(
            f"""    <Placemark>
      <name>{escape(p.get('nama') or 'Tanpa nama')}</name>
      <styleUrl>#jar_{jenis.lower()}</styleUrl>
      <description>{ket}</description>
      <ExtendedData>
        <Data name="jenis"><value>{escape(jenis)}</value></Data>
        <Data name="panjang_km"><value>{km:.3f}</value></Data>
      </ExtendedData>
      <MultiGeometry>
{geo}
      </MultiGeometry>
    </Placemark>""")

    isi = []
    for jenis in ("Primer", "Sekunder", "Suplesi", "Tersier"):
        if jenis in per_jenis:
            isi.append(f"""    <Folder>
      <name>{jenis} ({len(per_jenis[jenis])} ruas, {angka_id(panjang[jenis], 1)} km)</name>
{chr(10).join(per_jenis[jenis])}
    </Folder>""")
    return gaya, isi, {"n": len(fitur), "panjang": panjang, "batas": batas}


def bagian_titik(nama_berkas: str, judul: str, kolom_nama: str, rgb: str, ikon: str,
                 skala_label: float, medan) -> tuple[list[str], str, int]:
    """Lapisan titik (bangunan / bendung) jadi satu folder."""
    fitur = muat(nama_berkas)
    sid = f"tk_{nama_berkas.lower()}"
    gaya = f"""	<Style id="{sid}">
		<IconStyle><color>{kml_warna(rgb)}</color><scale>0.6</scale>
			<Icon><href>{ikon}</href></Icon></IconStyle>
		<LabelStyle><color>{kml_warna(rgb)}</color><scale>{skala_label}</scale></LabelStyle>
	</Style>"""
    pm = []
    for f in fitur:
        p = f["properties"] or {}
        x, y = xy(f["geometry"]["coordinates"])
        pm.append(f"""    <Placemark>
      <name>{escape(str(p.get(kolom_nama) or 'Tanpa nama'))}</name>
      <styleUrl>#{sid}</styleUrl>
      <description>{balon([(l, p.get(k)) for l, k in medan],
                          'Sumber: SISDA BBWS Cimanuk-Cisanggarung')}</description>
      <Point><altitudeMode>clampToGround</altitudeMode>
        <coordinates>{x},{y}</coordinates></Point>
    </Placemark>""")
    folder = f"""  <Folder>
    <name>{escape(judul)} ({len(fitur)})</name>
{chr(10).join(pm)}
  </Folder>"""
    return [gaya], folder, len(fitur)


def bagian_big() -> tuple[list[str], str, dict]:
    """Saluran RBI 5K.

    Dipasang mati bawaan dan diberi nama yang menyebut keterbatasannya, karena hasil
    pemeriksaan silang: NOL dari 1.440 ruasnya menyentuh petak 32 DI, bahkan dalam
    radius 1 km sekalipun. Liputan RBI 5K di kotak AOI ini kebetulan jatuh di petak
    peta lain di barat laut (107,74-107,83 BT; 7,06-6,94 LS), terpisah dari hamparan
    DI-nya. Jadi ia konteks, bukan pelengkap 31 DI yang jaringannya belum terbit -
    menyalakannya bawaan akan terbaca seolah saluran itu melayani petak di bawahnya.

    1.439 dari 1.440 ruasnya tanpa nama dan semuanya berketerangan sama, jadi tidak
    ada gunanya menjadikannya 1.440 baris di panel Google Earth - semuanya digabung
    ke satu Placemark ber-MultiGeometry, dan yang bernama tetap berdiri sendiri.
    """
    fitur = muat("Saluran_Irigasi_BIG_5K")
    gaya = [f"""	<Style id="big_saluran">
		<LineStyle><color>{kml_warna(WARNA_BIG)}</color><width>1.4</width></LineStyle>
	</Style>"""]

    tanpa_nama, bernama, total_km = [], [], 0.0
    elevasi = []
    for f in fitur:
        garis = garis_dari(f["geometry"])
        total_km += panjang_km(garis)
        elevasi += [c[2] for g in garis for c in g if len(c) > 2 and c[2] is not None]
        nama = (f["properties"].get("NAMOBJ") or "").strip()
        geo = "\n".join(
            "        <LineString><tessellate>1</tessellate>"
            "<altitudeMode>clampToGround</altitudeMode><coordinates>"
            f"{garis_ke_teks(g)}</coordinates></LineString>" for g in garis)
        (bernama if nama else tanpa_nama).append((nama, geo))

    pm = []
    for nama, geo in bernama:
        pm.append(f"""    <Placemark>
      <name>{escape(nama)}</name>
      <styleUrl>#big_saluran</styleUrl>
      <description>{balon([('Nama', nama), ('Keterangan', 'Saluran Irigasi/Drainase')],
                          'Sumber: BIG RBI seri 1:5.000, lapisan 233')}</description>
      <MultiGeometry>
{geo}
      </MultiGeometry>
    </Placemark>""")
    if tanpa_nama:
        ket = balon([
            ("Keterangan", "Saluran Irigasi/Drainase"),
            ("Jumlah ruas", f"{angka_id(len(tanpa_nama))} ruas"),
            ("Sumber", "BIG RBI seri 1:5.000 (lapisan 233)"),
        ], "Ruas tanpa nama pada RBI, digabung jadi satu objek agar ringan dibuka. "
           "RBI tidak membedakan primer/sekunder/tersier, dan ruas-ruas ini berada "
           "di luar hamparan 32 DI kewenangan kabupaten.")
        pm.append(f"""    <Placemark>
      <name>Saluran irigasi/drainase tanpa nama ({angka_id(len(tanpa_nama))} ruas)</name>
      <styleUrl>#big_saluran</styleUrl>
      <description>{ket}</description>
      <MultiGeometry>
{chr(10).join(g for _, g in tanpa_nama)}
      </MultiGeometry>
    </Placemark>""")

    folder = f"""  <Folder>
    <name>Saluran RBI 5K - BIG, DI LUAR hamparan 32 DI ({angka_id(len(fitur))} ruas, {angka_id(total_km)} km)</name>
    <description>{balon([
        ("Sumber", "BIG RBI seri 1:5.000, lapisan 233"),
        ("Jumlah", f"{angka_id(len(fitur))} ruas, {angka_id(total_km)} km"),
        ("Letak", "107,74-107,83 BT; 7,06-6,94 LS (barat laut AOI)"),
    ], "Nol dari " + angka_id(len(fitur)) + " ruas menyentuh petak 32 DI kewenangan "
       "kabupaten, bahkan dalam radius 1 km. Liputan RBI 5K di kotak AOI ini jatuh "
       "di petak peta lain, jadi lapisan ini konteks - bukan jaringan yang melayani "
       "DI di bawahnya. Dimatikan bawaan; centang sendiri kalau perlu.")}</description>
    <visibility>0</visibility>
{chr(10).join(pm)}
  </Folder>"""
    rinci = {"n": len(fitur), "km": total_km,
             "elevasi": (min(elevasi), max(elevasi)) if elevasi else None}
    return gaya, folder, rinci


# ------------------------------------------------------------------- perakitan

def dokumen(nama: str, keterangan: str, batas: list[float], gaya: list[str],
            isi: list[str], jangkauan: int) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
<Document>
	<name>{escape(nama)}</name>
	<description>{keterangan}</description>
	<LookAt>
		<longitude>{(batas[0] + batas[2]) / 2:.6f}</longitude>
		<latitude>{(batas[1] + batas[3]) / 2:.6f}</latitude>
		<altitude>0</altitude>
		<range>{jangkauan}</range>
		<tilt>0</tilt><heading>0</heading>
	</LookAt>
{chr(10).join(gaya)}
{chr(10).join(isi)}
</Document>
</kml>
"""


def tulis(nama_berkas: str, kml: str) -> None:
    berkas = ROOT / f"{nama_berkas}.kml"
    kmz = ROOT / f"{nama_berkas}.kmz"
    berkas.write_text(kml, encoding="utf-8")
    with zipfile.ZipFile(kmz, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr("doc.kml", kml)
    print(f"  {berkas.name}: {berkas.stat().st_size / 1e6:.2f} MB"
          f"   {kmz.name}: {kmz.stat().st_size / 1e6:.2f} MB")


def main():
    # --- berkas 1: petak DI saja, isian lebih pekat karena tidak ada yang ditutupi
    gaya_di, isi_di, rdi = bagian_di(alpha="8c")
    ket = ('<![CDATA[<div style="font-family:Arial,sans-serif;font-size:13px">'
           f'<b>{rdi["n"]} Daerah Irigasi</b> kewenangan Kabupaten Garut<br>'
           f'Total luas baku (CEA): <b>{angka_id(rdi["luas"])} ha</b>'
           '<br><span style="color:#777;font-size:11px">Sumber: SISDA / Permen PUPR '
           'No. 14 Tahun 2015 &mdash; EPSG:4326</span></div>]]>')
    tulis("DI_Kewenangan_Kabupaten_Garut",
          dokumen("Daerah Irigasi Kewenangan Kabupaten Garut", ket, rdi["batas"],
                  gaya_di, isi_di, 45000))

    # --- berkas 2: jaringannya saja, tanpa poligon petak sama sekali.
    # Saluran RBI BIG sengaja tidak ikut ke sini: ia bukan bagian dari jaringan
    # Leuwigoong, letaknya pun terpisah, dan sendirian ia menyumbang ~10 dari 11 MB
    # berkas gabungan - persis yang bikin berkas ini tidak ringan lagi.
    gaya_jar, isi_jar, rjar = bagian_jaringan()
    gaya_bgn, folder_bgn, n_bgn = bagian_titik(
        "DI_Leuwigoong_Bangunan", "Bangunan irigasi D.I. Leuwigoong", "name",
        WARNA_BANGUNAN, IKON_TITIK, 0.0, [("Nama", "name"), ("Nomor", "no")])
    gaya_bdg, folder_bdg, n_bdg = bagian_titik(
        "Bendung", "Bendung", "nama_bendung", WARNA_BENDUNG, IKON_BENDUNG, 0.9,
        [("Nama bendung", "nama_bendung"), ("Pengelola", "unit_kerja___balai__pengelola_"),
         ("Wilayah sungai", "wilayah_sungai"), ("DAS", "daerah_aliran_sungai"),
         ("Kewenangan", "kewenangan"), ("Status", "status_bangunan")])
    total_jar = sum(rjar["panjang"].values())
    rinci_jenis = " &middot; ".join(
        f"{j} {angka_id(rjar['panjang'][j], 1)} km"
        for j in ("Primer", "Sekunder", "Suplesi", "Tersier") if j in rjar["panjang"])
    ket = ('<![CDATA[<div style="font-family:Arial,sans-serif;font-size:13px">'
           f'<b>{rjar["n"]} ruas</b> jaringan irigasi D.I. Leuwigoong, '
           f'<b>{angka_id(total_jar, 1)} km</b><br>{rinci_jenis}<br>'
           f'{n_bgn} bangunan bagi/sadap &middot; {n_bdg} bendung'
           '<br><br><span style="color:#777;font-size:11px">'
           'Ini satu-satunya D.I. di Kab. Garut yang jaringannya sudah diterbitkan '
           'SISDA; 32 DI kewenangan kabupaten belum ada trasenya.<br>'
           'Sumber: SISDA BBWS Cimanuk-Cisanggarung &mdash; EPSG:4326</span></div>]]>')
    tulis("Jaringan_Irigasi_Leuwigoong", dokumen(
        "Jaringan Irigasi D.I. Leuwigoong", ket, rjar["batas"],
        gaya_jar + gaya_bgn + gaya_bdg,
        [f"""  <Folder>
    <name>Jaringan irigasi D.I. Leuwigoong ({rjar['n']} ruas, {angka_id(total_jar, 1)} km)</name>
    <open>1</open>
{chr(10).join(isi_jar)}
  </Folder>""", folder_bgn, folder_bdg], 30000))

    # --- berkas 3: gabungan. Isian petak diencerkan supaya trase saluran terbaca.
    gaya_di, isi_di, rdi = bagian_di(alpha="55")
    gaya_big, folder_big, rbig = bagian_big()

    ket = ('<![CDATA[<div style="font-family:Arial,sans-serif;font-size:13px">'
           f'<b>{rdi["n"]} Daerah Irigasi</b> kewenangan Kab. Garut '
           f'({angka_id(rdi["luas"])} ha)<br>'
           f'<b>{rjar["n"]} ruas</b> jaringan D.I. Leuwigoong '
           f'({angka_id(total_jar, 1)} km) + {n_bgn} bangunan<br>'
           f'<b>{angka_id(rbig["n"])} ruas</b> saluran RBI 5K BIG '
           f'({angka_id(rbig["km"])} km, di luar hamparan DI, mati bawaan)'
           '<br><br><span style="color:#777;font-size:11px">'
           'Jaringan terklasifikasi primer/sekunder/tersier hanya tersedia untuk '
           'D.I. Leuwigoong; 31 DI lain belum diterbitkan jaringannya di SISDA, dan '
           'RBI BIG tidak menutup kekosongan itu.<br>'
           'Sumber: SISDA BBWS Cimanuk-Cisanggarung + BIG RBI &mdash; EPSG:4326'
           '</span></div>]]>')

    # Poligon dulu, baru garis, baru titik - Google Earth menggambar urut dokumen.
    tulis("Irigasi_Kabupaten_Garut", dokumen(
        "Irigasi Kabupaten Garut", ket, rdi["batas"],
        gaya_di + gaya_jar + gaya_bgn + gaya_bdg + gaya_big,
        [f"""  <Folder>
    <name>Daerah Irigasi kewenangan Kab. Garut ({rdi['n']} DI, {angka_id(rdi['luas'])} ha)</name>
{chr(10).join(isi_di)}
  </Folder>""",
         folder_big,
         f"""  <Folder>
    <name>Jaringan irigasi D.I. Leuwigoong ({rjar['n']} ruas, {angka_id(total_jar, 1)} km)</name>
    <open>1</open>
{chr(10).join(isi_jar)}
  </Folder>""",
         folder_bgn, folder_bdg], 45000))

    print(f"  {rdi['n']} DI / {angka_id(rdi['luas'])} ha, "
          f"{rjar['n']} ruas SISDA / {angka_id(total_jar, 1)} km, "
          f"{n_bgn} bangunan, {n_bdg} bendung, {rbig['n']} ruas BIG")
    if rbig["elevasi"]:
        print(f"  elevasi ruas BIG: {rbig['elevasi'][0]:.0f}-{rbig['elevasi'][1]:.0f} m")


if __name__ == "__main__":
    main()
