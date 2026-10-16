<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Masuk — Monitoring Water Management System — DI Leuwigoong</title>
<link rel="icon" href="@aset('favicon.ico')" sizes="any">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet">
{{-- wms.css untuk token warna & huruf yang sama dengan dasbor; masuk.css berisi
     tata letak halaman ini dan menimpa aturan umum wms.css yang tidak cocok. --}}
<link rel="stylesheet" href="@aset('css/wms.css')">
<link rel="stylesheet" href="@aset('css/masuk.css')">
</head>
<body class="masuk-body">
<div class="masuk">

  {{-- Kiri: ilustrasi isometrik bendung & jaringan (assets/iso-map.png yang sama
       dengan peta Beranda, diperkecil jadi JPG di assets/masuk/ supaya halaman
       masuk tidak memuat 4 MB). --}}
  <section class="masuk-hero">
    <img class="masuk-hero-img"
         src="@aset('assets/masuk/iso-map-1920.jpg')"
         srcset="@aset('assets/masuk/iso-map-960.jpg') 960w, @aset('assets/masuk/iso-map-1920.jpg') 1920w"
         sizes="(max-width: 900px) 100vw, 65vw"
         alt="" fetchpriority="high">
    <div class="masuk-hero-shade"></div>

    <div class="masuk-hero-body">
      <div class="masuk-eyebrow"><span class="masuk-eyebrow-bar"></span>D.I. Leuwigoong · Kab. Garut</div>
      <h1>Monitoring Water<br>Management System</h1>
      <p class="masuk-lead">Telemetri muka air, debit, dan kendali pintu jaringan irigasi — dari bendung sampai petak sawah, dalam satu dasbor.</p>

      <ul class="masuk-fitur">
        <li>
          <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/></svg>
          <span><b>Skema jaringan</b>Isometrik &amp; skematik</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M6 3v6"/><path d="M6 15v6"/><path d="M18 3v10"/><path d="M18 19v2"/><rect x="3.4" y="9" width="5.2" height="6" rx="1"/><rect x="15.4" y="13" width="5.2" height="6" rx="1"/></svg>
          <span><b>Kontrol pintu</b>Bukaan pintu AWGC</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" stroke-linecap="round"><path d="M4 19V5"/><path d="M4 19h16"/><path d="M7 15l4-5 3 3 4-6"/></svg>
          <span><b>Tren data</b>TMA &amp; debit per pos</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3.5 3.5 5.7v14.8L9 18.3l6 2.2 5.5-2.2V3.5L15 5.7z"/><path d="M9 3.5v14.8"/><path d="M15 5.7v14.8"/></svg>
          <span><b>Peta lokasi</b>Petak &amp; ruas saluran</span>
        </li>
      </ul>
    </div>
  </section>

  {{-- Kanan: formulir masuk. --}}
  <section class="masuk-panel">
    <div class="masuk-panel-inner">
      <div class="masuk-brand">
        <img src="@aset('logo_be2.png')" alt="Beacon Engineering">
        <div class="masuk-brand-app">
          <b>WMS</b>
          <span>Water Management System</span>
        </div>
      </div>

      <h2>Selamat datang</h2>
      <p class="masuk-sub">Masuk dengan akun operator untuk membuka dasbor.</p>

      @if ($errors->any())
        <div class="masuk-alert" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/></svg>
          <span>{{ $errors->first() }}</span>
        </div>
      @endif

      <form class="masuk-form" id="masukForm" method="POST" action="{{ route('login.store') }}" novalidate>
        @csrf

        <div class="masuk-field">
          <label for="username">Nama pengguna</label>
          <div class="masuk-control">
            <svg class="masuk-ikon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8"/></svg>
            {{-- Sesudah gagal masuk nama penggunanya sudah terisi, jadi kursor
                 langsung ditaruh di kata sandi. --}}
            <input class="masuk-input @error('username') is-invalid @enderror" id="username" name="username" type="text"
                   value="{{ old('username') }}" placeholder="mis. admin" autocomplete="username"
                   autocapitalize="none" spellcheck="false" required @if (! old('username')) autofocus @endif>
          </div>
        </div>

        <div class="masuk-field">
          <label for="password">Kata sandi</label>
          <div class="masuk-control">
            <svg class="masuk-ikon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="1.6"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>
            <input class="masuk-input masuk-input--pw @error('password') is-invalid @enderror" id="password" name="password" type="password"
                   placeholder="••••••••" autocomplete="current-password" required @if (old('username')) autofocus @endif>
            <button type="button" class="masuk-pw-toggle" id="pwToggle" aria-label="Tampilkan kata sandi" aria-pressed="false">
              <svg class="mata-buka" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
              <svg class="mata-tutup" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1"/><path d="M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>
            </button>
          </div>
          <p class="masuk-caps" id="capsHint" hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l7 8h-4v4H9v-4H5z"/><path d="M9 20h6"/></svg>
            Caps Lock sedang aktif
          </p>
        </div>

        <label class="masuk-remember">
          <input type="checkbox" name="remember" value="1" @checked(old('remember'))>
          <span>Ingat saya di perangkat ini</span>
        </label>

        <button type="submit" class="masuk-submit" id="masukSubmit">
          <span class="masuk-submit-label">Masuk ke dasbor</span>
          <svg class="masuk-submit-panah" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
          <span class="masuk-spinner" aria-hidden="true"></span>
        </button>
      </form>
    </div>

    <footer class="masuk-foot">© {{ date('Y') }} Beacon Engineering</footer>
  </section>
</div>

<script>
  // Semua di sini tambahan saja: tanpa JS formulirnya tetap terkirim biasa.
  (function () {
    var form = document.getElementById('masukForm');
    var input = document.getElementById('password');
    var toggle = document.getElementById('pwToggle');
    var caps = document.getElementById('capsHint');
    var submit = document.getElementById('masukSubmit');

    toggle.addEventListener('click', function () {
      var tampil = input.type === 'password';
      input.type = tampil ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(tampil));
      toggle.setAttribute('aria-label', tampil ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
      input.focus();
    });

    // Peringatan Caps Lock — penyebab paling umum "sandi benar tapi ditolak".
    function cekCaps(e) {
      if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock');
    }
    input.addEventListener('keydown', cekCaps);
    input.addEventListener('keyup', cekCaps);
    input.addEventListener('blur', function () { caps.hidden = true; });

    // Cegah klik ganda selagi server memeriksa sandi.
    form.addEventListener('submit', function () {
      submit.classList.add('is-loading');
      submit.setAttribute('aria-busy', 'true');
      submit.querySelector('.masuk-submit-label').textContent = 'Memeriksa…';
      setTimeout(function () { submit.disabled = true; }, 0);
    });

    // Kembali lewat tombol Back memulihkan halaman dari bfcache dengan tombol
    // masih terkunci — lepaskan lagi.
    window.addEventListener('pageshow', function (e) {
      if (!e.persisted) return;
      submit.classList.remove('is-loading');
      submit.removeAttribute('aria-busy');
      submit.disabled = false;
      submit.querySelector('.masuk-submit-label').textContent = 'Masuk ke dasbor';
    });
  })();
</script>
</body>
</html>
