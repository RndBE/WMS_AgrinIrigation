<div class="view {{ $activeView === 'kontrol' ? 'active' : '' }}" id="view-kontrol">
  <div class="panel">
    <div class="panel-head">
      <h2>Skenario Kondisi Sumber Hulu</h2>
      <span class="note">input hidrograf untuk menguji respons kendali seluruh jaringan</span>
    </div>
    <div class="panel-body" id="kontrolBodyWrap">
      <p style="font-size:13.5px;color:var(--text-2);margin:0 0 12px;">
        Memodelkan kondisi debit alami sungai hulu. Skenario mengalikan seluruh debit &amp; TMA data dummy secara seragam,
        jadi neraca airnya tetap tertutup: <b>Hujan</b> menaikkan kelas aliran ke Deras&ndash;Genangan dan status sawah ke Lebih,
        <b>Kering</b> menurunkannya ke Kurang. Kelas <b>Kering</b> pada satu ruas hanya muncul bila pintunya benar-benar ditutup.
      </p>
      <div class="scenario-row">
        <button id="scNormal" class="on">Normal</button>
        <button id="scFlood">Hujan / Banjir</button>
        <button id="scDrought">Kering / Kemarau</button>
      </div>
    </div>
  </div>
  <div class="panel">
    <div class="panel-head">
      <h2>Kendali Pintu — Primer, Sekunder &amp; Tersier</h2>
      <span class="note">mode Auto mengikuti target; Manual mengunci bukaan pada nilai operator</span>
    </div>
    <div class="panel-body" id="controlBody"></div>
  </div>
</div>
