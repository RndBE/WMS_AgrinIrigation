<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * Induk model cache pembacaan terakhir. Tiap keluarga sensor (16/19/50)
 * memakai tabel sendiri; turunan hanya mengganti properti $table.
 */
abstract class TempSensorLatest extends Model
{
    protected $primaryKey = 'id_logger';

    public $incrementing = false;

    protected $keyType = 'int';

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'waktu'   => 'datetime',
        'sensor1' => 'float',
        'sensor2' => 'float',
        'sensor3' => 'float',
        'sensor4' => 'float',
        'sensor5' => 'float',
        'sensor6' => 'float',
    ];
}
