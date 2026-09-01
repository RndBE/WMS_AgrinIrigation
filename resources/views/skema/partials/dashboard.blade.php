<div class="view {{ $activeView === 'dashboard' ? 'active' : '' }}" id="view-dashboard">
  <div class="summary-row">
    <div class="sumcard"><div class="lbl">Debit Alami Hulu</div><div class="val"><span id="sumQnat">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard accent"><div class="lbl">Debit Masuk Kolam (3 Intake)</div><div class="val"><span id="sumQgate">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard brass"><div class="lbl">Total Tersalur ke Sawah</div><div class="val"><span id="sumQirigasi">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard"><div class="lbl">Debit ke Hilir (Floodway + Scouring)</div><div class="val"><span id="sumQhilir">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard"><div class="lbl">Pemenuhan Rata-rata</div><div class="val"><span id="sumEfisiensi">0</span><span class="unit">%</span></div></div>
  </div>

  {{--
    Peta Isometrik dan Diagram Skematik menggambarkan jaringan yang sama dari
    snapshot data yang sama, jadi keduanya ditaruh dalam satu kartu dan ditukar
    lewat tab (.panel-tabs). Hanya satu pane yang tampil; lihat initMapTabs()
    di simhidro.js — pane iso wajib jadi tab bawaan karena skala petanya
    dihitung dari clientWidth panel, yang bernilai 0 selama panel tersembunyi.
  --}}
  <div class="panel" id="mapPanelCard">
    <div class="panel-head">
      <h2>Peta Jaringan Irigasi — Bendung, Sekunder, Tersier &amp; Sawah</h2>
      <div class="head-right">
        <span class="note" id="mapNote">klik pin untuk melihat data pos</span>
        <div class="panel-tabs" id="mapTabs">
          <button type="button" class="ptab active" data-pane="iso">Isometrik</button>
          <button type="button" class="ptab" data-pane="skema">Skematik</button>
        </div>
      </div>
    </div>

    {{--
      Urutan lapisan peta isometrik (dari dasar ke atas):
        1. canvas#isoWater  — animasi aliran air (lapisan paling bawah), bentuknya
                              dari assets/aliran_sungai.png
        2. img#isoBase      — draft skema bendung (assets/draft_skema.png), sudah
                              berlubang tepat pada badan air sehingga air di
                              bawahnya tetap terlihat bergerak, sedangkan tanggul,
                              dek, pilar pintu, dan pohon tetap menimpa air
        3. svg#isoSvg       — pin pos telemetri & label
    --}}
    <div class="map-pane active" id="pane-iso">
      <div class="map-wrap" id="isoMapPanel">
        <div class="iso-scroll" id="isoScroll">
          <div class="iso-stage" id="isoStage">
            <canvas id="isoWater"></canvas>
            <img id="isoBase" src="{{ asset('assets/draft_skema.png') }}" alt="Draft skema isometrik DI Leuwigoong" draggable="false" decoding="async">
            <svg id="isoSvg" viewBox="0 0 1300 731" xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
        </div>
        <div class="pin-edit-hint">Mode geser titik aktif — tarik pin ke posisi baru. Posisi tersimpan otomatis di browser.</div>
        {{-- Petunjuk mode gambar petak. Isinya ditulis petakHintTeks() di
             simhidro.js karena menyebut nama petak yang sedang dipilih. --}}
        <div class="petak-edit-hint" id="petakEditHint"></div>
        {{-- Bacaan petak sawah saat kursor menyorotnya. Ditaruh di .map-wrap,
             BUKAN di dalam .iso-stage: panggung peta ikut diperbesar transform
             zoom, dan kotak bacaan harus tetap seukuran tulisan antarmuka.
             Isinya dibangun petakTipIsi() tiap kali disorot & tiap tick. --}}
        <div class="petak-tip" id="petakTip"></div>
        {{-- Penanda hasil simpan letak pin & batas petak ke server. Diisi
             statusTataLetak() di simhidro.js. Kegagalan sengaja dibiarkan
             tampil sampai geseran berikutnya: kalau hilang sendiri, orang
             mengira letaknya sudah tersimpan untuk semua alat padahal baru
             tersimpan di peramban yang dipakai. --}}
        <div class="tata-letak-status" id="tataLetakStatus"></div>
        <div class="pos-pop" id="posPop">
          <button class="pos-close" id="posClose" title="Tutup">×</button>
          <div class="pos-title" id="posTitle">Pos</div>
          <div class="pos-chips">
            <span class="pos-chip"><span class="dot"></span>Terhubung</span>
            <span class="pos-chip">SD Card OK</span>
          </div>
          <div class="pos-tiles" id="posTiles"></div>
          <div class="pos-time" id="posTime">—</div>
          <div class="pos-actions">
            <button id="posAnalisa"><svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l4-5 3 3 4-6"/></svg>Analisa</button>
            <button id="posLokasi"><svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M21 4L3 11l8 2 2 8z"/></svg>Lokasi</button>
          </div>
        </div>
        <div class="map-controls">
          <button id="mapZoomIn" title="Perbesar">+</button>
          <button id="mapZoomOut" title="Perkecil">−</button>
          <button id="mapReset" title="Atur ulang tampilan">⟳</button>
          <button id="mapLabelToggle" title="Tampilkan/sembunyikan label">🏷 Label</button>
          <button id="mapEditPins" title="Geser titik pos secara manual">✥ Geser Titik</button>
          <button id="mapPetakEdit" title="Ubah batas petak sawah yang bisa diklik">▱ Batas Petak</button>
          <button id="mapPinsReset" title="Kembalikan posisi titik ke bawaan" style="display:none;">↺ Posisi Awal</button>
          <button id="mapPinsCopy" title="Salin koordinat titik" style="display:none;">⧉ Salin Koordinat</button>
        </div>
      </div>
    </div>

    {{--
      Pane skematik: jaringan yang sama digambar sebagai potongan melintang —
      tiap ruas jadi kolom air setinggi TMA terhadap tinggi tanggulnya, dengan
      daun pintu yang bergerak mengikuti bukaan aktual. Isi <svg> dibangun
      buildSchematic() di simhidro.js.
    --}}
    <div class="map-pane" id="pane-skema">
      <div class="schematic-scroll" id="schematicPanel"><svg id="hmiSvg" viewBox="0 0 1500 720" xmlns="http://www.w3.org/2000/svg"></svg></div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head"><h2>Status Kebutuhan Irigasi per Petak Sawah</h2><span class="note">Ideal / Cukup / Kurang dihitung dari debit aktual vs kebutuhan</span></div>
    {{-- .grid3 ikut runtuh jadi satu kolom di layar sempit, tidak seperti
         grid tetap yang dulu ditulis inline di sini. --}}
    <div class="panel-body grid3" id="sawahCards"></div>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2>Status Pintu Air — Intake Bendung</h2>
      <button id="gotoKontrolBtn" class="primary">⚙ Kontrol Pintu</button>
    </div>
    <div class="panel-body" id="gateStatusBody"></div>
  </div>

  {{--
    Kartu ini bisa DILIPAT: kepalanya diklik untuk menutup atau membuka tabelnya.
    Tabel pos telemetri tumbuh sepanjang jumlah alat terpasang dan mendorong
    seluruh isi beranda ke bawah, padahal isinya jarang perlu dilihat terus.

    Kelas .collapsible yang menyalakannya (lihat wms.css), tombol panah &
    penanganan kliknya dipasang initCollapsiblePanels() di simhidro.js — jadi
    kartu lain tinggal ditambahi kelas yang sama kalau nanti perlu dilipat juga.
    Keadaan buka/tutupnya diingat per browser lewat localStorage.
  --}}
  <div class="panel collapsible" data-panel-key="posTelemetri">
    <div class="panel-head">
      <h2>Pos Telemetri Terdaftar</h2>
      <span class="note">{{ $loggers->count() }} alat tertaut node skema — sumber data seeder</span>
    </div>
    <div class="panel-body" style="padding:0;">
      <div style="overflow-x:auto;">
        <table class="data-table">
          <thead>
            <tr>
              <th>ID Logger</th><th>Nama Alat</th><th>Jenis</th><th>Node Skema</th>
              <th>Bukaan Maks</th><th>Pembacaan Terakhir</th><th>Sensor 1</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            @forelse ($loggers as $logger)
              <tr>
                <td>{{ $logger->id_logger }}</td>
                <td>{{ $logger->nama_logger }}</td>
                <td>{{ $logger->jenis_alat }}</td>
                <td>{{ $logger->node_skema_id }}</td>
                <td>{{ $logger->bukaan_maksimal_cm ? $logger->bukaan_maksimal_cm . ' cm' : '—' }}</td>
                <td>{{ optional($logger->temp16?->waktu)->format('Y-m-d H:i') ?? '—' }}</td>
                <td>{{ $logger->temp16 ? number_format((float) $logger->temp16->sensor1, 2) : '—' }}</td>
                <td>
                  <a href="{{ route('kontrol.detail', $logger->node_skema_id) }}" style="color:var(--teal);font-weight:600;text-decoration:none;">Detail pintu →</a>
                </td>
              </tr>
            @empty
              <tr>
                <td colspan="8" style="text-align:center;color:var(--text-3);padding:18px;">
                  Belum ada data. Jalankan <b>php artisan db:seed --class=SkemaIrigasiDummySeeder</b> untuk mengisi data dummy.
                </td>
              </tr>
            @endforelse
          </tbody>
        </table>
      </div>
    </div>
  </div>

  {{--
    Pantauan CCTV — GAMBAR SAJA, tanpa tabel parameter.

    Bacaan alat (arus, suhu, tegangan) sudah punya tempatnya sendiri di kartu Pos
    Telemetri di atas dan di tab Kontrol Pintu; mengulangnya di sini cuma membuat
    satu angka punya dua rumah yang bisa berbeda isi. Yang ditambahkan kartu ini
    adalah hal yang tidak bisa diberikan angka: rupa bangunannya.

    Gambarnya BERKAS STATIS di public/assets/cctv, ditaruh manual — belum ada
    pengambilan otomatis dari IPCAM. Daftar posnya SkemaIrigasiController::CCTV_POS,
    dan keberadaan tiap berkas sudah diperiksa cctvPos() sehingga di sini tinggal
    menggambar. Pos yang berkasnya belum ada tampil sebagai bingkai kosong
    bertuliskan nama berkas yang ditunggu, bukan ikon gambar rusak.
  --}}
  <div class="panel collapsible" data-panel-key="cctv">
    <div class="panel-head">
      <h2>Pantauan CCTV — Bangunan Bendung</h2>
      <span class="note">{{ collect($cctv)->where('ada', true)->count() }} dari {{ count($cctv) }} pos bergambar — berkas statis di <code>public/{{ \App\Http\Controllers\SkemaIrigasiController::CCTV_DIR }}</code></span>
    </div>
    <div class="panel-body">
      <div class="cctv-grid">
        @foreach ($cctv as $pos)
          <figure class="cctv-item">
            <div class="cctv-frame">
              @if ($pos['ada'])
                {{-- loading="lazy": empat gambar kamera berukuran penuh tidak
                     perlu menahan tampilnya beranda, apalagi saat kartunya
                     sedang terlipat. --}}
                <img src="{{ $pos['url'] }}" alt="CCTV {{ $pos['nama'] }}" loading="lazy" decoding="async">
              @else
                <div class="cctv-kosong">
                  <span class="cctv-kosong-ikon" aria-hidden="true">▣</span>
                  <span>Belum ada gambar</span>
                  <code>{{ $pos['path'] }}</code>
                </div>
              @endif
            </div>
            <figcaption class="cctv-cap">
              <span class="cctv-nama">{{ $pos['nama'] }}</span>
              @if ($pos['waktu'])
                <span class="cctv-waktu" title="Waktu ubah berkas gambar">{{ $pos['waktu'] }}</span>
              @endif
              @if ($pos['node'])
                <a class="cctv-tautan" href="{{ route('kontrol.detail', $pos['node']) }}">Detail pintu →</a>
              @endif
            </figcaption>
          </figure>
        @endforeach
      </div>
    </div>
  </div>

</div>
