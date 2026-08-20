{{--
  Peta Lokasi — dipindahkan dari web-app/templates/index.html (aplikasi Flask
  "Beacon SWH"). Yang berubah dari sumbernya hanya empat hal:

    1. <head>, <body>, dan bilah atasnya sendiri dibuang — kop instansi, bilah
       nav, dan judul halaman sudah disediakan layouts/wms.blade.php.
    2. {% for l in lokasi %} Jinja jadi @foreach Blade.
    3. Alamat aset mutlak (/static/..., /logo_beacon.png) jadi asset().
    4. Seluruh isinya dibungkus .view#view-peta mengikuti pola partial lain,
       supaya ditukar oleh activateView() di simhidro.js.

  Struktur di dalamnya, nama kelas, dan setiap id dibiarkan persis sama karena
  public/js/peta.js membacanya lewat id — mengubah satu id berarti memutus
  peta.js. Lihat catatan di kepala berkas itu.
--}}
<div class="view {{ $activeView === 'peta' ? 'active' : '' }}" id="view-peta">

  {{-- Bilah kendali: pemilih lokasi, rezim, pewarnaan, dan tombol ekspor KML.
       Ini bilah milik peta, bukan bilah nav halaman. --}}
  <header class="bar">
    <img class="bar__logo" src="{{ asset('logo_beacon.png') }}" alt="Beacon">
    <div class="bar__judul">
      <h1>Peta Sawah &amp; Pengairan</h1>
      <p id="bar-sub">memuat…</p>
    </div>
    {{-- Lokasi, rezim, dan warna peta pindah ke laci Pengaturan Peta di dalam peta.
         Yang tinggal di sini cuma pembacaan keadaan sekarang — supaya "sedang
         melihat apa" tetap terbaca tanpa membuka apa pun — dan Unduh KML, yang
         aksinya menghasilkan berkas, bukan mengatur tampilan. --}}
    <div class="bar__kendali">
      <output class="ringkas-atur" id="atur-ringkas">—</output>
      <a class="unduh" id="unduh-kml" href="#"
         title="Unduh sebagai KML untuk dibuka di Google Earth atau QGIS">Unduh KML</a>
    </div>
  </header>

  <main class="isi">

    {{-- ============ kolom 8: peta ============ --}}
    <section class="peta-kotak">
      <div id="peta"></div>

      {{-- Tombol sudut kanan-atas peta. Ditulis di sini, bukan dibangun dari JS,
           supaya teks, title, dan atribut ARIA-nya tetap terbaca di templat.
           mulai() yang memindahkannya ke dalam wadah kendali Leaflet — dari sana ia
           ikut ditata Leaflet bersama tombol zoom, dan ikut bergeser saat laci
           terbuka. Pembungkusnya disembunyikan supaya tidak sempat terlihat di
           tempat asalnya. --}}
      <div id="kendali-peta-sumber" hidden>
        <button type="button" class="tombol-peta" id="buka-atur"
                aria-controls="laci-atur" aria-expanded="false"
                title="Atur lokasi, rezim, warna peta, dan lapisan">
          <span class="tombol-peta__ikon tombol-peta__ikon--atur" aria-hidden="true"></span>
          <span>Atur peta</span>
        </button>
      </div>

      {{-- Kartu ringkas dan panel samping sama-sama MULAI TERSEMBUNYI. Keduanya
           menutupi peta - kartu ringkas di sudut kiri-atas, panel di tepi kanan - dan
           saat halaman baru dibuka yang dicari lebih dulu hampir selalu petanya sendiri:
           di mana letaknya, seberapa luas sebarannya. Angkanya menyusul setelah itu.

           Keduanya sekali klik: kartu ringkas lewat pil "Ringkasan" yang menempati
           tempatnya, panel lewat gagang di tepi kanan peta. Keadaan awal ini dipasang
           di MARKUP, bukan lewat JS sesudah muat, supaya panelnya tidak sempat
           tergambar lalu menggeser keluar - berkedip sekali tiap kali halaman dibuka. --}}
      {{-- card ringkasan yang menempel di dalam peta --}}
      <div class="kartu-peta" id="kartu-ringkas" hidden>
        <div class="kartu-peta__kepala">
          <span class="titik"></span>
          <span id="ringkas-nama">—</span>
          <button type="button" class="kartu-peta__tutup" id="ringkas-tutup"
                  title="Sembunyikan kartu ringkasan"
                  aria-label="Sembunyikan kartu ringkasan">×</button>
        </div>
        <div class="statistik">
          <div class="stat" id="stat-kotak-luas">
            <span class="stat__label" id="stat-luas-label">Luas</span>
            <span class="stat__nilai" id="stat-luas">—</span>
            <span class="stat__satuan">ha</span>
          </div>
          <div class="stat stat--air">
            <span class="stat__label">Kebutuhan air</span>
            <span class="stat__nilai" id="stat-air">—</span>
            <span class="stat__satuan" id="stat-air-satuan">m³</span>
          </div>
          <div class="stat stat--loss">
            <span class="stat__label">Water loss</span>
            <span class="stat__nilai" id="stat-loss">—</span>
            <span class="stat__satuan" id="stat-loss-satuan">m³</span>
          </div>
        </div>

        {{-- Waktu tempuh ke ujung jaringan. Ketiganya ditulis berdampingan dengan
             sengaja: selisih air lawan respons sampai 1,4x, dan jadwal pintu yang
             disusun memakai waktu AIR akan selalu terlambat sebesar selisih itu. --}}
        <div class="waktu" id="waktu-tempuh" hidden>
          <div class="waktu__kepala">
            <span>Waktu ke ujung jaringan</span>
            <b id="waktu-ujung"></b>
          </div>
          <ul class="waktu__nilai" id="waktu-nilai"></ul>
          <p class="waktu__catatan" id="waktu-catatan"></p>
        </div>

        {{-- persen water loss: susunan tiga jalan keluar + nisbah terhadap air masuk --}}
        <div class="persen" id="persen-loss" hidden>
          <div class="persen__kepala">
            <span>Ke mana air pergi</span>
            <b id="persen-masuk"></b>
          </div>
          <div class="bilah" id="bilah-ringkas"></div>
          <ul class="kunci kunci--rapat" id="kunci-ringkas"></ul>
        </div>

        <p class="kartu-peta__catatan" id="ringkas-catatan"></p>

        {{-- Peringatan cakupan: angka air tidak mencakup semua objek yang digambar.
             Dibedakan dari catatan di atas karena wataknya beda - yang di atas
             menerangkan angkanya, yang ini memperingatkan cara membacanya. --}}
        <p class="kartu-peta__cakupan" id="ringkas-cakupan" hidden></p>
      </div>

      {{-- Pengganti kartu ringkas saat ia disembunyikan. Bukan tombol tanpa nama: kalau
           isinya cuma ikon, satu-satunya cara tahu apa yang akan muncul adalah menekannya. --}}
      <button type="button" class="kartu-buka" id="ringkas-buka"
              title="Tampilkan kembali kartu ringkasan">
        <span class="titik"></span><span id="buka-nama">Ringkasan</span>
      </button>

      {{-- sudut kiri-bawah: koordinat titik yang diklik, lalu skala warna di bawahnya --}}
      <div class="sudut-kiri-bawah">
        <div class="koordinat" id="koordinat" hidden>
          <div class="koordinat__kepala">
            <span>Titik yang diklik</span>
            <button type="button" class="koordinat__tutup" id="koordinat-tutup"
                    title="Hapus penanda (Esc)" aria-label="Hapus penanda">×</button>
          </div>
          <output class="koordinat__nilai" id="koordinat-nilai">—</output>
          <div class="koordinat__kaki">
            <span class="koordinat__dms" id="koordinat-dms">—</span>
            <button type="button" class="koordinat__salin" id="koordinat-salin">Salin</button>
          </div>
          <span class="koordinat__ket">Lintang, Bujur · WGS 84 (EPSG:4326)</span>
        </div>

        {{-- skala warna --}}
        <div class="legenda" id="legenda" hidden>
          <span class="legenda__judul" id="legenda-judul">—</span>
          <div class="legenda__pita" id="legenda-pita"></div>
          <div class="legenda__batas">
            <span id="legenda-min">—</span><span id="legenda-maks">—</span>
          </div>
        </div>
      </div>

      {{-- ============ modal Pengaturan Peta ============
         Jendela di tengah kartu peta dengan tirai gelap di belakangnya. Isinya dua
         kolom seperti contoh rujukannya: filter lapisan di kiri, dan yang menentukan
         data apa yang dilihat (lokasi, rezim, warna peta, peta dasar) di kanan.

         Lokasi dan rezim ditahan tombol Terapkan karena keduanya mengunduh muatan
         baru 0,5-2,3 MB; mengganti keduanya berarti satu kali muat, bukan dua. Warna
         peta dan saklar lapisan berlaku seketika - keduanya cuma menggambar ulang apa
         yang sudah ada di memori, dan hasilnya langsung terlihat begitu modal ditutup.

         Ditaruh DI DALAM .peta-kotak, bukan di akar halaman: tirainya jadi menggelapkan
         tepat petanya saja, dan modalnya tidak perlu berebut susunan lapisan dengan
         kop instansi maupun bilah nav di atasnya. --}}
      <div class="modal" id="laci-atur" role="dialog" aria-modal="true"
           aria-labelledby="atur-judul">
        <div class="modal__tirai" id="atur-tirai"></div>
        <div class="modal__kotak">
          <div class="modal__kepala">
            <h2 id="atur-judul">Pengaturan Peta</h2>
            <button type="button" class="modal__tutup" id="tutup-atur"
                    title="Tutup pengaturan (Esc)" aria-label="Tutup pengaturan">×</button>
          </div>

        <div class="modal__isi">
          <!-- Kolom kiri: filter lapisan. Yang paling panjang, jadi diberi kolom lebih
               lebar dan gulirannya sendiri. -->
          <div class="modal__kolom modal__kolom--utama">
            <h3 class="laci__judul">Filter peta</h3>
            <!-- Daftar lapisan Leaflet dipindahkan ke sini oleh mulai(): isinya (subjek,
                 lapisan SISDA & BIG beserta hitungannya, judul kelompok) dibangun
                 Leaflet, jadi menulis ulang daftarnya di sini akan jadi salinan kedua
                 yang harus dijaga bersamaan. Wadahnya saja yang pindah. -->
            <div id="laci-lapisan"></div>
          </div>
  
          <!-- Kolom kanan: yang menentukan DATA apa yang dilihat, bukan lapisan mana
               yang digambar di atasnya. -->
          <div class="modal__kolom">
            <section class="laci__grup">
              <h3 class="laci__judul">Lokasi &amp; rezim</h3>
              <label class="pilih">
                <span>Lokasi</span>
                {{--
                  data-rezim = rezim bawaan lokasi itu. Perlu karena nama berkas beku
                  memuat rezimnya (lokasi-di-garut-FL.json, bukan lokasi-di-garut.json),
                  sementara muatan pertama terjadi sebelum peta.js tahu rezim apa saja
                  yang tersedia — daftar itu justru datang dari muatan pertama tersebut.
                  Kosong berarti lokasi tanpa rezim.
                --}}
                <select id="pilih-lokasi">
                  @foreach ($petaLokasi as $l)
                    <option value="{{ $l['id'] }}"
                            data-rezim="{{ $l['rezim_tersedia'][0] ?? '' }}">{{ $l['nama'] }}</option>
                  @endforeach
                </select>
              </label>
              <label class="pilih" id="wadah-rezim" hidden>
                <span>Rezim</span>
                <select id="pilih-rezim"></select>
              </label>
              <p class="laci__catatan" id="atur-tertunda" hidden>
                Menunggu <b>Terapkan</b> — memuat ulang data lokasi ini.
              </p>
            </section>
  
            <section class="laci__grup" id="wadah-metrik">
              <h3 class="laci__judul">Warna peta</h3>
              <label class="pilih">
                <span>Besaran yang diwarnai</span>
                <select id="pilih-metrik"></select>
              </label>
            </section>
  
            <section class="laci__grup">
              <h3 class="laci__judul">Jenis peta</h3>
              <!-- Daftar radio peta dasar milik Leaflet dipindah ke sini, terpisah dari
                   daftar lapisan di kolom kiri. Keduanya anak wadah yang sama pada
                   Leaflet; yang dipindah hanya kedua daftarnya, bukan isinya. -->
              <div id="laci-dasar"></div>
            </section>
          </div>
        </div>

          <div class="modal__kaki">
            <button type="button" class="laci__terap" id="terapkan-atur" disabled>Terapkan</button>
          </div>
        </div>
      </div>
          {{-- Gagang lipat panel: menempel di tepi KIRI panel samping, di tengah tegaknya.
           Bukan tombol di sudut peta seperti dulu - gagang di tepi panelnya sendiri
           menerangkan apa yang akan bergerak tanpa perlu label, dan ikut menggeser
           bersama panelnya sehingga tetap terjangkau saat panelnya sudah keluar layar. --}}
      <button type="button" class="samping-gagang samping-gagang--tertutup" id="alih-samping"
              aria-controls="samping-peta" aria-expanded="false"
              title="Tampilkan panel daftar &amp; detail">
        <span class="tombol-peta__label">Tampilkan panel</span>
      </button>

  {{-- ============ kolom 2: daftar & detail ============
           SATU panel bermuka dua: daftar objek, atau detail satu objek — tidak
           pernah keduanya sekaligus. Muka mana yang tampil diatur kelas
           .samping--detail pada <aside> ini (sampingMuka() di peta.js); yang
           menggambar keduanya cuma CSS, jadi tidak ada elemen yang dibangun ulang
           saat berpindah muka.

           Dulu keduanya bertumpuk 52:48 di kolom yang sama. Masalahnya kartu
           detail terisi setinggi 1.697 px untuk satu DI dan 2.091 px untuk satu
           ruas, di kolom setinggi 730 px: apa pun pembagiannya, dua-duanya
           terpotong. Dengan bergantian, masing-masing dapat tinggi kolom penuh —
           daftar memuat 5-6 baris utuh, detail tidak perlu digulir sejauh
           setengahnya. Jalan pulangnya tombol × di kepala kartu detail. --}}
      <aside class="samping samping--sembunyi" id="samping-peta">
        <div class="kartu kartu--kecil" id="kartu-daftar">
          <h2 id="judul-daftar">Daftar <span class="objek">petak</span></h2>
          <ul class="daftar" id="daftar-petak"></ul>
        </div>
  
        <div class="kartu" id="kartu-detail">
          <div class="kartu__kepala">
            <h2 id="detail-judul">Detail petak</h2>
            <span class="lencana" id="detail-lencana" hidden></span>
            {{-- Kembali ke daftar. Panel samping sekarang SATU panel bermuka dua —
                 daftar atau detail, tidak pernah keduanya sekaligus (lihat
                 sampingMuka() di peta.js) — jadi kartu detail perlu jalan keluarnya
                 sendiri. Tanpa tombol ini satu-satunya cara balik ke daftar adalah
                 menutup seluruh panel lewat gagang di tepi kanan, lalu membukanya
                 lagi. --}}
            <button type="button" class="kartu__tutup" id="detail-tutup"
                    title="Kembali ke daftar (Esc)" aria-label="Kembali ke daftar">×</button>
          </div>
  
          <p class="kosong" id="detail-kosong">
            Klik salah satu <span class="objek">petak</span> di peta untuk melihat rinciannya.
          </p>
  
          <div id="detail-isi" hidden>
            {{-- <div>, bukan <dl>: isinya sekarang blok .kelompok yang bisa dilipat,
                 dan tiap kelompok membawa <dl class="baris"> sendiri. <details> dan
                 <button> tidak sah sebagai anak langsung <dl>. Lihat
                 kelompokkanDetail() di peta.js. --}}
            <div id="detail-baris"></div>
            <div class="pecahan" id="detail-pecahan" hidden>
              <span class="pecahan__judul">Ke mana air pergi</span>
              <div class="bilah" id="bilah-loss"></div>
              <ul class="kunci" id="kunci-loss"></ul>
            </div>
          </div>
        </div>
      </aside>

  </section>

    

  </main>
</div>
