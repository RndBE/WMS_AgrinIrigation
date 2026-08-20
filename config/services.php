<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    |----------------------------------------------------------------------
    | Peta Lokasi
    |----------------------------------------------------------------------
    | cainfo: jalan ke berkas CA bundle (cacert.pem) untuk penerus ubin peta
    | di PetaLokasiController. Kosongkan kalau php.ini sudah punya curl.cainfo
    | yang benar — itu tempat yang seharusnya. Isian ini hanya jalan keluar
    | untuk mesin yang php.ini-nya tidak bisa disunting, biasanya PHP di
    | Windows yang terpasang tanpa CA bundle sama sekali; tanpa keduanya
    | seluruh permintaan HTTPS dari Laravel gagal, bukan hanya ubin peta.
    | Unduhan bundle-nya: https://curl.se/ca/cacert.pem
    */
    'peta' => [
        'cainfo' => env('PETA_TILE_CAINFO'),
    ],

];
