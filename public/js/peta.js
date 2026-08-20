/* Peta Lokasi — DIHASILKAN dari web-app/static/js/app.js.
   JANGAN SUNTING BERKAS INI. Sunting sumbernya, lalu jalankan:
       node tools/peta/salin-js.cjs
   Yang diubah hanya tiga hal: alamat data lewat window.PETA, endpoint Flask jadi
   berkas beku note/ekspor-peta.py, dan awal jalan ditunda ke window.petaMulai()
   supaya Leaflet tidak lahir di kontainer berukuran nol. */
/* Beacon SWH — peta satu halaman.
 * Semua angka datang dari /api/lokasi/<id>; halaman ini tidak menghitung apa pun
 * sendiri kecuali penskalaan warna. Medan yang bernilai null ditampilkan sebagai
 * "belum dihitung", tidak pernah sebagai 0. */
(() => {
  "use strict";

  /* Alamat data dikirim Laravel lewat window.PETA (lihat resources/views/skema/
     index.blade.php). Nilai cadangan di bawah hanya jaga-jaga kalau berkas ini
     dimuat di luar halaman Blade-nya.

       data      folder berkas beku hasil note/ekspor-peta.py — dilayani langsung
                 oleh web server, tidak melewati PHP
       tile      penerus ubin citra satelit (perlu PHP: unduh sekali lalu cache)
       tileRbi   penerus ubin Rupabumi BIG

     Semua muatan sudah dibekukan per lokasi DAN per rezim, jadi tidak ada lagi
     query string: rezim masuk ke nama berkas. */
  const PETA = Object.assign({
    data: "/data/peta",
    tile: "/api/peta/tile",
    tileRbi: "/api/peta/tile-rbi",
  }, window.PETA || {});

  /* Rezim bawaan satu lokasi, dari data-rezim pada <option>-nya (disetel Blade
     dari rezim_tersedia). Diperlukan pada muatan PERTAMA: nama berkas beku
     memuat rezimnya, sementara daftar rezim yang tersedia baru diketahui dari
     muatan pertama itu sendiri. Versi Flask tidak perlu ini karena servernya
     memakai `rezim or "FL"` sebagai bawaan. Kosong = lokasi tanpa rezim. */
  function rezimBawaan(lokasiId) {
    const pilihan = document.getElementById("pilih-lokasi");
    const opsi = pilihan
      && [...pilihan.options].find((o) => o.value === lokasiId);
    return (opsi && opsi.dataset.rezim) || null;
  }

  /* Nama berkas beku untuk satu lokasi. Rezim null / kosong berarti lokasi itu
     memang tidak punya pilihan rezim (lihat rezim_tersedia di data.py). */
  const berkasLokasi = (lokasiId, rezim, akhiran) => {
    const r = rezim || rezimBawaan(lokasiId);
    return `${PETA.data}/lokasi-${lokasiId}${r ? "-" + r : ""}.${akhiran}`;
  };

  // Skala biru muda pastel -> biru air. Sengaja terang di ujung bawah supaya citra
  // satelit di bawah poligon masih terbaca.
  const SKALA = ["#eef7fb", "#d5e9f4", "#b3d5e9", "#8dbcdb", "#68a3c9", "#417fa5"];
  // Skala untuk subjek bergaris. Sengaja BEDA dari yang di atas, bukan salinannya:
  // pita pastel itu dirancang sebagai ISIAN bidang, terang di ujung bawah supaya citra
  // satelit di bawahnya tetap terbaca. Dipakai sebagai warna GARIS, ujung terangnya
  // (#eef7fb) praktis lenyap di atas citra - dan yang lenyap justru ruas berdebit kecil,
  // yaitu tersier, yaitu ruas yang paling banyak jumlahnya. Yang ini bergerak dari
  // hijau muda ke biru tua: bedanya terbaca sebagai terang-gelap, bukan cuma sebagai
  // corak, jadi tetap terbaca di layar apa pun dan oleh mata yang buta warna.
  const SKALA_GARIS = ["#d9ed92", "#b5e48c", "#76c893", "#34a0a4", "#1a759f", "#184e77"];
  const WARNA_LOSS = { etc: "#7faa78", perkolasi: "#5b9ec4", limpasan: "#d9b26a" };
  const LABEL_LOSS = { etc: "Menguap (ETc)", perkolasi: "Meresap (perkolasi)",
                       limpasan: "Mengalir keluar (limpasan)" };

  // Lapisan pembanding dari BIG. Sengaja tipis dan tembus pandang: ia latar untuk
  // menilai petak sendiri, bukan lapisan yang dibaca angkanya.
  const GAYA_BIG = {
    sawah:   { color: "#5f8f57", weight: 1,   dashArray: "4 3",
               fillColor: "#7faa78", fillOpacity: 0.22 },
    sungai:  { color: "#3f93c4", weight: 2,   fillColor: "#3f93c4", fillOpacity: 0.35 },
    irigasi: { color: "#b8792b", weight: 2.2, fillColor: "#b8792b", fillOpacity: 0.35 },
  };
  const SKALA_SERI = { "5K": "1:5.000", "10K": "1:10.000", "25K": "1:25.000",
                       "50K": "1:50.000", "100K": "1:100.000", "250K": "1:250.000" };

  // Lapisan SISDA. Warnanya datang dari server (satu tempat untuk semua warna tema);
  // yang diputuskan di sini cuma bentuknya. Aturannya sama di semua tema: isian selalu
  // tipis atau tidak ada, karena semuanya lapisan LETAK - kalau isiannya pekat, petak
  // yang justru mau dilihat akan tenggelam di bawahnya.
  const GAYA_GC = {
    gc_jaringan: (w) => ({ color: w, weight: 2.6, fill: false }),
    gc_bangunan: (w) => ({ color: w, weight: 1, fillColor: w, fillOpacity: 0.9 }),
    gc_sungai:   (w) => ({ color: w, weight: 2.4, fill: false }),
    gc_sempadan: (w) => ({ color: w, weight: 1, fillColor: w, fillOpacity: 0.22 }),
    gc_mata_air: (w) => ({ color: w, weight: 1, fillColor: w, fillOpacity: 0.9 }),
    gc_situ:     (w) => ({ color: w, weight: 1, fillColor: w, fillOpacity: 0.9 }),
    // Batas DI kewenangan punya dua wajah: yang menyentuh AOI ditebalkan, yang di luar
    // sengaja pudar dan putus-putus - ia cuma penunjuk "AOI ini di DI sebelah mana".
    di_kab:  (w, dalam) => gayaKewenangan(w, dalam),
    di_prov: (w, dalam) => gayaKewenangan(w, dalam),
  };
  const gayaKewenangan = (w, dalam) => (dalam
    ? { color: w, weight: 2.4, fillColor: w, fillOpacity: 0.07 }
    : { color: w, weight: 1, opacity: 0.45, dashArray: "5 4", fill: false });
  // Jari-jari lingkaran untuk tema bergeometri titik, menurut seberapa jarang objeknya:
  // 174 bangunan harus kecil supaya tidak jadi kerumunan, 1 situ boleh menonjol.
  const JARI_TITIK = { gc_bangunan: 3.5, gc_mata_air: 4.5, gc_situ: 5.5 };

  const $ = (id) => document.getElementById(id);
  const el = {
    sub: $("bar-sub"), lokasi: $("pilih-lokasi"), rezim: $("pilih-rezim"),
    wadahRezim: $("wadah-rezim"), metrik: $("pilih-metrik"),
    ringkasNama: $("ringkas-nama"), ringkasCatatan: $("ringkas-catatan"),
    cakupan: $("ringkas-cakupan"),
    luas: $("stat-luas"), air: $("stat-air"), airSatuan: $("stat-air-satuan"),
    loss: $("stat-loss"), lossSatuan: $("stat-loss-satuan"),
    legenda: $("legenda"), legendaJudul: $("legenda-judul"), legendaPita: $("legenda-pita"),
    legendaMin: $("legenda-min"), legendaMaks: $("legenda-maks"),
    detailJudul: $("detail-judul"), detailLencana: $("detail-lencana"),
    detailKosong: $("detail-kosong"), detailIsi: $("detail-isi"), detailBaris: $("detail-baris"),
    detailPecahan: $("detail-pecahan"), bilahLoss: $("bilah-loss"), kunciLoss: $("kunci-loss"),
    detailTutup: $("detail-tutup"),
    daftar: $("daftar-petak"), judulDaftar: $("judul-daftar"), sumber: $("sumber"),
    wadahMetrik: $("wadah-metrik"),
    statKotakLuas: $("stat-kotak-luas"), statLuasLabel: $("stat-luas-label"),
    kartuDaftar: $("kartu-daftar"),
    kartuDetail: $("kartu-detail"),
    koordinat: $("koordinat"), koordinatNilai: $("koordinat-nilai"),
    koordinatDms: $("koordinat-dms"), koordinatSalin: $("koordinat-salin"),
    koordinatTutup: $("koordinat-tutup"),
    waktuTempuh: $("waktu-tempuh"), waktuUjung: $("waktu-ujung"),
    waktuNilai: $("waktu-nilai"), waktuCatatan: $("waktu-catatan"),
    persenLoss: $("persen-loss"), persenMasuk: $("persen-masuk"),
    bilahRingkas: $("bilah-ringkas"), kunciRingkas: $("kunci-ringkas"),
    unduhKml: $("unduh-kml"),
    kartuRingkas: $("kartu-ringkas"), ringkasTutup: $("ringkas-tutup"),
    ringkasBuka: $("ringkas-buka"), bukaNama: $("buka-nama"),
    laci: $("laci-atur"), laciLapisan: $("laci-lapisan"), laciDasar: $("laci-dasar"),
    aturTirai: $("atur-tirai"),
    bukaAtur: $("buka-atur"), tutupAtur: $("tutup-atur"),
    terapkanAtur: $("terapkan-atur"), aturRingkas: $("atur-ringkas"),
    aturTertunda: $("atur-tertunda"),
    kendaliSumber: $("kendali-peta-sumber"), alihSamping: $("alih-samping"),
    samping: $("samping-peta"),
  };

  let peta, lapisanPetak, lapisanBatas;
  let data = null;          // balasan /api/lokasi terakhir
  let metrikAktif = null;   // {kunci, label, satuan}
  let rentang = null;       // [min, maks] metrik aktif - dipakai legenda, apa adanya
  let batasLog = null;      // [positif terkecil, maks] - dipakai ramp saat skalaLog
  let skalaLog = false;     // ramp logaritmik, untuk sebaran yang sangat timpang
  const lapisanDari = {};   // id petak -> layer Leaflet
  let terpilih = null;
  let kendaliLapisan;       // L.control.layers - peta dasar + lapisan BIG
  let big = null;           // balasan /api/big terakhir
  const lapisanBig = {};    // kunci tema -> layer Leaflet
  const tampilBig = {};     // kunci tema -> nyala/mati, diingat saat ganti lokasi
  let di = null;            // balasan /api/di terakhir
  const lapisanDi = {};     // kunci tema DI -> layer Leaflet
  /* Dua tema menyala sejak awal: jaringan dan bangunan, karena itulah yang RBI tidak
     punya sama sekali di sini. Sisanya dimatikan supaya peta tidak penuh sejak dibuka.
     Sesudah dicentang/dilepas sekali, pilihan pengguna yang dipakai.

     di_kab TIDAK ada di sini - bawaannya ditentukan per lokasi di muat(), lihat
     alasannya di sana. */
  const tampilDi = { gc_jaringan: true, gc_bangunan: true };
  /* Tema DI yang kotak centangnya pernah disentuh pengguna. Bawaan per lokasi hanya
     berlaku selama tema itu belum pernah disentuh; sesudahnya pilihan pengguna yang
     menang, sama seperti tema lain. */
  const disentuhDi = new Set();
  /* true selagi muatDi memasang lapisannya sendiri. `overlayadd` tidak bisa
     membedakan kotak centang yang diklik dari lapisan yang dipasang program, dan
     tanpa penanda ini pemasangan otomatis akan tercatat sebagai "disentuh pengguna". */
  let memuatLapisan = false;
  // Subjek halaman - petak/DI/ruas yang diukur - bisa dimatikan seperti lapisan lain.
  // Diingat di sini, bukan dibaca dari peta, karena pemilih lapisannya dibangun ulang
  // berkali-kali dan kotak centangnya harus tetap menunjukkan keadaan yang sama.
  let tampilPetak = true;
  /* Lokasi/rezim yang dipilih di laci tetapi belum ditekan Terapkan. Keduanya
     mengunduh muatan baru 0,5-2,3 MB, jadi ditahan sampai pengguna selesai memilih:
     mengganti lokasi LALU rezimnya berarti satu kali muat, bukan dua. null = tidak
     ada yang tertunda. */
  let aturTertunda = null;

  /* ---------------------------------------------------------------- istilah */
  /** Objek di peta ini "petak" kalau hasil digitasi sendiri, "blok" kalau poligon
   *  tutupan lahan BIG, "daerah irigasi" kalau hamparan layanan yang ditetapkan SISDA.
   *  Menyebut blok RBI sebagai petak menjanjikan ketelitian per pematang yang memang
   *  tidak ada di datanya; menyebut satu DI seluas 800 ha sebagai "petak" menjanjikan
   *  hal yang sama, dan sekaligus salah tingkat. */
  const ISTILAH = { big: "blok", sisda: "daerah irigasi", jaringan: "ruas" };
  const istilah = () =>
    (data && ISTILAH[data.lokasi.sumber_petak]) || "petak";

  function pasangIstilah() {
    document.querySelectorAll(".objek").forEach((n) => { n.textContent = istilah(); });
  }

  /* ------------------------------------------------------------------ angka */
  const nf = (n, d = 0) =>
    n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });

  function fmt(v, d = 0) {
    if (v === null || v === undefined || Number.isNaN(v)) return null;
    return nf(v, d);
  }

  /** Angka besar dibuat ringkas supaya kartu tidak melebar: 22.498 -> 22,5 rb
   *
   * Tingkat "jt" ditambahkan sejak lokasi se-kabupaten masuk: satu DI seluas 800 ha
   * memakai belasan juta m³ semusim, dan tanpa tingkat itu angkanya terbaca
   * "11.652,0 rb" - lebih panjang daripada angka aslinya, dan tetap sulit dibaca. */
  function ringkas(v) {
    if (v === null || v === undefined) return null;
    if (Math.abs(v) >= 1e6) return nf(v / 1e6, 2) + " jt";
    if (Math.abs(v) >= 1000) return nf(v / 1000, 1) + " rb";
    if (Math.abs(v) >= 100) return nf(v, 0);
    return nf(v, v < 10 ? 2 : 1);
  }

  function taruhStat(node, satuanNode, nilai, satuan) {
    if (nilai === null) {
      node.textContent = "belum dihitung";
      node.classList.add("kosong");
      if (satuanNode) satuanNode.textContent = "";
    } else {
      node.textContent = nilai;
      node.classList.remove("kosong");
      if (satuanNode) satuanNode.textContent = satuan || "";
    }
  }

  /* ------------------------------------------------------------------ warna */
  /** Subjek halaman ini SALURAN, bukan hamparan? Yang membedakannya bukan selera
   *  gambar melainkan geometrinya: bidang punya isian untuk diwarnai, garis tidak. */
  const subjekGaris = () => !!data && data.lokasi.sumber_petak === "jaringan";
  const skalaAktif = () => (subjekGaris() ? SKALA_GARIS : SKALA);

  /** Letak satu nilai pada rentang metrik, 0..1. `null` kalau belum ada nilainya.
   *
   *  Dipisah dari `warnaDari` karena subjek bergaris memakainya dua kali: sekali untuk
   *  warna, sekali untuk TEBAL garis. Debit yang beda seribu kali lipat antara primer
   *  dan tersier tidak akan pernah terbaca dari warna saja - pada bagan jaringan,
   *  tebal garislah yang pertama kali dilihat orang. */
  function nisbah(v) {
    if (v === null || v === undefined || !rentang || !Number.isFinite(v)) return null;
    let [lo, hi] = rentang;
    let x = v;
    if (skalaLog) {
      if (v <= 0) return 0;                 // nol jatuh ke ujung terpucat, apa adanya
      [lo, hi] = batasLog;
      x = Math.log(Math.max(v, lo));
      lo = Math.log(lo);
      hi = Math.log(hi);
    }
    if (!(hi > lo)) return 0.5;
    return Math.min(1, Math.max(0, (x - lo) / (hi - lo)));
  }

  function warnaDari(v) {
    const t = nisbah(v);
    const skala = skalaAktif();
    // Objek tanpa nilai: pada bidang putih (isian kosong), pada garis abu-abu - garis
    // putih di atas citra satelit terbaca sebagai jalan, bukan sebagai "belum dihitung".
    if (t === null) return subjekGaris() ? "#9bb7c4" : "#ffffff";
    return skala[Math.min(skala.length - 1, Math.round(t * (skala.length - 1)))];
  }

  // Tebal garis subjek menurut nisbah metriknya, per keadaan. Ruas tanpa nilai memakai
  // 0,25 - kurus, tetapi tidak setipis ruas bernilai terkecil yang memang terukur.
  const TEBAL = { biasa: [1.8, 4.4], sorot: [3.4, 5.4], pilih: [4.2, 6.0] };
  const TEPI_BIDANG = { biasa: ["#417fa5", 1], sorot: ["#2f6d90", 2.6],
                        pilih: ["#2f6d90", 3.2] };

  /** Gaya satu objek subjek, menurut keadaannya: biasa, disorot kursor, atau terpilih. */
  function gayaSubjek(f, keadaan) {
    const p = f.properties;
    if (p.jenis === "blok" || p.jenis === "batas") {
      return { color: "#d9b26a", weight: 2, dashArray: "6 4", fill: false,
               className: "petak" };
    }
    const nilai = metrikAktif ? p[metrikAktif.kunci] : null;
    if (subjekGaris()) {
      const [dasar, jangkau] = TEBAL[keadaan];
      const t = nisbah(nilai);
      return {
        color: warnaDari(nilai),
        weight: dasar + jangkau * (t === null ? 0.25 : t),
        opacity: 0.95,
        fill: false,
        className: "petak",
      };
    }
    const [warna, tebal] = TEPI_BIDANG[keadaan];
    return {
      color: warna, weight: tebal, opacity: 0.9,
      fillColor: warnaDari(nilai), fillOpacity: 0.72,
      className: "petak",
    };
  }

  /* ------------------------------------------------------------------ popup */
  /** Popup satu RUAS saluran. Ditulis terpisah dari popup hamparan karena yang ditanya
   *  memang berbeda: pada hamparan "berapa air yang dipakai di sini", pada saluran
   *  "berapa air yang harus lewat" - dan yang menjawab itu debit, bukan volume. */
  function popupRuas(p) {
    const baris = [];
    if (p.jenis_saluran) baris.push(["Jenis", p.jenis_saluran]);
    baris.push(["Panjang", `${fmt(p.panjang_km, 2) ?? "—"} km`]);
    if (p.debit_l_detik !== undefined && p.debit_l_detik !== null) {
      baris.push(["Debit di hulu ruas", `${fmt(p.debit_l_detik, 1)} l/detik`]);
      baris.push(["Luas dilayani", `${fmt(p.luas_ha, 1)} ha`]);
      if (p.luas_layanan_sendiri_ha)
        baris.push(["— menempel ruas ini", `${fmt(p.luas_layanan_sendiri_ha, 1)} ha`]);
      if (p.n_ruas_hilir) baris.push(["Ruas di hilirnya", `${fmt(p.n_ruas_hilir, 0)}`]);
      baris.push(["Air semusim", `${ringkas(p.irigasi_m3)} m³`]);
    } else {
      baris.push(["Debit", "belum dihitung"]);
    }
    // Dua waktu berdampingan, bukan satu: yang satu menjawab kapan AIRNYA sampai,
    // yang satu kapan DEBITNYA berubah - dan cuma yang kedua yang dipakai menyusun
    // jadwal pintu. Menampilkan satu saja akan membuat yang mana pun disalahpakai.
    if (p.kum_t_air_jam != null) {
      baris.push(["Air dari bendung", `${fmt(p.kum_t_air_jam, 1)} jam`]);
      baris.push(["Respons hidraulik", `${fmt(p.kum_t_hidraulik_jam, 1)} jam`]);
      baris.push(["Kecepatan aliran", `${fmt(p.v_m_detik, 2)} m/detik`]);
    }
    const isi = baris.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("");
    // Ruas yang tidak tersambung ke bendung tidak boleh diam saja: debitnya cuma beban
    // sendiri, dan tanpa keterangan ini ia terbaca sebagai ruas ujung yang memang kecil.
    const catatan = p.terhubung === false
      ? `<div class="pop__catatan">Tidak tersambung ke Bendung Copong pada data SISDA —
         debitnya hanya beban lahan yang menempel di ruas ini, tanpa akumulasi hilir.</div>`
      : p.di_bawah_v_min
      ? `<div class="pop__catatan">Mendapat air dari <b>${p.hulu}</b>. Kecepatannya di
         bawah batas anti-endapan 0,25 m/detik, jadi ruas ini bergilir — waktu di atas
         adalah batas atas.</div>`
      : p.hulu
      ? `<div class="pop__catatan">Mendapat air dari <b>${p.hulu}</b>.
         Debit sudah termasuk kehilangan jaringan (efisiensi kumulatif
         ${fmt(100 * (p.efisiensi_kumulatif || 0), 0)}%).</div>`
      : "";
    return `<div class="pop__nama">${p.id}</div>
            <div class="pop__baris">${isi}</div>${catatan}`;
  }

  function isiPopup(p) {
    if (subjekGaris()) return popupRuas(p);
    const baris = [];
    const luas = fmt(p.luas_ha, 4);
    baris.push(["Luas", luas ? `${luas} ha` : "—"]);
    if (p.jenis_sawah) baris.push(["Jenis", p.jenis_sawah]);
    // Waktu datang air, sebelum angka volume. Urutannya disengaja: "seberapa luas" lalu
    // "kapan airnya sampai" lalu "berapa banyak" - itu urutan pertanyaan orang yang
    // membuka giliran, dan volume semusim tidak menjawab satu pun dari dua yang pertama.
    if (p.tot_air_jam !== undefined && p.tot_air_jam !== null) {
      baris.push(["Air datang", `${fmt(p.tot_air_jam, 1)} jam`]);
      baris.push(["Respons debit", `${fmt(p.tot_hidraulik_jam, 1)} jam`]);
      if (p.lama_terisi_jam)
        baris.push(["Terisi penuh", `+${fmt(p.lama_terisi_jam, 1)} jam`]);
    }

    if (p.irigasi_m3 !== undefined && p.irigasi_m3 !== null) {
      baris.push(["Kebutuhan air", `${fmt(p.irigasi_m3, 0)} m³`]);
      if (p.irigasi_mm !== null) baris.push(["", `${fmt(p.irigasi_mm, 0)} mm`]);
    } else {
      baris.push(["Kebutuhan air", "belum dihitung"]);
    }
    if (p.water_loss_m3 !== undefined && p.water_loss_m3 !== null) {
      baris.push(["Water loss", `${fmt(p.water_loss_m3, 0)} m³`]);
      if (p.keluar_mm !== null) baris.push(["", `${fmt(p.keluar_mm, 0)} mm`]);
      if (p.loss_pct_masuk !== null && p.loss_pct_masuk !== undefined)
        baris.push(["", `${fmt(p.loss_pct_masuk, 0)}% dari air masuk`]);
    } else {
      baris.push(["Water loss", "belum dihitung"]);
    }

    const bagian = pecahanDari(p);
    const pecah = bagian.length === 3
      ? `<div class="pop__bilah">` + bagian.map((b) =>
          `<span style="width:${b.pct}%;background:${WARNA_LOSS[b.k]}"></span>`).join("") +
        `</div><div class="pop__catatan">` + bagian.map((b) =>
          `${LABEL_LOSS[b.k].replace(/ \(.*\)/, "")} ${fmt(b.pct, 0)}%`).join(" · ") +
        `</div>`
      : "";

    const isi = baris.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("");
    // Lokasi yang PUNYA hitungan air tetapi objek ini tidak kebagian adalah keadaan yang
    // berbeda dari lokasi yang memang belum pernah dihitung airnya - dan bedanya
    // menentukan apa yang harus dikerjakan orang yang membacanya. Kalimat "baru dianalisa
    // terrain & luas" dulu terpakai untuk keduanya, sehingga satu DI yang cuma belum
    // kebagian giliran terbaca seperti lokasi yang datanya memang belum ada. Persis itu
    // yang terjadi ketika `hitung-di-garut-air.py` dijalankan dengan `--uji 2`.
    const belumAdaAir = p.seri_big ? "Blok tutupan lahan BIG — belum ada hitungan air."
      : p.nama_di ? "Petak baku tetapan SISDA — belum ada hitungan air."
      : data.lokasi.punya_air
        ? `Hitungan airnya belum mencakup ${istilah()} ini — jalankan
           <code>${data.lokasi.notebook}</code> untuk melengkapinya.`
      : "Lokasi ini baru dianalisa terrain &amp; luas.";
    const catatan = (p.irigasi_m3 === undefined || p.irigasi_m3 === null)
      ? `<div class="pop__catatan">${belumAdaAir}</div>` : "";
    const jenis = p.jenis === "blok" ? " <em>(batas blok)</em>" : "";
    return `<div class="pop__nama">${p.id}${jenis}</div>
            <div class="pop__baris">${isi}</div>${pecah}${catatan}`;
  }

  /* ----------------------------------------------------------- kartu samping */
  function barisItem(nama, nilai, satuan) {
    if (nilai === null || nilai === undefined) return "";
    const sat = satuan ? ` <span class="satuan">${satuan}</span>` : "";
    return `<div class="baris__item"><dt>${nama}</dt><dd>${nilai}${sat}</dd></div>`;
  }

  function judulKelompok(t) { return `<div class="baris__judul">${t}</div>`; }

  /* Kelompok yang terbuka sejak awal. Detail satu objek berisi 39-49 baris dalam 6-9
     kelompok - terukur 1.697 px untuk satu DI dan 2.091 px untuk satu ruas, di kolom
     yang tingginya 730 px. Semuanya terbuka berarti tidak ada yang terbaca tanpa
     digulir; yang dibuka hanya dua yang selalu ditanya lebih dulu, sisanya sekali klik.

     Judulnya berbeda-beda antar jenis objek, jadi yang dicocokkan awalannya, bukan
     seluruh teks. Daftar ini harus memuat KEDUA bentuk subjek - kalau tidak, salah
     satunya terbuka tanpa satu kelompok pun:

       hamparan  Ukuran, Kebutuhan air, Water loss, Genangan, Terrain, Waktu datang air
       ruas      Aliran, Lahan yang dilayani, Debit rancangan, Air semusim,
                 Water loss di hilirnya, Iklim zona layanannya, Waktu tempuh dari
                 bendung, Di ruas ini saja, Hidraulika

     Yang dibuka = pertanyaan pertama untuk tiap bentuk. Pada hamparan "seluas apa dan
     butuh air berapa"; pada ruas "berapa yang mengalir dan berapa rancangannya". */
  const KELOMPOK_TERBUKA = ["Ukuran", "Kebutuhan air", "Aliran", "Debit rancangan"];
  /* Kelompok yang dilipat/dibuka pengguna, diingat selama halaman terbuka. Tanpa ini,
     memeriksa "Terrain" pada sepuluh DI berturut-turut berarti membukanya sepuluh kali:
     isi kartunya dibangun ulang dari nol tiap kali objek lain dipilih. */
  const lipatKelompok = {};

  /** Membungkus keluaran datar barisHamparan()/barisRuas() jadi kelompok yang bisa
   *  dilipat. Dikerjakan di sini, bukan di pembangunnya, supaya belasan tempat yang
   *  memanggil judulKelompok()/barisItem() tidak perlu tahu apa-apa soal pelipatan.
   *
   *  Baris yang muncul SEBELUM judul kelompok pertama tetap di tempatnya, di luar
   *  kelompok mana pun - itu baris yang memang berlaku untuk seluruh objek.
   */
  function kelompokkanDetail(wadah) {
    const anak = [...wadah.childNodes];
    wadah.innerHTML = "";
    let daftarKini = null;          // <dl> yang sedang diisi
    const dlBaru = (induk) => {
      const dl = document.createElement("dl");
      dl.className = "baris";
      induk.appendChild(dl);
      return dl;
    };

    anak.forEach((n) => {
      if (n.nodeType === 1 && n.classList.contains("baris__judul")) {
        const nama = n.textContent.trim();
        const blok = document.createElement("div");
        blok.className = "kelompok";

        const kepala = document.createElement("button");
        kepala.type = "button";
        kepala.className = "kelompok__judul";
        kepala.textContent = nama;

        const isi = document.createElement("div");
        isi.className = "kelompok__isi";

        const terbuka = (nama in lipatKelompok)
          ? lipatKelompok[nama]
          : KELOMPOK_TERBUKA.some((k) => nama.startsWith(k));
        // aria-expanded, bukan cuma kelas: tanpa itu pembaca layar tidak punya cara
        // tahu tombol ini membuka sesuatu, apalagi sedang terbuka atau tertutup.
        kepala.setAttribute("aria-expanded", String(terbuka));
        isi.hidden = !terbuka;

        kepala.addEventListener("click", () => {
          const kini = isi.hidden;
          isi.hidden = !kini;
          kepala.setAttribute("aria-expanded", String(kini));
          lipatKelompok[nama] = kini;
        });

        blok.appendChild(kepala);
        blok.appendChild(isi);
        wadah.appendChild(blok);
        daftarKini = dlBaru(isi);
        return;
      }
      if (!daftarKini) daftarKini = dlBaru(wadah);   // baris sebelum kelompok pertama
      daftarKini.appendChild(n);
    });
  }

  function tampilkanDetail(p) {
    el.detailJudul.textContent = p.id;
    el.detailKosong.hidden = true;
    el.detailIsi.hidden = false;
    sampingMuka("detail");

    if (p.terhubung === false) {
      // Didahulukan dari lencana jenis saluran: kalau ruasnya lepas dari bendung,
      // itu yang paling menentukan cara membaca seluruh angka di bawahnya.
      el.detailLencana.textContent = "lepas dari bendung";
      el.detailLencana.className = "lencana lencana--hati";
      el.detailLencana.hidden = false;
    } else if (p.jenis_saluran) {
      el.detailLencana.textContent = "saluran " + p.jenis_saluran.toLowerCase();
      el.detailLencana.className = "lencana";
      el.detailLencana.hidden = false;
    } else if (p.jenis === "blok") {
      el.detailLencana.textContent = "batas blok";
      el.detailLencana.className = "lencana lencana--hati";
      el.detailLencana.hidden = false;
    } else if (p.keandalan_terrain) {
      el.detailLencana.textContent = p.keandalan_terrain;
      el.detailLencana.className = "lencana" +
        (p.keandalan_terrain === "posisi saja" ? " lencana--hati" : "");
      el.detailLencana.hidden = false;
    } else if (p.seri_big) {
      // warna hati-hati: objek ini datang dari BIG, bukan hasil ukur/digitasi sendiri
      el.detailLencana.textContent = "BIG " + (SKALA_SERI[p.seri_big] || p.seri_big);
      el.detailLencana.className = "lencana lencana--hati";
      el.detailLencana.hidden = false;
    } else if (p.nama_di) {
      // sama hati-hatinya: batas TETAPAN dari SISDA, bukan hasil ukur/digitasi sendiri
      el.detailLencana.textContent = "SISDA — petak baku";
      el.detailLencana.className = "lencana lencana--hati";
      el.detailLencana.hidden = false;
    } else if (p.rezim) {
      el.detailLencana.textContent = "rezim " + p.rezim;
      el.detailLencana.className = "lencana";
      el.detailLencana.hidden = false;
    } else {
      el.detailLencana.hidden = true;
    }

    el.detailBaris.innerHTML = subjekGaris() ? barisRuas(p) : barisHamparan(p);
    kelompokkanDetail(el.detailBaris);

    // pecahan water loss
    const bagian = pecahanDari(p);
    if (bagian.length === 3) {
      el.detailPecahan.hidden = false;
      el.bilahLoss.innerHTML = bagian
        .map((b) => `<span style="width:${b.pct}%;background:${WARNA_LOSS[b.k]}"></span>`)
        .join("");
      el.kunciLoss.innerHTML = bagian
        .map((b) => `<li><i style="background:${WARNA_LOSS[b.k]}"></i>${LABEL_LOSS[b.k]}
                     <b>${fmt(b.pct, 1)}%</b></li>`)
        .join("");
    } else {
      el.detailPecahan.hidden = true;
    }
  }

  /** Rincian satu RUAS saluran.
   *
   *  Urutannya mengikuti urutan pertanyaan yang muncul saat menunjuk satu saluran:
   *  ia saluran apa dan dapat air dari mana (Aliran), melayani lahan mana (Layanan),
   *  lalu berapa yang harus lewat (Kebutuhan air). Ukuran lahan tidak pernah muncul
   *  sendirian di paling atas seperti pada hamparan - saluran tidak punya luas.
   */
  function barisRuas(p) {
    let h = judulKelompok("Aliran");
    h += barisItem("Jenis saluran", p.jenis_saluran, "");
    h += barisItem("Panjang", fmt(p.panjang_km, 2), "km");
    h += barisItem("Dapat air dari", p.hulu, "");
    h += barisItem("Tingkat dari bendung", fmt(p.tingkat, 0), "penggal");
    h += barisItem("Ruas di hilirnya", fmt(p.n_ruas_hilir, 0), "ruas");
    if (p.terhubung === false) {
      h += `<div class="baris__item" style="border:0"><dt style="line-height:1.5">
            Ruas ini tidak tersambung ke Bendung Copong pada data SISDA, jadi angkanya
            hanya beban lahan yang menempel padanya - tanpa air dari hilir.</dt></div>`;
    }

    h += judulKelompok("Lahan yang dilayani");
    h += barisItem("Lewat ruas ini", fmt(p.luas_ha, 1), "ha");
    h += barisItem("Menempel ruas ini", fmt(p.luas_layanan_sendiri_ha, 1), "ha");
    h += barisItem("Dari ruas di hilirnya", fmt(p.luas_layanan_hilir_ha, 1), "ha");
    h += barisItem("Zona iklim", p.zona_iklim, "");

    if (p.debit_l_detik !== undefined && p.debit_l_detik !== null) {
      h += judulKelompok("Debit rancangan");
      h += barisItem("Di hulu ruas", fmt(p.debit_l_detik, 2), "l/detik");
      h += barisItem("Di ujung hilirnya", fmt(p.debit_l_detik_hilir, 2), "l/detik");
      h += barisItem("Dari lahan sendiri", fmt(p.debit_l_detik_sendiri, 2), "l/detik");
      h += barisItem("Per km saluran", fmt(p.debit_l_detik_km, 2), "l/detik/km");
      h += barisItem("Efisiensi kumulatif",
                     fmt(100 * (p.efisiensi_kumulatif ?? 0), 0), "%");
      h += barisItem("DR", fmt(p.dr_l_detik_ha, 2), "l/detik/ha");
      h += barisItem("NFR", fmt(p.nfr_mm_hari, 2), "mm/hari");

      h += judulKelompok("Air semusim");
      h += barisItem("Lewat ruas ini", fmt(p.irigasi_m3, 0), "m³");
      h += barisItem("Termasuk kehilangan jaringan", fmt(p.irigasi_m3_kotor, 0), "m³");
      h += barisItem("Dari lahan sendiri", fmt(p.irigasi_m3_sendiri, 0), "m³");
      h += barisItem("Tahun kering (andalan 80%)", fmt(p.irigasi_m3_andalan, 0), "m³");
      h += barisItem("Kebutuhan lahannya", fmt(p.irigasi_mm, 0), "mm");
      h += barisItem("Hujan", fmt(p.hujan_mm, 0), "mm");
      h += barisItem("Tanam", p.tanam, "");

      h += judulKelompok("Water loss di hilirnya");
      h += barisItem("Total keluar", fmt(p.water_loss_m3, 0), "m³");
      h += barisItem("Dari lahan sendiri", fmt(p.water_loss_m3_sendiri, 0), "m³");
      h += barisItem("Keluar / masuk", fmt(p.loss_pct_masuk, 0), "%");
      h += barisItem("Menguap (ETc)", fmt(p.etc_mm, 0), "mm");
      h += barisItem("Meresap", fmt(p.perkolasi_mm, 0), "mm");
      h += barisItem("Mengalir keluar", fmt(p.limpasan_mm, 0), "mm");

      h += barisTot(p);

      h += judulKelompok("Iklim zona layanannya");
      h += barisItem("Ketinggian", fmt(p.elev_rata_m, 0), "m dpl");
      h += barisItem("ETo rata-rata", fmt(p.eto_rata_mm_hari, 2), "mm/hari");
      h += barisItem("Hujan setahun", fmt(p.hujan_tahunan_mm, 0), "mm");
      h += barisItem("Bulan tanam terhemat", p.bulan_tanam_optimum, "");
    } else {
      h += `<div class="baris__item" style="border:0"><dt style="line-height:1.5">
            Tidak ada lahan sawah terpetakan yang dilayani ruas ini, jadi tidak ada
            kebutuhan air yang bisa dihitung untuknya.</dt></div>`;
    }
    return h;
  }

  /** Waktu tempuh satu ruas. Kosong kalau `hitung-tot-jaringan.py` belum dijalankan.
   *
   *  Tiga waktu ditulis berdampingan dan itu memang inti bagian ini: ketiganya menjawab
   *  pertanyaan yang berbeda, selisihnya sampai enam kali lipat, dan menyamakan yang
   *  pertama dengan yang kedua adalah kekeliruan yang paling mahal di operasi jaringan -
   *  jadwal pintu yang disusun memakai waktu tempuh AIR akan selalu terlambat.
   */
  function barisTot(p) {
    if (p.kum_t_air_jam === undefined || p.kum_t_air_jam === null) return "";
    let h = judulKelompok("Waktu tempuh dari bendung");
    h += barisItem("Air sampai di sini", fmt(p.kum_t_air_jam, 1), "jam");
    h += barisItem("Debitnya berubah (respons)", fmt(p.kum_t_hidraulik_jam, 1), "jam");
    h += barisItem("Riak gangguan pertama", fmt(p.kum_t_gangguan_jam, 1), "jam");
    h += barisItem("Pita air (cepat–lambat)",
      (p.kum_t_air_jam_cepat != null && p.kum_t_air_jam_lambat != null)
        ? `${fmt(p.kum_t_air_jam_cepat, 1)}–${fmt(p.kum_t_air_jam_lambat, 1)}` : null,
      "jam");

    h += judulKelompok("Di ruas ini saja");
    h += barisItem("Waktu tempuh air", fmt(p.t_air_jam, 2), "jam");
    h += barisItem("Waktu respons hidraulik", fmt(p.t_hidraulik_jam, 2), "jam");
    h += barisItem("Dari", p.node_a, "");
    h += barisItem("Ke", p.node_b, "");

    h += judulKelompok("Hidraulika — diturunkan, bukan diukur");
    h += barisItem("Kecepatan aliran", fmt(p.v_m_detik, 3), "m/detik");
    h += barisItem("Kedalaman air", fmt(p.h_m, 2), "m");
    h += barisItem("Lebar dasar", fmt(p.b_m, 2), "m");
    h += barisItem("Luas penampang basah", fmt(p.A_m2, 2), "m²");
    h += barisItem("Angka Froude", fmt(p.froude, 2), "");
    h += barisItem("Nisbah rambat (β)", fmt(p.beta, 2), "×v");
    h += barisItem("Kekasaran Manning (anggapan)", fmt(p.n, 3), "");
    h += barisItem("Kemiringan dasar (anggapan)",
                   p.S ? `1 : ${fmt(1 / p.S, 0)}` : null, "");
    h += barisItem("Nisbah b/h (anggapan)", fmt(p.bh, 1), "");
    if (p.di_bawah_v_min) {
      h += `<div class="baris__item" style="border:0"><dt style="line-height:1.5">
            Kecepatannya di bawah batas anti-endapan 0,25 m/detik. Ruas ini tidak
            mungkin dialiri menerus sebesar debit rancangannya — ia bergilir, dan
            waktu tempuh di atas jadi <b>batas atas</b>. Batas bawahnya
            ${fmt(p.t_air_jam_giliran, 2)} jam untuk ruas ini.</dt></div>`;
    }
    return h;
  }

  /** Waktu datang air di satu Daerah Irigasi.
   *
   *  ToT dihitung per RUAS; yang ini jembatannya - ruas mana yang melintasi DI itu,
   *  lalu yang paling awal. Selisih "datang" dan "terisi penuh" ikut ditulis karena
   *  itu yang menentukan berapa lama satu giliran harus DIBUKA supaya seluruh
   *  hamparannya kebagian, bukan cuma ujung hulunya - angka yang tidak ada gunanya
   *  ditebak dan tidak terbaca dari salah satu waktunya saja.
   */
  function barisWaktuDi(p) {
    if (p.tot_air_jam === undefined || p.tot_air_jam === null) return "";
    let h = judulKelompok("Waktu datang air dari bendung");
    h += barisItem("Air datang", fmt(p.tot_air_jam, 1), "jam");
    h += barisItem("Debitnya berubah (respons)", fmt(p.tot_hidraulik_jam, 1), "jam");
    h += barisItem("Riak gangguan pertama", fmt(p.tot_gangguan_jam, 1), "jam");
    h += barisItem("Masuk lewat", p.ruas_masuk, "");
    h += barisItem("Dari simpul", p.simpul_masuk, "");
    h += barisItem("Terisi penuh", fmt(p.tot_air_jam_ujung, 1), "jam");
    h += barisItem("Lama terisi ujung ke ujung", fmt(p.lama_terisi_jam, 1), "jam");
    h += barisItem("Ruas terjauh di dalamnya", p.ruas_ujung, "");
    h += barisItem("Ruas melintasi DI ini", fmt(p.n_ruas, 0), "ruas");
    h += barisItem("Pita air (cepat–lambat)",
      (p.tot_air_jam_cepat != null && p.tot_air_jam_lambat != null)
        ? `${fmt(p.tot_air_jam_cepat, 1)}–${fmt(p.tot_air_jam_lambat, 1)}` : null, "jam");
    h += `<div class="baris__item" style="border:0"><dt style="line-height:1.5">
          ToT <b>rancangan</b>, bukan terukur — penampang, kemiringan dasar, dan
          kekasaran saluran diturunkan dari debit. Jadwal pintu memakai
          <b>respons debit</b>, bukan waktu air.</dt></div>`;
    return h;
  }

  function barisHamparan(p) {
    let h = judulKelompok("Ukuran");
    h += barisItem("Luas", fmt(p.luas_ha, 4), "ha");
    h += barisItem("Luas", fmt(p.luas_m2, 0), "m²");
    h += barisItem("Keliling", fmt(p.keliling_m, 0), "m");
    if (p.hamparan) h += barisItem("Hamparan", p.hamparan, "");
    if (p.jenis_sawah) h += barisItem("Jenis sawah", p.jenis_sawah, "");
    if (p.nama_big) h += barisItem("Nama di BIG", p.nama_big, "");
    if (p.lapisan_big) h += barisItem("Lapisan BIG", p.lapisan_big, "");
    if (p.bagian_di) h += barisItem("Bagian DI", p.bagian_di, "");
    if (p.nama_di) h += barisItem("Daerah irigasi", p.nama_di, "");
    // Luas tetapan disandingkan dengan luas ukur di atasnya, bukan menggantikannya.
    // Keduanya beda asal - yang satu angka yang ditetapkan, yang satu hasil hitung
    // geometri - dan menyembunyikan salah satunya membuat selisihnya tak pernah terlihat.
    if (p.luas_tetapan_ha != null)
      h += barisItem("Luas tetapan sumber", fmt(p.luas_tetapan_ha, 4), "ha");
    // Di lokasi DI, `luas_ha` justru luas BAKU - itu yang jadi dasar seluruh hitungan
    // airnya, sesuai KP-01 yang merancang debit dari luas layanan. Luas hasil ukur
    // geometri dan luas sawah BIG disandingkan di bawahnya supaya ketiganya bisa
    // dibandingkan: yang ditetapkan, yang terukur, dan yang benar-benar tergarap.
    if (p.luas_geom_ha != null)
      h += barisItem("Luas geometri", fmt(p.luas_geom_ha, 2), "ha");
    if (p.luas_sawah_big_ha != null)
      h += barisItem("Sawah BIG di dalamnya", fmt(p.luas_sawah_big_ha, 2), "ha");
    if (p.kewenangan) h += barisItem("Kewenangan", p.kewenangan, "");
    if (p.status) h += barisItem("Status", p.status, "");
    // Panjang jaringan di dalamnya beserta kerapatannya. Kerapatan ikut ditulis karena
    // panjang sendirian tidak bisa dibandingkan antar-DI: 6,7 km di hamparan 616 ha
    // dan 5,8 km di hamparan 124 ha adalah dua keadaan yang sangat berbeda.
    if (p.jaringan_m != null) {
      h += barisItem("Jalur irigasi di dalamnya", fmt(p.jaringan_m / 1000, 2), "km");
      if (p.luas_ha)
        h += barisItem("Kerapatan jalur", fmt(p.jaringan_m / p.luas_ha, 1), "m/ha");
    }
    h += barisWaktuDi(p);

    if (p.irigasi_m3 !== undefined && p.irigasi_m3 !== null) {
      h += judulKelompok("Kebutuhan air");
      h += barisItem("Irigasi", fmt(p.irigasi_m3, 0), "m³");
      h += barisItem("Irigasi", fmt(p.irigasi_mm, 0), "mm");
      h += barisItem("Hujan", fmt(p.hujan_mm, 0), "mm");
      h += barisItem("NFR", fmt(p.nfr_mm_hari, 2), "mm/hari");
      h += barisItem("Debit", fmt(p.debit_l_detik, 2), "l/detik");
      h += barisItem("DR", fmt(p.dr_l_detik_ha, 2), "l/detik/ha");
      h += barisItem("Ø saluran", fmt(p.diameter_cm, 1), "cm");

      h += judulKelompok("Water loss");
      h += barisItem("Total keluar", fmt(p.water_loss_m3, 0), "m³");
      h += barisItem("Total keluar", fmt(p.keluar_mm, 0), "mm");
      h += barisItem("Air masuk", fmt(p.masuk_mm, 0), "mm");
      h += barisItem("Keluar / masuk", fmt(p.loss_pct_masuk, 0), "%");
      h += barisItem("Menguap (ETc)", fmt(p.etc_mm, 0), "mm");
      h += barisItem("Meresap", fmt(p.perkolasi_mm, 0), "mm");
      h += barisItem("Mengalir keluar", fmt(p.limpasan_mm, 0), "mm");

      h += judulKelompok("Genangan");
      h += barisItem("TMA rata-rata", fmt(p.tma_rata, 1), "mm");
      h += barisItem("TMA minimum", fmt(p.tma_min, 1), "mm");
      h += barisItem("Hari diairi", fmt(p.hari_diairi, 0), "hari");
      h += barisItem("Hari kering", fmt(p.hari_kering, 0), "hari");
    }

    if (p.elev_rata_m !== undefined && p.elev_rata_m !== null) {
      h += judulKelompok("Terrain");
      h += barisItem("Tinggi rata-rata", fmt(p.elev_rata_m, 1), "m dpl");
      h += barisItem("Rentang tinggi",
        (p.elev_min_m !== null && p.elev_maks_m !== null)
          ? `${fmt(p.elev_min_m, 1)}–${fmt(p.elev_maks_m, 1)}` : null, "m");
      h += barisItem("Beda tinggi", fmt(p.beda_tinggi_m, 1), "m");
      h += barisItem("Kemiringan", fmt(p.lereng_persen, 1), "%");
      h += barisItem("Kelas", p.kelas_lereng, "");
      h += barisItem("Arah hadap",
        p.arah_hadap ? `${p.arah_hadap} (${fmt(p.arah_hadap_deg, 0)}°)` : null, "");
      h += barisItem("Daerah tangkapan", fmt(p.tangkapan_ha, 2), "ha");
      h += barisItem("Piksel sumber DEM", fmt(p.piksel_sumber, 1), "piksel");
    }

    if (p.irigasi_m3 === undefined || p.irigasi_m3 === null) {
      const sebab = p.seri_big
        ? `Blok tutupan lahan dari BIG, bukan petak hasil digitasi. Kebutuhan air
           &amp; water loss belum dihitung untuk lokasi ini.`
        : "Kebutuhan air &amp; water loss belum dihitung untuk lokasi ini.";
      h += `<div class="baris__item" style="border:0">
            <dt style="line-height:1.5">${sebab}</dt></div>`;
    }
    return h;
  }

  function pilihPetak(id, geser) {
    const lapis = lapisanDari[id];
    if (!lapis) return;
    if (terpilih && lapisanDari[terpilih]) {
      const semula = lapisanDari[terpilih];
      semula.setStyle(gayaSubjek(semula.feature, "biasa"));
    }
    terpilih = id;
    lapis.setStyle(gayaSubjek(lapis.feature, "pilih"));
    lapis.bringToFront();
    tampilkanDetail(lapis.feature.properties);
    let aktif = null;
    [...el.daftar.children].forEach((li) => {
      if (li.classList.toggle("aktif", li.dataset.id === id)) aktif = li;
    });
    // Kartu per lahan setinggi ~95 px, jadi 32 di antaranya jauh melewati tinggi
    // panelnya. Tanpa ini, mengklik petak di peta menyorot kartu yang berada di luar
    // layar - penyorotan yang tidak pernah dilihat siapa pun.
    if (aktif && aktif.scrollIntoView) {
      aktif.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (geser) peta.fitBounds(lapis.getBounds(), { maxZoom: 19, padding: [40, 40] });
  }

  /* ------------------------------------------------------------------ render */
  function gambarLegenda() {
    if (!metrikAktif || !rentang || !tampilPetak) { el.legenda.hidden = true; return; }
    el.legenda.hidden = false;
    el.legendaJudul.textContent =
      metrikAktif.label + (skalaLog ? " · skala logaritmik" : "");
    el.legendaPita.style.background =
      `linear-gradient(90deg, ${skalaAktif().join(",")})`;
    const d = metrikAktif.satuan === "ha" ? 3 : (rentang[1] < 10 ? 2 : 0);
    el.legendaMin.textContent = fmt(rentang[0], d);
    el.legendaMaks.textContent = fmt(rentang[1], d);
  }

  /** Satu baris daftar untuk objek TANPA angka air - bentuk ringkas seperti semula. */
  function barisRingkas(li, p) {
    const w = p.jenis === "blok" ? "transparent"
                                 : warnaDari(metrikAktif ? p[metrikAktif.kunci] : null);
    li.innerHTML = `<i style="background:${w}"></i>${p.id}
      ${p.jenis === "blok" ? "<em>blok</em>" : ""}
      <b>${fmt(p.luas_ha, 3) ?? "—"} ha</b>`;
  }

  /** Kartu per lahan: luas, kebutuhan air, water loss, dan susunan kehilangannya.
   *
   * Dipakai hanya kalau objeknya PUNYA angka air. Satu baris setinggi 24 px cukup
   * selama yang dibandingkan cuma luas; begitu ada dua besaran air beserta susunan
   * kehilangannya, membacanya berarti mengklik satu per satu lalu mengingat-ingat
   * angka yang barusan hilang dari layar.
   */
  function kartuLahan(li, p) {
    li.classList.add("lahan");
    const w = warnaDari(metrikAktif ? p[metrikAktif.kunci] : null);
    const bagian = pecahanDari(p);
    const bilah = bagian.length === 3
      ? `<div class="bilah bilah--mini">${bagian
          .map((b) => `<span style="width:${b.pct}%;background:${WARNA_LOSS[b.k]}"
                        title="${LABEL_LOSS[b.k]} ${fmt(b.pct, 1)}%"></span>`).join("")}</div>`
      : "";
    // Water loss diberi persen terhadap air masuk di sebelahnya: 11,65 juta m³ tidak
    // berarti apa-apa sendirian - yang menerangkannya adalah nisbahnya terhadap air
    // yang masuk ke petak yang sama.
    const lm = p.loss_pct_masuk;
    li.innerHTML = `
      <div class="lahan__kepala">
        <i style="background:${w}"></i>
        <span class="lahan__nama">${p.id}</span>
        <b>${fmt(p.luas_ha, 0) ?? "—"} ha</b>
      </div>
      <div class="lahan__angka">
        <div class="lahan__pos">
          <span>Kebutuhan air</span>
          <b>${ringkas(p.irigasi_m3) ?? "—"} <em>m³</em></b>
          <small>${fmt(p.irigasi_mm, 0) ?? "—"} mm · ${fmt(p.debit_l_detik, 0) ?? "—"} l/dt</small>
        </div>
        <div class="lahan__pos lahan__pos--loss">
          <span>Water loss</span>
          <b>${ringkas(p.water_loss_m3) ?? "—"} <em>m³</em></b>
          <small>${lm === null || lm === undefined ? "—" : fmt(lm, 0) + "% dari air masuk"}</small>
        </div>
      </div>${bilah}`;
  }

  /** Kartu per RUAS: debit yang lewat, lahan yang dilayani, dan susunan kehilangannya.
   *
   *  Debit didahulukan dari volume, kebalikan dari kartu hamparan. Saluran dirancang
   *  dari debit puncaknya - 11,6 juta m³ semusim tidak menentukan lebar satu pun
   *  saluran, sedangkan 411 l/detik menentukan semuanya.
   */
  function kartuRuas(li, p) {
    li.classList.add("lahan");
    const w = warnaDari(metrikAktif ? p[metrikAktif.kunci] : null);
    const bagian = pecahanDari(p);
    const bilah = bagian.length === 3
      ? `<div class="bilah bilah--mini">${bagian
          .map((b) => `<span style="width:${b.pct}%;background:${WARNA_LOSS[b.k]}"
                        title="${LABEL_LOSS[b.k]} ${fmt(b.pct, 1)}%"></span>`).join("")}</div>`
      : "";
    const lepas = p.terhubung === false
      ? ` <em title="tidak tersambung ke Bendung Copong">lepas</em>` : "";
    // Baris waktu, bukan kotak ketiga: panel samping selebar 236 px, dan kotak ketiga
    // akan menggencet ketiganya sampai angkanya terpotong.
    const waktu = p.kum_t_air_jam != null
      ? `<div class="lahan__waktu" title="waktu tempuh dari Bendung Copong — ToT rancangan">
           <span>Air <b>${fmt(p.kum_t_air_jam, 1)} j</b></span>
           <span>Respons <b>${fmt(p.kum_t_hidraulik_jam, 1)} j</b></span>
           <span>${fmt(p.v_m_detik, 2) ?? "—"} m/dt${p.di_bawah_v_min ? " *" : ""}</span>
         </div>`
      : "";
    li.innerHTML = `
      <div class="lahan__kepala">
        <i style="background:${w}"></i>
        <span class="lahan__nama">${p.id}</span>
        <b>${fmt(p.panjang_km, 1) ?? "—"} km</b>
      </div>
      <div class="lahan__angka">
        <div class="lahan__pos">
          <span>Debit lewat</span>
          <b>${ringkas(p.debit_l_detik) ?? "—"} <em>l/dt</em></b>
          <small>${p.jenis_saluran || "—"}${lepas}</small>
        </div>
        <div class="lahan__pos lahan__pos--lahan">
          <span>Lahan dilayani</span>
          <b>${ringkas(p.luas_ha) ?? "—"} <em>ha</em></b>
          <small>${fmt(p.luas_layanan_sendiri_ha, 0) ?? "—"} ha menempel</small>
        </div>
      </div>${waktu}${bilah}`;
  }

  function gambarDaftar(fitur) {
    el.daftar.innerHTML = "";
    fitur
      .filter((f) => f.properties.jenis !== "batas")
      .sort((a, b) => (b.properties.luas_ha || 0) - (a.properties.luas_ha || 0))
      .forEach((f) => {
        const p = f.properties;
        const li = document.createElement("li");
        li.dataset.id = p.id;
        if (p.jenis === "blok") li.classList.add("blok");
        // Blok tidak pernah diberi angka air - luasnya sudah terwakili petak di
        // dalamnya - jadi ia selalu jatuh ke bentuk ringkas.
        if (subjekGaris()) {
          kartuRuas(li, p);
        } else if (p.jenis !== "blok" && p.irigasi_m3 !== null &&
                   p.irigasi_m3 !== undefined) {
          kartuLahan(li, p);
        } else {
          barisRingkas(li, p);
        }
        li.addEventListener("click", () => pilihPetak(p.id, true));
        el.daftar.appendChild(li);
      });
  }

  /** Bagian water loss dalam persen: susunan tiga jalan keluar + nisbah air masuk. */
  function pecahanDari(p) {
    return ["etc", "perkolasi", "limpasan"]
      .map((k) => ({ k, pct: p[k + "_pct"], m3: p[k + "_m3"] }))
      .filter((b) => b.pct !== undefined && b.pct !== null);
  }

  /** Waktu tempuh ke ujung jaringan, di kartu ringkas.
   *
   *  Ketiganya ditampilkan sekaligus karena yang perlu dibaca justru SELISIHNYA:
   *  respons hidraulik 1,4x lebih cepat daripada airnya sendiri, dan riak gangguan
   *  6x lebih cepat lagi. Menampilkan satu angka saja - yang mana pun - akan membuatnya
   *  dipakai untuk menjawab dua pertanyaan lain yang jawabannya bukan itu.
   *
   *  Yang ditandai `waktu--kunci` respons hidraulik, bukan waktu air, karena itu yang
   *  dipakai menyusun jadwal pintu. Waktu air angkanya lebih besar dan lebih menarik
   *  perhatian, dan persis karena itu ia yang paling sering salah dipakai.
   */
  function gambarWaktu(s) {
    if (s.tot_air_jam === null || s.tot_air_jam === undefined) {
      el.waktuTempuh.hidden = true;
      return;
    }
    el.waktuTempuh.hidden = false;
    el.waktuUjung.textContent = s.tot_titik_terjauh || "";
    const pos = [
      ["Air sampai", s.tot_air_jam, false],
      ["Respons debit", s.tot_hidraulik_jam, true],
      ["Riak pertama", s.tot_gangguan_jam, false],
    ];
    el.waktuNilai.innerHTML = pos
      .map(([nama, v, kunci]) => `<li${kunci ? ' class="waktu--kunci"' : ""}>
        <span>${nama}</span><b>${fmt(v, 1) ?? "—"} <em>jam</em></b></li>`)
      .join("");
    const pita = (s.tot_air_jam_cepat != null && s.tot_air_jam_lambat != null)
      ? `Pita air ${fmt(s.tot_air_jam_cepat, 1)}–${fmt(s.tot_air_jam_lambat, 1)} jam — `
      : "";
    el.waktuCatatan.textContent =
      `${pita}ToT rancangan, bukan terukur. Jadwal pintu memakai respons debit, ` +
      `bukan waktu air.`;
  }

  function gambarPersen(bagian, lossMasuk) {
    if (bagian.length !== 3) { el.persenLoss.hidden = true; return; }
    el.persenLoss.hidden = false;
    el.persenMasuk.textContent = (lossMasuk === null || lossMasuk === undefined)
      ? "" : `${fmt(lossMasuk, 0)}% dari air masuk`;
    el.bilahRingkas.innerHTML = bagian
      .map((b) => `<span style="width:${b.pct}%;background:${WARNA_LOSS[b.k]}"
                    title="${LABEL_LOSS[b.k]} ${fmt(b.pct, 1)}%"></span>`).join("");
    el.kunciRingkas.innerHTML = bagian
      .map((b) => `<li><i style="background:${WARNA_LOSS[b.k]}"></i>${LABEL_LOSS[b.k]}
                   <b>${fmt(b.pct, 1)}%</b></li>`).join("");
  }

  function gambarRingkasan() {
    const s = data.ringkasan, L = data.lokasi;
    el.ringkasNama.textContent = L.nama;
    el.bukaNama.textContent = L.nama;
    // Angka yang sama, arti yang berbeda: pada hamparan ia luas objeknya sendiri, pada
    // jaringan ia luas SAWAH yang dilayani seluruh saluran - saluran tidak punya luas.
    el.statLuasLabel.textContent = subjekGaris() ? "Luas dilayani" : "Luas";
    taruhStat(el.luas, null, fmt(s.luas_ha, 2), "ha");
    taruhStat(el.air, el.airSatuan, ringkas(s.irigasi_m3), "m³");
    taruhStat(el.loss, el.lossSatuan, ringkas(s.water_loss_m3), "m³");
    gambarWaktu(s);
    gambarPersen(pecahanDari(s), s.loss_pct_masuk);

    const ada = (v) => v !== null && v !== undefined;
    const catatan = [];
    if (s.n_petak) catatan.push(`${s.n_petak} ${istilah()}`);
    if (s.n_hamparan) catatan.push(`${s.n_hamparan} hamparan`);
    if (ada(s.panjang_km)) catatan.push(`${fmt(s.panjang_km, 0)} km saluran`);
    if (s.luas_batas_ha) catatan.push(`batas ${fmt(s.luas_batas_ha, 2)} ha`);
    if (s.tanam) catatan.push(`tanam ${s.tanam}`);
    // Di jaringan, angka ini debit di ruas paling hulu - bukan jumlah seluruh ruas.
    // Kata "di hulu" harus ikut, kalau tidak ia terbaca sebagai penjumlahan.
    if (ada(s.debit_l_detik) && subjekGaris())
      catatan.push(`debit di ${s.hulu || "hulu"} ${fmt(s.debit_l_detik, 0)} l/detik`);
    else if (ada(s.debit_l_detik))
      catatan.push(`debit ${fmt(s.debit_l_detik, 2)} l/detik`);
    if (ada(s.debit_siap_lahan_l_detik))
      catatan.push(`siap lahan ${fmt(s.debit_siap_lahan_l_detik, 1)} l/detik`);
    // Waktu tempuh ke titik TERJAUH MENURUT WAKTU, bukan menurut jarak - itu yang
    // menentukan berapa lama satu perintah pintu di bendung selesai berlaku.
    if (ada(s.tot_air_jam))
      catatan.push(`air ke ujung ${fmt(s.tot_air_jam, 1)} jam, respons ` +
                   `${fmt(s.tot_hidraulik_jam, 1)} jam`);
    if (ada(s.keluar_mm)) catatan.push(`keluar ${fmt(s.keluar_mm, 0)} mm`);
    if (ada(s.lereng_rerata_persen)) catatan.push(`lereng ${fmt(s.lereng_rerata_persen, 1)} %`);
    // Lokasi yang datanya bukan dari notebook menjelaskan sendiri kenapa kolom airnya
    // kosong; kalimat bawaan di bawah hanya berlaku untuk lokasi hasil digitasi.
    if (!ada(s.irigasi_m3))
      catatan.push(s.catatan_air || "hitungan air belum ada — baru terrain & luas");
    el.ringkasCatatan.textContent = catatan.join(" · ");
    tulisCakupan(s);

    el.sub.textContent = `${L.nama} — ${L.keterangan}`;
    perbaruiRingkasAtur();
    gambarSumber();
  }

  /** Pembacaan keadaan sekarang di bilah atas: lokasi, rezim, dan besaran yang sedang
   *  mewarnai peta. Ketiganya sudah pindah ke laci, dan pengaturan yang cuma bisa
   *  dilihat dengan membuka lacinya sama saja dengan tidak bisa dilihat - "peta ini
   *  rezim apa" pertanyaan yang muncul saat membaca angkanya, bukan saat mengaturnya.
   */
  function perbaruiRingkasAtur() {
    if (!data) { el.aturRingkas.textContent = "—"; return; }
    const bagian = [data.lokasi.nama];
    // Rezim ditulis hanya kalau lokasinya memang punya pilihan; menulis "FL" pada
    // lokasi yang tidak mengenal rezim membuatnya terbaca sebagai pilihan yang diambil.
    if ((data.rezim_tersedia || []).length > 1 && data.rezim) bagian.push(data.rezim);
    if (metrikAktif) bagian.push(metrikAktif.label);
    el.aturRingkas.textContent = bagian.join(" · ");
  }

  /** Peringatan cakupan: angka air di kartu ini tidak mencakup semua objek yang digambar.
   *
   *  Ada karena kartu ringkasan menyandingkan dua angka yang bisa beda cakupan tanpa
   *  ada tanda apa pun. Sudah kejadian: `hitung-di-garut-air.py` pernah dijalankan
   *  dengan `--uji 2`, dan kartunya menulis "Luas 11.129 ha" (32 DI) tepat di atas
   *  "Kebutuhan air 3,24 jt m³" (2 DI, 1.430 ha) - dua angka yang benar sendiri-sendiri,
   *  dan sama sekali salah kalau dibaca berpasangan. Yang bisa menemukannya cuma orang
   *  yang kebetulan mengklik satu DI dan melihat "belum dihitung".
   */
  function tulisCakupan(s) {
    const pesan = [];
    if (s.n_petak_air && s.n_petak && s.n_petak_air < s.n_petak) {
      pesan.push(`Angka air baru mencakup <b>${nf(s.n_petak_air)} dari ${nf(s.n_petak)}
        ${istilah()}</b> (${fmt(s.luas_air_ha, 0)} dari ${fmt(s.luas_ha, 0)} ha).
        Luas di atas seluruhnya; airnya belum.`);
    }
    if (s.n_zona_pinjam) {
      pesan.push(`${fmt(s.n_zona_pinjam, 0)} dari ${fmt(s.n_zona_iklim, 0)} zona iklim
        <b>meminjam cuaca zona terdekat</b> (${fmt(s.luas_zona_pinjam_ha, 0)} ha) — jatah
        layanan cuaca habis saat hitungannya jalan.`);
    }
    el.cakupan.innerHTML = pesan.join(" ");
    el.cakupan.hidden = !pesan.length;
  }

  // Luas petak baku D.I. Leuwigoong menurut SISDA. Dipakai sebagai PEMBANDING untuk
  // wilayah layanan yang diturunkan sendiri dari jaringan - satu-satunya cara menakar
  // apakah penurunan itu memulangkan wilayah DI-nya atau wilayah tetangganya.
  const LUAS_BAKU_DI = 5047;
  const selisihBaku = (ha) => {
    if (ha === null || ha === undefined) return "—";
    const d = (100 * (ha - LUAS_BAKU_DI)) / LUAS_BAKU_DI;
    return `${d >= 0 ? "+" : "−"}${fmt(Math.abs(d), 0)}%`;
  };

  /** Baris sumber. Dipanggil berulang: sesudah lokasi termuat, lalu tiap kali lapisan
   *  luar (BIG, DI) menyusul - keduanya datang belakangan karena harus menanyai
   *  layanannya masing-masing. */
  function gambarSumber() {
    if (!data) return;
    /* Baris sumber data dibuang dari panel samping: satu paragraf padat setinggi
       ~130 px yang dibaca sekali, di kolom yang tinggi tiap pikselnya diperebutkan
       daftar dan detail. Atribusi ringkasnya tetap ada di sudut kanan-bawah peta
       (kredit Leaflet: Esri/Maxar untuk citra, BIG untuk Rupabumi).

       Fungsinya dibiarkan hidup, bukan dihapus: seluruh perakitan kalimatnya masih
       dipakai kalau baris itu dipasang lagi - di modal Pengaturan Peta, misalnya -
       dan yang dihapus cuma tempat menaruhnya. */
    if (!el.sumber) return;
    const s = data.ringkasan, lok = data.lokasi;
    const cuaca = s.sumber_cuaca
      ? ` Cuaca ${s.tahun_cuaca} dari ${s.sumber_cuaca}; ETo ${fmt(s.eto_rata_mm_hari, 2)}
          mm/hari (FAO-56).` : "";
    const asal = lok.sumber_petak === "jaringan"
      ? `Bentuk ruas dari <b>SISDA</b> (<code>DI_Leuwigoong_Jaringan</code>); arah alirnya
         ditelusuri dari <b>${s.hulu || "bendung"}</b> dengan menyambungkan penggal yang
         berjarak &lt; 10 m. Wilayah layanan tiap ruas TIDAK diambil dari petak baku yang
         bersengketa itu, melainkan diturunkan sendiri: sawah BIG RBI 25K dipecah sel
         100 m, tiap sel diberikan ke tersier terdekat sejauh masih dalam
         ${fmt(s.servis_maks_m, 0)} m. Terjaring ${fmt(s.luas_ha, 0)} ha — berselisih
         ${selisihBaku(s.luas_ha)} dari ${nf(LUAS_BAKU_DI)} ha petak baku D.I.
         Leuwigoong, tanpa sekali pun memakai lapisan yang bersengketa itu.
         Debit tiap ruas = kebutuhan seluruh lahan di hilirnya dibagi efisiensi
         kumulatif tingkatnya (0,90 tersier · 0,81 sekunder · 0,65 primer, KP-01).
         Angka dibaca dari <code>${lok.notebook}</code>.${cuaca}${teksTot(s)}`
      : lok.sumber_petak === "sisda"
      ? `${teksSaringJalur(s)}Bentuk diambil dari <b>petak baku</b> D.I. Leuwigoong
         (<code>${s.sumber_lapisan || ""}</code>, SISDA), wilayah DI utuh tanpa
         pemotongan. Batasnya <b>ditetapkan</b> Permen PUPR, bukan hasil digitasi
         sendiri; luas dan keliling dihitung dari geometrinya. Tidak ada hitungan air —
         SISDA menyimpan penetapan dan infrastruktur, bukan neraca air.`
      : lok.sumber_petak === "big"
      ? `Bentuk dan luas diturunkan dari poligon <b>Agrikultur Sawah</b> BIG RBI
         ${SKALA_SERI[s.seri_big] || s.seri_big || ""}, dipotong ke kotak AOI. Objeknya
         blok tutupan lahan, bukan petak per pematang, dan tidak ada hitungan air —
         RBI menyimpan tutupan lahan, bukan neraca air.`
      : `Angka dibaca langsung dari keluaran notebook <code>${lok.notebook}</code>,
         batas dari <code>${data.kml}</code>.${cuaca}`;
    el.sumber.innerHTML =
      `${asal} Citra: Esri, Maxar, Earthstar Geographics.${teksBig()}${teksDi()}`;
  }

  /** Asal-usul angka Time of Travel, beserta batas berlakunya.
   *
   *  Ditulis panjang dan tidak diringkas, karena inilah satu-satunya angka di halaman
   *  ini yang sebagian besar bahannya TIDAK ada di data mana pun: penampang, kemiringan
   *  dasar, dan kekasaran saluran diturunkan dari debit. Angka yang kelihatan setepat
   *  "34,0 jam" akan dipakai orang untuk menyetel pintu kalau tidak ada yang bilang
   *  bahwa pita sesungguhnya 22–52 jam.
   */
  function teksTot(s) {
    if (!s || s.tot_air_jam === null || s.tot_air_jam === undefined) return "";
    return ` <b>Waktu tempuh</b> dihitung <code>note/hitung-tot-jaringan.py</code>
      dengan Manning pada penampang trapesium. Dari tujuh besaran yang menentukannya,
      SISDA hanya punya dua — panjang dan debit; penampang, kedalaman, kemiringan dasar,
      kekasaran, dan bukaan pintu semuanya <b>diturunkan dari nilai rancangan</b>, jadi
      ini <b>ToT rancangan, bukan terukur</b>. Ke titik terjauh
      (${s.tot_titik_terjauh}): air ${fmt(s.tot_air_jam, 1)} jam, tetapi pitanya
      ${fmt(s.tot_air_jam_cepat, 1)}–${fmt(s.tot_air_jam_lambat, 1)} jam. Kekasaran
      Manning paling menentukan (elastisitas +0,75), dan justru itu yang paling tidak
      diketahui. ${fmt(s.n_ruas_bawah_v_min, 0)} ruas
      (${fmt(s.km_bawah_v_min, 0)} km) berkecepatan di bawah batas anti-endapan
      0,25 m/detik pada aliran menerus — ruas itu bergilir, dan waktunya jadi batas atas.
      Cukup untuk menakar, tidak cukup untuk menyetel jadwal gilir di lapangan.`;
  }

  /** DI yang disisihkan karena tidak dilewati jaringan.
   *
   *  Ditulis di DEPAN kalimat sumber, bukan di ekor: pembaca yang tahu Kab. Garut punya
   *  32 DI akan bertanya-tanya ke mana 21 sisanya pergi, dan pertanyaan itu muncul
   *  sebelum pertanyaan tentang asal geometrinya.
   */
  function teksSaringJalur(s) {
    if (!s.n_di_luar_jalur) return "";
    return `Yang diukur di sini hanya <b>${nf(s.n_petak)} DI yang dilewati jaringan</b>
            D.I. Leuwigoong. ${nf(s.n_di_luar_jalur)} DI lain
            (${fmt(s.luas_luar_jalur_ha, 0)} ha) disisihkan — jaraknya sampai 18 km dari
            ruas terdekat, jadi yang melayaninya jaringan lain yang tidak ada datanya di
            sini. Semuanya tetap tergambar sebagai lapisan konteks
            <b>DI kewenangan Kab. Garut</b> di pemilih lapisan. `;
  }

  /** Apa yang BIG punya di sekitar lokasi ini - termasuk yang TIDAK punya, supaya
   *  lapisan kosong tidak terbaca seperti "sudah dicek, memang tidak ada saluran". */
  function teksBig() {
    if (!big) return "";
    if (big.galat) return ` Lapisan BIG belum termuat — ${big.galat}.`;
    // Semua tema pembanding BIG bisa dibekukan sekaligus (lihat `tampil` di BIG_TEMA).
    // Kalau itu terjadi, kalimatnya tidak ditulis sama sekali - bukan ditulis kosong.
    if (!big.tema.length) return "";
    const ada = big.tema.filter((t) => t.n);
    const kosong = big.tema.filter((t) => !t.n);
    const nm = (t) => t.nama.replace(" (BIG)", "");
    const bagian = [];
    if (ada.length) {
      bagian.push(ada.map((t) =>
        `${nm(t)} ${t.n} objek (RBI ${SKALA_SERI[t.seri] || t.seri}${
          t.terpotong ? ", dipotong di 1.000 objek" : ""})`).join(", "));
    }
    if (kosong.length) {
      bagian.push(`BIG tidak punya ${kosong.map((t) => nm(t).toLowerCase()).join(" & ")}
                   di sekitar lokasi ini`);
    }
    return ` Pembanding <b>Rupabumi Indonesia 2019</b> (BIG): ${bagian.join("; ")}.`;
  }

  /* ------------------------------------------- pemilih lapisan sekaligus legenda */
  // Pemilih ini bukan cuma daftar saklar: ia satu-satunya tempat yang menjawab "warna
  // ini punya lapisan mana". Tiga hal yang dibawanya - contoh warna, satuan objek, dan
  // asal datanya - masing-masing menjawab kekeliruan baca yang berbeda.
  const BENTUK_GEOM = { Point: "titik", MultiPoint: "titik",
                        LineString: "garis", MultiLineString: "garis" };
  // Keterangan grup dijaga muat satu baris: panelnya terbuka terus, jadi tiap baris
  // tambahan langsung memakan peta.
  const JUDUL_GRUP = {
    sisda: ["SISDA Cimanuk-Cisanggarung", "Ditetapkan — lapisan letak, bukan ukur."],
    big: ["Rupabumi Indonesia (BIG)", "Penafsiran citra — pembanding."],
  };
  const NAMA_SUBJEK = { sisda: "Petak baku (SISDA)",
                        big: "Blok tutupan lahan (BIG)",
                        jaringan: "Ruas saluran (berhitungan air)" };

  /** Bentuk objek satu tema, DIBACA dari geometri fitur pertamanya. Diturunkan, bukan
   *  didaftar: satu daftar lagi yang harus ikut diperbarui tiap menambah lapisan adalah
   *  satu daftar lagi yang bisa lupa diperbarui. */
  const bentukTema = (gj) => {
    const f = gj && gj.features && gj.features[0];
    return (f && BENTUK_GEOM[f.geometry && f.geometry.type]) || "bidang";
  };

  const contohLapisan = (warna, bentuk) =>
    // Isian bidang dibuat 13% (hex "22") supaya sepadan dengan tipisnya isian di peta.
    `<i class="kendali__w kendali__w--${bentuk}" style="${bentuk === "bidang"
      ? `border-color:${warna};background:${warna}22` : `background:${warna}`}"></i>`;

  /** Satu baris pemilih: contoh warna, nama, lalu jumlah BESERTA SATUANNYA. Satuan itu
   *  yang membedakan "22 DI" - dua puluh dua daerah irigasi utuh - dari "886 petak",
   *  yang semuanya berada di dalam satu daerah irigasi saja. */
  function labelLapisan(t, grup, jumlah) {
    const n = t.n ? `<span class="kendali__n">${jumlah}</span>`
                  : `<span class="kendali__n kendali__n--kosong">tidak ada</span>`;
    return contohLapisan(t.warna, bentukTema(t.geojson)) +
           `<span class="kendali__nama" data-grup="${grup}">${t.nama}</span>${n}`;
  }

  const grupDari = (label) => {
    const n = label.querySelector("[data-grup]");
    return n ? n.dataset.grup : "";
  };

  /** Lapisan dikelompokkan menurut ASAL datanya, dan baris subjek disisipkan di atas.
   *
   *  Dikelompokkan begitu karena asal itulah yang menentukan seberapa jauh angkanya
   *  boleh dipercaya - dua lapisan yang mirip di peta bisa datang dari dua lembaga
   *  dengan cara kerja yang sama sekali berbeda. Baris subjek ada karena petak halaman
   *  BUKAN salah satu lapisan di daftar ini, sehingga tanpa baris itu warnanya jadi
   *  satu-satunya warna di peta yang tidak diterangkan di mana pun.
   *
   *  Aman dipanggil berkali-kali: barisan sisipan dibuang dulu tiap kali.
   */
  function rapikanKendali() {
    const daftar = document.querySelector(".leaflet-control-layers-overlays");
    if (!daftar) return;
    daftar.querySelectorAll(".kendali__grup").forEach((n) => n.remove());

    // Urutan antar-grup ditata; urutan DI DALAM grup dibiarkan apa adanya - itu urutan
    // temanya disusun di data.py, dan sort JS stabil sehingga tidak teracak.
    // Baris subjek dikecualikan: ia juga <label>, tetapi bukan lapisan yang ikut
    // diurutkan - tempatnya sudah pasti, paling atas.
    const urut = { sisda: 1, big: 2 };
    const baris = [...daftar.querySelectorAll("label:not(.kendali__subjek)")];
    baris.sort((a, b) => (urut[grupDari(a)] || 9) - (urut[grupDari(b)] || 9));
    baris.forEach((l) => daftar.appendChild(l));

    let grupTerakhir = null;
    baris.forEach((l) => {
      const g = grupDari(l);
      if (g === grupTerakhir) return;
      grupTerakhir = g;
      const [judul, ket] = JUDUL_GRUP[g] || [g, ""];
      const h = document.createElement("div");
      h.className = "kendali__grup";
      h.innerHTML = judul + (ket ? `<small>${ket}</small>` : "");
      daftar.insertBefore(h, l);
    });

    // Baris subjek hanya masuk kalau subjeknya memang ada. Lokasi tanpa petak akan
    // menampilkan pita warna yang tidak mewakili apa pun di peta.
    //
    // Barisnya DIPAKAI ULANG, bukan dibangun ulang. Fungsi ini berjalan sekali untuk
    // TIAP lapisan yang masuk atau keluar peta - puluhan kali dalam satu kali centang,
    // karena satu lapisan petak membawa ratusan bentuk - dan mengganti unsur kotak
    // centangnya di tengah itu akan mencabut fokus dari tangan pengguna papan ketik
    // yang baru saja menekannya. Judulnya tetap dibangun ulang; ia tidak bisa difokus.
    if (data && data.ringkasan.n_petak) {
      const ada = daftar.querySelector(".kendali__subjek") || barisSubjek();
      if (daftar.firstChild !== ada) daftar.insertBefore(ada, daftar.firstChild);
      daftar.insertBefore(judulSubjek(), ada);
    }
  }

  /** Baris subjek dibuang saat lokasi berganti - namanya, jumlahnya, dan skala
   *  warnanya ikut berganti, jadi yang lama tidak boleh dipakai ulang. */
  function buangBarisSubjek() {
    const lama = document.querySelector(".kendali__subjek");
    if (lama) lama.remove();
  }

  function judulSubjek() {
    const judul = document.createElement("div");
    judul.className = "kendali__grup";
    judul.innerHTML = "Subjek halaman" +
      `<small>Yang diukur di halaman ini.</small>`;
    return judul;
  }

  function barisSubjek() {
    const baris = document.createElement("label");
    baris.className = "kendali__subjek";
    const kotak = document.createElement("input");
    kotak.type = "checkbox";
    kotak.checked = tampilPetak;
    kotak.addEventListener("change", () => pasangTampilPetak(kotak.checked));
    baris.appendChild(kotak);
    // Contoh warnanya pita, bukan satu kotak: warna subjek memang bergerak mengikuti
    // metrik, jadi satu kotak akan mengaku-aku mewakili yang tidak diwakilinya.
    // Pitanya diwarnai dari sini, bukan dari CSS: skalanya berganti menurut bentuk
    // subjeknya (lihat SKALA_GARIS), dan warna yang dipatok di CSS akan diam-diam
    // menerangkan peta dengan pita yang bukan miliknya.
    baris.insertAdjacentHTML("beforeend",
      `<i class="kendali__w kendali__w--pita" style="background:linear-gradient(90deg,${
        skalaAktif().join(",")})"></i>` +
      `<span class="kendali__nama">${
        NAMA_SUBJEK[data.lokasi.sumber_petak] || "Petak hasil digitasi"}</span>` +
      `<span class="kendali__n">${nf(data.ringkasan.n_petak)} ${istilah()}</span>`);
    return baris;
  }

  /** Menyalakan/mematikan lapisan subjek beserta batasnya.
   *
   *  Legendanya ikut dimatikan, bukan dibiarkan menggantung: pita warna yang tidak
   *  mewakili apa pun di peta lebih menyesatkan daripada tidak ada legenda sama sekali.
   */
  function pasangTampilPetak(nyala) {
    tampilPetak = nyala;
    [lapisanPetak, lapisanBatas].forEach((l) => {
      if (!l) return;
      if (nyala) l.addTo(peta);
      else peta.removeLayer(l);
    });
    gambarLegenda();
  }

  /* --------------------------------------------------------------- lapisan BIG */
  function popupBig(p) {
    const baris = [];
    if (p.keterangan) baris.push(["Jenis", p.keterangan]);
    baris.push(["Lapisan", p.lapisan]);
    baris.push(["Seri RBI", SKALA_SERI[p.seri] || p.seri]);
    const isi = baris.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("");
    return `<div class="pop__nama">${p.nama || "(tanpa nama)"}</div>
            <div class="pop__baris">${isi}</div>
            <div class="pop__catatan">Badan Informasi Geospasial — data pembanding,
            tidak dipakai menghitung apa pun di halaman ini.</div>`;
  }

  /** Lapisan BIG untuk lokasi yang sedang terbuka. Gagalnya tidak menghalangi
   *  apa pun: peta dan semua angka sudah tergambar sebelum ini dipanggil. */
  async function muatBig(lokasiId) {
    Object.keys(lapisanBig).forEach((k) => {
      kendaliLapisan.removeLayer(lapisanBig[k]);
      peta.removeLayer(lapisanBig[k]);
      delete lapisanBig[k];
    });
    big = null;
    try {
      const r = await fetch(`${PETA.data}/big-${lokasiId}.json`);
      if (!r.ok) return;
      big = await r.json();
    } catch (e) {
      return;                       // tanpa jaringan: halaman tetap utuh, tanpa BIG
    }
    if (lokasiId !== el.lokasi.value) return;   // lokasi sudah diganti sementara menunggu

    big.tema.forEach((t) => {
      const gaya = GAYA_BIG[t.kunci] || GAYA_BIG.sungai;
      const lapis = L.geoJSON(t.geojson, {
        pane: "big",
        style: gaya,
        // Lapisan pembanding, bukan yang diukur: toleransi penyederhanaan garisnya
        // dinaikkan dari 1 px bawaan. Selisihnya tak terlihat di layar, jumlah titik
        // yang harus digambar tiap bingkai turun banyak.
        smoothFactor: 1.8,
        // Beberapa lapisan BIG (bendung) bisa berupa titik; tanpa ini Leaflet
        // memasang pin bawaan yang jauh lebih mencolok daripada isinya. `pane` disebut
        // ulang karena lapisan buatan pointToLayer tidak mewarisi opsi induknya.
        pointToLayer: (f, ll) => L.circleMarker(ll, { ...gaya, radius: 4, pane: "big" }),
        // Isi popup dirakit saat DIBUKA, bukan saat lapisan dibangun. Sebagai string
        // langsung, satu lapisan 8.000 objek berarti 8.000 potong HTML yang disusun
        // dan disimpan di memori padahal paling banyak satu yang pernah dilihat.
        onEachFeature: (f, l) => l.bindPopup(() => popupBig(f.properties),
                                             { closeButton: false }),
      });
      lapisanBig[t.kunci] = lapis;
      catatKlik(lapis);
      kendaliLapisan.addOverlay(lapis, labelLapisan(t, "big",
        `${t.n} objek · RBI ${SKALA_SERI[t.seri] || t.seri || "?"}`));
      if (tampilBig[t.kunci] && t.n) lapis.addTo(peta);
    });
    gambarSumber();
    rapikanKendali();
  }

  /* ----------------------------------------------------------- lapisan SISDA */
  // Catatan penutup popup, per tema. Yang perlu dijaga di sini cuma satu: pembaca tidak
  // boleh mengira angka di popup ini ikut menghitung sesuatu di halaman.
  const CATATAN_GC = {
    gc_jaringan: `Ruas jaringan irigasi menurut SISDA. RBI 25K tidak memuat saluran
                  irigasi di wilayah ini sama sekali.`,
    gc_bangunan: `Bangunan irigasi (bendung, bagi, sadap) menurut penomoran SISDA.`,
    gc_sungai: `Alur sungai hasil sinkronisasi SISDA; kolom "Nama BIG" adalah nama objek
                yang sama di Rupabumi.`,
    gc_sempadan: `Sempadan sungai tetapan 2023 — kawasan lindung, bukan lahan garapan.`,
    gc_mata_air: `Mata air terdata SISDA. "Status" mengacu pada pendataan lapangannya,
                  bukan pada keadaan airnya.`,
    gc_situ: `Situ/telaga terdata SISDA, beserta pengelolanya.`,
  };
  // Dua tema kewenangan tidak masuk tabel di atas: catatannya berubah menurut kena
  // tidaknya AOI, jadi disusun saat itu juga.
  const TEMA_KEWENANGAN = ["di_kab", "di_prov"];
  const CATATAN_KEWENANGAN = (dalam) => (dalam
    ? `Menyentuh kotak AOI. Luas baku adalah wilayah layanan yang ditetapkan
       Permen PUPR No. 14/2015, bukan luas sawah hasil ukur.`
    : `Di luar kotak AOI — ditampilkan sebagai penunjuk letak saja.`);

  /** Popup satu objek SISDA. Isinya tinggal dituliskan: nama kolom tiap lapisan sudah
   *  dibakukan jadi `rincian` di data.py, jadi halaman tidak perlu tahu satu pun. */
  function popupGc(p) {
    const isi = (p.rincian || [])
      .map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join("");
    // Tanpa cocok yang pasti, catatannya dikosongkan - bukan diisi catatan tema lain.
    // Tema baru yang belum punya catatan lebih baik diam daripada salah menerangkan.
    const catatan = TEMA_KEWENANGAN.includes(p.tema)
      ? CATATAN_KEWENANGAN(p.dalam_aoi)
      : CATATAN_GC[p.tema] || "";
    return `<div class="pop__nama">${p.nama || "(tanpa nama)"}</div>
            <div class="pop__baris">${isi}</div>
            ${catatan ? `<div class="pop__catatan">${catatan}</div>` : ""}`;
  }

  /** Lapisan SISDA untuk lokasi yang sedang terbuka. Sama seperti BIG: menyusul, dan
   *  gagalnya tidak menghalangi apa pun. */
  async function muatDi(lokasiId) {
    Object.keys(lapisanDi).forEach((k) => {
      kendaliLapisan.removeLayer(lapisanDi[k]);
      peta.removeLayer(lapisanDi[k]);
      delete lapisanDi[k];
    });
    di = null;
    try {
      const r = await fetch(`${PETA.data}/di-${lokasiId}.json`);
      if (!r.ok) return;
      di = await r.json();
    } catch (e) {
      return;
    }
    if (lokasiId !== el.lokasi.value) return;

    memuatLapisan = true;
    di.tema.forEach((t) => {
      const bentuk = GAYA_GC[t.kunci] || GAYA_GC.gc_sungai;
      const lapis = L.geoJSON(t.geojson, {
        pane: t.atas ? "di-atas" : "di",
        style: (f) => bentuk(t.warna, f.properties.dalam_aoi),
        smoothFactor: 1.8,            // alasannya sama dengan lapisan BIG di atas
        // Bangunan, mata air, dan situ bergeometri titik; tanpa ini Leaflet memasang
        // pin bawaannya yang jauh lebih mencolok daripada isinya. `pane` harus disebut
        // ulang di sini: lapisan buatan pointToLayer TIDAK mewarisi opsi induknya, dan
        // tanpa itu titiknya diam-diam jatuh ke panel bawaan bercampur dengan petak.
        pointToLayer: (f, ll) => L.circleMarker(ll, {
          ...bentuk(t.warna, true), radius: JARI_TITIK[t.kunci] || 4,
          pane: t.atas ? "di-atas" : "di",
        }),
        onEachFeature: (f, l) => l.bindPopup(() => popupGc(f.properties),
                                             { closeButton: false }),
      });
      lapisanDi[t.kunci] = lapis;
      catatKlik(lapis);
      // Untuk tema berlingkup kabupaten, yang dihitung bukan jumlah seluruhnya melainkan
      // berapa yang menyentuh AOI - 32 DI se-Garut tidak memberi tahu apa-apa soal sini.
      const satuan = t.satuan || "objek";
      kendaliLapisan.addOverlay(lapis, labelLapisan(t, "sisda",
        t.lingkup === "kabupaten" ? `${t.n_aoi} ${satuan} di sini`
                                  : `${t.n} ${satuan}`));
      if (tampilDi[t.kunci] && t.n) lapis.addTo(peta);
    });
    memuatLapisan = false;
    gambarSumber();
    rapikanKendali();
    // Lokasi tanpa petak memakai kartu daftar untuk Daerah Irigasi. Baru bisa diisi di
    // sini, karena datanya justru yang barusan tiba.
    if (data && !data.geojson.features.length) gambarDaftarDi();
  }

  /** Kartu daftar dialihkan ke Daerah Irigasi untuk lokasi yang tidak punya petak.
   *
   *  Yang didaftar hanya DI yang MENYENTUH kotak AOI: 32 DI se-Kabupaten Garut tidak
   *  menerangkan apa pun soal lokasi ini, dan mendaftar semuanya justru mengubur yang
   *  sepuluh-sekian yang relevan. Diurutkan dari yang terluas, sama seperti daftar
   *  petak, supaya kebiasaan membacanya tidak berubah.
   */
  function gambarDaftarDi() {
    const t = di && di.tema.find((x) => x.kunci === "di_kab");
    el.daftar.innerHTML = "";
    if (!t) return;
    el.judulDaftar.textContent = t.nama;
    const isi = t.geojson.features.filter((f) => f.properties.dalam_aoi);
    if (!isi.length) {
      el.daftar.innerHTML =
        `<li class="daftar__kosong">tidak ada DI kewenangan kabupaten di kotak ini</li>`;
      return;
    }
    isi
      .sort((a, b) => (b.properties.luas_ha || 0) - (a.properties.luas_ha || 0))
      .forEach((f) => {
        const p = f.properties;
        const li = document.createElement("li");
        li.dataset.di = p.nama || "";
        li.innerHTML = `<i style="background:${t.warna}"></i>${p.nama || "(tanpa nama)"}
          <b>${fmt(p.luas_ha, 0) ?? "—"} ha</b>`;
        li.title = "Luas baku (CEA) — luas layanan yang ditetapkan, bukan hasil ukur";
        li.addEventListener("click", () => pilihDi(p.nama));
        el.daftar.appendChild(li);
      });
  }

  /** Detail satu Daerah Irigasi di panel samping.
   *
   *  Sumbernya `p.rincian` - kolom yang sama yang dipakai popupGc(), dibakukan di sisi
   *  data. Jadi tidak ada daftar kolom kedua yang harus dijaga sejalan di sini: DI yang
   *  nanti membawa kolom baru langsung memunculkannya.
   *
   *  Luas baku TIDAK ditulis ulang di sini: `rincian` sudah memuatnya sebagai
   *  "Luas baku (CEA)". Baris luas buatan sendiri hanya dipakai kalau `rincian` kosong,
   *  supaya kartu detail tidak pernah tampil tanpa satu angka pun.
   */
  function tampilkanDetailDi(p) {
    el.detailJudul.textContent = p.nama || "(tanpa nama)";
    el.detailKosong.hidden = true;
    el.detailPecahan.hidden = true;
    el.detailIsi.hidden = false;

    /* Lencana menyebut kena tidaknya AOI, bukan jenis salurannya: untuk DI itu satu-
       satunya hal yang mengubah cara membaca seluruh angka di bawahnya. */
    el.detailLencana.textContent = p.dalam_aoi ? "menyentuh AOI" : "di luar AOI";
    el.detailLencana.className = p.dalam_aoi ? "lencana" : "lencana lencana--hati";
    el.detailLencana.hidden = false;

    /* "Nama" dibuang dari rincian - sudah jadi judul kartunya. */
    const rincian = (p.rincian || []).filter(([k]) => k !== "Nama");
    const baris = rincian.length
      ? rincian
      : [["Luas baku", `${fmt(p.luas_ha, 0) ?? "—"} ha`]];
    el.detailBaris.innerHTML =
      `<dl class="baris">${baris.map(([k, v]) => barisItem(k, v)).join("")}</dl>`
      + `<p class="kartu-peta__catatan">${CATATAN_KEWENANGAN(p.dalam_aoi)}</p>`;
    sampingMuka("detail");
  }

  /** Satu DI dari daftar: petanya diarahkan ke situ dan detailnya dibuka di panel
   *  samping. Lapisannya dinyalakan dulu kalau sedang dimatikan - kalau tidak, peta
   *  bergeser ke tempat yang benar tetapi tidak ada apa pun yang tergambar di sana.
   *
   *  Popup di peta TIDAK dibuka lagi. Isinya sama persis dengan detail yang sekarang
   *  muncul di panel samping (keduanya dari `p.rincian`), dan dua salinan angka yang
   *  sama di satu layar cuma menutupi peta yang baru saja diarahkan ke situ. Popup
   *  tetap ada untuk klik pada poligonnya sendiri di peta - jalur itu tidak lewat sini.
   */
  function pilihDi(nama) {
    const lapis = lapisanDi.di_kab;
    if (!lapis) return;
    if (!peta.hasLayer(lapis)) lapis.addTo(peta);
    let sifat = null;
    lapis.eachLayer((l) => {
      if (l.feature && l.feature.properties.nama === nama) {
        sifat = l.feature.properties;
        peta.fitBounds(l.getBounds(), { padding: [40, 40] });
      }
    });
    [...el.daftar.children].forEach((li) =>
      li.classList.toggle("aktif", li.dataset.di === nama));
  }

  /** Apa yang SISDA punya di sekitar lokasi ini. Ditulis terpisah dari BIG karena
   *  wataknya beda - SISDA memetakan infrastruktur dan kewenangan yang ditetapkan,
   *  bukan tutupan lahan hasil penafsiran citra. */
  function teksDi() {
    if (!di || !di.tema.length) return "";
    if (di.galat) return ` Lapisan SISDA belum termuat — ${di.galat}.`;
    const bagian = [];
    const jaringan = di.tema.find((t) => t.kunci === "gc_jaringan");
    const bangunan = di.tema.find((t) => t.kunci === "gc_bangunan");
    if (jaringan && jaringan.n) {
      bagian.push(`${jaringan.n} ruas jaringan irigasi${
        bangunan && bangunan.n ? ` dan ${bangunan.n} bangunan` : ""}`);
    }
    const kena = di.tema.filter((t) => t.lingkup === "kabupaten" && t.n_aoi);
    if (kena.length) {
      bagian.push(kena.map((t) =>
        `${t.n_aoi} DI ${t.kunci === "di_prov" ? "kewenangan provinsi" : "kewenangan kabupaten"}
         (luas baku ${nf(t.luas_aoi_ha)} ha)`).join(" dan "));
    }
    if (!bagian.length) return ` <b>SISDA</b> tidak punya objek di sekitar lokasi ini.`;
    return ` Letak dari <b>SISDA Cimanuk-Cisanggarung</b> (BBWS, batas DI mengikuti
             Permen PUPR No. 14/2015): ${bagian.join("; ")}. Semuanya lapisan letak —
             luas baku di situ luas layanan yang ditetapkan, bukan luas sawah hasil
             ukur, dan tidak ada angka halaman ini yang diambil darinya.`;
  }

  function gambarPeta() {
    if (lapisanPetak) { lapisanPetak.remove(); lapisanPetak = null; }
    if (lapisanBatas) { lapisanBatas.remove(); lapisanBatas = null; }
    Object.keys(lapisanDari).forEach((k) => delete lapisanDari[k]);
    terpilih = null;

    const fitur = data.geojson.features;
    const batas = fitur.filter((f) => f.properties.jenis === "batas");
    const petak = fitur.filter((f) => f.properties.jenis !== "batas");

    if (batas.length) {
      lapisanBatas = L.geoJSON({ type: "FeatureCollection", features: batas }, {
        style: { color: "#2f6d90", weight: 2, dashArray: "2 5", fill: false },
        interactive: false,
      });
      if (tampilPetak) lapisanBatas.addTo(peta);
    }

    lapisanPetak = L.geoJSON({ type: "FeatureCollection", features: petak }, {
      style: (f) => gayaSubjek(f, "biasa"),
      onEachFeature: (f, lapis) => {
        const p = f.properties;
        lapisanDari[p.id] = lapis;
        // Dirakit saat dibuka, bukan saat digambar - alasannya sama dengan lapisan
        // BIG. Sekalian membuat isinya selalu sesuai metrik yang sedang berlaku.
        lapis.bindPopup(() => isiPopup(p), { closeButton: false, offset: [0, -2] });
        lapis.on("mouseover", () => {
          if (p.id !== terpilih) lapis.setStyle(gayaSubjek(f, "sorot"));
        });
        lapis.on("mouseout", () => {
          if (p.id !== terpilih) lapis.setStyle(gayaSubjek(f, "biasa"));
        });
        lapis.on("click", () => pilihPetak(p.id, false));
      },
    });
    if (tampilPetak) lapisanPetak.addTo(peta);
    catatKlik(lapisanPetak);

    // Lokasi tanpa petak tetap harus mengarahkan peta ke tempat yang benar - kalau
    // tidak, ia berhenti di tampilan awal dan lapisan SISDA-nya entah di sebelah mana.
    // Kotak AOI dari server yang dipakai kalau tidak ada geometri untuk disandari.
    const kotak = lapisanPetak.getBounds();
    if (kotak.isValid()) {
      peta.fitBounds(kotak, { padding: [60, 60] });
    } else if (data.kotak) {
      const [W, S, E, N] = data.kotak;
      peta.fitBounds([[S, W], [N, E]], { padding: [20, 20] });
    }
  }

  function hitungRentang() {
    if (!metrikAktif) { rentang = null; batasLog = null; skalaLog = false; return; }
    const nilai = data.geojson.features
      .filter((f) => f.properties.jenis === "petak")
      .map((f) => f.properties[metrikAktif.kunci])
      .filter((v) => v !== null && v !== undefined && Number.isFinite(v));
    rentang = nilai.length ? [Math.min(...nilai), Math.max(...nilai)] : null;
    // Luas blok BIG merentang sampai empat orde besaran. Dengan ramp linier, satu blok
    // raksasa menyedot seluruh skala dan sisanya jatuh ke warna terpucat - petanya jadi
    // rata dan tidak memberi keterangan apa pun. Ujung legenda tetap nilai sebenarnya;
    // yang berubah hanya jarak warnanya, dan itu ditulis di judul legenda.
    //
    // Batas bawah ramp-nya nilai POSITIF terkecil, bukan nilai terkecil. Dulu satu nilai
    // nol saja sudah cukup untuk mematikan skala log seluruhnya, dan di jaringan itu
    // pasti terjadi: 8 ruas ujung memang tidak melayani lahan apa pun sehingga debitnya
    // benar-benar 0. Akibatnya 166 dari 176 ruas - yang debitnya merentang dari 0,2
    // sampai 1.272 l/detik - tergambar dengan warna yang sama persis. Yang nol tetap
    // jatuh ke ujung terpucat; yang berubah cuma nasib 168 ruas di atasnya.
    const positif = nilai.filter((v) => v > 0);
    const bawah = positif.length ? Math.min(...positif) : 0;
    skalaLog = !!rentang && bawah > 0 && rentang[1] / bawah >= 100;
    batasLog = skalaLog ? [bawah, rentang[1]] : null;
  }

  /** Sebagian halaman ini memang tentang PETAK - luasnya, daftarnya, rinciannya,
   *  pewarnaannya, ekspornya. Lokasi yang tidak punya petak (lihat catatan di
   *  `LOKASI` pada data.py) tidak boleh menyisakan kendali-kendali itu dalam keadaan
   *  kosong: pemilih warna tanpa pilihan dan daftar tanpa isi terbaca seperti gagal
   *  memuat, padahal keadaannya memang begitu. Yang tersisa: peta, kartu ringkas
   *  beserta alasannya, pemilih lapisan, dan baris sumber. */
  function pasangTanpaPetak(tanpa) {
    el.wadahMetrik.hidden = tanpa;
    // Tautan KML-nya langsung, bukan pembungkusnya: sejak bilah diringkas, Unduh KML
    // tidak lagi punya pembungkus sendiri - ia bertetangga dengan tombol Atur peta,
    // yang justru HARUS tetap ada pada lokasi tanpa petak (lapisan dan peta dasarnya
    // masih bisa diatur di situ).
    el.unduhKml.hidden = tanpa;
    el.statKotakLuas.hidden = tanpa;
    /* Kartu detail TIDAK lagi disembunyikan pada lokasi tanpa petak. Sejak daftar
       Daerah Irigasi punya detailnya sendiri (tampilkanDetailDi()), kartu itu justru
       satu-satunya tempat rincian DI muncul di panel samping. Tampil tidaknya sudah
       diurus kelas .samping--detail - menyembunyikannya lewat `hidden` di sini akan
       menang atas kelas itu dan membuat detail DI tidak pernah terlihat. */
    if (tanpa) el.legenda.hidden = true;
    // Kartu daftar TIDAK ikut disembunyikan: kalau tidak ada petak untuk didaftar, ia
    // dialihkan ke daftar Daerah Irigasi (`gambarDaftarDi()`), yang menunggu lapisan
    // SISDA datang. Sampai itu tiba, isinya sengaja dikosongkan supaya daftar petak
    // dari lokasi sebelumnya tidak tertinggal di situ.
    if (tanpa) {
      el.daftar.innerHTML = "";
      el.judulDaftar.textContent = "Daerah Irigasi";
    } else {
      el.judulDaftar.innerHTML = `Daftar <span class="objek">petak</span>`;
    }
  }

  function gambarPilihMetrik() {
    el.metrik.innerHTML = data.metrik
      .map((m) => `<option value="${m.kunci}">${m.label}</option>`).join("");
    metrikAktif = data.metrik[0] || null;
    if (metrikAktif) el.metrik.value = metrikAktif.kunci;
    el.metrik.disabled = !data.metrik.length;
  }

  function gambarPilihRezim() {
    const ada = data.rezim_tersedia || [];
    el.wadahRezim.hidden = ada.length < 2;
    el.rezim.innerHTML = ada.map((r) => `<option value="${r}">${r}</option>`).join("");
    if (data.rezim) el.rezim.value = data.rezim;
  }

  function kosongkanDetail() {
    el.detailJudul.textContent = "Detail " + istilah();
    el.detailLencana.hidden = true;
    el.detailIsi.hidden = true;
    el.detailPecahan.hidden = true;
    el.detailKosong.hidden = false;
    sampingMuka("daftar");
  }

  /** Muka mana yang tampil di panel samping: "daftar" atau "detail". Keduanya tidak
   *  pernah tampil sekaligus - lihat alasan tingginya di .samping--detail (app.css).
   *
   *  Ditandai dari JS, bukan lewat `:has()` di CSS: keadaan ini menentukan tata letak
   *  seluruh kolom, dan penandanya sebaiknya tidak bergantung pada selector yang
   *  dukungannya lebih muda daripada sisa berkas ini.
   */
  function sampingMuka(muka) {
    if (el.samping) el.samping.classList.toggle("samping--detail", muka === "detail");
  }

  /** Kembali dari detail ke daftar.
   *
   *  Pilihan di peta TIDAK dibatalkan: sorotan poligonnya dan baris `aktif` di daftar
   *  dibiarkan, jadi setelah kembali masih terlihat objek mana yang baru dibaca - dan
   *  membukanya lagi cukup satu klik pada baris yang sudah tersorot itu. Yang berubah
   *  cuma muka panelnya.
   *
   *  Baris aktifnya digulir ke pandangan karena daftar bisa panjang (32 petak, 11 DI):
   *  tanpa ini, kembali dari objek ke-20 memperlihatkan puncak daftar, bukan tempat
   *  terakhir dibaca. */
  function kembaliKeDaftar() {
    sampingMuka("daftar");
    const aktif = el.daftar.querySelector("li.aktif");
    if (aktif && aktif.scrollIntoView) aktif.scrollIntoView({ block: "nearest" });
  }

  /* -------------------------------------------------------------- koordinat */
  // Penanda titik yang diklik, untuk dicocokkan dengan sumber lain (Google Earth, QGIS,
  // GPS lapangan). Angkanya SELALU ditulis bertitik desimal dan berurutan lintang-bujur,
  // bukan gaya angka Indonesia yang dipakai di seluruh halaman ini: ia bukan untuk
  // dibaca, melainkan untuk ditempel ke aplikasi lain, dan koma di situ akan terbaca
  // sebagai pemisah dua bilangan.
  let penandaTitik = null;

  /** Derajat desimal -> derajat-menit-detik. Dipakai berdampingan, bukan menggantikan:
   *  peta dan berkas memakai desimal, sementara patok lapangan dan dokumen resmi masih
   *  banyak yang tertulis DMS. */
  function keDms(nilai, arah) {
    const tanda = nilai < 0 ? arah[1] : arah[0];
    const mutlak = Math.abs(nilai);
    const d = Math.floor(mutlak);
    const m = Math.floor((mutlak - d) * 60);
    const s = ((mutlak - d) * 60 - m) * 60;
    return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${tanda}`;
  }

  function tulisKoordinat(latlng) {
    const lat = latlng.lat, lon = latlng.lng;
    el.koordinatNilai.textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    el.koordinatDms.textContent = `${keDms(lat, "NS")} ${keDms(lon, "EW")}`;
    el.koordinat.hidden = false;

    if (penandaTitik) penandaTitik.remove();
    penandaTitik = L.circleMarker(latlng, {
      pane: "markerPane", radius: 5, weight: 2,
      color: "#ffffff", fillColor: "#d9b26a", fillOpacity: 1,
    }).addTo(peta);
  }

  /** Koordinat ikut dicatat dari klik pada satu lapisan, bukan hanya dari klik pada peta
   *  kosong.
   *
   *  Leaflet menjadikan peta sebagai sasaran kejadian HANYA kalau tidak ada lapisan di
   *  bawah kursor (`Map._findEventTargets`: `if (!targets.length) targets = [this]`).
   *  Dengan peta yang tertutup poligon DI dan garis jaringan, sebagian besar klik karena
   *  itu tidak pernah sampai ke peta - dan pembacaan koordinatnya jadi diam di tempat
   *  persis ketika paling dibutuhkan, yaitu saat menunjuk objek tertentu.
   */
  const catatKlik = (lapis) => lapis.on("click", (e) => tulisKoordinat(e.latlng));

  function hapusKoordinat() {
    el.koordinat.hidden = true;
    if (penandaTitik) { penandaTitik.remove(); penandaTitik = null; }
  }

  /** Menyalin tanpa `navigator.clipboard`, karena API itu hanya ada di konteks aman -
   *  dan halaman ini justru dipakai lewat http di alamat jaringan setempat, di mana ia
   *  tidak tersedia sama sekali. Jalur lama dipakai sebagai cadangan, bukan sebaliknya. */
  async function salinTeks(teks) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(teks);
        return true;
      }
    } catch (e) { /* jatuh ke cara di bawah */ }
    const kotak = document.createElement("textarea");
    kotak.value = teks;
    kotak.setAttribute("readonly", "");
    kotak.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(kotak);
    kotak.select();
    let berhasil = false;
    try { berhasil = document.execCommand("copy"); } catch (e) { berhasil = false; }
    kotak.remove();
    return berhasil;
  }

  /* -------------------------------------------------------------------- muat */
  async function muat(lokasiId, rezim) {
    el.sub.textContent = "memuat…";
    const r = await fetch(berkasLokasi(lokasiId, rezim, "json"));
    if (!r.ok) {
      el.sub.textContent = r.status === 404
        ? "data lokasi ini belum diekspor — jalankan: python note/ekspor-peta.py"
        : "gagal memuat: " + r.status;
      return;
    }
    data = await r.json();
    /* Rezim ikut dibawa: KML-nya harus berisi angka rezim yang sedang dilihat,
       bukan rezim bawaan. Berkas beku sudah dipisah per rezim, dan atribut
       download yang menamainya — dulu tugas Content-Disposition dari Flask. */
    el.unduhKml.href = berkasLokasi(lokasiId, rezim, "kml");
    el.unduhKml.setAttribute("download",
      berkasLokasi(lokasiId, rezim, "kml").split("/").pop());
    buangBarisSubjek();      // nama, jumlah, dan skala warnanya ikut berganti
    pasangTanpaPetak(!data.geojson.features.length);
    pasangIstilah();
    gambarPilihMetrik();
    gambarPilihRezim();
    hitungRentang();
    gambarRingkasan();
    gambarLegenda();
    gambarPeta();
    gambarDaftar(data.geojson.features);
    kosongkanDetail();
    rapikanKendali();       // baris subjek sudah bisa ditulis; lapisan menyusul

    /* Bawaan "DI kewenangan Kab. Garut" (di_kab) ditentukan per lokasi, bukan sekali
       untuk semuanya, karena kedudukannya memang berbeda menurut lokasinya:

         - Lokasi yang PUNYA subjek sendiri (DI Kab. Garut: 11 DI terukur; Jaringan
           Leuwigoong: 176 ruas) - di_kab cuma lapisan konteks di baliknya. Dimatikan.
         - Lokasi TANPA subjek (Leuwigoong: 0 fitur) - di_kab satu-satunya yang
           tergambar, dan daftar sampingnya pun diisi darinya lewat gambarDaftarDi().
           Dimatikan di sini berarti peta kosong melompong. Dinyalakan.

       Alasannya bukan cuma kerapian: terukur, di_kab sendiri 78.091 dari 110.323 titik
       yang aktif di DI Kab. Garut, dan menyalakannya membuat biaya reproyeksi vektor
       tiap ganti tingkat zoom naik dari 143 ms jadi 491 ms untuk zoom 20 ke 12 - 71%
       biaya zoom dibayar untuk lapisan yang di lokasi itu cuma latar belakang.

       Kalau pengguna sudah pernah menyentuh kotak centangnya, pilihannya yang dipakai. */
    if (!disentuhDi.has("di_kab")) tampilDi.di_kab = !data.geojson.features.length;

    // Sengaja tidak ditunggu: keduanya menyusul, halaman sudah utuh tanpanya.
    muatBig(lokasiId);
    muatDi(lokasiId);
  }

  function mulai() {
    // Zoom dipindah ke kanan-bawah: bawaannya kiri-atas, tepat menimpa sudut kartu
    // ringkasan. Empat sudut peta jadi terbagi rapi - kartu (kiri-atas), pemilih
    // lapisan (kanan-atas), legenda (kiri-bawah), zoom & kredit citra (kanan-bawah).
    //
    // preferCanvas: seluruh vektor digambar ke <canvas>, bukan jadi <path> SVG satu
    // per satu. Lapisan BIG dan SISDA di lokasi ini berisi puluhan ribu bentuk; sebagai
    // SVG itu berarti puluhan ribu simpul DOM yang harus ditata ulang peramban tiap
    // kali peta digeser, dan geserannya patah-patah. Canvas menggambarnya sekali per
    // bingkai tanpa menyentuh DOM. Yang hilang cuma `className` pada gaya (transisi
    // CSS .petak) - sorot kursor tetap jalan lewat setStyle.
    //
    // wheelDebounceTime/wheelPxPerZoomLevel dinaikkan supaya satu putaran roda tikus
    // jadi SATU langkah zoom, bukan beruntun: tiap langkah memuat satu set ubin baru
    // dan menggambar ulang seluruh vektor.
    //
    // zoomAnimationThreshold DIBIARKAN pada bawaannya (4). Sempat dipasang 3, dan itu
    // salah arah: putaran roda yang cepat menumpuk jadi lompatan >3 tingkat, dan
    // lompatan sebesar itu melewati animasi sama sekali - peta menghilang lalu muncul
    // lagi di zoom baru. Justru itu yang terasa patah.
    peta = L.map("peta", {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      wheelDebounceTime: 60,
      wheelPxPerZoomLevel: 120,
    });
    L.control.zoom({ position: "bottomright" }).addTo(peta);

    // Lapisan BIG dilewatkan panel sendiri di bawah petak (400) dan di atas ubin
    // (200), supaya sawah versi BIG tidak pernah menutupi petak hasil digitasi.
    peta.createPane("big").style.zIndex = 350;
    // Lapisan SISDA terbagi dua panel menurut perannya. Yang berwujud WILAYAH - batas
    // DI, petak baku, sempadan - paling bawah dari semuanya: ia wadah, bukan isi.
    peta.createPane("di").style.zIndex = 330;
    // Yang berwujud GARIS dan TITIK - saluran, bangunan, sungai, mata air - justru di
    // atas petak: kalau di bawah, ia tenggelam di balik isian petak dan lapisan inilah
    // yang paling ditunggu, karena RBI tidak punya satu ruas saluran pun di sini.
    peta.createPane("di-atas").style.zIndex = 450;

    /* Opsi ubin yang sama untuk kedua peta dasar.

       updateWhenZooming:false — Leaflet bawaannya menukar seluruh set ubin di TIAP
       bingkai animasi zoom. Satu kali zoom bisa berarti ratusan permintaan yang
       dibatalkan lagi sedetik kemudian; dimatikan, ubinnya dimuat sekali saat
       zoomnya mendarat.

       updateWhenIdle di ponsel — ubin baru baru diminta setelah jari diangkat, bukan
       selama geseran berjalan.

       keepBuffer TETAP 2 (bawaan Leaflet). Sempat diturunkan ke 1 dengan alasan
       menghemat komposisi bingkai; itu keliru untuk peta ini. Terukur: ubin yang sudah
       tersimpan dilayani 2 ms sebagai berkas statis, tetapi ubin yang BELUM tersimpan
       harus lewat PHP dan mengunduh dari hulu - 640 sampai 1.355 ms. Menyimpan satu
       cincin ubin lebih sedikit berarti lebih sering meminta ulang, dan satu saja yang
       meleset dari simpanan sudah lebih mahal daripada seluruh penghematan komposisi.
       Cincin yang dipertahankan juga yang dipakai Leaflet sebagai alas sementara
       selagi ubin zoom baru berdatangan. */
    /* maxZoom 19, maxNativeZoom 18 untuk KEDUA tema.

       Ambangnya diukur, bukan ditebak. Di tengah D.I. Leuwigoong, pada zoom 19:

         Citra satelit   ketiga ubin contoh berukuran 2.521 bita dan BYTE-IDENTIK
                         satu sama lain - itu ubin "Map data not yet available"
                         milik Esri. Di simpanan, 42 dari 124 ubin z19 (33,9%)
                         adalah berkas yang sama persis itu.
         Rupabumi (BIG)  balasannya 0 bita; hulunya memang tidak punya z19.

       Pada zoom 18 keduanya masih citra sungguhan: satelit 9,7-16,8 kB dengan isi
       berbeda-beda, RBI 2,4-5,9 kB. Dari 14.491 ubin satelit z18 di simpanan, cuma
       1 yang placeholder - dan itu pun di tepi, di luar AOI.

       Jadi langit-langit sebenarnya z18. maxNativeZoom dipatok di situ supaya Leaflet
       TIDAK PERNAH meminta ubin di atasnya - ia memperbesar ubin z18, dan placeholder
       itu tidak akan muncul lagi. maxZoom 19 memberi satu tingkat perbesaran (2x),
       cukup untuk menempatkan sesuatu dengan teliti tanpa jadi kabur; z20 berarti
       perbesaran 4x dari z18, kabur tanpa menambah keterangan apa pun. */
    const opsiUbin = {
      maxZoom: 19, minZoom: 12, maxNativeZoom: 18,
      updateWhenZooming: false,
      updateWhenIdle: L.Browser.mobile,
    };
    const dasar = {
      "Citra satelit": L.tileLayer(`${PETA.tile}/{z}/{x}/{y}.jpg`, {
        ...opsiUbin,
        attribution: "Citra: Esri, Maxar, Earthstar Geographics",
      }),
      "Rupabumi (BIG)": L.tileLayer(`${PETA.tileRbi}/{z}/{x}/{y}.png`, {
        ...opsiUbin,
        attribution: "Peta dasar: Badan Informasi Geospasial, RBI 2019",
      }),
    };
    dasar["Citra satelit"].addTo(peta);

    /* Kendali lapisan dibangun Leaflet seperti biasa, lalu WADAHNYA dipindahkan ke
       dalam laci Pengaturan Peta. Yang dipindah cuma DOM-nya; seluruh isinya - radio
       peta dasar, kotak centang tiap lapisan, hitungan objeknya, judul kelompok dan
       baris subjek yang disisipkan rapikanKendali() - tetap dibangun dan diperbarui
       Leaflet. Menulis ulang daftar itu di dalam laci akan jadi salinan kedua yang
       harus dijaga bersamaan dengan yang asli, dan salinan kedua itu pasti akan
       ketinggalan cepat atau lambat.

       `collapsed: false` supaya Leaflet tidak memasang pengendali lipatnya sama
       sekali: di dalam laci, laci itu sendiri yang buka-tutup. Ikon pelipatnya tetap
       dibuat Leaflet, jadi dibuang setelahnya. */
    kendaliLapisan = L.control.layers(dasar, {}, {
      position: "topright", collapsed: false,
    });
    kendaliLapisan.addTo(peta);

    const ikonPanel = kendaliLapisan._container
      .querySelector(".leaflet-control-layers-toggle");
    if (ikonPanel) ikonPanel.remove();
    /* Dipindah SESUDAH addTo(): `_initLayout` membangun isinya saat itu, dan
       `onAdd` mendaftarkan penangan kejadiannya. Memindahkan wadahnya sesudah itu
       tidak memutus apa pun - penangannya menempel pada unsurnya, bukan pada
       tempatnya di pohon DOM. */
    el.laciLapisan.appendChild(kendaliLapisan._container);

    /* Daftar radio peta dasar dipindah lagi, ke kolom KANAN modal - terpisah dari
       daftar lapisan yang tinggal di kolom kiri. Keduanya anak wadah yang sama pada
       Leaflet, tetapi keduanya jenis pilihan yang berbeda: yang satu memilih citra apa
       yang jadi alas, yang satu memilih objek apa yang digambar di atasnya.

       Aman dipindah: `_update()` Leaflet hanya MENGOSONGKAN isi kedua daftar ini lalu
       mengisinya lagi, tidak pernah menempatkan ulang wadahnya. Jadi di mana pun
       wadahnya berada, isinya tetap diperbarui seperti biasa - dan judul "Jenis peta"
       tidak perlu disisipkan dari sini lagi karena kolomnya sudah berjudul di templat. */
    el.laciDasar.appendChild(kendaliLapisan._baseLayersList);

    /* Tombol "Atur peta" dan "Sembunyikan panel" jadi kendali Leaflet, bukan tombol
       di bilah atas. Dijadikan kendali sungguhan - bukan sekadar unsur ber-position
       absolute di atas peta - karena tiga hal yang diurus Leaflet sendiri di situ:
       penempatannya bertumpuk rapi dengan tombol zoom, `disableClickPropagation`
       menahan klik & seret supaya tidak menggeser peta di baliknya, dan wadah
       sudutnya ikut digeser geserKendaliKanan() saat laci terbuka. */
    const KendaliTombol = L.Control.extend({
      onAdd() {
        const wadah = L.DomUtil.create("div", "tombol-peta__wadah");
        L.DomEvent.disableClickPropagation(wadah);
        L.DomEvent.disableScrollPropagation(wadah);
        return wadah;
      },
    });
    const kendaliTombol = new KendaliTombol({ position: "topright" });
    kendaliTombol.addTo(peta);
    kendaliTombol.getContainer().appendChild(el.bukaAtur);
    el.kendaliSumber.remove();   // pembungkus sementara, sudah kosong
    // Gagang lipat panel TIDAK ikut ke sini - tempatnya di tepi panel samping, bukan
    // di sudut peta. Yang perlu ditahan cuma klik & seretnya supaya tidak menggeser
    // peta di baliknya; itu yang dikerjakan Leaflet untuk kendali, dan di luar kendali
    // harus diminta sendiri.
    L.DomEvent.disableClickPropagation(el.alihSamping);

    // Pilihan lapisan luar diingat supaya tidak perlu dicentang ulang tiap ganti lokasi.
    const catat = (nyala) => (e) => {
      if (memuatLapisan) return;   // dipasang muatDi, bukan dicentang pengguna
      [[lapisanBig, tampilBig], [lapisanDi, tampilDi]].forEach(([lapisan, tampil]) => {
        Object.keys(lapisan).forEach((k) => {
          if (lapisan[k] !== e.layer) return;
          tampil[k] = nyala;
          if (tampil === tampilDi) disentuhDi.add(k);
        });
      });
    };
    peta.on("overlayadd", catat(true));
    peta.on("overlayremove", catat(false));

    // Kendali lapisan Leaflet membangun ULANG seluruh daftarnya tiap kali ada lapisan
    // masuk/keluar peta di luar klik kotak centang - dan pembangunan ulang itu membuang
    // judul kelompok serta baris subjek yang kami sisipkan. Menambalnya di tiap tempat
    // yang menambahkan lapisan akan terlewat cepat atau lambat, jadi pemulihannya
    // digantung di kejadiannya langsung. Kendali sudah terdaftar lebih dulu, jadi
    // `_update()` miliknya selesai sebelum ini berjalan.
    //
    // DITUNDA satu bingkai, dan hanya sekali per bingkai. `layeradd` menyala untuk
    // TIAP anggota lapisan, bukan sekali per lapisan: satu centang pada lapisan SISDA
    // yang berisi 8.000 ruas memanggil ini 8.000 kali, dan tiap panggilan mengurutkan
    // ulang seluruh daftar kendali lalu menyisipkan kembali judul-judulnya. Itu
    // pembekuan berdetik-detik yang seluruhnya terbuang — yang terlihat hanya hasil
    // panggilan terakhir. Digabung jadi satu, hasilnya persis sama.
    let kendaliMenunggu = 0;
    const rapikanNanti = () => {
      if (kendaliMenunggu) return;
      kendaliMenunggu = requestAnimationFrame(() => {
        kendaliMenunggu = 0;
        rapikanKendali();
      });
    };
    peta.on("layeradd layerremove", rapikanNanti);

    // Tampilan awal sebelum data datang; begitu lokasi termuat, gambarPeta() menggeser
    // peta ke kotak petaknya. Titik ini = toponim Kecamatan Leuwigoong.
    peta.setView([-7.1047, 107.9494], 14);

    // Peta berada di dalam grid yang ikut melebar/menyempit. Tanpa ini, Leaflet
    // memakai ukuran lama setelah jendela diubah dan hanya sebagian tile termuat.
    //
    // Digabung per bingkai: menyeret tepi jendela membangkitkan puluhan kejadian per
    // detik, dan tiap invalidateSize() membaca ulang tata letak lalu memuat ubin baru.
    if (window.ResizeObserver) {
      let ukurMenunggu = 0;
      new ResizeObserver(() => {
        if (ukurMenunggu) return;
        ukurMenunggu = requestAnimationFrame(() => {
          ukurMenunggu = 0;
          peta.invalidateSize({ animate: false, pan: false });
        });
      }).observe(document.getElementById("peta"));
    }

    // Klik di mana pun - termasuk di atas poligon, yang popupnya tetap terbuka seperti
    // biasa. Satu klik menjawab dua hal sekaligus: objek apa ini, dan di koordinat mana.
    peta.on("click", (e) => tulisKoordinat(e.latlng));
    el.koordinatTutup.addEventListener("click", hapusKoordinat);

    // Kartu ringkas: disembunyikan, dan tombol pil menggantikan tempatnya.
    const tampilkanRingkas = (tampil) => {
      el.kartuRingkas.hidden = !tampil;
      el.ringkasBuka.hidden = tampil;
    };
    el.ringkasTutup.addEventListener("click", () => tampilkanRingkas(false));
    el.ringkasBuka.addEventListener("click", () => tampilkanRingkas(true));
    el.detailTutup.addEventListener("click", kembaliKeDaftar);

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      // Urutannya dari yang paling atas ke yang paling bawah di layar, dan dari yang
      // paling baru dibuat ke yang paling lama:
      //   1. Laci pengaturan - kalau ia terbuka, Esc hampir pasti untuk menutupnya.
      //   2. Penanda koordinat - dibuat oleh klik terakhir di peta, jadi biasanya hal
      //      terbaru yang ada di layar.
      //   3. Muka detail panel samping - dibuka lebih dulu daripada penanda itu.
      if (laciTerbuka()) { batalkanTertunda(); bukaLaci(false); return; }
      if (!el.koordinat.hidden) { hapusKoordinat(); return; }
      if (el.samping.classList.contains("samping--detail")) { kembaliKeDaftar(); return; }
      hapusKoordinat();
    });
    el.koordinatSalin.addEventListener("click", async () => {
      const semula = el.koordinatSalin.textContent;
      const berhasil = await salinTeks(el.koordinatNilai.textContent);
      // Hasilnya dilaporkan apa adanya: penyalinan bisa gagal diam-diam di peramban
      // tertentu, dan "Tersalin" yang bohong lebih buruk daripada tidak ada tombolnya.
      el.koordinatSalin.textContent = berhasil ? "Tersalin" : "Gagal — salin manual";
      setTimeout(() => { el.koordinatSalin.textContent = semula; }, 1600);
    });

    /* ---- modal Pengaturan Peta ---- */
    const laciTerbuka = () => el.laci.classList.contains("modal--tampil");
    const sampingTampil = () => !el.samping.classList.contains("samping--sembunyi");

    /** Menggeser kendali sudut KANAN peta - zoom, kredit citra, dan kedua tombol -
     *  ke kiri sejauh panel terlebar yang sedang menutupi tepi kanan.
     *
     *  Yang diperhitungkan hanya panel samping. Modal Pengaturan Peta tidak ikut:
     *  ia di TENGAH kartu dan menutupi petanya dengan tirai, jadi tidak ada gunanya
     *  menggeser kendali yang toh sedang tidak bisa disentuh.
     *
     *  Peta sendiri TIDAK dikecilkan. Panel samping melayang di atasnya, jadi ukuran
     *  petanya tidak pernah berubah: tidak ada pengukuran ulang, tidak ada ubin baru
     *  yang diminta, tidak ada kanvas vektor yang digambar ulang. Itu yang membuat
     *  buka-tutupnya halus - yang bergerak cuma transform.
     *
     *  Digeser dengan `transform`, BUKAN `right`. Menggeser lewat `right` sudah
     *  dicoba dan tidak bekerja sama sekali pada wadah sudut Leaflet - terukur, gaya
     *  sebaris "300px" ber-!important sekalipun menghasilkan nilai terhitung 0px dan
     *  unsurnya tidak bergerak sepiksel pun. `transform` selalu berlaku, dan sekalian
     *  bisa ditransisikan supaya kendalinya bergeser seiring panelnya.
     *
     *  Kalau panelnya selebar petanya sendiri - layar sempit, panel melebar penuh -
     *  kendalinya tidak digeser: menggesernya sejauh itu justru mendorongnya keluar.
     */
    const geserKendaliKanan = () => {
      const lebarPeta = peta.getSize().x;
      let geser = 0;
      if (sampingTampil()) geser = el.samping.offsetWidth + 12;
      if (geser >= lebarPeta) geser = 0;
      peta.getContainer()
        .querySelectorAll('.leaflet-top.leaflet-right, .leaflet-bottom.leaflet-right')
        .forEach((n) => { n.style.transform = geser ? `translateX(${-geser}px)` : ""; });
    };

    const bukaLaci = (buka) => {
      el.laci.classList.toggle("modal--tampil", buka);
      el.bukaAtur.setAttribute("aria-expanded", String(buka));
      el.bukaAtur.classList.toggle("tombol-peta--aktif", buka);
      // Fokus dipindahkan masuk supaya papan ketik tidak tertinggal di belakang modal,
      // dan dikembalikan ke tombolnya saat ditutup - kalau tidak, fokus jatuh ke <body>
      // dan Tab berikutnya mulai lagi dari awal halaman.
      if (buka) el.lokasi.focus({ preventScroll: true });
      else el.bukaAtur.focus({ preventScroll: true });
    };

    /* Membatalkan pilihan yang belum diterapkan. Menutup laci tanpa menekan Terapkan
       berarti "tidak jadi", jadi pemilihnya dikembalikan ke muatan yang sedang tampil -
       kalau tidak, laci yang dibuka lagi akan memperlihatkan lokasi yang sebenarnya
       tidak sedang dilihat. */
    const batalkanTertunda = () => {
      if (!aturTertunda || !data) return;
      aturTertunda = null;
      el.lokasi.value = data.lokasi.id;
      gambarPilihRezim();
      tandaiTertunda();
    };

    const tandaiTertunda = () => {
      el.terapkanAtur.disabled = !aturTertunda;
      el.aturTertunda.hidden = !aturTertunda;
    };

    const tandaiPerluTerap = () => {
      aturTertunda = { lokasi: el.lokasi.value, rezim: el.rezim.value || null };
      tandaiTertunda();
    };

    el.bukaAtur.addEventListener("click", () => bukaLaci(!laciTerbuka()));

    /* ---- lipat panel daftar & detail ----
       Panel itu melayang DI ATAS peta, bukan kolom di sebelahnya, jadi petanya sudah
       selebar kartunya sejak awal - terbuka atau tertutup panelnya. Yang bergerak cuma
       satu transform: tidak ada pengukuran ulang peta, tidak ada ubin baru yang
       diminta, tidak ada kanvas vektor yang digambar ulang.

       Dipakai `hidden`? Tidak - `display: none` tidak bisa dianimasikan, dan panel
       akan berkedip hilang alih-alih menggeser keluar. Kelas + transform, dengan
       `visibility` yang melompat di akhir transisi supaya panel yang sudah keluar
       layar tidak bisa disorot kursor maupun dijangkau Tab.

       Tidak dibuka sendiri saat satu objek diklik: pengguna yang menyembunyikannya
       sedang ingin melihat petanya, dan panel yang menyembul kembali tiap kali peta
       disentuh akan melawan maksud itu. Popup di peta tetap menjawab "ini objek apa". */
    const alihSamping = (tampil) => {
      el.samping.classList.toggle("samping--sembunyi", !tampil);
      el.alihSamping.setAttribute("aria-expanded", String(tampil));
      el.alihSamping.title = tampil
        ? "Sembunyikan panel daftar & detail"
        : "Tampilkan panel daftar & detail";
      el.alihSamping.classList.toggle("samping-gagang--tertutup", !tampil);
      const label = el.alihSamping.querySelector(".tombol-peta__label");
      if (label) label.textContent = tampil ? "Sembunyikan panel" : "Tampilkan panel";
      geserKendaliKanan();
    };
    el.alihSamping.addEventListener("click", () => alihSamping(!sampingTampil()));
    // Kendali sudut kanan disesuaikan sekali di awal: panel samping sudah tampil sejak
    // halaman dibuka, jadi tanpa ini tombol zoom lahir tepat di baliknya.
    geserKendaliKanan();
    el.tutupAtur.addEventListener("click", () => { batalkanTertunda(); bukaLaci(false); });
    // Menekan tirainya menutup modal - perangai yang sudah jadi kebiasaan, dan satu-
    // satunya cara menutup yang tidak menuntut membidik tombol × sebesar 20 px.
    el.aturTirai.addEventListener("click", () => { batalkanTertunda(); bukaLaci(false); });
    el.terapkanAtur.addEventListener("click", () => {
      if (!aturTertunda) return;
      const { lokasi, rezim } = aturTertunda;
      aturTertunda = null;
      tandaiTertunda();
      /* Modalnya DITUTUP. Waktu bentuknya masih laci, ia sengaja dibiarkan terbuka -
         peta di sebelahnya tetap terlihat, dan yang dikerjakan berikutnya hampir
         selalu memilih lapisan untuk lokasi baru itu. Sebagai modal alasannya
         terbalik: ia menutupi petanya, jadi membiarkannya terbuka berarti menahan
         pengguna dari satu-satunya hal yang ingin dilihatnya sesudah menekan
         Terapkan - hasilnya. */
      bukaLaci(false);
      muat(lokasi, rezim);
    });

    /* Lokasi mengosongkan rezim: daftar rezim milik lokasi lama tidak berlaku untuk
       lokasi baru, dan mengirimkan rezim lama akan meminta berkas yang tidak ada. */
    el.lokasi.addEventListener("change", () => {
      el.rezim.value = "";
      tandaiPerluTerap();
    });
    el.rezim.addEventListener("change", tandaiPerluTerap);

    el.metrik.addEventListener("change", () => {
      metrikAktif = data.metrik.find((m) => m.kunci === el.metrik.value) || null;
      hitungRentang();
      gambarLegenda();
      if (lapisanPetak) lapisanPetak.setStyle((f) => gayaSubjek(f, "biasa"));
      if (terpilih && lapisanDari[terpilih])
        lapisanDari[terpilih].setStyle(
          gayaSubjek(lapisanDari[terpilih].feature, "pilih"));
      gambarDaftar(data.geojson.features);
      if (terpilih) [...el.daftar.children].forEach((li) =>
        li.classList.toggle("aktif", li.dataset.id === terpilih));
      perbaruiRingkasAtur();
    });

    muat(el.lokasi.value, null);
  }

  /* Tab Peta Lokasi ikut dimuat bersama seluruh tab lain lalu disembunyikan
     dengan display:none. Kalau L.map() dijalankan saat itu, kontainernya masih
     0 x 0 piksel dan fitBounds akan memilih zoom yang salah — persis masalah
     yang sudah ditangani resizeCharts() untuk Chart.js pada tab Tren Data.
     Jadi peta baru dibangun saat tabnya benar-benar tampil, dan hanya sekali.
     activateView() di simhidro.js yang memanggilnya. */
  let sudahMulai = false;
  window.petaMulai = function petaMulai() {
    if (sudahMulai) return;
    if (!document.getElementById("peta")) return;   // tab tidak ada di halaman ini
    sudahMulai = true;
    mulai();
  };
})();
