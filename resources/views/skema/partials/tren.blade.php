<div class="view {{ $activeView === 'tren' ? 'active' : '' }}" id="view-tren">
  <div class="panel"><div class="panel-body">
    <div class="chart-grid">
      <div class="chart-box"><h3>TMA — Sungai Utama (Hulu &amp; Kolam Bendung)</h3><canvas id="chartLevelMain"></canvas></div>
      <div class="chart-box"><h3>TMA — Saluran Sekunder &amp; Tersier</h3><canvas id="chartLevelSub"></canvas></div>
      <div class="chart-box"><h3>Debit Pintu Primer &amp; Total ke Sawah</h3><canvas id="chartDebitMain"></canvas></div>
      <div class="chart-box"><h3>Debit Tersalur per Petak Sawah</h3><canvas id="chartDebitField"></canvas></div>
      {{-- Kecepatan arus dipisah main/sub mengikuti pola TMA di atas, bukan digabung
           jadi satu grafik berisi enam garis: arus sungai 0,31–1,04 m/dtk sementara
           saluran sekunder 0,04–0,06 — pada satu sumbu tegak, keempat garis jaringan
           irigasi akan rata menempel di dasar dan tidak terbaca. --}}
      <div class="chart-box"><h3>Kecepatan Arus — Sungai Utama (Hulu &amp; Kolam Bendung)</h3><canvas id="chartArusMain"></canvas></div>
      <div class="chart-box"><h3>Kecepatan Arus — Saluran Sekunder &amp; Tersier</h3><canvas id="chartArusSub"></canvas></div>
    </div>
  </div></div>
</div>
