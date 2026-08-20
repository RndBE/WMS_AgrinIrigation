@extends('layouts.wms')

@php
  $nodeId    = $node['id'] ?? '-';
  $jenis     = $node['jenis_alat'] ?? ($node['type'] ?? '-');
  $isAwgc    = $jenis === 'AWGC';
  $gates     = $node['gates'] ?? [];
  $kapasitas = (float) ($node['panel_kapasitas'] ?? 0);
  $debit     = (float) ($node['panel_debit'] ?? 0);
  $pct       = (int) ($node['panel_pct_debit'] ?? 0);
  $tmaHulu   = $node['tma_hulu_cm']  ?? ($node['panel_tma_hulu']  ?? null);
  $tmaHilir  = $node['tma_hilir_cm'] ?? ($node['panel_tma_hilir'] ?? null);
  $online    = (bool) ($node['is_online'] ?? false);
  $putus     = (bool) ($node['logger_koneksi_putus'] ?? false);
  $lastTime  = !empty($node['last_time'])
      ? \Illuminate\Support\Carbon::parse($node['last_time'])->format('d/m/Y H:i:s')
      : '—';
  $statusCls = match ($node['status'] ?? 'dry') {
      'overflow' => 'lebih',
      'high'     => 'cukup',
      'full'     => 'ideal',
      'trickle'  => 'cukup',
      default    => 'kurang',
  };
@endphp

@section('page-title', 'Kontrol Pintu Air')

@section('nav')
  <nav class="gov-nav">
    <a href="{{ route('view.dashboard') }}" style="text-decoration:none;">
      <button class="navtab">
        <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>Beranda
      </button>
    </a>
    <button class="navtab active">
      <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M6 3v6"/><path d="M6 15v6"/><path d="M18 3v10"/><path d="M18 19v2"/><rect x="3.4" y="9" width="5.2" height="6" rx="1"/><rect x="15.4" y="13" width="5.2" height="6" rx="1"/></svg>Kontrol Pintu — {{ $nodeId }}
    </button>
    <span class="spacer"></span>
  </nav>
@endsection

@section('content')
  <div class="railbar">
    <div class="status-pill {{ $online ? '' : 'danger' }}">
      <span class="dot"></span><span>{{ $online ? 'TERHUBUNG' : 'OFFLINE' }}</span>
    </div>
    @if ($putus)
      <div class="status-pill warn"><span class="dot"></span><span>KONEKSI TERPUTUS &gt; 60 MENIT</span></div>
    @endif
    <div class="clock">Pembacaan terakhir: <b>{{ $lastTime }}</b></div>
    <div class="spacer"></div>
    <a href="{{ route('view.dashboard') }}" style="text-decoration:none;"><button>← Kembali ke Peta</button></a>
  </div>

  <div class="panel">
    <div class="panel-head">
      <h2>{{ $node['nama_logger'] ?? $nodeId }}</h2>
      <span class="note">{{ $node['panel_saluran'] ?? ($node['saluran'] ?? '-') }}</span>
    </div>
    <div class="panel-body">
      <div class="pos-chips" style="padding-top:0;">
        <span class="pos-chip">Node <b style="margin-left:4px;">{{ $nodeId }}</b></span>
        <span class="pos-chip">Jenis {{ $jenis }}</span>
        <span class="pos-chip">ID Logger {{ $node['id_logger'] ?? '—' }}</span>
        <span class="status-badge {{ $statusCls }}">{{ strtoupper($node['status'] ?? '-') }}</span>
        @if (!empty($node['status_siaga']))
          <span class="pos-chip">Siaga: {{ $node['status_siaga'] }}</span>
        @endif
      </div>

      <div class="summary-row" style="margin-top:6px;">
        <div class="sumcard"><div class="lbl">TMA Hulu</div><div class="val">{{ $tmaHulu !== null ? number_format((float) $tmaHulu, 0) : '—' }}<span class="unit">cm</span></div></div>
        <div class="sumcard"><div class="lbl">TMA Hilir</div><div class="val">{{ $tmaHilir !== null ? number_format((float) $tmaHilir, 0) : '—' }}<span class="unit">cm</span></div></div>
        <div class="sumcard accent"><div class="lbl">Debit Terukur</div><div class="val">{{ number_format($debit, 2) }}<span class="unit">m³/dtk</span></div></div>
        <div class="sumcard brass"><div class="lbl">Kapasitas Saluran</div><div class="val">{{ number_format($kapasitas, 2) }}<span class="unit">m³/dtk</span></div></div>
        <div class="sumcard"><div class="lbl">Pemakaian Kapasitas</div><div class="val">{{ $pct }}<span class="unit">%</span></div></div>
      </div>

      <div class="assumption-box">
        Elevasi ambang {{ number_format((float) ($node['panel_elevasi_m'] ?? ($node['elevasi_m'] ?? 0)), 2) }} m ·
        Luas layanan {{ number_format((float) ($node['panel_luas_area'] ?? 0), 0) }} ha ·
        Selisih TMA {{ number_format((float) ($node['panel_selisih_tma'] ?? 0), 0) }} cm.
        Debit terukur adalah hasil propagasi hulu-ke-hilir dari pembacaan sensor pintu, dengan kehilangan air 5% per ruas saluran.
      </div>
    </div>
  </div>

  @if ($isAwgc && count($gates))
    <div class="panel">
      <div class="panel-head">
        <h2>Pintu pada Node Ini ({{ count($gates) }} pintu)</h2>
        <span class="note">bukaan &amp; debit per pintu dibaca dari kanal sensor alat AWGC</span>
      </div>
      <div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:12px;">
        @foreach ($gates as $gate)
          @php
            $bukaanPersen = (float) ($gate['bukaan_persen'] ?? 0);
            $maxCm        = (float) ($gate['max_cm'] ?? 100);
            $bukaanCm     = $maxCm * $bukaanPersen / 100;
          @endphp
          <div class="ctrl-card">
            <h3>
              {{ $gate['name'] }}
              <span class="status-badge {{ $bukaanPersen > 0 ? 'ideal' : 'kurang' }}">{{ $bukaanPersen > 0 ? 'TERBUKA' : 'TERTUTUP' }}</span>
            </h3>
            <div style="text-align:center;margin:-4px 0 10px;">
              <span class="maks-badge">Maks Bukaan : {{ number_format($maxCm, 0) }} cm</span>
            </div>
            <div class="ctrl-readout">
              <div><b>{{ number_format($bukaanCm, 0) }} cm</b><span>Bukaan aktual</span></div>
              <div><b>{{ number_format($bukaanPersen, 0) }} %</b><span>Persen bukaan</span></div>
              <div><b>{{ number_format((float) ($gate['debit_aktual_sensor'] ?? 0), 2) }}</b><span>Debit pintu m³/dtk</span></div>
              <div><b>{{ $gate['sensor_id'] }}</b><span>Kanal sensor</span></div>
            </div>
            <div style="height:6px;background:var(--bg-input);overflow:hidden;margin-top:10px;">
              <div style="height:100%;width:{{ max(0, min(100, $bukaanPersen)) }}%;background:linear-gradient(90deg,var(--teal-dim),var(--teal));"></div>
            </div>
          </div>
        @endforeach
      </div>
    </div>
  @endif

  <div class="panel">
    <div class="panel-head">
      <h2>Neraca Air Node (Water Balance)</h2>
      <span class="note">Q perintah = rencana operasional · Q terukur = hasil sensor &amp; propagasi</span>
    </div>
    <div class="panel-body" style="padding:0;">
      <table class="data-table">
        <tbody>
          <tr><th style="width:38%;">Q Perintah (rencana)</th><td>{{ number_format((float) ($node['panel_q_perintah'] ?? 0), 2) }} m³/dtk</td></tr>
          <tr><th>Q Terukur</th><td>{{ number_format((float) ($node['panel_q_terukur'] ?? 0), 2) }} m³/dtk</td></tr>
          <tr>
            <th>Selisih</th>
            <td class="{{ ($node['panel_wb_error_val'] ?? 0) < 0 ? 'balance-bad' : 'balance-ok' }}">
              {{ number_format((float) ($node['panel_wb_error_val'] ?? 0), 2) }} m³/dtk
              ({{ number_format((float) ($node['panel_wb_error_pct'] ?? 0), 1) }}%)
            </td>
          </tr>
          <tr><th>Volume selisih per jam</th><td>{{ number_format((float) ($node['panel_wb_selisih_vol'] ?? 0), 0) }} m³/jam</td></tr>
          <tr><th>Status neraca</th><td><b>{{ $node['panel_wb_status'] ?? '-' }}</b></td></tr>
          @if (isset($node['panel_kb_total']))
            <tr><th>Kebutuhan irigasi petak</th><td>{{ number_format((float) $node['panel_kb_irigasi'], 2) }} l/dtk</td></tr>
            <tr><th>Kehilangan air (20%)</th><td>{{ number_format((float) $node['panel_kb_kehilangan'], 2) }} l/dtk</td></tr>
            <tr><th>Total kebutuhan</th><td>{{ number_format((float) $node['panel_kb_total'], 2) }} l/dtk</td></tr>
          @endif
        </tbody>
      </table>
    </div>
  </div>

  @if (!empty($node['id_logger']))
    <div class="panel">
      <div class="panel-head">
        <h2>Histori Pembacaan 6 Jam Terakhir</h2>
        <span class="note">sumber: {{ route('skema.node.history', $nodeId) }}</span>
      </div>
      <div class="panel-body">
        <div class="chart-box"><canvas id="chartNodeHistory"></canvas></div>
        <p id="historyNote" class="footnote">Memuat histori…</p>
      </div>
    </div>
  @endif
@endsection

@push('scripts')
  @if (!empty($node['id_logger']))
    <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
    <script>
      /* Histori TMA / bukaan pintu node ini, diambil dari endpoint getNodeHistory(). */
      fetch(@json(route('skema.node.history', $nodeId)))
        .then(r => r.json())
        .then(res => {
          const note = document.getElementById('historyNote');
          const rows = res.data || [];
          if (!res.success || !rows.length) {
            note.textContent = res.message || 'Belum ada histori pembacaan untuk node ini.';
            return;
          }
          note.textContent = rows.length + ' baris pembacaan · alat ' + res.jenis_alat + ' (ID ' + res.id_logger + ')';
          const isAwgc = res.jenis_alat === 'AWGC';
          new Chart(document.getElementById('chartNodeHistory'), {
            type: 'line',
            data: {
              labels: rows.map(r => String(r.waktu).slice(11, 16)),
              datasets: [
                { label: isAwgc ? 'Bukaan pintu 1 (%)' : 'TMA (cm)', data: rows.map(r => +r.sensor1), borderColor: '#1f4fa6', backgroundColor: 'rgba(31,79,166,.12)', tension: .3, pointRadius: 0, fill: true },
                { label: isAwgc ? 'Bukaan pintu 2 (%)' : 'Debit (m³/dtk)', data: rows.map(r => +r.sensor2), borderColor: '#c1a878', tension: .3, pointRadius: 0 },
                { label: isAwgc ? 'Bukaan pintu 3 (%)' : 'Sensor 3', data: rows.map(r => +r.sensor3), borderColor: '#4f9d4a', tension: .3, pointRadius: 0 },
              ],
            },
            options: {
              responsive: true, maintainAspectRatio: false, animation: false,
              interaction: { mode: 'index', intersect: false },
              scales: { x: { grid: { color: '#edf0f5' } }, y: { grid: { color: '#edf0f5' }, beginAtZero: true } },
              plugins: { legend: { labels: { font: { size: 11 } } } },
            },
          });
        })
        .catch(() => { document.getElementById('historyNote').textContent = 'Gagal memuat histori pembacaan.'; });
    </script>
  @endif
@endpush
