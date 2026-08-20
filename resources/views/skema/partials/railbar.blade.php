<div class="railbar">
  <div class="weather-chip" id="weatherChip">
    <span class="wicon" id="wIcon">☀️</span>
    {{-- Isi chip diisi updateWeatherChip() di simhidro.js — angka di bawah cuma
         nilai awal sebelum render pertama. --}}
    <div>
      <div class="wtemp"><span id="wTemp">28</span>°C</div>
      <div class="wmeta" id="wDesc">Cerah Berawan · Angin 5.9 km/h</div>
      <div class="wmeta wscen" id="wScen">Skenario hulu: Normal</div>
    </div>
  </div>
  <div class="status-pill" id="statusPill"><span class="dot"></span><span id="statusText">NORMAL</span></div>
  <div class="clock">T-sim: <b id="simClock">00:00:00</b></div>
  <div class="search-box">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/></svg>
    <input type="text" id="searchPos" placeholder="Cari pos / pintu / petak sawah…" autocomplete="off">
  </div>
  <div class="spacer"></div>
  <select id="speedSelect" title="Kecepatan pemutaran histori">
    <option value="1">1×</option><option value="4" selected>4×</option><option value="12">12×</option><option value="60">60×</option>
  </select>
  <button id="playPauseBtn" class="primary">▶ Jalankan</button>
  <button id="resetBtn">↺ Reset</button>
</div>
