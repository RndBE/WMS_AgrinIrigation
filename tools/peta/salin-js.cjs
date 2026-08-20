/* web-app/static/js/app.js  ->  public/js/peta.js
 *
 * Jalankan dari akar repo:  node tools/peta/salin-js.cjs
 *
 * Tiga perubahan, sisanya apa adanya:
 *
 *  1. Alamat data tidak lagi ditulis mutlak di dalam berkas. Semuanya lewat
 *     window.PETA yang disuntik Blade, jadi slug rute cukup diubah di Laravel —
 *     pola yang sama dengan window.WMS_VIEW pada simhidro.js.
 *  2. Endpoint Flask diganti berkas beku hasil note/ekspor-peta.py. Penerus ubin
 *     tetap rute Laravel karena memang perlu mengunduh & menyimpan cache.
 *  3. Peta tidak lagi lahir di DOMContentLoaded. Panel tab Peta Lokasi masih
 *     display:none saat itu, sehingga Leaflet akan menghitung ukuran 0 dan
 *     fitBounds-nya salah zoom. Diganti window.petaMulai() yang idempoten,
 *     dipanggil activateView() di simhidro.js saat tabnya pertama kali dibuka.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..', '..');
const SUMBER = path.join(AKAR, 'web-app', 'static', 'js', 'app.js');
const TUJUAN = path.join(AKAR, 'public', 'js', 'peta.js');

let js = fs.readFileSync(SUMBER, 'utf8').split('\r\n').join('\n');
const asli = js.length;

const ganti = [];
const add = (nama, dari, ke) => ganti.push([nama, dari, ke]);

/* ---- 1 & 2. alamat data ---- */

add('kepala + tabel alamat', `(() => {
  "use strict";
`,
`(() => {
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
     memakai \`rezim or "FL"\` sebagai bawaan. Kosong = lokasi tanpa rezim. */
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
    return \`\${PETA.data}/lokasi-\${lokasiId}\${r ? "-" + r : ""}.\${akhiran}\`;
  };
`);

add('fetch big', 'const r = await fetch(`/api/big/${lokasiId}`);',
  'const r = await fetch(`${PETA.data}/big-${lokasiId}.json`);');

add('fetch di', 'const r = await fetch(`/api/di/${lokasiId}`);',
  'const r = await fetch(`${PETA.data}/di-${lokasiId}.json`);');

add('fetch lokasi + unduh kml', `    el.sub.textContent = "memuat…";
    const q = rezim ? \`?rezim=\${encodeURIComponent(rezim)}\` : "";
    const r = await fetch(\`/api/lokasi/\${lokasiId}\${q}\`);
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      el.sub.textContent = "gagal memuat: " + (e.galat || r.status);
      return;
    }
    data = await r.json();
    // Rezim ikut dibawa: KML-nya harus berisi angka rezim yang sedang dilihat, bukan
    // rezim bawaan. Server yang menamai berkasnya lewat Content-Disposition.
    el.unduhKml.href = \`/api/lokasi/\${lokasiId}.kml\${q}\`;`,
`    el.sub.textContent = "memuat…";
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
      berkasLokasi(lokasiId, rezim, "kml").split("/").pop());`);

add('tile satelit', 'L.tileLayer("/api/tile/{z}/{x}/{y}.jpg", {',
  'L.tileLayer(`${PETA.tile}/{z}/{x}/{y}.jpg`, {');

add('tile rbi', 'L.tileLayer("/api/tile-rbi/{z}/{x}/{y}.png", {',
  'L.tileLayer(`${PETA.tileRbi}/{z}/{x}/{y}.png`, {');

/* ---- 3. mulai secara malas & idempoten ---- */

add('mulai malas', `  document.addEventListener("DOMContentLoaded", mulai);
})();`,
`  /* Tab Peta Lokasi ikut dimuat bersama seluruh tab lain lalu disembunyikan
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
})();`);

for (const [nama, dari, ke] of ganti) {
  const bagian = js.split(dari);
  if (bagian.length !== 2) {
    console.error(`GAGAL [${nama}] cocok ${bagian.length - 1}x`);
    process.exit(1);
  }
  js = bagian[0] + ke + bagian[1];
}

const kop = `/* Peta Lokasi — DIHASILKAN dari web-app/static/js/app.js.
   JANGAN SUNTING BERKAS INI. Sunting sumbernya, lalu jalankan:
       node tools/peta/salin-js.cjs
   Yang diubah hanya tiga hal: alamat data lewat window.PETA, endpoint Flask jadi
   berkas beku note/ekspor-peta.py, dan awal jalan ditunda ke window.petaMulai()
   supaya Leaflet tidak lahir di kontainer berukuran nol. */
`;

fs.writeFileSync(TUJUAN, kop + js);
console.log('public/js/peta.js ditulis:', kop.length + js.length, 'bita (asli', asli + '),', ganti.length, 'perubahan');
