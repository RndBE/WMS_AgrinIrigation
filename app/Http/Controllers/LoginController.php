<?php

namespace App\Http\Controllers;

use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Illuminate\View\View;

/**
 * Masuk & keluar dasbor WMS.
 *
 * Akunnya di tabel users, dicocokkan lewat kolom username (bukan surel). Akun
 * bawaan admin / password dibuat AdminUserSeeder.
 */
class LoginController extends Controller
{
    /** Percobaan gagal per nama pengguna + IP sebelum dikunci sementara (±1 menit). */
    private const BATAS_PERCOBAAN = 5;

    public function create(): View
    {
        return view('auth.login');
    }

    public function store(Request $request): RedirectResponse
    {
        $kredensial = $request->validate([
            'username' => ['required', 'string', 'max:50'],
            'password' => ['required', 'string'],
        ], [
            'username.required' => 'Nama pengguna wajib diisi.',
            'password.required' => 'Kata sandi wajib diisi.',
        ]);

        // Dibatasi di sini, bukan dengan middleware throttle, supaya yang kena batas
        // tetap melihat formulirnya beserta pesan berapa lama harus menunggu —
        // bukan halaman galat 429 polos.
        $kunci = Str::transliterate(Str::lower($kredensial['username']) . '|' . $request->ip());

        if (RateLimiter::tooManyAttempts($kunci, self::BATAS_PERCOBAAN)) {
            throw ValidationException::withMessages([
                'username' => 'Terlalu banyak percobaan masuk. Coba lagi dalam '
                    . RateLimiter::availableIn($kunci) . ' detik.',
            ]);
        }

        if (! Auth::attempt($kredensial, $request->boolean('remember'))) {
            RateLimiter::hit($kunci);

            // Pesan sengaja tidak membedakan nama pengguna salah dan sandi salah,
            // supaya halaman ini tidak bisa dipakai menebak nama akun yang ada.
            throw ValidationException::withMessages([
                'username' => 'Nama pengguna atau kata sandi salah.',
            ]);
        }

        RateLimiter::clear($kunci);
        $request->session()->regenerate();

        // intended(): kembali ke halaman yang tadi dibuka sebelum dilempar ke sini,
        // mis. tautan langsung ke /kontrol-pintu/{node_id}.
        return redirect()->intended(route('view.dashboard'));
    }

    public function destroy(Request $request): RedirectResponse
    {
        Auth::logout();

        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return redirect()->route('login');
    }
}
