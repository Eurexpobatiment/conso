/* Consommations Halls – calculs (version Firebase)
 * Reprise à l'identique des calculs du script Google (Code.gs) : lignes de comptage, agrégats CVC / FM / ECL,
 * indicateurs des salons (DJU, kWh/m²/DJU, prévision, hors talon), températures, aide à la saisie des index.
 * Les données viennent de Firebase au lieu du classeur ; les formules sont les mêmes.
 */
(function (root) {
  'use strict';
  var TZ = 'Europe/Paris';
  var SALON_KEYS = ['id', 'salon', 'debut', 'fin', 'confort', 'halls', 'surface', 'elecParc', 'pv', 'gaz',
    'djuForces', 'elecMontage', 'joursMontage', 'dateAvant', 'dateApres', 'fige', 'fElec', 'fCVC', 'fFM', 'fECL', 'notes'];
  var SALON_NUM = ['surface', 'elecParc', 'pv', 'gaz', 'djuForces', 'elecMontage', 'joursMontage', 'fElec', 'fCVC', 'fFM', 'fECL'];
  var LIGNE_KEYS = ['id', 'ordre', 'tgbt', 'ligne', 'nb', 'coefs', 'total', 'usage', 'actif'];

  /* ---------- utilitaires (mêmes règles que le script) ---------- */
  function aujourdhui() {
    try { return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  }
  function maintenant() {
    try {
      var p = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      return p.replace('T', ' ').slice(0, 16);
    } catch (e) { return aujourdhui(); }
  }
  function iso_(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (Object.prototype.toString.call(v) === '[object Date]') {
      if (isNaN(v.getTime())) return '';
      return new Intl.DateTimeFormat('sv-SE', { timeZone: TZ }).format(v);
    }
    var s = String(v).trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return s;
  }
  function num_(v) {
    if (v === '' || v === null || v === undefined) return '';
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
    return isNaN(n) ? '' : n;
  }
  function n0_(v) { var n = num_(v); return n === '' ? 0 : n; }
  function dayNum_(isoDate) { var p = isoDate.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function isoFromDayNum_(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }
  function estJour(d) { return /^\d{4}-\d{2}-\d{2}$/.test(d || ''); }

  /* ---------- lecture des données Firebase (équivalent des onglets du classeur) ---------- */

  /** D = { params:{Annee:..}, halls:[{hall,surface}], lignes:[{id,ordre,tgbt,ligne,nb,coefs,total,usage,actif}],
   *        corr:{hall:[colonnes]}, salons:[{id,...}], releves:{salonId:{ligneId:{av,ap,maj}}},
   *        srv:{meteo, hist, site, parking, h43, meteoMaj, meteoCleOk, sheetUrl}, logo, temp:{rows, cols, seuilBas, seuilHaut, url} } */
  function readParams(D) {
    var p = D.params || {}, s = D.srv || {};
    return {
      annee: n0_(p.Annee) || new Date().getFullYear(),
      talon: n0_(p.Talon),
      baseDJU: num_(p.BaseDJU) === '' ? 18 : num_(p.BaseDJU),
      seuilDJF: num_(p.SeuilDJF) === '' ? 25 : num_(p.SeuilDJF),
      coeffPrev: n0_(p.CoeffPrev),
      djuMini: num_(p.DJUmini) === '' ? -10 : num_(p.DJUmini),
      djuNegatifs: String(p.DJUnegatifs || 'OUI').toUpperCase() === 'NON' ? 'NON' : 'OUI',
      confortMin: num_(p.ConfortMin), confortMax: num_(p.ConfortMax),
      meteoStation: String(p.MeteoStation || '69029001'),
      tempSheetId: String(p.TempSheetId || '').trim(),
      meteoMaj: (function () { var a = String(s.meteoMaj || ''), b = String((D.meteoEtat && D.meteoEtat.maj) || ''); return b > a ? b : a; })(),
      meteoCleOk: !!s.meteoCleOk
    };
  }
  function readHalls(D) {
    return (D.halls || []).filter(function (h) { return h && String(h.hall || '').trim(); })
      .map(function (h) { return { hall: String(h.hall).trim(), surface: n0_(h.surface) }; });
  }
  /** Ligne de comptage brute (comme une ligne de l'onglet Compteurs) → tableau r[0..8] */
  function ligneRow(L) { return LIGNE_KEYS.map(function (k) { var v = L[k]; return v === undefined || v === null ? '' : v; }); }
  function parseLigne(r) {
    var nb = Math.max(1, Math.min(5, n0_(r[4]) || 1));
    var coefs = String(r[5] === '' ? '1' : r[5]).split(';').map(function (c) { var n = num_(c); return n === '' ? 1 : n; });
    while (coefs.length < nb) coefs.push(1);
    var tot = String(r[6] || '').trim().toUpperCase();
    var totMask = [];
    for (var i = 0; i < nb; i++) totMask.push(tot === 'OUI' ? 1 : 0);
    if (tot && tot !== 'OUI' && tot !== 'NON') {
      tot.split(/[,;\s]+/).forEach(function (k) { var j = parseInt(k, 10) - 1; if (j >= 0 && j < nb) totMask[j] = 1; });
    }
    return {
      id: String(r[0]), ordre: n0_(r[1]), tgbt: String(r[2]), ligne: String(r[3]), nb: nb,
      coefs: coefs.slice(0, nb), totMask: totMask, total: tot, usage: String(r[7] || '').trim().toUpperCase()
    };
  }
  function readLignes(D) {
    return (D.lignes || []).map(ligneRow).filter(function (r) { return String(r[8]).toUpperCase() !== 'NON' && String(r[0]) !== ''; })
      .map(parseLigne).sort(function (a, b) { return a.ordre - b.ordre; });
  }
  function readSalons(D) {
    return (D.salons || []).map(function (raw) {
      var s = {};
      SALON_KEYS.forEach(function (k) { s[k] = raw[k] === undefined || raw[k] === null ? '' : raw[k]; });
      s.id = String(s.id);
      ['debut', 'fin', 'dateAvant', 'dateApres'].forEach(function (k) { s[k] = iso_(s[k]); });
      SALON_NUM.forEach(function (k) { s[k] = num_(s[k]); });
      s.confort = String(s.confort || '').toUpperCase();
      s.fige = String(s.fige || '').toUpperCase() === 'OUI' ? 'OUI' : 'NON';
      s.halls = String(s.halls || '');
      s.salon = String(s.salon);
      s.notes = String(s.notes || '');
      return s;
    });
  }
  function readReleves(D) {
    var out = [], R = D.releves || {};
    Object.keys(R).forEach(function (sid) {
      var L = R[sid] || {};
      Object.keys(L).forEach(function (lid) {
        var x = L[lid] || {}, av = x.av || [], ap = x.ap || [];
        var a5 = [0, 1, 2, 3, 4].map(function (i) { return num_(av[i]); }), b5 = [0, 1, 2, 3, 4].map(function (i) { return num_(ap[i]); });
        if (a5.concat(b5).every(function (v) { return v === ''; })) return;
        out.push({ salon: String(sid), ligne: String(lid), maj: String(x.maj || ''), av: a5, ap: b5 });
      });
    });
    return out;
  }
  function readMeteo(D) {
    // météo du script (classeur), complétée / remplacée par celle de Firebase (fonction conso-api ou saisie dans l'appli)
    var m = {}, src = Object.assign({}, (D.srv && D.srv.meteo) || {}, D.meteoFb || {});
    Object.keys(src).forEach(function (d) {
      var r = src[d], tx = num_(r.tx), tn = num_(r.tn);
      if (d && tx !== '' && tn !== '') m[d] = { tx: tx, tn: tn, src: String(r.src || '') };
    });
    return m;
  }

  /* ---------- Élec parc / gaz (Conso_Site) et PV parking : comme majElecGazParc_ du script ---------- */
  function appliquerSite(salons, D) {
    var srv = D.srv || {};
    var site = srv.site || [], jours = {};
    site.forEach(function (r) {
      if (!estJour(r.d)) return;
      if ((r.e === null || r.e === undefined) && (r.g === null || r.g === undefined)) return;
      jours[r.d] = { e: r.e == null ? 0 : r.e, g: r.g == null ? 0 : r.g };
    });
    var park = srv.parking || {};
    salons.forEach(function (s) {
      if (!estJour(s.debut) || !estJour(s.fin)) return;
      if (srv.siteOk) {
        var e = 0, g = 0, nb = 0;
        for (var d = dayNum_(s.debut); d <= dayNum_(s.fin); d++) { var j = jours[isoFromDayNum_(d)]; if (j) { e += j.e; g += j.g; nb++; } }
        // jours relevés dans Conso_Site : valeurs recalculées ; aucun jour (ex. salons d'avant 2026) : valeurs saisies gardées
        if (nb) { s.elecParc = Math.round(e * 1000) / 1000; s.gaz = Math.round(g * 1000) / 1000; }
      }
      var t = 0, n = 0;
      for (var k = dayNum_(s.debut); k <= dayNum_(s.fin); k++) { var v = park[isoFromDayNum_(k)]; if (v !== undefined && v !== null) { t += v; n++; } }
      if (n) s.pv = Math.round(t) / 1000;
    });
    return salons;
  }

  /* ---------- Températures (relevés Dalkia dans Firebase) ---------- */
  function normHall_(h) { return String(h || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9.]/g, ''); }
  function defaultCorr_(hallNames, tempCols) {
    var special = {
      acceuil: ['Accueil / Salles Mezzanine'], accueil: ['Accueil / Salles Mezzanine'], pdl: ['Place des Lumières'],
      'hall4.2a': ['Hall 4.2 Nord'], 'hall4.2b': ['Hall 4.2 Sud'], 'hall4.2c': ['Hall 4.2 Sud'],
      'hall7a': ['Hall 7 Nord'], 'hall7b': ['Hall 7 Sud']
    };
    var res = {};
    hallNames.forEach(function (h) {
      var n = normHall_(h), out = [];
      if (special[n]) out = special[n].filter(function (c) { return tempCols.indexOf(c) >= 0; });
      if (!out.length) {
        tempCols.forEach(function (c) {
          var tok = String(c).split(/\s+/), acc = '';
          for (var k = 0; k < tok.length; k++) {
            acc += normHall_(tok[k]);
            if (acc === n) { out.push(c); break; }
            if (acc.length > n.length) break;
          }
        });
      }
      res[h] = out;
    });
    return res;
  }
  /** Correspondance enregistrée ; les halls sans colonne reçoivent la proposition par défaut ; un hall jamais enregistré aussi. */
  function readCorr(D, halls, tempCols) {
    var src = D.corr || {}, corr = {}, vides = [];
    halls.forEach(function (h) {
      var c = src[h.hall];
      corr[h.hall] = Array.isArray(c) ? c.filter(String) : [];
      if (!corr[h.hall].length) vides.push(h.hall);
    });
    if (vides.length) {
      var def = defaultCorr_(vides, tempCols);
      vides.forEach(function (h) { if (def[h] && def[h].length) corr[h] = def[h]; });
    }
    return corr;
  }
  function readTemp(D, halls) {
    var t = D.temp;
    if (!t) return { err: 'Relevés de température pas encore chargés.' };
    if (t.err) return { err: t.err };
    return { rows: t.rows, cols: t.cols, seuilBas: t.seuilBas, seuilHaut: t.seuilHaut, corr: readCorr(D, halls, t.cols), url: t.url };
  }
  function tempSalon_(s, T, P) {
    if (!T || T.err || !s.debut || !s.fin) return null;
    var hs = s.halls ? s.halls.split(/\s*,\s*/).filter(String) : [];
    if (!hs.length) return { nRel: 0, sansHalls: true };
    var lo = num_(P.confortMin !== undefined && P.confortMin !== '' ? P.confortMin : T.seuilBas);
    var hi = num_(P.confortMax !== undefined && P.confortMax !== '' ? P.confortMax : T.seuilHaut);
    var parHall = {}, parJour = {}, all = [], nRel = 0, nonRelies = [];
    hs.forEach(function (h) { if (!(T.corr[h] && T.corr[h].length)) nonRelies.push(h); });
    T.rows.forEach(function (r) {
      if (r.day < s.debut || r.day > s.fin) return;
      var used = false, vus = {};
      hs.forEach(function (h) {
        (T.corr[h] || []).forEach(function (c) {
          var x = r.vals[c]; if (x === undefined) return;
          used = true;
          var dejaVu = vus[c]; vus[c] = 1;
          var ph = parHall[h] = parHall[h] || { n: 0, sum: 0, min: Infinity, max: -Infinity, ok: 0 };
          ph.n++; ph.sum += x; ph.min = Math.min(ph.min, x); ph.max = Math.max(ph.max, x);
          if (lo !== '' && hi !== '' && x >= lo && x <= hi) ph.ok++;
          if (dejaVu) return;
          all.push(x);
          var pj = parJour[r.day] = parJour[r.day] || { n: 0, sum: 0, min: Infinity, max: -Infinity };
          pj.n++; pj.sum += x; pj.min = Math.min(pj.min, x); pj.max = Math.max(pj.max, x);
        });
      });
      if (used) nRel++;
    });
    var o = { nRel: nRel, nVal: all.length, seuilBas: lo, seuilHaut: hi, nonRelies: nonRelies };
    if (!all.length) return o;
    var sum = 0, froid = 0, chaud = 0, ok = 0;
    all.forEach(function (x) { sum += x; if (lo !== '' && x < lo) froid++; else if (hi !== '' && x > hi) chaud++; else ok++; });
    o.moy = sum / all.length; o.min = Math.min.apply(null, all); o.max = Math.max.apply(null, all);
    if (lo !== '' && hi !== '') { o.pctConfort = ok / all.length; o.pctFroid = froid / all.length; o.pctChaud = chaud / all.length; }
    o.halls = hs.filter(function (h) { return parHall[h]; }).map(function (h) {
      var x = parHall[h]; return { hall: h, n: x.n, moy: x.sum / x.n, min: x.min, max: x.max, pctConfort: (lo !== '' && hi !== '') ? x.ok / x.n : '' };
    });
    o.jours = Object.keys(parJour).sort().map(function (d) { var x = parJour[d]; return { date: d, moy: x.sum / x.n, min: x.min, max: x.max, n: x.n }; });
    return o;
  }

  /* ---------- calculs ---------- */
  function consoLigne_(L, rel) {
    var parCpt = [], total = 0, totalHall = 0, complet = true, vide = true;
    for (var i = 0; i < L.nb; i++) {
      var a = rel ? rel.ap[i] : '', b = rel ? rel.av[i] : '';
      if (a !== '' || b !== '') vide = false;
      if ((a === '') !== (b === '')) complet = false;
      var c = (a !== '' && b !== '') ? (a - b) * L.coefs[i] : 0;
      parCpt.push(c); total += c;
      if (L.totMask[i]) totalHall += c;
    }
    return { parCpt: parCpt, total: total, totalHall: totalHall, complet: complet, vide: vide };
  }
  function agregats_(lignes, relBySalon, salonId) {
    var rel = relBySalon[salonId] || {};
    var r = { elec: 0, cvc: 0, fm: 0, ecl: 0, pv: 0, lignesSaisies: 0, lignesIncompletes: 0, negatifs: 0, parTgbt: {}, ordreTgbt: [] };
    lignes.forEach(function (L) {
      var c = consoLigne_(L, rel[L.id]);
      if (c.vide) return;
      r.lignesSaisies++;
      if (!c.complet) r.lignesIncompletes++;
      if (c.complet && c.total < -1e-9) r.negatifs++;
      r.elec += c.totalHall;
      var k = L.tgbt || '—';
      if (!r.parTgbt[k]) { r.parTgbt[k] = { tgbt: k, elec: 0, cvc: 0, fm: 0, ecl: 0 }; r.ordreTgbt.push(k); }
      var t = r.parTgbt[k];
      t.elec += c.totalHall;
      if (L.usage === 'CVC') t.cvc += c.total;
      else if (L.usage === 'FM') t.fm += c.total;
      else if (L.usage === 'ECL') t.ecl += c.total;
      if (L.usage === 'CVC') r.cvc += c.total;
      else if (L.usage === 'FM') r.fm += c.total;
      else if (L.usage === 'ECL') r.ecl += c.total;
      else if (L.usage === 'PV') r.pv += c.total;
    });
    return r;
  }
  function pvH43Periode_(D, d0, d1) {
    if (!d0 || !d1) return null;
    var J = (D.srv && D.srv.h43) || {}, tot = 0, a = dayNum_(d0), b = dayNum_(d1);
    if (!(b >= a)) return null;
    for (var d = a; d <= b; d++) { var v = J[isoFromDayNum_(d)]; if (v === undefined || v === null) return null; tot += v; }
    return tot / 1000;
  }
  function djuJour_(m, P) {
    var tmoy = (m.tx + m.tn) / 2;
    var dju = P.baseDJU - tmoy, djf = tmoy - P.seuilDJF;
    if (P.djuNegatifs !== 'OUI') { dju = Math.max(0, dju); djf = Math.max(0, djf); }
    return { tmoy: tmoy, dju: dju, djf: djf };
  }
  function indicateurs_(D, s, ag, P, hallsSurf, meteo, T) {
    var o = {};
    o.jours = (s.debut && s.fin) ? dayNum_(s.fin) - dayNum_(s.debut) + 1 : '';
    var hs = s.halls ? s.halls.split(/\s*,\s*/).filter(String) : [];
    o.surfaceHalls = hs.reduce(function (t, h) { return t + (hallsSurf[h] || 0); }, 0);
    o.surfaceLouee = o.surfaceHalls > 0 ? o.surfaceHalls : n0_(s.surface);
    o.calcule = { elec: ag.elec, cvc: ag.cvc, fm: ag.fm, ecl: ag.ecl };
    o.parTgbt = (ag.ordreTgbt || []).map(function (k) { var t = ag.parTgbt[k]; t.autres = t.elec - t.cvc - t.fm - t.ecl; return t; });
    if (s.fige === 'OUI') { o.elec = n0_(s.fElec); o.cvc = n0_(s.fCVC); o.fm = n0_(s.fFM); o.ecl = n0_(s.fECL); }
    else { o.elec = ag.elec; o.cvc = ag.cvc; o.fm = ag.fm; o.ecl = ag.ecl; }
    o.autres = o.elec - o.cvc - o.fm - o.ecl;
    o.pvParking = n0_(s.pv);
    var pvFs = pvH43Periode_(D, s.debut, s.fin);
    o.pvHallSrc = pvFs !== null ? 'FusionSolar' : 'TGBT';
    o.pvHall = pvFs !== null ? pvFs : (ag.pv || 0);
    o.pvSite = o.pvParking + o.pvHall;
    o.elecGaz = o.elec + n0_(s.gaz);
    o.parcGaz = n0_(s.elecParc) + n0_(s.gaz);
    var djuC = 0, djf = 0, jm = 0;
    if (o.jours) {
      for (var d = dayNum_(s.debut); d <= dayNum_(s.fin); d++) {
        var m = meteo[isoFromDayNum_(d)];
        if (m) { var j = djuJour_(m, P); djuC += j.dju; djf += j.djf; jm++; }
      }
    }
    o.joursMeteo = jm;
    o.djuCalcules = djuC;
    o.djuRetenus = s.djuForces !== '' ? s.djuForces : djuC;
    o.djuJour = o.jours ? o.djuRetenus / o.jours : '';
    o.djfJour = o.jours ? djf / o.jours : '';
    o.kwhM2Jour = (o.surfaceLouee && o.jours) ? o.elecGaz * 1000 / o.surfaceLouee / o.jours : '';
    var ok = o.djuJour !== '' && o.djuJour >= P.djuMini;
    o.cvcGaz = o.cvc + n0_(s.gaz);
    o.kwhM2JourCvc = (o.surfaceLouee && o.jours) ? o.cvcGaz * 1000 / o.surfaceLouee / o.jours : '';
    o.kwhM2DJU = (ok && o.surfaceLouee && o.jours && o.djuJour !== 0) ? o.cvcGaz * 1000 / o.surfaceLouee / o.jours / o.djuJour : 'n.s.';
    o.prevision = ok ? P.coeffPrev * o.djuJour * o.surfaceLouee * o.jours / 1000 : 'n.s.';
    o.ecart = (typeof o.prevision === 'number' && o.prevision > 0) ? o.cvcGaz / o.prevision - 1 : '';
    if (s.elecMontage !== '' && s.joursMontage !== '') {
      o.horsTalon = s.elecMontage - o.elec - P.talon * s.joursMontage;
      o.pctHorsTalon = s.elecMontage ? o.horsTalon / s.elecMontage : '';
    } else { o.horsTalon = ''; o.pctHorsTalon = ''; }
    o.lignesSaisies = ag.lignesSaisies; o.lignesIncompletes = ag.lignesIncompletes; o.negatifs = ag.negatifs;
    o.temp = tempSalon_(s, T, P);
    return o;
  }
  function groupReleves_(releves) {
    var g = {};
    releves.forEach(function (r) { (g[r.salon] = g[r.salon] || {})[r.ligne] = r; });
    return g;
  }
  function salonsCalcules_(D, P, halls, lignes, salons, releves, meteo, T) {
    var hallsSurf = {}; halls.forEach(function (h) { hallsSurf[h.hall] = h.surface; });
    var g = groupReleves_(releves);
    return salons.map(function (s) {
      var o = {}; for (var k in s) o[k] = s[k];
      o.ind = indicateurs_(D, s, agregats_(lignes, g, s.id), P, hallsSurf, meteo, T);
      return o;
    }).sort(function (a, b) { return (a.debut || '9999') < (b.debut || '9999') ? -1 : 1; });
  }
  function meteoResume_(P, meteo) {
    var mois = []; for (var i = 0; i < 12; i++) mois.push({ dju: 0, djf: 0, n: 0 });
    var jours = [];
    Object.keys(meteo).sort().forEach(function (d) {
      var j = djuJour_(meteo[d], P);
      if (+d.slice(0, 4) === P.annee) { var mo = mois[+d.slice(5, 7) - 1]; mo.dju += j.dju; mo.djf += j.djf; mo.n++; }
      jours.push({ date: d, tx: meteo[d].tx, tn: meteo[d].tn, tmoy: j.tmoy, dju: j.dju, djf: j.djf, src: meteo[d].src });
    });
    return { mois: mois, derniers: jours.slice(-45).reverse(), dernierJour: jours.length ? jours[jours.length - 1].date : '' };
  }
  function salonDansAnnee_(s, annee) {
    var a = String(annee);
    if (!s.debut && !s.fin) return true;
    return (s.debut && s.debut.slice(0, 4) === a) || (s.fin && s.fin.slice(0, 4) === a);
  }

  /* ---------- ce que renvoyait le script à l'interface ---------- */
  function tout(D) {
    var P = readParams(D), halls = readHalls(D), lignes = readLignes(D);
    var salons = appliquerSite(readSalons(D), D);
    return { P: P, halls: halls, lignes: lignes, salons: salons, releves: readReleves(D), meteo: readMeteo(D), T: readTemp(D, halls) };
  }
  /* ---------- comparaison avec l'édition précédente d'un même salon ---------- */
  var MOTS_VIDES = ['salon', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'lyon', 'eurexpo', 'en', 'au', 'a'];
  function mots(nom) {
    return String(nom || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
      .filter(function (m) { return m && MOTS_VIDES.indexOf(m) < 0; });
  }
  /** Édition précédente : salon d'une année antérieure au nom le plus proche (au moins la moitié des mots en commun,
   *  ou un mot commun et des dates à moins de 30 jours d'écart d'une année sur l'autre) ; la plus récente à score égal. */
  function editionPrecedente(s, tous) {
    if (!s.debut) return null;
    var a = mots(s.salon), best = null, bestSc = 0;
    if (!a.length) return null;
    tous.forEach(function (x) {
      if (!x.debut || x.id === s.id || x.debut.slice(0, 4) >= s.debut.slice(0, 4)) return;
      var b = mots(x.salon), inter = a.filter(function (m) { return b.indexOf(m) >= 0; }).length;
      if (!inter) return;
      var union = a.length + b.length - inter, jac = inter / union;
      var ecart = Math.abs(((dayNum_(s.debut) - dayNum_(x.debut)) % 365.25 + 365.25 + 182) % 365.25 - 182);
      if (jac < 0.5 && ecart > 30) return;
      var sc = jac + (ecart <= 30 ? 0.5 : 0) + x.debut.slice(0, 4) / 1e5;
      if (sc > bestSc) { bestSc = sc; best = x; }
    });
    return best;
  }
  function resumeComparaison(x) {
    var o = x.ind, f = x.fige === 'OUI';
    var manque = function (k) { return f && (x[k] === '' || x[k] === null || x[k] === undefined); };
    return {
      id: x.id, salon: x.salon, debut: x.debut, fin: x.fin, fige: x.fige,
      jours: o.jours, surface: o.surfaceLouee, elec: o.elec, cvc: manque('fCVC') ? '' : o.cvc, fm: manque('fFM') ? '' : o.fm, ecl: manque('fECL') ? '' : o.ecl,
      elecParc: x.elecParc, gaz: x.gaz, pv: o.pvSite, elecGaz: o.elecGaz, djuJour: o.djuJour, kwhM2Jour: o.kwhM2Jour,
      kwhM2DJU: manque('fCVC') ? '' : o.kwhM2DJU, prevision: o.prevision, ecart: o.ecart, tMoy: o.temp && o.temp.moy !== undefined ? o.temp.moy : ''
    };
  }

  function getBootstrap(D) {
    var X = tout(D), T = X.T;
    var tous = salonsCalcules_(D, X.P, X.halls, X.lignes, X.salons, X.releves, X.meteo, T);
    var annee = tous.filter(function (s) { return salonDansAnnee_(s, X.P.annee); });
    var comparaisons = {};
    annee.forEach(function (s) {
      var p = editionPrecedente(s, tous);
      if (p) comparaisons[s.id] = { avant: resumeComparaison(p), maintenant: resumeComparaison(s) };
    });
    return {
      comparaisons: comparaisons,
      params: X.P, halls: X.halls,
      lignes: X.lignes.map(function (L) { return { id: L.id, tgbt: L.tgbt, ligne: L.ligne, nb: L.nb, coefs: L.coefs, usage: L.usage, total: L.total }; }),
      salons: annee,
      meteo: meteoResume_(X.P, X.meteo), hist: (D.srv && D.srv.hist) || [],
      temp: T.err ? { err: T.err } : { cols: T.cols, corr: T.corr, seuilBas: T.seuilBas, seuilHaut: T.seuilHaut, nRows: T.rows.length, url: T.url },
      sheetUrl: (D.srv && D.srv.sheetUrl) || '',
      logo: D.logo || '',
      site: ((D.srv && D.srv.site) || []).map(function (r) { return { d: r.d, e: r.e == null ? null : r.e, g: r.g == null ? null : r.g }; }),
      lignesBrutes: (D.lignes || []).map(function (L) { var o = {}; LIGNE_KEYS.forEach(function (k) { o[k] = L[k] === undefined || L[k] === null ? '' : L[k]; }); return o; })
        .sort(function (a, b) { return n0_(a.ordre) - n0_(b.ordre); })
    };
  }
  function getSalonCalcule(D, salonId) {
    var X = tout(D);
    return salonsCalcules_(D, X.P, X.halls, X.lignes, X.salons.filter(function (s) { return s.id === salonId; }), X.releves, X.meteo, X.T)[0];
  }

  function dateReleve_(s, apres) {
    var d = apres ? s.dateApres : s.dateAvant, ref = apres ? (s.fin || s.debut) : (s.debut || s.fin);
    if (estJour(d) && estJour(ref) && Math.abs(dayNum_(d) - dayNum_(ref)) <= 45) return d;
    return ref || d || '';
  }
  function releveFictif_(s, r, auj) {
    if (!s || !s.debut || s.debut <= auj) return false;
    if (String(r.maj || '').indexOf('import') === 0) return true;
    var n = 0;
    for (var i = 0; i < 5; i++) { if (r.ap[i] === '') continue; n++; if (r.ap[i] !== r.av[i]) return false; }
    return n > 0;
  }
  function getReleves(D, salonId) {
    var salons = readSalons(D), releves = readReleves(D);
    var me = salons.filter(function (s) { return s.id === salonId; })[0];
    if (!me) throw new Error('Salon introuvable');
    var byId = {};
    salons.forEach(function (s) { byId[s.id] = s; });
    var auj = aujourdhui();
    var myRef = dateReleve_(me, false) || '9999-12-31';
    var cur = {}, best = {}, fictifs = 0;
    releves.forEach(function (r) {
      var s = byId[r.salon];
      if (!s) return;
      var fictif = releveFictif_(s, r, auj);
      if (r.salon === salonId) { if (fictif) fictifs++; else cur[r.ligne] = { av: r.av.slice(), ap: r.ap.slice() }; return; }
      if (fictif) return;
      var dAv = dateReleve_(s, false), dAp = dateReleve_(s, true);
      [[r.ap, dAp, 1], [r.av, dAv, 0]].forEach(function (src) {
        var d = src[1];
        if (!d || d > myRef) return;
        var bl = best[r.ligne] = best[r.ligne] || [];
        for (var i = 0; i < 5; i++) {
          var v = src[0][i];
          if (v === '') continue;
          var b = bl[i];
          if (!b || d > b.d || (d === b.d && src[2] > b.rang)) bl[i] = { v: v, d: d, rang: src[2], salon: s.salon };
        }
      });
    });
    var prev = {}, sources = {}, proposes = {};
    var preRemplir = me.fige !== 'OUI';
    Object.keys(best).forEach(function (l) {
      prev[l] = []; sources[l] = [];
      for (var i = 0; i < 5; i++) {
        var b = best[l][i];
        prev[l].push(b ? b.v : '');
        sources[l].push(b ? { salon: b.salon, date: b.d, type: b.rang ? 'après' : 'avant' } : null);
      }
      if (!preRemplir) return;
      var c = cur[l], masque = [false, false, false, false, false], aucun = true;
      for (var j = 0; j < 5; j++) {
        if (prev[l][j] === '') continue;
        if (c && c.av[j] !== '') continue;
        if (!c) c = cur[l] = { av: ['', '', '', '', ''], ap: ['', '', '', '', ''] };
        c.av[j] = prev[l][j];
        masque[j] = true; aucun = false;
      }
      if (!aucun) proposes[l] = masque;
    });
    return { salonId: salonId, releves: cur, precedents: prev, sources: sources, proposes: proposes, fictifs: fictifs };
  }

  /* ---------- préparation des enregistrements ---------- */
  function cinq(arr) { var o = []; for (var j = 0; j < 5; j++) { var n = num_(arr && arr[j]); o.push(n === '' ? null : n); } return o; }
  /** Salon à enregistrer (mêmes conversions que saveSalon du script). Renvoie l'objet à écrire dans Firebase. */
  function preparerSalon(D, s) {
    if (!s.salon || !String(s.salon).trim()) throw new Error('Le nom du salon est obligatoire.');
    var o = {};
    if (!s.id) {
      var max = 0;
      (D.salons || []).forEach(function (x) { var m = String(x.id).match(/^S(\d+)$/); if (m) max = Math.max(max, +m[1]); });
      s.id = 'S' + ('00' + (max + 1)).slice(-3);
      if (!s.fige) s.fige = 'NON';
    }
    SALON_KEYS.forEach(function (k) {
      var v = s[k] === undefined || s[k] === null ? '' : s[k];
      if (SALON_NUM.indexOf(k) >= 0) v = num_(v);
      o[k] = typeof v === 'number' || typeof v === 'string' ? v : String(v);
    });
    o.id = String(s.id);
    return o;
  }
  /** Ligne de comptage nettoyée pour l'enregistrement */
  function nettoyerLigne(L) {
    var nb = Math.max(1, Math.min(5, parseInt(L.nb, 10) || 1));
    var coefs = String(L.coefs === '' || L.coefs == null ? '1' : L.coefs).split(';').map(function (c) { var n = num_(c); return n === '' ? 1 : n; });
    while (coefs.length < nb) coefs.push(1);
    var u = String(L.usage || '').trim().toUpperCase();
    if (['', 'CVC', 'FM', 'ECL', 'PV'].indexOf(u) < 0) u = '';
    return {
      id: String(L.id), ordre: n0_(L.ordre), tgbt: String(L.tgbt || '').trim(), ligne: String(L.ligne || '').trim(), nb: nb,
      coefs: coefs.slice(0, nb).join(';'), total: String(L.total || '').trim().toUpperCase(), usage: u,
      actif: String(L.actif || '').toUpperCase() === 'NON' ? 'NON' : 'OUI'
    };
  }

  root.M = {
    getBootstrap: getBootstrap, getSalonCalcule: getSalonCalcule, getReleves: getReleves,
    preparerSalon: preparerSalon, nettoyerLigne: nettoyerLigne, cinq: cinq, num: num_, iso: iso_, maintenant: maintenant,
    defaultCorr: defaultCorr_, SALON_KEYS: SALON_KEYS, mots: mots,
    /* pour rapports.js : tous les salons calculés (toutes années) et les données de base */
    tousCalcules: function (D) {
      var X = tout(D);
      X.tous = salonsCalcules_(D, X.P, X.halls, X.lignes, X.salons, X.releves, X.meteo, X.T);
      return X;
    },
    calculerSalons: function (D, X, salons) { return salonsCalcules_(D, X.P, X.halls, X.lignes, salons, X.releves, X.meteo, X.T); },
    djuJour: djuJour_, dayNum: dayNum_, isoFromDayNum: isoFromDayNum_, editionPrecedente: editionPrecedente
  };
})(typeof window !== 'undefined' ? window : this);
