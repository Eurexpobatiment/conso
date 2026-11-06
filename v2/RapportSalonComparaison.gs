/**
 * Rapport PDF d'un salon : partie « Comparaison avec les éditions précédentes ».
 * Fichier à AJOUTER au projet Apps Script de l'appli Consommations (nom : RapportSalonComparaison), après Code.gs.
 * Il ne modifie pas Code.gs : il complète le rapport produit par rapportHtml_.
 * Les éditions précédentes sont retrouvées par le nom du salon (mêmes règles que la fiche salon de l'appli) :
 * au moins la moitié des mots en commun, ou un mot commun et des dates proches (moins de 30 jours d'une année sur l'autre).
 */
(function () {
  var orig = globalThis.rapportHtml_;
  if (typeof orig === 'function' && !orig.__comp) {
    var w = function (R) {
      var E = [];
      try { E = rsEditions_(R.s); } catch (e) { console.warn('Rapport salon, comparaison : ' + e); }
      if (E.length && R.comm && Array.isArray(R.comm.synthese)) { var p = rsPhrase_(R.s, E[0]); if (p) R.comm.synthese.push(p); }
      var h = orig.apply(this, arguments);
      if (!E.length) return h;
      var bloc = rsHtml_(R.s, E);
      var i = h.indexOf('<h2>Détail jour par jour</h2>');
      return i >= 0 ? h.slice(0, i) + bloc + h.slice(i) : h.replace('</body>', bloc + '</body>');
    };
    w.__comp = true;
    globalThis.rapportHtml_ = w;
  }
  // Élec parc / gaz : ne pas effacer les valeurs saisies des salons dont Conso_Site n'a aucun jour (ex. salons 2025)
  var maj = globalThis.majElecGazParc_;
  if (typeof maj === 'function' && !maj.__garde) {
    var wm = function () {
      if (!ss_().getSheetByName('Conso_Site')) return 0;
      var jours = {};
      siteRows_().forEach(function (r) {
        var d = iso_(r[0]); if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        var e = num_(r[3]), g = num_(r[6]);
        if (e === '' && g === '') return;
        jours[d] = { e: e === '' ? 0 : e, g: g === '' ? 0 : g };
      });
      var sh = sheet_(SH.SALONS), v = sh.getDataRange().getValues(), head = v[0];
      var cD = head.indexOf('Debut'), cF = head.indexOf('Fin'), cE = head.indexOf('ElecParc'), cG = head.indexOf('Gaz');
      if (cD < 0 || cF < 0 || cE < 0 || cG < 0) return 0;
      var n = 0;
      for (var i = 1; i < v.length; i++) {
        var deb = iso_(v[i][cD]), fin = iso_(v[i][cF]);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deb) || !/^\d{4}-\d{2}-\d{2}$/.test(fin)) continue;
        var e = 0, g = 0, nb = 0;
        for (var d = dayNum_(deb); d <= dayNum_(fin); d++) { var j = jours[isoFromDayNum_(d)]; if (j) { e += j.e; g += j.g; nb++; } }
        if (!nb) continue; // aucun jour relevé : valeurs saisies gardées
        var ve = Math.round(e * 1000) / 1000, vg = Math.round(g * 1000) / 1000;
        if (num_(v[i][cE]) !== ve) { sh.getRange(i + 1, cE + 1).setValue(ve); n++; }
        if (num_(v[i][cG]) !== vg) { sh.getRange(i + 1, cG + 1).setValue(vg); n++; }
      }
      try { n += majPvParking_(); } catch (e2) { console.warn('majPvParking_ : ' + e2); }
      return n;
    };
    wm.__garde = true;
    globalThis.majElecGazParc_ = wm;
  }
})();

var RS_MOTS_VIDES = ['salon', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'lyon', 'eurexpo', 'en', 'au', 'a'];
function rsMots_(nom) {
  return String(nom || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
    .filter(function (m) { return m && RS_MOTS_VIDES.indexOf(m) < 0; });
}

/** Éditions précédentes du salon s (une par année, la plus ressemblante), de la plus récente à la plus ancienne */
function rsEditions_(s) {
  if (!s || !s.debut) return [];
  var a = rsMots_(s.salon); if (!a.length) return [];
  var P = readParams_(), halls = readHalls_(), salons = readSalons_();
  var parAn = {};
  salons.forEach(function (x) {
    if (!x.debut || x.id === s.id || x.debut.slice(0, 4) >= s.debut.slice(0, 4)) return;
    var b = rsMots_(x.salon), inter = a.filter(function (m) { return b.indexOf(m) >= 0; }).length;
    if (!inter) return;
    var jac = inter / (a.length + b.length - inter);
    var ecart = Math.abs(((dayNum_(s.debut) - dayNum_(x.debut)) % 365.25 + 365.25 + 182) % 365.25 - 182);
    if (jac < 0.5 && ecart > 30) return;
    var sc = jac + (ecart <= 30 ? 0.5 : 0), an = x.debut.slice(0, 4);
    if (!parAn[an] || sc > parAn[an].sc) parAn[an] = { sc: sc, x: x };
  });
  var choisis = Object.keys(parAn).sort().reverse().map(function (an) { return parAn[an].x; });
  if (!choisis.length) return [];
  return salonsCalcules_(P, halls, readLignes_(), choisis, readReleves_(), readMeteo_(), readTemp_(P, halls))
    .sort(function (x, y) { return x.debut < y.debut ? 1 : -1; });
}

function rsVal_(x) {
  var o = x.ind, f = x.fige === 'OUI', manque = function (k) { return f && (x[k] === '' || x[k] === null || x[k] === undefined); };
  return {
    an: x.debut.slice(0, 4), salon: x.salon, debut: x.debut, fin: x.fin, jours: o.jours, surface: o.surfaceLouee, elec: o.elec,
    cvc: manque('fCVC') ? '' : o.cvc, elecParc: x.elecParc, gaz: x.gaz, elecGaz: o.elecGaz, djuJour: o.djuJour, kwhM2Jour: o.kwhM2Jour,
    kwhM2DJU: manque('fCVC') ? '' : o.kwhM2DJU, tMoy: o.temp && isN_(o.temp.moy) ? o.temp.moy : '', fige: f
  };
}
function rsEcart_(a, b) { return isN_(a) && isN_(b) && b !== 0 ? a / b - 1 : null; }

/** Phrase ajoutée à la synthèse : évolution par rapport à l'édition précédente */
function rsPhrase_(s, p) {
  var A = rsVal_(s), B = rsVal_(p), t = [];
  var add = function (lib, k) { var e = rsEcart_(A[k], B[k]); if (e !== null) t.push(lib + ' ' + pc_(e, true)); };
  add('électricité des halls', 'elec'); add('gaz', 'gaz'); add('surface louée', 'surface'); add('kWh/m²/jour', 'kwhM2Jour');
  if (!t.length) return '';
  return 'Par rapport à l\'édition ' + B.an + ' (' + h_(B.salon) + ', ' + dfr_(B.debut) + ' au ' + dfr_(B.fin) + ') : ' + t.join(', ') + '.';
}

function rsHtml_(s, E) {
  var L = [rsVal_(s)].concat(E.map(rsVal_));
  var cols = [['Jours', 'jours', 0], ['Surface (m²)', 'surface', 0], ['Élec halls (MWh)', 'elec', 1], ['dont CVC', 'cvc', 1], ['Élec parc (MWh)', 'elecParc', 1],
    ['Gaz (MWh)', 'gaz', 1], ['Élec + gaz (MWh)', 'elecGaz', 1], ['DJU / jour', 'djuJour', 2], ['kWh/m²/jour', 'kwhM2Jour', 2], ['kWh/m²/DJU', 'kwhM2DJU', 3], ['T halls (°C)', 'tMoy', 1]];
  var h = '<h2 class="brk">Comparaison avec les éditions précédentes</h2>';
  h += '<table><tr><th class="l">Édition</th><th class="l">Dates</th>' + cols.map(function (c) { return '<th>' + c[0] + '</th>'; }).join('') + '</tr>';
  L.forEach(function (x, i) {
    h += '<tr' + (i === 0 ? ' class="hl"' : '') + '><td class="l">' + x.an + (x.fige && i > 0 ? '*' : '') + '</td><td class="l">' + dcourt_(x.debut) + ' → ' + dcourt_(x.fin) + '</td>' +
      cols.map(function (c) { var v = x[c[1]]; return '<td>' + (isN_(v) ? fr_(v, c[2]) : '—') + '</td>'; }).join('') + '</tr>';
  });
  // écart avec l'édition précédente
  var A = L[0], B = L[1];
  h += '<tr class="tot"><td class="l" colspan="2">Écart ' + A.an + ' / ' + B.an + '</td>' +
    cols.map(function (c) { var e = c[1] === 'tMoy' ? (isN_(A.tMoy) && isN_(B.tMoy) ? A.tMoy - B.tMoy : null) : rsEcart_(A[c[1]], B[c[1]]);
      return '<td>' + (e === null ? '' : (c[1] === 'tMoy' ? (e > 0 ? '+' : '') + fr_(e, 1) + ' °C' : pc_(e, true))) + '</td>'; }).join('') + '</tr></table>';
  h += '<p class="muted">Éditions retrouvées par le nom du salon. Ratios recalculés avec les mêmes formules pour toutes les années ' +
    '(kWh/m²/jour sur élec halls + gaz, kWh/m²/DJU sur CVC + gaz). ' +
    (L.some(function (x, i) { return i > 0 && x.fige; }) ? '* valeurs figées (reprises des classeurs des années précédentes ; CVC non relevé quand « — »). ' : '') +
    'Élec parc et gaz : compteurs Enedis et GRDF du site sur les jours du salon.</p>';
  if (L.length >= 2) h += chartImg_(rsChart_, L);
  return h;
}

/** Graphique : kWh/m²/jour et électricité + gaz par édition */
function rsChart_(L) {
  var dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'Édition').addColumn(Charts.ColumnType.NUMBER, 'kWh/m²/jour (élec + gaz)');
  L.slice().reverse().forEach(function (x) { dt.addRow([x.an, isN_(x.kwhM2Jour) ? Math.round(x.kwhM2Jour * 100) / 100 : 0]); });
  return Charts.newColumnChart().setDataTable(dt.build()).setColors([CH.vert]).setDimensions(700, 260)
    .setLegendPosition(Charts.Position.NONE).setYAxisTitle('kWh/m²/jour').setTitle('Intensité énergétique par édition (kWh/m²/jour, élec halls + gaz)').build();
}
