<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class TingkatSiagaAwlr extends Model
{
    protected $table = 'tingkat_siaga_awlr';

    public $incrementing = false;

    public $timestamps = false;

    protected $guarded = [];

    protected $casts = [
        'nilai'     => 'float',
        'id_status' => 'int',
        'status'    => 'int',
    ];
}
