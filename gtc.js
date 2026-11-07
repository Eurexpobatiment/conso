/* Onglet GTC : index des compteurs PcVue (PDL 1, PDL 2, gaz…) envoyés toutes les heures par le relais du site
 * (gtc/relais-gtc.ps1) dans Firebase, collection ConsoGTC : un document par jour « j-AAAA-MM-JJ »
 * avec un champ par heure « hHH » = { t: date ISO du relevé, <id compteur>: index }, et le document « etat ».
 * Les consommations sont des différences d'index (interpolées entre deux relevés si une heure manque). */
(function () {
  'use strict';
  var H = 3600000, TROU_MAX = 36 * H; // au-delà de 36 h sans relevé, on ne devine pas l'index

  /* ================= Calculs (sans affichage) ================= */
  var M = {};
  /** Tous les relevés d'un compteur, triés : [{t: ms, v: index}] */
  M.points = function (jours, id) {
    var p = [];
    Object.keys(jours || {}).forEach(function (j) {
      var d = jours[j];
      Object.keys(d).forEach(function (k) {
        if (!/^h\d\d$/.test(k)) return;
        var r = d[k]; if (!r || typeof r[id] !== 'number' || !isFinite(r[id])) return;
        var t = Date.parse(r.t); if (isNaN(t)) return;
        p.push({ t: t, v: r[id] });
      });
    });
    p.sort(function (a, b) { return a.t - b.t; });
    return p;
  };
  /** Index à l'instant t (interpolé), ou null */
  M.indexA = function (p, t) {
    if (!p.length || t < p[0].t || t > p[p.length - 1].t) return null;
    var lo = 0, hi = p.length - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (p[m].t <= t) lo = m; else hi = m; }
    var a = p[lo], b = p[hi];
    if (a.t === t) return a.v; if (b.t === t) return b.v;
    if (b.t - a.t > TROU_MAX) return null;
    return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  };
  /** Consommation entre a et b (ms). Si les relevés ne couvrent qu'une partie : partiel = true. */
  M.conso = function (p, a, b) {
    if (!p.length) return null;
    var a2 = Math.max(a, p[0].t), b2 = Math.min(b, p[p.length - 1].t);
    if (b2 <= a2) return null;
    var ia = M.indexA(p, a2), ib = M.indexA(p, b2);
    if (ia === null || ib === null) return null;
    var v = ib - ia;
    if (v < 0) return null; // compteur remis à zéro ou index faux
    return { v: v, partiel: a2 > a + 5 * 60000 || b2 < b - 5 * 60000 };
  };
  M.jour = function (iso) { var x = iso.split('-'); return new Date(+x[0], +x[1] - 1, +x[2]).getTime(); };
  M.lendemain = function (iso) { var x = iso.split('-'); return new Date(+x[0], +x[1] - 1, +x[2] + 1).getTime(); };
  M.iso = function (t) { var d = new Date(t); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  window.GTC_CALC = M;
  if (typeof document === 'undefined') return;

  /* ================= Affichage ================= */
  var G = null, cpt = [], PTS = {}, vue = { periode: 'j30', jour: '' };
  var MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  var COUL = { elec: ['--s1', '--s3', '--s4'], gaz: ['--s2'] };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return window.esc ? window.esc(s) : String(s == null ? '' : s); }
  function nb(v, d) { return typeof v === 'number' && isFinite(v) ? v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; }
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function grand(u) { return u === 'kWh' ? 'MWh' : u; }
  function div(u) { return u === 'kWh' ? 1000 : 1; }
  function dateHeure(t) { var d = new Date(t); return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  function compteurs() {
    var e = G && G.etat, l = (e && e.compteurs) || [];
    if (!l.length) { // pas d'état : on prend les compteurs trouvés dans les relevés
      var ids = {}; Object.keys(G.jours).forEach(function (j) { var d = G.jours[j]; Object.keys(d).forEach(function (k) { if (/^h\d\d$/.test(k)) Object.keys(d[k]).forEach(function (c) { if (c !== 't') ids[c] = 1; }); }); });
      l = Object.keys(ids).map(function (id) { return { id: id, nom: id.toUpperCase(), type: /gaz/i.test(id) ? 'gaz' : 'elec', unite: 'kWh' }; });
    }
    var n = { elec: 0, gaz: 0 };
    return l.map(function (c) { var ty = c.type === 'gaz' ? 'gaz' : 'elec'; var x = { id: c.id, nom: c.nom || c.id, type: ty, unite: c.unite || 'kWh' }; x.coul = css(COUL[ty][n[ty]++ % COUL[ty].length]) || '#888'; return x; });
  }
  var elecs = function () { return cpt.filter(function (c) { return c.type === 'elec' && c.unite === 'kWh'; }); };
  function somme(list, f) { var t = 0, ok = false, part = false; list.forEach(function (c) { var r = f(c); if (r) { t += r.v; ok = true; part = part || r.partiel; } }); return ok ? { v: t, partiel: part } : null; }

  function rendre() {
    var root = $('gtc-contenu'); if (!root) return;
    if (!G) { root.innerHTML = '<div class="card muted">Chargement des compteurs GTC…</div>'; return; }
    if (G.err) { root.innerHTML = '<div class="banner warn">Compteurs GTC illisibles : ' + esc(G.err) + '</div>'; return; }
    cpt = compteurs(); PTS = {}; cpt.forEach(function (c) { PTS[c.id] = M.points(G.jours, c.id); });
    var h = etatHtml();
    var tous = cpt.some(function (c) { return PTS[c.id].length; });
    if (!tous) { root.innerHTML = h + attenteHtml(); return; }
    h += kpisHtml();
    h += '<div class="card"><div class="gtc-barre"><h2 style="margin:0;flex:1">Consommation</h2>' +
      '<div class="seg" id="gtcPer">' + [['j30', '30 jours'], ['m12', '12 mois']].map(function (x) { return '<button data-p="' + x[0] + '"' + (vue.periode === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div></div>' +
      legende() + '<div class="chartbox gtc-chart" id="gtcCh"></div><div class="tablewrap" id="gtcTab"></div></div>';
    var tDer = Math.max.apply(null, cpt.map(function (c) { var p = PTS[c.id]; return p.length ? p[p.length - 1].t : 0; })), der = M.iso(tDer);
    if (!vue.jour) { // par défaut : le dernier jour complet si celui en cours vient de commencer
      var tPrem = Math.min.apply(null, cpt.map(function (c) { var p = PTS[c.id]; return p.length ? p[0].t : Infinity; }));
      var veille = M.iso(M.jour(der) - 12 * H);
      vue.jour = new Date(tDer).getHours() < 12 && M.lendemain(veille) > tPrem && M.jour(veille) >= M.jour(M.iso(tPrem)) ? veille : der;
    }
    h += '<div class="card"><div class="gtc-barre"><h2 style="margin:0;flex:1">Profil horaire</h2>' +
      '<button class="btn sm" id="gtcJm" title="Jour précédent">‹</button><input type="date" id="gtcJour" value="' + vue.jour + '" max="' + der + '"><button class="btn sm" id="gtcJp" title="Jour suivant">›</button></div>' +
      legende() + '<div class="chartbox gtc-chart" id="gtcChJ"></div><div class="muted small" id="gtcJTot"></div></div>';
    h += '<div class="card"><h2>Par salon <span class="muted small">(du premier jour 0 h au lendemain du dernier jour 0 h)</span></h2><div class="tablewrap" id="gtcSal"></div></div>';
    h += '<div class="card"><div class="gtc-barre"><h2 style="margin:0;flex:1">Index relevés</h2><button class="btn sm" id="gtcCsv">Exporter (CSV)</button></div>' +
      '<div class="muted small">' + cpt.map(function (c) { return esc(c.nom) + ' : ' + PTS[c.id].length + ' relevé(s)' + (PTS[c.id].length ? ' depuis le ' + dateHeure(PTS[c.id][0].t) : ''); }).join(' · ') + '</div></div>';
    root.innerHTML = h;
    $('gtcPer').onclick = function (e) { var b = e.target.closest('button'); if (b) { vue.periode = b.dataset.p; rendre(); } };
    $('gtcJour').onchange = function () { if (this.value) { vue.jour = this.value; graphJour(); } };
    $('gtcJm').onclick = function () { decaler(-1); }; $('gtcJp').onclick = function () { decaler(1); };
    $('gtcCsv').onclick = exporter;
    graphPeriode(); graphJour(); tableSalons();
  }
  function decaler(n) { var x = vue.jour.split('-'); var t = new Date(+x[0], +x[1] - 1, +x[2] + n).getTime(); vue.jour = M.iso(t); $('gtcJour').value = vue.jour; graphJour(); }

  function etatHtml() {
    var e = G.etat;
    if (!e) return '<div class="banner warn">Le relais GTC n\'a encore rien envoyé.</div>';
    var t = Date.parse(e.at), vieux = !isNaN(t) && Date.now() - t > 2.5 * H;
    var cls = !e.ok || vieux ? 'warn' : 'info';
    var txt = (e.ok ? 'Dernier relevé PcVue' : 'Dernier essai du relais') + ' : <b>' + (isNaN(t) ? '—' : dateHeure(t)) + '</b>' + (e.poste ? ' <span class="muted">(' + esc(e.poste) + ')</span>' : '');
    if (vieux) txt += '<br>Plus rien depuis ' + Math.round((Date.now() - t) / H) + ' h : vérifier que le PC du relais est allumé et sa tâche planifiée.';
    if (e.msg) txt += '<br>' + esc(e.msg);
    return '<div class="banner ' + cls + ' gtc-etat">' + txt + '</div>';
  }
  function attenteHtml() {
    return '<div class="card"><h2>En attente des premiers relevés</h2><p class="muted">Les index de PDL 1, PDL 2 et du gaz arriveront ici dès que le relais ' +
      'sera installé sur un PC du site (dossier <b>gtc</b> du dépôt, fichier LISEZMOI-GTC.md). Il lit PcVue toutes les heures et envoie les valeurs dans Firebase.</p></div>';
  }
  function legende() {
    return '<div class="gtc-leg">' + cpt.map(function (c) { return '<span><i style="background:' + c.coul + '"></i>' + esc(c.nom) + '</span>'; }).join('') + '</div>';
  }

  function kpisHtml() {
    var now = Date.now(), d0 = M.jour(M.iso(now)), hier = d0 - 0, dm = new Date(); dm = new Date(dm.getFullYear(), dm.getMonth(), 1).getTime();
    var dh = new Date(d0); dh.setDate(dh.getDate() - 1); dh = dh.getTime();
    function ligne(nom, u, f, idx) {
      var j = f(d0, now), y = f(dh, hier), m = f(dm, now);
      return '<div class="kpi gtc-kpi"><div class="l"><b>' + esc(nom) + '</b>' + (idx != null ? ' · index ' + nb(idx, 0) + ' ' + esc(u) : '') + '</div>' +
        '<div class="gtc-k3"><div><div class="v">' + nb(j && j.v, 0) + '</div><div class="l">aujourd\'hui (' + esc(u) + ')</div></div>' +
        '<div><div class="v">' + nb(y && y.v, 0) + (y && y.partiel ? '<sup title="relevés incomplets">*</sup>' : '') + '</div><div class="l">hier (' + esc(u) + ')</div></div>' +
        '<div><div class="v">' + nb(m && m.v / div(u), 1) + '</div><div class="l">mois en cours (' + esc(grand(u)) + ')</div></div></div></div>';
    }
    var h = '<div class="kpis gtc-kpis">';
    cpt.forEach(function (c) { var p = PTS[c.id]; h += ligne(c.nom, c.unite, function (a, b) { return M.conso(p, a, b); }, p.length ? p[p.length - 1].v : null); });
    var el = elecs(); if (el.length > 1) h += ligne('Élec ' + el.map(function (c) { return c.nom; }).join(' + '), 'kWh', function (a, b) { return somme(el, function (c) { return M.conso(PTS[c.id], a, b); }); });
    return h + '</div>';
  }

  /* --------- graphique en barres : piles élec (empilées) et gaz côte à côte --------- */
  function barres(box, labels, series, unites, tipLbl) {
    var W = Math.max(280, box.clientWidth || 600), Ht = 240, ml = 46, mr = 8, mt = 22, mb = 28;
    var piles = []; series.forEach(function (s) { if (piles.indexOf(s.pile) < 0) piles.push(s.pile); });
    var max = {}; piles.forEach(function (p) { max[p] = 0; });
    labels.forEach(function (_, i) { piles.forEach(function (p) { var t = 0; series.forEach(function (s) { if (s.pile === p && typeof s.v[i] === 'number') t += s.v[i]; }); if (t > max[p]) max[p] = t; }); });
    // même échelle pour toutes les piles (tout est en kWh)
    var gmax = Math.max.apply(null, piles.map(function (p) { return max[p]; }).concat([1]));
    var nice = window.niceMax ? window.niceMax(gmax) : gmax;
    var iw = W - ml - mr, ih = Ht - mt - mb, n = labels.length, bw = iw / n, gw = Math.max(2, (bw * 0.78) / piles.length);
    var s = '<svg viewBox="0 0 ' + W + ' ' + Ht + '" height="' + Ht + '">';
    for (var k = 0; k <= 4; k++) { var y = mt + ih - ih * k / 4; s += '<line class="grid" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (ml - 5) + '" y="' + (y + 4) + '" text-anchor="end">' + nb(nice * k / 4, (nice / 4) % 1 ? 1 : 0) + '</text>'; }
    var pas = Math.ceil(n / Math.floor(iw / 38));
    labels.forEach(function (l, i) {
      var x0 = ml + i * bw + bw * 0.11;
      piles.forEach(function (p, j) {
        var yb = mt + ih, tip = '<b>' + esc(tipLbl[i]) + '</b>';
        series.forEach(function (sr) {
          if (sr.pile !== p) return; var v = sr.v[i]; if (typeof v !== 'number') return;
          var hh = ih * v / nice; yb -= hh;
          s += '<rect x="' + (x0 + j * gw) + '" y="' + yb + '" width="' + (gw - 1) + '" height="' + Math.max(0, hh) + '" fill="' + sr.coul + '" rx="1"><title>' + esc(tipLbl[i] + ' · ' + sr.nom + ' : ' + nb(v, v < 10 ? 2 : 0) + ' ' + unites) + '</title></rect>';
        });
      });
      if (i % pas === 0) s += '<text x="' + (ml + i * bw + bw / 2) + '" y="' + (Ht - 9) + '" text-anchor="middle">' + esc(l) + '</text>';
    });
    s += '<text x="4" y="10" style="font-size:10px">' + esc(unites) + '</text></svg>';
    box.innerHTML = s;
  }
  function seriesPour(f) { return cpt.map(function (c) { return { nom: c.nom, coul: c.coul, pile: c.type, v: f(c) }; }); }

  function graphPeriode() {
    var box = $('gtcCh'); if (!box) return;
    var per = [], now = Date.now(), d = new Date();
    if (vue.periode === 'j30') {
      var d0 = M.jour(M.iso(now));
      for (var i = 29; i >= 0; i--) { var a = new Date(d0); a.setDate(a.getDate() - i); var b = new Date(a); b.setDate(b.getDate() + 1); per.push({ a: a.getTime(), b: b.getTime(), l: a.getDate() + '', t: ('0' + a.getDate()).slice(-2) + '/' + ('0' + (a.getMonth() + 1)).slice(-2) }); }
    } else {
      for (var m = 11; m >= 0; m--) { var a2 = new Date(d.getFullYear(), d.getMonth() - m, 1), b2 = new Date(d.getFullYear(), d.getMonth() - m + 1, 1); per.push({ a: a2.getTime(), b: b2.getTime(), l: MOIS[a2.getMonth()], t: MOIS[a2.getMonth()] + ' ' + a2.getFullYear() }); }
    }
    var mo = vue.periode === 'm12', u = cpt.every(function (c) { return c.unite === 'kWh'; }) ? (mo ? 'MWh' : 'kWh') : (mo ? 'MWh / unité' : 'unité');
    var R = {}; cpt.forEach(function (c) { R[c.id] = per.map(function (p) { return M.conso(PTS[c.id], p.a, Math.min(p.b, now)); }); });
    barres(box, per.map(function (p) { return p.l; }), seriesPour(function (c) { return R[c.id].map(function (r) { return r ? r.v / (mo ? div(c.unite) : 1) : null; }); }), u, per.map(function (p) { return p.t; }));
    var el = elecs();
    var th = '<table><thead><tr><th style="text-align:left">' + (mo ? 'Mois' : 'Jour') + '</th>' + cpt.map(function (c) { return '<th>' + esc(c.nom) + ' (' + esc(mo ? grand(c.unite) : c.unite) + ')</th>'; }).join('') +
      (el.length > 1 ? '<th>Élec totale (' + (mo ? 'MWh' : 'kWh') + ')</th>' : '') + '</tr></thead><tbody>';
    var rows = per.map(function (p, i) {
      var any = cpt.some(function (c) { return R[c.id][i]; }); if (!any) return '';
      var cell = function (r, dv) { return '<td>' + (r ? nb(r.v / dv, mo ? 1 : 0) + (r.partiel ? '<sup title="relevés incomplets sur la période">*</sup>' : '') : '—') + '</td>'; };
      var tot = el.length > 1 ? somme(el, function (c) { return R[c.id][i]; }) : null;
      return '<tr><td style="text-align:left">' + esc(p.t) + '</td>' + cpt.map(function (c) { return cell(R[c.id][i], mo ? div(c.unite) : 1); }).join('') + (el.length > 1 ? cell(tot, mo ? 1000 : 1) : '') + '</tr>';
    }).reverse().join('');
    $('gtcTab').innerHTML = rows ? th + rows + '</tbody></table><div class="muted small">* relevés incomplets sur la période (relais arrêté ou installé en cours de route).</div>' : '';
  }

  function graphJour() {
    var box = $('gtcChJ'); if (!box) return;
    var a = M.jour(vue.jour), per = [];
    for (var hh = 0; hh < 24; hh++) { var x = new Date(a); x.setHours(hh); var y = new Date(a); y.setHours(hh + 1); per.push({ a: x.getTime(), b: y.getTime() }); }
    var R = {}; cpt.forEach(function (c) { R[c.id] = per.map(function (p) { return M.conso(PTS[c.id], p.a, p.b); }); });
    barres(box, per.map(function (_, i) { return i + 'h'; }), seriesPour(function (c) { return R[c.id].map(function (r) { return r ? r.v : null; }); }), 'kWh / h', per.map(function (_, i) { return vue.jour.split('-').reverse().join('/') + ' ' + i + 'h–' + (i + 1) + 'h'; }));
    var fin = new Date(a); fin.setDate(fin.getDate() + 1);
    $('gtcJTot').innerHTML = 'Total du jour : ' + cpt.map(function (c) { var r = M.conso(PTS[c.id], a, fin.getTime()); return esc(c.nom) + ' <b>' + nb(r && r.v, 0) + '</b> ' + esc(c.unite) + (r && r.partiel ? '*' : ''); }).join(' · ');
  }

  function tableSalons() {
    var box = $('gtcSal'); if (!box) return;
    var B = window.B; if (!B || !B.salons) { box.innerHTML = '<div class="muted">Salons en cours de chargement…</div>'; return; }
    var t0 = Math.min.apply(null, cpt.map(function (c) { return PTS[c.id].length ? PTS[c.id][0].t : Infinity; }));
    var el = elecs();
    var ss = B.salons.filter(function (s) { return s.debut && s.fin && M.lendemain(s.fin) > t0 && M.jour(s.debut) <= Date.now(); });
    if (!ss.length) { box.innerHTML = '<div class="muted">Aucun salon depuis le premier relevé GTC (' + dateHeure(t0) + ').</div>'; return; }
    var h = '<table><thead><tr><th style="text-align:left">Salon</th><th style="text-align:left">Dates</th>' + cpt.map(function (c) { return '<th>' + esc(c.nom) + ' (' + esc(grand(c.unite)) + ')</th>'; }).join('') +
      (el.length > 1 ? '<th>Élec GTC (MWh)</th>' : '') + '<th title="Élec parc de la fiche salon (Conso_Site)">Élec parc fiche</th><th title="Gaz de la fiche salon (Conso_Site)">Gaz fiche</th></tr></thead><tbody>';
    ss.slice().reverse().forEach(function (s) {
      var a = M.jour(s.debut), b = Math.min(M.lendemain(s.fin), Date.now());
      var R = {}; cpt.forEach(function (c) { R[c.id] = M.conso(PTS[c.id], a, b); });
      var cell = function (r, dv) { return '<td>' + (r ? nb(r.v / dv, 1) + (r.partiel ? '<sup title="période pas entièrement couverte">*</sup>' : '') : '—') + '</td>'; };
      h += '<tr><td style="text-align:left">' + esc(s.salon) + '</td><td style="text-align:left;white-space:nowrap">' + (window.dfr ? window.dfr(s.debut) + ' → ' + window.dfr(s.fin) : s.debut + ' → ' + s.fin) + '</td>' +
        cpt.map(function (c) { return cell(R[c.id], div(c.unite)); }).join('') + (el.length > 1 ? cell(somme(el, function (c) { return R[c.id]; }), 1000) : '') +
        '<td>' + nb(s.elecParc, 1) + '</td><td>' + nb(s.gaz, 1) + '</td></tr>';
    });
    box.innerHTML = h + '</tbody></table><div class="muted small">* période pas entièrement couverte par les relevés GTC.</div>';
  }

  function exporter() {
    var lignes = {}, ids = cpt.map(function (c) { return c.id; });
    cpt.forEach(function (c) { PTS[c.id].forEach(function (p) { (lignes[p.t] = lignes[p.t] || {})[c.id] = p.v; }); });
    var csv = ['Date;Heure;' + cpt.map(function (c) { return c.nom + ' (' + c.unite + ')'; }).join(';')];
    Object.keys(lignes).map(Number).sort(function (a, b) { return a - b; }).forEach(function (t) {
      var d = new Date(t);
      csv.push(M.iso(t).split('-').reverse().join('/') + ';' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ';' + ids.map(function (id) { var v = lignes[t][id]; return typeof v === 'number' ? String(v).replace('.', ',') : ''; }).join(';'));
    });
    var blob = new Blob(['﻿' + csv.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'index-GTC-' + M.iso(Date.now()) + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  var visible = function () { var v = $('v-gtc'); return v && v.classList.contains('on'); };
  window.gtcAfficher = function () { rendre(); };
  window.addEventListener('resize', function () { if (visible() && G && cpt.length) { graphPeriode(); graphJour(); } });
  function brancher() {
    if (!window.CONSO_FB || !window.CONSO_FB.gtc) return setTimeout(brancher, 300);
    window.CONSO_FB.gtc(function (g) { G = g; if (visible()) rendre(); });
  }
  brancher();
})();
