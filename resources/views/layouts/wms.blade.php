<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="csrf-token" content="{{ csrf_token() }}" />
<title>{{ $title ?? 'Monitoring Water Management System' }} — DI Leuwigoong</title>
{{-- Ikon tab peramban. Sebelumnya public/favicon.ico ada tapi isinya 0 byte dan
     tidak pernah dideklarasikan di sini, jadi peramban memakai ikon bawaannya
     (bola dunia). @aset menambahkan cap waktu ubah berkasnya, supaya ikon lama
     yang sudah tersimpan di peramban tidak dipakai lagi sesudah gambarnya diganti.
     Gambarnya lambang "be", diambil dari be-inventory (public/images/title.ico). --}}
<link rel="icon" href="@aset('favicon.ico')" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="@aset('css/wms.css')">
@stack('head')
</head>
{{-- data-tab = tab yang sedang aktif. Dipasang di sini supaya sudah benar pada
     cat pertama; activateView() di simhidro.js menyetelnya ulang tiap penukaran tab
     (halamannya satu dokumen, tidak memuat ulang). Dipakai CSS untuk menyembunyikan
     bagian halaman yang tidak berlaku di tab tertentu — lihat peta-selaras.css. --}}
<body data-tab="{{ $activeView ?? '' }}">
<div class="app">
  <header class="gov-head">
    <div class="gov-lockup">
      <div class="brand-mark">
        <img src="@aset('logo_be2.png')" alt="Beacon Engineering">
      </div>
      <div class="gov-text gov-text--app">
        <div class="gov-app">WMS</div>
        <div class="gov-app-sub">Water Management System</div>
      </div>
    </div>
    <div class="gov-user">
      <div class="mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#1f2430" stroke-width="1.8"><circle cx="12" cy="8" r="3.4"/><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6"/></svg>
      </div>
      <div>
        <div class="t">Monitoring Water Management System</div>
        <div class="r">ADMIN · Pengamat Pengairan</div>
      </div>
    </div>
  </header>

  @yield('nav')

  <div class="wrap">
    <div class="page-title" id="pageTitle">@yield('page-title', 'Beranda')</div>

    @yield('content')
  </div>

  <footer class="footer">
    <p class="footnote">
      <b>Catatan model:</b> angka pada tampilan ini berasal dari data dummy hasil
      <b>SkemaIrigasiDummySeeder</b> (histori 60 menit, TMA = sensor1 × (1 + 0,20·sin(menit·12°)))
      yang diolah <b>SkemaIrigasiController</b>: kapasitas &amp; TMA rencana dari <i>injectPanelInfo</i>,
      debit aktual dari pembacaan sensor AWGC, lalu dipropagasi hulu ke hilir mengikuti topologi jaringan
      dengan kehilangan air 5% per ruas saluran.
      Peta jaringan tersedia dalam satu kartu dengan dua tab: <b>Isometrik</b> (lapisan aliran air di dasar,
      draft skema bendung di atasnya) dan <b>Skematik</b>, yang menggambar tiap ruas sebagai penampang
      basah — tinggi kolom air = TMA terhadap tinggi tanggul ruas itu — beserta bukaan tiap pintu;
      keduanya dibangun dari snapshot data yang sama. Untuk kajian hidrolika rinci, gunakan model 1D/2D penuh (mis. HEC-RAS)
      dengan data topografi terukur.
    </p>
  </footer>

</div>
@stack('scripts')
</body>
</html>
