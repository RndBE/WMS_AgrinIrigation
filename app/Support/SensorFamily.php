<?php

namespace App\Support;

/**
 * Alat telemetri dikelompokkan menurut jumlah kanal sensornya (16, 19, atau 50).
 * Tiap keluarga menyimpan datanya pada set tabel sendiri, sehingga nama tabel
 * histori maupun tabel cache pembacaan terakhir diturunkan dari jumlah sensor.
 */
class SensorFamily
{
    public const FAMILY_16 = 's16';
    public const FAMILY_19 = 's19';
    public const FAMILY_50 = 's50';

    /**
     * Tentukan keluarga sensor dari jumlah kanal yang dimiliki alat.
     */
    public static function familyFor(int $sensorCount): string
    {
        if ($sensorCount > 19) {
            return self::FAMILY_50;
        }

        if ($sensorCount > 16) {
            return self::FAMILY_19;
        }

        return self::FAMILY_16;
    }

    /**
     * Prefix tabel histori, mis. 't_s16_' sehingga tabel bulan pertama = 't_s16_01'.
     */
    public static function mainTablePrefix(string $family): string
    {
        return 't_' . $family . '_';
    }

    /**
     * Nama tabel cache pembacaan terakhir, mis. 'temp_s16_latest'.
     */
    public static function latestTable(string $family): string
    {
        return 'temp_' . $family . '_latest';
    }
}
