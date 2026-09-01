/* =========================================================================
   SIMHIDRO v2 — Bendung Gerak: 3 floodway + scouring, kolam bendung,
   3 pintu pengambilan → satu saluran sekunder → 3 tersier → 3 petak sawah
   ========================================================================= */
const g = 9.81;

function manningCalc(h, B, n, S0) {
  if (h <= 0.001) return { Q: 0, V: 0, A: 0, P: 0, R: 0 };
  const A = B * h, P = B + 2 * h, R = A / P;
  const V = (1 / n) * Math.pow(R, 2 / 3) * Math.sqrt(S0);
  return { Q: V * A, V, A, P, R };
}
function manningInvertH(Q, B, n, S0, hMax) {
  let lo = 0, hi = hMax;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (manningCalc(mid, B, n, S0).Q < Q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
function gateDischarge(hUp, hDown, a, b, Cd) {
  if (a <= 0.0005 || hUp <= 0.01) return { Q: 0, regime: '-' };
  const aEff = Math.min(a, hUp);
  let dh, regime;
  if (hDown < 0.67 * hUp) { dh = Math.max(hUp - aEff / 2, 0.01); regime = 'bebas'; }
  else { dh = Math.max(hUp - hDown, 0); regime = 'tenggelam'; }
  return { Q: Cd * b * aEff * Math.sqrt(2 * g * dh), regime };
}
function fieldWeirQ(h, Cw, b) { return h <= 0.001 ? 0 : Cw * b * Math.pow(h, 1.5); }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// PI + anti-windup (conditional integration) + rate limiter fisik pada bukaan pintu
function piStep(err, ctrl, gains, aMax, dt) {
  const rawCmd = gains.Kp * err + gains.Ki * ctrl.i;
  const satHigh = rawCmd > aMax && err > 0;
  const satLow = rawCmd < 0 && err < 0;
  if (!satHigh && !satLow) ctrl.i += err * dt;
  ctrl.i = clamp(ctrl.i, -200, 200);
  const cmd = clamp(gains.Kp * err + gains.Ki * ctrl.i, 0, aMax);
  ctrl.a += clamp(cmd - ctrl.a, -gains.rate * dt, gains.rate * dt);
  return ctrl.a;
}

/* ---------------- Konstanta tetap (asumsi teknis, ditampilkan sbg info) ---------------- */
const FIXED = {
  nRiver: 0.034, S0River: 0.00035,      // kekasaran & kemiringan sungai utama
  poolL: 300, secL: 300, tertL: 200,     // panjang segmen (m) — asumsi tetap
  CdPrimary: 0.68, CdSecondary: 0.62, CdTertiary: 0.62,
  fieldCw: 1.7, fieldB: 1.5,              // ambang lebar menuju petak sawah
};
/* ---------------- Bendung: mercu tetap & tampungan hulu ----------------

   Sampai sebelum ini muka air hulu dibaca mentah dari snapshot
   (`state.hUp = m(N.WEIR_COPONG.tmaHulu)`) dan limpasan ambang dihitung sebagai
   SISA (`Qspill = qLimpas - Qflood`). Dua-duanya membuat bendung tidak pernah
   membendung: menutup seluruh pintu floodway & scouring tidak menaikkan muka air
   hulu satu sentimeter pun, dan debit hilir tetap sebesar debit sungai karena
   air yang tidak lewat pintu langsung dianggap melimpas.

   Sekarang hulu punya TAMPUNGAN sungguhan. Neraca volumenya:

     dS/dt = Qsungai − (Qscouring + Qfloodway + Qmercu)
     h_hulu = S / (B_sungai × HULU_L)

   Jadi begitu pintu ditutup, keluaran turun di bawah masukan, S naik, dan muka
   air hulu merangkak naik sampai melewati mercu — barulah air keluar lagi lewat
   limpasan. Selama pengisian itu debit hilir memang berkurang; setelah muka air
   setimbang di atas mercu, hilir pulih ke debit sungai. Itu perilaku bendung
   yang sebenarnya, dan itu yang dulu tidak ada.

   HULU_L — panjang pengaruh bendungan (backwater) di hulu. Menentukan seberapa
   cepat mukanya naik: pada keadaan normal (28,2 m³/dtk) menutup seluruh pintu
   menaikkan muka air 1,43 → ±3,0 m dalam ±45 menit rekaman, yaitu ±12 detik
   nyata pada laju putar bawaan (satu tick 260 ms = satu menit rekaman).

   MERCU_RASIO — elevasi mercu terhadap TMA hulu RANCANGAN (D.nodes, bukan
   snapshot skenario yang sedang berjalan): mercu adalah bangunan, tinggal
   tetap walau keadaan hulu berganti. 1,15 menaruhnya di ATAS muka air operasi
   normal, jadi pada bukaan acuan keadaan normal & kemarau tidak melimpas sama
   sekali — sama seperti pembagian yang lama. */
/* Tinggi tanggul KOLAM BENDUNG — 3,20 m, bukan tanggul sungai 6,0 m.

   Data tidak memuat tinggi tanggul kantong lumpur sama sekali, jadi angkanya
   dipilih di sini. DUA syarat yang harus dipenuhi sekaligus:

   1. SEBANDING dengan saluran sekunder pada keadaan normal. Terhadap tanggul
      sungai 6,0 m kolom air kolam cuma mengisi 22,7% kotaknya sementara saluran
      sekunder mengisi 50%, jadi dua kotak yang airnya sama-sama di tinggi
      operasi tidak pernah terbaca sebanding — dan pin kolam terbaca "kering"
      pada kemarau padahal debitnya praktis sama dengan sekunder.

   2. TIDAK LUBER saat banjir. Muka air kolam mengikuti muka air hulu, dan pada
      keadaan banjir ia mencapai 2,96 m. Tanggul 2,70 m — yang sempat dipakai —
      membuat kolomnya mentok 105% dan tergambar jebol, padahal kelasnya biru:
      pesan yang saling bertentangan di satu kotak yang sama.

   2,70 m memenuhi keduanya sejak pintu intake pindah ke MULUT kolam: muka air
   kantong lumpur tidak lagi mengikuti muka air hulu, melainkan ditentukan debit
   yang lewat, dan tidak pernah melewati ±1,4 m. Kolom airnya jadi 50% (normal),
   46% (banjir), 19% (kemarau) — sebanding dengan saluran sekunder yang 50%, dan
   tidak pernah mentok. Angka 2,70 sendiri berasal dari perbandingan yang dipakai
   saluran sekunder: tanggul 2,0 m terhadap muka air operasi 1,00 m, jadi kolam
   yang operasinya 1,36 m mendapat 1,36 / 0,50 = 2,72 → 2,70 m. */
const POOL_HMAX = 2.70;

const HULU_L = 800;         // m, panjang backwater di hulu bendung
const MERCU_RASIO = 1.15;   // elevasi mercu / TMA hulu rancangan
const MERCU_CW = 1.70;      // koefisien ambang lebar mercu
const MERCU_RASIO_B = 0.35; // lebar mercu / lebar sungai (sisanya ditempati pintu)

const G_BIG = { Kp: 0.8, Ki: 0.02, rate: 0.02 };     // gain pintu pengendali TMA (primer & sekunder)
const G_SMALL = { Kp: 0.12, Ki: 0.03, rate: 0.0015 }; // gain pintu pengendali debit (tersier)
const DT = 5;

/* Nama rantai jaringan nyata DI Leuwigoong. Satu sumber untuk nama pintu,
   nama saluran tersier, dan label skema; ditimpa snapshot dummy bila ada. */
const CHAIN_NAMES = [
  { sec: 'Parigi', tert: 'Ranca Ucing' },
  { sec: 'Cikananga', tert: 'Sawah Bera' },
  { sec: 'Ciduga', tert: 'Leuwi Goong' },
];

/* ---------------- State ---------------- */
function freshState() {
  return {
    running: false, speed: 4, simTime: 0, scenario: 'normal',
    Qnat: 30, QnatTarget: 30,

    river: { B: 30, Hmax: 6 },           // penampang sungai utama
    targetPoolLevel: 2.5,
    /* Kolam bendung punya TINGGI TANGGUL SENDIRI (Hmax), tidak lagi meminjam
       tanggul sungai. Lihat POOL_HMAX. */
    pool: { h: 2.0, S: 0, Hmax: 2.7 },

    /* Tampungan hulu bendung. `S` volume (m³), `hMercu` elevasi mercu (m).
       `siap` false selama tampungan belum dipatok ke keadaan acuan — dipatok di
       initDummyGates() dan tiap kali pemutaran direset. */
    hulu: { S: 0, hMercu: 0, bMercu: 0, siap: false },

    /* Pintu primer bendung: tiga floodway melimpaskan ke hilir sungai,
       satu pintu scouring menguras kantong lumpur ke hilir. */
    primary: [
      { name: 'Floodway 1', role: 'floodway', b: 8, aMax: 3.0, mode: 'auto', manualA: 1.2, ctrl: { i: 0, a: 1.2 } },
      { name: 'Floodway 2', role: 'floodway', b: 8, aMax: 3.0, mode: 'auto', manualA: 1.2, ctrl: { i: 0, a: 1.2 } },
      { name: 'Floodway 3', role: 'floodway', b: 8, aMax: 3.0, mode: 'auto', manualA: 1.2, ctrl: { i: 0, a: 1.2 } },
      { name: 'Pintu Scouring', role: 'scouring', b: 6, aMax: 3.0, mode: 'auto', manualA: 1.2, ctrl: { i: 0, a: 1.2 } },
    ],

    /* Tiga pintu intake mengisi kantong lumpur dari hulu. Air lalu mengalir ke
       satu saluran sekunder; kendali intake menyeimbangkan kedua tampungan. */
    secondary: {
      canal: { B: 8, Hmax: 2.4, h: 1.0, S: 0 },
      targetLevel: 1.0,
      gates: CHAIN_NAMES.map(c => ({
        name: 'Intake ' + c.sec, b: 2.5, aMax: 1.2,
        mode: 'auto', manualA: 0.1, ctrl: { i: 0.5, a: 0.1 },
      })),
    },

    tertiary: CHAIN_NAMES.map(c => ({
      canal: { B: 2.5, Hmax: 1.2, h: 0.3, S: 0 },
      gate: { name: 'Tersier ' + c.tert, b: 1.2, aMax: 0.8, mode: 'auto', manualA: 0.05, ctrl: { i: 0.5, a: 0.05 } },
    })),

    areas: [
      { name: 'Sawah Blok 1', ha: 120 },
      { name: 'Sawah Blok 2', ha: 150 },
      { name: 'Sawah Blok 3', ha: 90 },
    ],
    duty: 1.0, // l/dtk/ha — kebutuhan air per hektar

    thresholds: {
      river: defaultThresholds(),
      sec: defaultThresholds(),
      tert: [defaultThresholds(0.08), defaultThresholds(0.08), defaultThresholds(0.08)],
    },

    // hasil hitung tiap tick
    hUp: 1.2, vUp: 0, QgateTotal: 0, Qhilir: 0, vPool: 0,
    /* Qflood = lewat pintu floodway · Qspill = melimpas di atas ambang bendung.
       Keduanya sampai ke hilir; dipisah supaya bacaan pintu dan neraca air bisa
       menyebut yang mana. */
    Qflood: 0, Qspill: 0, Qscour: 0,
    Qsec: [0, 0, 0], QsecTotal: 0, vSec: 0,
    Qtert: [0, 0, 0], vTert: [0, 0, 0],
    Qfield: [0, 0, 0],
    allocFactor: 1, totalDemand: 0, totalDelivered: 0,
    status: 'NORMAL', _dStotalDt: 0,
  };
}
const state = freshState();
state.pool.S = state.pool.h * state.river.B * FIXED.poolL;
state.secondary.canal.S = state.secondary.canal.h * state.secondary.canal.B * FIXED.secL;
state.tertiary.forEach(t => t.canal.S = t.canal.h * t.canal.B * FIXED.tertL);

let lastStatus = 'NORMAL';
let lastSatLog = -99999;

/* ---------------- Log ---------------- */
function fmtClock(sec) {
  sec = Math.floor(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return (d > 0 ? d + 'h ' : '') + `${pad(h)}:${pad(m)}:${pad(s)}`;
}
function pushLog(msg, level = 'info') {
  const list = document.getElementById('logList');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'log-entry ' + level;
  div.innerHTML = `<span class="t">${fmtClock(state.simTime)}</span><span class="msg">${msg}</span>`;
  list.appendChild(div);
  while (list.children.length > 150) list.removeChild(list.firstChild);
}

/* ---------------- Satu langkah simulasi ---------------- */
function stepSimulation() {
  const dt = DT;
  state.simTime += dt;

  const t = state.simTime;
  if (state.scenario === 'normal') state.QnatTarget = 30 + 6 * Math.sin(t / 3000);
  else if (state.scenario === 'flood') state.QnatTarget = 110 + 12 * Math.sin(t / 1400);
  else if (state.scenario === 'drought') state.QnatTarget = 5 + 1 * Math.sin(t / 4000);
  state.Qnat += (state.QnatTarget - state.Qnat) * 0.01 + (Math.random() - 0.5) * 0.5;
  state.Qnat = Math.max(1.2, state.Qnat);

  const hUp = manningInvertH(state.Qnat, state.river.B, FIXED.nRiver, FIXED.S0River, state.river.Hmax);
  const vUp = manningCalc(hUp, state.river.B, FIXED.nRiver, FIXED.S0River).V;
  state.hUp = hUp; state.vUp = vUp;

  const Sbefore = state.pool.S + state.secondary.canal.S + state.tertiary.reduce((a, t) => a + t.canal.S, 0);

  // pintu primer -> kolam (kendali TMA kolam)
  let QgateTotal = 0, Qscour = 0, Qflood = 0;
  for (let k = 0; k < state.primary.length; k++) {
    const pg = state.primary[k];
    const err = state.targetPoolLevel - state.pool.h;
    let a;
    if (pg.mode === 'auto') a = piStep(err, pg.ctrl, G_BIG, pg.aMax, dt);
    else { pg.ctrl.a += clamp(clamp(pg.manualA, 0, pg.aMax) - pg.ctrl.a, -G_BIG.rate * dt, G_BIG.rate * dt); a = pg.ctrl.a; }
    const Qk = gateDischarge(hUp, state.pool.h, a, pg.b, FIXED.CdPrimary).Q;
    QgateTotal += Qk;
    if (pg.role === 'scouring') Qscour += Qk;
    else if (pg.role === 'floodway') Qflood += Qk;
  }
  state.QgateTotal = QgateTotal;
  state.Qscour = Qscour;
  state.Qflood = Qflood;

  // estimasi alokasi adaptif (pasokan vs total kebutuhan sawah)
  const targetQfield = state.areas.map(a => (state.duty * a.ha) / 1000);
  const totalDemand = targetQfield.reduce((a, b) => a + b, 0);
  let allocFactor = 1;
  if (QgateTotal < totalDemand * 1.2 && totalDemand > 0) allocFactor = clamp((QgateTotal * 0.9) / totalDemand, 0.1, 1);
  const prevAlloc = state.allocFactor;
  state.allocFactor = allocFactor;
  if (allocFactor < 0.98 && prevAlloc >= 0.98) pushLog(`Pasokan pintu primer tak cukup untuk total kebutuhan sawah — alokasi adaptif diaktifkan (${(allocFactor * 100).toFixed(0)}%).`, 'warn');
  else if (allocFactor >= 0.98 && prevAlloc < 0.98) pushLog('Pasokan kembali mencukupi — alokasi irigasi dikembalikan ke 100% target.', 'ok');
  state.totalDemand = totalDemand;

  /* Tiga pintu pengambilan menarik dari kolam ke SATU saluran sekunder; ketiganya
     mengejar target TMA saluran yang sama, seperti pintu primer terhadap kolam. */
  const sec = state.secondary, secCanal = sec.canal;
  const Qsec = [0, 0, 0];
  for (let i = 0; i < sec.gates.length; i++) {
    const sg = sec.gates[i];
    const err = sec.targetLevel - secCanal.h;
    let a;
    if (sg.mode === 'auto') a = piStep(err, sg.ctrl, G_BIG, sg.aMax, dt);
    else { sg.ctrl.a += clamp(clamp(sg.manualA, 0, sg.aMax) - sg.ctrl.a, -G_BIG.rate * dt, G_BIG.rate * dt); a = sg.ctrl.a; }
    Qsec[i] = gateDischarge(state.pool.h, secCanal.h, a, sg.b, FIXED.CdSecondary).Q;
  }
  const QsecTotal = Qsec.reduce((a, b) => a + b, 0);

  // neraca kolam
  const poolManning = manningCalc(state.pool.h, state.river.B, FIXED.nRiver, FIXED.S0River);
  state.pool.S += (QgateTotal - QsecTotal - poolManning.Q) * dt;
  state.pool.S = Math.max(0, state.pool.S);
  state.pool.h = Math.min(state.river.Hmax * 1.05, state.pool.S / (state.river.B * FIXED.poolL));
  state.Qhilir = poolManning.Q;
  /* Arus kolam = debit masuk dibagi luas penampangnya, bukan kecepatan Manning
     poolManning.V — arti yang sama dengan jalur data dummy, supaya satu field
     tidak punya dua makna. poolManning tetap dipakai untuk DEBIT keluarannya
     (state.Qhilir di atas); yang tidak dipakai lagi hanya kecepatannya. */
  state.vPool = QgateTotal / (state.river.B * Math.max(state.pool.h, 0.05));
  /* Kedalaman & arus ruas hilir — dihitung di sini juga, dengan rumus yang sama
     dengan applyDummySnapshot(), supaya nilainya tidak pernah tertinggal dari
     mode pemutaran data yang mungkin jalan sebelumnya. */
  state.hHilir = manningInvertH(state.Qhilir, state.river.B, FIXED.nRiver,
                                FIXED.S0River, state.river.Hmax * 1.05);
  state.vHilir = state.hHilir > 0.01
    ? state.Qhilir / (state.river.B * state.hHilir) : 0;
  state.Qsec = Qsec;
  state.QsecTotal = QsecTotal;

  // pintu tersier menarik dari saluran sekunder (kendali DEBIT ke sawah — loop utama irigasi)
  const Qtert = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const tg = state.tertiary[i].gate;
    Qtert[i] = gateDischarge(secCanal.h, state.tertiary[i].canal.h, tg.ctrl.a, tg.b, FIXED.CdTertiary).Q;
  }
  // update saluran sekunder (in=ΣQsec dari 3 pintu, out=ΣQtert ke 3 tersier)
  const QtertTotal = Qtert.reduce((a, b) => a + b, 0);
  secCanal.S = Math.max(0, secCanal.S + (QsecTotal - QtertTotal) * dt);
  secCanal.h = Math.min(secCanal.Hmax * 1.05, secCanal.S / (secCanal.B * FIXED.secL));

  // debit ke sawah via ambang lebar (weir bebas, tak terkendali langsung)
  const Qfield = [0, 0, 0];
  for (let i = 0; i < 3; i++) Qfield[i] = fieldWeirQ(state.tertiary[i].canal.h, FIXED.fieldCw, FIXED.fieldB);
  // update saluran tersier (in=Qtert, out=Qfield)
  for (let i = 0; i < 3; i++) {
    const c = state.tertiary[i].canal;
    c.S += (Qtert[i] - Qfield[i]) * dt;
    c.S = Math.max(0, c.S);
    c.h = Math.min(c.Hmax * 1.05, c.S / (c.B * FIXED.tertL));
  }

  // kendali pintu tersier (bukaan utk step berikutnya, berdasar error debit saat ini)
  const targetQfieldArr = targetQfield;
  for (let i = 0; i < 3; i++) {
    const tg = state.tertiary[i].gate;
    const targetEff = targetQfieldArr[i] * allocFactor;
    const err = targetEff - Qfield[i];
    if (tg.mode === 'auto') piStep(err, tg.ctrl, G_SMALL, tg.aMax, dt);
    else tg.ctrl.a += clamp(clamp(tg.manualA, 0, tg.aMax) - tg.ctrl.a, -G_SMALL.rate * dt, G_SMALL.rate * dt);
  }

  state.Qtert = Qtert;
  state.Qfield = Qfield;
  state.totalDelivered = Qfield.reduce((a, b) => a + b, 0);

  const Safter = state.pool.S + state.secondary.canal.S + state.tertiary.reduce((a, t) => a + t.canal.S, 0);
  state._dStotalDt = (Safter - Sbefore) / dt;

  // sensor arus (kontinuitas Q/A) pada saluran sekunder & tersier
  const As = secCanal.B * secCanal.h;
  state.vSec = As > 0.01 ? QtertTotal / As : 0;
  for (let i = 0; i < 3; i++) {
    const At = state.tertiary[i].canal.B * state.tertiary[i].canal.h;
    state.vTert[i] = At > 0.01 ? Qfield[i] / At : 0;
  }

  // status siaga (berbasis TMA maks relatif thd tanggul, kolam & sungai utama)
  const maxRatio = Math.max(hUp / state.river.Hmax, state.pool.h / state.river.Hmax);
  let status = 'NORMAL';
  if (maxRatio >= 0.95) status = 'AWAS'; else if (maxRatio >= 0.80) status = 'SIAGA'; else if (maxRatio >= 0.60) status = 'WASPADA';
  state.status = status;
  if (status !== lastStatus) {
    const lvl = status === 'AWAS' ? 'danger' : (status === 'SIAGA' || status === 'WASPADA') ? 'warn' : 'ok';
    pushLog(`Status sistem berubah: ${lastStatus} → ${status} (TMA maks ${(maxRatio * 100).toFixed(0)}% dari tanggul).`, lvl);
    lastStatus = status;
  }
  if (state.simTime - lastSatLog > 600 && state.pool.h < state.targetPoolLevel - 0.2 &&
      state.primary.every(p => p.mode === 'auto' && p.ctrl.a >= p.aMax - 0.05)) {
    pushLog('Ketiga pintu primer sudah bukaan maksimum namun TMA kolam masih di bawah target — pasokan sungai alami terbatas.', 'warn');
    lastSatLog = state.simTime;
  }
}

/* status kebutuhan irigasi: Ideal / Cukup / Kurang / Lebih */
function irrigationStatus(actual, required) {
  if (required <= 0.0001) return { label: 'Ideal', cls: 'ideal', r: 1 };
  const r = actual / required;
  if (r < 0.85) return { label: 'Kurang', cls: 'kurang', r };
  if (r < 0.97) return { label: 'Cukup', cls: 'cukup', r };
  if (r <= 1.10) return { label: 'Ideal', cls: 'ideal', r };
  return { label: 'Lebih', cls: 'lebih', r };
}

/* ---------------- Klasifikasi status warna TMA (kering/normal/waspada/siaga/bahaya) ---------------- */
function defaultThresholds(kering) { return { kering: kering != null ? kering : 0.15, waspada: 0.60, siaga: 0.80, bahaya: 0.95 }; }
function levelStatus(h, hmax, th) {
  const r = hmax > 0 ? h / hmax : 0;
  if (r < th.kering) return 'kering';
  if (r < th.waspada) return 'normal';
  if (r < th.siaga) return 'waspada';
  if (r < th.bahaya) return 'siaga';
  return 'bahaya';
}
const LEVEL_LABEL = { kering: 'Kering', normal: 'Normal', waspada: 'Waspada', siaga: 'Siaga', bahaya: 'Bahaya' };

/* Kelas satu ruas dari DEBIT terhadap kapasitas bangunannya, memakai kosakata yang
 * sama dengan levelStatus() supaya keduanya bisa digabung.
 *
 * Ambang peringatan dimulai di 100% kapasitas, bukan 60% seperti ambang TMA, karena
 * debit rancangan sudah 28,17 dari kapasitas 35 = 80%: memakai 60% membuat keadaan
 * NORMAL langsung berstatus waspada. 100% & 135% sengaja sama dengan ambang kelas
 * aliran "deras" & "genangan" di FLOW_AMBANG, dan sama dengan ambang lencana status
 * di dummyStatusStep() — tiga tempat, satu tangga.
 *
 * Batas "kering" 25%: di bawah seperempat kapasitas, bangunan mengalirkan jauh lebih
 * sedikit daripada yang direncanakan untuknya. Debit sungai kemarau 4,79 dari 35 =
 * 13,7% jatuh ke situ. */
const DEBIT_AMBANG = [['bahaya', 2.00], ['siaga', 1.35], ['waspada', 1.00], ['normal', 0.25]];
function debitStatus(Q, kapasitas) {
  if (!(kapasitas > 0)) return 'normal';
  const r = (Q || 0) / kapasitas;
  for (const [kelas, min] of DEBIT_AMBANG) if (r >= min) return kelas;
  return 'kering';
}

/* Kelas satu ruas dari DUA ukuran: muka air terhadap tanggul, DAN debit terhadap
 * kapasitas. Yang terberat di antara keduanya yang dipakai.
 *
 * Satu ukuran saja membuat kedua paruh peta isometrik memberi isyarat skenario yang
 * berlawanan. Dengan hanya rasio TMA:
 *
 *   · Sungai tidak pernah bisa menunjukkan banjir. Tanggulnya 6 m, sementara TMA
 *     banjir cuma 3,13 m = 52,3% — di bawah ambang waspada 60%. Jadi airnya tetap
 *     biru "normal" padahal sungai membawa 104 m³/dtk = 298% kapasitas bendung.
 *   · Jaringan irigasi tidak pernah bisa menunjukkan kemarau. Rasionya 27-37%, jauh
 *     di atas ambang kering 8-15%.
 *
 * Hasilnya: kemarau tergambar "sungai coklat, jaringan biru"; banjir tergambar
 * "sungai biru, jaringan kuning" — persis terbalik. Ini akar yang sama dengan lencana
 * status yang sudah dibetulkan lebih dulu, dan diselesaikan dengan cara yang sama.
 *
 * URUTAN BERAT menaruh "kering" DI ATAS "normal" tetapi DI BAWAH "waspada": kering itu
 * kekurangan air, waspada ke atas kelebihan air — dua arah berbeda dari keadaan wajar.
 * Kalau satu ukuran berkata kering sementara yang lain berkata waspada (air sangat
 * rendah tapi debit sangat besar — keadaan yang saling bertentangan), yang menang
 * peringatan kelebihannya, karena itu yang berbahaya. */
const LEVEL_URUT = ['normal', 'kering', 'waspada', 'siaga', 'bahaya'];
function reachStatus(h, hMax, th, Q, kapasitas) {
  const a = levelStatus(h, hMax, th), b = debitStatus(Q, kapasitas);
  return LEVEL_URUT[Math.max(LEVEL_URUT.indexOf(a), LEVEL_URUT.indexOf(b))];
}

const FIELD_STATUS_COLOR = { kurang: '#dbb08f', cukup: '#e6d79a', ideal: '#9dc48a', lebih: '#cbd97e' };

/* Nama rantai dari snapshot dummy; CHAIN_NAMES jadi cadangan bila belum termuat. */
function skNames(i) {
  const r = ((window.WMS_DUMMY || {}).rantai || [])[i] || {};
  return { sec: r.namaIntake || r.namaSekunder || CHAIN_NAMES[i].sec, tert: r.namaTersier || CHAIN_NAMES[i].tert };
}

/* =========================================================================
   SKEMATIK — diagram mimik potongan melintang
   =========================================================================
   Tata letak & ukurannya mengikuti prototipe SIMHIDRO v2 (buildSchematic +
   laneSVG pada berkas simulasi-water-management-irigasi.html): satu pita
   sungai membentang di atas — hulu, lubang-lubang pintu, kolam bendung, panah
   ke hilir — lalu tiga rantai irigasi menggantung di bawahnya, masing-masing
   pintu sekunder → saluran → pintu tersier → saluran → petak sawah. Koordinat
   viewBox-nya dilebarkan 1200 → 1500 (tinggi 660 tetap) supaya ilustrasi sungai
   hulu–hilir lebih panjang — lihat SKL.bandW.

   Yang disesuaikan dengan aplikasi sekarang:
   · warna gelap prototipe diganti palet kop instansi (kertas putih, garis
     abu-biru, air biru rata SKC.water, daun pintu --brass);
   · pintu scouring — tidak ada di prototipe — ditambahkan di kiri Floodway 1,
     dan sadapan ke jaringan irigasi menurun dari sungai di HULU pintu itu,
     mengikuti susunan bendung sebenarnya: penguras berdiri di sebelah
     pengambilan untuk membilas endapan di depannya;
   · seluruh kolom air memakai SATU warna RATA (SKC.water) — tanpa gradasi.
     Dulu tiap kotak diwarnai menurut kelas alirannya, dan ruas bersebelahan
     tampil beda warna sehingga gambarnya terbaca seperti peta panas, bukan
     potongan satu jaringan. Kelas aliran tetap dihitung dan tetap dipakai
     menghentikan gores permukaan pada ruas yang tidak mengalir; keadaan tiap
     ruas dibaca dari angka TMA & arus di sebelahnya. Peta isometrik tidak
     terpengaruh — pewarnaannya memakai levelStatus() (ambang TMA terhadap
     tinggi tanggul), bukan kelas aliran ini;
   · nama pintu & petak diambil dari snapshot data, bukan nomor urut.

   CATATAN MODEL: ketiga rantai berbagi SATU saluran sekunder — tiga pintu
   pengambilan mengisi saluran yang sama — jadi tiga kotak "Sal. Sekunder"
   memang menampilkan TMA dan arus yang sama. Keterangannya ditulis di kolom
   Keterangan supaya angka kembar itu tidak dikira salah baca. */

const SKC = {
  /* Air: SATU warna rata, bukan gradasi.
     Dulu tiap kolom air diisi gradasi tegak --water-top -> --water-bot. Gradasi SVG
     bawaannya berpatokan pada kotak yang diisinya (objectBoundingBox), jadi begitu
     tinggi kolomnya berubah - dan tiap pergantian skenario mengubahnya - seluruh
     gradasi ikut merenggang atau memampat. Akibatnya warna di satu titik yang sama
     berubah walau airnya di situ-situ saja: kolom yang menyusut jadi menggelap
     seluruhnya, yang naik jadi memucat. Yang terlihat: air berkedip antara biru muda
     dan biru tua sepanjang peralihan.
     Warna rata tidak punya masalah itu - tinggi berubah, warnanya tetap.
     #7fb0cd dipilih di tengah rentang lama: cukup gelap untuk garis permukaan yang
     putih, cukup terang untuk garis acuan yang abu-abu gelap. */
  water: '#7fb0cd',
  band: '#eef3f9', rail: '#8fa3ba', wall: '#8fa3ba', sill: '#5f7086',
  leaf: '#c1a878', leafEdge: '#8f7c52', arrow: '#2b6cb0',
  link: '#8fa3ba', fieldFill: '#f3f8ee',
};

/* Koordinat gambar (viewBox 1500×720).

   URUTAN GAMBAR pada tiap rantai irigasi:

     sungai hulu → PINTU INTAKE → KOLAM BENDUNG → saluran sekunder
                 → pintu tersier → saluran tersier → petak sawah

   Kolam bendung berdiri DI DALAM rantai, di antara pintu intake dan saluran
   sekunder — bukan di dalam pita sungai.

   Kolamnya SATU untuk ketiga rantai — sama seperti saluran sekunder, yang juga
   satu dan digambar tiga kali. Jadi kotaknya dibentangkan melintasi ketiga rantai
   (kolamX 100–660), tiga batang penghubung masuk ke atapnya dari tiap pintu
   intake dan tiga keluar dari dasarnya ke tiap kotak saluran sekunder.

   Bacaan kolam ditaruh DI SEBELAH KANAN kotaknya (x=676 & 790), bukan di dalamnya:
   ruang di kanan rantai terjauh kosong, dan tulisan di luar kotak membuat kolom
   airnya terbaca utuh.

   CATATAN — beda dengan topologi data, dan itu DISENGAJA.

   bendungTopology() di controller menyambung AWLR_HULU → AWLR_KOLAM →
   PG_INTAKE_1/2/3 → AWLR_SEKUNDER, yaitu kolam SEBELUM intake, dan sejak
   perbaikan hidrolika applyDummySnapshot() pun menghitungnya begitu: kolam diisi
   dari sungai, dikuras pintu scouring dan ketiga pintu intake.

   Gambar ini tetap memakai urutan intake → kolam atas permintaan operator.
   Susunannya sempat dibalik mengikuti data, lalu dikembalikan ke sini — jadi
   kalau nanti ada yang hendak menyelaraskannya lagi, tanyakan dulu: perbedaan
   ini pilihan, bukan kelalaian. Yang ditukar cukup arah kedua batang penghubung
   di perulangan rantai, plus tukar nilai kolamTitleY/kolamY dengan
   titleLane/gateSecY.

   PITA SUNGAI (y 48–170) berisi ruas hulu, pintu scouring, tiga lubang floodway,
   dan ruas hilir — tanpa kolam. Pintu scouring digambar di kiri Floodway 1
   mengikuti letaknya di badan bendung; kolom airnya setinggi muka air HULU,
   walaupun air yang benar-benar lewat di bawah daunnya berasal dari kolam.
   Ruas hilir kotak air beranimasi seperti ruas hulu, bukan panah polos; panah
   arahnya digambar sebagai garis luar di atas kotak itu (lihat SKL.hilirX).

   TINGGI KANVAS 660 → 720: baris kolam menyisipkan judul + kotak 40 unit di antara
   bacaan pintu intake dan kotak saluran sekunder, jadi semua baris dari capSec ke
   bawah turun 62 unit (lihat SKR). Pada skala tampil 1,25 px/unit tingginya 900px,
   dari 825px. Skalanya tidak berubah, jadi ukuran tulisan tetap. */
const SKL = {
  bandW: 1500,                            /* = lebar viewBox di dashboard.blade.php */
  viewH: 720,                             /* = tinggi viewBox; dipakai letak pelat */
  bandY: 48, bandH: 122, railTop: 60, railBot: 170,
  huluX: [10, 1020],
  scourX: [1029, 1099],
  bayX: [[1108, 1178], [1187, 1257], [1266, 1336]],
  /* Ruas hilir — kotak air beranimasi, sejajar ruas hulu di kiri pintu.
     Ruas hulu dipendekkan 80 unit (1100 → 1020) supaya ruas ini dapat lebar 145
     unit: pada 77 unit yang tersisa di susunan lama, pola gores 9/7 hanya memuat
     lima gores dan geraknya tidak terbaca sebagai aliran. Ruas hulu masih 1010
     unit, jauh lebih panjang dari yang dibutuhkan kolom airnya. */
  hilirX: [1345, 1490],

  /* Kolam bendung: satu kotak melintasi ketiga rantai, di dalam rantai. */
  kolamTitleY: 296,
  kolamX: [100, 660], kolamY: 302, kolamH: 40,
  kolamReadX: [676, 790], kolamReadY: 312,

  laneX: [170, 380, 590],
};
/* Tinggi baris di dalam satu rantai. Baris dari capSec ke bawah digeser +62 unit
   dibanding susunan asal (capSec 298 → 360) untuk memberi tempat baris kolam
   bendung di antara bacaan pintu intake dan kotak saluran sekunder. Baris pintu
   intake ke atas tidak berubah; jarak antar baris di dalam kelompoknya juga tidak
   — murni pergeseran. */
const SKR = {
  titleLane: 198,                         /* judul "Rantai Irigasi n" */
  gateSecY: 205, gateSecH: 34, leafSecY: 208, leafSecMax: 31,
  lblSec: 253, valSec: 267, modeSec: 280,
  capSec: 360, canalSecY: 365, canalSecH: 60, canalSecW: 140,
  readSecLbl: 440, readSecVal: 453,
  gateTertY: 462, gateTertH: 28, leafTertY: 465, leafTertMax: 25,
  lblTert: 505, valTert: 518, modeTert: 531,
  capTert: 546, canalTertY: 551, canalTertH: 42, canalTertW: 110,
  readTertLbl: 613, readTertVal: 625,
  sawahY: 634, sawahH: 60, sawahW: 140,
};

/* Pelat keadaan hulu di kanan atas gambar.
   Skematik sebelumnya tidak memuat keterangan skenario sama sekali: yang
   berpindah cuma angka dan tinggi kolom air, dan perpindahannya digulir
   bertahap oleh gulirKeMenit() (satu menit rekaman per 70 ms, satu jendela
   penuh ±4,2 detik). Tanpa penanda, operator yang sedang melihat rantai
   irigasi tidak tahu keadaan baru sudah mulai masuk dari hulu. Warnanya
   sengaja diambil dari palet FLOW_STATES — biru "normal", jingga "deras",
   coklat "kering" — supaya pelat ini terbaca sebagai bagian dari legenda yang
   sama, bukan kode warna kedua. */
const SK_SCEN = {
  normal:  { label: 'Hidrograf: Normal',  color: '#1f4fa6' },
  flood:   { label: 'Hidrograf: Banjir',  color: '#d4761c' },
  drought: { label: 'Hidrograf: Kemarau', color: '#8a7442' },
};
/* Letak pelat: sudut KANAN-BAWAH gambar, berjarak 14 unit dari kedua tepi kanvas
   (1500×660). Dulu di kanan-atas (y=6, di atas pita), tepat di sebelah judul
   "Hilir" dan bacaan debit hilir — padat, dan pelat ini bukan bacaan pos. Sudut
   kanan-bawah kosong sama sekali: isi terjauh di bawah adalah kartu petak rantai
   ketiga yang berakhir di x=660, y=632. */
const SKB = { w: 250, h: 26, x: SKL.bandW - 250 - 14, y: SKL.viewH - 26 - 14 };

function skText(x, y, cls, text, id, anchor) {
  return `<text ${id ? `id="${id}" ` : ''}x="${x}" y="${y}" class="${cls}"${anchor ? ` text-anchor="${anchor}"` : ''}>${text}</text>`;
}

/* Batang penghubung antar bangunan. */
function skLink(cx, y0, y1) {
  return `<line x1="${cx}" y1="${y0}" x2="${cx}" y2="${y1}" stroke="${SKC.link}" stroke-width="3"/>`;
}

/* Kotak air: kolom air naik dari dasar, dengan garis permukaan bergores yang
   berjalan mengikuti arus. Tinggi kolom & lajunya diatur setSkWater(). */
function skWaterBox(key, x, y, w, h) {
  return `<rect id="skW${key}" x="${x}" y="${y + h}" width="${w}" height="0" fill="${SKC.water}"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${SKC.wall}" stroke-width="1.4"/>
    <line id="skS${key}" class="sk-flow" x1="${x + 6}" y1="${y + h}" x2="${x + w - 6}" y2="${y + h}"/>`;
}

/* Garis acuan TMA rencana: setelan yang dikejar kendali otomatis, DIAM di
   tempatnya walau skenario ditukar.
 *
 * Dibedakan dari garis permukaan air (.sk-flow, putih & beranimasi) lewat warna dan
 * dash — bukan cuma lewat gerak. Dua garis sewarna yang berdekatan tidak bisa
 * dibedakan sekilas, dan justru saat airnya pas di acuan keduanya bertumpuk persis.
 *
 * Digambar SESUDAH kotak airnya supaya tergambar di atas kolom air, dan sedikit lebih
 * lebar dari kotaknya (menjorok 2 px kiri-kanan) supaya ujungnya tetap terlihat saat
 * garis permukaan kebetulan sejajar dengannya.
 */
function skGarisAcuan(key, x, y, w, h, nama) {
  return `<line id="skR${key}" class="sk-acuan" x1="${x - 2}" y1="${y + h}" x2="${x + w + 2}" y2="${y + h}">
    <title>${nama}</title></line>`;
}

/* Menempatkan garis acuan pada tinggi setelannya. Rumus tingginya SAMA PERSIS dengan
   setSkWater() — kalau dihitung dengan cara lain, keduanya akan meleset satu sama lain
   di kotak yang hMax-nya bukan bilangan bulat, dan selisih itulah yang justru dibaca
   orang sebagai "air di atas/di bawah rencana".
 *
 * Tidak dilewatkan skTarget(): nilainya cuma berubah saat setelan di Konfigurasi
 * diubah, dan meluncurkannya pelan-pelan membuat garis acuan ikut bergerak - persis
 * kesan yang harus dihindari. */
function setSkAcuan(key, target, hMax, yTop, hPx, satuan) {
  const line = document.getElementById('skR' + key);
  if (!line) return;
  if (!(target > 0) || !(hMax > 0)) { line.style.display = 'none'; return; }
  line.style.display = '';
  const y = yTop + hPx - clamp((target / hMax) * hPx, 0, hPx);
  line.setAttribute('y1', y);
  line.setAttribute('y2', y);
  const t = line.querySelector('title');
  if (t) t.textContent = `TMA rencana ${target.toFixed(2)} ${satuan || 'm'}`;
}

/* Lubang pintu pada pita bendung: daun menggantung dari balok atas, tingginya
   menyusut saat pintu dibuka — cara gambar yang sama dengan prototipe, jadi
   pintu terbuka penuh menyisakan bilah tipis di atas lubang. */
/* Lubang pintu berisi kolom air. Tinggi & letak tegaknya diminta pemanggil karena
   dipakai di DUA jalur: pintu floodway di pita sungai (railTop, tinggi pita) dan
   pintu scouring di jalur kolam (kolamY, kolamH) — dulu keduanya di pita, jadi
   ukurannya masih dipatok di dalam fungsi ini. */
function skBay(key, x0, x1, y, h) {
  const w = x1 - x0;
  return `${skWaterBox(key, x0, y, w, h)}
    <rect id="skLeaf${key}" x="${x0 + 4}" y="${y + 2}" width="${w - 8}" height="${h - 8}"
      fill="${SKC.leaf}" stroke="${SKC.leafEdge}" stroke-width="1.2"/>`;
}

/* Pintu pada rantai irigasi: rangka kecil dengan daun yang menyusut sama
   seperti pintu pita. */
function skLaneGate(key, cx, y, w, h, leafY, leafMax) {
  return `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${SKC.wall}" stroke-width="1.4"/>
    <rect id="skLeaf${key}" x="${cx - w / 2 + 3}" y="${leafY}" width="${w - 6}" height="${leafMax}"
      fill="${SKC.leaf}" stroke="${SKC.leafEdge}" stroke-width="1.2"/>`;
}

function buildSchematic() {
  const svg = document.getElementById('hmiSvg');
  if (!svg) return;
  const L = SKL, R = SKR;
  const flood = state.primary.filter(p => p.role === 'floodway');
  const scour = state.primary.find(p => p.role === 'scouring');

  let out = '';

  /* ---- Pita sungai: alas + dua rel yang membentang penuh ---- */
  out += `<rect x="0" y="${L.bandY}" width="${L.bandW}" height="${L.bandH}" fill="${SKC.band}"/>
    <line x1="0" y1="${L.railTop}" x2="${L.bandW}" y2="${L.railTop}" stroke="${SKC.rail}" stroke-width="2"/>
    <line x1="0" y1="${L.railBot}" x2="${L.bandW}" y2="${L.railBot}" stroke="${SKC.rail}" stroke-width="2"/>`;

  /* Sungai hulu */
  out += skText(L.huluX[0], 42, 'sk-sec', 'Sungai Alami (Hulu)');
  out += skWaterBox('Hulu', L.huluX[0], L.railTop, L.huluX[1] - L.huluX[0], L.railBot - L.railTop);
  out += skGarisAcuan('Hulu', L.huluX[0], L.railTop, L.huluX[1] - L.huluX[0],
                      L.railBot - L.railTop, 'TMA rencana');
  out += skText(L.huluX[0], 192, 'sk-lbl', 'TMA hulu') + skText(L.huluX[0], 205, 'sk-val', '—', 'skHuluTma');
  out += skText(L.huluX[0], 220, 'sk-lbl', 'Arus') + skText(L.huluX[0], 233, 'sk-val', '—', 'skHuluV');
  out += skText(L.huluX[0], 248, 'sk-lbl', 'Debit alami') + skText(L.huluX[0], 261, 'sk-val', '—', 'skHuluQ');

  /* Pintu scouring — di kiri Floodway 1, seperti letaknya di badan bendung:
     penguras berdiri di sebelah pengambilan untuk membilas endapan di depannya.

     Kolom airnya setinggi muka air HULU. Air yang benar-benar lewat di bawah
     daunnya berasal dari kolam (lihat state.Qscour), tetapi lubangnya digambar
     di pita mengikuti letak bangunannya — sama seperti kolam yang digambar di
     dalam rantai walau datanya menaruhnya sebelum intake. */
  const scx = (L.scourX[0] + L.scourX[1]) / 2;
  out += skText(scx, 50, 'sk-lbl', scour ? scour.name : 'Pintu Scouring', null, 'middle');
  out += skBay('S', L.scourX[0], L.scourX[1], L.railTop, L.railBot - L.railTop);
  out += skText(scx, 188, 'sk-val', '—', 'skGateS', 'middle');
  out += skText(scx, 200, 'sk-mode', 'AUTO', 'skModeS', 'middle');

  /* Tiga pintu floodway */
  L.bayX.forEach((bx, i) => {
    const cx = (bx[0] + bx[1]) / 2;
    out += skText(cx, 50, 'sk-lbl', flood[i] ? flood[i].name : 'Floodway ' + (i + 1), null, 'middle');
    out += skBay('P' + i, bx[0], bx[1], L.railTop, L.railBot - L.railTop);
    out += skText(cx, 188, 'sk-val', '—', 'skGateP' + i, 'middle');
    out += skText(cx, 200, 'sk-mode', 'AUTO', 'skModeP' + i, 'middle');
  });

  /* ---- Ruas hilir, di kanan pintu floodway ----
     Dulu ruas ini cuma panah bidang penuh: satu-satunya bagian pita sungai tanpa
     kolom air, jadi juga tanpa gores permukaan yang berjalan — air terlihat
     mengalir sampai pintu lalu berhenti. Sekarang kotak air biasa, sama seperti
     ruas hulu, dengan bacaan TMA/arus/debitnya sendiri.

     Panah arahnya digambar GARIS LUAR, bukan bidang penuh, dan digambar SESUDAH
     kotak air supaya tetap terlihat di atas kolom air. Bidang penuh menutup gores
     permukaan di ruas selebar ini — justru satu-satunya alasan kotak ini ada. */
  const h0 = L.hilirX[0], h1 = L.hilirX[1];
  out += skText(h0, 42, 'sk-sec', 'Hilir');
  out += skWaterBox('Hilir', h0, L.railTop, h1 - h0, L.railBot - L.railTop);
  const ax0 = h0 + 12, ax1 = h1 - 10;
  out += `<path d="M${ax0} 101 L${ax1 - 26} 101 L${ax1 - 26} 88 L${ax1} 115 L${ax1 - 26} 142 L${ax1 - 26} 129 L${ax0} 129 Z"
    fill="none" stroke="${SKC.arrow}" stroke-width="2" stroke-linejoin="round" opacity="0.9"/>`;
  out += skText(h0, 192, 'sk-lbl', 'TMA hilir') + skText(h0, 205, 'sk-val', '—', 'skHilirTma');
  out += skText(h0, 220, 'sk-lbl', 'Arus') + skText(h0, 233, 'sk-val', '—', 'skHilirV');
  out += skText(h0, 248, 'sk-lbl', 'Debit ke hilir') + skText(h0, 261, 'sk-val', '—', 'skHilirQ');

  /* Pelat keadaan hulu — lihat SK_SCEN & SKB. Ditaruh di sudut kanan-bawah gambar,
     ruang yang tidak dipakai isi apa pun, supaya tidak menimpa bacaan mana pun. */
  const B = SKB, scen = SK_SCEN[state.scenario] || SK_SCEN.normal;
  out += `<g id="skScen">
      <rect id="skScenPlate" x="${B.x}" y="${B.y}" width="${B.w}" height="${B.h}" rx="6"
        fill="#fff" stroke="${scen.color}" stroke-width="1.6"/>
      <rect id="skScenChip" x="${B.x + 9}" y="${B.y + 8}" width="10" height="10" rx="2" fill="${scen.color}"/>
      ${skText(B.x + 27, B.y + 18, 'sk-title', scen.label, 'skScenText')}
    </g>`;

  /* ---- Kolam bendung / kantong lumpur ----
     SATU kotak melintasi ketiga rantai, berdiri di antara bacaan pintu intake dan
     kotak saluran sekunder. Batang penghubungnya digambar di perulangan rantai di
     bawah: tiga masuk ke atap kolam dari tiap pintu intake, tiga keluar dari
     dasarnya ke tiap kotak saluran sekunder.

     Susunan ini sama dengan topologi data Laravel: intake berada sebelum kolam,
     lalu kolam mengalirkan air ke saluran sekunder.

     Digambar SEBELUM perulangan rantai supaya batang penghubungnya tergambar di
     atas kotak ini, bukan tertutup olehnya. */
  out += skText(L.kolamX[0], L.kolamTitleY, 'sk-sec', 'Kolam Bendung / Kantong Lumpur');
  const kw = L.kolamX[1] - L.kolamX[0];
  out += skWaterBox('Pool', L.kolamX[0], L.kolamY, kw, L.kolamH);
  out += skGarisAcuan('Pool', L.kolamX[0], L.kolamY, kw, L.kolamH, 'TMA rencana');
  /* Bacaan kolam di SEBELAH KANAN kotaknya — di luar kotak supaya kolom airnya
     terbaca utuh. */
  out += skText(L.kolamReadX[0], L.kolamReadY, 'sk-lbl', 'TMA kolam') + skText(L.kolamReadX[0], L.kolamReadY + 14, 'sk-val', '—', 'skPoolTma');
  out += skText(L.kolamReadX[1], L.kolamReadY, 'sk-lbl', 'Arus') + skText(L.kolamReadX[1], L.kolamReadY + 14, 'sk-val', '—', 'skPoolV');

  /* ---- Tiga rantai irigasi ---- */
  L.laneX.forEach((cx, i) => {
    const nm = skNames(i);
    /* Batang penghubung mulai dari REL BAWAH pita: tiap rantai menyadap dari
       sungai lewat pintu intake-nya sendiri. */
    out += skLink(cx, L.railBot, R.gateSecY);
    out += `<circle cx="${cx}" cy="${L.railBot}" r="4" fill="${SKC.sill}"/>`;
    out += skText(cx, R.titleLane, 'sk-title', 'Rantai Irigasi ' + (i + 1), null, 'middle');

    out += skLaneGate('I' + i, cx, R.gateSecY, 36, R.gateSecH, R.leafSecY, R.leafSecMax);
    out += skText(cx, R.lblSec, 'sk-lbl', state.secondary.gates[i].name, null, 'middle');
    out += skText(cx, R.valSec, 'sk-val', '—', 'skGateI' + i, 'middle');
    out += skText(cx, R.modeSec, 'sk-mode', 'AUTO', 'skModeI' + i, 'middle');

    /* Pintu intake → KOLAM BENDUNG → saluran sekunder. Gelang di atap dan dasar
       kolam menandai titik masuk & keluarnya. */
    out += skLink(cx, R.modeSec, L.kolamY);
    out += `<circle cx="${cx}" cy="${L.kolamY}" r="3.4" fill="${SKC.sill}"/>`;
    out += skLink(cx, L.kolamY + L.kolamH, R.canalSecY);
    out += `<circle cx="${cx}" cy="${L.kolamY + L.kolamH}" r="3.4" fill="${SKC.sill}"/>`;
    out += skText(cx, R.capSec, 'sk-lbl', 'Sal. Sekunder', null, 'middle');
    out += skWaterBox('Sec' + i, cx - R.canalSecW / 2, R.canalSecY, R.canalSecW, R.canalSecH);
    out += skGarisAcuan('Sec' + i, cx - R.canalSecW / 2, R.canalSecY, R.canalSecW,
                        R.canalSecH, 'TMA rencana');
    out += skText(cx - 66, R.readSecLbl, 'sk-lbl', 'TMA') + skText(cx - 66, R.readSecVal, 'sk-val', '—', 'skSecTma' + i);
    out += skText(cx + 8, R.readSecLbl, 'sk-lbl', 'Arus') + skText(cx + 8, R.readSecVal, 'sk-val', '—', 'skSecV' + i);

    out += skLink(cx, R.canalSecY + R.canalSecH, R.gateTertY);
    out += skLaneGate('T' + i, cx, R.gateTertY, 28, R.gateTertH, R.leafTertY, R.leafTertMax);
    out += skText(cx, R.lblTert, 'sk-lbl', state.tertiary[i].gate.name, null, 'middle');
    out += skText(cx, R.valTert, 'sk-val', '—', 'skGateT' + i, 'middle');
    out += skText(cx, R.modeTert, 'sk-mode', 'AUTO', 'skModeT' + i, 'middle');

    out += skLink(cx, R.modeTert, R.canalTertY);
    out += skText(cx, R.capTert, 'sk-lbl', 'Sal. Tersier ' + nm.tert, null, 'middle');
    out += skWaterBox('Ter' + i, cx - R.canalTertW / 2, R.canalTertY, R.canalTertW, R.canalTertH);
    out += skText(cx - 51, R.readTertLbl, 'sk-lbl', 'TMA') + skText(cx - 51, R.readTertVal, 'sk-val', '—', 'skTerTma' + i);
    out += skText(cx + 5, R.readTertLbl, 'sk-lbl', 'Arus') + skText(cx + 5, R.readTertVal, 'sk-val', '—', 'skTerV' + i);

    /* Petak sawah: kotak bergaris pematang seperti prototipe; garis tepinya
       memakai warna status pemenuhan yang sama dengan kartu di bawah peta. */
    out += skLink(cx, R.canalTertY + R.canalTertH, R.sawahY);
    const sx = cx - R.sawahW / 2, sy = R.sawahY;
    out += `<rect id="skField${i}" x="${sx}" y="${sy}" width="${R.sawahW}" height="${R.sawahH}" rx="5"
      fill="${SKC.fieldFill}" stroke="${FIELD_STATUS_COLOR.ideal}" stroke-width="2"/>`;
    [14, 26, 38].forEach(dy => {
      out += `<line x1="${sx + 10}" y1="${sy + dy}" x2="${sx + R.sawahW - 10}" y2="${sy + dy}" stroke="var(--field, #4f9d4a)" stroke-width="1" opacity="0.28"/>`;
    });
    out += skText(cx, sy + 15, 'sk-lbl', '—', 'skFieldNama' + i, 'middle');
    out += skText(cx, sy + 35, 'sk-val', '—', 'skFieldHa' + i, 'middle');
    out += skText(cx, sy + 52, 'sk-lbl', '—', 'skFieldQ' + i, 'middle');
  });

  /* Blok "Keterangan" di kiri-bawah gambar DIHAPUS atas permintaan operator —
     dulu berisi cara membaca kolom air, penjelasan garis acuan TMA rencana
     beserta contoh garisnya, dan catatan bahwa tiga rantai berbagi satu saluran
     sekunder (karena itu TMA & arusnya kembar di tiga kolom).

     Catatan itu tidak hilang, cuma pindah tempat: keduanya masih tertulis di
     kepala berkas ini pada CATATAN MODEL di atas const SKC, dan penjelasan garis
     acuan ada di komentar .sk-acuan (wms.css) serta di setSkAcuan(). Koordinat
     SKL.legendX/legendY ikut dibuang karena tidak ada lagi yang memakainya. */

  svg.innerHTML = out;
  /* Elemen lama sudah tergantikan; peta nilai luncur dikosongkan supaya nilai
     lama tidak terbawa ke elemen baru bernama sama. */
  SK_LUNCUR.clear();
  skMulaiLuncur();
}

/* ---- Peluncuran nilai tampilan -------------------------------------------
   Muka air & daun pintu TIDAK disetel langsung ke nilai barunya. Pemutaran
   histori maju satu menit rekaman tiap tick (260 ms), dan pada lereng banjir
   satu langkah itu berarti TMA hulu meloncat ±0,4 m sekaligus — kolom airnya
   terlihat patah-patah, bukan naik mengalir. Jadi tiap elemen menyimpan nilai
   sasaran, lalu satu putaran requestAnimationFrame meluncurkannya ke sana.
   Kalau pengguna meminta gerak dikurangi (prefers-reduced-motion), nilainya
   dipasang seketika seperti dulu. */
const SK_LUNCUR = new Map();
let skLuncurJalan = false;
const skGerakDikurangi = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* Kilatan sekali-jalan pada satu elemen. Kelasnya dilepas dan tata letak
   dibaca ulang sebelum dipasang lagi; tanpa pembacaan itu browser menganggap
   kelas tidak pernah hilang, jadi animasi tidak mulai ulang saat kilatan yang
   sama dipicu dua kali berturut-turut. Gerak dikurangi → tidak berkilat. */
function skKilat(elm, cls) {
  if (!elm || skGerakDikurangi) return;
  elm.classList.remove(cls);
  void elm.getBoundingClientRect();
  elm.classList.add(cls);
}

function skTarget(id, kolom, nilai, laju) {
  const e = document.getElementById(id);
  if (!e) return;
  let a = SK_LUNCUR.get(id);
  if (!a || a.el !== e) { a = { el: e, kini: {}, tuju: {}, laju: {} }; SK_LUNCUR.set(id, a); }
  a.tuju[kolom] = nilai;
  a.laju[kolom] = laju || 0.15;
  if (a.kini[kolom] == null || skGerakDikurangi) {
    a.kini[kolom] = nilai;
    e.setAttribute(kolom, nilai.toFixed(1));
  }
}

/* Nilai yang sedang ditampilkan (bukan sasaran) — dipakai setSkWater() untuk
   tahu air sedang naik atau surut. */
function skNilaiKini(id, kolom) {
  const a = SK_LUNCUR.get(id);
  return a ? a.kini[kolom] : null;
}

function skLuncurStep() {
  SK_LUNCUR.forEach((a, id) => {
    if (!a.el.isConnected) { SK_LUNCUR.delete(id); return; }
    Object.keys(a.tuju).forEach(kolom => {
      const tuju = a.tuju[kolom];
      const beda = tuju - a.kini[kolom];
      if (Math.abs(beda) < 0.05) {
        if (a.kini[kolom] !== tuju) { a.kini[kolom] = tuju; a.el.setAttribute(kolom, tuju.toFixed(1)); }
        return;
      }
      a.kini[kolom] += beda * (a.laju[kolom] || 0.15);
      a.el.setAttribute(kolom, a.kini[kolom].toFixed(1));
    });
  });
  requestAnimationFrame(skLuncurStep);
}

function skMulaiLuncur() {
  if (skLuncurJalan || skGerakDikurangi) return;
  skLuncurJalan = true;
  requestAnimationFrame(skLuncurStep);
}

/* Lama satu putaran gores permukaan (detik) untuk arus V m/dtk.
 *
 * Dulu `clamp(2,6 / V, 0,35, 6)`, diambil apa adanya dari prototipe. Pemetaan itu
 * baru bergerak di bawah 6 detik kalau V > 0,433 m/dtk, dan arus yang benar-benar
 * muncul di jaringan ini tidak pernah setinggi itu: saluran sekunder 0,043–0,060
 * dan ketiga tersier 0,236–0,400 m/dtk. Hasilnya keempat saluran irigasi menumbuk
 * atap 6,00 detik di SEMUA skenario — laju goresnya sama saja saat kemarau dan
 * saat banjir, jadi animasinya tidak membawa keterangan apa pun. Hanya sungai
 * hulu & kolam bendung (0,31–1,12 m/dtk) yang benar-benar berbeda.
 *
 * Sekarang akar: dur = 1,27 / √V. Pangkat 0,5 dipilih supaya seluruh rentang arus
 * yang dipakai tampilan ini (0,04–1,12 m/dtk, rentang 28x) memetak ke 1,2–6,0
 * detik (rentang 5x) — cukup rapat untuk terbaca sebagai satu keluarga, cukup
 * lebar untuk dibedakan. Hasilnya per ruas:
 *
 *     sekunder  0,043 → 6,00 s      0,060 → 5,19 s
 *     tersier   0,236 → 2,61 s      0,400 → 2,01 s
 *     hulu      0,340 → 2,18 s      1,040 → 1,25 s
 *
 * Urutannya tetap: air lebih deras = gores lebih cepat. Yang berubah cuma
 * kepadatan pemetaannya, bukan arahnya.
 *
 * ATAP 6 → 14 DETIK. Sesudah arus kolam dihitung dari debit/penampang (bukan
 * Manning atas geometri sungai), rentangnya turun ke 0,007–0,017 m/dtk — dan
 * SELURUH rentang itu memetak ke atas 6 detik, jadi kolam menumbuk atap di
 * semua keadaan: menutup pintu intake tidak mengubah laju goresnya sedikit pun.
 * Itu persis penyakit yang catatan di atas sebut untuk saluran irigasi, hanya
 * satu tingkat lebih rendah. Saluran sekunder pun menumbuknya saat pintu
 * ditutup (0,026 m/dtk → 7,9 s).
 *
 * Dengan atap 14 detik keduanya kembali bergerak:
 *
 *     kolam     0,007 → 14,0 s (tertutup)   0,017 →  9,9 s (terbuka lebar)
 *     sekunder  0,026 →  7,9 s (tertutup)   0,073 →  4,7 s (terbuka lebar)
 *
 * 14 detik memang sangat lambat — dan memang seharusnya begitu. Kantong lumpur
 * dibuat lebar justru supaya air MELAMBAT sampai endapan sempat turun; ruas
 * paling pelan di seluruh peta adalah gambaran yang benar untuknya. Batas bawah
 * 0,35 detik tidak tersentuh: ruas tercepat (hilir saat banjir, 1,06 m/dtk)
 * masih di 1,23 detik. */
function lajuGores(V) {
  return clamp(1.27 / Math.sqrt(Math.max(V || 0, 0.001)), 0.35, 14);
}

/* Kolom air, warnanya, dan laju riak satu kotak. Kelas "normal" memakai
   gradasi air bawaan supaya keadaan wajar jadi acuan mata; kelas lain memakai
   warna kelasnya, sama dengan pewarnaan peta isometrik. */
function setSkWater(key, h, hMax, yTop, hPx, stateKey, V) {
  const f = FLOW_STATES[stateKey] || FLOW_STATES.normal;
  const hh = clamp((h / (hMax || 1)) * hPx, 0, hPx);
  const yAir = yTop + hPx - hh;

  /* Air tidak berpindah tinggi seketika, dan SURUTNYA lebih lambat daripada
     naiknya — begitu pula hidrograf sungguhan: sisi naik curam, sisi resesi
     landai karena air harus mengalir keluar dulu. Angkanya pecahan sisa jarak
     per frame, jadi naik ±0,7 detik dan surut ±1,5 detik. */
  const kiniH = skNilaiKini('skW' + key, 'height');
  /* Nilainya sendiri sudah lamban (lihat dummyKelambanan), jadi peluncuran
     gambar tinggal merapikan sisa langkah antar frame — bukan sumber utama
     kehalusannya. Kalau dibuat selamban dulu, gambar tertinggal jauh di
     belakang angkanya. */
  const lajuAir = (kiniH == null || hh >= kiniH) ? 0.22 : 0.16;

  const rect = document.getElementById('skW' + key);
  if (rect) {
    skTarget('skW' + key, 'y', yAir, lajuAir);
    skTarget('skW' + key, 'height', hh, lajuAir);
    /* SATU warna untuk seluruh kolom air. Sebelumnya tiap kotak diwarnai
       menurut kelas alirannya (biru "normal", jingga "deras", coklat "kering",
       ungu "genangan"), sehingga ruas-ruas yang bersebelahan tampil beda warna
       dan gambarnya terbaca seperti peta panas, bukan potongan satu jaringan.
       Kelas alirannya tetap dihitung — dipakai menghentikan gores permukaan
       pada ruas yang tidak mengalir (f.alir di bawah) — hanya tidak lagi
       mewarnai. Keadaan tiap ruas dibaca dari angka TMA & arus di sebelahnya.

       Disetel ulang tiap frame, bukan sekali saat digambar: kalau suatu saat ada
       yang mewarnai kotak ini dari tempat lain, baris ini yang mengembalikannya. */
    rect.setAttribute('fill', SKC.water);
  }

  const line = document.getElementById('skS' + key);
  if (line) {
    skTarget('skS' + key, 'y1', yAir, lajuAir);
    skTarget('skS' + key, 'y2', yAir, lajuAir);
    const alir = f.alir && V > 0.01;
    /* Ketegasan gores masih persis prototipe simulasi-water-management-irigasi.html
       (setFlowSpeed di sana): strokeOpacity = clamp(0.25 + V·0,15, 0.25, 0.85),
       beserta pola goresnya (stroke-dasharray 9 7, dashoffset −64 di wms.css).
       LAJUNYA tidak lagi — lihat lajuGores(). */
    const dur = lajuGores(V);
    /* Satu-satunya hal yang tidak diikutkan dari prototipe: di sana durasi
       ditulis ulang tiap tick. Mengganti animation-duration memetakan ulang
       kemajuan animasi ((now−start)/durasi), jadi penulisan berulang — ±14
       kali sedetik selagi gulirKeMenit() berjalan, yaitu tepat saat
       perpindahan skenario ingin dilihat — membuat gores melompat. Nilainya
       sama, hanya penulisannya ditahan sampai berubah >5%. */
    const durLama = parseFloat(line.dataset.dur || '0');
    if (!durLama || Math.abs(dur - durLama) / durLama > 0.05) {
      line.style.animationDuration = dur.toFixed(2) + 's';
      line.dataset.dur = String(dur);
    }
    /* Ruas kelas "kering" dihentikan — legenda skematik ini memang menuliskan
       "tidak mengalir" untuk kelas itu; prototipe tidak punya kelas aliran
       sama sekali, jadi tidak ada perilaku pembanding yang dilanggar. */
    /* Ditulis HANYA saat nilainya benar-benar bertukar. Sepanjang gulirKeMenit()
       berjalan, kelas aliran dihitung ulang ±14 kali sedetik dari rekaman yang
       nilainya berayun (TMA = sensor1 x (1 + 0,20 sin(menit x 12 derajat))), jadi
       `alir` bisa bergantian true/false antar langkah. Tiap penulisan 'running'
       sesudah 'paused' memulai animasi dari awal, dan goresnya tersentak - persis
       kedipan yang terlihat saat skenario ditukar. */
    const alirLama = line.dataset.alir === '1';
    if (!line.dataset.alir || alir !== alirLama) {
      line.style.animationPlayState = alir ? 'running' : 'paused';
      line.dataset.alir = alir ? '1' : '0';
    }
    /* strokeOpacity, bukan opacity — sama dengan prototipe. Kotak yang hampir
       kosong tetap disembunyikan supaya gores tidak tergambar di dasar
       saluran yang kering.
     *
     * Ditahan sampai berubah >0,06, alasan yang sama dengan animationPlayState di
     * atas dan animationDuration sebelumnya: nilainya turunan dari arus, arus ikut
     * berayun sepanjang rekaman, dan menuliskannya tiap langkah membuat gores
     * menyala-redup 14 kali sedetik. Itu sumber kedipan yang paling terlihat -
     * yang berubah bukan letaknya melainkan ketegasannya, dan mata membaca
     * perubahan ketegasan sebagai kedip. */
    const opBaru = hh > 2 ? clamp(0.25 + (V || 0) * 0.15, 0.25, 0.85) : 0;
    const opLama = parseFloat(line.dataset.op ?? 'NaN');
    if (!Number.isFinite(opLama) || Math.abs(opBaru - opLama) > 0.06
        || (opBaru === 0) !== (opLama === 0)) {
      line.style.strokeOpacity = opBaru.toFixed(2);
      line.dataset.op = String(opBaru);
    }
    line.style.opacity = '';
    line.style.strokeWidth = '';
  }
}

/* Daun pintu: tingginya menyusut saat pintu dibuka — bukaan nol menutup
   lubang penuh, bukaan penuh menyisakan bilah tipis menggantung di balok. */
function setSkLeaf(key, a, aMax, yTop, hFull, hMin) {
  const leaf = document.getElementById('skLeaf' + key);
  if (!leaf) return;
  const frac = clamp(a / (aMax || 1), 0, 1);
  leaf.setAttribute('y', yTop);
  skTarget('skLeaf' + key, 'height', clamp(hFull - frac * (hFull - hMin), hMin, hFull), 0.10);
}

/* Keadaan hulu baru masuk: pelat keadaan diperbarui, dan hanya itu.

   Kolom air TIDAK dikilatkan. Sebelumnya ruas yang keadaannya datang dari hulu
   — sungai, lubang-lubang pintu, kolam bendung — dicerahkan dua kali dengan
   filter brightness/saturate. Yang terlihat bukan "keadaan baru datang dari
   hulu" melainkan air yang berkedip: airnya #7fb0cd, dicerahkan 1,45x kanal
   hijau & birunya mentok 255, jadi seluruh pita berubah jadi biru pucat hampir
   putih lalu kembali — dua kali, 2,3 detik. Kedipannya juga tidak sinkron
   dengan perpindahannya: gulirKeMenit() perlu ±4,2 detik untuk satu jendela
   penuh, jadi kilatan sudah habis selagi keadaan barunya masih masuk.

   Perpindahannya tetap terbaca tanpa kilatan: pelat keadaan di kanan atas
   berganti label & warna, tinggi kolom airnya meluncur (setSkWater), dan
   angka-angkanya berjalan sepanjang gulir. */
function skTandaiSkenarioBaru() {
  const svg = document.getElementById('hmiSvg');
  if (!svg || !svg.firstChild) return;
  updateSchematic();
  skKilat(document.getElementById('skScen'), 'sk-scen-masuk');
}

function updateSchematic() {
  const svg = document.getElementById('hmiSvg');
  if (!svg || !svg.firstChild) return;
  const set = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  const setMode = (id, mode) => {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = mode === 'manual' ? 'MANUAL' : 'AUTO';
    e.setAttribute('class', mode === 'manual' ? 'sk-mode manual' : 'sk-mode');
  };
  const L = SKL, R = SKR;
  const bandH = L.railBot - L.railTop;
  const N = state.dummyNodes || {};
  const rantai = (window.WMS_DUMMY || { rantai: [] }).rantai || [];
  const capRiver = (N.WEIR_COPONG || {}).kapasitas || 0;
  const induk = N[dummyIndukId()], secNode = N[dummySekunderId()];

  /* Acuan kelas aliran sama dengan peta isometrik: sungai dinilai terhadap
     kapasitas bendung, kolam terhadap kapasitas saluran induk. */
  const huluState = capRiver ? flowStateOf('hulu', state.Qnat, capRiver) : 'normal';
  const poolState = induk ? flowStateOf('kolam', state.QgateTotal, induk.kapasitas) : 'normal';

  /* Pelat keadaan hulu. Diperbarui di sini, bukan cuma saat tombol ditekan,
     karena pemutaran histori juga menyeberangi jendela keadaan sendiri lewat
     tandaiSkenario(). */
  const scen = SK_SCEN[state.scenario] || SK_SCEN.normal;
  set('skScenText', scen.label);
  const scenChip = document.getElementById('skScenChip');
  if (scenChip) scenChip.setAttribute('fill', scen.color);
  const scenPlate = document.getElementById('skScenPlate');
  if (scenPlate) scenPlate.setAttribute('stroke', scen.color);

  setSkWater('Hulu', state.hUp, state.river.Hmax, L.railTop, bandH, huluState, state.vUp);
  setSkAcuan('Hulu', state.targetHuluLevel, state.river.Hmax, L.railTop, bandH);
  set('skHuluTma', state.hUp.toFixed(2) + ' m');
  set('skHuluV', state.vUp.toFixed(2) + ' m/dtk');
  set('skHuluQ', state.Qnat.toFixed(2) + ' m³/dtk');

  /* Kolam bendung berdiri di barisnya sendiri, langsung di bawah pita sungai —
     jadi letak & tinggi kotaknya L.kolamY/L.kolamH, bukan L.railTop/bandH.

     Acuan tingginya state.pool.Hmax (tanggul KOLAM), bukan river.Hmax: terhadap
     tanggul sungai 6 m kolom airnya cuma mengisi 22,7% kotak sementara saluran
     sekunder di bawahnya mengisi 50%, jadi dua kotak yang airnya sama-sama pada
     tinggi operasi tidak pernah terbaca sebanding. Lihat POOL_HMAX. */
  setSkWater('Pool', state.pool.h, state.pool.Hmax, L.kolamY, L.kolamH, poolState, state.vPool);
  /* Acuan disetel tiap frame, bukan sekali saat dibangun: nilainya bisa diubah dari
     Konfigurasi (Target TMA kolam) selagi simulasi berjalan. Menyetelnya ulang cuma
     dua penulisan atribut, jauh lebih murah daripada menyimpan nilai lama untuk
     dibandingkan. */
  setSkAcuan('Pool', state.targetPoolLevel, state.pool.Hmax, L.kolamY, L.kolamH);
  set('skPoolTma', state.pool.h.toFixed(2) + ' m');
  set('skPoolV', state.vPool.toFixed(2) + ' m/dtk');
  /* Tidak ada bacaan debit di baris kolam — kotaknya cuma menampilkan TMA &
     arus, seperti sebelumnya. Debit masuk kolam dibaca di panel Neraca Air. */

  /* Ruas hilir. Kedalaman & arusnya diturunkan dari debitnya (state.Qhilir)
     dengan Manning pada geometri sungai yang sama — kolom air perlu kedalaman,
     laju gores perlu arus. Keduanya dihitung di applyDummySnapshot() supaya peta
     isometrik memakai angka yang sama persis; cadangannya dihitung di sini untuk
     mode simulasi PI, yang tidak melewati applyDummySnapshot().

     TIDAK memakai state.hUp: muka air hulu ditahan bendung, jadi selalu lebih
     tinggi dari muka air di bawah pintu, dan memakainya membuat ruas hilir
     tergambar penuh justru saat pintu tertutup. */
  const hHilir = state.hHilir != null ? state.hHilir
    : manningInvertH(state.Qhilir, state.river.B, FIXED.nRiver, FIXED.S0River, state.river.Hmax * 1.05);
  const vHilir = state.vHilir != null ? state.vHilir
    : (hHilir > 0.01 ? state.Qhilir / (state.river.B * hHilir) : 0);
  const hilirState = capRiver ? flowStateOf('hilir', state.Qhilir, capRiver) : 'normal';
  setSkWater('Hilir', hHilir, state.river.Hmax, L.railTop, bandH, hilirState, vHilir);
  set('skHilirTma', hHilir.toFixed(2) + ' m');
  set('skHilirV', vHilir.toFixed(2) + ' m/dtk');
  set('skHilirQ', state.Qhilir.toFixed(2) + ' m³/dtk');

  const leafFull = bandH - 8, leafMin = 5;
  state.primary.filter(p => p.role === 'floodway').forEach((p, i) => {
    setSkWater('P' + i, state.hUp, state.river.Hmax, L.railTop, bandH, huluState, state.vUp);
    setSkLeaf('P' + i, p.ctrl.a, p.aMax, L.railTop + 2, leafFull, leafMin);
    set('skGateP' + i, p.ctrl.a.toFixed(2) + ' m');
    setMode('skModeP' + i, p.mode);
  });
  /* Pintu scouring digambar di dalam pita, di kiri Floodway 1, jadi kolom airnya
     setinggi muka air sungai — mengikuti letak bangunannya, bukan asal airnya.
     Debit yang benar-benar lewat di bawah daunnya (state.Qscour) berasal dari
     kolam; angkanya dibaca di panel Neraca Air, bukan di sini. */
  const scour = state.primary.find(p => p.role === 'scouring');
  if (scour) {
    setSkWater('S', state.hUp, state.river.Hmax, L.railTop, bandH, huluState, state.vUp);
    setSkLeaf('S', scour.ctrl.a, scour.aMax, L.railTop + 2, leafFull, leafMin);
    set('skGateS', scour.ctrl.a.toFixed(2) + ' m');
    setMode('skModeS', scour.mode);
  }

  const sec = state.secondary, capSec = secNode ? secNode.kapasitas : 0;
  const nGate = sec.gates.length;

  L.laneX.forEach((cx, i) => {
    const gt = sec.gates[i];
    setSkLeaf('I' + i, gt.ctrl.a, gt.aMax, R.leafSecY, R.leafSecMax, 2);
    set('skGateI' + i, gt.ctrl.a.toFixed(3) + ' m');
    setMode('skModeI' + i, gt.mode);

    /* Kotak sekunder tiap rantai membaca saluran yang sama — lihat catatan di
       kepala berkas ini dan keterangan di bawah legenda. */
    setSkWater('Sec' + i, sec.canal.h, sec.canal.Hmax, R.canalSecY, R.canalSecH,
      capSec ? flowStateOf('sec' + i, state.Qsec[i], capSec / nGate) : 'normal', state.vSec);
    /* Ketiga kotak sekunder membaca saluran yang sama, jadi acuannya pun satu nilai
       yang sama - sengaja digambar di ketiganya, bukan di satu kotak saja, karena
       ketiganya dibaca berdampingan dan acuan yang cuma ada di satu kotak akan
       terbaca seolah dua kotak lainnya tidak punya rencana. */
    setSkAcuan('Sec' + i, sec.targetLevel, sec.canal.Hmax, R.canalSecY, R.canalSecH);
    set('skSecTma' + i, sec.canal.h.toFixed(2) + ' m');
    set('skSecV' + i, state.vSec.toFixed(2) + ' m/dtk');

    const t = state.tertiary[i];
    setSkLeaf('T' + i, t.gate.ctrl.a, t.gate.aMax, R.leafTertY, R.leafTertMax, 2);
    set('skGateT' + i, t.gate.ctrl.a.toFixed(3) + ' m');
    setMode('skModeT' + i, t.gate.mode);

    const tn = N[(rantai[i] || {}).tersier];
    setSkWater('Ter' + i, t.canal.h, t.canal.Hmax, R.canalTertY, R.canalTertH,
      tn ? flowStateOf('ter' + i, state.Qfield[i], tn.kapasitas) : 'normal', state.vTert[i]);
    set('skTerTma' + i, t.canal.h.toFixed(2) + ' m');
    set('skTerV' + i, state.vTert[i].toFixed(2) + ' m/dtk');

    /* Status petak memakai ambang yang sama dengan kartu di bawah peta, jadi
       satu petak tidak pernah "Kurang" di sini tapi "Cukup" di sana. */
    const req = (state.duty * state.areas[i].ha) / 1000;
    const st = irrigationStatus(state.Qfield[i], req);
    set('skFieldNama' + i, 'Petak ' + state.areas[i].name);
    set('skFieldHa' + i, state.areas[i].ha.toFixed(0) + ' ha');
    set('skFieldQ' + i, state.Qfield[i].toFixed(3) + ' / ' + req.toFixed(3) + ' m³/dtk');
    const card = document.getElementById('skField' + i);
    if (card) card.setAttribute('stroke', FIELD_STATUS_COLOR[st.cls]);
  });
}


/* =========================================================================
   RENDER
   ========================================================================= */
const el = (id) => document.getElementById(id);

function setWaterRect(id, h, hMax, yTop, hPx) {
  const scale = hPx / hMax;
  const hh = clamp(h * scale, 0, hPx);
  const r = el(id);
  if (!r) return;
  r.setAttribute('y', yTop + hPx - hh);
  r.setAttribute('height', hh);
}
/* Tidak ada pemanggil saat ini — setSkWater() mengurus gores skematik sendiri, dan
   peta isometrik memakai .iso-flow berdurasi tetap. Dibiarkan ada sebagai jalur
   yang sama untuk pemakaian lain, tetapi memakai lajuGores() supaya kalau nanti
   dipakai lagi lajunya tidak berbeda dari skematik. */
function setFlowSpeed(id, V) {
  const line = el(id);
  if (!line) return;
  line.style.animationDuration = lajuGores(V).toFixed(2) + 's';
  line.style.strokeOpacity = clamp(0.25 + V * 0.15, 0.25, 0.85);
}

/* Angka pada tampilan ini berasal dari data dummy Laravel (dummy-skema.js) dan
   bersifat statis — mesin simulasi tidak dijalankan. */
const NO_DATA = true;
const DASH = '—';

/* Tulis snapshot dummy ke state agar seluruh panel membaca nilai yang sama. */
/* Kursor pemutaran, dalam menit histori. Dimulai di ujung TERBARU rekaman —
   di situlah keadaan normal tersimpan — bukan di menit 0 yang berisi kemarau. */
let dummyMinute = 0;

/* Kelas aliran mengikuti klasifikasi controller: rasio debit terhadap kapasitas.
   `alir` hanya menandai mengalir / tidak; kelasnya dibedakan lewat warna.
   Laju gores permukaan air tidak dibedakan per kelas melainkan per arus
   terukur — lihat SK_V_ACUAN & setSkWater(). */
const FLOW_STATES = {
  kering:   { label: 'Kering',   alir: false, color: '#8a7442' },
  kurang:   { label: 'Kurang',   alir: true,  color: '#b08a3c' },
  normal:   { label: 'Normal',   alir: true,  color: '#1f4fa6' },
  deras:    { label: 'Deras',    alir: true,  color: '#d4761c' },
  genangan: { label: 'Genangan', alir: true,  color: '#8e44ad' },
};

/* Ambang kelas, dari yang paling tinggi. */
const FLOW_AMBANG = [
  { kelas: 'genangan', min: 135 },
  { kelas: 'deras', min: 100 },
  { kelas: 'normal', min: 50 },
  { kelas: 'kurang', min: 0 },
];
/* Pita mati (poin persen) sebelum sebuah ruas diizinkan berpindah kelas.

   Perlu karena beberapa ruas memang mengendap TEPAT di sebelah ambangnya:
   pengambilan Ciduga mapan pada 0,090 m³/dtk terhadap jatah kapasitas 0,167 =
   54%, bersebelahan dengan ambang 50%. Riak hidrograf banjir (±12%) membawanya
   melewati ambang itu bolak-balik — terukur 107 perpindahan dalam 200 tick.
   Dengan pita 6 poin, ruas yang mapan di 54% harus mencapai 56% untuk naik
   kelas dan turun ke bawah 44% untuk kembali, sehingga riak biasa tidak lagi
   menggerakkannya.

   Masih diperlukan walau kelas aliran tidak lagi mewarnai kotak: kelas 'kering'
   menghentikan gores permukaan (f.alir di setSkWater), jadi tanpa pita mati
   gores itu akan berhenti dan berjalan lagi tiap kali riak melewati ambang. */
const FLOW_HISTERESIS = 6;

function flowState(debit, kapasitas, kelasLama) {
  if (!(debit > 0)) return 'kering';
  const pct = kapasitas > 0 ? (debit / kapasitas) * 100 : 0;
  let kelas = 'kurang';
  for (const a of FLOW_AMBANG) { if (pct >= a.min) { kelas = a.kelas; break; } }
  if (!kelasLama || kelasLama === 'kering' || kelasLama === kelas) return kelas;

  const iLama = FLOW_AMBANG.findIndex(a => a.kelas === kelasLama);
  const iBaru = FLOW_AMBANG.findIndex(a => a.kelas === kelas);
  if (iLama < 0 || iBaru < 0) return kelas;
  /* Indeks kecil = kelas lebih tinggi. Naik kelas: lewati ambang kelas baru
     ditambah pita. Turun kelas: turun di bawah ambang kelas lama dikurangi
     pita. */
  return iBaru < iLama
    ? (pct >= FLOW_AMBANG[iBaru].min + FLOW_HISTERESIS ? kelas : kelasLama)
    : (pct < FLOW_AMBANG[iLama].min - FLOW_HISTERESIS ? kelas : kelasLama);
}

/* Kelas aliran satu titik beserta ingatannya — pita mati di flowState() hanya
   bekerja kalau kelas sebelumnya ikut diberikan. Dipakai semua tampilan supaya
   skematik, peta, dan legenda menyebut kelas yang sama pada saat yang sama. */
const FLOW_KELAS_KINI = new Map();
function flowStateOf(key, debit, kapasitas) {
  const kelas = flowState(debit, kapasitas, FLOW_KELAS_KINI.get(key));
  FLOW_KELAS_KINI.set(key, kelas);
  return kelas;
}

/* Skenario kondisi hulu. Nilainya TIDAK lagi dihitung di sini: tiap keadaan
   dikirim utuh per simpul lewat window.WMS_DUMMY.skenario, hasil
   SkemaIrigasiController::skenarioSnapshot() — sumber yang sama dengan yang
   ditulis seeder ke tabel sensor.

   Dulu tiap skenario cuma satu pengali yang dikenakan seragam ke seluruh
   simpul (banjir ×1,55 debit, ×1,25 TMA). Itu keliru: saat banjir sungai boleh
   membawa 22 m³/dtk, tetapi kolam bendung dan saluran irigasi tetap dibatasi
   kapasitasnya — kelebihannya melimpas lewat floodway ke hilir, bukan ikut
   membanjiri petak sawah. Dengan pengali seragam, status sawah tidak pernah
   berubah antar skenario karena pembilang dan penyebutnya naik bersama.

   Kunci di sini (normal/flood/drought) adalah nama mode di layar; kunci di
   payload (normal/hujan/kemarau) adalah nama keadaan di sisi Laravel. */
const DUMMY_SCENARIO = {
  normal:  { key: 'normal',  icon: '⛅',  label: 'Normal' },
  flood:   { key: 'hujan',   icon: '🌧️', label: 'Hujan / Banjir' },
  drought: { key: 'kemarau', icon: '☀️',  label: 'Kering / Kemarau' },
};
function dummyScenario() {
  const S = DUMMY_SCENARIO[state.scenario] || DUMMY_SCENARIO.normal;
  const dari = ((window.WMS_DUMMY || {}).skenario || {})[S.key];
  return dari ? { ...S, label: dari.label || S.label } : S;
}

/* Nilai tiap simpul untuk skenario yang sedang dipilih; null kalau payload
   belum memuatnya (mis. data dummy belum di-seed ulang), dan pemanggilnya
   jatuh ke nilai simpul apa adanya. */
function dummyScenarioNodes() {
  const S = DUMMY_SCENARIO[state.scenario] || DUMMY_SCENARIO.normal;
  const dari = ((window.WMS_DUMMY || {}).skenario || {})[S.key];
  return dari ? (dari.nodes || null) : null;
}

/* Kebutuhan air per hektar (l/dtk/ha) untuk keadaan yang sedang dipilih.
   Ikut skenario, bukan tetapan 1,00 sepanjang tahun: kemarau tidak ditanami
   padi penuh, rencana tata tanam berpindah ke palawija (0,65 l/dtk/ha di
   SkemaIrigasiController::SKENARIO). Tanpa itu, penyebut penilaian status tidak
   pernah ikut menyusut dan petak selalu terbaca "Kurang" saat kemarau
   bagaimanapun pintunya diatur. */
function dummyDuty() {
  const S = DUMMY_SCENARIO[state.scenario] || DUMMY_SCENARIO.normal;
  const dari = ((window.WMS_DUMMY || {}).skenario || {})[S.key];
  const d = dari ? parseFloat(dari.duty) : NaN;
  return isNaN(d) || d <= 0 ? 1.0 : d;
}

/* Cuaca dummy. Belum ada sensor cuaca terpasang di lapangan, jadi angka pada
   chip dibangkitkan dari skenario hulu yang dipilih operator — bukan bacaan
   alat. Nilai dasar per skenario, lalu digoyang memakai menit histori yang
   sama dengan seeder supaya ikut bergerak saat pemutaran jalan, dan tetap
   deterministik (tidak memakai angka acak, jadi hasilnya bisa diulang). */
const DUMMY_CUACA = {
  normal:  { desc: 'Cerah Berawan', suhu: 28, angin: 5.9,  lembap: 74 },
  flood:   { desc: 'Hujan Lebat',   suhu: 24, angin: 22.0, lembap: 93 },
  drought: { desc: 'Cerah Terik',   suhu: 34, angin: 3.2,  lembap: 48 },
};

function dummyCuaca() {
  const C = DUMMY_CUACA[state.scenario] || DUMMY_CUACA.normal;
  const rad = dummyMinute * 12 * Math.PI / 180;   /* fase sama dengan dummyWave() */
  return {
    desc:   C.desc,
    suhu:   C.suhu + 1.5 * Math.sin(rad),                     /* ±1,5 °C */
    angin:  Math.max(0, C.angin * (1 + 0.15 * Math.sin(rad + 1.1))),
    lembap: clamp(C.lembap + 4 * Math.sin(rad + 2.3), 0, 100),
  };
}

/* Node acuan pada snapshot dummy. Nama node dikirim payload supaya penggantian
   skema di sisi Laravel tidak perlu menyentuh berkas ini. */
function dummyIndukId() { return (window.WMS_DUMMY || {}).induk || 'AWLR_KOLAM'; }
function dummySekunderId() { return (window.WMS_DUMMY || {}).sekunder || 'AWLR_SEKUNDER'; }

/* Besar riak pembacaan mengikuti keadaan hulu yang dipilih, bukan satu angka
   untuk semua. Keadaan NORMAL beramplitudo nol — bendung yang bekerja wajar
   menahan muka air pada satu tinggi tetap, jadi kolom airnya diam dan kelas
   alirannya tidak berpindah-pindah. Dengan riak ±20% seperti sebelumnya, debit
   hulu berayun 11,4–17,0 m³/dtk terhadap kapasitas 15, dan warna saluran
   berkedip Normal ↔ Deras padahal tidak ada yang berubah di lapangan. */
function dummyAmplitudo() {
  const D = window.WMS_DUMMY || {};
  const S = DUMMY_SCENARIO[state.scenario] || DUMMY_SCENARIO.normal;
  const dari = (D.skenario || {})[S.key];
  const a = (dari && dari.amplitudo != null) ? dari.amplitudo : D.historyAmplitudo;
  return a || 0;
}

/* Panjang rekaman yang tersedia (menit). */
function dummySpan() {
  const D = window.WMS_DUMMY || {};
  return (D.histori && D.histori.menit) || D.historyMenit || 60;
}

function dummyIndex(minute) {
  return clamp(Math.round(minute || 0), 0, dummySpan());
}

/* Jendela waktu tempat tiap keadaan terekam, dalam menit histori. */
function dummyJendela(key) {
  return (((window.WMS_DUMMY || {}).histori || {}).jendela || {})[key] || null;
}

/* Keadaan apa yang terekam pada menit ini. Dipakai saat memuat halaman &
   menekan Reset untuk menyetel penanda tombol — BUKAN untuk mengganti skenario
   saat pemutaran berjalan; keadaan hanya berpindah kalau operator menekan
   tombolnya sendiri. */
function dummySkenarioDiMenit(minute) {
  const i = dummyIndex(minute);
  let hasil = 'normal';
  Object.keys(DUMMY_SCENARIO).forEach(mode => {
    const j = dummyJendela(DUMMY_SCENARIO[mode].key);
    if (j && i >= j.dari && i < j.sampai) hasil = mode;
  });
  return hasil;
}

/* Rentang menit yang diputar untuk keadaan yang sedang dipilih. Tanpa rekaman
   jendela (mis. data belum di-seed ulang), seluruh rekaman dipakai. */
function dummyRentangPutar() {
  const span = dummySpan();
  const j = dummyJendela((DUMMY_SCENARIO[state.scenario] || {}).key);
  if (!j) return { mulai: 0, akhir: span };
  const peralihan = ((window.WMS_DUMMY || {}).histori || {}).peralihanMenit || 0;
  return { mulai: Math.min(j.dari + peralihan, span), akhir: Math.min(j.sampai, span) };
}

/* Faktor gelombang seeder: 1 + amplitudo · sin(menit · 12°). */
function dummyWave(minute) {
  return 1 + dummyAmplitudo() * Math.sin(minute * 12 * Math.PI / 180);
}

/* Kelambanan jaringan.
   Air tidak berpindah tinggi seketika: sisi naik curam, sisi surut landai
   karena air harus mengalir keluar dulu. Prototipe menirunya di tingkat model
   (`Qnat += (target − Qnat)·0,01` tiap langkah 5 detik, ±6,5 detik untuk
   sampai), bukan sekadar memperhalus gambarnya.

   Kelambanan ini sengaja dikenakan pada NILAINYA, bukan pada atribut SVG saja.
   Percobaan pertama cuma memperlambat gambar: tulisan sudah menunjukkan TMA
   0,51 m sementara kolom airnya masih terlukis di 1,1 m selama beberapa detik —
   angka dan gambar bercerita beda. Dengan kelambanan di nilai, semua yang
   membacanya (tulisan, warna kelas aliran, grafik, peta isometrik, kendali
   pintu) melihat satu keadaan yang sama.

   Tetapan waktu: naik 1,2 detik, surut 3,0 detik. Dihitung dari waktu nyata
   yang berlalu, jadi hasilnya sama saja baik dipanggil dari pemutaran (260 ms),
   penggulungan skenario (70 ms), maupun penetapan pintu (80 ms). */
const DUMMY_TAU_NAIK = 1.2, DUMMY_TAU_SURUT = 3.0;
let dummyLagWaktu = 0;
function dummyKelambanan(N) {
  const lalu = state.dummyNodes;
  const sekarang = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
  const dt = dummyLagWaktu ? clamp(sekarang - dummyLagWaktu, 0, 2) : 0;
  dummyLagWaktu = sekarang;
  if (!lalu || !dt || skGerakDikurangi) return;

  const seret = (kini, tuju) => {
    if (kini == null || !isFinite(kini)) return tuju;
    const tau = tuju >= kini ? DUMMY_TAU_NAIK : DUMMY_TAU_SURUT;
    return kini + (tuju - kini) * (1 - Math.exp(-dt / tau));
  };

  Object.keys(N).forEach(k => {
    const p = lalu[k];
    if (!p) return;
    N[k].tmaHulu = seret(p.tmaHulu, N[k].tmaHulu);
    N[k].tmaHilir = seret(p.tmaHilir, N[k].tmaHilir);
    N[k].debit = seret(p.debit, N[k].debit);
  });
}

/* `dt` = detik waktu rekaman yang berlalu sejak panggilan sebelumnya. Dipakai
   HANYA oleh neraca tampungan hulu; sisanya tetap kuasi-statik seperti dulu.
   Pemanggil yang cuma menggambar ulang tanpa memajukan waktu (boot, reset)
   mengirim 0, jadi muka air hulu diam di tempat. */
/* ---------------- Aturan operasi pintu primer per keadaan hulu ----------------

   Pola operasi bendung gerak: saat air kurang pintu ditutup untuk membendung,
   saat air berlebih dibuka untuk melewatkan.

     KEMARAU  floodway tutup · scouring tutup
       Seluruh pintu tertutup. Air tertahan di hulu, muka airnya naik sampai
       melewati mercu; debit hilir jatuh ke nol selama pengisian itu. Kolam tetap
       terisi karena sadapan bendung tidak berpintu — justru itu tujuannya:
       meninggikan muka air supaya pengambilan tetap dapat air.

     NORMAL   floodway kerja (bukaan acuan) · scouring tutup
       Debit sungai dilewatkan lewat floodway; penguras ditutup supaya air kolam
       tidak terbuang ke hilir. Pembilasan endapan dilakukan berkala, bukan
       terus-menerus.

     BANJIR   floodway penuh · scouring penuh
       Semua bukaan maksimum. Pada keadaan banjir floodway memang sudah mentok
       bukaan maksimum sebelum aturan ini ada, jadi yang berubah cuma penguras.

   'kerja' = bukaan acuan dummy (bukaanPersen, biasanya 75%), 'penuh' = bukaan
   maksimum pintu, 'tutup' = 0. Kunci tabelnya nama mode di layar
   (normal/flood/drought), sama dengan DUMMY_SCENARIO. */
const OPERASI_PRIMER = {
  normal:  { floodway: 'kerja', scouring: 'tutup' },
  flood:   { floodway: 'penuh', scouring: 'penuh' },
  drought: { floodway: 'tutup', scouring: 'tutup' },
};
function bukaanOperasi(peran) {
  const A = OPERASI_PRIMER[state.scenario] || OPERASI_PRIMER.normal;
  const P = (window.WMS_DUMMY || {}).pintu || {};
  const aMax = (P.bukaanMaksCm || 100) / 100;
  if (A[peran] === 'penuh') return aMax;
  if (A[peran] === 'kerja') return aMax * (P.bukaanPersen || 75) / 100;
  return 0;
}

/* Boot dan reset tidak punya langkah kendali sebelumnya. Sinkronkan pintu AUTO
   langsung ke tabel operasi agar tampilan pertama sudah benar: khususnya pada
   kondisi Normal, scouring harus 0 cm sejak frame pertama, bukan sempat 75 cm
   sampai simulasi atau perpindahan skenario dijalankan. Pintu MANUAL tidak
   disentuh supaya posisi operator tetap dihormati. */
function terapkanOperasiPrimerLangsung() {
  state.primary.forEach(p => {
    if (p.mode !== 'auto') return;
    p.ctrl.a = clamp(bukaanOperasi(p.role), 0, p.aMax);
  });
}

/* Bukaan ACUAN KALIBRASI untuk keadaan hulu yang sedang berjalan — yaitu bukaan
   tempat bendung menghasilkan persis angka snapshot.

   Dua pemakainya:
     · applyDummySnapshot() mengkalibrasi koefisien pintu terhadapnya;
     · initDummyGates()     memasang pintu di sini sebagai posisi awal.

   Keduanya harus memakai dasar yang sama. Kalau tidak, tampilan pertama meleset
   dari snapshot: pada keadaan kemarau bukaan acuan floodway 0,21 m, dan pintu
   yang dipasang di 0,75 m melewatkan 3,6x jatahnya — debit hilir terbaca 16,34
   m³/dtk sementara sungai cuma membawa 4,79.

   BUKAN sasaran kendali AUTO. Sasaran itu datang dari OPERASI_PRIMER, tabel
   aturan operasi per keadaan, dan sengaja BERBEDA dari bukaan di sini: pada
   kemarau aturannya menutup seluruh pintu, jadi muka air hulu memang bergerak
   naik meninggalkan angka snapshot. Bukaan aturan juga tidak bisa dipakai
   mengkalibrasi — pada kemarau nilainya nol, dan nol tidak bisa jadi penyebut. */
function dummyBukaanAcuan(N) {
  const D = window.WMS_DUMMY || {};
  const P = D.pintu || {};
  const m = (cm) => cm / 100;
  const aPintu = m((P.bukaanMaksCm || 100) * (P.bukaanPersen || 75) / 100);
  const aMax = m(P.bukaanMaksCm || 100);
  const normal = (((D.skenario || {}).normal || {}).nodes) || D.nodes || {};
  const huluNormal = normal.WEIR_COPONG || normal.AWLR_HULU || {};
  const kolamNormal = normal[dummyIndukId()] || {};

  const hUp0 = Math.max(m((N.WEIR_COPONG || {}).tmaHulu || 0), 0.05);
  const qHulu = (N.WEIR_COPONG || {}).debit || 0;
  const qKolam = (N[dummyIndukId()] || {}).debit || 0;
  const hNormal = Math.max(m(huluNormal.tmaHulu || 143), 0.05);
  const qLimpasNormal = Math.max(0, (huluNormal.debit || 0) - (kolamNormal.debit || 0));
  const qLimpas = Math.max(0, qHulu - qKolam);

  /* Scouring MENGURAS kolam untuk membilas endapan di depan pengambilan — ia
     bukan pemasok jaringan irigasi. Jatahnya sudah tertulis di simpul
     PG_SCOURING tiap keadaan, dan bukaan yang melewatkannya adalah bukaan acuan
     itu sendiri: snapshot memang potret bendung pada bukaan acuan.

     Dulu bukaan ini dihitung `(kebutuhan seluruh petak + jatah pembilas) ×
     aPintu / qKolam`, mengikuti susunan lama tempat scouring memasok jaringan.
     Yang memasok jaringan sekarang pintu intake, dan lingkarnya sendiri yang
     mengejar kebutuhan petak. */
  const aScour = aPintu;
  /* Debit pintu di bawah daun sebanding a√h, jadi bukaan yang dibutuhkan untuk
     melimpaskan qLimpas pada tinggi tekan hUp0:
       a = aPintu × (qLimpas / qLimpas_normal) × √(h_normal / hUp0)
     Cd dan lebar daun hilang dalam perbandingan terhadap keadaan normal. */
  const aFlood = qLimpasNormal > 0.0001
    ? clamp(aPintu * (qLimpas / qLimpasNormal) * Math.sqrt(hNormal / hUp0), 0.02, aMax)
    : aPintu;

  return { aPintu, aMax, aScour, aFlood, hUp0 };
}

function applyDummySnapshot(minute, dt) {
  const D = window.WMS_DUMMY;
  if (!D) return;
  const w = dummyWave(minute || 0);
  /* Keadaan hulu diambil per simpul dari payload; kapasitas tiap bangunan
     sudah diperhitungkan di sisi Laravel, jadi di sini tinggal dipakai. */
  const SN = dummyScenarioNodes();
  /* Rekaman sensor tiga jam terakhir. Kalau simpulnya punya rekaman, angkanya
     dipakai apa adanya — riak dan keadaan hulunya sudah ikut terekam, jadi
     tidak boleh dikalikan lagi. Simpul tanpa rekaman (mis. belum di-seed) jatuh
     ke snapshot skenario seperti sebelumnya. */
  const H = ((D.histori || {}).nodes) || {};
  const i = dummyIndex(minute);
  const N = {};
  Object.keys(D.nodes).forEach(k => {
    const n = D.nodes[k];
    const rekam = H[k];
    const b = (SN && SN[k]) ? SN[k] : n;
    const ambil = (deret, cadangan) => (deret && deret[i] != null) ? deret[i] : cadangan;
    N[k] = rekam ? {
      ...n,
      tmaHulu: ambil(rekam.tma, b.tmaHulu * w),
      tmaHilir: ambil(rekam.tmaHilir, b.tmaHilir * w),
      debit: ambil(rekam.debit, b.debit * w),
    } : {
      ...n,
      tmaHulu: b.tmaHulu * w,
      tmaHilir: b.tmaHilir * w,
      debit: b.debit * w,
    };
  });
  dummyKelambanan(N);
  state.dummyNodes = N;
  const m = (cm) => cm / 100;
  const aPintu = m(D.pintu.bukaanMaksCm * D.pintu.bukaanPersen / 100);

  state.Qnat = N.WEIR_COPONG.debit;
  state.QnatTarget = state.Qnat;
  /* `hUp0` = muka air hulu yang TERBACA di snapshot, yaitu muka air acuan:
     tinggi yang memang tercapai kalau seluruh pintu berdiri di bukaan acuan.
     Muka air yang dipakai tampilan (state.hUp) dihitung dari tampungan di
     bawah, dan pada bukaan acuan ia setimbang tepat di hUp0 — lihat kalibrasi
     koefisien pintu. */
  const hUp0 = m(N.WEIR_COPONG.tmaHulu);
  state.pool.h = m(N.WEIR_COPONG.tmaHilir);
  /* Target TMA kolam TIDAK disetel ulang di sini. Dulu targetnya dipasang sama
     dengan muka air yang baru saja terbaca, jadi galat kendali selalu nol dan
     pintu primer tidak pernah punya alasan bergerak. Targetnya dipasang sekali
     di initDummyGates() (tinggi operasi normal) dan dipertahankan — itulah yang
     dikejar pintu saat keadaan hulu berubah. */
  /* Penampang sungai mengikuti prototipe SIMHIDRO: lebar 30 m, tinggi tanggul
     6 m. Dengan n = 0,034 dan S₀ = 0,00035, Manning pada TMA 1,43 m memberi
     arus 0,66 m/dtk dan debit 28,17 m³/dtk — sama persis dengan tampilan acuan.
     Angka lama (B 6,3 m, tanggul 4,5 m, TMA 3,25 m) membuat kolom air normal
     sudah terisi 72% dan status langsung WASPADA padahal keadaannya wajar. */
  state.river.B = 30;
  state.river.Hmax = 6.0;
  state.pool.Hmax = POOL_HMAX;   /* tanggul kolam, bukan tanggul sungai */
  /* state.vUp dihitung SETELAH neraca tampungan hulu di bawah — dulu di sini,
     memakai state.hUp milik tick sebelumnya. */
  /* Kebutuhan per hektar ikut keadaan hulu — lihat dummyDuty(). Normal & hujan
     1,00 l/dtk/ha (norma prototipe; 360 ha × 1,0 = 0,36 m³/dtk), kemarau 0,65
     mengikuti rencana tata tanam palawija. */
  state.duty = dummyDuty();

  /* Bukaan pintu ikut menentukan debit: rasio terhadap bukaan acuan dummy (75 cm). */
  const fr = (a) => clamp(a / aPintu, 0, 1 / (D.pintu.bukaanPersen / 100));
  const scour = state.primary.filter(p => p.role === 'scouring');
  const flood = state.primary.filter(p => p.role === 'floodway');
  /* scouring menguras kantong lumpur; floodway melimpas ke hilir sungai */
  /* primFactor & floodFactor (rasio BUKAAN terhadap bukaan acuan) tidak lagi
     dipakai menghitung debit — lihat blok kalibrasi bendung di bawah. Yang
     dipakai rantai sekunder & tersier sekarang `pasokFactor`, rasio DEBIT. */

  const induk = N[dummyIndukId()];

  /* ================= BENDUNG: kalibrasi bangunan & neraca tampungan hulu ======

     Model lama menghitung debit langsung dari snapshot dikali rasio bukaan, dan
     menaruh sisanya di `Qspill`:

       QgateTotal = induk.debit × primFactor
       Qflood     = (Qsungai − QgateTotal) × min(floodFactor, 1)
       Qspill     = (Qsungai − QgateTotal) − Qflood        ← SISA, bukan rumus

     Konsekuensinya: menutup seluruh pintu membuat Qflood = 0 dan Qspill menelan
     SELURUH debit sungai, jadi debit hilir tidak berubah sedikit pun. Muka air
     hulu pun dibaca mentah dari snapshot, jadi ia juga tidak bergerak. Bendung
     yang seluruh pintunya ditutup tidak membendung apa-apa.

     Sekarang tiap jalan keluar punya rumusnya sendiri sebagai fungsi muka air
     hulu `h`, lalu `h` dicari dari neraca tampungan — bukan sebaliknya:

       Qscouring(h) = Cs · Σa_scouring · √h        (persamaan lubang, Q ∝ a√h)
       Qfloodway(h) = Cf · Σa_floodway · √h
       Qmercu(h)    = Cw · b_mercu · max(0, h − h_mercu)^1,5   (ambang lebar)

     Cs & Cf DIKALIBRASI TIAP TICK terhadap keadaan acuan, yaitu snapshot pada
     bukaan acuan (75%). Dengan begitu Qkeluar(hUp0, bukaan acuan) = Qsungai
     PERSIS, jadi tampungan setimbang tepat di muka air snapshot dan seluruh
     angka kalibrasi normal/hujan/kemarau tetap seperti sebelumnya. Yang berubah
     hanya perilaku saat bukaan MENYIMPANG dari acuan — dan justru itu yang dulu
     tidak ada.

     Cd, lebar daun, dan tinggi tekan hilir tidak perlu diketahui: semuanya
     hilang dalam perbandingan terhadap keadaan acuan, pola yang sama dengan
     yang sudah dipakai dummyGateStep() menghitung bukaan yang dibutuhkan. */
  const hu = state.hulu;
  hu.bMercu = state.river.B * MERCU_RASIO_B;
  /* Mercu adalah BANGUNAN: elevasinya dari D.nodes (TMA hulu rancangan), bukan
     dari N (potret skenario yang sedang berjalan) — kalau dari N, mercunya ikut
     naik-turun tiap kali operator berpindah keadaan. */
  if (!hu.hMercu) hu.hMercu = m(((D.nodes || {}).WEIR_COPONG || {}).tmaHulu || 143) * MERCU_RASIO;
  const qMercu = (h) => MERCU_CW * hu.bMercu * Math.pow(Math.max(0, h - hu.hMercu), 1.5);

  /* ---- TOPOLOGI: mengikuti bendungTopology() di SkemaIrigasiController ----

       sungai hulu ─┬─> 3 pintu intake ──> KOLAM BENDUNG ──> saluran sekunder
                    │                         └─> scouring ──> hilir
                    ├─> 3 pintu floodway ───────────────────> hilir
                    └─> mercu (limpasan) ───────────────────> hilir

     Intake mengisi kantong lumpur; scouring mengurasnya untuk pembilasan.
     Susunan yang sama dipakai oleh data Laravel, skematik, dan model neraca
     supaya pintu yang digambar sebagai pengisi memang menambah tampungan. */
  const REF = dummyBukaanAcuan(N);
  const sec = state.secondary, secNode = N[dummySekunderId()];
  const nGate = sec.gates.length;
  const sqRef = Math.sqrt(Math.max(hUp0, 0.05));

  /* Pembagian debit sungai PADA BUKAAN ACUAN: kolam mengambil jatahnya lebih
     dulu (itu yang tertulis di snapshot AWLR_KOLAM), mercu melimpaskan yang
     memang di atas ambangnya, sisanya lewat pintu floodway. */
  const qKolamRef = induk.debit;
  const qSpillRef = Math.min(qMercu(hUp0), Math.max(0, state.Qnat - qKolamRef));
  const qFloodRef = Math.max(0, state.Qnat - qKolamRef - qSpillRef);
  const Cflood = qFloodRef / Math.max(flood.length * REF.aFlood * sqRef, 1e-6);
  const aFloodKini = flood.reduce((acc, p) => acc + p.ctrl.a, 0);
  const qFloodAt = (h) => Cflood * aFloodKini * Math.sqrt(Math.max(h, 0));

  /* ---- PINTU INTAKE ADA DI MULUT KANTONG LUMPUR ----

     Susunan lapangan (dikonfirmasi operator) dan gambar skematik sepakat:

       sungai hulu → 3 PINTU INTAKE → kantong lumpur ─┬─> saluran sekunder
                                                      └─> pintu scouring → hilir

     Dengan intake di mulut kolam, pengisi dan penguras jadi bangunan yang
     BERBEDA — dan barulah TMA kolam bisa dikejar, persis pola pintu `primary`
     pada prototipe SIMHIDRO (di sana ketiga pintu primer mengisi kolam sambil
     mengejar targetPoolLevel).

     Snapshot Laravel juga membagi debit AWLR_KOLAM ke ketiga PG_INTAKE, sehingga
     jumlah bacaan pintu selalu sama dengan debit yang benar-benar masuk kolam. */
  const poolRef = m(N.WEIR_COPONG.tmaHilir);
  const sqPoolRef = Math.sqrt(Math.max(poolRef, 0.02));
  const dhIntakeRef = Math.max(hUp0 - poolRef, 0.01);


  const qSecRef = secNode ? secNode.debit : 0;
  /* Jatah pembilas = yang tertulis di simpul PG_SCOURING; kalau simpulnya belum
     ada di payload, sisa isi kolam setelah saluran sekunder mengambil bagiannya
     — pembagian yang sama dengan skenarioSnapshot() di controller. */
  const qScourRef = (N.PG_SCOURING || {}).debit != null
    ? N.PG_SCOURING.debit
    : Math.max(0, qKolamRef - qSecRef);
  const aScourKini = scour.reduce((acc, p) => acc + p.ctrl.a, 0);
  const Cscour = qScourRef / Math.max(REF.aScour * sqPoolRef, 1e-6);
  /* DIJEPIT ke kapasitas bangunannya, alasan yang sama dengan jepitan pintu
     floodway: pada keadaan banjir pintu ini melewatkan 0,666 m3/dtk terhadap
     kapasitas 0,30 (222%) — bacaan yang tidak mungkin dicapai bangunannya.

     Dampaknya terbawa jauh: yang keluar dari kolam harus diimbangi yang masuk,
     jadi kantong lumpur terbaca melewatkan 1,026 m3/dtk terhadap kapasitasnya
     0,80 (128%) dan berkelas WASPADA walau muka airnya tepat di tinggi operasi.
     Sesudah dijepit, yang lewat kolam 0,30 + 0,36 = 0,66 (82%) — kembali biru.

     Snapshot Laravel sendiri menulis 0,740 untuk keadaan banjir karena
     skenarioSnapshot() menjepit floodway ke kapasitas tetapi tidak menjepit
     scouring. Jadi angka scouring banjir bergeser 0,740 -> 0,300 di tampilan;
     itu koreksi, bukan penyimpangan. */
  const kapScour = (N.PG_SCOURING || {}).kapasitas || Infinity;
  const qScourAt = (hPool) => Math.min(Cscour * aScourKini * Math.sqrt(Math.max(hPool, 0)), kapScour);

  /* PINTU INTAKE — mengisi kantong lumpur dari sungai. Tinggi tekannya SELISIH
     muka air hulu dan kolam, bukan muka air kolam saja: itulah yang membuat
     pengisian berhenti sendiri begitu kolam menyamai sumbernya.

     Dikalibrasi ke qKolamRef (0,56 = seluruh yang masuk kolam), dibagi menurut
     porsi kapasitas tiap pintu. Bukan ke debit saluran sekunder (0,36), karena
     0,36 itu yang KELUAR kolam, bukan yang masuk. */
  const porsiIntake = sec.gates.map((gt, i) => {
    const n = N['PG_INTAKE_' + (i + 1)];
    return n && n.kapasitas != null ? n.kapasitas : 1;
  });
  const jumlahPorsi = porsiIntake.reduce((a, b) => a + b, 0);
  const qIntakeRef = porsiIntake.map(q => (jumlahPorsi > 1e-9 ? qKolamRef * q / jumlahPorsi : 0));
  const Cintake = qIntakeRef.map(q => q / Math.max(REF.aPintu * Math.sqrt(dhIntakeRef), 1e-6));
  /* Batas total intake mengikuti kapasitas kantong lumpur (0,80 m3/dtk), lalu
     dibagi menurut proporsi kapasitas ketiga pintu. Ini juga menjaga instalasi
     dengan data lama tetap kompatibel walau kapasitas pintunya belum di-seed
     ulang setelah intake dipindahkan ke hulu kolam. */
  const kapKolam = (N[dummyIndukId()] || {}).kapasitas || Infinity;
  const kapIntake = porsiIntake.map(q =>
    (jumlahPorsi > 1e-9 && isFinite(kapKolam) ? kapKolam * q / jumlahPorsi : Infinity));
  const qIntakeAt = (i, hUp, hPool) =>
    Math.min(Cintake[i] * sec.gates[i].ctrl.a * Math.sqrt(Math.max(0, hUp - hPool)), kapIntake[i]);
  const qIntakeTotalAt = (hUp, hPool) => sec.gates.reduce((a, gt, i) => a + qIntakeAt(i, hUp, hPool), 0);

  /* KELUAR KOLAM KE SALURAN SEKUNDER — tanpa pintu. Pintu yang ada semuanya di
     mulut kolam (intake) atau membuang ke sungai (scouring); dari kantong lumpur
     ke saluran induk airnya mengalir bebas, jadi debitnya cuma fungsi muka air
     kolam. Dikalibrasi ke debit saluran sekunder acuan (0,36). */
  /* Koefisien bangunan ini TETAP — diambil dari muatan dasar D.nodes (keadaan
     rancangan), bukan dari potret skenario yang sedang berjalan.

     Snapshot per skenario tidak bisa dipakai: fTma di controller dihitung
     sendiri-sendiri per simpul dari rasio debitnya, jadi urutan elevasinya tidak
     terjaga. Pada keadaan kemarau ia menaruh saluran sekunder di 0,70 m
     sementara kantong lumpur yang memasoknya cuma 0,47 m — beda tingginya
     negatif, dan koefisien yang dikalibrasi dari situ meledak. Keadaan rancangan
     memberi beda yang benar: kolam 1,36 m, saluran 1,00 m, selisih 0,36 m. */
  const poolDasar = m(((D.nodes || {}).WEIR_COPONG || {}).tmaHilir || 136);
  const secDasar = m(((D.nodes || {})[dummySekunderId()] || {}).tmaHulu || 100);
  const qSekDasar = ((D.nodes || {})[dummySekunderId()] || {}).debit || 0.36;
  const Csek = qSekDasar / Math.sqrt(Math.max(poolDasar - secDasar, 0.01));
  /* Didorong SELISIH muka air kolam dan saluran, bukan muka air kolam saja.
     Bentuk yang lama (Csek × h_kolam^1,5) membuat kolam terus mengalirkan air ke
     saluran walau saluran sudah lebih tinggi daripada kolam — dan itu terjadi:
     sesudah berpindah dari banjir ke kemarau, saluran sekunder terbaca 2,10 m
     sementara kantong lumpur yang memasoknya cuma 1,00 m. Air tidak bisa
     mengalir ke tempat yang lebih tinggi.

     Dengan selisih muka air, alirannya berhenti sendiri begitu saluran menyamai
     kolam — persis seperti pengisian kolam dari sungai di atasnya. Saluran yang
     terlanjur penuh karena itu tidak lagi terus diisi; ia langsung terkuras
     pintu tersier dan limpasan tanggulnya sampai turun di bawah muka air kolam. */
  const qKeSekAt = (hPool, hSek) => Csek * Math.sqrt(Math.max(0, hPool - hSek));

  /* ---- Penguras saluran sekunder & tersier ----

     Sampai sebelum ini muka air kedua saluran cuma fungsi debit yang MASUK:

       sec.canal.h = tmaHulu × (QsecTotal / qSecRef)^0,35

     Tidak ada suku untuk yang keluar, jadi saluran itu tidak punya neraca dan
     tidak bisa terbendung: menutup pintu tersier menurunkan saluran tersier,
     tetapi muka air saluran sekunder di atasnya tidak bergerak sedikit pun —
     padahal menutup pintu di ujung hilir justru menahan air di hulunya.

     Sekarang keduanya punya tampungan sendiri, dengan pola yang sama seperti
     hulu dan kolam. Jalan keluarnya dua macam:

       pintu tersier  Q = C · a · √h_sekunder   (persamaan lubang, ada pintunya)
       ambang sawah   Q = C · h_tersier^1,5     (ambang lebar, TANPA pintu —
                                                 bangunan sadap ke petak memang
                                                 tidak bermotor)

     Keduanya dikalibrasi ke snapshot: pada bukaan acuan dan muka air acuan,
     debitnya persis angka simpul PG_TERSIER_i dan AWLR_TERSIER_i, jadi kedua
     saluran setimbang tepat di TMA snapshot dan angka kalibrasi tidak bergeser. */
  const secRef = m(secNode.tmaHulu);
  const sqSecRef = Math.sqrt(Math.max(secRef, 0.02));
  const tertNode = (i) => N[(D.rantai[i] || {}).tersier] || {};
  /* Debit acuan pintu tersier: dari simpul PG_TERSIER_i kalau ada, kalau tidak
     porsinya dari debit saluran sekunder — pembagian yang sama dengan
     controller. */
  const qTertRef = state.tertiary.map((t, i) => {
    const n = N['PG_TERSIER_' + (i + 1)];
    if (n && n.debit != null) return n.debit;
    const q = tertNode(i).debit;
    return q != null ? q : qSecRef / Math.max(state.tertiary.length, 1);
  });
  const Ctert = qTertRef.map(q => q / Math.max(REF.aPintu * sqSecRef, 1e-6));
  const qTertAt = (i, hSec) => Ctert[i] * state.tertiary[i].gate.ctrl.a * Math.sqrt(Math.max(hSec, 0));
  const qTertTotalAt = (hSec) => state.tertiary.reduce((a, t, i) => a + qTertAt(i, hSec), 0);

  /* Ambang sawah: muka air acuan saluran tersier dari simpul AWLR_TERSIER_i,
     debit acuannya debit simpul itu sendiri. Batas bawah 0,02 m menjaga pangkat
     1,5 tetap terhingga saat salurannya nyaris kering. */
  const tertRef = state.tertiary.map((t, i) => Math.max(m(tertNode(i).tmaHulu || 13), 0.02));
  const qFieldRef = state.tertiary.map((t, i) => {
    const q = tertNode(i).debit;
    return q != null ? q : qTertRef[i];
  });
  const Cfield = qFieldRef.map((q, i) => q / Math.max(Math.pow(tertRef[i], 1.5), 1e-6));
  const qFieldAt = (i, hTert) => Cfield[i] * Math.pow(Math.max(hTert, 0), 1.5);

  /* LIMPASAN TANGGUL SALURAN. Saluran yang airnya melewati tanggul membuang
     kelebihannya keluar — ke saluran pembuang, atau meluber ke lahan.

     Tanpa suku ini muka airnya memang berhenti di tanggul, tetapi hanya karena
     dijepit saat digambar: tampungannya sendiri terus menumpuk tanpa batas.
     Akibatnya saluran yang pernah meluap tidak pernah bisa surut lagi — pada uji
     dengan pintu tersier ditutup, saluran sekunder mengendap di 2,10 m dan tetap
     di situ walau pintunya dibuka kembali, karena volume yang tertimbun jauh di
     atas yang terbaca.

     Ambang lebar dengan koefisien FIXED.fieldCw dan lebar sama dengan lebar
     salurannya. Pada keadaan normal muka air jauh di bawah tanggul (1,00 dari
     2,00 m; 0,13 dari 0,30 m), jadi sukunya nol dan tidak ada angka kalibrasi
     yang bergeser. */
  const qLuapAt = (h, hMax, B) => FIXED.fieldCw * B * Math.pow(Math.max(0, h - hMax), 1.5);

  /* ---- Neraca SELURUH tampungan, diintegrasi BERSAMA ----

     Hulu → kolam → saluran sekunder → tiga saluran tersier → petak. Semuanya
     terkait berantai: yang keluar dari satu ruas masuk ke ruas berikutnya.
     Mengintegrasinya terpisah membuat air terhitung dua kali pada langkah yang
     sama, jadi seluruhnya dimajukan di dalam satu lingkar sub-langkah. */
  const luasHulu = state.river.B * HULU_L;
  const luasKolam = state.river.B * FIXED.poolL;
  sec.canal.B = 6;
  sec.canal.Hmax = 2.0;   /* saluran sekunder prototipe */
  const luasSec = sec.canal.B * FIXED.secL;
  state.tertiary.forEach(t => {
    t.canal.B = 2.5;
    /* Tinggi tanggul saluran tersier 0,30 m, bukan 1,20 m. TMA tersier di
       BENDUNG_PANEL 13/15/11 cm dan seluruh rentang tiga skenario cuma
       8,2–20,8 cm; terhadap tanggul 1,20 m kolom airnya cuma mengisi 7–17%
       kotak dan perpindahan kemarau → banjir bergerak 4 px dari 42 px. 0,30 m
       mengikuti perbandingan saluran sekunder (tanggul 2,0 m terhadap muka air
       operasi 1,00 m), jadi kedua saluran terbaca pada skala yang sama. */
    t.canal.Hmax = 0.30;
  });
  const luasTert = state.tertiary.map(t => t.canal.B * FIXED.tertL);

  if (!hu.siap) {
    hu.S = hUp0 * luasHulu;
    state.pool.S = poolRef * luasKolam;
    sec.canal.S = secRef * luasSec;
    state.tertiary.forEach((t, i) => { t.canal.S = tertRef[i] * luasTert[i]; });
    hu.siap = true;
  }
  /* Sub-langkah maksimal 60 detik: pada laju putar tinggi satu tick bisa
     mewakili beberapa menit rekaman, dan suku berpangkat 1,5 (mercu, ambang
     sawah) tumbuh cepat — langkah Euler yang terlalu panjang membuatnya berayun
     alih-alih mengendap. */
  const dtTotal = Math.max(0, dt || 0);
  let qLuapTotal = 0;   /* volume limpasan tanggul saluran, m3 sepanjang langkah */
  const Ssebelum = hu.S + state.pool.S + sec.canal.S
                 + state.tertiary.reduce((a, t) => a + t.canal.S, 0);
  let sisaDt = dtTotal;
  while (sisaDt > 0.001) {
    const dtSub = Math.min(sisaDt, 60);
    const hUp = hu.S / luasHulu, hPool = state.pool.S / luasKolam;
    const hSec = sec.canal.S / luasSec;
    /* Debit masuk kolam dijepit ke air yang cukup untuk MENYAMAKAN kedua muka
       air dalam satu sub-langkah. Tanpa jepitan ini kolam bisa melewati muka air
       hulu ketika bedanya sudah tipis — √(hUp−hPool) punya kemiringan tak
       terhingga di sana — lalu berayun bolak-balik melintasi titik itu. */
    const qIn = Math.min(qIntakeTotalAt(hUp, hPool),
                         Math.max(0, hUp - hPool) * luasKolam / dtSub);
    /* Dijepit ke air yang cukup MENYAMAKAN kedua muka air dalam satu sub-langkah,
       alasan yang sama dengan jepitan pengisian kolam: √(hPool−hSek) punya
       kemiringan tak terhingga saat bedanya tipis. */
    const qSekIn = Math.min(qKeSekAt(hPool, hSec),
                            Math.max(0, hPool - hSec) * luasSec / dtSub);
    hu.S = Math.max(0.02 * luasHulu,
                    hu.S + (state.Qnat - qIn - qFloodAt(hUp) - qMercu(hUp)) * dtSub);
    state.pool.S = Math.max(0.02 * luasKolam,
                            state.pool.S + (qIn - qScourAt(hPool) - qSekIn) * dtSub);
    /* Saluran sekunder: masuk dari ketiga pintu intake, keluar lewat ketiga
       pintu tersier dan — bila melewati tanggul — lewat limpasan. Menutup pintu
       tersier mengurangi keluarannya, jadi muka airnya NAIK; itulah yang dulu
       tidak bisa terjadi. */
    const luapSec = qLuapAt(hSec, sec.canal.Hmax, sec.canal.B);
    qLuapTotal += luapSec * dtSub;
    /* qSekIn = keluaran kolam ke saluran induk (tanpa pintu), bukan debit pintu
       intake — intake berada di hulu kolam. */
    sec.canal.S = Math.max(0.02 * luasSec,
                           sec.canal.S + (qSekIn - qTertTotalAt(hSec) - luapSec) * dtSub);
    /* Tiap saluran tersier: masuk lewat pintunya, keluar lewat ambang sadap ke
       petaknya. Ambang tidak berpintu, jadi keluarannya hanya bisa dikurangi
       dengan menurunkan muka airnya sendiri. */
    state.tertiary.forEach((t, i) => {
      const hT = t.canal.S / luasTert[i];
      const luapT = qLuapAt(hT, t.canal.Hmax, t.canal.B);
      qLuapTotal += luapT * dtSub;
      t.canal.S = Math.max(0.02 * luasTert[i],
                           t.canal.S + (qTertAt(i, hSec) - qFieldAt(i, hT) - luapT) * dtSub);
    });
    sisaDt -= dtSub;
  }
  /* Limpasan tanggul saluran keluar dari jaringan irigasi dan kembali ke sungai
     lewat saluran pembuang, jadi ia dihitung sebagai debit hilir — bukan hilang.
     Rata-rata sepanjang langkah, karena tiap sub-langkah punya nilainya sendiri. */
  state.Qluap = dtTotal > 0 ? qLuapTotal / dtTotal : 0;
  const Ssesudah = hu.S + state.pool.S + sec.canal.S
                 + state.tertiary.reduce((a, t) => a + t.canal.S, 0);
  const dStotalDt = dtTotal > 0 ? (Ssesudah - Ssebelum) / dtTotal : 0;
  state.hUp = clamp(hu.S / luasHulu, 0.02, state.river.Hmax * 1.05);
  /* Muka air acuan disimpan untuk dummyGateStep(): lingkar kendali AUTO
     memakainya sebagai titik nol galat, jadi pada bukaan acuan bukaan yang
     diminta tidak bergeser sedikit pun dari sebelumnya. */
  state.hUpAcuan = hUp0;
  state.poolAcuan = poolRef;
  /* Muka air acuan saluran sekunder — titik nol model balik pintu tersier di
     dummyGateStep(), sama peran dengan poolAcuan bagi pintu intake. */
  state.secAcuan = secRef;
  /* Arus hulu = debit sungai dibagi luas penampangnya, BUKAN Manning.

     Manning menghitung kecepatan aliran seragam yang menuruni kemiringan
     dasarnya. Ruas ini bukan itu: ia genangan backwater di belakang bendung —
     air TERTAHAN, dan makin tinggi muka airnya makin lambat ia bergerak.
     Manning memberi arah yang terbalik, karena kedalaman lebih besar berarti
     jari-jari hidraulik lebih besar dan kecepatan lebih tinggi.

     Terlihat paling jelas pada keadaan kemarau, saat aturan operasi menutup
     seluruh pintu dan muka air hulu naik ke 2,05 m:

       Manning        0,814 m/dtk   (gores 1,4 detik — terbaca deras)
       Q/(B x h)      0,078 m/dtk   (gores 4,5 detik — tenang, dan benar)

     yaitu meleset 10x, dan kemarau tergambar LEBIH kencang daripada normal
     walau debit sungainya seperenamnya. Pada normal & banjir keduanya nyaris
     sama (0,663 vs 0,647; 1,041 vs 1,103) — di situ alirannya memang mendekati
     seragam — jadi angka kalibrasi kedua keadaan itu praktis tidak bergeser. */
  state.vUp = state.Qnat / (state.river.B * Math.max(state.hUp, 0.05));
  state.pool.h = clamp(state.pool.S / luasKolam, 0.02, Math.min(state.hUp, state.river.Hmax));

  /* QgateTotal = yang MASUK kolam dari sungai. Dulu ia debit pintu scouring —
     penamaan yang ikut susunan lama; pin kolam & bacaan "Debit masuk" di
     skematik memang menghendaki debit pengisi kolam. */
  state.QgateTotal = qIntakeTotalAt(state.hUp, state.pool.h);
  state.Qscour = qScourAt(state.pool.h);
  state.Qflood = qFloodAt(state.hUp);
  state.Qspill = qMercu(state.hUp);

  /* Arus kolam = DEBIT YANG LEWAT dibagi luas penampangnya — pola yang sama
     dengan saluran sekunder & tersier, bukan Manning seperti ruas sungai.

     Kolam bendung bukan ruas sungai yang mengalir menuruni kemiringannya; ia
     kantong lumpur yang sengaja dibuat lebar supaya air MELAMBAT dan endapan
     sempat turun. Manning atas geometri sungai (B 30 m, n 0,034, S₀ 0,00035)
     menjawab pertanyaan yang salah: pada TMA 1,36 m ia memberi 0,64 m/dtk,
     sementara 0,56 m³/dtk yang benar-benar lewat penampang 30 × 1,36 = 40,8 m²
     cuma menghasilkan 0,014 m/dtk — meleset 47 kali. Yang terlihat di layar:
     gores air di kotak kolam berjalan secepat sungai, dan menutup pintu intake
     tidak memperlambatnya sedikit pun karena bukaan pintu memang tidak masuk
     hitungan Manning.

     Ditulis SESUDAH state.QgateTotal, bukan sebelumnya: menaruhnya di atas
     membuat arus kolam memakai debit tick SEBELUMNYA, dan pada panggilan
     pertama QgateTotal masih 0 sehingga kotak kolam terbaca 0,00 m/dtk. */
  state.vPool = state.QgateTotal / (state.river.B * Math.max(state.pool.h, 0.05));

  /* Debit tiap pintu floodway = bagian proporsionalnya dari state.Qflood, bukan
     hitungan sendiri.

     Dulu tiap pintu dihitung dari `Qnat - induk.debit` sementara totalnya dari
     `Qnat - QgateTotal` — dua dasar yang berbeda, jadi jumlah ketiga bacaan pintu
     tidak sama dengan debit floodway yang ditulis di sebelahnya, dan keduanya
     ikut melewati batas air yang tersedia. Dengan pembagian proporsional,
     jumlahnya sama dengan state.Qflood tepat, dan jepitan di atas berlaku untuk
     bacaan tiap pintu sekaligus.

     Bagian tiap pintu lalu DIJEPIT LAGI ke kapasitas pintunya sendiri. Tanpa itu
     keadaan banjir menulis 34,56 m³/dtk pada pintu berkapasitas 12 m³/dtk (288%)
     — bacaan yang tidak mungkin dicapai bangunannya. Kelebihannya bukan hilang,
     ia pindah ke state.Qspill: kalau ketiga pintu sudah penuh, sisanya memang
     melimpas di atas ambang. */
  const frFloodTotal = flood.reduce((acc, p) => acc + fr(p.ctrl.a), 0);
  const kapFlood = (i) => ((N['PG_FLOODWAY_' + (i + 1)] || {}).kapasitas) || Infinity;
  let qFloodPintu = 0;
  const qFloodTiap = flood.map((p, i) => {
    const bagian = frFloodTotal > 0.0001 ? state.Qflood * fr(p.ctrl.a) / frFloodTotal : 0;
    const q = Math.min(bagian, kapFlood(i));
    qFloodPintu += q;
    return q;
  });
  state.Qspill += Math.max(0, state.Qflood - qFloodPintu);
  state.Qflood = qFloodPintu;
  let iFlood = 0;
  state.Qprim = state.primary.map(p => {
    if (p.role === 'scouring') return state.Qscour;
    return qFloodTiap[iFlood++] || 0;
  });

  /* Muka air kedua saluran datang dari TAMPUNGANNYA, bukan lagi dari rumus
     pangkat atas debit masuk. Debitnya pun dihitung dari bangunannya sendiri:
     pintu intake & pintu tersier memakai persamaan lubang, sadapan ke petak
     memakai ambang lebar. */
  sec.canal.h = clamp(sec.canal.S / luasSec, 0.02, sec.canal.Hmax * 1.05);
  sec.gates.forEach((gt, i) => {
    gt.aMax = m(D.pintu.bukaanMaksCm);
    state.Qsec[i] = qIntakeAt(i, state.hUp, state.pool.h);
  });
  /* QsecTotal = yang MENGALIR DI saluran sekunder, yaitu keluaran kolam — bukan
     jumlah debit pintu intake, yang sekarang berada di HULU kolam dan mengisi
     kantong lumpur. Keduanya sama besar hanya pada keadaan mapan tanpa
     pembilasan; begitu scouring dibuka, yang lewat intake lebih besar daripada
     yang sampai ke saluran. */
  state.QkeSek = qKeSekAt(state.pool.h, sec.canal.h);
  state.QsecTotal = state.QkeSek;
  state.vSec = state.QsecTotal / (sec.canal.B * Math.max(sec.canal.h, 0.05));

  /* KENDALI INTAKE BERANTAI — menjaga kolam lumpur DAN saluran sekunder.

     Dari kolam ke sekunder tidak ada pintu tambahan, jadi kedua TMA tidak bisa
     dipatok secara terpisah. Kendali menghitung titik setimbang yang kompatibel:

       1. debit sasaran ke sekunder = debit keluar tersier + koreksi volume
          menuju TMA sekunder target;
       2. TMA kolam sasaran = TMA sekunder + (Qsek/Csek)^2;
       3. debit intake = debit keluar kolam + koreksi volume menuju TMA kolam
          sasaran.

     Dengan itu kelebihan air di salah satu tampungan selalu menghasilkan umpan
     balik negatif. Pada Normal/Banjir titik setimbang kolam kembali sekitar
     1,36 m dan sekunder 1,00 m; saat Kemarau kolam boleh turun ke tinggi yang
     kompatibel dengan kebutuhan tanam yang lebih kecil, tanpa membuat sekunder
     meluap. Slider target kolam tetap menjadi batas operasi atas. */
  const tauSek = 900;
  const tauKolam = 900;
  const qKeluarSekKini = qTertTotalAt(sec.canal.h);
  const qKoreksiSek = (sec.targetLevel - sec.canal.h) * luasSec / tauSek;
  const kapSekunder = (N[dummySekunderId()] || {}).kapasitas || Infinity;
  const qTargetKeSek = clamp(qKeluarSekKini + qKoreksiSek, 0, kapSekunder);
  const hKolamKompatibel = sec.canal.h + Math.pow(qTargetKeSek / Math.max(Csek, 1e-6), 2);
  const hTargetKolam = clamp(hKolamKompatibel, 0.05,
    Math.min(state.targetPoolLevel, state.pool.Hmax));
  const qKoreksiKolam = (hTargetKolam - state.pool.h) * luasKolam / tauKolam;
  const qTargetIntake = clamp(state.Qscour + state.QkeSek + qKoreksiKolam, 0, kapKolam);
  const CintakeTotal = Cintake.reduce((a, b) => a + b, 0);
  state.aIntakePerlu = clamp(
    qTargetIntake / Math.max(CintakeTotal * Math.sqrt(Math.max(state.hUp - state.pool.h, 0.01)), 1e-6),
    0, m(D.pintu.bukaanMaksCm));


  D.rantai.forEach((r, i) => {
    const t = N[r.tersier], tert = state.tertiary[i];
    tert.gate.aMax = m(D.pintu.bukaanMaksCm);
    tert.canal.h = clamp(tert.canal.S / luasTert[i], 0.02, tert.canal.Hmax * 1.05);
    /* Qtert = yang lewat pintu tersier (masuk saluran); Qfield = yang lewat
       ambang ke petak (keluar saluran). Dulu keduanya angka yang sama, jadi
       saluran tersier tidak punya selisih masuk-keluar dan tidak bisa terisi
       atau terkuras. */
    state.Qtert[i] = qTertAt(i, sec.canal.h);
    state.Qfield[i] = qFieldAt(i, tert.canal.h);

    state.areas[i] = { name: r.namaTersier, ha: t.luas };
    /* Arus memakai debit MASUK, sama seperti kolam & saluran sekunder. */
    state.vTert[i] = state.Qtert[i] / (tert.canal.B * Math.max(tert.canal.h, 0.05));

    /* Pintu tersier menyeimbangkan salurannya pada TMA yang menghasilkan debit
       kebutuhan sawah. Debit masuk sasaran juga memuat koreksi volume, sehingga
       pintu mengisi/menguras saluran sampai aliran ke petak stabil. */
    const req = (state.duty * t.luas) / 1000;
    const hTargetTert = req > 0
      ? clamp(Math.pow(req / Math.max(Cfield[i], 1e-6), 2 / 3), 0.02, tert.canal.Hmax)
      : 0.02;
    const qTargetTert = clamp(
      state.Qfield[i] + (hTargetTert - tert.canal.h) * luasTert[i] / 900,
      0, (N['PG_TERSIER_' + (i + 1)] || {}).kapasitas || Infinity);
    state.aTersierPerlu = state.aTersierPerlu || [0, 0, 0];
    state.aTersierPerlu[i] = clamp(
      qTargetTert / Math.max(Ctert[i] * Math.sqrt(Math.max(sec.canal.h, 0.02)), 1e-6),
      0, tert.gate.aMax);
  });

  state.totalDemand = state.areas.reduce((a, x) => a + (state.duty * x.ha) / 1000, 0);
  state.totalDelivered = state.Qfield.reduce((a, q) => a + q, 0);
  /* Yang sampai hilir: tiga jalan keluar bendung yang memang menuju sungai —
     pintu floodway, limpasan mercu, dan pintu scouring yang membilas kolam.
     Yang lewat pintu intake TIDAK ikut: ia masuk jaringan irigasi.

     Rumus lama menambahkan `max(0, QgateTotal − totalDelivered)` sebagai
     pengganti suku scouring, yaitu sisa pasokan yang tidak sampai petak. Itu
     tebakan yang perlu selama scouring dianggap pemasok jaringan; sekarang
     debitnya dihitung langsung, jadi tebakannya tidak diperlukan lagi. */
  state.Qhilir = state.Qflood + state.Qspill + state.Qscour + (state.Qluap || 0);
  /* Kedalaman & arus ruas hilir dihitung SEKALI di sini, bukan di updateSchematic
     seperti dulu. Peta isometrik memerlukan angka yang sama untuk laju animasi
     pin "hilir"; selama ini ia memakai state.vPool — arus KOLAM — sehingga ruas
     sungai di bawah bendung beranimasi mengikuti kantong lumpur, bukan mengikuti
     104 m³/dtk yang benar-benar lewat di depannya saat banjir. */
  state.hHilir = manningInvertH(state.Qhilir, state.river.B, FIXED.nRiver,
                                FIXED.S0River, state.river.Hmax * 1.05);
  state.vHilir = state.hHilir > 0.01
    ? state.Qhilir / (state.river.B * state.hHilir) : 0;
  /* Tampungan hulu, kolam, saluran sekunder & ketiga tersier semuanya sudah
     dijaga lingkar neraca di atas — TIDAK ditulis ulang di sini. Menuliskannya
     ulang dari h × luas akan membatalkan integrasinya, dan muka air saluran
     kembali tidak bisa terbendung. */
  /* Laju perubahan tampungan, dipakai baris dS/dt panel Neraca Air. Dulu selalu
     nol karena tidak ada tampungan mana pun yang bergerak pada mode data dummy.
     Sekarang seluruh rantai punya tampungan sungguhan, dan mengabaikannya
     membuat neraca terbaca timpang justru ketika ia paling benar: menutup
     seluruh pintu berarti air tertahan — bukan hilang. */
  state._dStotalDt = dStotalDt;
  dummyStatusStep();
}

/* Posisi awal pintu & target kendali (hanya sekali; setelah itu milik operator). */
function initDummyGates() {
  const D = window.WMS_DUMMY;
  if (!D) return;
  const m = (cm) => cm / 100;
  const aMax = m(D.pintu.bukaanMaksCm), a0 = m(D.pintu.bukaanMaksCm * D.pintu.bukaanPersen / 100);
  /* Pintu primer dipasang di BUKAAN OPERASI ACUAN keadaan yang sedang dipilih,
     bukan di bukaan acuan dummy 75% untuk semuanya.

     Koefisien pintu dikalibrasi terhadap bukaan acuan itu (lihat
     dummyBukaanAcuan), jadi memasang pintu di tempat lain membuat tampilan
     pertama meleset dari snapshot sebelum kendali AUTO sempat bergerak. Pada
     keadaan kemarau bukaan acuan floodway 0,21 m; dipasang di 0,75 m ia
     melewatkan 3,6x jatahnya, dan debit hilir terbaca 16,34 m³/dtk sementara
     sungai cuma membawa 4,79.

     Pintu scouring tetap di bukaan acuan dummy: jatah pembilasnya memang
     tertulis pada bukaan itu di tiap keadaan. */
  const Nref = dummyScenarioNodes() || D.nodes;
  const R0 = dummyBukaanAcuan(Nref);
  state.primary.forEach(p => {
    /* Pintu pengambilan dipasang di bukaan acuan: di situlah koefisien
       pengisian kolam dikalibrasi, jadi tampilan pertama sama persis dengan
       snapshot sebelum kendalinya mulai bergerak. */
    const a = clamp(p.role === 'floodway' ? R0.aFlood : R0.aScour, 0, aMax);
    p.aMax = aMax; p.manualA = a; p.ctrl.a = a; p.mode = 'auto';
  });
  /* Tampungan hulu dipatok ulang ke keadaan acuan: applyDummySnapshot()
     berikutnya mengisinya dari muka air snapshot, bukan meneruskan muka air
     yang tertinggal dari pemutaran sebelumnya. */
  state.hulu = { S: 0, hMercu: 0, bMercu: 0, siap: false };
  state.targetPoolLevel = m(D.nodes.WEIR_COPONG.tmaHilir);
  /* TMA rencana di HULU bendung. Diambil dari `D.nodes`, muatan dummy DASAR - bukan
     dari `N`, potret skenario yang sedang berjalan (lihat dummyApply). Itu bedanya
     dengan `state.hUp` di baris 1189, yang membaca kolom yang sama tetapi dari potret
     skenario, jadi ikut naik saat banjir dan turun saat kemarau.

     Sungai hulu memang tidak punya "setelan" seperti kolam - tidak ada kendali yang
     mengejarnya. Yang diwakili garis ini tinggi muka air rancangan di hulu bendung:
     patokan untuk membaca seberapa jauh keadaan sekarang menyimpang darinya. */
  state.targetHuluLevel = m(D.nodes.WEIR_COPONG.tmaHulu);
  const preset = (g) => { g.aMax = aMax; g.manualA = a0; g.ctrl.a = a0; g.mode = 'auto'; };
  state.secondary.gates.forEach(preset);
  state.tertiary.forEach(t => preset(t.gate));
  const secNode = D.nodes[dummySekunderId()];
  if (secNode) state.secondary.targetLevel = m(secNode.tmaHulu);
}

/* Pintu mode AUTO bergerak menuju sasarannya; MANUAL mengikuti slider operator.

   DUA LAPIS yang berbeda sifatnya, dan itu disengaja:

     · PINTU PRIMER (floodway & scouring) mengikuti TABEL aturan operasi per
       keadaan hulu — OPERASI_PRIMER. Ia tidak mengejar besaran ukur apa pun; ia
       menempati posisi yang sudah ditetapkan untuk keadaan itu. Tugasnya
       mengatur air di SUNGAI: menahan saat kurang, melewatkan saat berlebih.

     · PINTU PENGAMBILAN & TERSIER tetap KENDALI UMPAN BALIK, masing-masing
       mengejar debit yang dibutuhkan salurannya sendiri:
         intake i   → debit yang lewat pintunya (Qsec[i])  vs kebutuhan rantainya
         tersier i  → debit yang sampai petaknya (Qfield[i]) vs kebutuhan petaknya
       Tugasnya menjaga aliran ke sawah tetap pada angka kebutuhan, berapa pun
       yang sedang terjadi di sungai. Jadi ketika aturan primer menaikkan muka
       air kolam (kemarau, seluruh pintu tertutup), pintu pengambilan MENUTUP
       supaya sawah tidak kebanjiran; ketika kolam turun (banjir, penguras dibuka
       penuh), ia MEMBUKA supaya sawah tidak kekurangan.

   Kalau pasokan memang tidak cukup, pintu tersier berhenti di bukaan maksimum
   dan dicatat di log, bukan diam-diam menyerah. */
let dummyGateSatLog = -99999;
function dummyGateStep() {
  const step = (g, delta, lim) => {
    if (g.mode === 'manual') { g.ctrl.a = clamp(g.manualA, 0, g.aMax); return; }
    g.ctrl.a = clamp(g.ctrl.a + clamp(delta, -lim, lim), 0, g.aMax);
  };

  /* ---- ATURAN OPERASI PINTU PRIMER ----

     Mode AUTO pintu primer sekarang membaca TABEL aturan per keadaan hulu
     (OPERASI_PRIMER), bukan model balik hidrolika seperti sebelumnya. Ini pola
     operasi bendung gerak yang lazim, dan operator memintanya begitu:

       kemarau  floodway TUTUP  · scouring TUTUP   → tahan air, muka air hulu naik
       normal   floodway KERJA  · scouring TUTUP   → lewatkan debit, hemat bilasan
       banjir   floodway PENUH  · scouring PENUH   → lewatkan banjir sebesar mungkin

     Yang dilepas bersamanya: model balik `a = aPintu × (Qlimpas/Qlimpas_normal) ×
     √(h_normal/h)` beserta koreksi muka air hulunya. Keduanya menjaga muka air
     hulu tetap di muka air snapshot — justru yang TIDAK diinginkan aturan ini:
     pada kemarau bendung memang harus membendung, dan muka air hulu memang harus
     naik jauh di atas angka snapshot.

     Akibatnya snapshot bukan lagi keadaan mapan, melainkan keadaan AWAL:
     initDummyGates() memasang pintu di bukaan acuan (di situ angka tampilan sama
     persis dengan snapshot), lalu aturan ini menggerakkannya ke posisi operasi
     dan seluruh angka berpindah ke keadaan mapan yang baru. Pada kemarau muka
     air hulu naik 0,49 → ±2,06 m dan debit hilir jatuh ke nol sampai limpasan
     mercu mengambil alih; pada normal & banjir pergeserannya kecil.

     dummyBukaanAcuan() TETAP dipakai — tapi hanya untuk mengkalibrasi koefisien
     pintu di applyDummySnapshot() dan memasang posisi awal. Ia tidak boleh
     memakai bukaan aturan: pada kemarau bukaannya nol, dan nol tidak bisa jadi
     penyebut kalibrasi.

     Gerakannya memakai pembatas laju penuh (`aTarget − a`, dijepit ±lim per
     langkah), bukan penguatan 0,35 seperti dulu. Terhadap sasaran TETAP,
     penguatan pecahan membuat pintu merayap makin lambat dan tidak pernah
     benar-benar sampai; dengan pembatas laju ia bergerak rata lalu berhenti
     TEPAT di sasarannya. */
  const flood = state.primary.filter(p => p.role === 'floodway');
  const aFloodTarget = bukaanOperasi('floodway');
  flood.forEach(p => step(p, clamp(aFloodTarget, 0, p.aMax) - p.ctrl.a, 0.04));

  /* Pintu scouring mengikuti tabel yang sama. Ia menguras kolam untuk membilas
     endapan, jadi menutupnya pada keadaan normal & kemarau berarti air kolam
     disimpan untuk irigasi alih-alih dibuang ke hilir — dan pada banjir dibuka
     penuh, saat air memang berlebih dan endapan paling banyak terbawa.

     Lajunya 0,03 m per langkah, lebih lambat dari floodway 0,04: pintu penguras
     lebih kecil dan tidak perlu bergerak secepat pintu banjir. */
  const scour = state.primary.find(p => p.role === 'scouring');
  if (scour) step(scour, clamp(bukaanOperasi('scouring'), 0, scour.aMax) - scour.ctrl.a, 0.03);


  /* ---- PINTU PENGAMBILAN & TERSIER: menjaga aliran ke sawah ----

     Keduanya memakai MODEL BALIK, bukan penguatan terhadap galat debit seperti
     sebelumnya. Alasannya kestabilan.

     Rumus lama `(req − Q)/req × penguatan` menghasilkan galat relatif yang bisa
     sangat besar: saat operator berpindah ke keadaan banjir, saluran sekunder
     menerima 1,332 m³/dtk terhadap kebutuhan 0,360 — galat relatifnya −2,7,
     jadi langkahnya mentok pembatas laju ±0,015 m dan pintu berlari pada laju
     maksimum sepanjang perjalanan 0,75 → 0,20 m. Pintu yang berlari penuh
     melewati titik setimbangnya sebelum galatnya sempat berbalik: pemenuhan
     sawah menukik dari 370% ke 77% (status "Kurang") sebelum akhirnya pulih ke
     100% — kartu petak berkedip merah padahal air justru berlimpah.

     Model baliknya sama seperti yang dulu dipakai pintu primer. Debit lewat
     bawah daun sebanding a√h, jadi bukaan yang melewatkan kebutuhan rantai:

       intake i  : a = aPintu × (req_i / q_intake_acuan_i) × √(h_kolam_acuan / h_kolam)
       tersier i : a = aPintu × (req_i / q_tersier_acuan_i) / f_sekunder

     Pada bukaan acuan hasilnya aPintu persis, jadi keadaan normal tidak
     bergeser. Pintu lalu bergerak ke sana dengan pembatas laju yang sama —
     rata, tanpa melampaui, dan berhenti tepat di sasarannya.

     √(h_acuan/h) itulah yang membuat pintu menanggapi aturan primer: saat
     kemarau menutup seluruh pintu dan muka air kolam naik 0,47 → 2,03 m, tinggi
     tekannya melonjak dan bukaan yang dibutuhkan MENGECIL — pintu menutup
     sendiri supaya sawah tidak kelebihan air. */
  const sec = state.secondary;
  /* PINTU INTAKE — sasarannya MUKA AIR KANTONG LUMPUR, bukan debit petak.

     Pintu ini berdiri di mulut kolam, jadi dialah satu-satunya yang menentukan
     berapa banyak air masuk. Menutupnya menurunkan muka air kolam, membukanya
     menaikkan — umpan balik negatif, dan sasarannya bisa dikejar.

     Debit ke petak TIDAK diurus di sini melainkan oleh pintu tersier di
     hilirnya. Susunan bertingkat itu yang membuat keduanya bisa dipenuhi
     sekaligus: kolam yang stabil di tinggi operasi memberi pasokan yang stabil
     ke saluran induk, lalu pintu tersier membagi-baginya menurut kebutuhan tiap
     petak. Selama intake juga memikul sasaran debit petak, keduanya bertabrakan
     dan salah satu selalu meleset.

     Bukaan yang diminta dihitung applyDummySnapshot() dari model baliknya
     (state.aIntakePerlu). */
  sec.gates.forEach((gt) => {
    const aPerlu = state.aIntakePerlu != null
      ? clamp(state.aIntakePerlu, 0, gt.aMax) : gt.aMax;
    step(gt, aPerlu - gt.ctrl.a, 0.015);
  });

  let kurang = false, mentok = false;
  for (let i = 0; i < 3; i++) {
    const req = (state.duty * state.areas[i].ha) / 1000;
    const g = state.tertiary[i].gate;
    const aPerluT = state.aTersierPerlu && state.aTersierPerlu[i] != null
      ? clamp(state.aTersierPerlu[i], 0, g.aMax) : g.aMax;
    step(g, aPerluT - g.ctrl.a, 0.03);
    if (g.mode === 'auto' && state.Qfield[i] < req * 0.85) {
      kurang = true;
      if (g.ctrl.a >= g.aMax - 0.005) mentok = true;
    }
  }

  if (mentok && kurang && state.simTime - dummyGateSatLog > 900) {
    pushLog('Pintu tersier sudah bukaan maksimum tetapi debit petak masih di bawah kebutuhan — pasokan hulu terbatas.', 'warn');
    dummyGateSatLog = state.simTime;
  }
}

/* Menjalankan kendali AUTO beberapa detik tanpa memajukan waktu rekaman.
   Dipakai setelah operator menukar keadaan hulu: pintu terlihat menutup /
   membuka mengejar Ideal walau pemutaran sedang dijeda. */
let dummySettle = null;
function dummyAutoSettle(detik) {
  if (dummySettle) { clearInterval(dummySettle); dummySettle = null; }
  let sisa = Math.round((detik || 6) * 1000 / 80);
  dummySettle = setInterval(() => {
    dummyGateStep();
    /* 120 detik hidraulik per bingkai: waktu rekaman tetap tidak maju, tetapi
       tampungan besar (terutama kantong lumpur) diberi cukup waktu untuk benar-
       benar mencapai titik stabil selama animasi kendali dua belas detik. */
    applyDummySnapshot(dummyMinute, 120);
    render();
    if (--sisa <= 0) { clearInterval(dummySettle); dummySettle = null; }
  }, 80);
}

/* Status siaga pada mode data dummy.
   Dulu status hanya dihitung di dalam stepSimulation(), yang tidak pernah
   dijalankan saat NO_DATA — akibatnya lencana di bilah atas terkunci di NORMAL
   walau TMA hulu sudah 96% tinggi tanggul waktu jendela banjir diputar.
   Ambangnya sama dengan yang dipakai simulasi: waspada 60%, siaga 80%,
   awas 95% dari tinggi tanggul, diambil dari ruas yang paling kritis.

   DUA UKURAN, bukan satu. Tinggi tanggul saja tidak cukup: pada keadaan banjir
   sungai membawa 104 m³/dtk terhadap kapasitas bendung 35 (298%), hulu sudah
   masuk kelas aliran "genangan", tetapi rasio TMA-nya cuma 52% — di bawah ambang
   waspada 60%, jadi lencananya tetap NORMAL. Tanggul 6 m memang jauh lebih tinggi
   daripada muka air yang dicapai skenario mana pun, sehingga ukuran itu sendirian
   tidak pernah berbunyi.

   Ambang debit dimulai di 100% kapasitas, bukan 60% seperti ambang TMA, karena
   debit rancangan sudah 28,17 dari kapasitas 35 = 80%: memakai 60% membuat
   keadaan NORMAL langsung berstatus waspada. Tingkatnya: 100% waspada, 135%
   siaga, 200% awas — 100% & 135% sengaja sama dengan ambang kelas aliran
   "deras" & "genangan" di FLOW_AMBANG, jadi warna air dan lencana status tidak
   bercerita beda. Status akhir = yang paling berat di antara kedua ukuran. */
let dummyStatusTerakhir = 'NORMAL';
const STATUS_URUT = ['NORMAL', 'WASPADA', 'SIAGA', 'AWAS'];
function dummyStatusStep() {
  const hMax = state.river.Hmax || 1;
  /* Tiap ruas dibandingkan dengan tanggulnya SENDIRI: hulu dengan tanggul sungai,
     kolam dengan tanggul kolam. Lihat POOL_HMAX. */
  const rTma = Math.max(state.hUp / hMax, state.pool.h / (state.pool.Hmax || hMax));
  const stTma = rTma >= 0.95 ? 'AWAS' : rTma >= 0.80 ? 'SIAGA' : rTma >= 0.60 ? 'WASPADA' : 'NORMAL';

  const kapSungai = ((state.dummyNodes || {}).WEIR_COPONG || {}).kapasitas || 0;
  const rQ = kapSungai > 0 ? state.Qnat / kapSungai : 0;
  const stQ = rQ >= 2.00 ? 'AWAS' : rQ >= 1.35 ? 'SIAGA' : rQ >= 1.00 ? 'WASPADA' : 'NORMAL';

  const status = STATUS_URUT[Math.max(STATUS_URUT.indexOf(stTma), STATUS_URUT.indexOf(stQ))];
  state.status = status;
  if (status !== dummyStatusTerakhir) {
    const lvl = status === 'AWAS' ? 'danger' : (status === 'SIAGA' || status === 'WASPADA') ? 'warn' : 'ok';
    /* Kedua ukuran ikut dicatat: tanpa itu operator tidak tahu lencananya
       berbunyi karena muka air atau karena debit. */
    pushLog(`Status sistem berubah: ${dummyStatusTerakhir} → ${status} `
      + `(TMA maks ${(rTma * 100).toFixed(0)}% tanggul, debit hulu ${(rQ * 100).toFixed(0)}% kapasitas bendung).`, lvl);
    dummyStatusTerakhir = status;
  }
}

/* Hitung ulang seluruh panel dari posisi pintu saat ini (dipakai saat dijeda).

   `dt` 30 detik rekaman per panggilan: operator yang menggeser slider bukaan
   saat pemutaran dijeda harus melihat muka air hulu menanggapinya, bukan diam
   sampai tombol Jalankan ditekan. Satu geseran slider memicu banyak kejadian
   `input`, jadi menutup pintu sampai habis sudah cukup untuk memperlihatkan
   hulu mulai naik dan hilir mulai turun. */
function dummyRefresh() {
  dummyGateStep();
  applyDummySnapshot(dummyMinute, 30);
  render();
}

/* Grafik tren memakai historis 60 menit dari seeder: TMA · (1 + 0,20·sin(menit·12°)). */
function seedDummyCharts() {
  const D = window.WMS_DUMMY;
  if (!D || !chartLevelMain) return;
  const H = (D.histori || {}).nodes || {};
  const span = dummySpan();
  const rantai = D.rantai || [];

  /* Grafik memakai rekaman sensor sungguhan sepanjang tiga jam terakhir —
     kemarau, banjir, lalu normal. Dulu isinya dikarang dari nilai saat ini
     dikali sinus, jadi bentuknya selalu sama berapa pun keadaan hulunya. */
  const labels = [];
  for (let i = 0; i <= span; i++) labels.push(fmtClock(i * 60));

  const cm = (id, kolom) => {
    const d = (H[id] || {})[kolom || 'tma'];
    return d ? labels.map((_, i) => +(d[i] / 100).toFixed(2)) : null;
  };
  const q = (id) => {
    const d = (H[id] || {}).debit;
    return d ? labels.map((_, i) => +(+d[i]).toFixed(3)) : null;
  };
  const datar = (nilai, desimal) => labels.map(() => +nilai.toFixed(desimal));
  const jumlah = (deret) => deret[0] ? labels.map((_, i) => +deret.reduce((a, d) => a + (d ? d[i] : 0), 0).toFixed(3)) : null;

  const fill = (chart, series) => {
    chart.data.labels = labels.slice();
    series.forEach((data, k) => { if (data) chart.data.datasets[k].data = data; });
    chart.update('none');
  };

  const tersierIds = rantai.map(r => r.tersier);
  fill(chartLevelMain, [
    cm('AWLR_HULU') || datar(state.hUp, 2),
    cm('AWLR_KOLAM', 'tmaHilir') || datar(state.pool.h, 2),
  ]);
  fill(chartLevelSub, [
    cm(dummySekunderId()) || datar(state.secondary.canal.h, 2),
    ...tersierIds.map((id, i) => cm(id) || datar(state.tertiary[i].canal.h, 2)),
  ]);
  fill(chartDebitMain, [
    q(dummyIndukId()) || datar(state.QgateTotal, 2),
    jumlah(tersierIds.map(q)) || datar(state.totalDelivered, 3),
    q('AWLR_HILIR') || datar(state.Qhilir, 2),
  ]);
  fill(chartDebitField, tersierIds.map((id, i) => q(id) || datar(state.Qfield[i], 3)));

  /* Arus tidak ada di rekaman sensor — ia besaran turunan, jadi dihitung ulang per
     menit dengan RUMUS YANG SAMA yang dipakai applyDummySnapshot(). Kalau dihitung
     dengan cara lain, garis histori dan nilai berjalan akan bertemu di titik yang
     berbeda tepat pada menit terakhir, dan sambungannya terlihat melompat.
     SEMUA ruas kini memakai rumus yang sama: Q / (lebar × TMA), dengan TMA
     berbatas bawah 0,05 m. Manning dilepas dari sini bersamaan dengan
     dilepasnya dari state.vUp & state.vPool — ruas hulu dan kolam bendung
     keduanya genangan di belakang bendung, bukan aliran seragam yang menuruni
     kemiringan, dan Manning memberi arah terbalik untuk keduanya (makin tinggi
     muka air karena dibendung, makin cepat menurut Manning). Alasan lengkapnya
     di state.vUp pada applyDummySnapshot().

     Kolomnya bisa dipilih karena TMA kolam tersimpan di kolom tmaHilir simpul
     AWLR_KOLAM, bukan di tma. */
  const arusRuas = (id, B, kolom) => {
    const dh = (H[id] || {})[kolom || 'tma'], dq = (H[id] || {}).debit;
    if (!dh || !dq) return null;
    return labels.map((_, i) => +(+dq[i] / (B * Math.max(dh[i] / 100, 0.05))).toFixed(3));
  };
  const arusSaluran = (id, B) => arusRuas(id, B, 'tma');
  fill(chartArusMain, [
    arusRuas('AWLR_HULU', state.river.B, 'tma') || datar(state.vUp, 3),
    arusRuas('AWLR_KOLAM', state.river.B, 'tmaHilir') || datar(state.vPool, 3),
  ]);
  fill(chartArusSub, [
    arusSaluran(dummySekunderId(), state.secondary.canal.B) || datar(state.vSec, 3),
    ...tersierIds.map((id, i) => arusSaluran(id, state.tertiary[i].canal.B) || datar(state.vTert[i], 3)),
  ]);
}

function render() {
  refreshCtrlLive();
  updateSchematic();

  // status pill
  const pill = el('statusPill'), statusText = el('statusText');
  statusText.textContent = state.status;
  pill.className = 'status-pill ' + (state.status === 'AWAS' ? 'danger' : state.status === 'SIAGA' ? 'siaga' : state.status === 'WASPADA' ? 'warn' : '');
  el('simClock').textContent = fmtClock(state.simTime);

  // summary
  el('sumQnat').textContent = state.Qnat.toFixed(1);
  el('sumQgate').textContent = state.QgateTotal.toFixed(1);
  el('sumQirigasi').textContent = state.totalDelivered.toFixed(2);
  el('sumQhilir').textContent = state.Qhilir.toFixed(1);
  const effs = state.areas.map((a, i) => {
    const req = (state.duty * a.ha) / 1000;
    return req > 0 ? clamp((state.Qfield[i] / req) * 100, 0, 999) : 100;
  });
  const avgEff = effs.reduce((a, b) => a + b, 0) / effs.length;
  el('sumEfisiensi').textContent = avgEff.toFixed(0);

  updateWeatherChip();
  updateTsChips();
  updateSawahCards();
  updateGateStatus();
  updateIsoLabels();
  updateIsoWaterColors();
  updateIsoLeaves();
  updatePetakWarna();
  updatePetakLabels();
  updatePetakTip();
  renderPosPop();
  updateFormulaTab();
  updateCharts();
}

function updateWeatherChip() {
  const icon = el('wIcon'), temp = el('wTemp'), desc = el('wDesc'), scen = el('wScen');
  if (!icon) return;
  if (NO_DATA) {
    /* Angka di bawah ini dibangkitkan dari skenario, bukan bacaan alat —
       skenario tetap ditulis di baris kedua supaya tidak dikira data lapangan.
       Lihat DUMMY_CUACA. */
    const S = dummyScenario(), C = dummyCuaca();
    icon.textContent = S.icon;
    temp.textContent = C.suhu.toFixed(0);
    desc.textContent = `${C.desc} · Angin ${C.angin.toFixed(1)} km/h · RH ${C.lembap.toFixed(0)}%`;
    if (scen) scen.textContent = 'Skenario hulu: ' + S.label;
    const chip = el('weatherChip');
    if (chip) chip.title = `Cuaca dummy mengikuti skenario hulu "${S.label}" — belum ada sensor cuaca terpasang.`;
    return;
  }
  if (scen) scen.textContent = '';
  if (state.scenario === 'flood') { icon.textContent = '🌧️'; temp.textContent = '24'; desc.textContent = 'Hujan Lebat · Angin 22 km/h'; }
  else if (state.scenario === 'drought') { icon.textContent = '☀️'; temp.textContent = '33'; desc.textContent = 'Cerah Terik · Angin 3.2 km/h'; }
  else { icon.textContent = '⛅'; temp.textContent = '28'; desc.textContent = 'Cerah Berawan · Angin 5.9 km/h'; }
}

function updateSawahCards() {
  for (let i = 0; i < 3; i++) {
    const req = (state.duty * state.areas[i].ha) / 1000;
    const st = irrigationStatus(state.Qfield[i], req);
    const card = el('sawahCard' + i);
    if (!card) continue;
    el('scName' + i).textContent = state.areas[i].name;
    el('scHa' + i).textContent = state.areas[i].ha + ' ha';
    el('scReq' + i).textContent = req.toFixed(3);
    el('scAct' + i).textContent = state.Qfield[i].toFixed(3);
    const badge = el('scBadge' + i);
    badge.textContent = st.label;
    badge.className = 'status-badge ' + st.cls;
    el('scBar' + i).style.width = clamp((st.r || 0) * 100, 0, 100) + '%';
    el('scPct' + i).textContent = ((st.r || 0) * 100).toFixed(0) + '%';
  }
}

/* =========================================================================
   BUILD: kartu sawah (dashboard)
   ========================================================================= */
function buildSawahCards() {
  const wrap = el('sawahCards');
  wrap.innerHTML = '';
  state.areas.forEach((a, i) => {
    const card = document.createElement('div');
    card.className = 'sawah-card';
    card.id = 'sawahCard' + i;
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong style="font-family:var(--font-display);font-size:13px;" id="scName${i}">${a.name}</strong>
        <span style="font-family:var(--font-mono);font-size:11px;color:var(--text-2);" id="scHa${i}">${a.ha} ha</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--text-2);margin-bottom:5px;">
        <span>Kebutuhan: <b id="scReq${i}" style="color:var(--text-1);">-</b> m³/dtk</span>
        <span>Aktual: <b id="scAct${i}" style="color:var(--text-1);">-</b> m³/dtk</span>
      </div>
      <div style="height:6px;border-radius:0;background:var(--bg-input);overflow:hidden;margin-bottom:8px;">
        <div id="scBar${i}" style="height:100%;width:0%;background:linear-gradient(90deg,var(--teal-dim),var(--teal));transition:width .3s;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span class="status-badge ideal" id="scBadge${i}">-</span>
        <span style="font-size:18px;font-weight:700;color:var(--teal-dim);" id="scPct${i}">-</span>
      </div>`;
    wrap.appendChild(card);
  });
}

/* =========================================================================
   BUILD: kartu status pintu (Beranda) — tampil saja, kendali ada di tab sendiri
   ========================================================================= */
function buildGateStatus() {
  const wrap = el('gateStatusBody');
  if (!wrap) return;
  wrap.innerHTML = '';
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 1fr))';
  wrap.style.gap = '12px';
  for (let k = 0; k < state.primary.length; k++) {
    const pg = state.primary[k];
    const card = document.createElement('div');
    card.className = 'ctrl-card';
    card.innerHTML = `
      <h3>${pg.name} <span class="status-badge lebih" id="dsMode${k}">AUTO</span></h3>
      <div style="text-align:center;margin:-4px 0 10px;"><span class="maks-badge">Maks Bukaan : ${(pg.aMax * 100).toFixed(0)} cm</span></div>
      <div class="elev-card">
        <div class="cap">Elevasi Pintu</div>
${gateElevSvg(`dsElev${k}`)}
      </div>
      <div class="lamp-row">
        <div class="lamp"><div class="plate">R</div><div class="bulb"><span style="background:#d92d20;">ON</span></div></div>
        <div class="lamp"><div class="plate">S</div><div class="bulb"><span style="background:#f0a020;">ON</span></div></div>
        <div class="lamp"><div class="plate">T</div><div class="bulb"><span style="background:#17a34a;">ON</span></div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px;padding-top:11px;border-top:1px solid var(--line);">
        <div>
          <div style="font-size:12.5px;color:var(--teal);font-weight:600;">Bukaan aktual</div>
          <div style="font-size:19px;font-weight:700;" id="dsAct${k}">-</div>
        </div>
        <div>
          <div style="font-size:12.5px;color:var(--teal);font-weight:600;">Debit pintu</div>
          <div style="font-size:19px;font-weight:700;" id="dsQ${k}">-</div>
        </div>
      </div>`;
    wrap.appendChild(card);
  }
}

function updateGateStatus() {
  for (let k = 0; k < state.primary.length; k++) {
    const pg = state.primary[k];
    setGateElev('dsElev' + k, pg.ctrl.a, pg.aMax);
    const badge = el('dsMode' + k);
    if (badge) {
      badge.textContent = pg.mode.toUpperCase();
      badge.className = 'status-badge ' + (pg.mode === 'auto' ? 'lebih' : 'cukup');
    }
    const act = el('dsAct' + k);
    if (act) act.textContent = pg.ctrl.a.toFixed(2) + ' m';
    const q = el('dsQ' + k);
    if (q) q.textContent = ((state.Qprim || [])[k] ?? 0).toFixed(2) + ' m³/dtk';
  }
}

/* =========================================================================
   BUILD: tab Konfigurasi Sistem
   ========================================================================= */
function numField(labelHtml, id, value, step, min, max, unit) {
  return `<div class="field"><label>${labelHtml} <b>${value}${unit || ''}</b></label>
    <input type="number" id="${id}" value="${value}" step="${step}" min="${min}" max="${max}">
  </div>`;
}

/* Urutan TAMPIL kelas ruas: dari paling sedikit air ke paling banyak. Bukan
   LEVEL_URUT, yang mengurutkan menurut BERAT untuk keperluan reachStatus() dan
   karena itu menaruh "kering" di antara normal & waspada. */
const LEVEL_TAMPIL = ['kering', 'normal', 'waspada', 'siaga', 'bahaya'];

function buildConfigTab() {
  const wrap = el('configBody');

  /* Legenda kelas dibangun dari LEVEL_DOT & LEVEL_LABEL, bukan ditulis tangan.
     Versi lama menuliskan hex-nya sendiri di dalam paragraf — dan tiga dari lima
     sudah menyimpang dari warna yang benar-benar dipakai peta (Normal #2b6cb0
     lawan #1f4fa6, Waspada #b8901c lawan #c9971a, Siaga #c07520 lawan #d4761c).
     Untuk sebuah legenda itu cacat yang menyesatkan: orang mencocokkan warna di
     panel ini dengan warna di peta. */
  const legendaKelas = LEVEL_TAMPIL
    .map(k => `<b style="color:${LEVEL_DOT[k]};">${LEVEL_LABEL[k]}</b>`).join(' → ');

  /* Baris ambang debit diturunkan dari DEBIT_AMBANG, bukan diketik ulang, supaya
     keterangannya tidak bisa menyimpang dari ambang yang benar-benar dipakai. */
  const dbNaik = [...DEBIT_AMBANG].reverse();          /* normal → bahaya */
  const debitRows = [`<tr><td><b style="color:${LEVEL_DOT.kering};">${LEVEL_LABEL.kering}</b></td>`
    + `<td>&lt; ${(dbNaik[0][1] * 100).toFixed(0)}%</td></tr>`]
    .concat(dbNaik.map(([kelas, min], i) => {
      const lanjut = dbNaik[i + 1];
      const rentang = lanjut
        ? `${(min * 100).toFixed(0)}% – ${(lanjut[1] * 100).toFixed(0)}%`
        : `≥ ${(min * 100).toFixed(0)}%`;
      return `<tr><td><b style="color:${LEVEL_DOT[kelas]};">${LEVEL_LABEL[kelas]}</b></td><td>${rentang}</td></tr>`;
    })).join('');

  let html = `
    <div class="cfg-section-title"><span class="n">1</span> Geometri Sungai Utama (Hulu &amp; Kolam Bendung)</div>
    <div class="grid3">
      <div class="cfg-card"><h4>Penampang Sungai</h4>
        ${numField('Lebar sungai (B)', 'cfgRiverB', state.river.B, 1, 5, 100, ' m')}
        ${numField('Tinggi tanggul (Hmax)', 'cfgRiverHmax', state.river.Hmax, 0.5, 2, 15, ' m')}
        <div class="assumption-box">Luas penampang basah saat ini = B × TMA (dihitung otomatis tiap saat). Kekasaran Manning n=${FIXED.nRiver}, kemiringan dasar S₀=${FIXED.S0River} (asumsi tetap, sungai alami).</div>
      </div>
      <div class="cfg-card"><h4>Target Kolam Bendung</h4>
        ${numField('Target TMA kolam (mode Auto)', 'cfgTargetPool', state.targetPoolLevel, 0.1, 0.5, state.pool.Hmax, ' m')}
        <div class="assumption-box">Panjang kolam diasumsikan tetap ${FIXED.poolL} m.</div>
      </div>
      <div class="cfg-card"><h4>Kondisi Awal</h4>
        <p style="font-size:11.5px;color:var(--text-2);margin:0;">Perubahan geometri di atas tersimpan pada konfigurasi, tetapi angka pada tampilan tetap mengikuti data dummy statis. Gunakan tombol Reset di kanan atas bila ingin memulai ulang dari kondisi awal baru.</p>
      </div>
    </div>

    <div class="cfg-section-title"><span class="n">2</span> Pintu Primer — Bendung Gerak (3 Floodway + 1 Scouring)</div>
    <div id="cfgPrimaryGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;"></div>

    <div class="cfg-section-title"><span class="n">3</span> Saluran Sekunder &amp; 3 Pintu Pengambilan</div>
    <div class="grid3" id="cfgSecondaryGrid"></div>

    <div class="cfg-section-title"><span class="n">4</span> Pos Pintu Tersier (1 per petak sawah — saluran &amp; pintu)</div>
    <div class="grid3" id="cfgTertiaryGrid"></div>

    <div class="cfg-section-title"><span class="n">5</span> Kebutuhan Air Petak Sawah</div>
    <div class="grid3" id="cfgSawahGrid"></div>
    <div class="cfg-card" style="margin-top:12px;">
      <h4>Norma Kebutuhan Air (Duty)</h4>
      ${NO_DATA
        ? `<div class="field"><label>Kebutuhan air per hektar <b id="cfgDutyLive">${state.duty.toFixed(2)} l/dtk/ha</b></label></div>`
        : numField('Kebutuhan air per hektar', 'cfgDuty', state.duty, 0.1, 0.3, 3.0, ' l/dtk/ha')}
      <div class="assumption-box">Nilai 1.0 l/dtk/ha merupakan angka acuan umum untuk fase pertumbuhan padi pada praktik irigasi di Indonesia (kebutuhan riil bervariasi menurut fase tanam, jenis tanah, dan curah hujan efektif — pada fase penyiapan lahan angka ini bisa 1.5–2.0 l/dtk/ha). Selama data dummy dipakai, angka ini <b>mengikuti keadaan hulu</b> dan tidak diatur dari sini: normal &amp; hujan 1.00 l/dtk/ha (padi), kemarau 0.65 l/dtk/ha mengikuti rencana tata tanam palawija — lihat <span style="font-family:var(--font-mono);">SkemaIrigasiController::SKENARIO</span>.</div>
    </div>

    <div class="cfg-section-title"><span class="n">6</span> Ambang Batas Warna Status Ruas (Peta Isometrik)</div>
    <p style="font-size:12px;color:var(--text-2);margin:0 0 10px;">Warna air &amp; cincin pin di peta isometrik: ${legendaKelas}. Kelas tiap ruas dinilai dari <b>dua ukuran</b> — rasio TMA terhadap tinggi tanggul (h/Hmax) <b>dan</b> rasio debit terhadap kapasitas bangunannya — lalu yang paling berat yang dipakai. Satu ukuran tidak cukup: tanggul sungai 6 m jauh lebih tinggi daripada muka air keadaan mana pun, jadi rasio TMA sendirian tidak pernah bisa menyatakan banjir.</p>

    <h4 style="margin:0 0 6px;">a. Ambang TMA — bisa diatur</h4>
    <p style="font-size:12px;color:var(--text-2);margin:0 0 8px;">Nilai bawaan mengikuti kriteria siaga banjir yang umum dipakai (waspada 60%, siaga 80%, bahaya 95%), ditambah ambang kering untuk indikasi kekeringan: 15% pada sungai &amp; saluran sekunder, 8% pada saluran tersier yang muka airnya memang jauh lebih dangkal.</p>
    <table class="data-table" style="margin-bottom:14px;">
      <thead><tr><th>Titik</th><th>Kering &lt;</th><th>Waspada ≥</th><th>Siaga ≥</th><th>Bahaya ≥</th></tr></thead>
      <tbody id="thresholdTableBody"></tbody>
    </table>

    <h4 style="margin:0 0 6px;">b. Ambang debit — dipatok, tidak bisa diatur</h4>
    <p style="font-size:12px;color:var(--text-2);margin:0 0 8px;">Rasio debit ruas terhadap <b>kapasitas bangunannya</b> (kolom kapasitas pada tiap pos). Dipatok di kode dengan sengaja: angka 100% &amp; 135% dipakai bersama oleh tiga tempat — kelas aliran skematik, lencana status di bilah atas, dan kelas ruas di sini — jadi menyuntingnya dari satu panel akan membuat ketiganya menyimpang tanpa terlihat. Ambangnya pun diturunkan dari kapasitas bangunan yang sudah tercatat, bukan dari kebijakan operasi.</p>
    <table class="data-table" style="margin-bottom:10px;">
      <thead><tr><th>Kelas</th><th>Debit terhadap kapasitas</th></tr></thead>
      <tbody>${debitRows}</tbody>
    </table>
    <div class="assumption-box">Ambang peringatan mulai di <b>100%</b> kapasitas, bukan 60% seperti ambang TMA, karena debit rancangan sungai sudah 28,17 dari kapasitas 35 = <b>80%</b>: memakai 60% membuat keadaan normal langsung berstatus waspada.</div>
  `;
  wrap.innerHTML = html;

  const pg = el('cfgPrimaryGrid'), sg = el('cfgSecondaryGrid'), tg = el('cfgTertiaryGrid'), swg = el('cfgSawahGrid');
  for (let k = 0; k < state.primary.length; k++) {
    const card = document.createElement('div'); card.className = 'cfg-card';
    card.innerHTML = `<h4>${state.primary[k].name}</h4>
      ${numField('Lebar pintu (b)', 'cfgPb' + k, state.primary[k].b, 0.5, 1, 20, ' m')}
      ${numField('Tinggi pintu (bukaan maks.)', 'cfgPh' + k, state.primary[k].aMax, 0.1, 0.5, 6, ' m')}`;
    pg.appendChild(card);
  }
  {
    /* satu kartu untuk salurannya, lalu satu kartu per pintu pengambilan */
    const card = document.createElement('div'); card.className = 'cfg-card';
    card.innerHTML = `<h4>Saluran Sekunder</h4>
      ${numField('Lebar saluran', 'cfgSecB', state.secondary.canal.B, 0.5, 1, 20, ' m')}
      ${numField('Tinggi tanggul saluran', 'cfgSecHmax', state.secondary.canal.Hmax, 0.2, 0.5, 6, ' m')}
      <div class="assumption-box">Satu saluran sekunder disuplai tiga pintu pengambilan dari kolam bendung; panjang segmen diasumsikan tetap ${FIXED.secL} m.</div>`;
    sg.appendChild(card);
  }
  state.secondary.gates.forEach((gt, i) => {
    const card = document.createElement('div'); card.className = 'cfg-card';
    card.innerHTML = `<h4>${gt.name}</h4>
      ${numField('Lebar pintu', 'cfgSecGb' + i, gt.b, 0.1, 0.3, 6, ' m')}
      ${numField('Tinggi pintu (bukaan maks.)', 'cfgSecGh' + i, gt.aMax, 0.1, 0.2, 3, ' m')}`;
    sg.appendChild(card);
  });
  for (let i = 0; i < 3; i++) {
    const card = document.createElement('div'); card.className = 'cfg-card';
    card.innerHTML = `<h4>${state.tertiary[i].gate.name}</h4>
      ${numField('Lebar saluran', 'cfgTertB' + i, state.tertiary[i].canal.B, 0.2, 0.5, 10, ' m')}
      ${numField('Tinggi tanggul saluran', 'cfgTertHmax' + i, state.tertiary[i].canal.Hmax, 0.05, 0.1, 4, ' m')}
      ${numField('Lebar pintu', 'cfgTertGb' + i, state.tertiary[i].gate.b, 0.1, 0.2, 3, ' m')}
      ${numField('Tinggi pintu (bukaan maks.)', 'cfgTertGh' + i, state.tertiary[i].gate.aMax, 0.05, 0.1, 2, ' m')}`;
    tg.appendChild(card);
  }
  state.areas.forEach((a, i) => {
    const card = document.createElement('div'); card.className = 'cfg-card';
    card.innerHTML = `<h4>Sawah Blok ${i + 1}</h4>
      <div class="field"><label>Nama blok</label><input type="text" id="cfgAreaName${i}" value="${a.name}" style="width:100%;background:var(--bg-input);border:1px solid var(--line);border-radius:0;color:var(--text-1);font-family:var(--font-mono);font-size:12px;padding:6px 8px;"></div>
      ${numField('Luas area', 'cfgAreaHa' + i, a.ha, 5, 5, 2000, ' ha')}`;
    swg.appendChild(card);
  });

  // ---- tabel ambang batas warna TMA ----
  const thBody = el('thresholdTableBody');
  function threshInput(prefix, th) {
    return `<td><input type="number" id="th_${prefix}_kering" value="${(th.kering * 100).toFixed(0)}" min="0" max="100" step="1" style="width:64px;"></td>
      <td><input type="number" id="th_${prefix}_waspada" value="${(th.waspada * 100).toFixed(0)}" min="0" max="100" step="1" style="width:64px;"></td>
      <td><input type="number" id="th_${prefix}_siaga" value="${(th.siaga * 100).toFixed(0)}" min="0" max="100" step="1" style="width:64px;"></td>
      <td><input type="number" id="th_${prefix}_bahaya" value="${(th.bahaya * 100).toFixed(0)}" min="0" max="100" step="1" style="width:64px;"></td>`;
  }
  /* Baris `river` mengatur TIGA pos, bukan dua: pin & ruas hilir juga memakai
     thresholds.river sejak ia dipisahkan dari kolam (yang berbeda cuma debitnya,
     Qhilir lawan QgateTotal). */
  let thRows = `<tr><td>Sungai Utama (Hulu, Kolam &amp; Hilir)</td>${threshInput('river', state.thresholds.river)}</tr>`;
  thRows += `<tr><td>Saluran Sekunder</td>${threshInput('sec', state.thresholds.sec)}</tr>`;
  for (let i = 0; i < 3; i++) thRows += `<tr><td>${state.tertiary[i].gate.name}</td>${threshInput('tert' + i, state.thresholds.tert[i])}</tr>`;
  thBody.innerHTML = thRows;

  function wireThresh(prefix, thObj) {
    ['kering', 'waspada', 'siaga', 'bahaya'].forEach(key => {
      el(`th_${prefix}_${key}`).addEventListener('input', e => {
        thObj[key] = clamp((parseFloat(e.target.value) || 0) / 100, 0, 1);
      });
    });
  }
  wireThresh('river', state.thresholds.river);
  wireThresh('sec', state.thresholds.sec);
  for (let i = 0; i < 3; i++) wireThresh('tert' + i, state.thresholds.tert[i]);

  // ---- wire live updates ----
  el('cfgRiverB').addEventListener('input', e => state.river.B = clamp(parseFloat(e.target.value) || 1, 5, 100));
  el('cfgRiverHmax').addEventListener('input', e => state.river.Hmax = clamp(parseFloat(e.target.value) || 1, 2, 15));
  el('cfgTargetPool').addEventListener('input', e => state.targetPoolLevel = clamp(parseFloat(e.target.value) || 0.5, 0.5, state.pool.Hmax));
  /* Kotak duty hanya ada saat data nyata dipakai; pada mode dummy angkanya
     dibaca dari skenario (dummyDuty()) dan ditampilkan sebagai bacaan hidup. */
  const dutyInput = el('cfgDuty');
  if (dutyInput) dutyInput.addEventListener('input', e => state.duty = clamp(parseFloat(e.target.value) || 0.1, 0.1, 5));

  for (let k = 0; k < state.primary.length; k++) {
    el('cfgPb' + k).addEventListener('input', e => state.primary[k].b = clamp(parseFloat(e.target.value) || 0.5, 0.5, 30));
    el('cfgPh' + k).addEventListener('input', e => state.primary[k].aMax = clamp(parseFloat(e.target.value) || 0.5, 0.3, 8));
  }
  el('cfgSecB').addEventListener('input', e => state.secondary.canal.B = clamp(parseFloat(e.target.value) || 0.5, 0.5, 30));
  el('cfgSecHmax').addEventListener('input', e => state.secondary.canal.Hmax = clamp(parseFloat(e.target.value) || 0.3, 0.3, 8));
  state.secondary.gates.forEach((gt, i) => {
    el('cfgSecGb' + i).addEventListener('input', e => gt.b = clamp(parseFloat(e.target.value) || 0.2, 0.2, 8));
    el('cfgSecGh' + i).addEventListener('input', e => gt.aMax = clamp(parseFloat(e.target.value) || 0.2, 0.2, 4));
  });
  for (let i = 0; i < 3; i++) {
    el('cfgTertB' + i).addEventListener('input', e => state.tertiary[i].canal.B = clamp(parseFloat(e.target.value) || 0.3, 0.3, 15));
    el('cfgTertHmax' + i).addEventListener('input', e => state.tertiary[i].canal.Hmax = clamp(parseFloat(e.target.value) || 0.3, 0.1, 6));
    el('cfgTertGb' + i).addEventListener('input', e => state.tertiary[i].gate.b = clamp(parseFloat(e.target.value) || 0.1, 0.1, 5));
    el('cfgTertGh' + i).addEventListener('input', e => state.tertiary[i].gate.aMax = clamp(parseFloat(e.target.value) || 0.1, 0.1, 3));
    el('cfgAreaName' + i).addEventListener('input', e => { state.areas[i].name = e.target.value || ('Sawah Blok ' + (i + 1)); });
    el('cfgAreaHa' + i).addEventListener('input', e => state.areas[i].ha = clamp(parseFloat(e.target.value) || 1, 1, 5000));
  }
}

/* =========================================================================
   BUILD: tab Kontrol Pintu
   ========================================================================= */
function modeToggleHtml(role, current) {
  return `<span class="mode-toggle">
      <button data-role="${role}" data-val="auto" class="${current === 'auto' ? 'on' : ''}">Auto</button>
      <button data-role="${role}" data-val="manual" class="${current === 'manual' ? 'on' : ''}">Manual</button>
    </span>`;
}

function buildControlTab() {
  const wrap = el('controlBody');
  let html = `<div class="cfg-section-title"><span class="n">P</span> Pintu Primer — 3 Floodway + Scouring (keduanya ke hilir)</div>
    <div class="field" style="max-width:420px;">
      <label>Target TMA kolam (mode Auto) <b id="lblTargetPool">${state.targetPoolLevel.toFixed(2)} m</b></label>
      <input type="range" id="sliderTargetPool" min="0.5" max="${state.pool.Hmax}" step="0.05" value="${state.targetPoolLevel}">
    </div>
    <div class="grid3" id="ctrlPrimaryGrid"></div>
    <div class="cfg-section-title"><span class="n">S</span> Pintu Pengambilan — 3 unit menuju satu Saluran Sekunder</div>
    <div class="field" style="max-width:420px;">
      <label>Target TMA saluran sekunder (mode Auto) <b id="lblTargetSec">${state.secondary.targetLevel.toFixed(2)} m</b></label>
      <input type="range" id="sliderTargetSec" min="0.2" max="${state.secondary.canal.Hmax}" step="0.05" value="${state.secondary.targetLevel}">
    </div>
    <div class="grid3" id="ctrlSecondaryGrid"></div>
    <div class="cfg-section-title"><span class="n">T</span> Pintu Tersier (kendali debit ke sawah)</div>
    <div class="grid3" id="ctrlTertiaryGrid"></div>`;
  wrap.innerHTML = html;

  el('sliderTargetPool').addEventListener('input', e => {
    state.targetPoolLevel = parseFloat(e.target.value);
    el('lblTargetPool').textContent = state.targetPoolLevel.toFixed(2) + ' m';
  });

  const pg = el('ctrlPrimaryGrid');
  pg.style.display = 'grid';
  pg.style.gridTemplateColumns = 'repeat(auto-fit, minmax(320px, 1fr))';
  pg.style.gap = '12px';
  for (let k = 0; k < state.primary.length; k++) {
    const card = document.createElement('div'); card.className = 'ctrl-card'; card.id = 'ctrlCardP' + k;
    card.innerHTML = `<h3>${state.primary[k].name} ${modeToggleHtml('modeP' + k, state.primary[k].mode)}</h3>
      <div style="text-align:center;margin:-4px 0 10px;"><span class="maks-badge">Maks Bukaan : ${(state.primary[k].aMax * 100).toFixed(0)} cm</span></div>
      <div class="elev-card">
        <div class="cap">Elevasi Pintu</div>
${gateElevSvg(`elev${k}`)}
      </div>
      <div class="lamp-row">
        <div class="lamp"><div class="plate">R</div><div class="bulb"><span style="background:#d92d20;">ON</span></div></div>
        <div class="lamp"><div class="plate">S</div><div class="bulb"><span style="background:#f0a020;">ON</span></div></div>
        <div class="lamp"><div class="plate">T</div><div class="bulb"><span style="background:#17a34a;">ON</span></div></div>
      </div>
      <div class="field" style="margin-top:12px;"><label>Bukaan manual <b id="lblManualP${k}">${state.primary[k].manualA.toFixed(2)} m</b></label>
        <input type="range" id="sliderManualP${k}" min="0" max="${state.primary[k].aMax}" step="0.05" value="${state.primary[k].manualA}"></div>
      <p style="font-size:12.5px;color:var(--text-2);margin:4px 0 0;">Bukaan aktual: <b id="pShow${k}" style="color:var(--text-1);">-</b></p>`;
    pg.appendChild(card);
    document.querySelectorAll(`[data-role="modeP${k}"]`).forEach(btn => btn.addEventListener('click', () => {
      state.primary[k].mode = btn.dataset.val;
      document.querySelectorAll(`[data-role="modeP${k}"]`).forEach(b => b.classList.toggle('on', b === btn));
      pushLog(`Mode pintu ${state.primary[k].name} diubah ke ${btn.dataset.val.toUpperCase()} (operator).`, 'info');
    }));
    el('sliderManualP' + k).addEventListener('input', e => { state.primary[k].manualA = parseFloat(e.target.value); el('lblManualP' + k).textContent = state.primary[k].manualA.toFixed(2) + ' m'; });
  }

  el('sliderTargetSec').addEventListener('input', e => {
    state.secondary.targetLevel = parseFloat(e.target.value);
    el('lblTargetSec').textContent = state.secondary.targetLevel.toFixed(2) + ' m';
  });

  const sg = el('ctrlSecondaryGrid');
  state.secondary.gates.forEach((gt, i) => {
    const card = document.createElement('div'); card.className = 'ctrl-card'; card.id = 'ctrlCardS' + i;
    card.innerHTML = `<h3>${gt.name} ${modeToggleHtml('modeS' + i, gt.mode)}</h3>
      <div class="ctrl-top">
        ${miniElevHtml('elevS' + i)}
        <div class="ctrl-readout">
          <div><b id="roSecA${i}">-</b><span>Bukaan aktual</span></div>
          <div><b id="roSecH${i}">-</b><span>TMA saluran</span></div>
          <div><b id="roSecQ${i}">-</b><span>Debit lewat pintu</span></div>
          <div><b id="roSecV${i}">-</b><span>Arus saluran</span></div>
        </div>
      </div>
      <div class="ctrl-dev" id="devSec${i}">—</div>
      <div class="field ctrl-field" id="fSecMan${i}"><label>Bukaan manual <span class="tagmode">MANUAL</span> <b id="lblManualS${i}">${gt.manualA.toFixed(3)} m</b></label>
        <input type="range" id="sliderManualS${i}" min="0" max="${gt.aMax}" step="0.005" value="${gt.manualA}"></div>`;
    sg.appendChild(card);
    document.querySelectorAll(`[data-role="modeS${i}"]`).forEach(btn => btn.addEventListener('click', () => {
      gt.mode = btn.dataset.val;
      document.querySelectorAll(`[data-role="modeS${i}"]`).forEach(b => b.classList.toggle('on', b === btn));
      pushLog(`Mode ${gt.name} diubah ke ${btn.dataset.val.toUpperCase()} (operator).`, 'info');
    }));
    el('sliderManualS' + i).addEventListener('input', e => { gt.manualA = parseFloat(e.target.value); el('lblManualS' + i).textContent = gt.manualA.toFixed(3) + ' m'; });
  });

  const tg = el('ctrlTertiaryGrid');
  for (let i = 0; i < 3; i++) {
    const req = (state.duty * state.areas[i].ha) / 1000;
    const card = document.createElement('div'); card.className = 'ctrl-card'; card.id = 'ctrlCardT' + i;
    card.innerHTML = `<h3>${state.tertiary[i].gate.name} ${modeToggleHtml('modeT' + i, state.tertiary[i].gate.mode)}</h3>
      <div class="ctrl-top">
        ${miniElevHtml('elevT' + i)}
        <div class="ctrl-readout">
          <div><b id="roTertA${i}">-</b><span>Bukaan aktual</span></div>
          <div><b id="roTertH${i}">-</b><span>TMA saluran</span></div>
          <div><b id="roTertQ${i}">-</b><span>Ke sawah m³/dtk</span></div>
          <div><b id="roTertP${i}">-</b><span>Pemenuhan</span></div>
        </div>
      </div>
      <div class="ctrl-dev" id="devTert${i}">—</div>
      <p style="font-size:11.5px;color:var(--text-2);margin:0 0 8px;">Target debit <span class="tagmode">AUTO</span> mengikuti kebutuhan sawah: <b id="reqShow${i}" style="color:var(--text-1);">${req.toFixed(3)}</b> m³/dtk (atur luas dan duty di tab Konfigurasi).</p>
      <div class="field ctrl-field" id="fTertMan${i}"><label>Bukaan manual <span class="tagmode">MANUAL</span> <b id="lblManualT${i}">${state.tertiary[i].gate.manualA.toFixed(3)} m</b></label>
        <input type="range" id="sliderManualT${i}" min="0" max="${state.tertiary[i].gate.aMax}" step="0.005" value="${state.tertiary[i].gate.manualA}"></div>`;
    tg.appendChild(card);
    document.querySelectorAll(`[data-role="modeT${i}"]`).forEach(btn => btn.addEventListener('click', () => {
      state.tertiary[i].gate.mode = btn.dataset.val;
      document.querySelectorAll(`[data-role="modeT${i}"]`).forEach(b => b.classList.toggle('on', b === btn));
      pushLog(`Mode pintu tersier ${i + 1} diubah ke ${btn.dataset.val.toUpperCase()} (operator).`, 'info');
    }));
    el('sliderManualT' + i).addEventListener('input', e => { state.tertiary[i].gate.manualA = parseFloat(e.target.value); el('lblManualT' + i).textContent = state.tertiary[i].gate.manualA.toFixed(3) + ' m'; });
  }
}

/* Diagram elevasi pintu: rangka lengkap (assets/gate-frame-full.png) statis, dan
   satu daun pintu (assets/gate-leaf.png) bertinggi TETAP yang bergeser naik-turun.
   100% → tepi atas daun menempel balok; 0% → daun turun penuh ke ambang.
   Koordinat = piksel 694×578. */
const GEO = { bayX: 204, bayW: 300, top: 289, sill: 529, leafH: 180 };

function gateElevSvg(id, fontPx) {
  const G = GEO, fs = fontPx || 34;
  return `<svg viewBox="0 0 694 578" preserveAspectRatio="xMidYMid meet">
      <image href="/assets/gate-frame-full.png" x="0" y="0" width="694" height="578"/>
      <image id="${id}" href="/assets/gate-leaf.png" x="${G.bayX}" y="${G.top}" width="${G.bayW}" height="${G.leafH}" preserveAspectRatio="none"/>
      <text id="${id}Txt" x="354" y="${G.top + 104}" text-anchor="middle" font-size="${fs}" font-weight="700"
        fill="#1f2430" style="paint-order:stroke;stroke:#fff;stroke-width:${(fs * 0.21).toFixed(1)}px;">0 cm</text>
    </svg>`;
}

/* Daun pintu bergeser utuh: makin besar bukaan, makin terangkat ke balok. */
function setGateElev(id, a, aMax) {
  const leaf = el(id);
  if (!leaf) return;
  const G = GEO, travel = G.sill - G.top - G.leafH;
  const frac = clamp(a / (aMax || 1), 0, 1);
  const y = G.top + (1 - frac) * travel;
  leaf.setAttribute('y', y.toFixed(1));
  const txt = el(id + 'Txt');
  if (txt) {
    txt.setAttribute('y', (y + G.leafH / 2 + fontHalf(txt)).toFixed(1));
    txt.textContent = `${(a * 100).toFixed(0)} cm (${(frac * 100).toFixed(0)}%)`;
  }
}

function fontHalf(txt) {
  const fs = parseFloat(txt.getAttribute('font-size')) || 34;
  return fs * 0.36;
}

const setMiniElev = setGateElev;

/* Diagram elevasi ringkas untuk kartu sekunder & tersier. */
function miniElevHtml(id) {
  return `<div class="mini-elev"><div class="cap">Elevasi Pintu</div>${gateElevSvg(id, 46)}</div>`;
}

/* Baris deviasi: memberi tahu operator apakah loop kendali sedang mengejar
   target, sudah stabil, atau pintu mentok sementara target belum tercapai. */
function setDeviation(id, mode, err, tol, saturated, textChase, textOk) {
  const box = el(id);
  if (!box) return;
  box.className = 'ctrl-dev';
  if (mode !== 'auto') { box.textContent = 'Mode manual — bukaan dikunci operator, loop otomatis tidak aktif.'; return; }
  if (saturated && err > tol) {
    box.classList.add('stuck');
    box.textContent = 'Pintu mentok di bukaan maksimum — pasokan hulu belum mencukupi target.';
    return;
  }
  if (Math.abs(err) > tol) { box.classList.add('chase'); box.textContent = textChase; return; }
  box.textContent = textOk;
}

function refreshCtrlLive() {
  /* Duty ikut keadaan hulu, jadi bacaannya di tab Konfigurasi harus hidup —
     kalau dipatok saat kartu dibangun, angkanya tetap 1,00 padahal kemarau
     sudah memakai 0,65 dan status petak dinilai dengan angka itu. */
  const dutyLive = el('cfgDutyLive');
  if (dutyLive) dutyLive.textContent = state.duty.toFixed(2) + ' l/dtk/ha';

  for (let k = 0; k < state.primary.length; k++) {
    const p = el('pShow' + k);
    if (p) p.textContent = state.primary[k].ctrl.a.toFixed(2) + ' m';
    // diagram elevasi pintu: daun pintu terangkat seiring bukaan
    setGateElev('elev' + k, state.primary[k].ctrl.a, state.primary[k].aMax);
  }
  const sec = state.secondary;
  sec.gates.forEach((sg, i) => {
    if (!el('roSecA' + i)) return;
    el('roSecA' + i).textContent = (sg.ctrl.a * 100).toFixed(0) + ' cm';
    el('roSecH' + i).textContent = sec.canal.h.toFixed(2) + ' m';
    el('roSecQ' + i).textContent = state.Qsec[i].toFixed(3);
    el('roSecV' + i).textContent = state.vSec.toFixed(2) + ' m/s';
    setMiniElev('elevS' + i, sg.ctrl.a, sg.aMax);
    const err = sec.targetLevel - sec.canal.h;
    setDeviation('devSec' + i, sg.mode, err, 0.03, sg.ctrl.a >= sg.aMax - 0.002,
      `TMA ${sec.canal.h.toFixed(2)} / target ${sec.targetLevel.toFixed(2)} m — ${err > 0 ? 'di bawah' : 'di atas'} target.`,
      `TMA ${sec.canal.h.toFixed(2)} m — stabil pada target.`);
    el('fSecMan' + i).classList.toggle('off', sg.mode === 'auto');
  });

  for (let i = 0; i < 3; i++) {
    const t = state.tertiary[i], tg = t.gate;
    const reqT = (state.duty * state.areas[i].ha) / 1000;
    if (el('roTertA' + i)) {
      const pct = reqT > 0 ? clamp((state.Qfield[i] / reqT) * 100, 0, 999) : 100;
      el('roTertA' + i).textContent = (tg.ctrl.a * 100).toFixed(0) + ' cm';
      el('roTertH' + i).textContent = t.canal.h.toFixed(2) + ' m';
      el('roTertQ' + i).textContent = state.Qfield[i].toFixed(3);
      el('roTertP' + i).textContent = pct.toFixed(0) + '%';
      setMiniElev('elevT' + i, tg.ctrl.a, tg.aMax);
      const errT = reqT - state.Qfield[i];
      setDeviation('devTert' + i, tg.mode, errT, reqT * 0.05 || 0.005, tg.ctrl.a >= tg.aMax - 0.002,
        `Debit ${state.Qfield[i].toFixed(3)} / butuh ${reqT.toFixed(3)} m³/dtk — ${errT > 0 ? 'di bawah' : 'di atas'} kebutuhan.`,
        `Debit ${state.Qfield[i].toFixed(3)} m³/dtk — kebutuhan sawah terpenuhi.`);
      el('fTertMan' + i).classList.toggle('off', tg.mode === 'auto');
    }

    const req = (state.duty * state.areas[i].ha) / 1000;
    const r = el('reqShow' + i); if (r) r.textContent = req.toFixed(3);
  }
}

/* =========================================================================
   CHARTS
   ========================================================================= */
let chartLevelMain, chartLevelSub, chartDebitMain, chartDebitField, chartArusMain, chartArusSub;
const HIST_LEN = 90;

function commonOpts() {
  return {
    responsive: true, animation: false, maintainAspectRatio: true,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ticks: { color: '#5a6472', maxTicksLimit: 6, font: { family: 'Source Sans 3', size: 11 } }, grid: { color: '#e8ecf3' } },
      y: { ticks: { color: '#5a6472', font: { family: 'Source Sans 3', size: 11 } }, grid: { color: '#e8ecf3' } },
    },
    plugins: { legend: { labels: { color: '#1f2430', font: { family: 'Source Sans 3', size: 11.5 }, boxWidth: 12 } } },
    elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.25 } },
  };
}
function mkChart(id, datasets) {
  return new Chart(document.getElementById(id).getContext('2d'), { type: 'line', data: { labels: [], datasets }, options: commonOpts() });
}
function initCharts() {
  chartLevelMain = mkChart('chartLevelMain', [
    { label: 'TMA hulu', data: [], borderColor: '#8a93a1', borderDash: [4, 3] },
    { label: 'TMA kolam', data: [], borderColor: '#1f4fa6' },
  ]);
  chartLevelSub = mkChart('chartLevelSub', [
    { label: 'Saluran Sekunder', data: [], borderColor: '#2b6cb0' },
    ...CHAIN_NAMES.map((c, i) => ({ label: c.tert, data: [], borderColor: ['#17a34a', '#f0a020', '#7f56d9'][i], borderDash: [4, 3] })),
  ]);
  chartDebitMain = mkChart('chartDebitMain', [
    { label: 'Masuk (pintu primer)', data: [], borderColor: '#1f4fa6' },
    { label: 'Total ke sawah', data: [], borderColor: '#2b6cb0' },
    { label: 'Ke hilir', data: [], borderColor: '#17a34a' },
  ]);
  chartDebitField = mkChart('chartDebitField', [
    ...CHAIN_NAMES.map((c, i) => ({ label: 'Sawah ' + c.tert, data: [], borderColor: ['#2b6cb0', '#f0a020', '#d92d20'][i] })),
  ]);
  /* Kecepatan arus. Warna & pola garisnya disamakan dengan grafik TMA di atasnya —
     satu ruas selalu berwarna sama di kedua grafik, jadi membandingkan TMA dengan
     arusnya tidak perlu membaca legenda dua kali. */
  chartArusMain = mkChart('chartArusMain', [
    { label: 'Arus hulu', data: [], borderColor: '#8a93a1', borderDash: [4, 3] },
    { label: 'Arus kolam', data: [], borderColor: '#1f4fa6' },
  ]);
  chartArusSub = mkChart('chartArusSub', [
    { label: 'Saluran Sekunder', data: [], borderColor: '#2b6cb0' },
    ...CHAIN_NAMES.map((c, i) => ({ label: c.tert, data: [], borderColor: ['#17a34a', '#f0a020', '#7f56d9'][i], borderDash: [4, 3] })),
  ]);
}
let chartTick = 0;
function updateCharts() {
  chartTick++;
  if (chartTick % 2 !== 0) return;
  const label = fmtClock(state.simTime);
  const pushTrim = (arr, v) => { arr.push(v); if (arr.length > HIST_LEN) arr.shift(); };

  pushTrim(chartLevelMain.data.labels, label);
  pushTrim(chartLevelMain.data.datasets[0].data, +state.hUp.toFixed(2));
  pushTrim(chartLevelMain.data.datasets[1].data, +state.pool.h.toFixed(2));
  chartLevelMain.update('none');

  pushTrim(chartLevelSub.data.labels, label);
  pushTrim(chartLevelSub.data.datasets[0].data, +state.secondary.canal.h.toFixed(2));
  for (let i = 0; i < 3; i++) pushTrim(chartLevelSub.data.datasets[i + 1].data, +state.tertiary[i].canal.h.toFixed(2));
  chartLevelSub.update('none');

  pushTrim(chartDebitMain.data.labels, label);
  pushTrim(chartDebitMain.data.datasets[0].data, +state.QgateTotal.toFixed(2));
  pushTrim(chartDebitMain.data.datasets[1].data, +state.totalDelivered.toFixed(3));
  pushTrim(chartDebitMain.data.datasets[2].data, +state.Qhilir.toFixed(2));
  chartDebitMain.update('none');

  pushTrim(chartDebitField.data.labels, label);
  for (let i = 0; i < 3; i++) pushTrim(chartDebitField.data.datasets[i].data, +state.Qfield[i].toFixed(3));
  chartDebitField.update('none');

  /* Arus 3 desimal, bukan 2: saluran sekunder berayun 0,043-0,060 m/dtk sepanjang
     ketiga skenario — pada 2 desimal seluruh rentangnya memampat jadi 0,04-0,06 dan
     grafiknya bertangga, bukan melengkung. */
  pushTrim(chartArusMain.data.labels, label);
  pushTrim(chartArusMain.data.datasets[0].data, +state.vUp.toFixed(3));
  pushTrim(chartArusMain.data.datasets[1].data, +state.vPool.toFixed(3));
  chartArusMain.update('none');

  pushTrim(chartArusSub.data.labels, label);
  pushTrim(chartArusSub.data.datasets[0].data, +state.vSec.toFixed(3));
  for (let i = 0; i < 3; i++) pushTrim(chartArusSub.data.datasets[i + 1].data, +state.vTert[i].toFixed(3));
  chartArusSub.update('none');
}

/* =========================================================================
   RUMUS & ANALISIS
   ========================================================================= */
function buildFormulaTab() {
  const wrap = el('rumusBody');
  wrap.innerHTML = `
  <div class="formula-grid">

    <div class="formula-card">
      <h3>1. Kontinuitas &amp; Tampungan (Reservoir Routing)</h3>
      <p>Setiap segmen (kolam, saluran sekunder, saluran tersier) dimodelkan sebagai sel tampungan: perubahan volume = debit masuk − debit keluar.</p>
      <div class="formula-box">dS/dt = Q<sub>in</sub> − Q<sub>out</sub> &nbsp; | &nbsp; h = S / (B·L)</div>
      <div class="formula-live">Kolam: Q<sub>in</sub>=<b id="fContQin">-</b> m³/s, Q<sub>out</sub>=<b id="fContQout">-</b> m³/s → h=<b id="fContH">-</b> m</div>
    </div>

    <div class="formula-card">
      <h3>2. Persamaan Manning (Sungai Utama)</h3>
      <p>Menentukan kecepatan &amp; debit aliran sungai alami (hulu) dan kapasitas alir kolam menuju hilir.</p>
      <div class="formula-box">V = (1/n)·R<sup>2/3</sup>·S₀<sup>1/2</sup> &nbsp; Q = V·A &nbsp; R = A/P</div>
      <div class="formula-live">Hulu: A=<b id="fManA">-</b> m², R=<b id="fManR">-</b> m → V=<b id="fManV">-</b> m/s, Q=<b id="fManQ">-</b> m³/s</div>
    </div>

    <div class="formula-card">
      <h3>3. Persamaan Pintu Air (Orifice Bawah)</h3>
      <p>Debit lewat bawah daun pintu — dipakai pada seluruh 10 pintu (3 floodway + 1 scouring, 3 pengambilan, 3 tersier), aliran bebas atau tenggelam tergantung muka air hulu-hilir.</p>
      <div class="formula-box">Bebas: Q=C<sub>d</sub>b·a·√(2g(h<sub>hulu</sub>−a/2)) &nbsp;|&nbsp; Tenggelam: Q=C<sub>d</sub>b·a·√(2g(h<sub>hulu</sub>−h<sub>hilir</sub>))</div>
      <div class="formula-live">Primer-1: a=<b id="fGateA">-</b> m, rejim <b id="fGateRegime">-</b> → Q=<b id="fGateQ">-</b> m³/s</div>
    </div>

    <div class="formula-card">
      <h3>3b. Limpasan Mercu &amp; Tampungan Hulu Bendung</h3>
      <p>Air yang tidak lewat pintu tidak lenyap: ia tertahan di hulu bendung sampai muka airnya melewati mercu, lalu melimpas ke hilir. Inilah yang membuat menutup seluruh pintu menaikkan muka air hulu dan menurunkan debit hilir — sampai limpasan mercu mengambil alih.</p>
      <div class="formula-box">Q<sub>mercu</sub> = C<sub>w</sub>·b<sub>mercu</sub>·max(0, h<sub>hulu</sub>−h<sub>mercu</sub>)<sup>3/2</sup> &nbsp;|&nbsp; dS<sub>hulu</sub>/dt = Q<sub>sungai</sub> − (Q<sub>scouring</sub>+Q<sub>floodway</sub>+Q<sub>mercu</sub>)</div>
      <div class="formula-live">C<sub>w</sub>=${MERCU_CW}, b<sub>mercu</sub>=<b id="fMercuB">-</b> m, h<sub>mercu</sub>=<b id="fMercuH">-</b> m, h<sub>hulu</sub>=<b id="fMercuHu">-</b> m → Q=<b id="fMercuQ">-</b> m³/s</div>
    </div>

    <div class="formula-card">
      <h3>4. Ambang Lebar Menuju Petak Sawah</h3>
      <p>Air dari saluran tersier masuk ke petak sawah melalui bangunan sadap bebas (tidak bermotor) — dimodelkan sebagai ambang lebar sederhana.</p>
      <div class="formula-box">Q<sub>sawah</sub> = C<sub>w</sub>·b·h<sup>3/2</sup></div>
      <div class="formula-live">Tersier-1: C<sub>w</sub>=${FIXED.fieldCw}, b=${FIXED.fieldB} m, h=<b id="fWeirH">-</b> m → Q=<b id="fWeirQ">-</b> m³/s</div>
    </div>

    <div class="formula-card" style="grid-column:1/-1;">
      <h3>5. Neraca Air Total (Uji Konservasi Massa)</h3>
      <p>Memastikan seluruh debit sungai di hulu bendung sama dengan jumlah yang tersalur ke 3 sawah, debit ke hilir, dan laju perubahan tampungan total (tampungan hulu bendung + kolam + saluran sekunder + 3 saluran tersier). Menutup pintu membuat dS/dt melonjak positif — air tertahan di hulu, bukan hilang — lalu kembali ke nol setelah muka airnya setimbang di atas mercu.</p>
      <p class="note">Volume kendalinya dimulai dari SUNGAI, bukan dari pintu. Dulu debit masuk dihitung <i>scouring + floodway</i>, jadi air sungai yang tidak masuk pintu mana pun berada di luar neraca — dan pada keadaan kemarau 3,17 m³/dtk (66% debit sungai) memang hilang tanpa membuat selisihnya bergerak. Dengan Q<sub>sungai</sub> sebagai pembilang, kebocoran seperti itu langsung terbaca di baris Selisih.</p>
      <div class="formula-box">Q<sub>sungai hulu</sub> = ΣQ<sub>sawah</sub> + Q<sub>hilir</sub> + dS<sub>total</sub>/dt</div>
      <table class="data-table">
        <tr><td>Debit sungai di hulu bendung</td><td id="fBalIn">-</td></tr>
        <tr><td>Σ Debit ke sawah</td><td id="fBalIrig">-</td></tr>
        <tr><td>Debit ke hilir</td><td id="fBalHilir">-</td></tr>
        <tr><td style="padding-left:22px;">— lewat 3 pintu floodway</td><td id="fBalFlood">-</td></tr>
        <tr><td style="padding-left:22px;">— melimpas di atas ambang bendung</td><td id="fBalSpill">-</td></tr>
        <tr><td style="padding-left:22px;">— lewat pintu scouring (pembilas kolam)</td><td id="fBalScour">-</td></tr>
        <tr><td>dS<sub>total</sub>/dt</td><td id="fBalDs">-</td></tr>
        <tr><td><b>Selisih neraca</b></td><td id="fBalErr">-</td></tr>
      </table>
    </div>

    <div class="formula-card" style="grid-column:1/-1;">
      <h3>6. Status Kebutuhan Irigasi — Ideal / Cukup / Kurang / Lebih</h3>
      <p>Rasio r = Q<sub>aktual</sub> / Q<sub>kebutuhan</sub>. Klasifikasi: <b>Kurang</b> jika r&lt;0.85 · <b>Cukup</b> jika 0.85≤r&lt;0.97 · <b>Ideal</b> jika 0.97≤r≤1.10 · <b>Lebih</b> jika r&gt;1.10.</p>
      <table class="data-table">
        <thead><tr><th>Sawah</th><th>Luas (ha)</th><th>Kebutuhan (m³/dtk)</th><th>Aktual (m³/dtk)</th><th>Rasio</th><th>Status</th></tr></thead>
        <tbody id="statusTableBody"></tbody>
      </table>
      <div class="formula-live" style="margin-top:8px;">Faktor alokasi adaptif (bila pasokan primer terbatas): <b id="fAllocFactor">100%</b> — <span id="fAllocNote">pasokan mencukupi.</span></div>
    </div>

  </div>`;

  const tbody = document.getElementById('statusTableBody');
  state.areas.forEach((a, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td id="stName${i}">${a.name}</td><td id="stHa${i}">${a.ha}</td><td id="stReq${i}">-</td><td id="stAct${i}">-</td><td id="stRatio${i}">-</td><td id="stStatus${i}">-</td>`;
    tbody.appendChild(tr);
  });
}

function updateFormulaTab() {
  el('fContQin').textContent = state.QgateTotal.toFixed(2);
  el('fContQout').textContent = state.Qhilir.toFixed(2);
  el('fContH').textContent = state.pool.h.toFixed(2);

  const m0 = manningCalc(state.hUp, state.river.B, FIXED.nRiver, FIXED.S0River);
  el('fManA').textContent = m0.A.toFixed(1);
  el('fManR').textContent = m0.R.toFixed(2);
  el('fManV').textContent = m0.V.toFixed(2);
  el('fManQ').textContent = m0.Q.toFixed(2);

  const gp = gateDischarge(state.hUp, state.pool.h, state.primary[0].ctrl.a, state.primary[0].b, FIXED.CdPrimary);
  el('fGateA').textContent = state.primary[0].ctrl.a.toFixed(2);
  el('fGateRegime').textContent = gp.regime;
  el('fGateQ').textContent = ((state.Qprim || [])[3] ?? state.QgateTotal).toFixed(2);

  el('fWeirH').textContent = state.tertiary[0].canal.h.toFixed(2);
  el('fWeirQ').textContent = state.Qfield[0].toFixed(3);

  const hu = state.hulu || {};
  el('fMercuB').textContent = (hu.bMercu || 0).toFixed(1);
  el('fMercuH').textContent = (hu.hMercu || 0).toFixed(2);
  el('fMercuHu').textContent = state.hUp.toFixed(2);
  el('fMercuQ').textContent = (state.Qspill || 0).toFixed(2);

  const dStotalDt = state._dStotalDt || 0;
  /* Volume kendali dimulai dari SUNGAI, bukan dari pintu — lihat catatan di
     kartu Neraca Air. Dengan Qnat sebagai pembilang, air sungai yang tidak masuk
     pintu mana pun tetap harus muncul di salah satu suku keluarannya. */
  const Qin = state.Qnat;
  const err = Qin - (state.totalDelivered + state.Qhilir + dStotalDt);
  el('fBalIn').textContent = Qin.toFixed(2) + ' m³/s';
  el('fBalIrig').textContent = state.totalDelivered.toFixed(3) + ' m³/s';
  el('fBalHilir').textContent = state.Qhilir.toFixed(2) + ' m³/s';
  el('fBalFlood').textContent = (state.Qflood || 0).toFixed(2) + ' m³/s';
  el('fBalSpill').textContent = (state.Qspill || 0).toFixed(2) + ' m³/s';
  el('fBalScour').textContent = (state.Qscour || 0).toFixed(3) + ' m³/s';
  el('fBalDs').textContent = dStotalDt.toFixed(2) + ' m³/s';
  const errEl = el('fBalErr');
  errEl.textContent = err.toFixed(2) + ' m³/s';
  errEl.className = Math.abs(err) < Math.max(1, Qin * 0.08) ? 'balance-ok' : 'balance-bad';

  state.areas.forEach((a, i) => {
    const req = (state.duty * a.ha) / 1000;
    const st = irrigationStatus(state.Qfield[i], req);
    el('stName' + i).textContent = a.name;
    el('stHa' + i).textContent = a.ha;
    el('stReq' + i).textContent = req.toFixed(3);
    el('stAct' + i).textContent = state.Qfield[i].toFixed(3);
    el('stRatio' + i).textContent = ((st.r || 0) * 100).toFixed(0) + '%';
    const s = el('stStatus' + i); s.textContent = st.label;
    s.className = st.cls === 'ideal' ? 'balance-ok' : (st.cls === 'kurang' ? 'balance-bad' : '');
  });
  el('fAllocFactor').textContent = (state.allocFactor * 100).toFixed(0) + '%';
  el('fAllocNote').textContent = state.allocFactor >= 0.98 ? 'pasokan mencukupi seluruh kebutuhan.' : 'pasokan primer terbatas — semua sawah diturunkan proporsional (giliran air).';
}

/* =========================================================================
   NAV TABS, SEARCH, DOWNLOAD, SKENARIO, PLAY/PAUSE/RESET
   ========================================================================= */
/* Alamat & judul tiap tab dikirim Laravel lewat window.WMS_VIEW.views —
   sumbernya SkemaIrigasiController::VIEWS, jadi slug rute tidak ditulis dua
   kali. Nilai cadangan di bawah hanya jaga-jaga kalau berkas ini dimuat di
   luar halaman Blade-nya. */
const VIEW_MAP = (window.WMS_VIEW || {}).views || {
  dashboard:   { url: '/beranda',            judul: 'Beranda' },
  kontrol:     { url: '/kontrol-pintu',      judul: 'Kontrol Pintu' },
  konfigurasi: { url: '/konfigurasi-sistem', judul: 'Konfigurasi Sistem' },
  tren:        { url: '/tren-data',          judul: 'Tren Data' },
  rumus:       { url: '/rumus-analisis',     judul: 'Rumus & Analisis' },
  log:         { url: '/log-sistem',         judul: 'Log Sistem' },
  peta:        { url: '/peta-lokasi',        judul: 'Peta Lokasi' },
};
/* Chart.js diinisialisasi saat tab Tren masih display:none, jadi ukurannya
   harus dihitung ulang begitu layarnya tampil. */
function resizeCharts() {
  [chartLevelMain, chartLevelSub, chartDebitMain, chartDebitField, chartArusMain, chartArusSub].forEach(c => { if (c) c.resize(); });
}
function setPageTitle(view) {
  const t = el('pageTitle');
  if (t) t.textContent = (VIEW_MAP[view] || {}).judul || 'Beranda';
}

/* Tiap tab punya rutenya sendiri di tingkat akar (/beranda, /kontrol-pintu, …).
   Halamannya tetap satu dokumen, jadi penukaran tab tidak memuat ulang apa pun —
   hanya alamat di bilah peramban yang disetel lewat History API, supaya tab bisa
   di-bookmark, di-reload, dan tombol maju/mundur peramban berfungsi. */
const trimSlash = (p) => p.replace(/\/+$/, '') || '/';

function viewUrl(view) {
  return (VIEW_MAP[view] || {}).url || '/';
}

/* Tab aktif dibaca dari alamat, bukan dari history.state: entri pertama riwayat
   tidak punya state, jadi tombol mundur ke situ akan salah tab kalau mengandalkannya. */
function viewFromUrl() {
  const path = trimSlash(location.pathname);
  const hit = Object.keys(VIEW_MAP).find(k => trimSlash(viewUrl(k)) === path);
  return hit || 'dashboard';
}

function activateView(view, push) {
  const target = el('view-' + view);
  if (!target) return;
  document.querySelectorAll('.navtab').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  target.classList.add('active');
  setPageTitle(view);
  /* Penanda tab aktif untuk CSS. Blade sudah memasangnya pada cat pertama; di sini
     disetel ulang karena penukaran tab tidak memuat ulang halaman. Yang membacanya
     sekarang cuma peta-selaras.css — tab Peta Lokasi menyembunyikan judul halaman
     dan railbar simulasi, keduanya tidak berlaku di sana. */
  document.body.dataset.tab = view;
  if (push && viewFromUrl() !== view) history.pushState({ view }, '', viewUrl(view));
  requestAnimationFrame(resizeCharts);
  /* Peta Lokasi baru dibangun saat tabnya benar-benar tampil. Leaflet menghitung
     ukuran kontainer saat L.map() dijalankan, dan panel yang belum aktif masih
     display:none — dibangun di situ, fitBounds-nya memilih zoom yang salah.
     petaMulai() idempoten, jadi pemanggilan berikutnya tidak melakukan apa-apa;
     invalidateSize() untuk ukuran yang berubah sudah diurus ResizeObserver di
     dalam peta.js sendiri. Ini masalah yang sama dengan resizeCharts() di atas. */
  if (view === 'peta' && typeof window.petaMulai === 'function') {
    requestAnimationFrame(() => window.petaMulai());
  }
}

function initNav() {
  document.querySelectorAll('.navtab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      /* Tab adalah <a> ke rute aslinya. Klik biasa ditahan lalu ditukar di
         tempat; klik dengan Ctrl/Shift/Alt/tengah dibiarkan lewat supaya
         "buka di tab baru" tetap bekerja seperti tautan pada umumnya. */
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      e.preventDefault();
      activateView(tab.dataset.view, true);
    });
  });
  window.addEventListener('popstate', () => activateView(viewFromUrl(), false));
  activateView(viewFromUrl(), false);
}

function initSearch() {
  const field = el('searchPos');
  if (!field) return;
  field.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = e.target.value.trim().toLowerCase();
    if (!q) return;
    const candidates = [];
    document.querySelectorAll('.ctrl-card, .cfg-card, .sawah-card').forEach(card => candidates.push(card));
    let target = null;
    for (const c of candidates) { if (c.textContent.toLowerCase().includes(q)) { target = c; break; } }
    if (target) {
      const view = target.closest('.view');
      if (view) {
        document.querySelectorAll('.navtab').forEach(b => b.classList.toggle('active', b.dataset.view === view.id.replace('view-', '')));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        view.classList.add('active');
        setPageTitle(view.id.replace('view-', ''));
        requestAnimationFrame(resizeCharts);
      }
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.classList.remove('highlight-flash'); void target.offsetWidth; target.classList.add('highlight-flash');
    } else {
      pushLog(`Pencarian "${q}" tidak menemukan pos yang cocok.`, 'warn');
    }
  });
}

function downloadSnapshot() {
  const snapshot = {
    waktu_simulasi_detik: state.simTime,
    skenario: state.scenario,
    sungai_utama: { lebar_m: state.river.B, tinggi_tanggul_m: state.river.Hmax, tma_hulu_m: +state.hUp.toFixed(3), arus_hulu_mps: +state.vUp.toFixed(3), debit_alami_m3s: +state.Qnat.toFixed(3) },
    kolam_bendung: { target_tma_m: state.targetPoolLevel, tma_m: +state.pool.h.toFixed(3), arus_mps: +state.vPool.toFixed(3), debit_masuk_total_m3s: +state.QgateTotal.toFixed(3), debit_hilir_m3s: +state.Qhilir.toFixed(3) },
    pintu_primer: state.primary.map((p, k) => ({ id: k + 1, nama: p.name, fungsi: p.role, lebar_m: p.b, tinggi_pintu_m: p.aMax, mode: p.mode, bukaan_aktual_m: +p.ctrl.a.toFixed(3) })),
    saluran_sekunder: {
      lebar_m: state.secondary.canal.B, tinggi_tanggul_m: state.secondary.canal.Hmax,
      tma_m: +state.secondary.canal.h.toFixed(3), arus_mps: +state.vSec.toFixed(3),
      target_tma_m: state.secondary.targetLevel, debit_masuk_total_m3s: +state.QsecTotal.toFixed(3),
      pintu_pengambilan: state.secondary.gates.map((gt, i) => ({
        id: i + 1, nama: gt.name, lebar_m: gt.b, tinggi_pintu_m: gt.aMax,
        mode: gt.mode, bukaan_aktual_m: +gt.ctrl.a.toFixed(3), debit_m3s: +state.Qsec[i].toFixed(3),
      })),
    },
    tersier: state.tertiary.map((tt, i) => ({ id: i + 1, nama: tt.gate.name, saluran_lebar_m: tt.canal.B, saluran_tinggi_tanggul_m: tt.canal.Hmax, tma_m: +tt.canal.h.toFixed(3), arus_mps: +state.vTert[i].toFixed(3), pintu_lebar_m: tt.gate.b, pintu_tinggi_m: tt.gate.aMax, mode: tt.gate.mode, bukaan_aktual_m: +tt.gate.ctrl.a.toFixed(3), debit_ke_sawah_m3s: +state.Qfield[i].toFixed(3) })),
    sawah: state.areas.map((a, i) => {
      const req = (state.duty * a.ha) / 1000;
      const st = irrigationStatus(state.Qfield[i], req);
      return { nama: a.name, luas_ha: a.ha, kebutuhan_m3s: +req.toFixed(3), aktual_m3s: +state.Qfield[i].toFixed(3), status: st.label };
    }),
    duty_l_per_dtk_per_ha: state.duty,
    alokasi_adaptif_persen: +(state.allocFactor * 100).toFixed(1),
    status_sistem: state.status,
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `simhidro-snapshot-${fmtClock(state.simTime).replace(/[: ]/g, '-')}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  pushLog('Snapshot data sensor & konfigurasi diunduh.', 'info');
}

/* Penanda tombol skenario. Dipisah dari setScenario() karena pemutaran juga
   memanggilnya saat menyeberangi jendela keadaan. */
function tandaiSkenario(name) {
  const berpindah = state.scenario !== name;
  state.scenario = name;
  const map = { normal: 'scNormal', flood: 'scFlood', drought: 'scDrought' };
  ['scNormal', 'scFlood', 'scDrought'].forEach(id => {
    const b = el(id);
    if (b) b.classList.toggle('on', id === map[name]);
  });
  /* Hanya saat keadaannya benar-benar berpindah — pemutaran memanggil ini tiap
     kali menyeberangi jendela, dan menekan tombol yang sedang aktif tidak
     boleh ikut mengilatkan gambar. */
  if (berpindah) skTandaiSkenarioBaru();
}

/* Gulir pemutaran ke menit tertentu, tidak melompat: kursor histori dijalankan
   cepat sampai menyentuh sasaran. Perpindahan keadaan jadi terlihat melewati
   masa peralihan yang memang terekam, sama seperti hidrograf naik/turun
   bertahap — bukan angka yang berganti seketika. */
let skenarioScrub = null;
function gulirKeMenit(target, selesai) {
  if (skenarioScrub) { clearInterval(skenarioScrub); skenarioScrub = null; }
  const tujuan = dummyIndex(target);
  /* Laju TETAP satu menit rekaman per langkah, bukan sepersekian sisa jarak
     seperti dulu. Yang lama melesat di awal lalu merayap di ujung, sehingga
     lereng naik/turun yang justru menarik dilewati dalam sekejap. Dengan laju
     tetap, seluruh masa peralihan yang terekam benar-benar terlihat, dan satu
     jendela penuh (60 menit) memakan ±4,2 detik — sebanding dengan prototipe
     yang perlu ±6,5 detik untuk debitnya sampai ke target baru. */
  skenarioScrub = setInterval(() => {
    if (dummyMinute === tujuan) {
      clearInterval(skenarioScrub);
      skenarioScrub = null;
      if (selesai) selesai();
      return;
    }
    dummyMinute += Math.sign(tujuan - dummyMinute);
    dummyGateStep();                    /* pintu ikut menyesuaikan sepanjang jalan */
    applyDummySnapshot(dummyMinute, 60);
    render();
  }, 70);
}

function setScenario(name, label) {
  tandaiSkenario(name);
  pushLog(`Skenario kondisi sumber hulu diubah ke: ${label}.`, 'info');
  if (!NO_DATA) return;

  /* Keadaan hulu bukan lagi angka yang dikarang saat tombol ditekan: ketiganya
     benar-benar terekam di histori sensor. Jadi tombolnya menggulir pemutaran
     ke jendela waktu tempat keadaan itu terekam. Sasarannya digeser sepanjang
     masa peralihan supaya berhenti di tengah keadaan, bukan di lerengnya. */
  const j = dummyJendela((DUMMY_SCENARIO[name] || {}).key);
  const peralihan = ((window.WMS_DUMMY || {}).histori || {}).peralihanMenit || 0;
  if (!j) {
    /* Tanpa jendela rekaman keadaan berganti seketika, jadi tampungan hulu
       dipatok ulang ke muka air acuan keadaan yang baru — tidak ada masa
       peralihan yang bisa dilaluinya. */
    state.hulu.siap = false;
    applyDummySnapshot(dummyMinute);
    render();
    seedDummyCharts();
    return;
  }
  gulirKeMenit(j.dari + peralihan + 4, () => {
    seedDummyCharts();
    /* Kendali AUTO dibiarkan bekerja sesaat supaya pintu terlihat mengejar
       kebutuhan petak di keadaan yang baru, bukan diam sampai tombol
       Jalankan ditekan. */
    dummyAutoSettle(12);
  });
}

function resetSimulation() {
  const scenarioAktif = state.scenario;
  const fresh = freshState();
  Object.keys(fresh).forEach(k => { state[k] = fresh[k]; });
  tandaiSkenario(scenarioAktif);
  state.pool.S = state.pool.h * state.river.B * FIXED.poolL;
  state.secondary.canal.S = state.secondary.canal.h * state.secondary.canal.B * FIXED.secL;
  state.tertiary.forEach(t => t.canal.S = t.canal.h * t.canal.B * FIXED.tertL);
  lastStatus = 'NORMAL'; lastSatLog = -99999;
  el('logList').innerHTML = '';
  [chartLevelMain, chartLevelSub, chartDebitMain, chartDebitField, chartArusMain, chartArusSub].forEach(c => { c.data.labels = []; c.data.datasets.forEach(d => d.data = []); c.update('none'); });
  buildConfigTab(); buildControlTab(); buildSawahCards(); buildGateStatus();
  if (NO_DATA) {
    /* Reset mengembalikan kursor ke awal jendela keadaan yang SEDANG dipilih,
       bukan memaksa kembali ke Normal — pilihan operator dihormati. */
    dummyMinute = dummyRentangPutar().mulai;
    initDummyGates();
    terapkanOperasiPrimerLangsung();
    applyDummySnapshot(dummyMinute);
  }
  pushLog(NO_DATA ? 'Pemutaran dikembalikan ke awal jendela keadaan yang dipilih.' : 'Simulasi direset ke kondisi awal (parameter default).', 'info');
  render();
  seedDummyCharts();
  markBlueprints();
}

/* =========================================================================
   MAIN LOOP
   ========================================================================= */
function tick() {
  if (!state.running) return;
  if (NO_DATA) {
    /* Pemutaran BERPUTAR DI DALAM jendela keadaan yang sedang dipilih operator,
       tidak menyusuri seluruh rekaman. Jadi menekan Jalankan pada keadaan
       Normal memutar jam normal saja, dan skenario tidak pernah berganti
       sendiri — pergantian keadaan hanya terjadi kalau tombolnya ditekan.
       Masa peralihan di awal jendela dilewati supaya tiap putaran tidak
       mengulang lerengnya. */
    const r = dummyRentangPutar();
    const langkahMenit = Math.max(1, Math.round(state.speed / 4));
    dummyMinute += langkahMenit;
    if (dummyMinute > r.akhir || dummyMinute < r.mulai) dummyMinute = r.mulai;
    state.simTime += 60;
    dummyGateStep();
    /* Waktu rekaman yang berlalu — dipakai neraca tampungan hulu. */
    applyDummySnapshot(dummyMinute, langkahMenit * 60);
  } else {
    for (let i = 0; i < state.speed; i++) stepSimulation();
  }
  render();
}

function boot() {
  dummyMinute = dummySpan();
  tandaiSkenario(dummySkenarioDiMenit(dummyMinute));
  initDummyGates();
  terapkanOperasiPrimerLangsung();
  applyDummySnapshot(dummyMinute);
  buildSchematic();
  buildIsoMap();
  initIsoMapControls();
  initIsoWater();
  initMapTabs();
  initCollapsiblePanels();
  buildSawahCards();
  buildGateStatus();
  buildConfigTab();
  buildControlTab();
  buildFormulaTab();
  initCharts();
  initNav();
  initSearch();

  el('playPauseBtn').addEventListener('click', () => {
    state.running = !state.running;
    el('playPauseBtn').textContent = state.running ? '⏸ Jeda' : '▶ Jalankan';
    pushLog(state.running ? 'Simulasi dilanjutkan.' : 'Simulasi dijeda.', 'info');
  });
  el('resetBtn').addEventListener('click', resetSimulation);
  el('speedSelect').addEventListener('change', e => state.speed = parseInt(e.target.value, 10));
  el('scNormal').addEventListener('click', () => setScenario('normal', 'Normal'));
  el('scFlood').addEventListener('click', () => setScenario('flood', 'Hujan / Banjir'));
  el('scDrought').addEventListener('click', () => setScenario('drought', 'Kering / Kemarau'));
  el('downloadBtn').addEventListener('click', downloadSnapshot);
  el('posClose').addEventListener('click', closePosPop);
  el('posAnalisa').addEventListener('click', posToKontrol);
  el('posLokasi').addEventListener('click', posToLokasi);
  el('gotoKontrolBtn').addEventListener('click', () => activateView('kontrol', true));

  if (NO_DATA) {
    pushLog('Data dummy Leuwigoong dimuat — tekan Jalankan untuk memutar historis 60 menit.', 'ok');
    pushLog('Skenario hulu (Normal / Hujan / Kering) dan bukaan pintu keduanya mengubah kelas aliran pada skema.', 'info');
  } else {
    pushLog('Sistem SIMHIDRO v2 dimulai — 3 floodway + scouring, 3 pintu pengambilan ke satu saluran sekunder, mode AUTO.', 'ok');
  }
  if (NO_DATA) {
    /* slider bukaan / target dan tombol mode langsung mengubah debit */
    /* menggeser slider bukaan manual otomatis memindahkan pintu itu ke mode MANUAL */
    document.addEventListener('input', (e) => {
      const id = e.target.id || '';
      const mm = id.match(/^sliderManual([PST])(\d)$/);
      if (mm) {
        const [, kind, n] = mm, i = +n;
        const gate = kind === 'P' ? state.primary[i] : (kind === 'S' ? state.secondary.gates[i] : state.tertiary[i].gate);
        gate.mode = 'manual';
        document.querySelectorAll(`[data-role="mode${kind}${i}"]`)
          .forEach(b => b.classList.toggle('on', b.dataset.val === 'manual'));
      }
    });
    ['input', 'click'].forEach(ev => document.addEventListener(ev, (e) => {
      if (e.target.closest('#view-kontrol, #view-konfigurasi')) requestAnimationFrame(dummyRefresh);
    }));
  }
  setInterval(tick, 260);
  render();
  seedDummyCharts();
  markBlueprints();
}

function markBlueprints() {}
function updateTsChips() {}

document.addEventListener('DOMContentLoaded', boot);

/* =========================================================================
   PETA ISOMETRIK — proyeksi 2:1, bangunan ekstrusi sederhana, pin sensor
   ========================================================================= */
const ISO = { TW: 64, TH: 32, ox: 640, oy: 72 };
const ISO_LEAF = { p: [], s: [], t: [] };
function isoPoint(gx, gy) { return { x: (gx - gy) * (ISO.TW / 2) + ISO.ox, y: (gx + gy) * (ISO.TH / 2) + ISO.oy }; }
function pts(arr) { return arr.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '); }
function isoRect(gx0, gy0, gx1, gy1, fill, extra) {
  const A = isoPoint(gx0, gy0), B = isoPoint(gx1, gy0), C = isoPoint(gx1, gy1), D = isoPoint(gx0, gy1);
  return `<polygon points="${pts([A, B, C, D])}" fill="${fill}" ${extra || ''}/>`;
}
function isoBox(gx0, gy0, gx1, gy1, height, topColor, southColor, eastColor) {
  const A = isoPoint(gx0, gy0), B = isoPoint(gx1, gy0), C = isoPoint(gx1, gy1), D = isoPoint(gx0, gy1);
  const shift = p => ({ x: p.x, y: p.y - height });
  const At = shift(A), Bt = shift(B), Ct = shift(C), Dt = shift(D);
  const top = pts([At, Bt, Ct, Dt]);
  const south = pts([D, C, Ct, Dt]);
  const east = pts([B, C, Ct, Bt]);
  return `<polygon points="${south}" fill="${southColor}"/><polygon points="${east}" fill="${eastColor}"/><polygon points="${top}" fill="${topColor}" stroke="rgba(28,36,100,0.35)" stroke-width="0.6"/>`;
}
function isoBoxB(gx0, gy0, gx1, gy1, base, height, topColor, southColor, eastColor) {
  const lift = (p, dy) => ({ x: p.x, y: p.y - dy });
  const A = isoPoint(gx0, gy0), B = isoPoint(gx1, gy0), C = isoPoint(gx1, gy1), D = isoPoint(gx0, gy1);
  const Ab = lift(A, base), Bb = lift(B, base), Cb = lift(C, base), Db = lift(D, base);
  const At = lift(A, base + height), Bt = lift(B, base + height), Ct = lift(C, base + height), Dt = lift(D, base + height);
  return `<polygon points="${pts([Db, Cb, Ct, Dt])}" fill="${southColor}"/><polygon points="${pts([Bb, Cb, Ct, Bt])}" fill="${eastColor}"/><polygon points="${pts([At, Bt, Ct, Dt])}" fill="${topColor}" stroke="rgba(28,36,100,0.35)" stroke-width="0.6"/>`;
}
function isoLineLift(gx0, gy0, gx1, gy1, lift, attrs) {
  const a = isoPoint(gx0, gy0), b = isoPoint(gx1, gy1);
  return `<line x1="${a.x.toFixed(1)}" y1="${(a.y - lift).toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${(b.y - lift).toFixed(1)}" ${attrs || ''}/>`;
}
function isoFaceEast(gx, gyA, gyB, base, hh, color, extra) {
  const A = isoPoint(gx, gyA), B = isoPoint(gx, gyB);
  return `<polygon points="${A.x.toFixed(1)},${(A.y - base).toFixed(1)} ${B.x.toFixed(1)},${(B.y - base).toFixed(1)} ${B.x.toFixed(1)},${(B.y - base - hh).toFixed(1)} ${A.x.toFixed(1)},${(A.y - base - hh).toFixed(1)}" fill="${color}" ${extra || ''}/>`;
}
function isoFaceSouth(gxA, gxB, gy, base, hh, color, extra) {
  const A = isoPoint(gxA, gy), B = isoPoint(gxB, gy);
  return `<polygon points="${A.x.toFixed(1)},${(A.y - base).toFixed(1)} ${B.x.toFixed(1)},${(B.y - base).toFixed(1)} ${B.x.toFixed(1)},${(B.y - base - hh).toFixed(1)} ${A.x.toFixed(1)},${(A.y - base - hh).toFixed(1)}" fill="${color}" ${extra || ''}/>`;
}
function isoRailRun(gx0, gy0, gx1, gy1, lift, hh, color, posts) {
  let s = isoLineLift(gx0, gy0, gx1, gy1, lift + hh, `stroke="${color}" stroke-width="2.2"`)
        + isoLineLift(gx0, gy0, gx1, gy1, lift + hh * 0.52, `stroke="${color}" stroke-width="1.5"`);
  const n = posts || 6;
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = isoPoint(gx0 + (gx1 - gx0) * t, gy0 + (gy1 - gy0) * t);
    s += `<line x1="${p.x.toFixed(1)}" y1="${(p.y - lift).toFixed(1)}" x2="${p.x.toFixed(1)}" y2="${(p.y - lift - hh).toFixed(1)}" stroke="${color}" stroke-width="1.7"/>`;
  }
  return s;
}
function isoWheel(gx, gy, lift, r, color) {
  const p = isoPoint(gx, gy), cy = p.y - lift;
  let s = `<circle cx="${p.x.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" fill="none" stroke="${color}" stroke-width="3"/>`;
  s += `<circle cx="${p.x.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.3).toFixed(1)}" fill="${color}"/>`;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI;
    s += `<line x1="${(p.x - Math.cos(a) * r).toFixed(1)}" y1="${(cy - Math.sin(a) * r * 0.5).toFixed(1)}" x2="${(p.x + Math.cos(a) * r).toFixed(1)}" y2="${(cy + Math.sin(a) * r * 0.5).toFixed(1)}" stroke="${color}" stroke-width="1.6"/>`;
  }
  return s;
}
function isoLeafPoly(id, gxA, gyA, gxB, gyB, H, store) {
  const A = isoPoint(gxA, gyA), B = isoPoint(gxB, gyB);
  store.push({ id: id, ax: A.x, ay: A.y, bx: B.x, by: B.y, H: H });
  return `<polygon id="${id}" points="" fill="#c1a878" stroke="#8f7c52" stroke-width="1"/>`;
}
function isoLine(gx0, gy0, gx1, gy1, attrs) {
  const a = isoPoint(gx0, gy0), b = isoPoint(gx1, gy1);
  return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" ${attrs || ''}/>`;
}
function treeBlob(gx, gy) {
  const p = isoPoint(gx, gy);
  return `<g>
    <ellipse cx="${p.x}" cy="${p.y + 3}" rx="13" ry="6" fill="#1d1f20" opacity="0.1"/>
    <circle cx="${p.x - 6}" cy="${p.y - 8}" r="9" fill="#5f8f52"/>
    <circle cx="${p.x + 6}" cy="${p.y - 10}" r="10" fill="#6d9d5c"/>
    <circle cx="${p.x}" cy="${p.y - 15}" r="9" fill="#7bab68"/>
  </g>`;
}
const PIN_ICON = {
  drop: '<path d="M0,-8 C4,-3 7.5,0.4 7.5,3.4 A7.5,7.5 0 0,1 -7.5,3.4 C-7.5,0.4 -4,-3 0,-8 Z" fill="#fff"/>',
  /* `gate` — TAMPAK MUKA BANGUNAN BERPINTU: jembatan pelayanan melintang di
     atas, dua bilik pintu di bawahnya, dan dua kaki yang mengembang ke luar
     seperti sayap pangkal bendung.

     Dua bentuk sebelumnya digambar sebagai SKEMA — kotak bertepi dengan bilah
     di tengah, lalu rangka dengan daun menggantung. Keduanya menuntut pembacanya
     menerjemahkan lambang, dan pada cakram 30 px terjemahan itu tidak pernah
     selesai: satu kotak putih bisa berarti apa saja. Yang digambar sekarang
     rupa bangunannya sendiri, bentuk yang sama dengan bendung gerak di
     ilustrasi peta di bawahnya — jadi pin dan bangunan yang ditunjuknya
     bercerita hal yang sama.

     DUA bilik, bukan tiga atau satu. Tiga membuat pilar tengahnya menyatu jadi
     satu blok putih pada ukuran 1x yang benar-benar dipakai peta; satu bilik
     lebar terbaca sebagai meja.

     Celah di antara kedua bilik 3 unit, bukan 2. Pada 2 unit celahnya cuma
     selebar satu piksel di ukuran 1x, dan kedua bilik lebur jadi satu bilah
     putih — persis cacat yang membuat versi tiga bilik gagal. 3 unit menyisakan
     celah yang masih terlihat pada ukuran terkecil, dan lebar mukanya tetap
     12,4 unit sehingga bilik mengecil, bukan bangunannya melebar.

     Batasnya +-9,6 x, +-7 y. Lebih lebar daripada ikon lain (+-8) karena
     bangunan memang melebar, dan kepala tetes memberi ruangnya. */
  gate: '<path d="M-9.2,-6.8 H9.2" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
      + '<path d="M-7.6,-5 L-9.4,6.8 M7.6,-5 L9.4,6.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'
      + '<rect x="-6.2" y="-4.4" width="4.7" height="6.2" rx="0.6" fill="#fff"/>'
      + '<rect x="1.5" y="-4.4" width="4.7" height="6.2" rx="0.6" fill="#fff"/>',
  wave: '<path d="M-8,-2.5 q4,-4 8,0 t8,0" fill="none" stroke="#fff" stroke-width="2"/><path d="M-8,3 q4,-4 8,0 t8,0" fill="none" stroke="#fff" stroke-width="2"/>',
  valve: '<circle cx="0" cy="0" r="6" fill="none" stroke="#fff" stroke-width="2"/><path d="M-6,0 H6 M0,-6 V6" stroke="#fff" stroke-width="2"/>',
  outflow: '<path d="M-8,0 H3.5" stroke="#fff" stroke-width="2.2"/><path d="M-0.5,-5 L6,0 L-0.5,5 Z" fill="#fff"/>',
};
/* CATATAN IKON. `wave` (dua garis muka air) adalah glyph AWLR yang netral: ia
   menandakan ALAT-nya, pengukur tinggi muka air, dan dipakai semua pos AWLR —
   kolam bendung maupun saluran sekunder & tersier. `drop` pada pos hulu dan
   `outflow` pada pos hilir menandakan KEDUDUKAN pos itu di sistem (sumber air,
   keluaran ke sungai), bukan jenis alatnya; keduanya tunggal di tempatnya jadi
   tidak menimbulkan kembaran. `gate` dipakai seluruh pos AWGC — primer,
   pengambilan, tersier — karena ketiganya bangunan sewatak: bilik berpintu di
   bawah jembatan pelayanan.

   `valve` tidak dipakai pos mana pun lagi sejak pintu tersier pindah ke `gate`.
   Dibiarkan ada karena ia bentuk yang sah untuk bangunan berkeran kalau nanti
   ada — bukan karena masih terpakai. */

/* BADAN PIN — TETES, BUKAN CAKRAM.
 *
 * Kepala bundar r=10 dengan dua garis singgung yang turun bertemu di satu ujung
 * pada y = PIN_UJUNG. Bentuk penanda peta yang sudah dikenali siapa pun: ada
 * arah, dan arahnya menunjuk ke bawah — ke bangunan yang diwakilinya. Cakram
 * bundar tidak menunjuk apa pun; di atas ilustrasi yang penuh bangunan, ia
 * terbaca sebagai tombol yang melayang, bukan sebagai penanda tempat.
 *
 * KEPALANYA TETAP DI TITIK POS, ujungnya menjulur ke bawah — BUKAN ujungnya yang
 * dipatok di titik pos seperti penanda peta pada umumnya. Alasannya letak ke-12
 * pos di ISO_POS disetel tangan dengan menggeser CAKRAM sampai duduk pas di atas
 * bangunannya (lihat tombol "Geser pin"). Memindahkan patokan ke ujung menaikkan
 * seluruh kepala 21 unit, dan setelan tangan itu hangus semuanya — kepala yang
 * tadinya menutupi bendung pindah ke rimbun pohon di atasnya. Yang ditukar cuma
 * bentuknya; letak yang sudah dinilai benar tidak disentuh.
 *
 * UKURANNYA. Percobaan pertama memakai kepala r=15 — sama dengan cakram lama —
 * dan hasilnya terlalu besar: tetes menambahkan ekor di bawah kepala, jadi pada
 * radius yang sama tinggi penandanya naik dari 30 unit ke 45 dan pin mulai
 * menutupi bangunan yang seharusnya ditunjuknya. Sekarang r=10, tinggi utuh 31 —
 * setara cakram lama, tapi kini menunjuk.
 *
 * Yang menahannya tidak turun lagi bukan selera melainkan glif `gate`: celah 3
 * unit di antara kedua biliknya menyusut ikut PIN_GLIF_SKALA, dan di bawah r=10
 * celah itu tinggal di bawah 2 unit — kedua bilik lebur jadi satu bilah putih dan
 * bangunannya tidak lagi terbaca berpintu dua. Glifnya menyusut lewat satu angka,
 * bukan digambar ulang: satu tempat mengecilkan seluruh keluarga ikon sekaligus,
 * jadi tidak ada ikon yang bisa ketinggalan.
 *
 * Garis tepinya gelap pekat (#0f1420), bukan navy #132f63 seperti cakram dulu,
 * dan tanpa garis putih di dalamnya. Cakram dulu butuh cincin putih itu supaya
 * tidak lebur di daerah rimbun pohon yang gelap; tepi hampir hitam mengerjakan
 * hal yang sama dengan satu garis, dan sisi tetes yang menyempit tidak punya
 * ruang untuk dua garis bertumpuk. Kilap di kepala ellipse putih 16% — memberi
 * bentuknya sedikit isi tanpa perlu gradasi yang harus dibuat sekali per warna
 * status. Tebalnya 0,6 (lihat .iso-pin .pin-ring di wms.css), turun dua kali
 * dari 1,7 pada percobaan pertama: pada kepala sekecil ini garis 1,7 memakan
 * hampir seperempat jari-jarinya dan penandanya terbaca sebagai cincin hitam,
 * bukan sebagai warna statusnya. Garisnya tidak dihapus sama sekali karena masih ada
 * satu latar yang membutuhkannya — rimbun pohon, satu-satunya bidang di peta
 * yang segelap warna cincin status paling pekat. */
const PIN_KEPALA_R = 10, PIN_UJUNG = 21;
/* Glif PIN_ICON semuanya digambar untuk kepala r=15 (batas +-8, `gate` +-9,6).
   Dikecilkan bersama-sama di sini, sekali, alih-alih setiap glif diketik ulang. */
const PIN_GLIF_SKALA = 0.67;
const PIN_TETES_D = (() => {
  const cos = PIN_KEPALA_R / PIN_UJUNG;              /* titik singgung dari ujung */
  const sin = Math.sin(Math.acos(cos));
  const px = (PIN_KEPALA_R * sin).toFixed(2), py = (PIN_KEPALA_R * cos).toFixed(2);
  /* Busur besar (large-arc=1) arah negatif (sweep=0): dari singgung kanan-bawah
     memutar LEWAT ATAS ke singgung kiri-bawah, 240 derajat. */
  return `M-${px},${py} L0,${PIN_UJUNG} L${px},${py} `
    + `A${PIN_KEPALA_R},${PIN_KEPALA_R} 0 1,0 -${px},${py} Z`;
})();

/* Pin pada koordinat gambar (bukan grid isometrik).
 *
 * Satu-satunya pembangun pin. Kembarannya yang memakai koordinat grid isometrik —
 * pinMarker(id, gx, gy, hOff, ...) — dibuang: tidak ada yang memanggilnya sejak peta
 * isometrik berhenti digambar sebagai geometri SVG dan berganti ke ilustrasi raster
 * dengan pin di atasnya, sementara isi markupnya salinan fungsi ini. Dua salinan
 * markup pin berarti setiap perbaikan pin harus dikerjakan dua kali, dan yang tidak
 * pernah dipanggil tidak akan pernah menunjukkan kalau terlewat. LANE_GX (lajur pada
 * grid isometrik) ikut dibuang untuk alasan yang sama. */
function pinMarkerXY(id, x, y, icon, tooltip, len, up) {
  const lx = -(len || 58), ly = (len || 58) * (up ? -0.42 : 0.5);
  /* Tali, titik, latar, dan tulisan label semuanya beri id: letaknya tidak lagi
     dipatok di sini, layoutIsoLabels() memindahkannya supaya tidak menutupi pin
     lain. Angka di bawah cuma keadaan awal sebelum penataan pertama jalan. */
  return `<g class="iso-pin" data-pin="${id}" transform="translate(${x},${y})" onclick="onPinClick('${id}')">
    <title>${tooltip}</title>
    <line class="pin-leader" id="pinLeader_${id}" x1="-9" y1="${up ? -9 : 9}" x2="${(lx + 9).toFixed(1)}" y2="${(ly + (up ? 4 : -2)).toFixed(1)}"/>
    <circle class="pin-leader-dot" id="pinDot_${id}" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5"/>
    <ellipse cx="0" cy="${PIN_UJUNG - 1}" rx="${(PIN_KEPALA_R * 0.47).toFixed(1)}" ry="${(PIN_KEPALA_R * 0.17).toFixed(1)}" fill="#000" opacity="0.25"/>
    <path class="pin-ring" d="${PIN_TETES_D}"/>
    <ellipse cx="0" cy="${(-PIN_KEPALA_R * 0.42).toFixed(1)}" rx="${(PIN_KEPALA_R * 0.72).toFixed(1)}" ry="${(PIN_KEPALA_R * 0.42).toFixed(1)}" fill="#fff" opacity="0.16"/>
    <g transform="scale(${PIN_GLIF_SKALA})">${PIN_ICON[icon] || PIN_ICON.drop}</g>
    <g class="iso-label-grp" id="pinLbl_${id}">
      <rect class="iso-label-bg" id="pinBg_${id}" x="${(lx - 56).toFixed(1)}" y="${(ly - 10).toFixed(1)}" width="112" height="20" rx="4"/>
      <text class="iso-label" id="pinLabel_${id}" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}">-</text>
      <text class="iso-label iso-label--2" id="pinLabel2_${id}" x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}"></text>
    </g>
  </g>`;
}

/* ---- penataan label: jangan menutupi pin lain ----------------------------- *
 *
 * Dulu tiap label dipatok pada satu titik tetap: 62 unit ke kiri pinnya, turun
 * setengah panjang itu (atau naik 0,42 kalau bendera `up` dipasang), dengan kotak
 * selebar 112 unit apa pun isinya. Dengan 12 pin — enam di antaranya berkerumun di
 * jaringan irigasi dalam radius 120 unit — kotak-kotak itu saling menumpuk dan
 * menutupi cakram pin tetangganya. Dan lebar tetap 112 membuat label pendek berkotak
 * kosong sementara label panjang menjorok keluar kotaknya.
 *
 * Sekarang: lebar kotak mengikuti lebar tulisannya, dan letaknya dipilih dari delapan
 * calon di sekitar pin — empat arah diagonal pada dua jarak. Calon dinilai, yang
 * paling sedikit bertabrakan yang dipakai.
 *
 * Penataan ini TIDAK dijalankan tiap frame. Ia hanya jalan saat label dinyalakan,
 * saat peta dibangun ulang, dan saat panjang salah satu tulisan berubah — kalau
 * dijalankan terus, kotaknya berpindah-pindah tiap kali angkanya bertambah satu digit
 * dan seluruh label terlihat gelisah. */
/* Tinggi kotak: satu baris 20 unit, dua baris 33. Baris keduanya 13 unit di bawah
   yang pertama — sedikit lebih rapat daripada tinggi barisnya sendiri, supaya kedua
   baris terbaca sebagai satu blok, bukan dua label yang berdempetan. */
const LBL_H1 = 20, LBL_H2 = 33, LBL_BARIS = 13, LBL_PAD = 9, LBL_MIN = 46;
/* Sepuluh calon letak: [dx, dy] pusat kotak relatif terhadap pin — empat diagonal
   pada jarak dekat, empat pada jarak jauh, lalu dua tegak lurus sebagai jalan
   terakhir. Urutannya adalah urutan pilihan: kiri-bawah lebih dulu karena itu letak
   asalnya, jadi pin yang tidak berkerumun tampil persis seperti sebelumnya. */
const LBL_CALON = [
  [-62,  29], [-62, -26], [62,  29], [62, -26],       /* diagonal dekat — letak asal */
  [-96,  50], [-96, -46], [96,  50], [96, -46],       /* diagonal jauh */
  [0, 44], [0, -40],                                  /* tegak lurus di atas/bawah pin */
  [-106, 8], [106, 8],                                /* mendatar, sejajar pin */
  [-60, 66], [60, 66], [-60, -62], [60, -62],         /* diagonal, lebih turun/naik */
  [0, 78], [0, -74],                                  /* tegak jauh */
  /* Cadangan terjauh. Ditambahkan sesudah tulisan petak ikut jadi penghalang:
     dengan enam kotak tulisan petak di tengah jaringan irigasi, pin yang
     berkerumun kadang tidak menemukan satu pun letak bebas di antara calon di
     atas, dan label yang kalah terpaksa mendarat menutupi tulisan petak. */
  [-140, 22], [140, 22], [-140, -18], [140, -18],
  [-104, 92], [104, 92], [-104, -88], [104, -88],
];
let lblSidik = '', lblUkur = null;

/* Ukuran kotak tiap label, DISIMPAN.
 *
 * Pengukurannya memanggil getBBox() dua kali per pin — dan getBBox memaksa peramban
 * menghitung ulang tata letak SVG-nya. 24 kali per penataan masih murah kalau
 * penataannya jarang, tetapi menggeser pin menata ulang tiap bingkai: 24 pemaksaan
 * tata letak per bingkai membuat tarikan pin tersendat.
 *
 * Yang menentukan ukuran cuma tulisannya, dan tulisan tidak berubah selama pin
 * ditarik. Jadi ukurannya diukur sekali per perubahan tulisan, lalu dipakai ulang. */
function ukurLabelIso(ids, sidik) {
  if (lblUkur && sidik === lblSidik) return lblUkur;
  /* Lebar diukur dari tulisannya sendiri, bukan ditaksir dari jumlah huruf: angka
     dan huruf berbeda lebar, dan tab iso bisa sedang tersembunyi sehingga ukurannya
     nol — dalam keadaan itu penataan ditunda, tidak dikira-kira. */
  const lebar = (elm) => {
    if (!elm || !elm.textContent) return 0;
    try { return elm.getBBox().width; } catch (e) { return -1; }
  };
  const kotak = [];
  for (const id of ids) {
    const t1 = document.getElementById('pinLabel_' + id);
    const t2 = document.getElementById('pinLabel2_' + id);
    if (!t1) return null;
    const w1 = lebar(t1), w2 = lebar(t2);
    if (w1 <= 0 || w2 < 0) return null;   /* panel tersembunyi — coba lagi nanti */
    const dua = !!(t2 && t2.textContent);
    kotak.push({
      id, dua,
      w: Math.max(LBL_MIN, Math.max(w1, w2) + LBL_PAD * 2),
      h: dua ? LBL_H2 : LBL_H1,
    });
  }
  lblSidik = sidik;
  lblUkur = kotak;
  return kotak;
}

function layoutIsoLabels(paksa) {
  const svg = el('isoSvg');
  if (!svg || !svg.firstChild || !svg.classList.contains('labels-on')) return;

  const ids = Object.keys(ISO_POS);
  /* Sidik = gabungan panjang tiap tulisan. Berubah hanya kalau ada label yang
     bertambah/berkurang huruf — bukan tiap kali angkanya bergerak. */
  const panjang = (pre, id) => {
    const t = document.getElementById(pre + id);
    return t ? t.textContent.length : 0;
  };
  /* Panjang tulisan petak ikut masuk sidik: ia jadi penghalang di bawah, jadi
     kalau tulisannya berubah panjang (petak jadi "Kurang 83%" dari "100%"),
     letak label pin di sekitarnya perlu dihitung ulang. */
  const sidik = ids.map(id => panjang('pinLabel_', id) + ':' + panjang('pinLabel2_', id)).join(',')
    + '|' + Object.keys(ISO_PETAK).map(id => panjang('petakLabel_', id) + ':' + panjang('petakLabel2_', id)).join(',');
  /* Tanpa paksaan, penataan dilewati kalau tulisannya tidak berubah. DENGAN paksaan
     ia tetap jalan walau tulisannya sama — itu yang dipakai saat pin digeser, karena
     yang berubah letak pinnya, bukan isi labelnya. */
  if (!paksa && sidik === lblSidik) return;

  const kotak = ukurLabelIso(ids, sidik);
  if (!kotak) return;

  const pin = {};
  ids.forEach(id => { pin[id] = { x: ISO_POS[id][0], y: ISO_POS[id][1] }; });

  const tumpang = (a, b) => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
  const terpakai = [];

  /* TULISAN PETAK IKUT DIHITUNG SEBAGAI PENGHALANG.
     Label pin dulu hanya saling menghindari sesama label pin dan cakram pin, jadi
     begitu tulisan petak muncul (tombol Label yang sama menyalakan keduanya), kotak
     label pin mendarat tepat di atas nama petak — "Petak Leuwigoong" tertutup
     "Bukaan 73 cm" dan tidak bisa dibaca sama sekali.
     Yang mengalah label pinnya: tulisan petak terpaku di titik berat petaknya
     sendiri, memindahkannya berarti menuliskannya di luar petak yang dinamainya.
     Kotaknya diambil dari getBBox — ukuran tulisan sebenarnya sesudah tergambar,
     bukan taksiran dari jumlah huruf. */
  const halangPetak = [];
  Object.keys(ISO_PETAK).forEach(id => {
    ['petakLabel_', 'petakLabel2_'].forEach(pre => {
      const t = document.getElementById(pre + id);
      if (!t || !t.textContent) return;
      let b;
      try { b = t.getBBox(); } catch (e) { return; }
      if (!b || !(b.width > 0)) return;
      halangPetak.push({ x0: b.x - 4, x1: b.x + b.width + 4, y0: b.y - 3, y1: b.y + b.height + 3 });
    });
  });

  kotak.forEach(k => {
    const p = pin[k.id];
    let terbaik = null, nilaiTerbaik = Infinity;
    LBL_CALON.forEach(([dx, dy], urut) => {
      const cx = p.x + dx, cy = p.y + dy;
      const box = { x0: cx - k.w / 2, x1: cx + k.w / 2, y0: cy - k.h / 2, y1: cy + k.h / 2 };
      let nilai = urut * 0.5;           /* pilihan yang lebih awal sedikit diutamakan */
      /* menutupi badan pin mana pun — pelanggaran terberat: pin itu yang diklik.
         Kotaknya TIDAK simetris tegak: badan pin berbentuk tetes yang kepalanya
         di titik pos dan ujungnya menjulur 30 unit ke bawah, jadi batas bawahnya
         jauh lebih rendah daripada batas atasnya. Dengan kotak simetris +-18
         seperti dulu, label bisa mendarat tepat di atas ujung penunjuk pin
         tetangganya — bagian yang justru menyatakan pin itu menunjuk ke mana. */
      ids.forEach(o => {
        if (o === k.id) return;
        const q = pin[o];
        const m = PIN_KEPALA_R + 3;
        if (q.x + m > box.x0 && q.x - m < box.x1
          && q.y + PIN_UJUNG + 3 > box.y0 && q.y - m < box.y1) nilai += 100;
      });
      /* Ekor pin SENDIRI. Hukumannya lebih ringan daripada menutupi pin lain:
         label yang menutupi ujung penunjuknya sendiri masih bisa diklik dan masih
         jelas milik siapa — cuma jelek. Tanpa hukuman ini calon [0,44] (tegak
         lurus di bawah pin) selalu menang untuk pin yang terkurung, dan kotak
         putihnya memotong ujung tetesnya. */
      if (box.x0 < p.x + 8 && box.x1 > p.x - 8
        && box.y1 > p.y + PIN_KEPALA_R - 4 && box.y0 < p.y + PIN_UJUNG + 3) nilai += 55;
      terpakai.forEach(u => { if (tumpang(box, u)) nilai += 40; });
      /* Menutupi tulisan petak dihukum lebih berat daripada menutupi sesama label
         pin: label pin punya kotak latar putih yang menutup rapat apa pun di
         bawahnya, sedangkan dua label pin yang bertumpang sebagian masih menyisakan
         angka yang terbaca. */
      halangPetak.forEach(u => { if (tumpang(box, u)) nilai += 70; });
      /* keluar kanvas: label terpotong tepi gambar */
      if (box.x0 < 4 || box.x1 > ISO_VB.w - 4 || box.y0 < 4 || box.y1 > ISO_VB.h - 4) nilai += 60;
      if (nilai < nilaiTerbaik) { nilaiTerbaik = nilai; terbaik = { cx, cy, box }; }
    });
    terpakai.push(terbaik.box);

    /* Ditulis sebagai koordinat LOKAL: seluruh isi <g> pin sudah di-translate ke
       letak pinnya, jadi yang disetel selisihnya terhadap pin — bukan letak mutlak. */
    const rx = terbaik.cx - p.x, ry = terbaik.cy - p.y;
    const set = (elid, attrs) => {
      const e = document.getElementById(elid);
      if (e) Object.keys(attrs).forEach(a => e.setAttribute(a, attrs[a].toFixed(1)));
    };
    set('pinBg_' + k.id, { x: rx - k.w / 2, y: ry - k.h / 2, width: k.w, height: k.h });
    /* Satu baris: di tengah kotak. Dua baris: keduanya dipusatkan bersama, jadi blok
       teksnya tetap di tengah kotaknya. */
    const y1 = k.dua ? ry - LBL_BARIS / 2 + 4 : ry + 4;
    set('pinLabel_' + k.id, { x: rx, y: y1 });
    set('pinLabel2_' + k.id, { x: rx, y: y1 + LBL_BARIS });
    set('pinDot_' + k.id, { cx: rx, cy: ry });
    /* Tali ditarik dari tepi cakram pin ke tepi kotak label yang menghadapnya, bukan
       dari pusat ke pusat: tali yang menembus cakram dan kotaknya sendiri terlihat
       seperti coretan, bukan seperti penunjuk. */
    const jarak = Math.hypot(rx, ry) || 1;
    const ux = rx / jarak, uy = ry / jarak;
    /* Jarak dari pusat kotak ke tepinya sepanjang arah tali — sisi mana yang
       ditembus ditentukan yang lebih dekat, mendatar atau tegak. */
    const keTepi = Math.min(
      Math.abs(ux) > 1e-3 ? (k.w / 2) / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-3 ? (k.h / 2) / Math.abs(uy) : Infinity);
    const pangkal = PIN_KEPALA_R + 1;                     /* tepi kepala tetes */
    const ujung = Math.max(pangkal, jarak - keTepi);
    set('pinLeader_' + k.id, {
      x1: ux * pangkal, y1: uy * pangkal,
      x2: ux * ujung, y2: uy * ujung,
    });
  });
}

/* Posisi pos telemetri di atas ilustrasi (satuan viewBox 1300×731). */
const ISO_POS = {
  hulu:   [1190, 245, 'drop',    'Pos AWLR Hulu — TMA & Arus Sungai Alami'],
  primer: [1075, 358, 'gate',    'Pos AWGC Intake — Bendung Gerak'],
  kolam:  [ 770, 340, 'wave',    'Pos AWLR Kolam Bendung / Kantong Lumpur'],
  hilir:  [ 940, 620, 'outflow', 'Pos AWLR Hilir — Debit Keluar'],
  sek:    [ 393, 232, 'gate',    'Pos AWGC Sekunder — Intake 1 s.d. 3'],
  /* Ikon pintu tersier 'valve' → 'gate', sama dengan pintu primer & pengambilan.
     Ketiganya bangunan yang sama wataknya — daun pintu yang dinaik-turunkan — dan
     ikon keran yang lain sendiri membuat pintu tersier terbaca sebagai jenis
     bangunan yang berbeda, padahal cuma beda tingkat di jaringan yang sama. */
  ter0:   [ 330, 262, 'gate',    'Pos AWGC Tersier 1', 1],
  ter1:   [ 343, 420, 'gate',    'Pos AWGC Tersier 2'],
  ter2:   [ 226, 200, 'gate',    'Pos AWGC Tersier 3', 1],

  /* Pos AWLR saluran — mengukur TINGGI MUKA AIR, bukan bukaan pintu.
   *
   * Sebelumnya jaringan irigasi hanya punya pos AWGC (pintu): TMA saluran sekunder
   * dan ketiga tersier memang dihitung dan dipakai mewarnai airnya, tetapi tidak ada
   * pos yang bisa diklik untuk membacanya — angkanya cuma muncul di label pintu di
   * sebelahnya. Kini tiap ruas punya pos ukurnya sendiri, sejajar dengan hulu, kolam,
   * dan hilir di sisi sungai.
   *
   * Ikonnya `wave`, SAMA dengan pos AWLR kolam bendung — lihat CATATAN IKON di atas
   * PIN_ICON. Alatnya memang satu jenis, jadi ikonnya satu; yang membedakan pos-pos
   * ini letaknya dan labelnya, bukan lambangnya. Percobaan pertama memberi pos AWLR
   * saluran ikon mistar duga sendiri, dan itu justru menyatakan yang tidak benar:
   * bahwa alat di saluran berbeda jenis dari alat di kolam.
   *
   * Letaknya digeser +58 x dan +34 y dari pos pintu pasangannya: ke KANAN-BAWAH,
   * menjauhi tali & kotak label pintu yang menjulur ke kiri (lihat pinMarkerXY).
   * Jarak antar-pin terdekat jadi 52 unit, di atas 30 unit yang dibutuhkan dua cakram
   * r=15 supaya tidak bertumpuk. Angka ini penempatan AWAL — geser sendiri lewat
   * tombol "Geser pin" di peta, lalu "Salin koordinat" untuk menuliskannya ke sini. */
  awlrSek:  [ 451, 266, 'wave', 'Pos AWLR Saluran Sekunder — TMA & Arus'],
  awlrTer0: [ 388, 300, 'wave', 'Pos AWLR Saluran Tersier 1 — TMA & Arus'],
  awlrTer1: [ 401, 458, 'wave', 'Pos AWLR Saluran Tersier 2 — TMA & Arus'],
  awlrTer2: [ 284, 238, 'wave', 'Pos AWLR Saluran Tersier 3 — TMA & Arus'],
};

/* ---- geser titik pos secara manual (mode edit) ---- */
const ISO_POS_DEFAULT = JSON.parse(JSON.stringify(ISO_POS));
const PIN_POS_KEY = 'wmsIsoPinPos';
let pinEdit = false, pinDrag = null;

/* =========================================================================
   TATA LETAK PETA (letak pin + batas petak) — DISIMPAN DI SERVER
   -------------------------------------------------------------------------
   Dulu keduanya hanya masuk localStorage. Itu berarti letak yang sudah
   dirapikan cuma berlaku di peramban yang dipakai merapikan: dibuka dari
   komputer lain, dari ponsel, atau dari peramban lain di mesin yang sama, semua
   kembali ke letak bawaan dan harus ditata ulang.

   Sekarang sumber kebenarannya berkas di server (storage/app/tata-letak-peta.json,
   lihat SkemaIrigasiController::tataLetak). Halaman membawanya di
   window.WMS_TATA_LETAK, dan tiap geseran dikirim balik ke sana.

   localStorage TETAP ditulis, tapi turun perannya jadi cadangan: ia hanya
   dibaca kalau server belum punya apa-apa untuk kunci itu. Jadi kalau kiriman
   ke server gagal (jaringan putus, berkas tidak bisa ditulis), hasil kerja
   tidak hilang di alat yang sedang dipakai — dan kegagalannya dikatakan
   terang-terangan lewat penanda di sudut peta, bukan didiamkan seolah
   tersimpan.
   ========================================================================= */
const TATA_LETAK = (typeof window !== 'undefined' && window.WMS_TATA_LETAK) || {};
const TATA_LETAK_URL = (typeof window !== 'undefined' && window.WMS_TATA_LETAK_URL) || '';
let tataLetakJadwal = 0;
/* Bagian yang sedang "pakai bawaan" dikirim sebagai objek KOSONG, bukan sebagai
   salinan angka bawaannya.
   Bedanya kelihatan nanti: kalau tombol Posisi Awal mengirim angka bawaan hari
   ini, angka itu membeku di server. Begitu ISO_POS/ISO_PETAK di simhidro.js
   diperbaiki, seluruh alat tetap memakai bawaan lama yang terlanjur tersimpan,
   dan tidak ada yang mengerti kenapa perbaikannya tidak muncul. Yang kosong
   berarti "ikut apa pun yang ada di kode". */
const tataLetakBawaan = { pin: false, petak: false };

const tataLetakServer = (bagian) => {
  const v = TATA_LETAK[bagian];
  return v && typeof v === 'object' ? v : {};
};
function bacaLokal(kunci) {
  try {
    const v = JSON.parse(localStorage.getItem(kunci) || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
function tulisLokal(kunci, nilai) {
  try { localStorage.setItem(kunci, JSON.stringify(nilai)); } catch (e) {}
}

/* Penanda kecil di sudut peta: menyimpan / tersimpan / gagal. */
function statusTataLetak(teks, kelas) {
  const s = el('tataLetakStatus');
  if (!s) return;
  s.textContent = teks;
  s.className = 'tata-letak-status on ' + (kelas || '');
  clearTimeout(statusTataLetak.jam);
  if (kelas !== 'gagal') statusTataLetak.jam = setTimeout(() => { s.className = 'tata-letak-status'; }, 2200);
}

/* Kiriman ditunda sebentar dan digabung: satu tarikan pin menghasilkan puluhan
   pointermove, dan tiap satunya memanggil savePinPos(). Tanpa penundaan itu jadi
   puluhan permintaan POST untuk satu geseran yang sama. */
function kirimTataLetak() {
  if (!TATA_LETAK_URL || typeof fetch !== 'function') return;
  clearTimeout(tataLetakJadwal);
  tataLetakJadwal = setTimeout(() => {
    const muatan = {
      pin: tataLetakBawaan.pin ? {} : (() => {
        const o = {};
        Object.keys(ISO_POS).forEach(k => { o[k] = [Math.round(ISO_POS[k][0]), Math.round(ISO_POS[k][1])]; });
        return o;
      })(),
      petak: tataLetakBawaan.petak ? {} : (() => {
        const o = {};
        Object.keys(ISO_PETAK).forEach(k => { o[k] = ISO_PETAK[k].map(p => [Math.round(p[0]), Math.round(p[1])]); });
        return o;
      })(),
    };
    const tok = document.querySelector('meta[name="csrf-token"]');
    statusTataLetak('Menyimpan…', 'kirim');
    fetch(TATA_LETAK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-TOKEN': tok ? tok.getAttribute('content') : '',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(muatan),
    })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
      /* Salinan di memori TIDAK ditulis ulang di sini. Ia sudah diperbarui saat
         disimpan; menuliskan `muatan` lagi sesudah jawabannya tiba justru
         mengembalikan keadaan ke saat kiriman dirakit, dan geseran yang terjadi
         selama permintaan berlangsung akan hilang. */
      .then(() => { statusTataLetak('Tersimpan untuk semua alat', 'ok'); })
      .catch((e) => {
        console.warn('Tata letak peta gagal disimpan ke server:', e);
        statusTataLetak('Gagal simpan ke server — tersimpan di peramban ini saja', 'gagal');
      });
  }, 700);
}

/* Server lebih dulu; localStorage hanya dipakai kalau server belum punya apa-apa.
   Kalau keduanya dibaca sekaligus, alat yang pernah menata sendiri akan selamanya
   melihat versinya sendiri dan tidak pernah ikut versi bersama. */
function loadPinPos() {
  const server = tataLetakServer('pin');
  const s = Object.keys(server).length ? server : bacaLokal(PIN_POS_KEY);
  Object.keys(s).forEach(k => {
    if (ISO_POS[k] && Array.isArray(s[k]) && s[k].length === 2) { ISO_POS[k][0] = +s[k][0]; ISO_POS[k][1] = +s[k][1]; }
  });
}
function savePinPos() {
  const o = {};
  Object.keys(ISO_POS).forEach(k => { o[k] = [Math.round(ISO_POS[k][0]), Math.round(ISO_POS[k][1])]; });
  tulisLokal(PIN_POS_KEY, o);
  /* Salinan server di memori ikut diperbarui SEKARANG, bukan menunggu POST-nya
     berhasil. buildIsoMap() memanggil loadPinPos() tiap kali peta digambar ulang,
     dan loadPinPos() mendahulukan nilai server: kalau salinan itu masih yang lama
     selama 700 ms penundaan kiriman, tiap penggambaran ulang mengembalikan letak
     yang baru saja diubah — geserannya seperti tidak pernah terjadi. */
  TATA_LETAK.pin = o;
  tataLetakBawaan.pin = false;
  kirimTataLetak();
}
function resetPinPos() {
  Object.keys(ISO_POS_DEFAULT).forEach(k => { ISO_POS[k][0] = ISO_POS_DEFAULT[k][0]; ISO_POS[k][1] = ISO_POS_DEFAULT[k][1]; });
  try { localStorage.removeItem(PIN_POS_KEY); } catch (e) {}
  TATA_LETAK.pin = {};
  tataLetakBawaan.pin = true;          /* kosong di server = ikut letak bawaan di kode */
  kirimTataLetak();
  buildIsoMap(); updateIsoLabels(); updateIsoWaterColors(); layoutIsoLabels(true);
}

/* koordinat layar -> koordinat viewBox (memperhitungkan zoom CSS & preserveAspectRatio meet) */
function isoClientToVB(cx, cy) {
  const svg = el('isoSvg'), r = svg.getBoundingClientRect();
  const f = Math.min(r.width / 1300, r.height / 731);
  return { x: (cx - (r.left + (r.width - 1300 * f) / 2)) / f, y: (cy - (r.top + (r.height - 731 * f) / 2)) / f };
}

/* Penataan label saat pin digeser, dibatasi satu kali per bingkai.
 *
 * pointermove bisa tiba beberapa kali dalam satu bingkai — pada tetikus bergerak
 * cepat atau layar sentuh 120 Hz, menata ulang tiap peristiwa berarti mengerjakan
 * pekerjaan yang hasilnya langsung ditimpa sebelum sempat tergambar. Dengan
 * requestAnimationFrame, berapa pun peristiwa yang masuk, penataannya jalan sekali
 * tepat sebelum bingkai berikutnya digambar. */
let lblRaf = 0;
function tataLabelTertunda() {
  if (lblRaf) return;
  lblRaf = requestAnimationFrame(() => { lblRaf = 0; layoutIsoLabels(true); });
}

function initPinDrag() {
  const svg = el('isoSvg');
  svg.addEventListener('pointerdown', (e) => {
    if (!pinEdit) return;
    const g = e.target.closest('.iso-pin');
    if (!g) return;
    e.stopPropagation(); e.preventDefault();
    const id = g.dataset.pin, p = isoClientToVB(e.clientX, e.clientY);
    pinDrag = { id, g, dx: ISO_POS[id][0] - p.x, dy: ISO_POS[id][1] - p.y, moved: false };
    g.classList.add('dragging');
  });
  window.addEventListener('pointermove', (e) => {
    if (!pinDrag) return;
    const p = isoClientToVB(e.clientX, e.clientY);
    const x = clamp(p.x + pinDrag.dx, 8, 1292), y = clamp(p.y + pinDrag.dy, 8, 723);
    ISO_POS[pinDrag.id][0] = x; ISO_POS[pinDrag.id][1] = y;
    pinDrag.g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    pinDrag.moved = true;
    tataLabelTertunda();
  });
  window.addEventListener('pointerup', () => {
    if (!pinDrag) return;
    pinDrag.g.classList.remove('dragging');
    if (pinDrag.moved) { savePinPos(); tataLabelTertunda(); }
    pinDrag = null;
  });
}

function setPinEdit(on) {
  pinEdit = on;
  if (on && petakEdit) setPetakEdit(false);
  const scroll = el('isoScroll'), wrap = el('isoMapPanel'), btn = el('mapEditPins');
  scroll.classList.toggle('pin-edit', on);
  wrap.classList.toggle('pin-edit-on', on);
  btn.classList.toggle('on', on);
  tampilTombolSalin();
  if (on) { closePosPop(); tutupPetakTip(); }
}

function copyPinCoords() {
  const txt = Object.keys(ISO_POS).map(k =>
    `  ${k}: [${Math.round(ISO_POS[k][0])}, ${Math.round(ISO_POS[k][1])}],`).join('\n');
  salinKeClipboard('const ISO_POS = {\n' + txt + '\n};', el('mapPinsCopy'));
}

/* =========================================================================
   PETAK SAWAH DI PETA ISOMETRIK
   -------------------------------------------------------------------------
   Ilustrasi isometriknya raster, jadi petak sawahnya cuma gambar — tidak ada
   yang bisa disorot atau diklik. Blok ini menaruh POLIGON tak terlihat di atas
   petaknya, pada lapisan SVG yang sama dengan pin pos (#isoSvg, viewBox
   1300x731). Menyorotnya memunculkan bacaan petak itu: luas, TMA saluran
   tersier yang mengairinya, arus, dan debit terhadap kebutuhannya.

   Poligon, bukan persegi: petak pada gambar isometrik berbentuk jajaran genjang
   miring, dan persegi pembungkusnya selalu memakan jalan, sungai, atau rumpun
   pohon di sebelahnya — bacaan muncul saat kursor jelas-jelas tidak di sawah.

   Digambar SEBELUM pin supaya pin tetap di atas: SVG tidak punya z-index,
   urutan simpul yang menentukan (lihat angkatPinKeDepan). Jadi pin tidak pernah
   terhalang poligon, dan klik pin tetap sampai ke pin.

   ANGKA DI BAWAH TAKSIRAN AWAL, dibaca dari ilustrasinya. Rapikan lewat tombol
   "▱ Petak" di peta — tarik titik sudutnya, klik di luar petak untuk menambah
   sudut, klik kanan pada sudut untuk membuangnya — lalu "⧉ Salin Koordinat"
   menuliskan blok pengganti untuk ditempel ke sini. Selama belum ditempel,
   hasil geseran tersimpan di localStorage peramban yang dipakai menggambar. */
const ISO_PETAK_DEFAULT = {
  ter0: [[274, 199], [332, 196], [340, 233], [278, 242]],
  ter1: [[222, 299], [302, 286], [318, 360], [232, 373]],
  ter2: [[350, 291], [437, 300], [430, 364], [330, 360]],
};
const ISO_PETAK = JSON.parse(JSON.stringify(ISO_PETAK_DEFAULT));
const PETAK_POS_KEY = 'wmsIsoPetak';
let petakEdit = false, petakAktif = 'ter0', petakDrag = null;
/* Petak yang bacaannya sedang tampil, atau null kalau tidak ada. Dibuka dan
   ditutup dengan klik — lihat penyimak 'click' di initPetakSawah(). */
let petakTip = null;

const petakIndex = (id) => Math.max(0, Math.min(2, parseInt(String(id).slice(3), 10) || 0));

/* Sama seperti letak pin: server yang menentukan, localStorage cadangan.
   Lihat blok TATA LETAK PETA di atas. */
function loadPetakPos() {
  const server = tataLetakServer('petak');
  const s = Object.keys(server).length ? server : bacaLokal(PETAK_POS_KEY);
  Object.keys(s).forEach(k => {
    if (ISO_PETAK[k] && Array.isArray(s[k]) && s[k].length >= 3) {
      ISO_PETAK[k] = s[k].map(p => [+p[0], +p[1]]);
    }
  });
}
function savePetakPos() {
  const o = {};
  Object.keys(ISO_PETAK).forEach(k => { o[k] = ISO_PETAK[k].map(p => [Math.round(p[0]), Math.round(p[1])]); });
  tulisLokal(PETAK_POS_KEY, o);
  /* Sama seperti savePinPos: menambah atau menggeser sudut langsung memanggil
     buildIsoMap(), yang membaca ulang lewat loadPetakPos(). Tanpa baris ini sudut
     yang baru ditambahkan hilang seketika, tertimpa bentuk lama dari server. */
  TATA_LETAK.petak = o;
  tataLetakBawaan.petak = false;
  kirimTataLetak();
}
function resetPetakPos() {
  Object.keys(ISO_PETAK_DEFAULT).forEach(k => { ISO_PETAK[k] = ISO_PETAK_DEFAULT[k].map(p => p.slice()); });
  try { localStorage.removeItem(PETAK_POS_KEY); } catch (e) {}
  TATA_LETAK.petak = {};
  tataLetakBawaan.petak = true;        /* kosong di server = ikut batas bawaan di kode */
  kirimTataLetak();
  buildIsoMap(); updateIsoLabels(); updateIsoWaterColors(); layoutIsoLabels(true);
}
function copyPetakCoords() {
  const txt = Object.keys(ISO_PETAK).map(k =>
    '  ' + k + ': [' + ISO_PETAK[k].map(p => '[' + Math.round(p[0]) + ', ' + Math.round(p[1]) + ']').join(', ') + '],').join('\n');
  salinKeClipboard('const ISO_PETAK_DEFAULT = {\n' + txt + '\n};', el('mapPinsCopy'));
}

/* Penyalin bersama koordinat pin & petak: satu tombol yang sama dipakai kedua
   mode, jadi umpan balik "✓ Tersalin"-nya juga satu tempat. */
function salinKeClipboard(teks, btn) {
  const old = btn ? btn.textContent : '';
  const done = () => { if (!btn) return; btn.textContent = '✓ Tersalin'; setTimeout(() => { btn.textContent = old; }, 1400); };
  if (navigator.clipboard) navigator.clipboard.writeText(teks).then(done, () => { console.log(teks); done(); });
  else { console.log(teks); done(); }
}

/* Titik tengah petak = titik berat poligonnya (rumus shoelace), bukan titik
   tengah kotak pembungkusnya. Pada petak berbentuk L atau yang satu sudutnya
   menjorok jauh, titik tengah kotak pembungkus bisa jatuh di LUAR petaknya —
   labelnya lalu tertulis di jalan atau di petak sebelah. Poligon yang luasnya
   nol (semua sudut segaris, bisa terjadi saat digambar) tidak punya titik berat,
   jadi di situ saja kotak pembungkusnya dipakai. */
function titikTengahPetak(pts) {
  let a2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a2 += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a2) < 1e-6) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [cx / (3 * a2), cy / (3 * a2)];
}

/* Markup satu petak. Titik sudutnya hanya digambar saat mode gambar menyala.
   Tulisan di tengah petak dan garis tepinya baru terlihat kalau label peta
   dinyalakan — kelas .labels-on pada <svg>, tombol yang sama yang menyalakan
   label pin (lihat wms.css). Di luar itu poligonnya tak terlihat sampai
   disorot, supaya ilustrasinya tidak terbaca seperti denah kavling. */
function petakMarkup(id) {
  const pts = ISO_PETAK[id].map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const i = petakIndex(id);
  const nama = (state.areas[i] || {}).name || String(i + 1);
  const aktif = petakEdit && id === petakAktif ? ' aktif' : '';
  const [cx, cy] = titikTengahPetak(ISO_PETAK[id]);
  let sudut = '';
  if (petakEdit) {
    sudut = ISO_PETAK[id].map((p, k) =>
      `<circle class="petak-vtx" data-petak="${id}" data-idx="${k}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.5"/>`).join('');
  }
  return `<g class="iso-petak${aktif}" data-petak="${id}">`
    + `<polygon class="petak-area" points="${pts}"><title>Petak ${nama}</title></polygon>`
    + `<text class="petak-label" id="petakLabel_${id}" x="${cx.toFixed(1)}" y="${(cy - 2).toFixed(1)}"></text>`
    + `<text class="petak-label petak-label--2" id="petakLabel2_${id}" x="${cx.toFixed(1)}" y="${(cy + 10).toFixed(1)}"></text>`
    + sudut + '</g>';
}

/* Warna petak = status pemenuhan airnya, kelas yang sama dengan kartu petak di
   bawah peta dan kotak bacaannya: irrigationStatus(). Petak yang kekurangan air
   karena itu terbaca dari petanya sendiri, tanpa harus diklik satu per satu.
   Warnanya warna lambang status (sama dengan pil di kotak bacaan), BUKAN
   FIELD_STATUS_COLOR yang dipakai skematik: yang itu pastel, dipilih untuk garis
   tipis di atas latar putih skematik, dan di atas ilustrasi sawah yang sudah
   hijau bercorak ia nyaris tidak terlihat. Yang disamakan klasifikasinya, bukan
   nilai warnanya — itu yang membuat peta dan kartu tidak pernah berbeda status. */
const PETAK_WARNA = {
  ideal:  { garis: '#12793a', isi: 'rgba(18,121,58,.14)',  kuat: 'rgba(18,121,58,.28)' },
  cukup:  { garis: '#96650a', isi: 'rgba(150,101,10,.14)', kuat: 'rgba(150,101,10,.28)' },
  kurang: { garis: '#a81d13', isi: 'rgba(168,29,19,.15)',  kuat: 'rgba(168,29,19,.30)' },
  lebih:  { garis: '#1f4fa6', isi: 'rgba(31,79,166,.14)',  kuat: 'rgba(31,79,166,.28)' },
};
function updatePetakWarna() {
  Object.keys(ISO_PETAK).forEach(id => {
    const g = document.querySelector(`.iso-petak[data-petak="${id}"]`);
    if (!g) return;
    const i = petakIndex(id);
    const a = state.areas[i] || { ha: 0 };
    const st = irrigationStatus(state.Qfield[i] || 0, (state.duty * a.ha) / 1000);
    const w = PETAK_WARNA[st.cls] || PETAK_WARNA.ideal;
    g.style.setProperty('--petak-garis', w.garis);
    g.style.setProperty('--petak-isi', w.isi);
    g.style.setProperty('--petak-isi-kuat', w.kuat);
    g.dataset.status = st.cls;
  });
}

/* Isi tulisan petak, disegarkan tiap tick bersama label pin.
   Dilewati kalau label sedang mati: tulisannya tidak terlihat, dan menulis ulang
   enam simpul teks empat kali sedetik untuk yang tidak terlihat itu sia-sia. */
function updatePetakLabels() {
  const svg = el('isoSvg');
  if (!svg || !svg.classList.contains('labels-on')) return;
  Object.keys(ISO_PETAK).forEach(id => {
    const i = petakIndex(id);
    const a = state.areas[i] || { name: String(i + 1), ha: 0 };
    const req = (state.duty * a.ha) / 1000;
    const q = state.Qfield[i] || 0;
    const pers = req > 0.0001 ? (q / req) * 100 : 100;
    const t1 = document.getElementById('petakLabel_' + id);
    const t2 = document.getElementById('petakLabel2_' + id);
    if (t1) t1.textContent = 'Petak ' + a.name;
    if (t2) t2.textContent = (+a.ha || 0).toFixed(0) + ' ha · ' + pers.toFixed(0) + '%';
  });
}

/* ---- bacaan yang muncul saat petak disorot ---- */
/* Angkanya diambil dari sumber yang SAMA dengan kartu petak di bawah peta dan
   dengan skematik — termasuk irrigationStatus(). Kalau bacaannya dihitung
   sendiri di sini, satu petak bisa terbaca "Kurang" di peta tapi "Cukup" di
   kartunya, dan tidak ada cara menebak mana yang benar. */
function petakTipIsi(id) {
  const i = petakIndex(id);
  const a = state.areas[i] || { name: String(i + 1), ha: 0 };
  const req = (state.duty * a.ha) / 1000;
  const q = state.Qfield[i] || 0;
  const st = irrigationStatus(q, req);
  const pers = req > 0.0001 ? (q / req) * 100 : 100;
  const baris = (label, nilai) => `<div class="petak-tip-baris"><span>${label}</span><b>${nilai}</b></div>`;
  return `<div class="petak-tip-kepala">Petak ${a.name}<span class="petak-tip-status ${st.cls}">${st.label}</span></div>`
    + baris('Luas', (+a.ha || 0).toFixed(0) + ' ha')
    + baris('TMA saluran', state.tertiary[i].canal.h.toFixed(2) + ' m')
    + baris('Arus', (state.vTert[i] || 0).toFixed(2) + ' m/dtk')
    + baris('Debit', q.toFixed(3) + ' / ' + req.toFixed(3) + ' m³/dtk')
    + baris('Terpenuhi', pers.toFixed(0) + '%');
}

/* Letak kotak bacaan dihitung terhadap .map-wrap, BUKAN terhadap panggung peta:
   panggungnya ikut diperbesar transform zoom, jadi apa pun yang ditaruh di
   dalamnya ikut membesar-mengecil. Kotak bacaan harus tetap seukuran tulisan
   antarmuka pada tingkat zoom berapa pun. */
function petakTipLetak(cx, cy) {
  const tip = el('petakTip'), wrap = el('isoMapPanel');
  if (!tip || !wrap) return;
  const r = wrap.getBoundingClientRect();
  const w = tip.offsetWidth || 190, h = tip.offsetHeight || 130;
  let x = cx - r.left + 16, y = cy - r.top + 16;
  if (x + w > r.width - 8) x = cx - r.left - w - 16;
  if (y + h > r.height - 8) y = cy - r.top - h - 16;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
function bukaPetakTip(id, cx, cy) {
  const tip = el('petakTip');
  if (!tip) return;
  petakTip = { id };
  tip.innerHTML = petakTipIsi(id);
  tip.classList.add('on');
  petakTipLetak(cx, cy);
  tandaiPetakTerbuka(id);
}
function tutupPetakTip() {
  petakTip = null;
  const tip = el('petakTip');
  if (tip) tip.classList.remove('on');
  tandaiPetakTerbuka(null);
}
/* Petak yang bacaannya sedang terbuka diberi warna: tanpa itu, kotak bacaan yang
   melayang di dekat kursor tidak menunjuk petak mana pun — di tiga petak yang
   berdempetan, yang mana yang sedang dibaca jadi tebakan. */
function tandaiPetakTerbuka(id) {
  document.querySelectorAll('.iso-petak').forEach(g => {
    g.classList.toggle('terbuka', !!id && g.dataset.petak === id);
  });
}
/* Dipanggil tiap render(): angkanya berjalan terus selama simulasi jalan, jadi
   bacaan yang sedang terbuka ikut diperbarui — bukan beku pada saat dibuka. */
function updatePetakTip() {
  if (!petakTip) return;
  const tip = el('petakTip');
  if (tip) tip.innerHTML = petakTipIsi(petakTip.id);
}

/* ---- mode gambar petak ---- */
function setPetakEdit(on) {
  petakEdit = on;
  if (on && pinEdit) setPinEdit(false);        /* dua mode ubah tidak menyala bersamaan */
  const scroll = el('isoScroll'), wrap = el('isoMapPanel'), btn = el('mapPetakEdit');
  scroll.classList.toggle('petak-edit', on);
  wrap.classList.toggle('petak-edit-on', on);
  btn.classList.toggle('on', on);
  tampilTombolSalin();
  if (on) tutupPetakTip();
  petakHintTeks();
  buildIsoMap(); updateIsoLabels(); updateIsoWaterColors(); layoutIsoLabels(true);
}
/* Tombol "Posisi Awal" & "Salin Koordinat" dipakai bersama oleh kedua mode
   ubah: yang menyala saat itu yang menentukan sasarannya. Lebih baik daripada
   dua pasang tombol yang menumpuk di sudut peta yang sudah penuh. */
function tampilTombolSalin() {
  const ada = pinEdit || petakEdit;
  el('mapPinsReset').style.display = ada ? '' : 'none';
  el('mapPinsCopy').style.display = ada ? '' : 'none';
}
function petakHintTeks() {
  const h = el('petakEditHint');
  if (!h) return;
  const i = petakIndex(petakAktif);
  const nama = (state.areas[i] || {}).name || (i + 1);
  h.textContent = 'Mode gambar petak — petak aktif: ' + nama
    + '. Tarik titik sudut untuk memindahkannya, klik petak lain untuk memilihnya, '
    + 'klik di luar petak untuk menambah sudut, klik kanan pada sudut untuk membuangnya.';
}

/* Sudut baru disisipkan pada RUAS TERDEKAT, bukan ditempel di ujung daftar.
   Kalau ditempel di ujung, menambah satu titik di dekat sisi kiri akan menarik
   garis melintasi seluruh petak — bentuknya jadi kacau dan harus disusun ulang
   dari awal. */
function sisipSudut(id, x, y) {
  const p = ISO_PETAK[id];
  let best = 0, bestD = Infinity;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / L2, 0, 1);
    const dx = a[0] + t * vx - x, dy = a[1] + t * vy - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  }
  p.splice(best + 1, 0, [x, y]);
  savePetakPos();
}

function initPetakSawah() {
  const svg = el('isoSvg');
  if (!svg) return;
  let turunX = 0, turunY = 0;

  svg.addEventListener('pointerdown', (e) => {
    turunX = e.clientX; turunY = e.clientY;
    if (!petakEdit) return;
    const v = e.target.closest ? e.target.closest('.petak-vtx') : null;
    if (!v) return;
    e.stopPropagation(); e.preventDefault();
    petakDrag = { id: v.dataset.petak, idx: +v.dataset.idx, el: v, moved: false };
    petakAktif = petakDrag.id;
    petakHintTeks();
  });

  window.addEventListener('pointermove', (e) => {
    if (!petakDrag) return;
    const p = isoClientToVB(e.clientX, e.clientY);
    const x = clamp(p.x, 2, 1298), y = clamp(p.y, 2, 729);
    ISO_PETAK[petakDrag.id][petakDrag.idx] = [x, y];
    petakDrag.el.setAttribute('cx', x.toFixed(1));
    petakDrag.el.setAttribute('cy', y.toFixed(1));
    const poly = petakDrag.el.parentNode.querySelector('.petak-area');
    if (poly) poly.setAttribute('points', ISO_PETAK[petakDrag.id].map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' '));
    const [lx, ly] = titikTengahPetak(ISO_PETAK[petakDrag.id]);
    const t1 = document.getElementById('petakLabel_' + petakDrag.id);
    const t2 = document.getElementById('petakLabel2_' + petakDrag.id);
    if (t1) { t1.setAttribute('x', lx.toFixed(1)); t1.setAttribute('y', (ly - 2).toFixed(1)); }
    if (t2) { t2.setAttribute('x', lx.toFixed(1)); t2.setAttribute('y', (ly + 10).toFixed(1)); }
    petakDrag.moved = true;
  });

  window.addEventListener('pointerup', () => {
    if (!petakDrag) return;
    if (petakDrag.moved) savePetakPos();
    petakDrag = null;
  });

  /* BACAAN DIBUKA DENGAN KLIK, BUKAN DENGAN SOROT.
     Mula-mula ia terbuka begitu kursor menyentuh poligonnya. Itu salah untuk peta
     ini: batas poligonnya digambar dengan tangan di atas ilustrasi raster, jadi
     tepinya tidak pernah persis batas petak yang tergambar — kursor yang masih di
     jalan atau di rumpun pohon di sebelahnya sudah memunculkan bacaan petak, dan
     kotaknya melintas-lintas sendiri tiap kali kursor menyeberangi peta. Dengan
     klik, bacaan hanya muncul kalau memang diminta, dan tepian poligon yang
     kurang rapi tidak lagi terasa. Sekalian, satu perilaku yang sama untuk tetikus
     dan layar sentuh — layar sentuh tidak mengenal sorot sama sekali.

     Klik yang datang sesudah kursor bergeser jauh diabaikan: itu tarikan geser
     peta yang kebetulan berakhir di atas petak, bukan klik pada petaknya. */
  svg.addEventListener('click', (e) => {
    if (Math.abs(e.clientX - turunX) + Math.abs(e.clientY - turunY) > 5) return;
    const g = e.target.closest ? e.target.closest('.iso-petak') : null;
    if (!petakEdit) {
      if (e.target.closest && e.target.closest('.iso-pin')) return;
      if (!g) { tutupPetakTip(); return; }          /* klik di luar petak menutupnya */
      if (petakTip && petakTip.id === g.dataset.petak) tutupPetakTip();
      else bukaPetakTip(g.dataset.petak, e.clientX, e.clientY);
      return;
    }
    if (e.target.closest && e.target.closest('.petak-vtx')) return;
    if (g && g.dataset.petak !== petakAktif) {          /* pilih petak lain */
      petakAktif = g.dataset.petak;
      petakHintTeks();
      buildIsoMap(); updateIsoLabels(); layoutIsoLabels(true);
      return;
    }
    const p = isoClientToVB(e.clientX, e.clientY);
    sisipSudut(petakAktif, clamp(p.x, 2, 1298), clamp(p.y, 2, 729));
    buildIsoMap(); updateIsoLabels(); layoutIsoLabels(true);
  });

  /* Klik kanan pada sudut membuangnya. Tiga sudut batas bawahnya — di bawah itu
     poligonnya bukan bidang lagi, cuma garis. */
  svg.addEventListener('contextmenu', (e) => {
    if (!petakEdit) return;
    const v = e.target.closest ? e.target.closest('.petak-vtx') : null;
    if (!v) return;
    e.preventDefault();
    const id = v.dataset.petak;
    if (ISO_PETAK[id].length <= 3) return;
    ISO_PETAK[id].splice(+v.dataset.idx, 1);
    savePetakPos();
    buildIsoMap(); updateIsoLabels(); layoutIsoLabels(true);
  });
}

function buildIsoMap() {
  const svg = el('isoSvg');
  loadPinPos();
  loadPetakPos();
  /* Petak digambar lebih dulu supaya seluruh pin berada di atasnya. */
  let out = Object.keys(ISO_PETAK).map(petakMarkup).join('');
  Object.keys(ISO_POS).forEach(id => {
    const [x, y, icon, tip, up] = ISO_POS[id];
    out += pinMarkerXY(id, x, y, icon, tip, 62, up || y < 140);
  });
  svg.innerHTML = out;
  angkatPinKeDepan(svg);
  updatePetakWarna();
}

/* Pin yang disorot digambar paling akhir, jadi labelnya di atas label tetangganya.
 *
 * SVG tidak punya z-index: urutan gambar = urutan simpul di DOM, titik. Jadi
 * "angkat ke depan" berarti benar-benar memindahkan <g>-nya ke ujung induknya.
 * Tanpa ini, di kerumunan enam pin jaringan irigasi label yang tergambar lebih dulu
 * selalu tertutup label sesudahnya, dan tidak ada cara apa pun untuk membacanya —
 * penataan letak sudah mengurangi tumpangnya, tetapi pada peta sesempit ini tidak
 * selalu ada tempat yang benar-benar bebas.
 *
 * Dipasang di induknya (delegasi), bukan pada tiap pin: buildIsoMap() menulis ulang
 * seluruh isi svg tiap kali dipanggil, dan penyimak yang dipasang pada tiap <g> akan
 * lenyap bersamanya. */
function angkatPinKeDepan(svg) {
  if (!svg || svg.dataset.angkat === '1') return;
  svg.dataset.angkat = '1';
  svg.addEventListener('pointerover', (e) => {
    const g = e.target.closest ? e.target.closest('.iso-pin') : null;
    /* Saat mode geser pin aktif, urutan tidak diubah: memindahkan simpul di tengah
       tarikan memutus rangkaian pointer event-nya. */
    if (!g || pinEdit || g === svg.lastElementChild) return;
    svg.appendChild(g);
  });
}

const LEVEL_DOT = { kering: '#8a7442', normal: '#1f4fa6', waspada: '#c9971a', siaga: '#d4761c', bahaya: '#c0392b' };

/* Warna cincin pin = status pos, terlihat tanpa harus menyalakan label.
 *
 * Ditulis ke peubah CSS `--pin-ring`, BUKAN ke `style.fill`. Dulu `style.fill`:
 * gaya sebaris itu mengalahkan seluruh stylesheet, jadi
 * `.iso-pin:hover circle.pin-ring{fill:#2b6cb0}` di wms.css tidak pernah berlaku —
 * dan karena fungsi ini dipanggil tiap tick render(), warnanya ditulis ulang ±4
 * kali sedetik sehingga tidak ada celah bagi hover untuk menang. Umpan balik
 * sorot kursor pada seluruh pin mati sejak pewarnaan ini dipasang. Dengan peubah
 * CSS, `fill` tetap milik stylesheet dan aturan :hover-nya (kekhususan 0,3,1)
 * menang melawan aturan dasarnya (0,2,1).
 *
 * posToLokasi() tetap memakai `style.fill` sebaris — kedipan 1,2 detik itu memang
 * harus mengalahkan hover, dan ia menghapusnya sendiri sesudahnya. */
function updateIsoWaterColors() {
  const ring = (id, color) => {
    const e = document.querySelector(`.iso-pin[data-pin="${id}"] .pin-ring`);
    if (e && posOpen !== id) e.style.setProperty('--pin-ring', color);
  };
  const lvl = (s) => LEVEL_DOT[s] || LEVEL_DOT.normal;

  /* Kelas tiap pos dari DEBIT terhadap kapasitas bangunannya sendiri — dasar yang
     sama dengan warna air di peta dan dengan skematik. Lihat waterParams(). */
  const T = state.thresholds, N = state.dummyNodes || {};
  const kap = (id) => (N[id] || {}).kapasitas || 0;

  ring('hulu', lvl(debitStatus(state.Qnat, kap('WEIR_COPONG'))));

  /* Pin primer & kolam sama-sama membaca kolam bendung: debitnya yang masuk lewat
     pintu primer, muka airnya TMA kolam. */
  /* Pin kolam DAN pin sekunder memakai kelas yang sama dengan airnya di peta —
     satu kelas untuk satu badan air. Lihat alasannya di waterParams(); pin dan
     airnya harus bercerita sama. */
  const sJaringanPin = LEVEL_URUT[Math.max(
    LEVEL_URUT.indexOf(debitStatus(state.QgateTotal, kap('AWLR_KOLAM'))),
    LEVEL_URUT.indexOf(debitStatus(state.QsecTotal, kap('AWLR_SEKUNDER'))))];
  const poolSt = lvl(sJaringanPin);
  ring('primer', poolSt); ring('kolam', poolSt);

  /* Pin hilir dapat kelasnya SENDIRI, tidak lagi ikut kolam. Yang diukur pos itu
     debit sungai yang keluar dari bendung — 103,87 m³/dtk saat banjir terhadap
     kapasitas 35 — dan itulah satu-satunya tempat keadaan banjir di sisi sungai
     benar-benar terbaca. Ikut kolam membuatnya melaporkan 0,56 m³/dtk yang lewat
     pintu scouring, bukan 103,87 yang lewat di depannya. */
  ring('hilir', lvl(debitStatus(state.Qhilir, kap('AWLR_HILIR'))));

  /* satu pin sekunder = satu saluran sekunder yang disuplai tiga pintu.
     Pos AWGC (pintu) dan pos AWLR (muka air) berdiri di RUAS YANG SAMA, jadi
     kelasnya pun sama — yang beda cuma apa yang dibacanya. */
  /* Sekunder memakai kelas gabungan yang sama dengan kolam — lihat sJaringanPin. */
  const sekSt = lvl(sJaringanPin);
  ring('sek', sekSt); ring('awlrSek', sekSt);

  /* Pin tersier memakai levelStatus() — besaran yang SAMA dengan lima pin di atas.
   *
   * Dulu ia memakai FIELD_STATUS_COLOR[irrigationStatus(...)], yaitu pemenuhan debit
   * petak. Dua hal salah dengan itu:
   *
   *   1. Satu saluran visual, dua besaran. Cincin pin hulu/primer/kolam/hilir/sekunder
   *      berarti "TMA terhadap tinggi tanggul"; cincin pin tersier berarti "debit
   *      terhadap kebutuhan petak". Tidak ada apa pun pada gambarnya yang menyatakan
   *      artinya beda.
   *   2. Bobot paletnya beda kelas. LEVEL_DOT palet siaga yang pekat (luminans
   *      0,086-0,346); FIELD_STATUS_COLOR pastel pucat (0,481-0,678) yang memang
   *      dirancang untuk BIDANG besar — stroke kotak petak 140x60 di skematik dan
   *      kartu di bawah peta. Sebagai cakram r=15 di sebelah warna pekat, dan di
   *      dalam garis navy tetap #132f63, pin tersier terbaca 5,6x lebih terang
   *      daripada tetangganya: kontrasnya terhadap garis 6,63 lawan 1,69. Terlihat
   *      seperti pin nonaktif, bukan seperti "ideal".
   *
   * Ditambah lagi warnanya tidak pernah bergerak: pintu AUTO mengunci debit petak ke
   * kebutuhannya, jadi ketiga petak berstatus Ideal di normal, banjir, MAUPUN kemarau —
   * bahkan pada bukaan acuan 75% sebelum satu tick kendali pun jalan (99,8% kebutuhan).
   *
   * Ukuran TMA baru layak dipakai di sini sejak tert.canal.Hmax dibetulkan 1,20 →
   * 0,30 m: rasionya 27%/43%/69% untuk kemarau/normal/banjir, jadi pinnya benar-benar
   * berpindah warna. Status pemenuhan petak tetap terbaca di kartu petak dan kotak
   * sawah skematik — tempat pastel itu memang bekerja. */
  for (let i = 0; i < 3; i++) {
    /* Dari DEBIT saja, sedasar dengan ruas lain di peta & dengan skematik. */
    const st = lvl(debitStatus(state.Qfield[i], kap('AWLR_TERSIER_' + (i + 1))));
    ring('ter' + i, st); ring('awlrTer' + i, st);
  }
}

function updateIsoLeaves() {}


function updateIsoLabels() {
  const set = (id, txt) => { const e = document.getElementById('pinLabel_' + id); if (e) e.textContent = txt; };
  /* Baris kedua. Pos yang cuma berbaris satu tidak memanggilnya, jadi tulisannya
     tetap kosong — dan layoutIsoLabels() memakai kosong-tidaknya itu untuk memilih
     tinggi kotaknya. */
  const set2 = (id, txt) => { const e = document.getElementById('pinLabel2_' + id); if (e) e.textContent = txt; };
  /* Label pos AWLR seragam: TMA lalu DEBIT yang lewat di depannya.
   *
   * Dulu tiap pos AWLR menulis medan yang berlainan — hulu TMA+Q, kolam cuma TMA,
   * hilir cuma Q, pos saluran TMA+arus — sehingga tidak ada satu pun pasangan pos
   * yang bisa dibandingkan langsung dari labelnya. Dengan format yang sama, membaca
   * peta jadi menyusuri satu pasang angka dari hulu ke petak.
   *
   * Arusnya tetap terbaca di kartu pos (klik pinnya) dan di grafik Kecepatan Arus di
   * tab Tren. Kotak label cuma 112 unit — tiga besaran di dalamnya membuat angkanya
   * terpotong sebelum sempat dibaca. */
  const bacaan = (h, q, dq) => `TMA ${h.toFixed(2)}m · Q ${q.toFixed(dq)}`;
  set('hulu', bacaan(state.hUp, state.Qnat, 1));
  set('kolam', bacaan(state.pool.h, state.QgateTotal, 2));
  set('hilir', bacaan(state.pool.h, state.Qhilir, 1));
  set('awlrSek', bacaan(state.secondary.canal.h, state.QsecTotal, 3));

  /* Pos PINTU: DUA baris. Baris atas bukaannya — satu-satunya besaran yang cuma milik
   * pos pintu, dan satu-satunya yang bisa dikerjakan operator dari situ. Baris bawah
   * TMA & debitnya, format sama dengan pos AWLR.
   *
   * Dua baris, bukan satu baris panjang: "Bukaan 75/94/56 cm · TMA 1.36m · Q 0.360"
   * terukur ±228 unit — seperenam lebar kanvas — dan kotak selebar itu mustahil
   * ditempatkan tanpa menutupi sesuatu di kerumunan enam pin jaringan irigasi. Dua
   * baris memuat isi yang sama dalam ±130 unit.
   *
   * TMA yang ditulis adalah muka air di HULU pintunya, bukan di hilirnya: itu tinggi
   * tekan yang menentukan debit lewat bawah daun pintu, jadi itu yang berpasangan
   * dengan angka bukaan di atasnya. Nilainya pun berbeda dari pos AWLR di sebelahnya,
   * yang membaca ruas di HILIR pintu — jadi kedua label tidak saling menyalin.
   *
   * Nama bangunannya tidak diulang di label: sudah ada di tooltip pin dan di kepala
   * kartu pos. */
  const m2 = (a) => (a * 100).toFixed(0);
  /* Debit lewat pintu primer = yang masuk kolam DITAMBAH yang dilimpaskan floodway.
     Dulu labelnya cuma menulis "Q masuk 0,6" — 0,56 dari 28,17 m³/dtk yang benar-benar
     lewat bangunan itu, jadi pos yang mengurus banjir melaporkan angka terkecil di
     seluruh peta. Limpasan di atas ambang (Qspill) TIDAK dihitung: ia tidak lewat pintu. */
  set('primer', `Bukaan ${state.primary.map(p => m2(p.ctrl.a)).join('/')} cm`);
  set2('primer', bacaan(state.hUp, state.QgateTotal + (state.Qflood || 0), 1));

  set('sek', `Bukaan ${state.secondary.gates.map(g => m2(g.ctrl.a)).join('/')} cm`);
  set2('sek', bacaan(state.pool.h, state.QsecTotal, 3));

  for (let i = 0; i < 3; i++) {
    set('ter' + i, `Bukaan ${m2(state.tertiary[i].gate.ctrl.a)} cm`);
    set2('ter' + i, bacaan(state.secondary.canal.h, state.Qfield[i], 3));
    set('awlrTer' + i, bacaan(state.tertiary[i].canal.h, state.Qfield[i], 3));
  }
  /* Ditata ulang hanya kalau panjang salah satu tulisan berubah — lihat lblSidik. */
  layoutIsoLabels();
}

let posOpen = null;

/* Data yang ditampilkan kartu pos untuk tiap titik telemetri. */
function posData(id) {
  const cm = (m) => (m * 100).toFixed(0) + ' cm';
  if (id === 'primer') {
    return {
      title: 'Pos AWGC Pintu Bendung',
      tiles: state.primary.map((p) => ({ v: cm(p.ctrl.a), l: p.name })),
    };
  }
  if (id === 'hulu') {
    return {
      title: 'Pos AWLR Hulu',
      tiles: [
        { v: state.hUp.toFixed(2) + ' m', l: 'Tinggi muka air' },
        { v: state.vUp.toFixed(2) + ' m/s', l: 'Arus' },
        { v: state.Qnat.toFixed(1), l: 'Debit alami m³/dtk' },
      ],
    };
  }
  if (id === 'kolam') {
    return {
      title: 'Pos AWLR Kolam Bendung',
      tiles: [
        { v: state.pool.h.toFixed(2) + ' m', l: 'Tinggi muka air' },
        { v: state.vPool.toFixed(2) + ' m/s', l: 'Arus' },
        { v: state.QgateTotal.toFixed(1), l: 'Debit masuk m³/dtk' },
      ],
    };
  }
  if (id === 'hilir') {
    return {
      title: 'Pos AWLR Hilir',
      tiles: [
        { v: state.Qhilir.toFixed(1), l: 'Debit keluar m³/dtk' },
        { v: state.pool.h.toFixed(2) + ' m', l: 'Tinggi muka air' },
      ],
    };
  }
  if (id === 'sek') {
    return {
      title: 'Pos AWGC Pintu Pengambilan',
      tiles: state.secondary.gates.map(gt => ({ v: cm(gt.ctrl.a), l: gt.name }))
        .concat([{ v: state.secondary.canal.h.toFixed(2) + ' m', l: 'TMA saluran sekunder' }]),
    };
  }
  /* Pos AWLR saluran: yang dibaca muka air & arusnya, bukan bukaan pintunya.
     Debitnya ikut ditulis karena TMA sendirian tidak cukup untuk menilai ruas —
     kelas warnanya memang dinilai dari keduanya (lihat reachStatus). */
  if (id === 'awlrSek') {
    return {
      title: 'Pos AWLR Saluran Sekunder',
      tiles: [
        { v: state.secondary.canal.h.toFixed(2) + ' m', l: 'Tinggi muka air' },
        { v: state.vSec.toFixed(2) + ' m/s', l: 'Arus' },
        { v: state.QsecTotal.toFixed(3), l: 'Debit lewat m³/dtk' },
        { v: state.secondary.canal.Hmax.toFixed(2) + ' m', l: 'Tinggi tanggul' },
      ],
    };
  }
  const mAwlrTer = /^awlrTer([0-2])$/.exec(id);
  if (mAwlrTer) {
    const j = +mAwlrTer[1], tt = state.tertiary[j];
    return {
      title: 'Pos AWLR Saluran Tersier ' + (j + 1) + ' — ' + state.areas[j].name,
      tiles: [
        { v: tt.canal.h.toFixed(2) + ' m', l: 'Tinggi muka air' },
        { v: state.vTert[j].toFixed(2) + ' m/s', l: 'Arus' },
        { v: state.Qfield[j].toFixed(3), l: 'Debit lewat m³/dtk' },
        { v: tt.canal.Hmax.toFixed(2) + ' m', l: 'Tinggi tanggul' },
      ],
    };
  }
  /* Pos pintu tersier. Pencocokannya KETAT: dulu baris ini jalur cadangan tanpa
     syarat (`+id.replace('ter','')`), jadi id apa pun yang tidak dikenali menghasilkan
     NaN, lalu state.tertiary[NaN] undefined, lalu galat pada .gate.name — pin baru
     mana pun akan menjatuhkan kartu posnya sampai cabangnya ditambahkan di sini. */
  const mTer = /^ter([0-2])$/.exec(id);
  if (mTer) {
    const i = +mTer[1], t = state.tertiary[i];
    return {
      title: 'Pos AWGC ' + t.gate.name,
      tiles: [
        { v: cm(t.gate.ctrl.a), l: 'Bukaan pintu' },
        { v: t.canal.h.toFixed(2) + ' m', l: 'Tinggi muka air' },
        { v: state.Qfield[i].toFixed(3), l: 'Ke sawah m³/dtk' },
        { v: t.gate.mode.toUpperCase(), l: 'Mode kendali' },
      ],
    };
  }
  return { title: 'Pos ' + id, tiles: [] };
}

function renderPosPop() {
  if (!posOpen) return;
  const d = posData(posOpen);
  el('posTitle').textContent = d.title;
  el('posTiles').innerHTML = d.tiles
    .map(t => `<div class="pos-tile"><b>${t.v}</b><span>${t.l}</span></div>`).join('');
  const now = new Date(), pad = (x) => String(x).padStart(2, '0');
  el('posTime').textContent = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
    ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
}

function onPinClick(id) {
  if (pinEdit) return;
  posOpen = id;
  const pop = el('posPop'), wrap = el('isoMapPanel');
  const pin = document.querySelector(`.iso-pin[data-pin="${id}"]`);
  if (!pop || !wrap || !pin) return;
  renderPosPop();
  pop.classList.add('on');
  const pr = pin.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  let left = pr.left - wr.left + pr.width / 2 - pop.offsetWidth / 2;
  let top = pr.top - wr.top - pop.offsetHeight - 14;
  if (top < 8) top = pr.bottom - wr.top + 14;
  pop.style.left = clamp(left, 8, wrap.clientWidth - pop.offsetWidth - 8) + 'px';
  pop.style.top = clamp(top, 8, wrap.clientHeight - pop.offsetHeight - 8) + 'px';
}

function closePosPop() {
  posOpen = null;
  const pop = el('posPop');
  if (pop) pop.classList.remove('on');
}

/* Analisa: lompat ke layar Kontrol Pintu dan sorot kartu pintu terkait. */
function posToKontrol() {
  const id = posOpen;
  closePosPop();
  activateView('kontrol', true);
  let targets = [];
  if (!id || id === 'hulu' || id === 'kolam' || id === 'hilir' || id === 'primer') targets = ['ctrlCardP0', 'ctrlCardP1', 'ctrlCardP2'];
  /* Pos AWLR saluran menyorot pintu YANG MENGATUR ruas itu — dicocokkan lebih dulu
     karena idnya tidak berawalan 'sek'/'ter' dan tanpa cabang ini tombol Analisa-nya
     tidak menyorot apa pun. Pos ukur tidak punya kartu kendali sendiri; yang bisa
     dikerjakan operator dari sana justru pintu di hulunya. */
  else if (id === 'awlrSek') targets = ['ctrlCardS0', 'ctrlCardS1', 'ctrlCardS2'];
  else if (/^awlrTer[0-2]$/.test(id)) targets = ['ctrlCardT' + id.slice(-1)];
  else if (id === 'sek') targets = ['ctrlCardS0', 'ctrlCardS1', 'ctrlCardS2'];
  else if (id.startsWith('sek')) targets = ['ctrlCardS' + id.replace('sek', '')];
  else if (id.startsWith('ter')) targets = ['ctrlCardT' + id.replace('ter', '')];
  targets.forEach((tid) => {
    const c = el(tid);
    if (!c) return;
    c.classList.remove('highlight-flash'); void c.offsetWidth; c.classList.add('highlight-flash');
  });
}

/* Lokasi: nyalakan label peta dan kedipkan pin terpilih. */
function posToLokasi() {
  const svg = el('isoSvg');
  if (svg) svg.classList.add('labels-on');
  const tog = el('mapLabelToggle');
  if (tog) tog.classList.add('on');
  layoutIsoLabels(true);
  const pin = document.querySelector(`.iso-pin[data-pin="${posOpen}"] .pin-ring`);
  if (!pin) return;
  pin.style.fill = '#f0a020';
  setTimeout(() => { pin.style.fill = ''; }, 1200);
}

/* ---- zoom & pan peta isometrik ---- */
/* Tampilan awal: sedekat mungkin ke jaringan pos telemetri tanpa memotongnya,
   dihitung dari panel sebenarnya sehingga ruang kosong ilustrasi tidak ikut tampil. */
const ISO_VB = { w: 1300, h: 731 };
const isoZoom = { scale: 1, tx: 0, ty: 0 };

function isoDefaultView() {
  const box = el('isoScroll');
  const pw = box ? box.clientWidth : 900, ph = box ? box.clientHeight : 560;
  const xs = Object.values(ISO_POS).map(p => p[0]), ys = Object.values(ISO_POS).map(p => p[1]);
  /* label pos digambar di kiri jangkarnya, jadi sisi kiri butuh margin lebih lebar */
  const padL = 130, padR = 60, padY = 56;
  const x0 = Math.min(...xs) - padL, x1 = Math.max(...xs) + padR;
  const y0 = Math.min(...ys) - padY, y1 = Math.max(...ys) + padY;

  const f = Math.min(pw / ISO_VB.w, ph / ISO_VB.h);          // svg dipasang meet
  const ox = (pw - ISO_VB.w * f) / 2, oy = (ph - ISO_VB.h * f) / 2;
  const fit = Math.min(pw / ((x1 - x0) * f), ph / ((y1 - y0) * f));
  const scale = clamp(Math.max(fit, isoCoverScale()), 1, 2.8);  const cx = ox + ((x0 + x1) / 2) * f, cy = oy + ((y0 + y1) / 2) * f;
  const v = { scale, tx: (pw / 2 - cx) * scale, ty: (ph / 2 - cy) * scale };
  clampIsoPan(v);
  return v;
}

/* Skala minimum: ilustrasi menutup penuh panel, jadi tidak pernah ada tepi kosong. */
function isoCoverScale() {
  const box = el('isoScroll');
  const pw = box ? box.clientWidth : 900, ph = box ? box.clientHeight : 560;
  const f = Math.min(pw / ISO_VB.w, ph / ISO_VB.h);
  return Math.max(pw / (ISO_VB.w * f), ph / (ISO_VB.h * f));
}

/* Geser dibatasi tepi ilustrasi. */
function clampIsoPan(v) {
  const box = el('isoScroll');
  if (!box) return v;
  const pw = box.clientWidth, ph = box.clientHeight, s = v.scale;
  const f = Math.min(pw / ISO_VB.w, ph / ISO_VB.h);
  const ox = (pw - ISO_VB.w * f) / 2, oy = (ph - ISO_VB.h * f) / 2;
  const lim = (o, len, size) => {
    const lo = size / 2 - (o + len - size / 2) * s;
    const hi = -size / 2 - (o - size / 2) * s;
    return lo > hi ? [(lo + hi) / 2, (lo + hi) / 2] : [lo, hi];
  };
  const [xlo, xhi] = lim(ox, ISO_VB.w * f, pw), [ylo, yhi] = lim(oy, ISO_VB.h * f, ph);
  v.tx = clamp(v.tx, xlo, xhi);
  v.ty = clamp(v.ty, ylo, yhi);
  return v;
}

function resetIsoView() {
  const box = el('isoScroll');
  if (!box || !box.clientWidth || !box.clientHeight) return;   // panel tersembunyi, lihat applyIsoZoom()
  Object.assign(isoZoom, isoDefaultView());
  applyIsoZoom();
}
function applyIsoZoom() {
  const stage = el('isoStage'), box = el('isoScroll');
  /* Panel bisa sedang tersembunyi karena tab Skematik yang aktif. Saat itu
     clientWidth = 0, sehingga isoCoverScale() menghasilkan Infinity dan state
     zoom jadi rusak. Lewati saja — initMapTabs() memanggil resetIsoView()
     begitu pane iso terlihat lagi. */
  if (!stage || !box || !box.clientWidth || !box.clientHeight) return;
  isoZoom.scale = clamp(isoZoom.scale, isoCoverScale(), 5);
  clampIsoPan(isoZoom);
  stage.style.transform = `translate(${isoZoom.tx}px, ${isoZoom.ty}px) scale(${isoZoom.scale})`;
}
/* =========================================================================
   AIR BERANIMASI — dua lapis:
     assets/aliran_sungai.png : bentuk badan air + arah aliran sungai
     assets/draft_skema.png   : draft bendung, berlubang tepat di badan air
   Mask yang dipakai = irisan keduanya. aliran_sungai.png satu jaringan
   menyambung, jadi kalau dipakai sendiri seluruh air jadi satu region dan
   kehilangan peran. Diiris dengan lubang draft, tiap petak air terpisah lagi
   di pintu, jembatan, dan tanggul sehingga bisa punya peran sendiri:
   warna = status TMA, kecepatan = arus.
   ========================================================================= */
/* Sungai mengalir dari selatan (bawah gambar) ke timur laut (pojok kanan atas):
   badan air di selatan bendung = HULU, badan air di timur laut = HILIR. */
const WATER_SEED = {   /* titik acuan dalam koordinat ternormalisasi gambar */
  hulu: [.760, .755], hilir: [.849, .262],
  kolam: [.633, .479], kolam2: [.624, .493], kolam3: [.660, .470],
  sek: [.260, .293], sek2: [.496, .445],
  /* Ruas sekunder di utara jembatan. Jembatan memotong mask, jadi ruas ini
     komponen tersendiri; tersier yang bercabang ke barat ada di ter1. */
  sekutara: [.189, .085],
  ter0: [.385, .126], ter1: [.102, .112], ter2: [.100, .498],
  /* mulut kecil di bawah jembatan yang menyambung kolam ke saluran pembilas.
     Tanpa acuan sendiri potongan ini ikut arah kolam (ke barat), padahal
     arusnya menyilang naik ke saluran di utara. */
  bilas: [.695, .482],
};
/* sekutara tidak disatukan ke sek walau airnya sama: ruasnya tegak ke utara
   sedangkan sek mendatar ke barat, dan acuan arah keduanya saling meniadakan. */
const WATER_ALIAS = { kolam2: 'kolam', kolam3: 'kolam', sek2: 'sek' };
/* Sudut riak per peran. Pola digeser ke arah -x' lokalnya, jadi arus terlihat
   mengalir ke arah -(cos a, sin a) pada koordinat layar (y ke bawah).
   Untuk arah arus (tx, ty) yang diinginkan: a = atan2(-ty, -tx).
   Nilai di bawah mengikuti sumbu tiap saluran pada mask:
     intake & connect = saluran pembilas di utara kolam, mengalir ke timur
     (sumbu +0.99, +0.12) menuju sungai hilir.
   Kedua sudut itu sekarang tidak terpakai — `intake` & `connect` ada di
   WATER_TENANG, digambar tanpa riak sama sekali. Dibiarkan tertulis supaya
   sudutnya tidak perlu dicari ulang kalau ruas itu dihidupkan lagi. */
const WATER_ANGLE = {
  hulu: 2.08, hilir: 1.95, kolam: 0.16, intake: -3.02, connect: -3.02, bilas: 2.09,
  sek: 0.34,        /* sekunder: dari ujung barat kolam naik ke barat laut */
  sekutara: 2.03,   /* lanjutan sekunder di utara jembatan, naik ke utara */
  ter0: 2.17,       /* tersier utara: naik ke timur laut */
  ter1: 0.15,       /* tersier barat: mendatar ke barat */
  ter2: -0.60,      /* tersier barat daya: turun ke kiri bawah */
};
/* Peran yang sudutnya ditetapkan tangan, bukan dari bentuk. `bilas` mulut
   simpang: arusnya menyilang bentuknya sendiri, jadi PCA salah di situ. */
const WATER_ANGLE_FIXED = new Set(['bilas']);
/* saluran intake dan sambungannya menyatu dengan sungai sisi hilir pada mask,
   padahal statusnya mengikuti kolam bendung — dipisah lewat kotak (urut, kecil dulu) */
const WATER_SPLIT = [
  { from: 'hilir', to: 'connect', rect: [0.695, 0.450, 0.726, 0.497] },
  { from: 'hilir', to: 'intake',  rect: [0.688, 0.420, 0.848, 0.487] },
];
/* Potongan air di mulut pintu terlalu kecil untuk dapat acuan sendiri (acuan
   hanya melirik komponen >= 40 px), jadi perannya diwarisi dari tetangga
   terdekat — yang belum tentu benar. Kotak di bawah memaksa peran potongan
   yang titik pusatnya ada di dalamnya. */
const WATER_ZONE = [
  /* mulut pintu sadap tersier utara: airnya tersier, bukan sekunder */
  { rect: [0.294, 0.315, 0.312, 0.345], role: 'ter0' },
  /* sela pintu pengambilan di ujung timur kantong lumpur. Tanpa ini potongan
     renik di sela pilar mewarisi bilas — yang sudutnya dipatok naik ke kanan —
     padahal airnya masuk ke barat mengisi kolam. */
  { rect: [0.700, 0.500, 0.770, 0.555], role: 'kolam' },
  /* sela pintu bendung gerak. Potongan air di bawah daun pintu terlalu kecil
     untuk dapat acuan, dan tetangga berlabel terdekat justru potongan kolam di
     kotak atas — jadi arusnya ikut ke barat, padahal air lewat pintu keluar ke
     hilir di timur laut. Sudut dipatok karena bentuk potongannya memanjang
     searah sumbu bendung, tegak lurus arus: PCA di situ pasti meleset. */
  { rect: [0.772, 0.470, 0.895, 0.565], role: 'hilir', ang: 2.27 },
];

/* Peran air yang digambar TENANG: warna biru dasar tetap, tanpa riak, dan fasenya
 * tidak dimajukan sama sekali.
 *
 * `intake` & `connect` adalah saluran pembilas di utara kolam beserta potongan
 * penyambungnya ke sungai hilir — keduanya dipotong dari mask sungai lewat
 * WATER_SPLIT. Tidak ada pos telemetri yang membacanya dan tidak ada besaran model
 * yang menyatakan keadaannya: warna kelas yang dulu dipakainya cuma pinjaman dari
 * kolam bendung, jadi ia melaporkan keadaan ruas LAIN. Ruas yang melaporkan keadaan
 * yang bukan miliknya lebih buruk daripada ruas yang diam.
 *
 * BUKAN dihapus dari gambar. `draft_skema.png` sudah berlubang tepat pada badan
 * airnya — airnya tembus dari canvas di bawahnya, bukan digambar di ilustrasi. Kalau
 * canvasnya tidak mengisi lubang itu, yang terlihat latar panggung, bukan tanah.
 * Menghilangkan salurannya berarti menutup lubang di draft_skema.png dan menghapus
 * alpha-nya di aliran_sungai.png — suntingan gambar, bukan kode.
 *
 * `bilas` ikut: itu mulut kecil di bawah jembatan yang menyambung kolam ke saluran
 * pembilas — ujung barat sistem yang sama, dan warnanya pun pinjaman dari kolam
 * (P.bilas = P.kolam). Mematikan salurannya tetapi meninggalkan mulutnya beriak
 * membuat satu bercak bergerak yang tidak menyambung ke mana pun. */
const WATER_TENANG = new Set(['intake', 'connect', 'bilas']);

/* Penanda peran tiap pecahan air, untuk menyetel WATER_SEED / WATER_ZONE / WATER_SPLIT.
 * Menemukan pecahan mana yang perlu disetel selama ini pekerjaan menebak: perannya
 * lahir dari titik acuan pada mask, bukan dari saluran di gambar, jadi tidak ada
 * cara membacanya dari tampilan.
 *
 * Dinyalakan dari konsol peramban, bukan dari tombol:
 *     localStorage.wmsWaterDebug = '1'   lalu muat ulang
 *     delete localStorage.wmsWaterDebug  untuk mematikannya
 * Sengaja tidak diberi tombol — ini alat setelan pengembang, bukan tampilan operator. */
const WATER_DEBUG = (() => {
  try { return localStorage.getItem('wmsWaterDebug') === '1'; } catch (e) { return false; }
})();

const water = { ready: false, regions: [], phase: {}, last: 0, ripple: null, tmp: null, cost: null, slow: false };
/* Warna air = WATER_BASE dicampur WATER_COLOR[kelas] sebesar WATER_TINT[kelas].
 *
 * Susunan lama menyeret rona seringan mungkin supaya "air tetap biru": tint 0,35-0,60
 * ke arah warna yang pucat-pucat juga. Akibatnya tiga kelas peringatan bertemu di satu
 * tempat — abu-kehijauan pucat — dan dua di antaranya praktis tidak bisa dibedakan:
 *
 *     kering   #b1c5b4      jarak RGB kering vs waspada = 20
 *     waspada  #b0d5c0      jarak RGB kering vs siaga   = 19
 *     siaga    #bfc0a8      (di bawah ~25 = tidak terbedakan mata)
 *
 * Jadi ruas KEKERINGAN dan ruas KEBANJIRAN tergambar warna yang sama. Cuma `normal`
 * yang benar-benar menonjol (jarak 60-119 dari sisanya).
 *
 * Sekarang warna sasarannya jenuh dan tintnya dinaikkan secukupnya sampai tiap kelas
 * punya rona sendiri. Jarak minimum jadi 46 (kering vs siaga), sisanya 69-203:
 *
 *     kering   #a9a07c  khaki kering     normal   #8ed6f2  biru air
 *     waspada  #c7de79  kuning-hijau     siaga    #d09766  jingga-tanah
 *     bahaya   #b7535d  merah
 *
 * `kering` sengaja bertint paling tinggi (0,80). Biru dan coklat hampir berlawanan,
 * jadi campuran seimbang keduanya selalu mendarat di abu-abu — untuk terbaca sebagai
 * dasar saluran yang tersingkap, kelas ini harus keluar dari keluarga biru, bukan
 * cuma dironai. Tangga peringatan (0,50-0,66) masih menyisakan biru yang cukup untuk
 * terbaca sebagai air. */
/* Warna air peta isometrik: tiap kelas dicampur ke WATER_BASE menurut WATER_TINT.
 *
 * Kelas `waspada` dulu KUNING MURNI (#ffe600) pada tint 0,50, dan campuran itu
 * MENGHIJAU: kuning (255,230,0) + air biru (142,214,242) di tengah-tengah
 * menghasilkan rgb(199,222,121) — hijau lumut, bukan peringatan. Paling kentara
 * pada keadaan kemarau, saat kantong lumpur terisi 74% tanggulnya dan seluruh
 * kolamnya tergambar hijau seperti air tergenang lumut.
 *
 * Kelas lain tidak kena karena warnanya oranye/merah/coklat, yang tidak
 * menghijau bila dicampur biru. Jadi yang diganti cuma satu: amber #f2b21c pada
 * tint 0,78 → rgb(220,186,75). Ia sewarna dengan titik pin `waspada`
 * (LEVEL_DOT #c9971a) sehingga air dan pin bercerita sama, dan tetap jelas
 * berbeda dari tetangganya di tangga kelas:
 *
 *     kering   rgb(169,160,124)   abu-coklat
 *     waspada  rgb(220,186,75)    amber emas
 *     siaga    rgb(208,151,102)   oranye
 *     bahaya   rgb(183,83,93)     merah
 */
const WATER_COLOR = { kering: '#b0925f', normal: '#7ecdee', waspada: '#f2b21c', siaga: '#ff6a00', bahaya: '#cc1010' };
const WATER_BASE = '#8ed6f2';
const WATER_TINT = { kering: 0.80, normal: 0, waspada: 0.78, siaga: 0.58, bahaya: 0.66 };

function makeRipplePattern(size, freq, contrast) {
  const s = size, c = document.createElement('canvas');
  c.width = s; c.height = s;
  const x = c.getContext('2d'), img = x.createImageData(s, s);
  const T = Math.PI * 2;
  for (let y = 0; y < s; y++) {
    for (let px = 0; px < s; px++) {
      const u = px / s, v = y / s;
      /* gelombang panjang + riak pendek yang melengkung, bukan garis lurus */
      const w1 = Math.sin(u * T * freq + Math.sin(v * T) * 0.9);
      const w2 = Math.sin(u * T * freq * 2.7 - v * T * 1.6) * 0.45;
      const w3 = Math.sin(u * T * freq * 5.3 + v * T * 3.1) * 0.22;
      const n = (w1 + w2 + w3) / 1.67;
      const i = (y * s + px) * 4;
      const up = Math.max(0, n) ** 1.7, dn = Math.max(0, -n) ** 2;
      /* puncak = kilau putih, lembah = biru sedikit lebih tua (bukan hitam) */
      if (up > dn) { img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = up * 130 * contrast; }
      else { img.data[i] = 40; img.data[i + 1] = 110; img.data[i + 2] = 152; img.data[i + 3] = dn * 90 * contrast; }
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

/* Sudut riak satu potongan air, diambil dari sumbu panjang bentuknya sendiri
   (PCA atas momen piksel). WATER_ANGLE tinggal menentukan ujung mana yang hilir:
   sumbu dibalik kalau berlawanan arah dengan arus peran itu.
   Satu peran sering punya beberapa ruas dengan arah berbeda — sekunder membelok,
   tersier ada bagian tegak dan mendatar — jadi satu sudut per peran tidak cukup. */
function regionAngle(m, role) {
  const A = WATER_ANGLE[role] || 0;
  if (WATER_ANGLE_FIXED.has(role) || m.n < 12) return A;
  const mx = m.sx / m.n, my = m.sy / m.n;
  const cxx = m.sxx / m.n - mx * mx, cyy = m.syy / m.n - my * my, cxy = m.sxy / m.n - mx * my;
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
  /* bentuk yang terlalu membulat tidak punya sumbu jelas — pakai sudut peran */
  if (l2 <= 1e-6 || l1 / l2 < 1.6) return A;
  let vx = cxy, vy = l1 - cxx;
  if (Math.abs(vx) < 1e-9 && Math.abs(vy) < 1e-9) { vx = 1; vy = 0; }
  const len = Math.hypot(vx, vy);
  vx /= len; vy /= len;
  /* arahkan sumbu ke hilir menurut arus peran, lalu ubah balik jadi sudut pola */
  if (vx * -Math.cos(A) + vy * -Math.sin(A) < 0) { vx = -vx; vy = -vy; }
  return Math.atan2(-vy, -vx);
}

/* Medan aliran melengkung.
   Satu sudut per potongan air jadi kompromi kalau salurannya membelok — sekunder
   di sini membelok 84 derajat. Di sini potongan dipecah jadi pita melintang, tiap
   pita punya sudutnya sendiri, sehingga riak mengikuti belokannya.

   Caranya: jarak geodesik dihitung dari ujung hilir ke seluruh piksel potongan,
   piksel dikelompokkan menurut jarak itu, dan garis singgung tiap kelompok diambil
   dari pergeseran titik beratnya. Batas antar pita = garis tegak lurus arus, jadi
   pita bersambung tanpa celah maupun tumpang tindih besar.

   Hasilnya dipakai kalau belokannya berarti saja; saluran lurus tetap lewat jalur
   satu sudut yang lebih murah. Jumlah pita mengikuti besar belokan, bukan panjang
   saluran, supaya saluran panjang tapi lurus tidak dipecah percuma. */
const FLOW_MIN_BEND = 0.5;     /* di bawah ~29 derajat, tidak usah dilengkungkan */
const FLOW_STEP = 0.14;        /* sasaran ~8 derajat per pita */
const FLOW_MAX = 10;
/* Titik berat pada badan air yang lebar dan pendek (kolam, sungai) bergoyang,
   garis singgungnya jadi derau. Hanya bentuk memanjang yang dilengkungkan. */
const FLOW_MIN_SLENDER = 4;

function buildFlowStrips(px, py, ox, oy, w, h, A, MW) {
  /* ambang di bawah disetel pada resolusi kerja 650, jadi diskala ke MW nyata */
  const S = MW / 650;
  const n = px.length;
  if (n < 60 * S * S) return null;

  /* hilir = piksel terjauh searah arus peran */
  const tvx = -Math.cos(A), tvy = -Math.sin(A);
  let src = 0, bestP = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = px[i] * tvx + py[i] * tvy;
    if (p > bestP) { bestP = p; src = i; }
  }

  /* jarak geodesik dari hilir, 8 arah, hanya lewat air */
  const idx = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < n; i++) idx[(py[i] - oy) * w + (px[i] - ox)] = i;
  const dist = new Int32Array(n).fill(-1), queue = new Int32Array(n);
  let qs = 0, qe = 0;
  dist[src] = 0; queue[qe++] = src;
  const NBX = [1, -1, 0, 0, 1, 1, -1, -1], NBY = [0, 0, 1, -1, 1, -1, 1, -1];
  while (qs < qe) {
    const c = queue[qs++], cx = px[c] - ox, cy = py[c] - oy;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NBX[k], ny = cy + NBY[k];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = idx[ny * w + nx];
      if (j < 0 || dist[j] >= 0) continue;
      dist[j] = dist[c] + 1; queue[qe++] = j;
    }
  }
  let L = 0;
  for (let i = 0; i < n; i++) if (dist[i] > L) L = dist[i];
  if (L < 14 * S || L * L < FLOW_MIN_SLENDER * n) return null;   /* L/lebar = L*L/n */

  /* titik berat per potongan jarak, lalu garis singgungnya */
  const fb = Math.max(2, Math.round(L / 40));
  const nb = Math.floor(L / fb) + 1;
  const bn = new Float64Array(nb), bx = new Float64Array(nb), by = new Float64Array(nb);
  const bxx = new Float64Array(nb), byy = new Float64Array(nb);
  for (let i = 0; i < n; i++) {
    if (dist[i] < 0) continue;
    const b = Math.min(nb - 1, Math.floor(dist[i] / fb));
    bn[b]++; bx[b] += px[i]; by[b] += py[i];
    bxx[b] += px[i] * px[i]; byy[b] += py[i] * py[i];
  }
  const cx = [], cy = [], cs = [], spread = [];
  for (let b = 0; b < nb; b++) {
    if (bn[b] < 3) continue;
    const mx = bx[b] / bn[b], my = by[b] / bn[b];
    cx.push(mx); cy.push(my); cs.push(b * fb + fb / 2);
    spread.push(Math.sqrt(Math.max(0, bxx[b] / bn[b] - mx * mx) + Math.max(0, byy[b] / bn[b] - my * my)));
  }
  if (cx.length < 4) return null;
  /* Kalau potongan bercabang, satu jarak geodesik memuat piksel dari dua lengan
     dan titik beratnya jatuh di antaranya — sebarannya melonjak jauh di atas
     sebaran khas. Kasus begitu dikembalikan ke satu sudut, bukan ditebak. */
  const sSort = spread.slice().sort((a, b) => a - b);
  const sMid = sSort[sSort.length >> 1];
  if (sMid > 1e-6 && sSort[sSort.length - 1] > 2.5 * sMid) return null;

  /* sudut tiap contoh; arus mengalir dari jarak besar ke jarak kecil */
  const ang = [];
  for (let i = 0; i < cx.length; i++) {
    const a = Math.max(0, i - 1), b = Math.min(cx.length - 1, i + 1);
    const vx = cx[a] - cx[b], vy = cy[a] - cy[b];
    ang.push(Math.hypot(vx, vy) < 1e-9 ? (ang[i - 1] || A) : Math.atan2(-vy, -vx));
  }
  for (let i = 1; i < ang.length; i++) {          /* buka lipatan +-PI */
    while (ang[i] - ang[i - 1] > Math.PI) ang[i] -= 2 * Math.PI;
    while (ang[i] - ang[i - 1] < -Math.PI) ang[i] += 2 * Math.PI;
  }
  /* rata-rata bergerak: buang goyangan titik berat, sisakan belokan sebenarnya */
  const sm = ang.slice();
  for (let i = 0; i < ang.length; i++) {
    let s = 0, c2 = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= ang.length) continue;
      s += ang[j]; c2++;
    }
    sm[i] = s / c2;
  }
  for (let i = 0; i < ang.length; i++) ang[i] = sm[i];
  let lo = ang[0], hi = ang[0];
  for (let i = 1; i < ang.length; i++) { if (ang[i] < lo) lo = ang[i]; if (ang[i] > hi) hi = ang[i]; }
  if (hi - lo < FLOW_MIN_BEND) return null;       /* cukup lurus, pakai satu sudut */

  /* batas pita dibagi rata menurut perubahan sudut, bukan panjang: bagian lurus
     tidak dipecah, belokan dapat pita rapat */
  const cum = [0];
  for (let i = 1; i < ang.length; i++) cum.push(cum[i - 1] + Math.abs(ang[i] - ang[i - 1]));
  const total = cum[cum.length - 1];
  const ns = clamp(Math.ceil((hi - lo) / FLOW_STEP), 2, FLOW_MAX);
  const cut = [0];
  for (let j = 1; j < ns; j++) {
    const target = total * j / ns;
    let i = cut[cut.length - 1];
    while (i < cum.length - 1 && cum[i] < target) i++;
    if (i > cut[cut.length - 1] && i < cx.length - 1) cut.push(i);
  }
  cut.push(cx.length - 1);
  if (cut.length < 3) return null;

  /* batas = garis tegak lurus arus lewat titik berat; ujung dijulurkan keluar.
     Pita sedikit dilebihkan agar tepi ber-antialias tidak meninggalkan garis. */
  const R = 2 * (w + h), OVER = 0.6 * S;
  const P = cut.map((i, j) => {
    let x = cx[i], y = cy[i];
    const ux = -Math.cos(ang[i]), uy = -Math.sin(ang[i]);       /* arah arus */
    if (j === 0) { x += ux * R; y += uy * R; }
    if (j === cut.length - 1) { x -= ux * R; y -= uy * R; }
    return { x, y, ux, uy };
  });
  const strips = [];
  for (let j = 0; j < P.length - 1; j++) {
    const a = P[j], b = P[j + 1];
    /* a lebih hilir dari b: julurkan a ke hilir, b ke hulu */
    const ax = a.x + a.ux * OVER, ay = a.y + a.uy * OVER;
    const bx2 = b.x - b.ux * OVER, by2 = b.y - b.uy * OVER;
    const q = [
      ax - a.uy * R, ay + a.ux * R,
      bx2 - b.uy * R, by2 + b.ux * R,
      bx2 + b.uy * R, by2 - b.ux * R,
      ax + a.uy * R, ay - a.ux * R,
    ];
    for (let t = 0; t < 8; t += 2) { q[t] = (q[t] - ox) / w; q[t + 1] = (q[t + 1] - oy) / h; }
    const i0 = cut[j], i1 = cut[j + 1];
    /* s = jarak sepanjang saluran, dinyatakan sebagai pecahan lebar gambar
       supaya sisi gambar tidak perlu tahu resolusi kerja */
    strips.push({ ang: (ang[i0] + ang[i1]) / 2, s: (cs[i0] + cs[i1]) / 2 / MW, q });
  }
  return strips.length > 1 ? strips : null;
}

/* Label komponen tersambung pada mask, lalu tiap komponen dipetakan ke perannya.
   Label dihitung di resolusi kerja rendah (cepat), tetapi tepi tiap region diambil
   dari mask resolusi penuh supaya tetap tajam saat peta di-zoom. */
function buildWaterRegions(mask, MW, MH, srcImg, SW, SH, shadeImg, holeImg) {
  const lab = new Int32Array(MW * MH).fill(-1), stack = new Int32Array(MW * MH), comps = [];
  for (let k = 0; k < MW * MH; k++) {
    if (!mask[k] || lab[k] >= 0) continue;
    const id = comps.length; let sp = 0, n = 0;
    let minx = MW, maxx = 0, miny = MH, maxy = 0;
    stack[sp++] = k; lab[k] = id;
    while (sp) {
      const q = stack[--sp], qx = q % MW, qy = (q / MW) | 0; n++;
      if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
      if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
      if (qx > 0 && mask[q - 1] && lab[q - 1] < 0) { lab[q - 1] = id; stack[sp++] = q - 1; }
      if (qx < MW - 1 && mask[q + 1] && lab[q + 1] < 0) { lab[q + 1] = id; stack[sp++] = q + 1; }
      if (qy > 0 && mask[q - MW] && lab[q - MW] < 0) { lab[q - MW] = id; stack[sp++] = q - MW; }
      if (qy < MH - 1 && mask[q + MW] && lab[q + MW] < 0) { lab[q + MW] = id; stack[sp++] = q + MW; }
    }
    comps.push({ id, n, minx, maxx, miny, maxy, cx: (minx + maxx) / 2, cy: (miny + maxy) / 2, role: null });
  }
  /* peran dari titik acuan; komponen tanpa acuan ikut komponen berlabel terdekat */
  Object.keys(WATER_SEED).forEach(key => {
    const [nx, ny] = WATER_SEED[key];
    const sx = clamp(Math.round(nx * MW), 0, MW - 1), sy = clamp(Math.round(ny * MH), 0, MH - 1);
    let best = -1, bd = 1e9;
    comps.forEach(c => {
      if (c.n < 40) return;
      const d = (c.cx - sx) ** 2 + (c.cy - sy) ** 2;
      const inside = sx >= c.minx && sx <= c.maxx && sy >= c.miny && sy <= c.maxy;
      const score = inside ? d * 0.01 : d;
      if (score < bd) { bd = score; best = c.id; }
    });
    if (best >= 0 && !comps[best].role) comps[best].role = WATER_ALIAS[key] || key;
  });
  /* kotak zona menimpa peran potongan kecil yang acuannya tidak jelas —
     dijalankan sebelum pewarisan supaya potongan ini jadi rujukan tetangganya */
  WATER_ZONE.forEach(z => comps.forEach(c => {
    const nx = c.cx / MW, ny = c.cy / MH;
    if (nx < z.rect[0] || nx > z.rect[2] || ny < z.rect[1] || ny > z.rect[3]) return;
    c.role = z.role;
    /* sudut kotak, kalau ada, mengunci arah potongan itu saja — bukan perannya */
    if (z.ang !== undefined) c.angFix = z.ang;
  }));
  comps.forEach(c => {
    if (c.role || c.n < 4) return;
    let best = null, bd = 1e9;
    comps.forEach(o => { if (!o.role) return; const d = (o.cx - c.cx) ** 2 + (o.cy - c.cy) ** 2; if (d < bd) { bd = d; best = o; } });
    if (best) c.role = best.role;
  });

  /* Potongan renik — beberapa piksel di sela pilar pintu — tidak layak jadi
     region sendiri: canvas, rim, dan bayangannya jauh lebih mahal daripada
     isinya. Kalau menempel pada region tetangga, pikselnya digabungkan ke situ.
     Lubangnya tertutup tanpa menambah satu pun panggilan gambar per frame. */
  const MERGE_MIN = 4, MERGE_NEAR = 6;
  comps.forEach(c => {
    if (c.n === 0 || c.n >= MERGE_MIN) return;
    let best = null, bd = 1e9;
    comps.forEach(o => {
      if (o.n < MERGE_MIN || !o.role) return;
      const dx = Math.max(o.minx - c.maxx, c.minx - o.maxx, 0);
      const dy = Math.max(o.miny - c.maxy, c.miny - o.maxy, 0);
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = o; }
    });
    if (!best || bd > MERGE_NEAR * MERGE_NEAR) return;
    for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) {
      if (lab[y * MW + x] === c.id) lab[y * MW + x] = best.id;
    }
    best.n += c.n;
    best.minx = Math.min(best.minx, c.minx); best.maxx = Math.max(best.maxx, c.maxx);
    best.miny = Math.min(best.miny, c.miny); best.maxy = Math.max(best.maxy, c.maxy);
    c.n = 0;
  });

  /* satu canvas mask per komponen (dipangkas ke bounding box; resolusi dibatasi
     agar biaya menggambar tiap frame tetap kecil) */
  const k = SW / MW, CAP = 1300;
  const out = [];
  comps.filter(c => c.role && c.n >= 4).forEach(c => {
    const w = c.maxx - c.minx + 1, h = c.maxy - c.miny + 1;
    /* label komponen di resolusi kerja */
    const lc = document.createElement('canvas'); lc.width = w; lc.height = h;
    const lx = lc.getContext('2d'), lid = lx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (lab[(y + c.miny) * MW + (x + c.minx)] === c.id) {
        const i = (y * w + x) * 4;
        lid.data[i] = lid.data[i + 1] = lid.data[i + 2] = 255; lid.data[i + 3] = 255;
      }
    }
    lx.putImageData(lid, 0, 0);

    /* sebagian komponen menyatu dengan sungai padahal perannya beda
       (mis. saluran intake di sisi utara kolam) — dipisah lewat kotak */
    const parts = [], splitBoxes = [];
    let baseLab = lc;
    WATER_SPLIT.filter(s => s.from === c.role).forEach(sp => {
      const box = {
        x: Math.round(sp.rect[0] * MW) - c.minx, y: Math.round(sp.rect[1] * MH) - c.miny,
        w: Math.round((sp.rect[2] - sp.rect[0]) * MW), h: Math.round((sp.rect[3] - sp.rect[1]) * MH),
      };
      if (box.x >= w || box.y >= h || box.x + box.w <= 0 || box.y + box.h <= 0) return;
      splitBoxes.push({ x0: box.x + c.minx, y0: box.y + c.miny, x1: box.x + c.minx + box.w, y1: box.y + c.miny + box.h });
      const inside = document.createElement('canvas'); inside.width = w; inside.height = h;
      const ix = inside.getContext('2d');
      ix.drawImage(baseLab, 0, 0);
      ix.globalCompositeOperation = 'destination-in';
      ix.fillStyle = '#fff'; ix.fillRect(box.x, box.y, box.w, box.h);
      const rest = document.createElement('canvas'); rest.width = w; rest.height = h;
      const rxc = rest.getContext('2d');
      rxc.drawImage(baseLab, 0, 0);
      rxc.clearRect(box.x, box.y, box.w, box.h);
      parts.push({ lab: inside, role: sp.to });
      baseLab = rest;
    });
    parts.push({ lab: baseLab, role: c.role });

    /* Momen tiap bagian, dihitung sekali dari label resolusi kerja. Urutannya
       sama dengan pemotongan di atas: kotak split lebih dulu, sisanya terakhir. */
    const mom = parts.map(() => ({ n: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0 }));
    const ptsX = parts.map(() => []), ptsY = parts.map(() => []);
    for (let y = c.miny; y <= c.maxy; y++) for (let x = c.minx; x <= c.maxx; x++) {
      if (lab[y * MW + x] !== c.id) continue;
      let pi = parts.length - 1;
      for (let s = 0; s < splitBoxes.length; s++) {
        const b = splitBoxes[s];
        if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) { pi = s; break; }
      }
      const m = mom[pi];
      m.n++; m.sx += x; m.sy += y; m.sxx += x * x; m.syy += y * y; m.sxy += x * y;
      ptsX[pi].push(x); ptsY[pi].push(y);
    }

    parts.forEach((part, pi) => {
      /* potong mask resolusi penuh, lalu batasi ke wilayah label komponen */
      const kk = Math.min(k, CAP / Math.max(w, h));
      const HW = Math.max(2, Math.round(w * kk)), HH = Math.max(2, Math.round(h * kk));
      const cv = document.createElement('canvas'); cv.width = HW; cv.height = HH;
      const cx2 = cv.getContext('2d');
      cx2.drawImage(srcImg, c.minx * k, c.miny * k, w * k, h * k, 0, 0, HW, HH);
      /* buang bagian yang tertutup draft, memakai tepi resolusi penuh: air
         berhenti persis di tepi lubang, tidak merembes ke dek & pilar pintu */
      if (holeImg) {
        const kh = holeImg.width / MW;
        cx2.globalCompositeOperation = 'destination-out';
        cx2.imageSmoothingEnabled = true;
        cx2.drawImage(holeImg, c.minx * kh, c.miny * kh, w * kh, h * kh, 0, 0, HW, HH);
      }
      cx2.globalCompositeOperation = 'destination-in';
      cx2.imageSmoothingEnabled = true;
      /* Label resolusi kerja dilebarkan agar tidak memotong tepi halus mask.
         Dulu setengah piksel kerja, karena pelebaran penuh membuat air melimpah
         menutupi tanggul, dek, dan pilar pintu. Itu tidak berlaku lagi sejak
         destination-out di atas memotong pada tepi lubang resolusi penuh, jadi
         sekarang dua piksel kerja — cukup longgar agar label ini tidak menjadi
         penghambat waktu mask akhir di bawah sengaja dilebarkan. */
      const e = Math.max(1, (HW / w) * 2);
      const dil = document.createElement('canvas'); dil.width = HW; dil.height = HH;
      const dx2 = dil.getContext('2d');
      dx2.imageSmoothingEnabled = true;
      [[0, 0], [-e, 0], [e, 0], [0, -e], [0, e]].forEach(([ex, ey]) => {
        dx2.drawImage(part.lab, ex, ey, HW, HH);
      });
      cx2.drawImage(dil, 0, 0);

      /* rim: bayangan tepi yang memudar ke tengah — bikin air terlihat cekung, bukan pelat rata */
      const blurPx = clamp(Math.min(HW, HH) * 0.05, 2, 7);
      const bl = document.createElement('canvas'); bl.width = HW; bl.height = HH;
      const bx = bl.getContext('2d');
      bx.filter = 'blur(' + blurPx.toFixed(1) + 'px)';
      bx.drawImage(cv, 0, 0);
      bx.filter = 'none';
      const rim = document.createElement('canvas'); rim.width = HW; rim.height = HH;
      const rx2 = rim.getContext('2d');
      rx2.fillStyle = '#2b6f96'; rx2.fillRect(0, 0, HW, HH);
      rx2.globalCompositeOperation = 'destination-out';
      rx2.drawImage(bl, 0, 0);
      rx2.globalCompositeOperation = 'destination-in';
      rx2.drawImage(cv, 0, 0);

      /* bayangan pohon & tanggul dari render asli, dipangkas ke komponen ini */
      let shade = null;
      if (shadeImg) {
        shade = document.createElement('canvas'); shade.width = HW; shade.height = HH;
        const sx2 = shade.getContext('2d');
        /* skala sendiri: render bayangan resolusinya beda dari mask aliran */
        const kb = shadeImg.width / MW;
        sx2.drawImage(shadeImg, c.minx * kb, c.miny * kb, w * kb, h * kb, 0, 0, HW, HH);
        sx2.globalCompositeOperation = 'destination-in';
        sx2.drawImage(cv, 0, 0);
      }

      /* Mask akhir sedikit lebih lebar daripada bentuk air sebenarnya. Tepi air
         dan tepi lubang draft ada di dua lapisan berbeda, dan lapisan air masih
         melewati dua kali penskalaan ulang sebelum ditempel di posisi pecahan —
         keduanya tidak pernah bertemu persis, dan celah tipis yang tersisa
         meloloskan latar panggung yang pucat. Itulah bercak putih di pinggir
         air. Air ada di lapisan paling bawah, jadi kelebihan ini menjorok ke
         bawah gambar draft dan tidak pernah terlihat.
         Bayangan tepi tetap dihitung dari bentuk ketat di atas — kalau ikut
         dilebarkan, bayangannya masuk ke bawah draft dan air terlihat rata. */
      const grown = document.createElement('canvas'); grown.width = HW; grown.height = HH;
      const gx2 = grown.getContext('2d');
      gx2.imageSmoothingEnabled = true;
      const grow = Math.max(1, (HW / w) * 1.5);
      [[0, 0], [-grow, 0], [grow, 0], [0, -grow], [0, grow]].forEach(([ax, ay]) => gx2.drawImage(cv, ax, ay));
      gx2.globalCompositeOperation = 'destination-in';
      gx2.drawImage(dil, 0, 0);

      const fixed = c.angFix !== undefined;
      const ang = fixed ? c.angFix : regionAngle(mom[pi], part.role);
      const flow = (fixed || WATER_ANGLE_FIXED.has(part.role))
        ? null
        : buildFlowStrips(ptsX[pi], ptsY[pi], c.minx, c.miny, w, h, ang, MW);
      out.push({ role: part.role, ang, flow, canvas: grown, rim, shade,
                 bx: c.minx / MW, by: c.miny / MH, bw: w / MW, bh: h / MH });
    });
  });
  return out;
}

function initIsoWater() {
  const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
  Promise.all([
    load('/assets/aliran_sungai.png'),
    load('/assets/draft_skema.png'),
    load('/assets/iso-water-shade.png'),
  ]).then(([img, holeImg, shadeImg]) => {
    if (!img) return;
    /* Resolusi kerja. Di 650 px, air setipis sela pintu hilang: alpha draft
       hasil perkecilan naik ke 104-147, lewat ambang 110, jadi dianggap
       tertutup bangunan padahal itu lubang. Di 1300 px alpha yang sama turun
       ke 27-94 dan potongan itu terbaca lagi. Ukuran canvas per komponen tidak
       ikut naik karena tetap dibatasi CAP. */
    const MW = 1300, MH = Math.round(MW * img.height / img.width);
    /* alpha tiap gambar dibaca di resolusi kerja yang sama */
    const readAlpha = (im) => {
      const c = document.createElement('canvas'); c.width = MW; c.height = MH;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(im, 0, 0, MW, MH);
      return x.getImageData(0, 0, MW, MH).data;
    };
    const dWater = readAlpha(img), dHole = holeImg ? readAlpha(holeImg) : null;
    const mask = new Uint8Array(MW * MH);
    for (let k = 0; k < MW * MH; k++) {
      if (dWater[k * 4 + 3] <= 110) continue;
      if (dHole && dHole[k * 4 + 3] > 110) continue;   /* tertutup draft, bukan lubang air */
      mask[k] = 1;
    }
    water.regions = buildWaterRegions(mask, MW, MH, img, img.width, img.height, shadeImg, holeImg);
    water.rippleA = makeRipplePattern(220, 1, 1);      /* gelombang panjang */
    water.rippleB = makeRipplePattern(104, 1.6, 0.75); /* riak pendek */
    water.tmp = document.createElement('canvas');
    water.tmp.width = water.tmp.height = 16;
    const tctx = water.tmp.getContext('2d');
    water.patA = tctx.createPattern(water.rippleA, 'repeat');   /* dibuat sekali */
    water.patB = tctx.createPattern(water.rippleB, 'repeat');
    water.ready = true;
    requestAnimationFrame(drawIsoWater);
  });
}

/* Warna & kecepatan tiap badan air diambil langsung dari state simulasi. */
function waterParams() {
  const col = (s) => mixColor(WATER_BASE, WATER_COLOR[s] || WATER_COLOR.normal, WATER_TINT[s] || 0);
  /* WARNA AIR PETA MEMAKAI DASAR YANG SAMA DENGAN SKEMATIK: kelas dari DEBIT
     terhadap kapasitas bangunannya, tanpa ukuran muka air.

     Skematik menilai tiap ruas dari alirannya saja (lihat flowStateOf), sementara
     peta dulu memakai reachStatus yang mencampur debit DAN muka air. Dua tampilan
     yang menggambarkan jaringan yang sama karena itu bisa bercerita beda: ruas
     yang alirannya wajar tetap tergambar kuning atau merah di peta hanya karena
     mukanya sedang tinggi.

     Muka air tidak hilang dari tampilan — di skematik ia terbaca dari tinggi kolom
     airnya, di peta dari angka pada pin. Yang dilepas cuma perannya menentukan
     warna. */
  const T = state.thresholds, N = state.dummyNodes || {};
  const kap = (id) => (N[id] || {}).kapasitas || 0;

  const sHulu  = debitStatus(state.Qnat, kap('WEIR_COPONG'));
  /* Ruas hilir memakai debit yang benar-benar lewat di depannya (Qhilir), bukan yang
     masuk kolam. Di situlah keadaan banjir terbaca di sisi sungai: 103,87 m³/dtk
     terhadap kapasitas 35. */
  const sHilir = debitStatus(state.Qhilir, kap('AWLR_HILIR'));
  /* KANTONG LUMPUR & SALURAN SEKUNDER SATU KELAS — dihitung sekali, dipakai
     keduanya, jadi warnanya berubah bersamaan ke arah mana pun.

     Keduanya satu badan air: kantong lumpur pangkal saluran induk, dan airnya
     mengalir langsung ke saluran sekunder tanpa terputus. Mewarnainya berbeda
     membuat satu aliran yang sama terbaca sebagai dua keadaan — pada keadaan
     kemarau kolam tergambar KUNING sementara saluran tepat di hilirnya BIRU,
     padahal air yang sama baru saja lewat.

     Yang dilepas: ukuran MUKA AIR kolam. Ia mengikuti muka air hulu dan tidak
     bisa ditindaklanjuti operator — sudah terukur, bukaan pintu intake hanya
     menggesernya antara 73% dan 76% — jadi memperingatkannya cuma menghasilkan
     warna yang tidak bisa ditanggapi. Aturan kemarau menahan hulu di 2,05 m
     justru supaya pengambilan tetap dapat air; kolam ikut ke 2,00 m, dan itu
     tanda bendung bekerja, bukan tanda bahaya.

     Yang DIPERTAHANKAN: debit kolam terhadap kapasitasnya. Itu yang menentukan
     apakah air sempat tenang cukup lama untuk mengendapkan lumpur, dan itu bisa
     ditanggapi dengan menutup pintu.

     Kelasnya yang TERBERAT di antara debit kolam dan kelas saluran sekunder,
     lalu dipakai KEDUANYA. Sebelumnya cuma kolam yang mengikuti sekunder, tidak
     sebaliknya — jadi kalau debit kolam yang memburuk, kolam berubah warna
     sementara saluran tepat di hilirnya tetap biru. Sekarang peringatan dari
     sisi mana pun langsung terbaca di seluruh badan air itu. */
  const sJaringan = LEVEL_URUT[Math.max(
    LEVEL_URUT.indexOf(debitStatus(state.QgateTotal, kap('AWLR_KOLAM'))),
    LEVEL_URUT.indexOf(debitStatus(state.QsecTotal, kap('AWLR_SEKUNDER'))))];
  const sKolam = sJaringan, sSek = sJaringan;
  /* Tiap ruas beranimasi menurut arusnya SENDIRI.

     Dulu `hilir` dan `kolam` sama-sama memakai state.vPool — dan vPool sendiri
     Manning atas geometri sungai, yang tidak menanggapi bukaan pintu mana pun.
     Akibatnya ruas sungai di bawah bendung beranimasi mengikuti kantong lumpur,
     bukan mengikuti debit yang benar-benar lewat di depannya; pada keadaan
     banjir itu 104 m³/dtk yang tergambar selambat kolam.

     Pengali 0,45 pada `kolam` ikut dilepas. Itu peredam buatan untuk menutupi
     vPool yang kebesaran 47x; sesudah vPool dihitung dari debit/penampang,
     angkanya sudah benar dengan sendirinya dan kolam memang jadi ruas paling
     lambat di seluruh peta — sebagaimana kantong lumpur seharusnya. */
  const P = {
    hulu:  { color: col(sHulu),  speed: state.vUp },
    hilir: { color: col(sHilir), speed: state.vHilir != null ? state.vHilir : state.vPool },
    kolam: { color: col(sKolam), speed: state.vPool },
    sek:   { color: col(sSek),   speed: state.vSec },
  };
  /* Saluran intake TIDAK boleh ikut `hilir` lagi. Dulu boleh, karena `hilir` sendiri
     memakai keadaan kolam; sekarang `hilir` memakai debit sungai keluar, dan intake
     yang ikut ke situ akan tergambar merah saat banjir padahal ia justru dijepit
     pintu scouring ke 0,56 m³/dtk. Keadaannya kolam, lajunya tetap vPool seperti
     sebelumnya — tidak ada yang berubah dari yang dulu terlihat. */
  P.intake = { color: col(sKolam), speed: state.vPool };
  P.connect = P.kolam;
  P.bilas = P.kolam;    /* mulut di bawah jembatan: air kolam, arah sendiri */
  P.sekutara = P.sek;   /* ruas sekunder yang sama, hanya arahnya yang beda */
  for (let i = 0; i < 3; i++) {
    P['ter' + i] = {
      color: col(debitStatus(state.Qfield[i], kap('AWLR_TERSIER_' + (i + 1)))),
      speed: state.vTert[i],
    };
  }
  return P;
}

function drawIsoWater(ts) {
  requestAnimationFrame(drawIsoWater);
  const cv = el('isoWater'), stage = el('isoStage');
  if (!water.ready || !cv || !stage || !stage.offsetParent) return;
  /* sasaran 60 fps supaya aliran halus; turun ke 30 fps kalau menggambar satu
     frame ternyata mahal. Ambang naik-turun dibedakan agar tidak bolak-balik. */
  if (ts - (water.last || 0) < (water.slow ? 32 : 15)) return;
  const t0 = performance.now();

  const W = stage.clientWidth, H = stage.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const dt = Math.min(0.06, ((ts - water.last) || 16) / 1000); water.last = ts;
  const f = Math.min(W / 1300, H / 731), rw = 1300 * f, rh = 731 * f;
  const rx = (W - rw) / 2, ry = (H - rh) / 2;
  const P = waterParams(), tmp = water.tmp, tx = tmp.getContext('2d');
  /* fase dimajukan sekali per peran, bukan per komponen mask */
  Object.keys(P).forEach(role => {
    if (WATER_TENANG.has(role)) return;   /* ruas tenang: fasenya tidak berjalan */
    /* Laju fase dari AKAR arus, bukan dari arus yang dijepit lantai 0,45 m/dtk.
     *
     * Lantai itu membekukan seluruh jaringan irigasi: arus sekunder 0,043-0,060 dan
     * ketiga tersier 0,236-0,400 m/dtk semuanya di BAWAH 0,45, jadi ketujuh ruas
     * memakai laju fase yang sama persis (44 / 71) di ketiga skenario. Hanya hulu &
     * hilir (0,31-1,04) yang pernah melewatinya. Ini kebalikan dari atap 6 detik yang
     * membekukan gores permukaan di skematik — di sana atap, di sini lantai.
     *
     * Pangkat 0,5 memetakan rentang arus yang benar-benar dipakai peta ini
     * (0,04-1,04 m/dtk, rentang 26x) ke laju fase 28-81 (rentang 2,9x):
     *
     *     sekunder  0,043 → 28      tersier  0,236 → 46      hulu  0,657 → 68
     *               0,060 → 30               0,400 → 56            1,039 → 81
     *
     * Lantai 0,20 tetap ada supaya ruas yang hampir mati masih beriak sedikit — air
     * yang benar-benar berhenti dinyatakan lewat warna kelas `kering`, bukan lewat
     * animasi yang membeku. */
    const spd = clamp(Math.sqrt(clamp(P[role].speed || 0, 0, 3)), 0.20, 1.75);
    water.phase[role] = (water.phase[role] || 0) + dt * (14 + spd * 66);
    water.phase[role + 'B'] = (water.phase[role + 'B'] || 0) + dt * (22 + spd * 108);
  });

  /* satu ukuran gelombang per peran supaya pecahan mask yang bersebelahan seragam */
  const roleDim = {};
  water.regions.forEach(r => {
    const d0 = Math.min(r.bw * rw, r.bh * rh);
    roleDim[r.role] = Math.max(roleDim[r.role] || 0, d0);
  });
  /* transform panggung (zoom + geser) dipakai untuk membuang region di luar layar */
  const zs = isoZoom.scale, ztx = isoZoom.tx, zty = isoZoom.ty;
  const toScreenX = (px) => W / 2 + (px - W / 2) * zs + ztx;
  const toScreenY = (py) => H / 2 + (py - H / 2) * zs + zty;

  water.regions.forEach(r => {
    const dw = Math.max(2, Math.round(r.bw * rw)), dh = Math.max(2, Math.round(r.bh * rh));
    const dx0 = rx + r.bx * rw, dy0 = ry + r.by * rh;
    const sx0 = toScreenX(dx0), sy0 = toScreenY(dy0);
    const sx1 = toScreenX(dx0 + dw), sy1 = toScreenY(dy0 + dh);
    if (sx1 < -40 || sy1 < -40 || sx0 > W + 40 || sy0 > H + 40) return;   /* di luar pandangan */

    const p = P[r.role] || P.hulu;

    /* ukuran kerja = ukuran tampil di layar, tidak pernah melebihi mask */
    const need = Math.min(2.2, Math.max(1, zs)) * dpr;
    const tw = Math.max(2, Math.min(Math.round(dw * need), r.canvas.width));
    const th = Math.max(2, Math.min(Math.round(dh * need), r.canvas.height));
    if (tmp.width < tw || tmp.height < th) { tmp.width = Math.max(tmp.width, tw); tmp.height = Math.max(tmp.height, th); }
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.globalCompositeOperation = 'source-over';
    tx.globalAlpha = 1;
    tx.clearRect(0, 0, tw, th);

    /* dasar rata: gradasi per pecahan bikin sambungan terlihat belang.
       Ruas tenang memakai WATER_BASE, bukan warna kelas: kelasnya pinjaman dari
       ruas lain, jadi menampilkannya justru menyesatkan. */
    const tenang = WATER_TENANG.has(r.role);
    tx.fillStyle = tenang ? WATER_BASE : p.color;
    tx.fillRect(0, 0, tw, th);

    const band = (pat, tile, phase, angle, alpha, mode, projOv) => {
      const co = Math.cos(angle), si = Math.sin(angle);
      const hx = (tw * Math.abs(co) + th * Math.abs(si)) / 2;
      const hy = (tw * Math.abs(si) + th * Math.abs(co)) / 2;
      const ws = clamp((roleDim[r.role] || Math.min(tw, th)) / 190, 0.3, 1);
      /* gelombang dijangkar ke posisi peta, bukan ke tiap pecahan,
         sehingga polanya menyambung antar pecahan mask */
      const sxp = tw / dw, syp = th / dh;
      const proj = projOv != null ? projOv
        : ((dx0 + dw / 2) * sxp) * co + ((dy0 + dh / 2) * syp) * si;
      tx.save();
      tx.globalCompositeOperation = mode;
      tx.globalAlpha = alpha;
      tx.translate(tw / 2, th / 2);
      tx.rotate(angle);
      tx.scale(ws, ws);
      tx.translate(-(((phase + proj) / ws) % tile.width), 0);
      tx.fillStyle = pat;
      tx.fillRect(-hx / ws, -hy / ws, (hx * 2) / ws + tile.width, (hy * 2) / ws);
      tx.restore();
    };
    const ang = r.ang != null ? r.ang : (WATER_ANGLE[r.role] || 0);
    if (tenang) {
      /* tanpa riak. Bayangan pohon & tepi di bawah tetap digambar — keduanya bagian
         dari bentuk airnya, bukan dari geraknya, dan tanpa itu ruas ini jadi bidang
         biru rata yang menempel aneh di antara tetangganya. */
    } else if (r.flow) {
      /* saluran membelok: tiap pita digambar dengan sudutnya sendiri.
         Jangkar fase memakai jarak sepanjang saluran, bukan proyeksi ke satu
         sumbu — kalau tidak, puncak gelombang patah di batas antar pita. */
      const sc = rw * (tw / dw);
      r.flow.forEach(fs => {
        tx.save();
        tx.beginPath();
        tx.moveTo(fs.q[0] * tw, fs.q[1] * th);
        for (let i = 2; i < 8; i += 2) tx.lineTo(fs.q[i] * tw, fs.q[i + 1] * th);
        tx.closePath();
        tx.clip();
        band(water.patA, water.rippleA, water.phase[r.role], fs.ang, 0.58, 'source-over', -fs.s * sc);
        band(water.patB, water.rippleB, water.phase[r.role + 'B'], fs.ang + 0.16, 0.4, 'source-over', -fs.s * sc);
        tx.restore();
      });
    } else {
      band(water.patA, water.rippleA, water.phase[r.role], ang, 0.58, 'source-over');
      band(water.patB, water.rippleB, water.phase[r.role + 'B'], ang + 0.16, 0.4, 'source-over');
    }

    /* bayangan pohon/tanggul dari render asli */
    if (r.shade) {
      tx.globalCompositeOperation = 'multiply';
      tx.globalAlpha = 0.85;
      tx.drawImage(r.shade, 0, 0, tw, th);
    }

    /* bayangan tepi (air lebih dangkal di pinggir) */
    tx.globalCompositeOperation = 'source-over';
    tx.globalAlpha = 0.3;
    tx.drawImage(r.rim, 0, 0, tw, th);

    tx.globalAlpha = 1;
    tx.globalCompositeOperation = 'destination-in';
    tx.imageSmoothingEnabled = true;
    tx.drawImage(r.canvas, 0, 0, tw, th);

    ctx.drawImage(tmp, 0, 0, tw, th, dx0, dy0, dw, dh);

    /* Penanda peran — lihat WATER_DEBUG. Digambar di ruang canvas yang sama dengan
       airnya, jadi ia ikut terzoom bersama panggung dan tetap menempel di pecahannya.
       Pecahan renik dilewati: labelnya lebih besar daripada airnya sendiri. */
    if (WATER_DEBUG && dw > 10 && dh > 6) {
      const lx = dx0 + dw / 2, ly = dy0 + dh / 2;
      ctx.save();
      ctx.font = '600 9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.fillStyle = WATER_TENANG.has(r.role) ? '#a11' : '#123';
      ctx.strokeText(r.role, lx, ly);
      ctx.fillText(r.role, lx, ly);
      ctx.restore();
    }
  });

  const cost = performance.now() - t0;
  water.cost = water.cost == null ? cost : water.cost * 0.88 + cost * 0.12;
  if (water.cost > 12) water.slow = true;
  else if (water.cost < 7) water.slow = false;
}

/* Mencampur dua warna hex (t: 0 = a, 1 = b). */
function mixColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const c = (sh) => Math.round((((pa >> sh) & 255) * (1 - t)) + (((pb >> sh) & 255) * t));
  return '#' + [c(16), c(8), c(0)].map(v => v.toString(16).padStart(2, '0')).join('');
}


/* =========================================================================
   TAB KARTU PETA — Isometrik / Skematik dalam satu panel
   ========================================================================= */
const MAP_PANE_NOTES = {
  iso:   'klik pin untuk melihat data pos',
  skema: 'tinggi kolom air = TMA terhadap tinggi tanggul ruas itu, daun pintu mengikuti bukaan aktual',
};

/* ---------------- Kartu yang bisa dilipat ----------------

   Tiap `.panel.collapsible` mendapat tombol panah di kepalanya, dan seluruh
   kepalanya jadi daerah klik untuk menutup / membuka isinya. Dipasang dari sini
   supaya markup di Blade tinggal menambahkan satu kelas — tidak ada tombol atau
   penangan yang perlu ditulis ulang tiap kali ada kartu baru yang perlu dilipat.

   Kepala panel bisa memuat kontrol lain (tombol, tab, tautan). Klik pada
   kontrol semacam itu TIDAK ikut melipat panel — kalau ikut, menekan "Kontrol
   Pintu" akan menutup kartunya sekalian. Itulah gunanya penyaringan `closest`
   di bawah.

   Keadaan buka/tutup diingat per browser lewat localStorage, dengan kunci dari
   `data-panel-key`. Panel tanpa kunci tetap bisa dilipat, hanya tidak diingat.
   Akses localStorage dibungkus try/catch: di jendela penyamaran atau saat
   penyimpanan situs diblokir, membacanya bisa melempar galat — kartunya tetap
   harus bekerja, cuma tanpa ingatan. */
const PANEL_LIPAT_KEY = 'wmsPanelTertutup';

function panelTertutupTersimpan() {
  try {
    const o = JSON.parse(localStorage.getItem(PANEL_LIPAT_KEY) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}
function simpanPanelTertutup(kunci, tertutup) {
  if (!kunci) return;
  try {
    const o = panelTertutupTersimpan();
    if (tertutup) o[kunci] = 1; else delete o[kunci];
    localStorage.setItem(PANEL_LIPAT_KEY, JSON.stringify(o));
  } catch (e) {}
}

function initCollapsiblePanels() {
  const tersimpan = panelTertutupTersimpan();

  document.querySelectorAll('.panel.collapsible').forEach(panel => {
    const head = panel.querySelector(':scope > .panel-head');
    const judul = head && head.querySelector('h2');
    if (!head || !judul || head.querySelector('.panel-toggle')) return;

    const kunci = panel.dataset.panelKey || '';
    const tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.className = 'panel-toggle';
    /* Panah tunggal yang berputar 90° saat tertutup (lihat wms.css) — satu
       bentuk untuk dua keadaan, jadi tidak ada ikon yang perlu ditukar. */
    tombol.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
    judul.appendChild(tombol);

    const terapkan = (tertutup, simpan) => {
      panel.classList.toggle('collapsed', tertutup);
      tombol.setAttribute('aria-expanded', String(!tertutup));
      tombol.title = tertutup ? 'Buka kartu' : 'Tutup kartu';
      tombol.setAttribute('aria-label', (tertutup ? 'Buka' : 'Tutup') + ' kartu ' + judul.textContent.trim());
      if (simpan) simpanPanelTertutup(kunci, tertutup);
    };
    terapkan(!!(kunci && tersimpan[kunci]), false);

    head.addEventListener('click', (e) => {
      /* Kontrol lain di kepala panel mengurus dirinya sendiri. Tombol panahnya
         SENDIRI dikecualikan dari daftar ini — ia memang harus melipat. */
      if (e.target.closest('a, input, select, textarea, .panel-tabs') ) return;
      if (e.target.closest('button') && !e.target.closest('.panel-toggle')) return;
      terapkan(!panel.classList.contains('collapsed'), true);
    });
  });
}

function initMapTabs() {
  const tabs = el('mapTabs'), card = el('mapPanelCard');
  if (!tabs || !card) return;
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.ptab');
    if (!btn || btn.classList.contains('active')) return;
    const pane = btn.dataset.pane;

    tabs.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b === btn));
    card.querySelectorAll('.map-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + pane));

    const note = el('mapNote');
    if (note) note.textContent = MAP_PANE_NOTES[pane] || '';

    /* Popup pos menempel pada koordinat layar pin, dan pane iso baru dapat
       ukuran setelah tampil — jadi tutup popup lalu hitung ulang tampilan. */
    closePosPop();
    if (pane === 'iso') {
      resetIsoView();
      requestAnimationFrame(resetIsoView);
    }
  });
}

function initIsoMapControls() {
  const scrollEl = el('isoScroll');
  resetIsoView();
  requestAnimationFrame(resetIsoView);
  el('mapZoomIn').addEventListener('click', () => { isoZoom.scale *= 1.18; applyIsoZoom(); });
  el('mapZoomOut').addEventListener('click', () => { isoZoom.scale /= 1.18; applyIsoZoom(); });
  el('mapReset').addEventListener('click', resetIsoView);
  el('mapEditPins').addEventListener('click', () => setPinEdit(!pinEdit));
  el('mapPetakEdit').addEventListener('click', () => setPetakEdit(!petakEdit));
  /* Satu pasang tombol untuk dua mode — sasarannya mode yang sedang menyala.
     Lihat tampilTombolSalin(). */
  el('mapPinsReset').addEventListener('click', () => (petakEdit ? resetPetakPos() : resetPinPos()));
  el('mapPinsCopy').addEventListener('click', () => (petakEdit ? copyPetakCoords() : copyPinCoords()));
  initPinDrag();
  initPetakSawah();
  el('mapLabelToggle').addEventListener('click', (e) => {
    const svg = el('isoSvg');
    svg.classList.toggle('labels-on');
    e.currentTarget.classList.toggle('on', svg.classList.contains('labels-on'));
    /* Dipaksa: selama label mati layoutIsoLabels() menolak jalan (getBBox nol pada
       tulisan yang belum tergambar), jadi penataan pertama harus terjadi di sini —
       sesudah kelasnya dipasang, bukan sebelumnya. */
    updatePetakLabels();
    layoutIsoLabels(true);
  });
  scrollEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dir = e.deltaY > 0 ? -1 : 1;
    isoZoom.scale *= 1 + dir * 0.08;
    applyIsoZoom();
  }, { passive: false });

  let dragging = false, lastX = 0, lastY = 0;
  scrollEl.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; scrollEl.classList.add('grabbing'); });
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    isoZoom.tx += e.clientX - lastX; isoZoom.ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyIsoZoom();
  });
  window.addEventListener('pointerup', () => { dragging = false; scrollEl.classList.remove('grabbing'); });

  /* Ukuran panel peta ikut breakpoint CSS (560 → 420 → 300 px) dan lebar
     jendela, sedangkan skala minimum serta batas geser dihitung sekali dari
     clientWidth. Jadi setiap layar berubah ukuran — ponsel diputar, jendela
     desktop ditarik — keduanya perlu dihitung ulang. Zoom pilihan pengguna
     tidak direset, cuma dijepit ulang ke batas yang baru. Ditunda sesaat
     supaya tidak jalan tiap piksel saat jendela ditarik. */
  let relayoutTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(relayoutTimer);
    relayoutTimer = setTimeout(() => { applyIsoZoom(); resizeCharts(); }, 160);
  });
}

