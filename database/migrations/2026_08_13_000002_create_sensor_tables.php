<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Tabel pembacaan sensor.
     *
     * t_s16_01        : histori mentah alat keluarga 16 sensor.
     * temp_s16_latest : cache satu baris pembacaan terakhir per logger (16 sensor).
     * temp_s19_latest : idem untuk keluarga 19 sensor.
     * temp_s50_latest : idem untuk keluarga 50 sensor.
     *
     * Peta kanal sensor untuk jaringan irigasi:
     *   AWLR  sensor1 = TMA (cm), sensor2 = debit terukur (m3/s)
     *   AWGC  sensor1..3 = bukaan pintu (%), sensor4..6 = debit per pintu (m3/s)
     */
    public function up(): void
    {
        Schema::create('t_s16_01', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->unsignedBigInteger('id_logger');
            $table->dateTime('waktu');
            for ($i = 1; $i <= 16; $i++) {
                $table->decimal("sensor{$i}", 12, 2)->default(0);
            }

            $table->index(['id_logger', 'waktu']);
        });

        foreach (['temp_s16_latest', 'temp_s19_latest', 'temp_s50_latest'] as $name) {
            Schema::create($name, function (Blueprint $table) {
                $table->unsignedBigInteger('id_logger')->primary();
                $table->dateTime('waktu')->nullable();
                for ($i = 1; $i <= 6; $i++) {
                    $table->decimal("sensor{$i}", 12, 2)->default(0);
                }
                $table->timestamp('updated_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('temp_s50_latest');
        Schema::dropIfExists('temp_s19_latest');
        Schema::dropIfExists('temp_s16_latest');
        Schema::dropIfExists('t_s16_01');
    }
};
