<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\AdminUserSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class LoginTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(AdminUserSeeder::class);
    }

    public function test_tamu_dilempar_ke_halaman_masuk(): void
    {
        $this->get('/beranda')->assertRedirect('/masuk');
        $this->getJson('/api/skema/data')->assertUnauthorized();
    }

    public function test_halaman_masuk_tampil(): void
    {
        $this->get('/masuk')->assertOk()->assertSee('Nama pengguna')->assertSee('Kata sandi');
    }

    public function test_admin_bisa_masuk_dengan_password(): void
    {
        $this->post('/masuk', ['username' => 'admin', 'password' => 'password'])
            ->assertRedirect('/beranda');

        $this->assertAuthenticatedAs(User::where('username', 'admin')->first());
    }

    public function test_sandi_salah_ditolak(): void
    {
        $this->from('/masuk')
            ->post('/masuk', ['username' => 'admin', 'password' => 'salah'])
            ->assertRedirect('/masuk')
            ->assertSessionHasErrors('username');

        $this->assertGuest();
    }

    public function test_dikunci_sesudah_lima_kali_gagal(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->post('/masuk', ['username' => 'admin', 'password' => 'salah']);
        }

        // Sandi benar pun ditolak selama masih dikunci.
        $this->post('/masuk', ['username' => 'admin', 'password' => 'password'])
            ->assertSessionHasErrors('username');

        $this->assertGuest();
    }

    public function test_keluar(): void
    {
        $this->actingAs(User::where('username', 'admin')->first())
            ->post('/keluar')
            ->assertRedirect('/masuk');

        $this->assertGuest();
    }

    public function test_yang_sudah_masuk_tidak_melihat_halaman_masuk_lagi(): void
    {
        $this->actingAs(User::where('username', 'admin')->first())
            ->get('/masuk')
            ->assertRedirect('/beranda');
    }
}
