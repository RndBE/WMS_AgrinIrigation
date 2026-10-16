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
{{-- wms.css untuk token warna & kop yang sama dengan dasbor; masuk.css hanya
     berisi tata letak halaman ini. --}}
<link rel="stylesheet" href="@aset('css/wms.css')">
<link rel="stylesheet" href="@aset('css/masuk.css')">
</head>
<body class="masuk-body">
<div class="masuk">
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
  </header>

  <main class="masuk-main">
    <section class="masuk-card">
      <div class="masuk-intro">
        <div class="masuk-eyebrow">D.I. Leuwigoong · Kab. Garut</div>
        <h1>Monitoring Water Management System</h1>
        <p>Telemetri muka air, debit, dan kendali pintu jaringan irigasi dalam satu dasbor.</p>
        <ul class="masuk-modul">
          <li>Beranda &amp; skema jaringan</li>
          <li>Kontrol pintu AWGC</li>
          <li>Tren data &amp; log sistem</li>
          <li>Peta lokasi</li>
        </ul>
      </div>

      <form class="masuk-form" method="POST" action="{{ route('login.store') }}" novalidate>
        @csrf
        <h2>Masuk</h2>
        <p class="masuk-sub">Gunakan akun operator untuk membuka dasbor.</p>

        @if ($errors->any())
          <div class="masuk-alert" role="alert">{{ $errors->first() }}</div>
        @endif

        <label class="masuk-label" for="username">Nama pengguna</label>
        <input class="masuk-input @error('username') is-invalid @enderror" id="username" name="username" type="text"
               value="{{ old('username') }}" autocomplete="username" autocapitalize="none" spellcheck="false"
               required autofocus>

        <label class="masuk-label" for="password">Kata sandi</label>
        <div class="masuk-pw">
          <input class="masuk-input @error('password') is-invalid @enderror" id="password" name="password" type="password"
                 autocomplete="current-password" required>
          <button type="button" class="masuk-pw-toggle" id="pwToggle" aria-label="Tampilkan kata sandi" aria-pressed="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>

        <label class="masuk-remember">
          <input type="checkbox" name="remember" value="1" @checked(old('remember'))>
          Ingat saya di perangkat ini
        </label>

        <button type="submit" class="masuk-submit">Masuk</button>
      </form>
    </section>
  </main>

  <footer class="masuk-foot">© {{ date('Y') }} Beacon Engineering</footer>
</div>

<script>
  // Tampil/sembunyikan kata sandi. Tanpa JS tombolnya tetap ada tapi tidak berbuat
  // apa-apa; formulirnya sendiri tidak bergantung pada skrip ini.
  (function () {
    var btn = document.getElementById('pwToggle');
    var input = document.getElementById('password');
    btn.addEventListener('click', function () {
      var tampil = input.type === 'password';
      input.type = tampil ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(tampil));
      btn.setAttribute('aria-label', tampil ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi');
      input.focus();
    });
  })();
</script>
</body>
</html>
