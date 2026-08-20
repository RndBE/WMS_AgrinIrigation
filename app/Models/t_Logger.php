<?php

namespace App\Models;

use App\Support\SensorFamily;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * Alat telemetri lapangan. Satu baris = satu logger AWLR/AWGC.
 *
 * Nama kelas mengikuti konvensi tabel legacy (t_logger) agar seragam dengan
 * modul lain yang sudah memakai nama ini.
 */
class t_Logger extends Model
{
    protected $table = 't_logger';

    protected $primaryKey = 'id_logger';

    public $incrementing = false;

    protected $keyType = 'int';

    protected $guarded = [];

    protected $casts = [
        'instansi_id'        => 'int',
        'sensor_count'       => 'int',
        'bukaan_maksimal_cm' => 'int',
        'jeda_notif'         => 'int',
    ];

    /**
     * Hanya alat yang sudah ditautkan ke sebuah node pada Skema Irigasi.
     */
    public function scopeLinkedToSkema(Builder $query): Builder
    {
        return $query->whereNotNull('node_skema_id');
    }

    public function temp16(): HasOne
    {
        return $this->hasOne(TempS16Latest::class, 'id_logger', 'id_logger');
    }

    public function temp19(): HasOne
    {
        return $this->hasOne(TempS19Latest::class, 'id_logger', 'id_logger');
    }

    public function temp50(): HasOne
    {
        return $this->hasOne(TempS50Latest::class, 'id_logger', 'id_logger');
    }

    public function tingkatSiagaAwlr(): HasMany
    {
        return $this->hasMany(TingkatSiagaAwlr::class, 'id_logger', 'id_logger');
    }

    /**
     * Pembacaan terakhir dari tabel cache yang sesuai keluarga sensor alat ini.
     */
    public function getTempAttribute(): ?TempSensorLatest
    {
        return match (SensorFamily::familyFor((int) $this->sensor_count)) {
            SensorFamily::FAMILY_50 => $this->temp50,
            SensorFamily::FAMILY_19 => $this->temp19,
            default                 => $this->temp16,
        };
    }

    /**
     * Nama tabel histori alat ini.
     */
    public function mainTable(): string
    {
        if ($this->tabel_main) {
            return $this->tabel_main;
        }

        return SensorFamily::mainTablePrefix(SensorFamily::familyFor((int) $this->sensor_count)) . '01';
    }
}
