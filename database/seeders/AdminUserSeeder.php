<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class AdminUserSeeder extends Seeder
{
    /**
     * Akun bawaan untuk halaman masuk: admin / password.
     *
     * updateOrCreate, bukan create: seeder ini aman dijalankan ulang dan sekaligus
     * mengembalikan sandi admin ke "password" kalau sempat diganti. Sandinya di-hash
     * oleh cast 'hashed' pada model User, jadi ditulis polos di sini.
     */
    public function run(): void
    {
        User::updateOrCreate(
            ['username' => 'admin'],
            [
                'name' => 'Administrator',
                'email' => 'admin@wms.local',
                'password' => 'password',
            ],
        );
    }
}
