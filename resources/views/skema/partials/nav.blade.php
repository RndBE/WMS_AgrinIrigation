{{--
  Tiap tab adalah tautan sungguhan ke rutenya sendiri, bukan tombol: alamatnya
  bisa disalin, dibuka di tab baru, dan tetap jalan kalau JS gagal dimuat.
  initNav() di simhidro.js menahan kliknya lalu menukar panel tanpa muat ulang.
--}}
<nav class="gov-nav" id="navTabs">
  <a class="navtab {{ $activeView === 'dashboard' ? 'active' : '' }}" href="{{ route('view.dashboard') }}" data-view="dashboard">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>Beranda
  </a>
  <a class="navtab {{ $activeView === 'kontrol' ? 'active' : '' }}" href="{{ route('view.kontrol') }}" data-view="kontrol">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M6 3v6"/><path d="M6 15v6"/><path d="M18 3v10"/><path d="M18 19v2"/><rect x="3.4" y="9" width="5.2" height="6" rx="1"/><rect x="15.4" y="13" width="5.2" height="6" rx="1"/></svg>Kontrol Pintu
  </a>
  <a class="navtab {{ $activeView === 'konfigurasi' ? 'active' : '' }}" href="{{ route('view.konfigurasi') }}" data-view="konfigurasi">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 7h9"/><path d="M17 7h3"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="15" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>Konfigurasi Sistem
  </a>
  <a class="navtab {{ $activeView === 'tren' ? 'active' : '' }}" href="{{ route('view.tren') }}" data-view="tren">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l4-5 3 3 4-6"/></svg>Tren Data
  </a>
  <a class="navtab {{ $activeView === 'rumus' ? 'active' : '' }}" href="{{ route('view.rumus') }}" data-view="rumus">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M6 20c2 0 2.5-1.5 3-5s1-11 3-11c1.2 0 1.8.7 2 1.4"/><path d="M6 10h9"/></svg>Rumus &amp; Analisis
  </a>
  <a class="navtab {{ $activeView === 'log' ? 'active' : '' }}" href="{{ route('view.log') }}" data-view="log">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/></svg>Log Sistem
  </a>
  <a class="navtab {{ $activeView === 'peta' ? 'active' : '' }}" href="{{ route('view.peta') }}" data-view="peta">
    <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5 3.5 5.7v14.8L9 18.3l6 2.2 5.5-2.2V3.5L15 5.7z"/><path d="M9 3.5v14.8"/><path d="M15 5.7v14.8"/></svg>Peta Lokasi
  </a>
  <span class="spacer"></span>
  <button id="downloadBtn" title="Unduh data sensor &amp; konfigurasi saat ini">
    <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 20h14"/></svg>Unduh
  </button>
</nav>
