/**
 * Rapport PV mensuel : parties « Consommation du site » et « Évènements du mois ».
 * Fichier à AJOUTER au projet Apps Script de l'appli Consommations (nom : RapportPVSite), après Code.gs.
 * Il ne modifie pas Code.gs : il complète le rapport produit par pvRapportHtml_.
 *  - Consommation du site : onglet Conso_Site (élec soutirée Enedis, gaz GRDF), comparée à la production PV autoconsommée.
 *  - Évènements du mois : salons qui ont lieu dans le mois, avec leurs consommations (mêmes calculs que l'appli).
 */
(function () {
  var orig = globalThis.pvRapportHtml_;
  if (typeof orig !== 'function' || orig.__site) return;
  var w = function (R) {
    var h = orig.apply(this, arguments);
    var S = null, E = null;
    try { S = pvSiteMois_(R); } catch (e) { console.warn('Rapport PV, consommation site : ' + e); }
    try { E = pvEvenementsMois_(R); } catch (e) { console.warn('Rapport PV, évènements : ' + e); }
    // phrase ajoutée à la synthèse
    var phr = pvSitePhrase_(R, S, E);
    if (phr) h = h.replace('</p></div>', ' ' + phr + '</p></div>');
    // nouvelles parties, avant le cumul annuel
    var bloc = pvSiteHtml_(R, S, E);
    var i = h.indexOf('<h2>Cumul ');
    h = i >= 0 ? h.slice(0, i) + bloc + h.slice(i) : h.replace('</body>', bloc + '</body>');
    return h;
  };
  w.__site = true;
  globalThis.pvRapportHtml_ = w;
  // le classeur est remis à jour depuis Firebase avant le rapport (après la bascule)
  var pdf = globalThis.pvRapportPdf;
  if (typeof pdf === 'function' && !pdf.__cfbAvant) {
    var wp = function () {
      if (typeof cfbActif_ === 'function' && cfbActif_()) { try { cfbTirer_(cfbToken_()); } catch (e) { console.warn('Firebase → classeur : ' + e); } }
      return pdf.apply(this, arguments);
    };
    wp.__cfbAvant = true;
    globalThis.pvRapportPdf = wp;
  }
})();

/** Consommation du site sur le mois (MWh) : élec soutirée, gaz, autoconsommation PV, par jour */
function pvSiteMois_(R) {
  if (!ss_().getSheetByName('Conso_Site')) return null;
  SITE_ROWS_ = null;
  var site = {};
  siteRows_().forEach(function (r) {
    var d = iso_(r[0]); if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d.slice(0, 7) !== R.mois) return;
    var e = num_(r[3]), g = num_(r[6]);
    site[d] = { e: e === '' ? null : e, g: g === '' ? null : g };
  });
  var S = { elec: 0, gaz: 0, jE: 0, jG: 0, jours: [] };
  R.jours.forEach(function (j) {
    var s = site[j.d] || {}, pv = (j.park || 0) + (j.h43 || 0);
    if (s.e !== null && s.e !== undefined) { S.elec += s.e; S.jE++; }
    if (s.g !== null && s.g !== undefined) { S.gaz += s.g; S.jG++; }
    S.jours.push({ d: j.d, e: s.e === undefined ? null : s.e, g: s.g === undefined ? null : s.g, pv: (j.park !== null || j.h43 !== null) ? pv / 1000 : null });
  });
  if (!S.jE && !S.jG) return null;
  S.auto = R.auto !== null ? R.auto / 1000 : null;                     // MWh autoconsommés (parkings + hall 4.3)
  S.total = S.jE ? S.elec + (S.auto || 0) : null;                      // consommation élec du site = réseau + PV autoconsommé
  S.couverture = (S.total && S.auto !== null) ? S.auto / S.total : null; // part de la conso élec couverte par le PV
  return S;
}

/** Salons qui ont lieu dans le mois (au moins un jour entre le 1er et le dernier jour du mois) */
function pvEvenementsMois_(R) {
  var d0 = R.mois + '-01', d1 = R.mois + '-' + pvPad_(R.nbJ);
  var P = readParams_(), halls = readHalls_(), lignes = readLignes_(), salons = readSalons_();
  var dans = salons.filter(function (s) { return s.debut && s.fin && s.debut <= d1 && s.fin >= d0; });
  if (!dans.length) return { liste: [], jours: {} };
  var calc = salonsCalcules_(P, halls, lignes, dans, readReleves_(), readMeteo_(), readTemp_(P, halls));
  var jours = {};
  calc.forEach(function (s) {
    var a = Math.max(dayNum_(s.debut), dayNum_(d0)), b = Math.min(dayNum_(s.fin), dayNum_(d1));
    s.joursMois = b - a + 1;
    for (var d = a; d <= b; d++) (jours[isoFromDayNum_(d)] = jours[isoFromDayNum_(d)] || []).push(s.salon);
  });
  return { liste: calc, jours: jours };
}

function pvSitePhrase_(R, S, E) {
  var p = [];
  if (S && S.total !== null) {
    p.push('Le site a consommé <b>' + pvFr_(S.total, 1) + ' MWh</b> d\'électricité (dont ' + pvFr_(S.elec, 1) + ' MWh soutirés au réseau)' +
      (S.jG ? ' et <b>' + pvFr_(S.gaz, 1) + ' MWh</b> de gaz' : '') + '.');
    if (S.couverture !== null) p.push('Le PV autoconsommé en a couvert <b>' + pvFr_(S.couverture * 100, 1) + ' %</b>.');
  }
  if (E && E.liste.length) {
    var n = Object.keys(E.jours).length;
    p.push(E.liste.length + ' évènement' + (E.liste.length > 1 ? 's' : '') + ' sur ' + n + ' jour' + (n > 1 ? 's' : '') + ' du mois.');
  } else if (E) p.push('Aucun évènement dans le mois.');
  return p.join(' ');
}

function pvSiteHtml_(R, S, E) {
  var h = '<h2 class="brk">Consommation du site</h2>';
  if (!S) h += '<p class="muted">Pas de relevé de consommation du site (onglet Conso_Site) pour ce mois.</p>';
  else {
    h += chTuiles_([
      [pvFr_(S.jE ? S.elec : null, 1) + ' MWh', 'Élec soutirée au réseau (Enedis)'],
      [pvFr_(S.auto, 1) + ' MWh', 'PV autoconsommé (parkings + hall 4.3)'],
      [pvFr_(S.total, 1) + ' MWh', 'Consommation élec du site'],
      [pvFr_(S.couverture === null ? null : S.couverture * 100, 1) + ' %', 'Part couverte par le PV'],
      [pvFr_(S.jG ? S.gaz : null, 1) + ' MWh', 'Gaz (GRDF)'],
      [pvFr_(S.jE ? S.elec / S.jE : null, 2) + ' MWh', 'Élec réseau moyenne par jour'],
      [pvFr_(R.jInj ? R.inj / 1000 : null, 1) + ' MWh', 'PV injecté sur le réseau'],
      [(S.jE < R.nbJ ? S.jE + ' / ' + R.nbJ : R.nbJ) + ' j', 'Jours avec relevé de consommation']
    ], 4);
    // jours avec / sans évènement
    if (E && S.jE) {
      var a = { e: 0, n: 0 }, b = { e: 0, n: 0 };
      S.jours.forEach(function (j) { if (j.e === null) return; var x = E.jours[j.d] ? a : b; x.e += j.e; x.n++; });
      if (a.n && b.n) h += '<div class="syn"><p>Élec soutirée en moyenne <b>' + pvFr_(a.e / a.n, 2) + ' MWh/jour</b> les jours d\'évènement (' + a.n + ' j) contre <b>' +
        pvFr_(b.e / b.n, 2) + ' MWh/jour</b> les autres jours (' + b.n + ' j).</p></div>';
    }
    h += pvChartPng_(pvChartSite_, { S: S, E: E });
    if (S.jE < R.nbJ) h += '<div class="note">Consommation du site : ' + (R.nbJ - S.jE) + ' jour(s) sans relevé dans Conso_Site.</div>';
  }

  h += '<h2>Évènements du mois</h2>';
  if (!E || !E.liste.length) h += '<p class="muted">Aucun évènement dans le mois.</p>';
  else {
    h += '<table><tr><th class="l">Évènement</th><th class="l">Dates</th><th>Jours</th><th>Surface (m²)</th><th>Élec halls (MWh)</th><th>dont CVC</th><th>Élec parc (MWh)</th><th>Gaz (MWh)</th><th>kWh/m²/DJU</th></tr>';
    E.liste.forEach(function (s) {
      var o = s.ind;
      h += '<tr><td class="l">' + pvEsc_(s.salon) + '</td><td class="l">' + dcourt_(s.debut) + ' → ' + dcourt_(s.fin) + '</td><td>' + s.joursMois + (s.joursMois !== o.jours ? ' / ' + o.jours : '') +
        '</td><td>' + pvFr_(o.surfaceLouee || null, 0) + '</td><td>' + pvFr_(o.lignesSaisies ? o.elec : null, 1) + '</td><td>' + pvFr_(o.lignesSaisies ? o.cvc : null, 1) +
        '</td><td>' + pvFr_(s.elecParc === '' ? null : s.elecParc, 1) + '</td><td>' + pvFr_(s.gaz === '' ? null : s.gaz, 1) + '</td><td>' + (typeof o.kwhM2DJU === 'number' ? pvFr_(o.kwhM2DJU, 3) : 'n.s.') + '</td></tr>';
    });
    h += '</table><p class="muted">Jours : jours de l\'évènement dans le mois (/ durée totale s\'il déborde sur un autre mois). Élec halls et CVC : index des TGBT relevés avant / après l\'évènement. ' +
      'Élec parc et gaz : compteurs Enedis et GRDF du site sur les jours de l\'évènement (comptés pour chaque évènement s\'ils se chevauchent).</p>';
  }
  return h;
}

/** Graphique : élec soutirée et PV autoconsommé par jour (MWh) ; « • » = jour d'évènement */
function pvChartSite_(X) {
  var S = X.S, E = X.E;
  if (!S.jE) return null;
  var dt = Charts.newDataTable().addColumn(Charts.ColumnType.STRING, 'Jour')
    .addColumn(Charts.ColumnType.NUMBER, 'Élec soutirée réseau').addColumn(Charts.ColumnType.NUMBER, 'PV autoconsommé');
  S.jours.forEach(function (j) {
    dt.addRow([String(+j.d.slice(8)) + (E && E.jours[j.d] ? '•' : ''), Math.round((j.e || 0) * 1000) / 1000, Math.round((j.pv || 0) * 1000) / 1000]);
  });
  return Charts.newColumnChart().setDataTable(dt.build()).setStacked().setColors([CH.ardoise, CH.vert])
    .setDimensions(1000, 320).setLegendPosition(Charts.Position.BOTTOM).setYAxisTitle('MWh / jour')
    .setTitle('Consommation élec du site par jour (MWh) — • jour d\'évènement').build();
}
