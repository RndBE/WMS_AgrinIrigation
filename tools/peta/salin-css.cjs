/* web-app/static/css/app.css  ->  public/css/peta.css
 *
 * Jalankan dari akar repo:  node tools/peta/salin-css.cjs
 *
 * Sumbernya tetap berkas Flask supaya tidak ada dua salinan yang harus disunting
 * bergantian. Yang diubah di sini hanya empat selector global di kepala berkas,
 * ditambah satu penetral aturan tombol wms.css. Sisanya — 106 nama kelas — sudah
 * bergaya BEM (kartu-peta, stat__label, koordinat__salin) dan sudah diperiksa
 * tidak ada satu pun yang sama dengan nama kelas di public/css/wms.css maupun
 * dengan nama variabel :root-nya.
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.resolve(__dirname, '..', '..');
const SUMBER = path.join(AKAR, 'web-app', 'static', 'css', 'app.css');
const TUJUAN = path.join(AKAR, 'public', 'css', 'peta.css');

let css = fs.readFileSync(SUMBER, 'utf8').split('\r\n').join('\n');
const asli = css.length;

const ganti = [
  /* :root -> #view-peta. Custom property diwarisi ke bawah, jadi seluruh isi tab
     tetap mendapatkannya; memindahkannya ke sini membuat tab lain sama sekali
     tak tersentuh. */
  ['\n:root {\n', '\n#view-peta {\n'],

  // `*` untuk seluruh dokumen akan menimpa box-sizing halaman lain.
  ['\n* { box-sizing: border-box; }\n',
    '\n#view-peta *, #view-peta *::before, #view-peta *::after { box-sizing: border-box; }\n'],

  /* [hidden] tetap perlu !important (alasannya ada di komentar app.css) tapi cukup
     berlaku di dalam tab ini. Sekalian disisipkan penetral aturan tombol. */
  ['\n[hidden] { display: none !important; }\n',
`\n#view-peta [hidden] { display: none !important; }

/* Penetral aturan tombol wms.css.
   wms.css memasang \`button {}\` telanjang untuk seluruh halaman — font, tebal
   huruf, padding, border-radius, display:inline-flex. Berkas asal app.css tidak
   punya aturan itu sama sekali, jadi tombolnya dulu memakai bawaan peramban.
   Kelas peta.css sudah menyetel border, latar, dan padding sendiri, tetapi yang
   tidak disetel ulang tetap bocor: tombol × di kartu jadi tebal dan berfont
   halaman, bukan font tab ini.

   :where() dipakai supaya kekhususan aturan ini tetap 0,0,1 — sama dengan
   \`button {}\` di wms.css. peta.css dimuat SETELAH wms.css, jadi aturan ini
   menang pada seri, sementara setiap kelas peta.css di bawahnya (0,1,0) tetap
   menang melawan aturan ini. Menulisnya sebagai \`#view-peta button\` akan
   berkekhususan 1,0,1 dan justru mengalahkan kelasnya sendiri — display:flex
   pada .kartu-buka akan mati. */
:where(#view-peta) button {
  font: inherit;
  font-weight: normal;
  display: inline-block;
  align-items: normal;
  gap: normal;
  border-radius: 0;
  transition: none;
}
`],

  /* html, body -> wadah tab, TIPOGRAFI SAJA.
     Tinggi, display, dan tata letaknya sengaja TIDAK disetel di sini:
       - display dibiarkan milik .view / .view.active di wms.css, jadi penukaran
         tab bekerja tanpa aturan tambahan. Menyetelnya di sini berkekhususan
         1,0,0 dan akan mengalahkan keduanya, sehingga keadaan tersembunyi harus
         ditegaskan ulang — persoalan yang tidak perlu diciptakan;
       - tinggi kontainer Leaflet dan tata letak dua kolomnya diurus
         public/css/peta-selaras.css, supaya angka tata letak tidak bercampur
         dengan salinan gaya Beacon di berkas ini. */
  [`\nhtml, body {
  height: 100%;
  margin: 0;
  background: var(--kertas);
  color: var(--tinta);
  font: 14px/1.5 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}

body { display: flex; flex-direction: column; }
`,
`#view-peta {
  margin: 0;
  background: var(--kertas);
  color: var(--tinta);
  font: 14px/1.5 "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
`],
];

for (const [dari, ke] of ganti) {
  const bagian = css.split(dari);
  if (bagian.length !== 2) {
    console.error('GAGAL cocok (' + (bagian.length - 1) + 'x): '
      + JSON.stringify(dari.slice(0, 60)));
    process.exit(1);
  }
  css = bagian[0] + ke + bagian[1];
}

/* Penormal sudut.
   app.css memakai 25 nilai border-radius yang ditulis langsung, 2px sampai 99px,
   sementara dasbor WMS memakai satu --radius: 4px untuk semuanya. Nilai-nilai itu
   tidak lewat variabel, jadi tidak bisa ditimpa dari peta-selaras.css seperti
   warna — harus diseragamkan di sini.

   Ambangnya 5-14px: itu rentang sudut KOTAK (kartu, panel, tombol besar), yang
   memang harus mengikuti dasbor. Di luar rentang itu dibiarkan apa adanya karena
   bentuknya disengaja, bukan selera:
       99px   pil — tombol "Ringkasan", lencana
       50%    titik bulat
       0-4px  sudah setajam dasbor
       nilai bersisi banyak seperti `0 8px 8px 0`, hanya satu sisi dibulatkan
   Hasilnya diarahkan ke var(--lengkung), yang disetel 4px di peta-selaras.css —
   jadi satu angka itu tetap satu-satunya tempat menyetel ketajaman sudut. */
let sudut = 0;
css = css.replace(/border-radius:\s*(\d+)px(\s*!important)?;/g, (utuh, angka, penting) => {
  const n = parseInt(angka, 10);

  if (n < 5 || n > 14) {
    return utuh;
  }

  sudut++;

  return 'border-radius: var(--lengkung)' + (penting || '') + ';';
});

const kop = `/* Peta Lokasi — DIHASILKAN dari web-app/static/css/app.css.
   JANGAN SUNTING BERKAS INI. Sunting sumbernya, lalu jalankan:
       node tools/peta/salin-css.cjs
   Yang diubah: empat selector global di kepala berkas (:root, *, [hidden],
   html/body), satu penetral aturan tombol wms.css, dan penyeragaman nilai
   border-radius 5-14px ke var(--lengkung). Sisanya apa adanya.
   Warna, sudut, dan tata letaknya diselaraskan ke dasbor lewat
   public/css/peta-selaras.css yang dimuat setelah berkas ini. */
`;

fs.writeFileSync(TUJUAN, kop + css);
console.log('public/css/peta.css ditulis:', kop.length + css.length,
  'bita (asli', asli + '),', sudut, 'sudut dinormalkan');
