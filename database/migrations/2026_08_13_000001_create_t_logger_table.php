<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Master alat telemetri (AWLR / AWGC) yang terpasang di jaringan irigasi.
     * Kolom node_skema_id menautkan alat ke node topologi Skema Irigasi.
     */
    public function up(): void
    {
        Schema::create('t_logger', function (Blueprint $table) {
            $table->unsignedBigInteger('id_logger')->primary();
            $table->unsignedBigInteger('instansi_id')->default(1);
            $table->string('nama_logger', 150);
            $table->string('tabel_main', 50)->default('t_s16_01');
            $table->unsignedInteger('jeda_notif')->default(60);
            $table->unsignedBigInteger('idlokasi')->nullable();
            $table->unsignedBigInteger('id_katlogger')->nullable();
            $table->string('jenis_alat', 20)->default('AWLR');
            $table->string('node_skema_id', 50)->nullable();
            $table->unsignedInteger('bukaan_maksimal_cm')->nullable();
            $table->unsignedInteger('sensor_count')->default(16);
            $table->string('status_perbaikan', 20)->default('normal');
            $table->timestamp('created_at')->nullable();
            $table->timestamp('updated_at')->nullable();

            $table->index('node_skema_id');
            $table->index('jenis_alat');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('t_logger');
    }
};
