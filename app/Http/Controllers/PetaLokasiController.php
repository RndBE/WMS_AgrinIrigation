<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Penerus ubin peta untuk tab Peta Lokasi.
 *
 * Ini satu-satunya bagian aplikasi Flask (web-app/app.py) yang masih perlu
 * dikerjakan saat permintaan datang. Sisanya — GeoJSON per lokasi, ringkasan,
 * ekspor KML, lapisan BIG dan Daerah Irigasi — sudah dibekukan jadi berkas
 * statis di public/data/peta oleh note/ekspor-peta.py, karena masukannya memang
 * statis: CSV, JSON, dan KML keluaran notebook di note/.
 *
 * Ubin tidak bisa ikut dibekukan sepenuhnya: jumlahnya bergantung zoom dan
 * geseran peta, dan isinya milik penyedia peta, bukan hasil analisa — karena itu
 * simpanannya tidak masuk repo, lihat .gitignore.
 *
 * SIMPANANNYA DUDUK DI DALAM public/ DAN ALAMATNYA SAMA DENGAN JALAN BERKASNYA.
 * Itu disengaja, dan ini bagian yang paling menentukan kecepatan peta:
 *
 *   permintaan  GET /data/peta-ubin/satelit/13/6524/4152.jpg
 *   berkas      public/data/peta-ubin/satelit/13/6524/4152.jpg
 *
 * Begitu satu ubin tersimpan, web server melayaninya sebagai berkas statis dan
 * PHP tidak dijalankan lagi untuk ubin itu — `RewriteCond %{REQUEST_FILENAME}
 * !-f` di public/.htaccess (dan `try_files $uri` pada nginx, dan server bawaan
 * PHP) mendahulukan berkas yang ada sebelum memanggil index.php. Rute di bawah
 * jadi hanya melayani cache miss: sekali per ubin, selamanya.
 *
 * Terukur di mesin ini, 12 ubin yang sudah tersimpan diminta berbarengan:
 *
 *   lewat PHP (simpanan di storage/app)   2,28 s   — 0,19 s per ubin
 *   berkas statis (simpanan di public/)   0,26 s   — 0,02 s per ubin
 *
 * Dua hal yang menyusun selisih itu. Pertama, tiap permintaan lewat PHP membayar
 * boot Laravel penuh — autoload, config, seluruh service provider, router —
 * hanya untuk mengirim berkas 746 bita. Kedua, `php artisan serve` di Windows
 * melayani satu permintaan pada satu waktu: PHP_CLI_SERVER_WORKERS memakai
 * fork(), dan balasannya "forking is not supported on this platform". Jadi
 * seluruh ubin satu viewport diantrekan satu per satu. Leaflet meminta 20-40
 * ubin sekaligus tiap kali peta digeser atau di-zoom, dan itu yang dulu membuat
 * petanya terasa menggantung berdetik-detik.
 *
 * Pakai `php artisan peta:panaskan-ubin` untuk mengisi simpanannya lebih dulu,
 * sehingga tidak ada cache miss sama sekali saat dipakai.
 */
class PetaLokasiController extends Controller
{
    /**
     * Tema ubin: pola alamat sumber, akhiran berkas, jenis MIME, dan zoom
     * tertinggi yang benar-benar dilayani penyedianya.
     *
     * Perhatikan pola alamat keduanya: {z}/{y}/{x} — bukan {z}/{x}/{y}. Ini
     * urutan yang dipakai ArcGIS, dan sama seperti pada web-app/app.py.
     */
    public const TEMA = [
        'satelit' => [
            'pola' => 'https://server.arcgisonline.com/ArcGIS/rest/services/'
                . 'World_Imagery/MapServer/tile/{z}/{y}/{x}',
            'ext'  => 'jpg',
            'mime' => 'image/jpeg',
            // maxNativeZoom pada L.tileLayer di peta.js; di atas ini ubin z19 diperbesar
            'zmax' => 19,
            'nama' => 'Citra satelit (Esri World Imagery)',
        ],
        'rupabumi' => [
            'pola' => 'https://geoservices.big.go.id/rbi/rest/services/'
                . 'BASEMAP/Rupabumi_Indonesia/MapServer/tile/{z}/{y}/{x}',
            'ext'  => 'png',
            'mime' => 'image/png',
            // BIG berhenti di zoom 18; di atas itu ia membalas 404
            'zmax' => 18,
            'nama' => 'Rupabumi Indonesia (BIG)',
        ],
    ];

    /**
     * Folder simpanan, relatif terhadap public/. Alamat rutenya harus SAMA
     * dengan ini, kalau tidak berkas yang tersimpan tidak akan pernah dikenali
     * web server dan setiap ubin kembali melewati PHP.
     */
    public const UBIN_DIR = 'data/peta-ubin';

    private const AGEN = 'WMS-AgrinIrigation/1.0 (beacon swh viewer)';

    /** Sebulan. Ubin peta dasar tidak berubah, jadi peramban tidak perlu bertanya lagi. */
    private const UMUR_SIMPAN = 60 * 60 * 24 * 30;

    /**
     * Satu alasan gagal per tema per proses. Ubin datang puluhan sekaligus, jadi
     * satu peta yang gagal memuat akan menulis puluhan baris log yang sama —
     * cukup satu untuk tahu sebabnya.
     */
    private static array $sudahDicatat = [];

    /**
     * Cache miss. Hanya sampai ke sini kalau berkasnya belum ada — begitu ia
     * tersimpan, permintaan berikutnya untuk ubin yang sama tidak lagi menyentuh
     * PHP sama sekali.
     */
    public function ubin(string $tema, int $z, int $x, int $y)
    {
        if (! isset(self::TEMA[$tema])) {
            abort(404);
        }

        $cfg = self::TEMA[$tema];

        /* Zoom di luar jangkauan penyedia tidak perlu dicoba sama sekali. 204
           membuat Leaflet diam dan memperbesar ubin dari zoom di bawahnya. */
        if ($z < 0 || $z > $cfg['zmax']) {
            return response()->noContent();
        }

        [$isi, $sebab] = $this->unduh($tema, $z, $x, $y);

        if ($isi === null) {
            $this->catatSekali($tema, $sebab ?? 'sebab tidak diketahui');

            return response()->noContent();
        }

        /* Balas dari ingatan, bukan dari berkas yang baru ditulis: kalau public/
           tidak bisa ditulisi (lazim di produksi yang read-only), ubinnya tetap
           terkirim dan petanya tetap jalan — hanya tanpa simpanan, jadi tiap
           permintaan mengulang unduhannya. Kondisi itu ikut dicatat sekali. */
        $this->simpan($tema, $z, $x, $y, $isi);

        return response($isi, 200, [
            'Content-Type'  => $cfg['mime'],
            'Cache-Control' => 'public, max-age=' . self::UMUR_SIMPAN,
        ]);
    }

    /**
     * Unduh satu ubin. Kembaliannya [isi, sebab-gagal]; isi null berarti gagal.
     *
     * Gagal sengaja tidak dijadikan galat: petanya harus tetap terbuka tanpa
     * jaringan. Poligon di atasnya tergambar seperti biasa, hanya peta dasarnya
     * kosong.
     */
    public function unduh(string $tema, int $z, int $x, int $y): array
    {
        $alamat = str_replace(
            ['{z}', '{x}', '{y}'],
            [(string) $z, (string) $x, (string) $y],
            self::TEMA[$tema]['pola'],
        );

        $permintaan = Http::withHeaders(['User-Agent' => self::AGEN])->timeout(20);

        /* PHP di Windows sering terpasang tanpa CA bundle (curl.cainfo kosong di
           php.ini), dan tanpa itu SETIAP permintaan HTTPS gagal dengan "cURL
           error 60: unable to get local issuer certificate" — bukan cuma ubin
           peta. Perbaikan yang benar ada di php.ini; PETA_TILE_CAINFO disediakan
           supaya satu mesin bisa jalan tanpa menyunting php.ini yang perlu hak
           administrator. Tidak ada pilihan mematikan verifikasi di sini: itu
           membuka penyadapan, dan tidak menyelesaikan apa pun yang tidak
           diselesaikan oleh CA bundle yang benar. */
        if ($ca = $this->caBundle()) {
            $permintaan->withOptions(['verify' => $ca]);
        }

        try {
            $balasan = $permintaan->get($alamat);
        } catch (\Throwable $e) {
            return [null, $e->getMessage()];
        }

        if (! $balasan->successful() || $balasan->body() === '') {
            return [null, 'penyedia peta membalas HTTP ' . $balasan->status()
                . ' (' . strlen($balasan->body()) . ' bita)'];
        }

        return [$balasan->body(), null];
    }

    /**
     * Tulis satu ubin ke simpanan di dalam public/. Kembaliannya true kalau
     * berhasil.
     *
     * Ditulis lewat berkas sementara lalu diganti nama: dua permintaan untuk ubin
     * yang sama bisa datang berbarengan, dan tanpa ini yang kedua bisa membaca
     * berkas yang baru separuh tertulis.
     */
    public function simpan(string $tema, int $z, int $x, int $y, string $isi): bool
    {
        $berkas = self::jalanUbin($tema, $z, $x, $y);
        $folder = dirname($berkas);

        try {
            if (! is_dir($folder) && ! mkdir($folder, 0o755, true) && ! is_dir($folder)) {
                throw new \RuntimeException("folder simpanan tidak bisa dibuat: {$folder}");
            }

            $sementara = $berkas . '.' . bin2hex(random_bytes(6)) . '.tmp';

            if (file_put_contents($sementara, $isi) === false) {
                throw new \RuntimeException("tidak bisa menulis: {$sementara}");
            }

            if (! rename($sementara, $berkas)) {
                @unlink($sementara);
                throw new \RuntimeException("tidak bisa mengganti nama ke: {$berkas}");
            }
        } catch (\Throwable $e) {
            $this->catatSekali($tema . ':tulis', $e->getMessage()
                . ' — ubin tetap terkirim, tetapi tanpa simpanan setiap permintaan'
                . ' akan mengulang unduhannya. Pastikan public/' . self::UBIN_DIR
                . ' bisa ditulisi, atau isi simpanannya lebih dulu dengan'
                . ' `php artisan peta:panaskan-ubin`.');

            return false;
        }

        return true;
    }

    /** Jalan berkas satu ubin. Susunannya {tema}/{z}/{x}/{y}.{ext} — tata letak XYZ baku. */
    public static function jalanUbin(string $tema, int $z, int $x, int $y): string
    {
        return public_path(self::UBIN_DIR . '/' . $tema . '/' . $z . '/' . $x
            . '/' . $y . '.' . self::TEMA[$tema]['ext']);
    }

    /**
     * Jalan CA bundle dari config, sudah mutlak.
     *
     * Jalan relatif diselesaikan terhadap akar proyek, bukan terhadap direktori
     * kerja proses PHP: yang terakhir itu akar proyek saat `artisan serve` tetapi
     * bisa ke mana saja di bawah web server sungguhan, dan cURL tidak akan
     * memberi tahu bedanya — ia hanya gagal dengan galat sertifikat yang sama.
     * Berkas yang tidak ada diperlakukan seperti tidak disetel, supaya salah
     * tulis jalan tidak berubah menjadi galat yang membingungkan.
     */
    private function caBundle(): ?string
    {
        $ca = config('services.peta.cainfo');

        if (! is_string($ca) || $ca === '') {
            return null;
        }

        // Jalan mutlak: /etc/ssl/... di Unix, C:\... atau C:/... di Windows.
        $mutlak = str_starts_with($ca, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $ca) === 1;
        $jalan = $mutlak ? $ca : base_path($ca);

        return is_file($jalan) ? $jalan : null;
    }

    /**
     * Balasan 204 memang perilaku yang dikehendaki — petanya harus tetap terbuka
     * tanpa jaringan. Tapi 204 juga yang muncul kalau penyebabnya salah pasang,
     * dan itu tidak boleh senyap: tanpa catatan ini, peta dasar yang kosong
     * terbaca seperti "memang belum ada ubinnya".
     */
    private function catatSekali(string $kunci, string $sebab): void
    {
        if (isset(self::$sudahDicatat[$kunci])) {
            return;
        }

        self::$sudahDicatat[$kunci] = true;

        Log::warning("Ubin peta '{$kunci}' bermasalah: {$sebab}"
            . ' Bila sebabnya sertifikat SSL, setel curl.cainfo di php.ini atau'
            . ' PETA_TILE_CAINFO di .env.');
    }
}
