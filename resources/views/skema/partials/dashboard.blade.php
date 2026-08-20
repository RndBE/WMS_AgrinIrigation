<div class="view {{ $activeView === 'dashboard' ? 'active' : '' }}" id="view-dashboard">
  <div class="summary-row">
    <div class="sumcard"><div class="lbl">Debit Alami Hulu</div><div class="val"><span id="sumQnat">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard accent"><div class="lbl">Debit Masuk (Pintu Scouring)</div><div class="val"><span id="sumQgate">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard brass"><div class="lbl">Total Tersalur ke Sawah</div><div class="val"><span id="sumQirigasi">0.0</span><span class="unit">m³/dtk</span></div></div>
    <div class="sumcard"><div class="lbl">Debit ke Hilir (Floodway)</div><div class="val"><span id="sumQhilir">0.0</span><span class="unit">m³/dtk</span></div></div>
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

  <div class="panel">
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

</div>
