<?php

namespace Database\Seeders;

use App\Http\Controllers\SkemaIrigasiController;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class SkemaIrigasiDummySeeder extends Seeder
{
    /**
     * Pos AWLR skema bendung gerak. Pintu (AWGC) tidak didaftar di sini — pintu
     * diturunkan otomatis dari edge topologi pada run().
     * sensor1 = TMA (cm), sensor2 = debit acuan (m³/dtk).
     */
    private array $nodes = [
        ['id' => 'AWLR_HULU',      'nama' => 'AWLR Hulu Bendung',       'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 325, 'sensor2' => 14.20, 'note' => 'NORMAL - Sungai Cimanuk sebelum bendung'],
        ['id' => 'AWLR_KOLAM',     'nama' => 'AWLR Kolam Bendung',      'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 240, 'sensor2' =>  4.89, 'note' => 'NORMAL - Kolam bendung / kantong lumpur'],
        ['id' => 'AWLR_SEKUNDER',  'nama' => 'AWLR Saluran Sekunder',   'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 168, 'sensor2' =>  4.34, 'note' => 'NORMAL - Saluran sekunder induk (3 pengambilan)'],
        ['id' => 'AWLR_TERSIER_1', 'nama' => 'AWLR Tersier Ranca Ucing', 'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 118, 'sensor2' => 1.73, 'note' => 'NORMAL - Tersier Ranca Ucing'],
        ['id' => 'AWLR_TERSIER_2', 'nama' => 'AWLR Tersier Sawah Bera',  'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 112, 'sensor2' => 1.47, 'note' => 'NORMAL - Tersier Sawah Bera'],
        ['id' => 'AWLR_TERSIER_3', 'nama' => 'AWLR Tersier Leuwi Goong', 'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 104, 'sensor2' => 1.14, 'note' => 'NORMAL - Tersier Leuwi Goong'],
        ['id' => 'AWLR_HILIR',     'nama' => 'AWLR Hilir Bendung',      'jenis' => 'AWLR', 'bukaan' => null, 'sensor1' => 265, 'sensor2' =>  9.86, 'note' => 'NORMAL - Sungai Cimanuk setelah bendung'],
    ];

    private array $siagaLevels = [
        ['id_status' => 1, 'nama' => 'Normal',  'nilai' => 30,  'warna' => '#22c55e'],
        ['id_status' => 2, 'nama' => 'Siaga 1', 'nilai' => 80,  'warna' => '#f59e0b'],
        ['id_status' => 3, 'nama' => 'Banjir',  'nilai' => 150, 'warna' => '#ef4444'],
    ];

    private int $idLoggerBase = 90001;
    private int $instansiId = 1;

    /**
     * Histori yang ditulis meliputi tiga keadaan hulu berturut-turut, urut dari
     * yang paling lama ke yang paling baru. Jadi tabel sensor tidak cuma berisi
     * satu keadaan "normal" seperti sebelumnya: kekeringan, banjir, dan keadaan
     * wajar semuanya ada sebagai pembacaan sungguhan, dan pembacaan TERAKHIR —
     * yang jadi tampilan awal dashboard — sengaja keadaan normal.
     *
     * Urutan & panjang jendelanya milik controller supaya tampilan tahu menit
     * berapa saja tiap keadaan terekam; neraca airnya juga dari sana
     * (skenarioSnapshot), jadi data tersimpan dan tampilan tidak pernah berbeda.
     */
    private array $skenarioUrut;
    private int $menitPerSkenario;
    private int $menitPeralihan;

    public function __construct()
    {
        $this->skenarioUrut     = SkemaIrigasiController::SKENARIO_URUT;
        $this->menitPerSkenario = SkemaIrigasiController::SKENARIO_MENIT;
        $this->menitPeralihan   = SkemaIrigasiController::SKENARIO_PERALIHAN;
    }

    /** Neraca air tiap keadaan, dihitung sekali lalu dipakai ulang tiap simpul. */
    private array $snapshotSkenario = [];

    private function snapshot(string $key): array
    {
        if (!isset($this->snapshotSkenario[$key])) {
            $this->snapshotSkenario[$key] = SkemaIrigasiController::skenarioSnapshot($key);
        }

        return $this->snapshotSkenario[$key];
    }

    /**
     * Bobot tiap keadaan pada menit histori ke-$t. Di tengah jendela bobotnya
     * bulat satu keadaan; di batas antar jendela dua keadaan dicampur selama
     * beberapa menit supaya grafik tren tidak melompat tegak lurus — hidrograf
     * sungguhan pun naik-turun bertahap, bukan berpindah seketika.
     *
     * @return array<string, float>
     */
    private function campuranSkenario(int $t): array
    {
        $pos  = $t / $this->menitPerSkenario;
        $i    = min(count($this->skenarioUrut) - 1, (int) floor($pos));
        $frac = $pos - $i;
        $ramp = $this->menitPeralihan / $this->menitPerSkenario;

        if ($i > 0 && $frac < $ramp) {
            $m = $frac / $ramp;
            return [$this->skenarioUrut[$i - 1] => 1 - $m, $this->skenarioUrut[$i] => $m];
        }

        return [$this->skenarioUrut[$i] => 1.0];
    }

    /**
     * TMA (cm) & debit (m³/dtk) satu simpul pada menit histori ke-$t.
     * null bila simpulnya tidak terdaftar di BENDUNG_PANEL — simpul semacam itu
     * (AWLR dinamis dari topologi lama) tetap memakai nilai dasarnya sendiri.
     */
    private function nilaiSimpul(string $nodeId, int $t): ?array
    {
        $tma = 0.0;
        $tmaHilir = 0.0;
        $debit = 0.0;

        foreach ($this->campuranSkenario($t) as $key => $bobot) {
            $nilai = $this->snapshot($key)[$nodeId] ?? null;
            if (!$nilai) {
                return null;
            }
            $tma      += $nilai['tmaHulu'] * $bobot;
            $tmaHilir += $nilai['tmaHilir'] * $bobot;
            $debit    += $nilai['debit'] * $bobot;
        }

        return ['tma' => $tma, 'tmaHilir' => $tmaHilir, 'debit' => $debit];
    }

    /**
     * Besar riak pembacaan pada menit ke-$t. Nol pada jendela normal — bendung
     * yang bekerja wajar menahan muka air pada satu tinggi tetap — dan ikut
     * dicampur di batas antar jendela seperti nilai simpulnya.
     */
    private function amplitudoRiak(int $t): float
    {
        $amp = 0.0;
        foreach ($this->campuranSkenario($t) as $key => $bobot) {
            $amp += (SkemaIrigasiController::SKENARIO[$key]['amplitudo'] ?? 0.0) * $bobot;
        }

        return $amp;
    }

    private function resolveOperationalTarget(?string $targetId, array $nodesById, array $edges): ?string
    {
        if (!$targetId) {
            return null;
        }

        $visited = [];
        $current = $targetId;

        while ($current && !isset($visited[$current])) {
            $visited[$current] = true;
            $node = $nodesById[$current] ?? null;

            if (!$node || ($node['type'] ?? null) !== 'corner') {
                return $current;
            }

            $nextEdge = collect($edges)->first(fn ($edge) => ($edge['source'] ?? null) === $current);
            $current = $nextEdge['target'] ?? null;
        }

        return $targetId;
    }

    public function run(): void
    {
        $this->command->info('');
        $this->command->info('SkemaIrigasiDummySeeder - Mulai...');

        DB::table('t_s16_01')->whereBetween('id_logger', [90001, 90099])->delete();
        DB::table('temp_s16_latest')->whereBetween('id_logger', [90001, 90099])->delete();
        DB::table('tingkat_siaga_awlr')->whereBetween('id_logger', [90001, 90099])->delete();
        DB::table('t_logger')->whereBetween('id_logger', [90001, 90099])->delete();

        /* Hanya skema bendung gerak yang di-seed. Jaringan as-built lengkap tetap
           ada di legacyTopology() sebagai acuan, tetapi tidak lagi menghasilkan
           logger dummy — supaya daftar alat mencerminkan skema yang ditampilkan. */
        $topology = SkemaIrigasiController::bendungTopology();
        $edges = $topology['edges'] ?? [];
        $outgoingEdgeTypes = [];
        $outgoingTargets = [];

        foreach ($edges as $edge) {
            if (!in_array($edge['type'] ?? '', ['primary', 'secondary', 'tertiary'], true)) {
                continue;
            }

            $source = $edge['source'];
            $outgoingEdgeTypes[$source][] = $edge['type'];
            $outgoingTargets[$source][] = $edge['target'];
        }

        /* Kapasitas rencana tiap simpul skema bendung gerak. */
        $panelCapacities = [];
        foreach (SkemaIrigasiController::BENDUNG_PANEL as $id => $info) {
            $panelCapacities[$id] = (float) $info['kapasitas_m3s'];
        }
        $nodesById = collect($topology['nodes'] ?? [])->keyBy('id')->all();
        /* Tiap pintu pada skema ini hanya punya satu tujuan, jadi tidak ada
           percabangan yang perlu dipetakan tangan. */
        $explicitBranchTargets = [];

        foreach ($topology['nodes'] as $node) {
            $nodeId = $node['id'] ?? null;
            $nodeType = $node['type'] ?? null;

            if (!$nodeId || in_array($nodeType, ['title', 'label_text', 'label_yellow'], true)) {
                continue;
            }

            if ($nodeType === 'corner') {
                continue;
            }

            if ($nodeType === 'sensor_awlr') {
                $alreadyExists = collect($this->nodes)->contains(fn ($existing) => $existing['id'] === $nodeId);
                if (!$alreadyExists) {
                    $this->nodes[] = [
                        'id' => $nodeId,
                        'nama' => $node['nama_alat'] ?? ('AWLR ' . str_replace('AWLR_', '', $nodeId)),
                        'jenis' => 'AWLR',
                        'bukaan' => null,
                        'sensor1' => 55,
                        'sensor2' => null,
                        'note' => 'DYNAMIC AWLR SCADA',
                    ];
                }
                continue;
            }

            if (!isset($outgoingEdgeTypes[$nodeId])) {
                continue;
            }

            $types = $outgoingEdgeTypes[$nodeId];
            $maxDoorCount = in_array('primary', $types, true) ? 3 : (in_array('secondary', $types, true) ? 2 : 1);
            /* nama alat ditulis pada node bila ada; kalau tidak, jatuh ke pola lama */
            $nodeName = $node['nama_alat']
                ?? ($maxDoorCount > 1 ? 'AWGC Percabangan ' . $nodeId : 'AWGC Pintu ' . $nodeId);
            $kapasitasNode = $panelCapacities[$nodeId] ?? 0.5;
            $targets = $outgoingTargets[$nodeId] ?? [];

            if (isset($explicitBranchTargets[$nodeId])) {
                $target1 = $explicitBranchTargets[$nodeId]['sensor1'] ?? null;
                $target2 = $explicitBranchTargets[$nodeId]['sensor2'] ?? null;
                $target3 = $explicitBranchTargets[$nodeId]['sensor3'] ?? null;
            } else {
                $target1 = $this->resolveOperationalTarget($targets[0] ?? null, $nodesById, $edges);
                $target2 = $this->resolveOperationalTarget($targets[1] ?? null, $nodesById, $edges);
                $target3 = $this->resolveOperationalTarget($targets[2] ?? null, $nodesById, $edges);
            }

            /* Debit dummy tiap cabang dibatasi kapasitas pintunya sendiri, bukan
               kapasitas simpul tujuan. Tanpa batas ini, beberapa pintu yang
               bermuara ke simpul yang sama (3 floodway + scouring → hilir,
               3 pengambilan → satu saluran sekunder) masing-masing mewarisi
               kapasitas penuh muaranya, sehingga debitnya berlipat. */
            $capOf = function (?string $target) use ($panelCapacities, $kapasitasNode) {
                $kapTarget = $target ? ($panelCapacities[$target] ?? $kapasitasNode) : $kapasitasNode;
                return min($kapasitasNode, $kapTarget);
            };
            $kapTgt1 = $capOf($target1);
            $kapTgt2 = $capOf($target2);
            $kapTgt3 = $capOf($target3);

            /* Debit yang lewat pintu diambil dari neraca air skenario kalau
               simpulnya terdaftar di BENDUNG_PANEL — bukan lagi kapasitas × 0,75.
               Dengan begitu debit pintu ikut berubah saat keadaan hulu berubah,
               dan tetap tertutup terhadap debit saluran di hulu/hilirnya. */
            $debitRencana = SkemaIrigasiController::BENDUNG_PANEL[$nodeId]['debit_m3s'] ?? null;

            $this->nodes[] = [
                'id' => $nodeId,
                'nama' => $nodeName,
                'jenis' => 'AWGC',
                'bukaan' => 100,
                'sensor1' => $target1 ? 75 : null,
                'sensor2' => $target2 ? 75 : null,
                'sensor3' => $target3 ? 75 : null,
                'debit1' => $target1 ? round($debitRencana ?? ($kapTgt1 * 0.75), 2) : 0,
                'debit2' => $target2 ? round($kapTgt2 * 0.75, 2) : null,
                'debit3' => $target3 ? round($kapTgt3 * 0.75, 2) : null,
                'note' => 'DYNAMIC AWGC - Target Tgt1:' . $kapTgt1,
            ];
        }

        $now = now()->format('Y-m-d H:i:s');

        foreach ($this->nodes as $idx => $node) {
            $idLogger = $this->idLoggerBase + $idx;
            $nodeId = $node['id'];
            $jenis = $node['jenis'];

            DB::table('t_logger')->upsert(
                [[
                    'id_logger' => $idLogger,
                    'instansi_id' => $this->instansiId,
                    'nama_logger' => $node['nama'],
                    'tabel_main' => 't_s16_01',
                    'jeda_notif' => 60,
                    'idlokasi' => null,
                    'id_katlogger' => null,
                    'jenis_alat' => $jenis,
                    'node_skema_id' => $nodeId,
                    'bukaan_maksimal_cm' => $node['bukaan'],
                    'sensor_count' => 16,
                    'status_perbaikan' => 'normal',
                ]],
                ['id_logger'],
                ['nama_logger', 'jenis_alat', 'node_skema_id', 'bukaan_maksimal_cm', 'sensor_count']
            );

            if ($jenis === 'AWLR') {
                foreach ($this->siagaLevels as $lvlIdx => $lvl) {
                    DB::table('tingkat_siaga_awlr')->upsert(
                        [[
                            'id' => 9000 + ($idx * 10) + $lvlIdx,
                            'id_logger' => $idLogger,
                            'id_status' => $lvl['id_status'],
                            'nama' => $lvl['nama'],
                            'nilai' => $lvl['nilai'],
                            'status' => 1,
                            'warna' => $lvl['warna'],
                        ]],
                        ['id'],
                        ['nama', 'nilai', 'warna', 'id_logger']
                    );
                }
            }

            $historyData = [];
            $nowCarbon = now();
            $baseS1 = $node['sensor1'] ?? null;
            $baseS2 = $node['sensor2'] ?? null;
            $baseS3 = $node['sensor3'] ?? null;
            $latestRow = [];

            $totalMenit = count($this->skenarioUrut) * $this->menitPerSkenario;

            for ($t = 0; $t <= $totalMenit; $t++) {
                $time = (clone $nowCarbon)->subMinutes($totalMenit - $t);

                /* Fase riak kecil diambil dari urutan menit histori, bukan dari
                   menit jam dinding seperti sebelumnya. Dulu keduanya berbeda:
                   simhidro.js memutar ulang histori memakai nomor urut menit,
                   jadi pola yang tersimpan dan pola yang ditampilkan tidak
                   pernah berimpit. */
                $wave1 = 1.0 + $this->amplitudoRiak($t) * sin(deg2rad($t * 12.0));

                $nilai = $this->nilaiSimpul($nodeId, $t);

                $valS1 = ($jenis === 'AWLR' && $baseS1 !== null) ? round($baseS1 * $wave1) : ($baseS1 ?? 0);
                $valS2 = $baseS2 ?? 0;
                $valS3 = $baseS3 ?? 0;

                if ($jenis === 'AWLR' && $nilai) {
                    /* TMA hulu, TMA hilir, dan debit acuan ikut keadaan hulu pada
                       menit itu. TMA hilir ditulis di sensor3 — dulu kolom itu
                       selalu 0 — supaya pemutaran histori punya kedua muka air
                       sebagai pembacaan, bukan hasil menskala salah satunya. */
                    $valS1 = round($nilai['tma'] * $wave1);
                    $valS3 = round($nilai['tmaHilir'] * $wave1);
                    /* Debit ikut beriak, bukan cuma muka airnya: dulu kolom debit
                       tetap rata sepanjang jendela, jadi saat histori diputar
                       muka air bergerak sementara debitnya diam — dua bacaan dari
                       sungai yang sama tapi bercerita beda. */
                    $valS2 = round($nilai['debit'] * $wave1, 2);
                }

                $s4 = 0;
                $s5 = 0;
                $s6 = 0;
                if ($jenis === 'AWGC') {
                    $s4 = round((float) (($nilai['debit'] ?? $node['debit1'] ?? 0) * ($nilai ? $wave1 : 1)), 2);
                    $s5 = round((float) ($node['debit2'] ?? 0), 2);
                    $s6 = round((float) ($node['debit3'] ?? 0), 2);
                }

                $rowData = [
                    'id_logger' => $idLogger,
                    'waktu' => $time->format('Y-m-d H:i:s'),
                    'sensor1' => $valS1 ?? 0,
                    'sensor2' => $valS2 ?? 0,
                    'sensor3' => $valS3 ?? 0,
                    'sensor4' => $s4,
                    'sensor5' => $s5,
                    'sensor6' => $s6,
                    'sensor7' => 0,
                    'sensor8' => 0,
                    'sensor9' => 0,
                    'sensor10' => 0,
                    'sensor11' => 0,
                    'sensor12' => 0,
                    'sensor13' => 0,
                    'sensor14' => 0,
                    'sensor15' => 0,
                    'sensor16' => 0,
                ];

                $historyData[] = $rowData;
                if ($t === $totalMenit) {
                    /* Baris terakhir = keadaan normal; itulah yang dibaca
                       temp_s16_latest dan jadi tampilan awal dashboard. */
                    $latestRow = $rowData;
                }
            }

            DB::table('t_s16_01')->insert($historyData);

            DB::table('temp_s16_latest')->upsert(
                [[
                    'id_logger' => $idLogger,
                    'waktu' => $latestRow['waktu'],
                    'sensor1' => $latestRow['sensor1'] ?? 0,
                    'sensor2' => $latestRow['sensor2'] ?? 0,
                    'sensor3' => $latestRow['sensor3'] ?? 0,
                    'sensor4' => $latestRow['sensor4'] ?? 0,
                    'sensor5' => $latestRow['sensor5'] ?? 0,
                    'sensor6' => $latestRow['sensor6'] ?? 0,
                    'updated_at' => $now,
                ]],
                ['id_logger'],
                ['waktu', 'sensor1', 'sensor2', 'sensor3', 'sensor4', 'sensor5', 'sensor6', 'updated_at']
            );

            $statusIcon = $jenis === 'AWLR' ? 'AWLR' : 'AWGC';
            $this->command->line(sprintf('  %s [%d] %-12s sensor1=%-5s %s', $statusIcon, $idLogger, $nodeId, $node['sensor1'] ?? '-', $node['note']));
        }

        $urut = [];
        foreach ($this->skenarioUrut as $key) {
            $urut[] = SkemaIrigasiController::SKENARIO[$key]['label'] ?? $key;
        }

        $this->command->info('');
        $this->command->info(sprintf(
            'Histori %d menit: %s (%d menit tiap keadaan, peralihan %d menit).',
            count($this->skenarioUrut) * $this->menitPerSkenario,
            implode(' -> ', $urut),
            $this->menitPerSkenario,
            $this->menitPeralihan
        ));
        $this->command->info('Selesai! ' . count($this->nodes) . ' node dummy berhasil diinsert.');
    }
}
