<?php

namespace App\Console\Commands;

use App\Http\Controllers\PetaLokasiController;
use App\Http\Controllers\SkemaIrigasiController;
use Illuminate\Console\Command;
use Illuminate\Http\Client\Pool;
use Illuminate\Support\Facades\Http;

/**
 * Isi simpanan ubin peta lebih dulu, supaya tab Peta Lokasi tidak pernah kena
 * cache miss saat dipakai.
 *
 * Kenapa perlu: ubin yang sudah tersimpan dilayani sebagai berkas statis dan
 * murah (terukur 0,02 s), tetapi ubin yang BELUM tersimpan harus diunduh dari
 * Esri atau BIG lebih dulu — 0,5 s per ubin, dan `php artisan serve` di Windows
 * mengerjakannya satu per satu karena fork() tidak ada di sana. Satu viewport
 * baru yang seluruh ubinnya dingin karena itu bisa menggantung belasan detik.
 *
 * Sekali dijalankan, zoom yang dipakai peta sudah terisi dan petanya juga jalan
 * penuh tanpa jaringan — persis maksud awal cache ubin di web-app.
 *
 * Batas wilayahnya TIDAK dipatok di sini, tetapi dibaca dari medan `kotak` pada
 * berkas beku public/data/peta/lokasi-*.json. Jadi kalau daftar lokasinya
 * berubah, wilayah yang dipanaskan ikut berubah tanpa menyunting berkas ini.
 */
class PanaskanUbinPeta extends Command
{
    protected $signature = 'peta:panaskan-ubin
        {--tema=* : satelit dan/atau rupabumi (bawaan: keduanya)}
        {--zmin=12 : zoom terendah, samakan dengan minZoom di peta.js}
        {--zmax=15 : zoom tertinggi yang diunduh}
        {--kotak= : batas sendiri, format "barat,selatan,timur,utara" dalam derajat}
        {--serentak=12 : berapa ubin diunduh berbarengan}
        {--ulang : unduh ulang walau ubinnya sudah tersimpan}
        {--kering : hitung dan tampilkan jumlahnya saja, jangan mengunduh}';

    protected $description = 'Isi simpanan ubin peta untuk tab Peta Lokasi';

    /**
     * Dipakai hanya kalau berkas beku belum ada. Menutupi D.I. Leuwigoong dan
     * 32 Daerah Irigasi kewenangan Kab. Garut. Urutannya barat, selatan, timur,
     * utara (derajat, WGS 84).
     */
    private const KOTAK_DARURAT = [107.7525, -7.3806, 108.0825, -6.9795];

    private const AGEN = 'WMS-AgrinIrigation/1.0 (beacon swh viewer)';

    /**
     * zmax bawaan 15, bukan 19. Tiap kenaikan satu zoom mengalikan jumlah ubin
     * dengan empat. Untuk kotak gabungan seluruh lokasi (~36 x 44 km), terukur:
     *
     *   zoom 12-14    424 ubin     5 MB
     *   zoom 12-15  1.602 ubin    19 MB
     *   zoom 12-16  6.177 ubin    72 MB
     *   zoom 12-17 24.085 ubin   282 MB
     *   zoom 12-19    380 ribu   4,4 GB
     *
     * Zoom 16 ke atas hanya terpakai kalau seseorang benar-benar memperbesar
     * sampai satu petak, jadi lebih murah membiarkannya diunduh saat itu terjadi
     * — sekali saja, lalu ikut tersimpan. Naikkan dengan --zmax kalau memang mau
     * seluruhnya terisi.
     */
    public function handle(): int
    {
        $tema = $this->option('tema') ?: array_keys(PetaLokasiController::TEMA);

        foreach ($tema as $t) {
            if (! isset(PetaLokasiController::TEMA[$t])) {
                $this->error("Tema '{$t}' tidak dikenal. Yang ada: "
                    . implode(', ', array_keys(PetaLokasiController::TEMA)));

                return self::FAILURE;
            }
        }

        [$kotak, $asalKotak] = $this->kotak();

        if ($kotak === null) {
            return self::FAILURE;
        }

        $zmin = max(0, (int) $this->option('zmin'));
        $zmax = (int) $this->option('zmax');
        $serentak = max(1, min(32, (int) $this->option('serentak')));

        if ($zmax < $zmin) {
            $this->error('--zmax tidak boleh di bawah --zmin.');

            return self::FAILURE;
        }

        $this->line(sprintf('Kotak    : %.4f, %.4f  ..  %.4f, %.4f  (%s)',
            $kotak[0], $kotak[1], $kotak[2], $kotak[3], $asalKotak));
        $this->line('Zoom     : ' . $zmin . ' - ' . $zmax);
        $this->line('Tema     : ' . implode(', ', $tema));
        $this->line('Serentak : ' . $serentak);
        $this->newLine();

        $penerus = app(PetaLokasiController::class);
        $ca = $this->caBundle();
        $totalBaru = 0;
        $totalGagal = 0;

        foreach ($tema as $t) {
            $cfg = PetaLokasiController::TEMA[$t];
            $perlu = [];
            $adaSudah = 0;
            $dalamKotak = 0;

            // Zoom di atas jangkauan penyedia dilewati: di sana ia membalas 404.
            for ($z = $zmin; $z <= min($zmax, $cfg['zmax']); $z++) {
                [$x1, $y1] = self::keUbin($kotak[0], $kotak[3], $z);   // sudut kiri-atas
                [$x2, $y2] = self::keUbin($kotak[2], $kotak[1], $z);   // sudut kanan-bawah

                for ($x = $x1; $x <= $x2; $x++) {
                    for ($y = $y1; $y <= $y2; $y++) {
                        $dalamKotak++;

                        if (! $this->option('ulang')
                            && is_file(PetaLokasiController::jalanUbin($t, $z, $x, $y))) {
                            $adaSudah++;

                            continue;
                        }

                        $perlu[] = [$z, $x, $y];
                    }
                }
            }

            $this->line($cfg['nama']);
            $this->line('  ' . number_format($dalamKotak) . ' ubin dalam kotak, '
                . number_format($adaSudah) . ' sudah tersimpan, '
                . number_format(count($perlu)) . ' perlu diunduh');

            if ($this->option('kering') || ! $perlu) {
                $this->newLine();

                continue;
            }

            $bilah = $this->output->createProgressBar(count($perlu));
            $bilah->start();
            $gagal = 0;

            /* Diunduh berkelompok dan berbarengan. Serial 0,5 s per ubin berarti
               1.602 ubin = 13 menit; dengan 12 sekaligus jadi sekitar satu menit.
               Http::pool memakai Guzzle yang memang asinkron — batasnya di sini
               kesopanan terhadap penyedia peta, bukan kemampuan mesinnya. */
            foreach (array_chunk($perlu, $serentak) as $kelompok) {
                $balasan = Http::pool(function (Pool $pool) use ($kelompok, $t, $ca) {
                    foreach ($kelompok as $i => [$z, $x, $y]) {
                        $p = $pool->as((string) $i)
                            ->withHeaders(['User-Agent' => self::AGEN])
                            ->timeout(20);

                        if ($ca) {
                            $p->withOptions(['verify' => $ca]);
                        }

                        $p->get(self::alamat($t, $z, $x, $y));
                    }
                });

                foreach ($kelompok as $i => [$z, $x, $y]) {
                    $r = $balasan[(string) $i] ?? null;

                    // 404 di tepi jangkauan penyedia itu lumrah, tidak perlu berisik.
                    if (! $r instanceof \Illuminate\Http\Client\Response
                        || ! $r->successful() || $r->body() === '') {
                        $gagal++;
                    } else {
                        $penerus->simpan($t, $z, $x, $y, $r->body());
                        $totalBaru++;
                    }

                    $bilah->advance();
                }
            }

            $bilah->finish();
            $this->newLine();

            if ($gagal) {
                $this->warn('  ' . number_format($gagal) . ' ubin gagal diunduh'
                    . ' (404 di tepi jangkauan penyedia itu lumrah;'
                    . ' galat sertifikat SSL tidak — cek log).');
                $totalGagal += $gagal;
            }

            $this->newLine();
        }

        if ($this->option('kering')) {
            $this->info('Hitungan saja (--kering), tidak ada yang diunduh.');

            return self::SUCCESS;
        }

        $this->info(number_format($totalBaru) . ' ubin baru tersimpan di public/'
            . PetaLokasiController::UBIN_DIR . ' ('
            . $this->ukuran(public_path(PetaLokasiController::UBIN_DIR)) . ' seluruhnya).');

        if ($totalGagal > 0 && $totalBaru === 0) {
            $this->error('Tidak ada satu ubin pun berhasil diunduh. Kalau sebabnya'
                . ' sertifikat SSL, setel curl.cainfo di php.ini atau PETA_TILE_CAINFO'
                . ' di .env — lihat tools/peta/README.md.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /**
     * Batas wilayah: dari --kotak kalau diberikan, kalau tidak gabungan medan
     * `kotak` seluruh berkas beku lokasi. Kembaliannya [batas, asal]; batas null
     * berarti masukan --kotak salah.
     *
     * Membacanya dari berkas beku, bukan dari daftar tetap di kode, supaya wilayah
     * yang dipanaskan otomatis mengikuti lokasi yang benar-benar tampil di
     * pemilih peta.
     */
    private function kotak(): array
    {
        if ($teks = $this->option('kotak')) {
            $bagian = array_map('trim', explode(',', $teks));

            if (count($bagian) !== 4 || count(array_filter($bagian, 'is_numeric')) !== 4) {
                $this->error('--kotak harus empat angka: "barat,selatan,timur,utara".');

                return [null, ''];
            }

            [$barat, $selatan, $timur, $utara] = array_map('floatval', $bagian);

            if ($barat >= $timur || $selatan >= $utara) {
                $this->error('--kotak salah urutan: barat < timur dan selatan < utara.');

                return [null, ''];
            }

            return [[$barat, $selatan, $timur, $utara], 'dari --kotak'];
        }

        $gabung = null;
        $jumlah = 0;
        $pola = public_path(SkemaIrigasiController::PETA_DATA . '/lokasi-*.json');

        foreach (glob($pola) ?: [] as $berkas) {
            $isi = json_decode((string) file_get_contents($berkas), true);
            $k = is_array($isi) ? ($isi['kotak'] ?? null) : null;

            if (! is_array($k) || count($k) !== 4) {
                continue;
            }

            $jumlah++;
            $gabung = $gabung === null ? $k : [
                min($gabung[0], $k[0]), min($gabung[1], $k[1]),
                max($gabung[2], $k[2]), max($gabung[3], $k[3]),
            ];
        }

        if ($gabung === null) {
            return [self::KOTAK_DARURAT,
                'kotak darurat — berkas beku belum ada, jalankan dulu'
                . ' python note/ekspor-peta.py'];
        }

        return [$gabung, 'gabungan ' . $jumlah . ' berkas beku lokasi'];
    }

    private static function alamat(string $tema, int $z, int $x, int $y): string
    {
        return str_replace(
            ['{z}', '{x}', '{y}'],
            [(string) $z, (string) $x, (string) $y],
            PetaLokasiController::TEMA[$tema]['pola'],
        );
    }

    /** Sama seperti PetaLokasiController::caBundle(), lihat catatan di sana. */
    private function caBundle(): ?string
    {
        $ca = config('services.peta.cainfo');

        if (! is_string($ca) || $ca === '') {
            return null;
        }

        $mutlak = str_starts_with($ca, '/') || preg_match('#^[A-Za-z]:[\\\\/]#', $ca) === 1;
        $jalan = $mutlak ? $ca : base_path($ca);

        return is_file($jalan) ? $jalan : null;
    }

    /**
     * Lintang-bujur ke nomor ubin XYZ (Web Mercator, EPSG:3857).
     *
     * Rumus baku slippy map: bujur dipetakan lurus, lintang lewat proyeksi
     * Mercator. Sama seperti yang dihitung Leaflet di sisi peramban, jadi nomor
     * ubin yang diunduh di sini persis nomor yang nanti diminta peta.
     */
    private static function keUbin(float $bujur, float $lintang, int $z): array
    {
        $n = 2 ** $z;
        $x = (int) floor(($bujur + 180) / 360 * $n);
        $rad = deg2rad($lintang);
        $y = (int) floor((1 - log(tan($rad) + 1 / cos($rad)) / M_PI) / 2 * $n);

        return [max(0, min($n - 1, $x)), max(0, min($n - 1, $y))];
    }

    /** Ukuran folder simpanan, untuk ditampilkan di akhir. */
    private function ukuran(string $folder): string
    {
        if (! is_dir($folder)) {
            return '0 B';
        }

        $bita = 0;

        foreach (new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($folder, \FilesystemIterator::SKIP_DOTS),
        ) as $berkas) {
            if ($berkas->isFile()) {
                $bita += $berkas->getSize();
            }
        }

        foreach (['B', 'KB', 'MB', 'GB'] as $satuan) {
            if ($bita < 1024 || $satuan === 'GB') {
                return round($bita, 1) . ' ' . $satuan;
            }

            $bita /= 1024;
        }

        return $bita . ' B';
    }
}
