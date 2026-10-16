<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/*
 * Halaman masuk memakai nama pengguna (mis. "admin"), bukan surel: operator di
 * ruang kendali berbagi akun per peran, tidak per orang. Kolomnya boleh kosong
 * supaya baris pengguna lama yang dibuat sebelum kolom ini ada tidak menggagalkan
 * migrasi — akun tanpa nama pengguna saja yang tidak bisa masuk.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('username', 50)->nullable()->unique()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['username']);
            $table->dropColumn('username');
        });
    }
};
