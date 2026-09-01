@extends('layouts.wms')

@section('page-title', $viewTitle)

{{-- Aset tab Peta Lokasi. Leaflet di-vendor di public/vendor/leaflet, bukan dari
     CDN, supaya peta tetap terbuka tanpa jaringan — alasan yang sama dengan
     web-app/static/vendor asalnya. peta.css sudah dilingkupi ke #view-peta jadi
     tidak menyentuh tab lain; lihat kepala berkasnya. --}}
@push('head')
  <link rel="stylesheet" href="{{ asset('vendor/leaflet/leaflet.css') }}">
  <link rel="stylesheet" href="@aset('css/peta.css')">
  {{-- Penyelaras ke rupa dasbor + tinggi kerja peta. HARUS sesudah peta.css:
       peta.css berkas hasil salinan yang tidak boleh disunting, jadi seluruh
       penimpaannya dikumpulkan di sini. Lihat kepala berkasnya. --}}
  <link rel="stylesheet" href="@aset('css/peta-selaras.css')">
@endpush

@section('nav')
  @include('skema.partials.nav')
@endsection

@section('content')
  @include('skema.partials.railbar')

  <div class="shell">
    <main class="content">
      @include('skema.partials.dashboard')
      @include('skema.partials.kontrol')
      @include('skema.partials.konfigurasi')
      @include('skema.partials.tren')
      @include('skema.partials.rumus')
      @include('skema.partials.log')
      @include('skema.partials.peta')
    </main>
  </div>
@endsection

@push('scripts')
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js"></script>
  {{-- Snapshot data dummy dari SkemaIrigasiDummySeeder, diolah SkemaIrigasiController --}}
  <script>window.WMS_DUMMY = @json($dummy);</script>
  {{-- Alamat & judul tiap tab (dari route(), lihat SkemaIrigasiController::viewPayload)
       plus tab yang sedang aktif. Dipakai simhidro.js untuk menyetel alamat saat
       tab ditukar, jadi slug rute cukup diubah di routes/web.php saja. --}}
  <script>window.WMS_VIEW = @json(['active' => $activeView, 'views' => $viewRoutes]);</script>
  {{-- Letak pin pos & batas petak sawah yang sudah dirapikan, dari
       storage/app/tata-letak-peta.json. Dikirim bersama halaman (bukan diambil
       lewat permintaan kedua) supaya petanya langsung tergambar pada letak yang
       benar — kalau diambil belakangan, pin sempat berkedip di letak bawaannya.
       Alamat penyimpannya ikut supaya slug rutenya cukup diubah di web.php. --}}
  <script>
    window.WMS_TATA_LETAK = @json($tataLetak);
    window.WMS_TATA_LETAK_URL = "{{ route('skema.tataLetak') }}";
  </script>
  <script src="@aset('js/simhidro.js')"></script>

  {{-- Peta Lokasi. Alamat datanya dari SkemaIrigasiController::petaRoutes(), pola
       yang sama dengan window.WMS_VIEW di atas. peta.js tidak jalan sendiri saat
       dimuat: ia menunggu window.petaMulai() yang dipanggil activateView() saat
       tabnya pertama kali tampil, karena Leaflet tidak bisa mengukur kontainer
       yang masih display:none. --}}
  <script>window.PETA = @json($petaRoutes);</script>
  <script src="{{ asset('vendor/leaflet/leaflet.js') }}"></script>
  <script src="@aset('js/peta.js')" defer></script>
@endpush
