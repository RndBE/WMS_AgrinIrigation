<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Ambang batas tingkat siaga per alat AWLR (Normal / Siaga / Banjir).
     * Nilai dalam cm TMA; warna dipakai langsung oleh legenda peta.
     */
    public function up(): void
    {
        Schema::create('tingkat_siaga_awlr', function (Blueprint $table) {
            $table->unsignedBigInteger('id')->primary();
            $table->unsignedBigInteger('id_logger');
            $table->unsignedInteger('id_status');
            $table->string('nama', 50);
            $table->decimal('nilai', 10, 2);
            $table->unsignedTinyInteger('status')->default(1);
            $table->string('warna', 20)->default('#22c55e');

            $table->index('id_logger');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tingkat_siaga_awlr');
    }
};
