<?php

namespace App\Providers;

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        /*
         * @aset('js/simhidro.js') — alamat berkas di public/ beserta cap waktu
         * ubahnya sebagai penanda versi.
         *
         * Berkas css/ dan js/ di public/ dilayani langsung, tidak lewat Vite, jadi
         * alamatnya tetap sama persis sesudah isinya diubah. Peramban menyimpannya
         * dan tidak menanyakannya lagi: pengembang mengubah simhidro.js atau
         * wms.css, memuat ulang halaman, lalu melihat berkas lama — perubahannya
         * dikira tidak jadi. Cap waktu ubah membuat alamatnya berganti tiap kali
         * berkasnya benar-benar berubah, jadi peramban mengambil yang baru tanpa
         * perlu muat ulang keras.
         */
        Blade::directive('aset', function (string $expression) {
            return "<?php echo \App\Providers\AppServiceProvider::asetVersi({$expression}); ?>";
        });
    }

    /**
     * Alamat berkas di public/ dengan penanda versi dari cap waktu ubahnya.
     *
     * Berkas yang tidak ada dikembalikan tanpa penanda — biar 404-nya terbaca apa
     * adanya, bukan tertutup galat filemtime().
     */
    public static function asetVersi(string $jalur): string
    {
        $berkas = public_path($jalur);

        return is_file($berkas) ? asset($jalur) . '?v=' . filemtime($berkas) : asset($jalur);
    }
}
