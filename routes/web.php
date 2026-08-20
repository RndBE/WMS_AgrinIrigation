<?php

use App\Http\Controllers\PetaLokasiController;
use App\Http\Controllers\SkemaIrigasiController;
use Illuminate\Support\Facades\Route;

Route::redirect('/', '/beranda');

/*
|--------------------------------------------------------------------------
| Tab bilah nav
|--------------------------------------------------------------------------
| Tiap tab punya rutenya sendiri di tingkat akar, alamatnya mengikuti label
| tabnya: Beranda -> /beranda, Kontrol Pintu -> /kontrol-pintu, dan seterusnya.
| Slug & judulnya terdaftar di SkemaIrigasiController::VIEWS.
|
| Semua jatuh ke aksi index() yang sama karena halamannya memang satu dokumen
| (penukaran tab tidak memuat ulang, hanya menyetel alamat lewat History API).
| ->defaults('view', ...) yang menentukan tab mana yang aktif saat halaman
| dibuka langsung dari alamatnya atau di-reload.
*/
Route::controller(SkemaIrigasiController::class)->group(function () {
    Route::get('/beranda', 'index')->defaults('view', 'dashboard')->name('view.dashboard');
    Route::get('/kontrol-pintu', 'index')->defaults('view', 'kontrol')->name('view.kontrol');
    Route::get('/konfigurasi-sistem', 'index')->defaults('view', 'konfigurasi')->name('view.konfigurasi');
    Route::get('/tren-data', 'index')->defaults('view', 'tren')->name('view.tren');
    Route::get('/rumus-analisis', 'index')->defaults('view', 'rumus')->name('view.rumus');
    Route::get('/log-sistem', 'index')->defaults('view', 'log')->name('view.log');
    Route::get('/peta-lokasi', 'index')->defaults('view', 'peta')->name('view.peta');

    // Halaman detail satu pintu — bernaung di bawah alamat tab Kontrol Pintu.
    Route::get('/kontrol-pintu/{node_id}', 'kontrolPintu')->name('kontrol.detail');

    Route::get('/asbuilt-drawing', 'asbuiltDrawing')->name('asbuilt');

    // Endpoint data untuk tampilan (dipanggil dari JS)
    Route::get('/api/skema/data', 'getData')->name('skema.data');
    Route::get('/api/skema/node/{nodeId}/history', 'getNodeHistory')->name('skema.node.history');
});

/*
|--------------------------------------------------------------------------
| Peta Lokasi — penerus ubin peta (hanya cache miss)
|--------------------------------------------------------------------------
| Satu rute ini saja yang butuh dikerjakan saat permintaan datang. Seluruh
| GeoJSON, ringkasan, dan lapisan BIG/Daerah Irigasi sudah dibekukan jadi berkas
| statis di public/data/peta oleh note/ekspor-peta.py, jadi peramban mengambilnya
| langsung tanpa melewati PHP.
|
| ALAMATNYA SENGAJA SAMA DENGAN JALAN BERKAS SIMPANANNYA di dalam public/:
|
|     GET  /data/peta-ubin/satelit/13/6524/4152.jpg
|     ->   public/data/peta-ubin/satelit/13/6524/4152.jpg
|
| Begitu satu ubin tersimpan, `RewriteCond %{REQUEST_FILENAME} !-f` di
| public/.htaccess (dan `try_files \$uri` pada nginx, dan server bawaan PHP)
| melayaninya sebagai berkas statis — rute ini tidak dipanggil lagi untuk ubin
| itu. Terukur 0,19 s per ubin lewat PHP lawan 0,02 s sebagai berkas statis, dan
| `php artisan serve` di Windows tidak bisa melayani berbarengan (fork() tidak
| ada), jadi satu viewport 20-40 ubin dulu mengantre berdetik-detik.
|
| Isi simpanannya lebih dulu dengan `php artisan peta:panaskan-ubin` supaya
| tidak ada cache miss sama sekali.
*/
Route::get('/data/peta-ubin/{tema}/{z}/{x}/{y}.{ext}', [PetaLokasiController::class, 'ubin'])
    ->whereIn('tema', ['satelit', 'rupabumi'])
    ->whereNumber(['z', 'x', 'y'])
    ->whereIn('ext', ['jpg', 'png'])
    ->name('peta.ubin');

/*
| Alamat lama berawalan /skema — dipertahankan supaya tautan dan penanda buku
| yang sudah beredar tidak mati. Boleh dihapus kalau sudah tidak ada yang pakai.
*/
Route::redirect('/skema', '/beranda');
Route::redirect('/skema/kontrol', '/kontrol-pintu');
Route::redirect('/skema/konfigurasi', '/konfigurasi-sistem');
Route::redirect('/skema/tren', '/tren-data');
Route::redirect('/skema/rumus', '/rumus-analisis');
Route::redirect('/skema/log', '/log-sistem');
Route::redirect('/skema/asbuilt-drawing', '/asbuilt-drawing');
Route::redirect('/skema/peta', '/peta-lokasi');
Route::get('/skema/kontrol/{node_id}', fn ($node_id) => redirect()->route('kontrol.detail', $node_id));
