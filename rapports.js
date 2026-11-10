/* Consommations Halls – rapports PDF, export CSV et charte, faits dans l'appli (plus par le script Google).
 * - Rapport salon : mêmes données, mêmes phrases d'interprétation et même mise en page (charte GL events Lyon) que le script.
 * - Rapport PV mensuel : données PV lues au script (pvMois) tant qu'elles sont dans le classeur, PDF fait ici.
 * - Export CSV : calculé ici à partir de Firebase.
 * - Charte (photo et logo de la page de garde) : Firebase, document ConsoServeur/charte.
 * Le PDF est fabriqué dans le navigateur (html2canvas + jsPDF) : texte en image, pas sélectionnable.
 * « Enregistrer dans Drive » passe encore par le script Google (ancienne méthode, gardée en secours).
 */
(function () {
  'use strict';
  var FB = window.CONSO_FB;
  if (!FB) { console.warn('rapports.js : donnees.js absent'); return; }
  var LIBS = {
    h2c: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    pdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
    zip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
  };
  var charge = {};
  function lib(k) {
    if (charge[k]) return charge[k];
    return (charge[k] = new Promise(function (ok, ko) {
      var s = document.createElement('script'); s.src = LIBS[k]; s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { delete charge[k]; ko(new Error('Bibliothèque PDF non chargée (connexion internet nécessaire la première fois).')); };
      document.head.appendChild(s);
    }));
  }

  /* ================= utilitaires (repris du script) ================= */
  var M = window.M;
  function isN_(v) { return typeof v === 'number' && isFinite(v); }
  function n0_(v) { var n = M.num(v); return n === '' ? 0 : n; }
  function fr_(v, d) {
    if (!isN_(v)) return '—';
    d = d === undefined ? 1 : d;
    var p = Math.abs(v).toFixed(d).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return (v < 0 && +Math.abs(v).toFixed(d) !== 0 ? '-' : '') + p.join(',');
  }
  function u_(v, d, unit) { return isN_(v) ? fr_(v, d) + (unit ? ' ' + unit : '') : '—'; }
  function pc_(v, signe) { return isN_(v) ? (signe && v > 0 ? '+' : '') + Math.round(v * 100) + ' %' : '—'; }
  function h_(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function dfr_(iso) { if (!iso) return '—'; var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function dcourt_(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }
  function r1_(v, d) { var k = Math.pow(10, d === undefined ? 1 : d); return Math.round(v * k) / k; }
  function moy_(a) { return a.reduce(function (t, x) { return t + x; }, 0) / a.length; }
  function mediane_(a) { var b = a.slice().sort(function (x, y) { return x - y; }), m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; }
  function pearson_(x, y) {
    var mx = moy_(x), my = moy_(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += Math.pow(x[i] - mx, 2); syy += Math.pow(y[i] - my, 2); }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
  }
  var dayNum_ = function (d) { return M.dayNum(d); }, isoFromDayNum_ = function (n) { return M.isoFromDayNum(n); };
  function paris(f) {
    var p = {}; new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
    if (f === 'iso') return p.year + '-' + p.month + '-' + p.day;
    if (f === 'jour') return p.day + '/' + p.month + '/' + p.year;
    return p.day + '/' + p.month + '/' + p.year + ' à ' + p.hour + ':' + p.minute;
  }

  /* ================= charte ================= */
  var CH = { vert: '#00AB89', fonce: '#004C46', texte: '#334155', gris: '#64748B', clair: '#F4F4F2', ligne: '#E2E8F0',
    vertPale: '#E6F6F2', vertClair: '#7FD5C4', orange: '#FBAE40', corail: '#F26B43', ardoise: '#94A3B8' };
  var CHARTE = null; // { photo, logo, source }
  function lireCharte() {
    return FB.lireDoc('ConsoServeur', 'charte').then(function (c) { CHARTE = c || {}; return CHARTE; }, function () { CHARTE = CHARTE || {}; return CHARTE; });
  }
  function chImg_(role) {
    var v = CHARTE && CHARTE[role] || '';
    if (!v && role === 'logo') v = FB.D.logo || '';
    return v;
  }
  function chEsc_(s) { return h_(s); }
  /* Styles du rapport. Les marges de page et la bande verte sont posées à la mise en page PDF. */
  function chCss_() {
    return '.rp *{box-sizing:content-box}.rp{font-family:Arial,Helvetica,sans-serif;font-size:9.5pt;color:' + CH.texte + ';background:#fff;line-height:1.25}' +
      '.rp h1{font-size:22pt;color:' + CH.fonce + ';margin:4mm 0 1mm;font-weight:bold;letter-spacing:-.2pt}' +
      '.rp .sub{color:' + CH.vert + ';font-size:11pt;font-weight:bold;margin:0 0 5mm}' +
      '.rp h2{font-size:16pt;color:' + CH.fonce + ';font-weight:bold;margin:7mm 0 2.5mm;letter-spacing:-.2pt}' +
      '.rp h3{font-size:10pt;color:' + CH.texte + ';text-decoration:underline;margin:4mm 0 1.5mm}' +
      '.rp p{margin:1.5mm 0;line-height:1.38}.rp b{color:#1E293B}' +
      '.rp ul{margin:1mm 0 1mm 5mm;padding:0 0 0 4mm}.rp li{margin:1.4mm 0;line-height:1.38}' +
      '.rp table{border-collapse:collapse;width:100%;margin:2mm 0}' +
      '.rp th{background:' + CH.fonce + ';color:#fff;font-weight:bold;font-size:8.5pt;padding:4px 6px;text-align:right}' +
      '.rp th.l,.rp td.l{text-align:left}' +
      '.rp td{border-bottom:1px solid ' + CH.ligne + ';padding:3.5px 6px;font-size:8.5pt;text-align:right}' +
      '.rp tr.tot td{font-weight:bold;background:' + CH.vertPale + ';color:' + CH.fonce + ';border-bottom:0}' +
      '.rp tr.hl td{font-weight:bold;color:' + CH.fonce + '}' +
      '.rp table.kt{border-collapse:separate;border-spacing:2.5mm;margin:0 -2.5mm 0 -2.5mm;width:calc(100% + 2.5mm);table-layout:fixed}' +
      '.rp table.kt td{background:' + CH.clair + ';border:0;border-top:3px solid ' + CH.vert + ';padding:3mm 3mm 2.5mm;vertical-align:top;text-align:left;width:25%}' +
      '.rp .kv{font-size:14pt;font-weight:bold;color:' + CH.fonce + ';line-height:1.1}.rp .kl{font-size:7.8pt;color:' + CH.gris + ';margin-top:1mm;line-height:1.25;white-space:normal}' +
      '.rp .syn{background:' + CH.vertPale + ';border-left:4px solid ' + CH.vert + ';padding:2mm 4mm;margin:2mm 0}' +
      '.rp .note{background:#FFF6E5;border-left:4px solid ' + CH.orange + ';padding:2mm 4mm;margin:2mm 0}' +
      '.rp .muted{color:' + CH.gris + ';font-size:8pt}.rp .img{text-align:center;margin:2mm 0}.rp .img img{max-width:100%}';
  }
  /** Page de garde (210 × 297 mm) */
  function chCouverture_(titre, sousTitre, lignes) {
    var logo = chImg_('logo'), photo = chImg_('photo');
    return '<div class="rp" style="width:210mm;height:297mm;overflow:hidden;display:flex">' +
      '<div style="width:41%;background:' + CH.clair + ';padding:16mm 6mm 10mm 14mm;box-sizing:border-box;position:relative">' +
      (logo ? '<img src="' + logo + '" style="width:62mm">' : '') +
      '<div style="position:absolute;top:120mm;left:14mm;font-size:29pt;line-height:1.08;color:#111827;letter-spacing:.3pt">HOME OF<br>EXCELLENCE</div>' +
      '<div style="position:absolute;bottom:14mm;left:14mm;font-size:8.5pt;font-style:italic;color:#1F2937">Édité le ' + paris('jour') + '</div>' +
      '</div>' +
      '<div style="width:59%;background:' + CH.vert + ';padding:16mm 14mm 10mm 0;box-sizing:border-box">' +
      '<div style="text-align:right;font-size:7.5pt;color:#05211E;line-height:1.4">CENTRE DE CONGRÈS DE LYON<br>EUREXPO LYON<br>LA SUCRIÈRE<br>MATMUT STADIUM</div>' +
      '<div style="display:flex;margin-top:22mm;background:' + CH.fonce + '"><div style="width:16mm;flex:none"></div>' +
      (photo ? '<img src="' + photo + '" style="width:calc(100% - 16mm);display:block">' : '<div style="height:85mm"></div>') + '</div>' +
      '<div style="margin-top:40mm;text-align:right;color:#05211E;font-size:21pt;font-weight:bold;line-height:1.15">' + chEsc_(titre) + '</div>' +
      (sousTitre ? '<div style="margin-top:3mm;text-align:right;color:#05211E;font-size:14pt;font-weight:bold">' + chEsc_(sousTitre) + '</div>' : '') +
      (lignes && lignes.length ? '<div style="margin-top:3mm;text-align:right;color:#05211E;font-size:9.5pt;line-height:1.45">' + lignes.map(chEsc_).join('<br>') + '</div>' : '') +
      '</div></div>';
  }
  function chFin_(texte) {
    var logo = chImg_('logo');
    return '<table style="margin-top:8mm"><tr><td class="l" style="border:0;border-top:1px solid ' + CH.ligne + ';color:' + CH.gris + ';font-size:7.5pt;padding-top:2mm;line-height:1.35">' +
      (texte || '') + '</td><td style="border:0;border-top:1px solid ' + CH.ligne + ';width:42mm;padding-top:2mm">' +
      (logo ? '<img src="' + logo + '" style="width:36mm">' : '') + '</td></tr></table>';
  }
  function chTuiles_(list, n) {
    n = n || 4;
    var h = '<table class="kt">';
    for (var i = 0; i < list.length; i += n) {
      h += '<tr>';
      for (var j = 0; j < n; j++) {
        var p = list[i + j];
        h += p ? '<td><div class="kv">' + p[0] + '</div><div class="kl">' + p[1] + '</div></td>' : '<td style="background:none;border-top:0"></td>';
      }
      h += '</tr>';
    }
    return h + '</table>';
  }

  /* ================= graphiques (SVG → PNG) ================= */
  var IMGS = []; // { id, svg, w }
  function img_(svg, w) {
    if (!svg) return '';
    var id = 'rpimg' + IMGS.length; IMGS.push({ id: id, svg: svg, w: w || 640 });
    return '<div class="img"><img id="' + id + '" style="width:' + (w ? Math.min(w, 690) : 640) + 'px;max-width:100%"></div>';
  }
  function svgPng(svg) {
    return new Promise(function (ok) {
      var m = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/), W = m ? +m[1] : 800, H = m ? +m[2] : 400;
      var im = new Image();
      im.onload = function () {
        var c = document.createElement('canvas'), k = 2; c.width = W * k; c.height = H * k;
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        try { ok(c.toDataURL('image/png')); } catch (e) { ok(''); }
      };
      im.onerror = function () { ok(''); };
      im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  var FONT = 'font-family="Arial, Helvetica, sans-serif"';
  function e_(t) { return h_(t); }
  function pasAxe(max) {
    if (!(max > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(max / 5))), r = max / 5 / p;
    return (r > 5 ? 10 : r > 2 ? 5 : r > 1 ? 2 : 1) * p;
  }
  function nb(v) { var s = Math.abs(v) >= 100 ? fr_(v, 0) : Math.abs(v) >= 10 ? fr_(v, 1).replace(/,0$/, '') : fr_(v, 2).replace(/0$/, '').replace(/,0$/, ''); return s; }
  function legende(series, x0, y, W) {
    var s = '', x = x0, items = series.map(function (sr) { return { t: sr.name, c: sr.color, dash: sr.dash }; });
    var tot = items.reduce(function (a, it) { return a + 22 + it.t.length * 6.3 + 14; }, 0);
    x = Math.max(x0, (W - tot) / 2);
    items.forEach(function (it) {
      s += it.dash ? '<line x1="' + x + '" y1="' + (y - 4) + '" x2="' + (x + 16) + '" y2="' + (y - 4) + '" stroke="' + it.c + '" stroke-width="2" stroke-dasharray="4 3"/>'
        : '<rect x="' + x + '" y="' + (y - 10) + '" width="14" height="10" rx="2" fill="' + it.c + '"/>';
      s += '<text x="' + (x + 20) + '" y="' + y + '" font-size="12" fill="#334155">' + e_(it.t) + '</text>';
      x += 22 + it.t.length * 6.3 + 14;
    });
    return s;
  }
  /** Colonnes (groupées ou empilées). o = { labels, series:[{name,color,values}], stacked, title, ytitle, w, h, legend } */
  function colonnes(o) {
    var W = o.w || 760, H = o.h || 320, L = 58, R = 16, T = o.title ? 34 : 14, B = o.legend ? 58 : 36;
    var n = o.labels.length, pw = W - L - R, ph = H - T - B;
    var max = 0;
    for (var i = 0; i < n; i++) {
      if (o.stacked) { var t = 0; o.series.forEach(function (s) { t += Math.max(0, s.values[i] || 0); }); max = Math.max(max, t); }
      else o.series.forEach(function (s) { max = Math.max(max, s.values[i] || 0); });
    }
    var st = pasAxe(max || 1), top = Math.ceil((max || 1) / st) * st;
    var Y = function (v) { return T + ph - v / top * ph; };
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' + FONT + '><rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    if (o.title) s += '<text x="' + (W / 2) + '" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#004C46">' + e_(o.title) + '</text>';
    for (var v = 0; v <= top + 1e-9; v += st) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#E2E8F0"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="#64748B">' + nb(v) + '</text>';
    if (o.ytitle) s += '<text transform="translate(14,' + (T + ph / 2) + ') rotate(-90)" text-anchor="middle" font-size="11" fill="#64748B">' + e_(o.ytitle) + '</text>';
    var bw = pw / n, k = o.stacked ? 1 : o.series.length, gap = Math.min(bw * 0.25, 10), cw = (bw - gap) / k;
    var pasLab = Math.max(1, Math.ceil(n / Math.floor(pw / 30)));
    for (i = 0; i < n; i++) {
      var x = L + i * bw + gap / 2, acc = 0;
      o.series.forEach(function (sr, j) {
        var val = Math.max(0, sr.values[i] || 0); if (!val) return;
        var y0 = o.stacked ? Y(acc + val) : Y(val), hh = o.stacked ? Y(acc) - Y(acc + val) : Y(0) - Y(val);
        s += '<rect x="' + (o.stacked ? x : x + j * cw).toFixed(1) + '" y="' + y0.toFixed(1) + '" width="' + Math.max(1, cw - (o.stacked ? 0 : 1)).toFixed(1) + '" height="' + Math.max(0, hh).toFixed(1) + '" fill="' + sr.color + '"/>';
        acc += val;
      });
      if (i % pasLab === 0) s += '<text x="' + (L + i * bw + bw / 2).toFixed(1) + '" y="' + (T + ph + 16) + '" text-anchor="middle" font-size="' + (n > 20 ? 10 : 11) + '" fill="#334155">' + e_(o.labels[i]) + '</text>';
    }
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="#94A3B8"/>';
    if (o.legend) s += legende(o.series, L, H - 14, W);
    return s + '</svg>';
  }
  /** Courbes. series:[{name,color,values (null = trou), dash}] */
  function courbes(o) {
    var W = o.w || 760, H = o.h || 340, L = 46, R = 16, T = o.title ? 34 : 14, B = 58;
    var n = o.labels.length, pw = W - L - R, ph = H - T - B, vals = [];
    o.series.forEach(function (sr) { sr.values.forEach(function (v) { if (isN_(v)) vals.push(v); }); });
    if (!vals.length) return '';
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), st = pasAxe(Math.max(1, mx - mn));
    var lo = Math.floor(mn / st) * st, hi = Math.ceil(mx / st) * st; if (hi === lo) hi = lo + st;
    var X = function (i) { return L + (n === 1 ? pw / 2 : i * pw / (n - 1)); }, Y = function (v) { return T + ph - (v - lo) / (hi - lo) * ph; };
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' + FONT + '><rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    if (o.title) s += '<text x="' + (W / 2) + '" y="20" text-anchor="middle" font-size="14" font-weight="bold" fill="#004C46">' + e_(o.title) + '</text>';
    for (var v = lo; v <= hi + 1e-9; v += st) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="#E2E8F0"/><text x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="#64748B">' + nb(v) + '</text>';
    var pasLab = Math.max(1, Math.ceil(n / Math.floor(pw / 46)));
    for (var i = 0; i < n; i += pasLab) s += '<text x="' + X(i).toFixed(1) + '" y="' + (T + ph + 16) + '" text-anchor="middle" font-size="11" fill="#334155">' + e_(o.labels[i]) + '</text>';
    o.series.forEach(function (sr) {
      var pts = []; sr.values.forEach(function (v, i) { if (isN_(v)) pts.push(X(i).toFixed(1) + ',' + Y(v).toFixed(1)); }); // trous interpolés, comme le script
      if (!pts.length) return;
      s += '<polyline fill="none" stroke="' + sr.color + '" stroke-width="2" points="' + pts.join(' ') + '"' + (sr.dash ? ' stroke-dasharray="4 4"' : '') + '/>';
      if (!sr.dash) pts.forEach(function (p) { var q = p.split(','); s += '<circle cx="' + q[0] + '" cy="' + q[1] + '" r="3" fill="' + sr.color + '"/>'; });
    });
    s += legende(o.series, L, H - 14, W);
    return s + '</svg>';
  }
  /** Camembert : parts = [[libellé, valeur, couleur]] */
  function camembert(o) {
    var W = o.w || 760, H = o.h || 380, cx = 200, cy = 40 + (H - 50) / 2, r = (H - 70) / 2;
    var tot = o.parts.reduce(function (a, p) { return a + p[1]; }, 0); if (!(tot > 0)) return '';
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' + FONT + '><rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    if (o.title) s += '<text x="' + (W / 2) + '" y="22" text-anchor="middle" font-size="14" font-weight="bold" fill="#004C46">' + e_(o.title) + '</text>';
    var a = -Math.PI / 2;
    o.parts.forEach(function (p, i) {
      var f = p[1] / tot, b = a + f * 2 * Math.PI;
      if (f >= 0.9999) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + p[2] + '"/>';
      else s += '<path d="M' + cx + ' ' + cy + 'L' + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1) + 'A' + r + ' ' + r + ' 0 ' + (f > 0.5 ? 1 : 0) + ' 1 ' +
        (cx + r * Math.cos(b)).toFixed(1) + ' ' + (cy + r * Math.sin(b)).toFixed(1) + 'Z" fill="' + p[2] + '" stroke="#fff" stroke-width="1.5"/>';
      var m = (a + b) / 2;
      if (f >= 0.04) s += '<text x="' + (cx + r * 0.65 * Math.cos(m)).toFixed(1) + '" y="' + (cy + r * 0.65 * Math.sin(m) + 5).toFixed(1) + '" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff">' + Math.round(f * 100) + ' %</text>';
      var ly = cy - o.parts.length * 13 + i * 26 + 8;
      s += '<rect x="440" y="' + (ly - 11) + '" width="14" height="14" rx="2" fill="' + p[2] + '"/><text x="462" y="' + ly + '" font-size="13" fill="#334155">' + e_(p[0]) + ' · ' + fr_(p[1], 1) + ' MWh</text>';
      a = b;
    });
    return s + '</svg>';
  }
  /** Barres horizontales (une valeur par ligne, couleur par ligne) */
  function barresH(o) {
    var n = o.rows.length, W = o.w || 760, LW = 300, T = o.title ? 36 : 12, rh = 26, B = o.legend ? 44 : 24, H = T + n * rh + B;
    var max = Math.max.apply(null, o.rows.map(function (r) { return r.v; }).concat([0])) || 1, st = pasAxe(max), top = Math.ceil(max / st) * st;
    var pw = W - LW - 50, X = function (v) { return LW + v / top * pw; };
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" ' + FONT + '><rect width="' + W + '" height="' + H + '" fill="#fff"/>';
    if (o.title) s += '<text x="' + (W / 2) + '" y="22" text-anchor="middle" font-size="14" font-weight="bold" fill="#004C46">' + e_(o.title) + '</text>';
    for (var v = 0; v <= top + 1e-9; v += st) s += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + T + '" y2="' + (T + n * rh) + '" stroke="#E2E8F0"/><text x="' + X(v) + '" y="' + (T + n * rh + 15) + '" text-anchor="middle" font-size="10" fill="#64748B">' + nb(v) + '</text>';
    o.rows.forEach(function (r, i) {
      var y = T + i * rh;
      s += '<text x="' + (LW - 8) + '" y="' + (y + rh / 2 + 4) + '" text-anchor="end" font-size="10.5" fill="#334155"' + (r.gras ? ' font-weight="bold"' : '') + '>' + e_(r.t) + '</text>';
      s += '<rect x="' + LW + '" y="' + (y + 4) + '" width="' + Math.max(1, X(r.v) - LW).toFixed(1) + '" height="' + (rh - 8) + '" fill="' + r.c + '"/>';
      s += '<text x="' + (X(r.v) + 4).toFixed(1) + '" y="' + (y + rh / 2 + 4) + '" font-size="10" fill="#334155">' + fr_(r.v, 3) + '</text>';
    });
    if (o.legend) s += legende(o.legend, 20, H - 10, W);
    return s + '</svg>';
  }

  /* ================= plan des halls (repris du script) ================= */
  var PLAN_HALLS_ = {
    'Hall 4.3': [[541, 60], [678, 60], [678, 194], [541, 194]], 'Hall 4.2 A': [[470, 194], [541, 194], [541, 341], [470, 341]],
    'Hall 4.2 B': [[541, 194], [677, 194], [677, 341], [541, 341]], 'Hall 4.2 C': [[677, 194], [747, 194], [747, 341], [677, 341]],
    'Hall 4.1': [[541, 341], [677, 341], [677, 585], [541, 585]], 'Hall 3.2': [[260, 240], [413, 393], [316, 490], [218, 390], [162, 336]],
    'Hall 3.1': [[413, 393], [492, 472], [492, 530], [424, 598], [316, 490]], 'Hall 2.3B': [[146, 428], [210, 493], [174, 529], [110, 464]],
    'Hall 2.3A': [[110, 464], [174, 529], [113, 590], [48, 526]], 'Hall 2.2': [[210, 493], [306, 588], [208, 686], [113, 590]],
    'Hall 2.1 A': [[374, 554], [473, 653], [376, 750], [260, 634], [306, 588], [322, 605]], 'Hall 2.1 B': [[260, 634], [407, 782], [355, 834], [208, 686]],
    'Hall 2.1 C': [[205, 684], [352, 831], [302, 880], [156, 734]], 'Hall 1': [[451, 738], [540, 828], [434, 934], [344, 844]],
    'Hall 5.2': [[951, 240], [1056, 346], [906, 496], [800, 390]], 'Hall 5.1': [[800, 391], [905, 495], [852, 547], [800, 600], [797, 600], [727, 530], [727, 465]],
    'Hall 6.3C': [[1075, 425], [1179, 529], [1122, 586], [1018, 482]], 'Hall 6.3B': [[1018, 482], [1122, 586], [1074, 634], [970, 530]],
    'Hall 6.3A': [[970, 530], [1074, 634], [1004, 704], [900, 600]], 'Hall 6.2A': [[900, 600], [1004, 704], [872, 836], [768, 732]],
    'Hall 6.2B': [[850, 550], [900, 600], [796, 704], [746, 654]], 'Hall 6.1': [[768, 732], [872, 836], [769, 939], [665, 835]],
    'Hall 7B': [[1106, 682], [1188, 764], [1098, 854], [1016, 772]], 'Hall 7A': [[1016, 772], [1098, 854], [1007, 945], [925, 863]],
    'Galerie 7': [[926, 786], [962, 822], [927, 857], [891, 821]], 'Galerie 4': [[586, 585], [630, 585], [630, 685], [586, 685]],
    'Galerie 2': [[455, 660], [535, 660], [535, 738], [455, 738]], 'Galerie 6': [[680, 688], [748, 688], [748, 738], [680, 738]],
    'PDL': [[535, 685], [680, 685], [680, 770], [535, 770]], 'Acceuil': [[540, 770], [690, 770], [690, 830], [650, 850], [650, 885], [570, 885], [570, 850], [540, 830]]
  };
  function planSvg_(sel, halls) {
    var surf = {}; (halls || []).forEach(function (h) { surf[h.hall] = h.surface; });
    var S = { on: '#0c4a33', off: '#dfe9e3', txtOn: '#ffffff', txtOff: '#0c4a33', bord: '#0c4a33', fond: '#ffffff', gris: '#8a8a8a' };
    function pts(p) { return p.map(function (q) { return q.join(','); }).join(' '); }
    function area(p) { var a = 0; for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length; a += p[i][0] * p[j][1] - p[j][0] * p[i][1]; } return Math.abs(a / 2); }
    function cen(p) { var a = 0, x = 0, y = 0; for (var i = 0; i < p.length; i++) { var j = (i + 1) % p.length, c = p[i][0] * p[j][1] - p[j][0] * p[i][1]; a += c; x += (p[i][0] + p[j][0]) * c; y += (p[i][1] + p[j][1]) * c; } a /= 2; return [x / (6 * a), y / (6 * a)]; }
    function span(p, y) { var xs = []; for (var i = 0; i < p.length; i++) { var a = p[i], b = p[(i + 1) % p.length]; if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); } xs.sort(function (m, n) { return m - n; }); return xs.length > 1 ? xs[xs.length - 1] - xs[0] : 0; }
    function nbr(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
    function nom(k) { if (k === 'Acceuil') return 'ACCUEIL'; if (k === 'PDL') return 'PLACE DES LUMIÈRES'; return k.replace(/^Hall /, 'HALL ').replace(/^Galerie /, 'GALERIE ').toUpperCase(); }
    var keys = Object.keys(PLAN_HALLS_);
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1288 985" ' + FONT + '><rect x="0" y="0" width="1288" height="985" rx="16" fill="' + S.fond + '"/>';
    [[[388, 256], [470, 256], [470, 284], [408, 284]], [[747, 256], [836, 256], [816, 284], [747, 284]],
      [[1062, 450], [1093, 422], [1140, 470], [1110, 500]], [[1082, 630], [1130, 582], [1145, 597], [1097, 645]]]
      .forEach(function (p) { s += '<polygon points="' + pts(p) + '" fill="' + S.gris + '"/>'; });
    var b1 = '', b2 = '', f = '', d = '', lab = '';
    keys.forEach(function (k) {
      var p = pts(PLAN_HALLS_[k]);
      b1 += '<polygon points="' + p + '" fill="' + S.bord + '" stroke="' + S.bord + '" stroke-width="9" stroke-linejoin="miter"/>';
      b2 += '<polygon points="' + p + '" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="miter"/>';
    });
    keys.forEach(function (k) {
      var P = PLAN_HALLS_[k], p = pts(P), on = !!sel[k], c = cen(P), a = area(P), col = on ? S.on : S.off;
      f += '<polygon points="' + p + '" fill="' + col + '" stroke="' + col + '" stroke-width="2.5"/>';
      d += '<polygon points="' + p + '" fill="none" stroke="' + (on ? 'rgba(255,255,255,.55)' : 'rgba(12,74,51,.35)') + '" stroke-width="1.2" stroke-dasharray="6 5"/>';
      var gal = /^(Galerie|PDL|Acceuil)/.test(k);
      var fs = gal ? (a > 9000 ? 13 : 10) : (a > 20000 ? 24 : (a > 12000 ? 20 : (a > 7000 ? 16 : 12)));
      var tc = on ? S.txtOn : S.txtOff, t = nom(k);
      if (k === 'PDL') t = 'PLACE DES';
      var lw = span(P, c[1]);
      if (!gal && lw < 0.62 * fs * t.length) t = t.replace('HALL ', '');
      fs = Math.max(9, Math.min(fs, Math.floor(lw * 0.9 / (0.62 * t.length))));
      lab += '<text x="' + c[0].toFixed(0) + '" y="' + (c[1] + fs * 0.35 - (surf[k] ? fs * 0.35 : 0)).toFixed(0) + '" text-anchor="middle" font-size="' + fs + '" font-weight="' + (gal ? '700' : '600') + '" fill="' + tc + '">' + e_(t) + (k === 'PDL' ? '<tspan x="' + c[0].toFixed(0) + '" dy="' + (fs * 1.1).toFixed(0) + '">LUMIÈRES</tspan>' : '') + '</text>';
      if (surf[k] && a > 2500) lab += '<text x="' + c[0].toFixed(0) + '" y="' + (c[1] + fs * 0.95 + (k === 'PDL' ? fs * 1.1 : 0)).toFixed(0) + '" text-anchor="middle" font-size="' + Math.max(9, Math.round(fs * 0.6)) + '" fill="' + tc + '">' + nbr(surf[k]) + ' m²</text>';
    });
    s += b1 + b2 + f + d + lab;
    function ent(ax, ay, rot, tx, ty, txt, anc) {
      s += '<polygon points="-10,-7 10,-7 0,7" fill="' + S.bord + '" transform="translate(' + ax + ',' + ay + ') rotate(' + rot + ')"/>';
      txt.split('|').forEach(function (l, i) { s += '<text x="' + tx + '" y="' + (ty + i * 17) + '" text-anchor="' + (anc || 'middle') + '" font-size="15" font-weight="700" fill="' + S.bord + '">' + l + '</text>'; });
    }
    ent(609, 44, 0, 609, 26, 'ENTRÉE SAINT-EXUPÉRY'); ent(609, 904, 180, 609, 935, 'ENTRÉE PRINCIPALE');
    ent(98, 434, -45, 58, 405, 'ENTRÉE|CONFLUENCE'); ent(1195, 530, 90, 1215, 520, 'ENTRÉE|PAUL|BOCUSE', 'start');
    ent(212, 820, -135, 180, 840, 'ENTRÉE|HALL 2.1'); ent(972, 940, 135, 940, 955, 'ENTRÉE|HALL 7');
    return s + '</svg>';
  }

  /* ================= rapport salon ================= */
  function siteParJour(D) { var m = {}; ((D.srv && D.srv.site) || []).forEach(function (r) { m[r.d] = { d: r.d, e: r.e == null ? null : r.e, g: r.g == null ? null : r.g }; }); return m; }

  function rapportDonnees_(s, tous, P, meteo, D) {
    var o = s.ind, t = o.temp || {};
    var d0 = dayNum_(s.debut), d1 = dayNum_(s.fin), d;
    var ext = [];
    for (d = d0; d <= d1; d++) {
      var iso = isoFromDayNum_(d), m = meteo[iso];
      if (m) { var j = M.djuJour(m, P); ext.push({ date: iso, tx: m.tx, tn: m.tn, tmoy: j.tmoy, dju: j.dju, djf: j.djf }); }
    }
    var R = { s: s, o: o, t: t, P: P, ext: ext, extMoy: '', extMin: '', extMax: '', amplitude: '' };
    if (ext.length) {
      R.extMoy = moy_(ext.map(function (x) { return x.tmoy; }));
      R.extMin = Math.min.apply(null, ext.map(function (x) { return x.tn; }));
      R.extMax = Math.max.apply(null, ext.map(function (x) { return x.tx; }));
      R.amplitude = moy_(ext.map(function (x) { return x.tx - x.tn; }));
    }
    var site = siteParJour(D);
    R.siteJ = [];
    for (d = d0 - 3; d <= d1 + 1; d++) {
      var iso2 = isoFromDayNum_(d), r = site[iso2];
      R.siteJ.push({ date: iso2, e: r ? r.e : null, g: r ? r.g : null, salon: d >= d0 && d <= d1 });
    }
    R.siteOk = R.siteJ.some(function (x) { return x.e !== null || x.g !== null; });
    var extBy = {}, intBy = {};
    ext.forEach(function (x) { extBy[x.date] = x; });
    (t.jours || []).forEach(function (x) { intBy[x.date] = x; });
    R.jours = [];
    for (d = d0; d <= d1; d++) {
      var k = isoFromDayNum_(d);
      R.jours.push({ date: k, ext: extBy[k] || null, int: intBy[k] || null, site: site[k] || null });
    }
    var xs = [], ys = [];
    R.jours.forEach(function (j) { if (j.ext && j.int) { xs.push(j.ext.tmoy); ys.push(j.int.moy); } });
    R.corr = xs.length >= 4 ? pearson_(xs, ys) : null;
    var an = s.debut.slice(0, 4);
    R.comp = tous.filter(function (x) { return x.debut && x.debut.slice(0, 4) === an && isN_(x.ind.kwhM2DJU) && x.ind.kwhM2DJU > 0; })
      .map(function (x) { return { salon: x.salon, debut: x.debut, v: x.ind.kwhM2DJU, ici: x.id === s.id, confort: String(x.confort || '').trim().toUpperCase() }; })
      .sort(function (a, b) { return a.v - b.v; });
    var autres = R.comp.filter(function (x) { return !x.ici; }).map(function (x) { return x.v; });
    R.nAutres = autres.length;
    R.mediane = autres.length >= 2 ? mediane_(autres) : null;
    R.rang = 0;
    R.comp.forEach(function (x, i) { if (x.ici) R.rang = i + 1; });
    return R;
  }

  function rapportInterpretation_(R) {
    var s = R.s, o = R.o, t = R.t, P = R.P, auj = paris('iso');
    var C = { synthese: [], meteo: [], temp: [], conso: [], perf: [], qualite: [] };
    var lo = t.seuilBas, hi = t.seuilHaut;
    // ---- Météo
    if (R.ext.length) {
      C.meteo.push('Température extérieure moyenne de <b>' + fr_(R.extMoy) + ' °C</b> sur la période (mini ' + fr_(R.extMin) + ' °C, maxi ' + fr_(R.extMax) + ' °C).');
      if (isN_(o.djuJour)) {
        var dj = o.djuJour;
        C.meteo.push(dj >= 10 ? 'Période froide (' + fr_(dj) + ' DJU/jour) : besoin de chauffage important.'
          : dj >= 5 ? 'Période fraîche (' + fr_(dj) + ' DJU/jour) : besoin de chauffage modéré.'
            : dj > 0 ? 'Période douce (' + fr_(dj) + ' DJU/jour) : besoin de chauffage faible.'
              : 'Pas de besoin de chauffage : température moyenne au-dessus de la base DJU (' + fr_(P.baseDJU, 0) + ' °C).');
      }
      if (isN_(o.djfJour) && o.djfJour > 0) C.meteo.push('Chaleur : ' + fr_(o.djfJour) + ' DJF/jour au-dessus de ' + fr_(P.seuilDJF, 0) + ' °C, besoin de rafraîchissement.');
      if (isN_(R.amplitude) && R.amplitude >= 12) C.meteo.push('Forte amplitude jour / nuit (' + fr_(R.amplitude) + ' °C en moyenne) : les relances du matin pèsent sur la consommation.');
    } else C.meteo.push('Aucune donnée météo sur la période (onglet Météo › Mettre à jour).');
    // ---- Températures des halls
    if (t.nVal) {
      C.temp.push('Température moyenne relevée dans les halls : <b>' + fr_(t.moy) + ' °C</b> (de ' + fr_(t.min) + ' à ' + fr_(t.max) + ' °C, ' + t.nRel + ' relevés).');
      if (isN_(R.extMoy)) C.temp.push('Écart moyen intérieur / extérieur : ' + fr_(t.moy - R.extMoy) + ' °C.');
      if (isN_(t.pctConfort)) {
        var pcC = t.pctConfort;
        var cote = (t.pctFroid >= 0.1 && t.pctFroid >= t.pctChaud) ? ' Les écarts sont surtout <b>côté froid</b> (' + pc_(t.pctFroid) + ' des valeurs sous ' + fr_(lo) + ' °C).'
          : t.pctChaud >= 0.1 ? ' Les écarts sont surtout <b>côté chaud</b> (' + pc_(t.pctChaud) + ' des valeurs au-dessus de ' + fr_(hi) + ' °C).' : '';
        C.temp.push(pc_(pcC) + ' des valeurs dans la plage de confort ' + fr_(lo) + ' – ' + fr_(hi) + ' °C : <b>' +
          (pcC >= 0.8 ? 'confort bien tenu' : pcC >= 0.5 ? 'confort partiellement tenu' : 'confort insuffisant') + '</b>.' + cote);
      }
      if (t.halls && t.halls.length > 1) {
        var hs = t.halls.slice().sort(function (a, b) { return a.moy - b.moy; }), fro = hs[0], ch = hs[hs.length - 1];
        if (ch.moy - fro.moy >= 1.5) C.temp.push('Écart entre halls : ' + h_(fro.hall) + ' le plus froid (' + fr_(fro.moy) + ' °C), ' + h_(ch.hall) + ' le plus chaud (' + fr_(ch.moy) + ' °C), soit ' + fr_(ch.moy - fro.moy) + ' °C d\'écart.');
        else C.temp.push('Températures homogènes entre les halls (écart des moyennes : ' + fr_(ch.moy - fro.moy) + ' °C).');
      }
      var aSurv = (t.halls || []).filter(function (x) { return isN_(x.pctConfort) && x.pctConfort < 0.6; });
      aSurv.sort(function (a, b) { return a.pctConfort - b.pctConfort; });
      var nSurv = aSurv.length; aSurv = aSurv.slice(0, 6);
      if (nSurv) C.temp.push((nSurv > 6 ? nSurv + ' halls sous 60 % des valeurs dans la plage ; les plus en écart : ' : 'Halls à surveiller (moins de 60 % des valeurs dans la plage) : ') + aSurv.map(function (x) { return h_(x.hall) + ' (' + pc_(x.pctConfort) + ')'; }).join(', ') + '.');
      if (isN_(lo) && t.jours && t.jours.length >= 2 && t.jours[0].moy < lo && t.jours.slice(1).some(function (x) { return x.moy >= lo; }))
        C.temp.push('Le premier jour est sous la plage de confort (' + fr_(t.jours[0].moy) + ' °C) : relance du chauffage probablement trop tardive.');
      if (R.corr !== null) {
        if (R.corr >= 0.7) C.temp.push('Les températures intérieures suivent nettement l\'extérieur (corrélation ' + fr_(R.corr, 2) + ') : les halls compensent mal les variations météo (régulation, portes ouvertes, déperditions).');
        else if (R.corr <= 0.3) C.temp.push('Températures intérieures peu liées à l\'extérieur (corrélation ' + fr_(R.corr, 2) + ') : la régulation compense bien la météo.');
      }
      if (s.confort === 'NON') C.temp.push('Salon noté « Confort : NON » : la plage de confort est indiquée comme simple repère.');
    } else if (t.sansHalls) C.temp.push('Aucun hall coché pour ce salon.');
    else C.temp.push('Aucun relevé de température pour les halls de ce salon sur la période.');
    // ---- Consommations
    var gaz = n0_(s.gaz), parc = n0_(s.elecParc);
    if (parc + gaz > 0) C.conso.push('Énergie consommée par le parc pendant le salon : <b>' + fr_(parc + gaz) + ' MWh</b> (électricité ' + fr_(parc) + ' MWh + gaz ' + fr_(gaz) + ' MWh), soit ' + fr_((parc + gaz) / o.jours) + ' MWh/jour.');
    var usages = o.cvc + o.fm + o.ecl;
    if (o.elec > 0 || usages > 0) {
      if (o.elec > 0) C.conso.push('Électricité des halls loués (lignes « total » des TGBT) : <b>' + fr_(o.elec) + ' MWh</b>' + (parc > 0 ? ', soit ' + pc_(o.elec / parc) + ' de l\'électricité du parc' : '') + '.');
      if (usages > o.elec * 1.02) {
        C.conso.push('Répartition par usage (sur ' + fr_(usages) + ' MWh relevés par usage) : CVC ' + pc_(o.cvc / usages) + ', force motrice ' + pc_(o.fm / usages) + ', éclairage ' + pc_(o.ecl / usages) +
          '. <b>Attention</b> : la somme des usages dépasse le total des halls (' + fr_(o.elec) + ' MWh), les index TGBT sont incomplets ou incohérents.');
      } else {
        C.conso.push('Répartition de l\'électricité des halls : CVC ' + pc_(o.cvc / o.elec) + ', force motrice ' + pc_(o.fm / o.elec) + ', éclairage ' + pc_(o.ecl / o.elec) + ', autres ' + pc_(o.autres / o.elec) + '.');
      }
    } else C.conso.push('Aucun index TGBT saisi : la consommation électrique des halls n\'est pas connue.');
    if (o.pvSite > 0) C.conso.push('Production photovoltaïque autoconsommée : <b>' + fr_(o.pvSite) + ' MWh</b> (parkings ' + fr_(o.pvParking) + ' MWh + hall 4.3 ' + fr_(o.pvHall) + ' MWh)' +
      (parc > 0 ? ', soit ' + pc_(o.pvSite / (parc + o.pvSite)) + ' de l\'électricité consommée par le parc (réseau Enedis + PV)' : '') + '.');
    if (o.cvcGaz > 0) C.conso.push('Chauffage / climatisation (CVC électrique + gaz) : <b>' + fr_(o.cvcGaz) + ' MWh</b>' + (gaz > 0 ? ', dont ' + pc_(gaz / o.cvcGaz) + ' de gaz' : '') +
      (isN_(o.kwhM2JourCvc) ? ', soit ' + fr_(o.kwhM2JourCvc, 2) + ' kWh/m²/jour sur ' + fr_(o.surfaceLouee, 0) + ' m²' : '') + '.');
    if (gaz > 0 && isN_(o.djuJour) && o.djuJour <= 0) C.conso.push('Du gaz a été consommé alors que la météo ne demandait pas de chauffage : à vérifier (consignes, eau chaude, autres usages du site).');
    if (isN_(o.horsTalon)) C.conso.push('Montage / démontage : ' + fr_(o.horsTalon) + ' MWh au-dessus du talon (' + pc_(o.pctHorsTalon) + ' de l\'électricité montage compris).');
    // ---- Performance
    var etat = 0, connu = false;
    if (isN_(o.kwhM2DJU)) {
      var ph = 'Ratio CVC + gaz : <b>' + fr_(o.kwhM2DJU, 3) + ' kWh/m²/DJU</b>';
      if (R.mediane !== null) {
        connu = true;
        var e = o.kwhM2DJU / R.mediane - 1, ref = ' à la médiane des ' + R.nAutres + ' autres salons de l\'année (' + fr_(R.mediane, 3) + ')';
        ph += e > 0.2 ? ', <b>supérieur de ' + pc_(e) + '</b>' + ref + ' : moins performant que d\'habitude'
          : e < -0.2 ? ', <b>inférieur de ' + pc_(-e) + '</b>' + ref + ' : plus performant que d\'habitude'
            : ', proche de la médiane des ' + R.nAutres + ' autres salons de l\'année (' + fr_(R.mediane, 3) + ')';
        ph += ' — rang ' + R.rang + ' sur ' + R.comp.length + ' (du plus sobre au plus consommateur)';
        if (e > 0.2) etat = 1; else if (e < -0.2) etat = -1;
      }
      C.perf.push(ph + '.');
    } else C.perf.push('Ratio kWh/m²/DJU non significatif (DJU/jour sous le seuil de ' + fr_(P.djuMini, 0) + ' ou données manquantes) : se référer au kWh/m²/jour (' + fr_(o.kwhM2JourCvc, 2) + ' en CVC + gaz).');
    if (isN_(o.ecart)) {
      connu = true;
      C.perf.push('Par rapport à la prévision (' + fr_(o.prevision) + ' MWh, base ' + fr_(P.coeffPrev, 2) + ' kWh/m²/DJU) : ' +
        (o.ecart > 0.2 ? '<b>surconsommation de ' + pc_(o.ecart) + '</b>.' : o.ecart < -0.2 ? '<b>consommation inférieure de ' + pc_(-o.ecart) + '</b>.' : 'consommation conforme (' + pc_(o.ecart, true) + ').'));
      if (!etat) { if (o.ecart > 0.2) etat = 1; else if (o.ecart < -0.2) etat = -1; }
    }
    // ---- Synthèse
    if (s.fin >= auj || o.lignesIncompletes)
      C.synthese.push('<i>Interprétation provisoire : ' + (s.fin >= auj ? 'salon en cours' : 'index TGBT incomplets') + ', les consommations et ratios évolueront une fois toutes les données saisies.</i>');
    var pc = t.pctConfort;
    C.synthese.push(h_(s.salon) + ' : ' + o.jours + ' jour(s), ' + fr_(o.surfaceLouee, 0) + ' m² loués, ' +
      (R.ext.length ? 'T extérieure moyenne ' + fr_(R.extMoy) + ' °C' : 'météo indisponible') +
      (t.nVal ? ', T halls moyenne ' + fr_(t.moy) + ' °C' : '') + (o.cvcGaz > 0 ? ', CVC + gaz ' + fr_(o.cvcGaz) + ' MWh' : '') + '.');
    var norme = connu ? 'consommation dans la norme' : 'consommation sans point de comparaison';
    if (isN_(pc)) {
      if (etat === 1 && t.pctChaud >= 0.2) C.synthese.push('<b>Surchauffe probable</b> : consommation élevée et halls souvent au-dessus de la plage de confort → abaisser les consignes ou réduire les plages de fonctionnement.');
      else if (etat === 1 && pc < 0.5) C.synthese.push('<b>Consommation élevée sans atteindre le confort</b> : rechercher des déperditions (portes de quai ouvertes, montage) ou un défaut des installations CVC.');
      else if (etat === 1) C.synthese.push('<b>Confort tenu mais consommation supérieure à l\'habitude</b> : marge d\'optimisation sur les consignes et les horaires de relance.');
      else if (etat === -1 && pc >= 0.8) C.synthese.push('<b>Bon compromis</b> : confort tenu avec une consommation inférieure à l\'habitude.');
      else if (etat === -1 && t.pctFroid >= 0.2) C.synthese.push('<b>Consommation basse mais halls souvent trop froids</b> : chauffage relancé trop tard ou insuffisant.');
      else if (pc >= 0.8) C.synthese.push('<b>Situation satisfaisante</b> : confort bien tenu, ' + norme + '.');
      else if (pc < 0.5) C.synthese.push('<b>Confort insuffisant</b> (' + pc_(pc) + ' des valeurs dans la plage), ' + norme + ' : vérifier consignes et horaires.');
      else C.synthese.push('Confort partiellement tenu (' + pc_(pc) + ' des valeurs dans la plage), ' + (etat === 1 ? 'consommation élevée' : etat === -1 ? 'consommation basse' : norme) + '.');
    } else if (etat) C.synthese.push('Consommation CVC + gaz <b>' + (etat === 1 ? 'supérieure' : 'inférieure') + '</b> à l\'habitude (pas de relevé de température pour juger du confort).');
    // ---- Fiabilité
    if (!o.lignesSaisies) C.qualite.push('Aucun index TGBT saisi.');
    if (o.lignesIncompletes) C.qualite.push(o.lignesIncompletes + ' ligne(s) TGBT incomplète(s) (index avant ou après manquant).');
    var usg = o.cvc + o.fm + o.ecl;
    if (usg > o.elec * 1.02) C.qualite.push('Somme des usages CVC + FM + ECL (' + fr_(usg) + ' MWh) supérieure au total électricité des halls (' + fr_(o.elec) + ' MWh).');
    if (n0_(s.elecParc) > 0 && Math.max(o.elec, usg) > n0_(s.elecParc) * 1.05) {
      var top = (o.parTgbt || []).map(function (x) { return { t: x.tgbt, v: Math.max(x.elec, x.cvc + x.fm + x.ecl) }; })
        .sort(function (a, b) { return b.v - a.v; }).slice(0, 3).filter(function (x) { return x.v > 0; });
      C.qualite.push('<b>Incohérence</b> : les index TGBT donnent ' + fr_(Math.max(o.elec, usg)) + ' MWh, plus que l\'électricité de tout le parc (' + fr_(n0_(s.elecParc)) + ' MWh, Enedis). Index ou coefficients probablement erronés, à vérifier en priorité sur : ' +
        top.map(function (x) { return h_(x.t) + ' (' + fr_(x.v) + ' MWh)'; }).join(', ') + '.');
    }
    if (o.negatifs) C.qualite.push(o.negatifs + ' ligne(s) avec consommation négative : index à vérifier.');
    if (o.jours && o.joursMeteo < o.jours) C.qualite.push('Météo disponible pour ' + o.joursMeteo + ' jour(s) sur ' + o.jours + '.');
    if (t.nonRelies && t.nonRelies.length) C.qualite.push('Halls sans colonne de température associée : ' + t.nonRelies.map(function (x) { return h_(x); }).join(', ') + '.');
    if (s.fige === 'OUI') C.qualite.push('Valeurs élec / CVC / FM / ECL reprises de l\'ancien classeur Excel (salon figé).');
    if (s.djuForces !== '') C.qualite.push('DJU forcés à ' + fr_(s.djuForces, 1) + ' (calculés : ' + fr_(o.djuCalcules, 1) + ').');
    var manq = R.jours.filter(function (j) { return !j.site; }).length;
    if (manq) C.qualite.push('Consommation du site absente de Conso_Site pour ' + manq + ' jour(s) du salon.');
    return C;
  }

  function chartTemp_(R) {
    var t = R.t, lo = t.seuilBas, hi = t.seuilHaut, bornes = isN_(lo) && isN_(hi);
    var rows = R.jours.filter(function (j) { return j.ext || j.int; });
    if (rows.length < 2) return '';
    var lab = rows.map(function (j) { return dcourt_(j.date); });
    var sr = [
      { name: 'Halls moyenne', color: CH.fonce, values: rows.map(function (j) { return j.int ? r1_(j.int.moy) : null; }) },
      { name: 'Halls mini', color: CH.vertClair, values: rows.map(function (j) { return j.int ? r1_(j.int.min) : null; }) },
      { name: 'Halls maxi', color: CH.corail, values: rows.map(function (j) { return j.int ? r1_(j.int.max) : null; }) },
      { name: 'Extérieur moyenne', color: CH.orange, values: rows.map(function (j) { return j.ext ? r1_(j.ext.tmoy) : null; }) }];
    if (bornes) sr.push({ name: 'Confort mini', color: CH.ardoise, dash: true, values: rows.map(function () { return lo; }) },
      { name: 'Confort maxi', color: CH.ardoise, dash: true, values: rows.map(function () { return hi; }) });
    return courbes({ labels: lab, series: sr, title: 'Températures journalières (°C)', w: 760, h: 340 });
  }
  function chartSite_(R) {
    if (!R.siteOk) return '';
    return colonnes({ labels: R.siteJ.map(function (j) { return dcourt_(j.date) + (j.salon ? ' •' : ''); }),
      series: [{ name: 'Électricité parc', color: CH.vert, values: R.siteJ.map(function (j) { return j.e === null ? 0 : r1_(j.e, 2); }) },
        { name: 'Gaz', color: CH.corail, values: R.siteJ.map(function (j) { return j.g === null ? 0 : r1_(j.g, 2); }) }],
      title: 'Consommation journalière du site (MWh) — • = jour de salon', legend: true, w: 760, h: 320 });
  }
  function chartRep_(R) {
    var o = R.o;
    var parts = [['CVC électrique', o.cvc, CH.fonce], ['Force motrice', o.fm, CH.vert], ['Éclairage', o.ecl, CH.orange], ['Autres', o.autres, CH.ardoise], ['Gaz', n0_(R.s.gaz), CH.corail]]
      .filter(function (p) { return isN_(p[1]) && p[1] > 0; }).map(function (p) { return [p[0], r1_(p[1], 2), p[2]]; });
    if (!parts.length) return '';
    return camembert({ parts: parts, title: 'Répartition de l\'énergie des halls (élec TGBT + gaz, MWh)', w: 760, h: 380 });
  }
  function chartComp_(R) {
    if (R.comp.length < 2) return '';
    var col = function (x) { return x.ici ? CH.fonce : x.confort === 'OUI' ? CH.vertClair : x.confort === 'NON' ? CH.orange : CH.ardoise; };
    var vus = {}; R.comp.forEach(function (x) { if (!x.ici) vus[x.confort === 'OUI' ? 0 : x.confort === 'NON' ? 1 : 2] = 1; });
    var leg = [['Autres salons · confort OUI', CH.vertClair], ['Autres salons · confort NON', CH.orange], ['Autres salons · confort non renseigné', CH.ardoise]]
      .filter(function (l, k) { return vus[k]; }).map(function (l) { return { name: l[0], color: l[1] }; }).concat([{ name: 'Ce salon', color: CH.fonce }]);
    return barresH({ title: 'kWh/m²/DJU (CVC + gaz) — salons ' + R.s.debut.slice(0, 4), legend: leg, w: 760,
      rows: R.comp.map(function (x) {
        var n = x.salon.length > 26 ? x.salon.slice(0, 25) + '…' : x.salon;
        var lib = x.confort === 'OUI' ? 'confort oui' : x.confort === 'NON' ? 'confort non' : 'confort ?';
        return { t: n + ' (' + dcourt_(x.debut) + ') · ' + lib, v: r1_(x.v, 3), c: col(x), gras: x.ici };
      }) });
  }

  /* Éditions précédentes (RapportSalonComparaison.gs) */
  var RS_MOTS_VIDES = ['salon', 'de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'et', 'lyon', 'eurexpo', 'en', 'au', 'a'];
  function rsMots_(nom) {
    return String(nom || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
      .filter(function (m) { return m && RS_MOTS_VIDES.indexOf(m) < 0; });
  }
  function rsEditions_(s, tous) {
    if (!s || !s.debut) return [];
    var a = rsMots_(s.salon); if (!a.length) return [];
    var parAn = {};
    tous.forEach(function (x) {
      if (!x.debut || x.id === s.id || x.debut.slice(0, 4) >= s.debut.slice(0, 4)) return;
      var b = rsMots_(x.salon), inter = a.filter(function (m) { return b.indexOf(m) >= 0; }).length;
      if (!inter) return;
      var jac = inter / (a.length + b.length - inter);
      var ecart = Math.abs(((dayNum_(s.debut) - dayNum_(x.debut)) % 365.25 + 365.25 + 182) % 365.25 - 182);
      if (jac < 0.5 && ecart > 30) return;
      var sc = jac + (ecart <= 30 ? 0.5 : 0), an = x.debut.slice(0, 4);
      if (!parAn[an] || sc > parAn[an].sc) parAn[an] = { sc: sc, x: x };
    });
    return Object.keys(parAn).sort().reverse().map(function (an) { return parAn[an].x; });
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
    var A = L[0], B = L[1];
    h += '<tr class="tot"><td class="l" colspan="2">Écart ' + A.an + ' / ' + B.an + '</td>' +
      cols.map(function (c) {
        var e = c[1] === 'tMoy' ? (isN_(A.tMoy) && isN_(B.tMoy) ? A.tMoy - B.tMoy : null) : rsEcart_(A[c[1]], B[c[1]]);
        return '<td>' + (e === null ? '' : (c[1] === 'tMoy' ? (e > 0 ? '+' : '') + fr_(e, 1) + ' °C' : pc_(e, true))) + '</td>';
      }).join('') + '</tr></table>';
    h += '<p class="muted">Éditions retrouvées par le nom du salon. Ratios recalculés avec les mêmes formules pour toutes les années ' +
      '(kWh/m²/jour sur élec halls + gaz, kWh/m²/DJU sur CVC + gaz). ' +
      (L.some(function (x, i) { return i > 0 && x.fige; }) ? '* valeurs figées (reprises des classeurs des années précédentes ; CVC non relevé quand « — »). ' : '') +
      'Élec parc et gaz : compteurs Enedis et GRDF du site sur les jours du salon.</p>';
    if (L.length >= 2) {
      var R2 = L.slice().reverse();
      h += img_(colonnes({ labels: R2.map(function (x) { return x.an; }), series: [{ name: 'kWh/m²/jour', color: CH.vert, values: R2.map(function (x) { return isN_(x.kwhM2Jour) ? r1_(x.kwhM2Jour, 2) : 0; }) }],
        title: 'Intensité énergétique par édition (kWh/m²/jour, élec halls + gaz)', ytitle: 'kWh/m²/jour', w: 700, h: 260 }), 600);
    }
    return h;
  }

  function rapportHtml_(R, halls) {
    var s = R.s, o = R.o, t = R.t, C = R.comm, P = R.P;
    var ul = function (a) { return a.length ? '<ul>' + a.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' : ''; };
    var hallsTxt = s.halls ? s.halls.split(/\s*,\s*/).join(', ') : '—';
    var periode = 'Du ' + dfr_(s.debut) + ' au ' + dfr_(s.fin) + ' (' + o.jours + ' jour' + (o.jours > 1 ? 's' : '') + ')';
    var nH = s.halls ? s.halls.split(/\s*,\s*/).filter(String).length : 0;
    var cover = chCouverture_('Rapport énergétique', s.salon, [periode, (nH > 6 ? nH + ' halls' : 'Halls : ' + hallsTxt) + ' · ' + u_(o.surfaceLouee, 0, 'm²') + ' loués']);
    var h = '<h1>' + h_(s.salon) + '</h1>';
    h += '<div class="sub">' + periode + ' · ' + u_(o.surfaceLouee, 0, 'm²') + ' · Confort : ' + h_(s.confort || '—') + '</div>';
    h += '<div class="muted" style="margin-top:-3mm;margin-bottom:3mm">Halls : ' + h_(hallsTxt) + '</div>';
    var sel = {}; (s.halls || '').split(/\s*,\s*/).filter(String).forEach(function (x) { sel[x] = 1; });
    if (Object.keys(sel).length) h += '<h2>Plan des halls utilisés</h2>' + img_(planSvg_(sel, halls), 660);
    h += '<h2>Synthèse</h2><div class="syn">' + ul(C.synthese) + '</div>';
    h += '<h2>Chiffres clés</h2>' + chTuiles_([
      [u_(R.extMoy, 1, '°C'), 'T extérieure moyenne'],
      [t.nVal ? u_(t.moy, 1, '°C') : '—', 'T moyenne des halls'],
      [pc_(t.pctConfort), 'Valeurs dans la plage de confort'],
      [u_(o.djuRetenus, 1), 'DJU retenus' + (s.djuForces !== '' ? ' (forcés)' : '') + ' · ' + u_(o.djuJour, 2) + ' / jour'],
      [u_(s.elecParc, 1, 'MWh'), 'Électricité parc (Enedis)'],
      [u_(s.gaz, 1, 'MWh'), 'Gaz (GRDF)'],
      [u_(o.elec, 1, 'MWh'), 'Électricité des halls (TGBT) · dont CVC ' + u_(o.cvc, 1, 'MWh')],
      [u_(o.cvcGaz, 1, 'MWh'), 'CVC + gaz'],
      [isN_(o.kwhM2DJU) ? fr_(o.kwhM2DJU, 3) : 'n.s.', 'kWh/m²/DJU (CVC + gaz)'],
      [pc_(o.ecart, true), 'Écart / prévision'],
      [u_(o.pvSite, 1, 'MWh'), 'Production PV autoconsommée' + (o.pvSite > 0 ? ' (parking ' + fr_(o.pvParking) + ' + hall 4.3 ' + fr_(o.pvHall) + ')' : '')]
    ], 4);
    h += '<h2>Conditions extérieures</h2>' + ul(C.meteo);
    h += '<h2>Températures dans les halls</h2>' + ul(C.temp) + img_(chartTemp_(R));
    if (t.halls && t.halls.length) {
      h += '<table><tr><th class="l">Hall</th><th>Moyenne</th><th>Mini</th><th>Maxi</th><th>Dans la plage</th><th>Valeurs</th></tr>' +
        t.halls.map(function (x) {
          return '<tr><td class="l">' + h_(x.hall) + '</td><td><b>' + fr_(x.moy) + '</b></td><td>' + fr_(x.min) + '</td><td>' + fr_(x.max) +
            '</td><td>' + pc_(x.pctConfort) + '</td><td>' + x.n + '</td></tr>';
        }).join('') + '</table><div class="muted">Températures en °C' + (isN_(t.seuilBas) && isN_(t.seuilHaut) ? ', plage de confort ' + fr_(t.seuilBas) + ' – ' + fr_(t.seuilHaut) + ' °C' : '') + '.</div>';
    }
    h += '<h2>Consommations</h2>' + ul(C.conso) + img_(chartRep_(R)) + img_(chartSite_(R));
    var pt = o.parTgbt || [];
    if (pt.length) {
      var sum = function (k) { return pt.reduce(function (a, x) { return a + (x[k] || 0); }, 0); };
      h += '<table><tr><th class="l">TGBT</th><th>Élec</th><th>CVC</th><th>FM</th><th>ECL</th><th>Autres</th></tr>' +
        pt.map(function (x) {
          return '<tr><td class="l">' + h_(x.tgbt) + '</td><td><b>' + fr_(x.elec, 2) + '</b></td><td>' + fr_(x.cvc, 2) + '</td><td>' + fr_(x.fm, 2) +
            '</td><td>' + fr_(x.ecl, 2) + '</td><td>' + fr_(x.autres, 2) + '</td></tr>';
        }).join('') +
        '<tr class="tot"><td class="l">Total</td><td>' + fr_(sum('elec'), 2) + '</td><td>' + fr_(sum('cvc'), 2) + '</td><td>' + fr_(sum('fm'), 2) +
        '</td><td>' + fr_(sum('ecl'), 2) + '</td><td>' + fr_(sum('autres'), 2) + '</td></tr></table>' +
        '<div class="muted">MWh, d\'après les index TGBT saisis. Le gaz n\'est pas réparti par hall.</div>';
    }
    h += '<h2>Performance énergétique</h2>' + ul(C.perf) + img_(chartComp_(R));
    if (R.editions && R.editions.length) h += rsHtml_(s, R.editions);
    h += '<h2>Détail jour par jour</h2><table><tr><th class="l">Jour</th><th>T ext. mini</th><th>T ext. maxi</th><th>T ext. moy.</th><th>DJU</th>' +
      '<th>T halls moy.</th><th>T halls mini</th><th>T halls maxi</th><th>Élec site (MWh)</th><th>Gaz site (MWh)</th></tr>' +
      R.jours.map(function (j) {
        var e = j.ext || {}, i = j.int || {}, st = j.site || {};
        return '<tr><td class="l">' + dfr_(j.date) + '</td><td>' + u_(e.tn) + '</td><td>' + u_(e.tx) + '</td><td>' + u_(e.tmoy) + '</td><td>' + u_(e.dju) +
          '</td><td><b>' + u_(i.moy) + '</b></td><td>' + u_(i.min) + '</td><td>' + u_(i.max) +
          '</td><td>' + u_(st.e, 2) + '</td><td>' + u_(st.g, 2) + '</td></tr>';
      }).join('') + '</table>';
    if (C.qualite.length) h += '<h2>Fiabilité des données</h2>' + ul(C.qualite);
    h += chFin_('Rapport généré le ' + paris() + '. DJU base ' + fr_(P.baseDJU, 0) + ' °C, DJF au-dessus de ' + fr_(P.seuilDJF, 0) +
      ' °C (météo station ' + h_(P.meteoStation) + '). Électricité parc = compteurs Enedis, gaz = compteurs GRDF du site (onglet Conso_Site). ' +
      'Températures : relevés Dalkia des halls loués. Interprétation calculée automatiquement à partir des données : à confirmer par l\'exploitant.');
    return { cover: cover, body: h };
  }

  function rapportSalon(salonId) {
    return FB.prets().then(lireCharte).then(function () {
      var D = FB.D, X = M.tousCalcules(D), tous = X.tous;
      var s = tous.filter(function (x) { return x.id === String(salonId); })[0];
      if (!s) throw new Error('Salon introuvable.');
      if (!s.debut || !s.fin) throw new Error('Renseigne les dates du salon avant d\'éditer le rapport.');
      IMGS = [];
      var R = rapportDonnees_(s, tous, X.P, X.meteo, D);
      R.comm = rapportInterpretation_(R);
      try { R.editions = rsEditions_(s, tous); } catch (e) { R.editions = []; console.warn(e); }
      if (R.editions.length) { var p = rsPhrase_(s, R.editions[0]); if (p) R.comm.synthese.push(p); }
      var doc = rapportHtml_(R, X.halls);
      var nom = ('Rapport ' + s.salon + ' ' + s.debut).replace(/[\\\/:*?"<>|]+/g, '-') + '.pdf';
      return fairePdf(doc, nom);
    });
  }

  /* ================= rapport PV mensuel ================= */
  var PV_MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function pvPad_(n) { return ('0' + n).slice(-2); }
  function pvFr_(v, d) {
    if (v === null || v === undefined || v === '' || !isFinite(v)) return '—';
    var s = Number(v).toFixed(d === undefined ? 1 : d), p = s.split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return p.join(',');
  }
  function pvMWh_(kwh, d) { return kwh === null || kwh === undefined ? '—' : pvFr_(kwh / 1000, d === undefined ? 1 : d); }
  function pvHM_(h) { if (!h || h <= 0) return '—'; var m = Math.round(h * 60); return Math.floor(m / 60) + ' h ' + pvPad_(m % 60); }
  var pvEsc_ = h_;
  /* période du rapport : mois entier ou période libre (R.d0 → R.d1) */
  function pvBornes_(R) { return R.d0 ? [R.d0, R.d1] : [R.mois + '-01', R.mois + '-' + pvPad_(R.nbJ)]; }
  function pvSur_(R) { return R.d0 ? 'la période' : 'le mois'; }
  function pvDu_(R) { return R.d0 ? 'de la période' : 'du mois'; }

  function pvJl_(R, j, i) { var d = +j.d.slice(8); return R.d0 && (d === 1 || i === 0) ? d + '/' + j.d.slice(5, 7) : String(d); }
  function pvSiteMois_(R, D) {
    if (!(D.srv && D.srv.siteOk)) return null;
    var site = {}, B = pvBornes_(R);
    ((D.srv && D.srv.site) || []).forEach(function (r) { if (r.d && r.d >= B[0] && r.d <= B[1]) site[r.d] = { e: r.e == null ? null : r.e, g: r.g == null ? null : r.g }; });
    var S = { elec: 0, gaz: 0, jE: 0, jG: 0, jours: [] };
    R.jours.forEach(function (j) {
      var s = site[j.d] || {}, pv = (j.park || 0) + (j.h43 || 0);
      if (s.e !== null && s.e !== undefined) { S.elec += s.e; S.jE++; }
      if (s.g !== null && s.g !== undefined) { S.gaz += s.g; S.jG++; }
      S.jours.push({ d: j.d, e: s.e === undefined ? null : s.e, g: s.g === undefined ? null : s.g, pv: (j.park !== null || j.h43 !== null) ? pv / 1000 : null });
    });
    if (!S.jE && !S.jG) return null;
    S.auto = R.auto !== null ? R.auto / 1000 : null;
    S.total = S.jE ? S.elec + (S.auto || 0) : null;
    S.couverture = (S.total && S.auto !== null) ? S.auto / S.total : null;
    return S;
  }
  function pvEvenementsMois_(R, X) {
    var B = pvBornes_(R), d0 = B[0], d1 = B[1];
    var calc = X.tous.filter(function (s) { return s.debut && s.fin && s.debut <= d1 && s.fin >= d0; });
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
      p.push(E.liste.length + ' évènement' + (E.liste.length > 1 ? 's' : '') + ' sur ' + n + ' jour' + (n > 1 ? 's' : '') + ' ' + pvDu_(R) + '.');
    } else if (E) p.push('Aucun évènement sur ' + pvSur_(R) + '.');
    return p.join(' ');
  }
  function pvSiteHtml_(R, S, E) {
    var h = '<h2 class="brk">Consommation du site</h2>';
    if (!S) h += '<p class="muted">Pas de relevé de consommation du site (onglet Conso_Site) pour ' + (R.d0 ? 'cette période' : 'ce mois') + '.</p>';
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
      if (E && S.jE) {
        var a = { e: 0, n: 0 }, b = { e: 0, n: 0 };
        S.jours.forEach(function (j) { if (j.e === null) return; var x = E.jours[j.d] ? a : b; x.e += j.e; x.n++; });
        if (a.n && b.n) h += '<div class="syn"><p>Élec soutirée en moyenne <b>' + pvFr_(a.e / a.n, 2) + ' MWh/jour</b> les jours d\'évènement (' + a.n + ' j) contre <b>' +
          pvFr_(b.e / b.n, 2) + ' MWh/jour</b> les autres jours (' + b.n + ' j).</p></div>';
      }
      if (S.jE) h += img_(colonnes({ labels: S.jours.map(function (j, i) { return pvJl_(R, j, i) + (E && E.jours[j.d] ? '•' : ''); }), stacked: true, legend: true,
        series: [{ name: 'Élec soutirée réseau', color: CH.ardoise, values: S.jours.map(function (j) { return j.e || 0; }) },
          { name: 'PV autoconsommé', color: CH.vert, values: S.jours.map(function (j) { return j.pv || 0; }) }],
        title: 'Consommation élec du site par jour (MWh) — • jour d\'évènement', ytitle: 'MWh / jour', w: 1000, h: 320 }), 680);
      if (S.jE < R.nbJ) h += '<div class="note">Consommation du site : ' + (R.nbJ - S.jE) + ' jour(s) sans relevé dans Conso_Site.</div>';
    }
    h += '<h2>Évènements ' + pvDu_(R) + '</h2>';
    if (!E || !E.liste.length) h += '<p class="muted">Aucun évènement sur ' + pvSur_(R) + '.</p>';
    else {
      h += '<table><tr><th class="l">Évènement</th><th class="l">Dates</th><th>Jours</th><th>Surface (m²)</th><th>Élec halls (MWh)</th><th>dont CVC</th><th>Élec parc (MWh)</th><th>Gaz (MWh)</th><th>kWh/m²/DJU</th></tr>';
      E.liste.forEach(function (s) {
        var o = s.ind;
        h += '<tr><td class="l">' + pvEsc_(s.salon) + '</td><td class="l">' + dcourt_(s.debut) + ' → ' + dcourt_(s.fin) + '</td><td>' + s.joursMois + (s.joursMois !== o.jours ? ' / ' + o.jours : '') +
          '</td><td>' + pvFr_(o.surfaceLouee || null, 0) + '</td><td>' + pvFr_(o.lignesSaisies ? o.elec : null, 1) + '</td><td>' + pvFr_(o.lignesSaisies ? o.cvc : null, 1) +
          '</td><td>' + pvFr_(s.elecParc === '' ? null : s.elecParc, 1) + '</td><td>' + pvFr_(s.gaz === '' ? null : s.gaz, 1) + '</td><td>' + (typeof o.kwhM2DJU === 'number' ? pvFr_(o.kwhM2DJU, 3) : 'n.s.') + '</td></tr>';
      });
      h += '</table><p class="muted">Jours : jours de l\'évènement ' + (R.d0 ? 'dans la période' : 'dans le mois') + ' (/ durée totale s\'il en déborde). Élec halls et CVC : index des TGBT relevés avant / après l\'évènement. ' +
        'Élec parc et gaz : compteurs Enedis et GRDF du site sur les jours de l\'évènement (comptés pour chaque évènement s\'ils se chevauchent).</p>';
    }
    return h;
  }
  function pvRapportHtml_(R, X, D) {
    var y = R.mois.slice(0, 4), titre = R.label.charAt(0).toUpperCase() + R.label.slice(1);
    var part = (R.prod > 0 && R.auto !== null) ? R.auto / R.prod * 100 : null;
    var S = null, E = null;
    try { S = pvSiteMois_(R, D); } catch (e) { console.warn(e); }
    try { E = pvEvenementsMois_(R, X); } catch (e) { console.warn(e); }
    var cover = chCouverture_('Rapport de production photovoltaïque', titre, ['Centrale d\'injection · PV des parkings · PV du hall 4.3']);
    var h = '<h1>Production photovoltaïque</h1><div class="sub">' + pvEsc_(titre) + '</div>';
    var phr = (R.d0 ? 'Du ' + R.label.replace(/^du /, '') : 'En ' + R.label) + ', la centrale a injecté <b>' + pvMWh_(R.jInj ? R.inj : null) + ' MWh</b> sur le réseau';
    phr += R.auto !== null ? ' et le site a autoconsommé <b>' + pvMWh_(R.auto) + ' MWh</b> de production PV (parkings ' + pvMWh_(R.jPark ? R.park : null) + ' MWh, hall 4.3 ' + pvMWh_(R.h43) + ' MWh).' : '.';
    phr += R.nInd ? ' ' + R.nInd + ' indisponibilité' + (R.nInd > 1 ? 's ont' : ' a') + ' été relevée' + (R.nInd > 1 ? 's' : '') + ' pour <b>' + pvHM_(R.hInd) + '</b> cumulées sur ' + R.jInd + ' jour' + (R.jInd > 1 ? 's' : '') + '.' : ' Aucune indisponibilité n\'a été relevée.';
    var ps = pvSitePhrase_(R, S, E);
    h += '<h2>Synthèse</h2><div class="syn"><p>' + phr + (ps ? ' ' + ps : '') + '</p></div>';
    var manq = [];
    if (R.jInj < R.nbJ) manq.push('injection : ' + (R.nbJ - R.jInj) + ' jour(s) sans relevé');
    if (R.jPark < R.nbJ) manq.push('PV parkings : ' + (R.nbJ - R.jPark) + ' jour(s) sans relevé');
    if (R.h43 === null) manq.push('PV hall 4.3 non renseigné');
    else if (R.jH43 && R.jH43 < R.nbJ) manq.push('PV hall 4.3 : ' + (R.nbJ - R.jH43) + ' jour(s) sans relevé');
    if (manq.length) h += '<div class="note">Données incomplètes — ' + pvEsc_(manq.join(' ; ')) + '.</div>';
    h += '<h2>Chiffres clés</h2>' + chTuiles_([
      [pvMWh_(R.jInj ? R.inj : null) + ' MWh', 'Injection réseau (postes PTR1 à PTR4)'],
      [pvMWh_(R.jPark ? R.park : null) + ' MWh', 'PV parkings, autoconsommé (Enspire)'],
      [pvMWh_(R.h43) + ' MWh', 'PV hall 4.3, autoconsommé (' + (R.jH43 ? 'FusionSolar' : 'index TGBT') + ')'],
      [pvMWh_(R.auto) + ' MWh', 'Autoconsommation site'],
      [pvMWh_(R.prod) + ' MWh', 'Production PV totale'],
      [pvFr_(part, 0) + ' %', 'Part autoconsommée'],
      [pvHM_(R.hInd), 'Indisponibilités · ' + R.nInd + ' évènement' + (R.nInd > 1 ? 's' : '')],
      [R.jInd + ' j', 'Jours concernés par une indisponibilité']
    ], 4);
    var jl = R.jours.map(function (j, i) { return pvJl_(R, j, i); });
    h += '<h2>Production journalière</h2>';
    if (R.jInj) h += img_(colonnes({ labels: jl, series: [{ name: 'Injection réseau (MWh)', color: CH.fonce, values: R.jours.map(function (j) { return Math.round(j.inj || 0) / 1000; }) }],
      title: 'Injection réseau — postes PTR1 à PTR4 (MWh / jour)', ytitle: 'MWh / jour', w: 1000, h: 300 }), 680);
    if (R.jPark) h += img_(colonnes({ labels: jl, series: [{ name: 'PV parkings (kWh)', color: CH.vert, values: R.jours.map(function (j) { return Math.round(j.park || 0); }) }],
      title: 'PV parkings autoconsommé (kWh / jour)', ytitle: 'kWh / jour', w: 1000, h: 260 }), 680);
    if (R.jH43) h += img_(colonnes({ labels: jl, series: [{ name: 'PV hall 4.3 (kWh)', color: CH.vertClair, values: R.jours.map(function (j) { return Math.round(j.h43 || 0); }) }],
      title: 'PV hall 4.3 autoconsommé (kWh / jour)', ytitle: 'kWh / jour', w: 1000, h: 260 }), 680);
    h += '<h2 class="brk">Indisponibilités (Agregio)</h2>';
    if (!R.ind.length) h += '<p class="muted">Aucune indisponibilité relevée sur ' + pvSur_(R) + '.</p>';
    else {
      h += '<table><tr><th class="l">Début</th><th class="l">Fin</th><th>Durée</th><th class="l">Type</th><th class="l">Source</th></tr>';
      R.ind.forEach(function (x) {
        h += '<tr><td class="l">' + pvEsc_(x.debut) + '</td><td class="l">' + pvEsc_(x.fin) + '</td><td>' + pvHM_(x.h) +
          '</td><td class="l">' + pvEsc_(x.type) + '</td><td class="l">' + pvEsc_(x.source) + '</td></tr>';
      });
      h += '<tr class="tot"><td class="l" colspan="2">Total sur ' + pvSur_(R) + '</td><td>' + pvHM_(R.hInd) + '</td><td colspan="2"></td></tr></table>';
      h += '<p class="muted">Les rampes de montée/descente des groupes A et B ne sont pas comptées par Agregio.</p>';
    }
    if (R.comm) h += '<h2>Commentaire</h2><p>' + pvEsc_(R.comm).replace(/\n/g, '<br>') + '</p>';
    h += pvSiteHtml_(R, S, E);
    h += '<h2>Cumul ' + y + '</h2>' + img_(colonnes({ labels: R.annee.map(function (a) { return a.label.slice(0, 4); }), legend: true, ytitle: 'MWh', w: 1000, h: 300,
      series: [{ name: 'Injection réseau', color: CH.fonce, values: R.annee.map(function (a) { return Math.round(a.inj || 0) / 1000; }) },
        { name: 'Autoconsommation site', color: CH.vert, values: R.annee.map(function (a) { return Math.round(a.auto || 0) / 1000; }) }] }), 680);
    h += '<table><tr><th class="l">Mois</th><th>Injection (MWh)</th><th>PV parkings (MWh)</th><th>PV hall 4.3 (MWh)</th><th>Autoconso. (MWh)</th><th>Indispo.</th></tr>';
    var T = { inj: 0, park: 0, h43: 0, auto: 0, h: 0 };
    R.annee.forEach(function (a) {
      T.inj += a.inj || 0; T.park += a.park || 0; T.h43 += a.h43 || 0; T.auto += a.auto || 0; T.h += a.hInd || 0;
      h += '<tr' + ((R.d0 ? a.mois >= R.d0.slice(0, 7) && a.mois <= R.d1.slice(0, 7) : a.mois === R.mois) ? ' class="hl"' : '') + '><td class="l">' + a.label + '</td><td>' + pvMWh_(a.inj) + '</td><td>' + pvMWh_(a.park) + '</td><td>' +
        pvMWh_(a.h43) + '</td><td>' + pvMWh_(a.auto) + '</td><td>' + pvHM_(a.hInd) + '</td></tr>';
    });
    h += '<tr class="tot"><td class="l">Total</td><td>' + pvMWh_(T.inj) + '</td><td>' + pvMWh_(T.park) + '</td><td>' + pvMWh_(T.h43) +
      '</td><td>' + pvMWh_(T.auto) + '</td><td>' + pvHM_(T.h) + '</td></tr></table>';
    h += '<h2 class="brk">Détail par jour</h2><table><tr><th class="l">Jour</th><th>Injection (kWh)</th><th>PV parkings (kWh)</th><th>PV hall 4.3 (kWh)</th><th>Indisponibilité</th></tr>';
    var js = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
    R.jours.forEach(function (j) {
      var dj = new Date(+j.d.slice(0, 4), +j.d.slice(5, 7) - 1, +j.d.slice(8, 10)).getDay();
      h += '<tr><td class="l">' + js[dj] + ' ' + j.d.slice(8, 10) + '/' + j.d.slice(5, 7) + '</td><td>' + pvFr_(j.inj, 0) +
        '</td><td>' + pvFr_(j.park, 0) + '</td><td>' + pvFr_(j.h43, 0) + '</td><td>' + (j.h > 0 ? pvHM_(j.h) : '') + '</td></tr>';
    });
    h += '<tr class="tot"><td class="l">Total</td><td>' + pvFr_(R.jInj ? R.inj : null, 0) + '</td><td>' + pvFr_(R.jPark ? R.park : null, 0) + '</td><td>' + pvFr_(R.jH43 ? R.h43 * 1 : null, 0) + '</td><td>' + pvHM_(R.hInd) + '</td></tr></table>';
    h += chFin_('Rapport généré le ' + paris() + '. Sources : injection = somme des postes PTR1 à PTR4, PV parkings Enspire (Huawei), PV hall 4.3 FusionSolar (Huawei) ou index TGBT, indisponibilités Agregio (activations à prix spot négatif).');
    return { cover: cover, body: h };
  }
  function rapportPV(mois) {
    // les données PV (injection, parkings, hall 4.3, indisponibilités) sont encore dans le classeur : lues au script
    return Promise.all([FB.prets(), lireCharte(), FB.script('pvMois', [mois])]).then(function (r) {
      var R = r[2], D = FB.D, X = M.tousCalcules(D);
      IMGS = [];
      return fairePdf(pvRapportHtml_(R, X, D), 'Rapport PV ' + R.mois + '.pdf');
    });
  }

  /** Rapport PV sur une période libre : R = données déjà regroupées par l'appli (jours du … au …) */
  function rapportPVPer(R) {
    return Promise.all([FB.prets(), lireCharte()]).then(function () {
      var D = FB.D, X = M.tousCalcules(D);
      IMGS = [];
      var nom = 'Rapport PV du ' + R.d0 + ' au ' + R.d1 + '.pdf';
      return fairePdf(pvRapportHtml_(R, X, D), nom);
    });
  }

  /* ================= fabrication du PDF ================= */
  var MM = 96 / 25.4; // px CSS par mm
  function attendreImages(root) {
    return Promise.all([].slice.call(root.querySelectorAll('img')).map(function (im) {
      if (im.complete && im.naturalWidth) return null;
      return new Promise(function (ok) { im.onload = im.onerror = function () { ok(); }; });
    }));
  }
  function fairePdf(doc, nom) {
    var zone;
    return Promise.all([lib('h2c'), lib('pdf'), Promise.all(IMGS.map(function (x) { return svgPng(x.svg).then(function (u) { x.url = u; }); }))]).then(function () {
      zone = document.createElement('div');
      zone.style.cssText = 'position:fixed;left:-20000px;top:0;z-index:-1;background:#fff';
      zone.innerHTML = '<style>' + chCss_() + '</style><div id="rpCover">' + doc.cover + '</div>' +
        '<div id="rpBody" class="rp" style="width:182mm;padding:0 0 2mm">' + doc.body + '</div>';
      document.body.appendChild(zone);
      IMGS.forEach(function (x) { var im = zone.querySelector('#' + x.id); if (!im) return; if (x.url) im.src = x.url; else im.parentNode.innerHTML = '<p class="muted">Graphique indisponible.</p>'; });
      return attendreImages(zone);
    }).then(function () {
      var cover = zone.querySelector('#rpCover'), body = zone.querySelector('#rpBody');
      var pages = paginer(body, zone, (297 - 10 - 12) * MM);
      // fenêtre de rendu assez haute pour une page entière (sinon html2canvas coupe au bas de l'écran)
      var opt = { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: 1400, windowHeight: 1600, scrollX: 0, scrollY: 0 };
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      return window.html2canvas(cover.firstChild, opt).then(function (cc) {
        pdf.addImage(cc.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
        cover.style.display = 'none';
        return pages.reduce(function (p, pg, i) {
          return p.then(function () {
            pages.forEach(function (x) { x.style.display = x === pg ? 'block' : 'none'; });
            return window.html2canvas(pg, opt).then(function (c) {
              pdf.addPage();
              pdf.setFillColor(0, 171, 137); pdf.rect(0, 10, 7, 297 - 22, 'F');
              pdf.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', 16, 10, 182, c.height / c.width * 182);
              pdf.setFontSize(7); pdf.setTextColor(100, 116, 139);
              pdf.text((i + 2) + ' / ' + (pages.length + 1), 198, 291, { align: 'right' });
            });
          });
        }, Promise.resolve());
      }).then(function () { return { nom: nom, b64: pdf.output('datauristring').split(',')[1] }; });
    }).finally(function () { if (zone) zone.remove(); });
  }
  /** Répartit le contenu du rapport en pages A4 (blocs entiers ; tableaux et listes coupés entre deux lignes,
   *  en-tête de tableau répété ; un titre reste avec ce qui le suit ; « brk » = nouvelle page). */
  function paginer(body, zone, H) {
    var pages = [], cur;
    function nouvelle() {
      cur = document.createElement('div'); cur.className = 'rp';
      cur.style.cssText = 'width:182mm;background:#fff;display:flow-root';
      zone.appendChild(cur); pages.push(cur);
    }
    function trop() { return cur.offsetHeight > H; }
    function estTitre(el) { return el && /^H[123]$/.test(el.tagName); }
    function vide() { return !cur.children.length; }
    nouvelle();
    var file = [].slice.call(body.children);
    while (file.length) {
      var el = file.shift();
      if (el.classList && el.classList.contains('brk') && !vide()) nouvelle();
      if (vide() && /^H[12]$/.test(el.tagName)) el.style.marginTop = '0';
      cur.appendChild(el);
      if (!trop()) continue;
      // découpable : tableau (hors tuiles) ou liste
      var lignes = el.tagName === 'TABLE' && !el.classList.contains('kt') ? [].slice.call(el.rows)
        : el.tagName === 'UL' ? [].slice.call(el.children) : null;
      if (lignes && lignes.length > 1) {
        var tete = el.tagName === 'TABLE' && lignes[0].querySelector('th') ? lignes[0] : null;
        var corps = lignes.filter(function (r) { return r !== tete; });
        var conteneur = el.tagName === 'TABLE' ? (el.tBodies[0] || el) : el;
        corps.forEach(function (r) { r.remove(); });
        var mis = 0;
        while (mis < corps.length) { conteneur.appendChild(corps[mis]); if (trop()) { corps[mis].remove(); break; } mis++; }
        if (mis < 2 && corps.length > 2) { // trop peu de place : tout sur la page suivante
          corps.slice(0, mis).forEach(function (r) { r.remove(); }); mis = 0;
        }
        if (mis >= corps.length) continue;
        var suite = el.cloneNode(false);
        if (el.tagName === 'TABLE') { var tb = document.createElement('tbody'); suite.appendChild(tb); if (tete) tb.appendChild(tete.cloneNode(true)); corps.slice(mis).forEach(function (r) { tb.appendChild(r); }); }
        else corps.slice(mis).forEach(function (r) { suite.appendChild(r); });
        if (!mis) { el.remove(); var avant = cur, t0 = cur.lastElementChild; nouvelle(); if (estTitre(t0) && avant.children.length > 1) { avant.removeChild(t0); t0.style.marginTop = '0'; cur.appendChild(t0); } }
        else nouvelle();
        file.unshift(suite);
        continue;
      }
      // bloc entier sur la page suivante (avec son titre)
      if (cur.children.length > 1) {
        el.remove();
        var prec = cur.lastElementChild, avec = [];
        if (estTitre(prec) && cur.children.length > 1) { prec.remove(); avec.push(prec); }
        nouvelle();
        avec.forEach(function (x) { x.style.marginTop = '0'; cur.appendChild(x); });
        file.unshift(el);
      }
      // sinon : bloc plus haut qu'une page, laissé tel quel (rare)
    }
    pages = pages.filter(function (p) { return p.children.length; });
    pages.forEach(function (p) { var f = p.firstElementChild; if (f) f.style.marginTop = '0'; });
    return pages;
  }

  /* ================= export CSV ================= */
  function exportCsv() {
    return FB.prets().then(function () {
      var b = M.getBootstrap(FB.D);
      var head = ['Début', 'Fin', 'Jours', 'Salon', 'Confort', 'Surface louée (m2)', 'Elec halls (MWh)', 'CVC (MWh)', 'FM (MWh)', 'ECL (MWh)',
        'autres (MWh)', 'Elec parc (MWh)', 'Prod PV parking (MWh)', 'Prod PV hall 4.3 (MWh)', 'Prod PV site (MWh)', 'Gaz (MWh)', 'Elec+Gaz (MWh)', 'DJU retenus', 'DJU / jour', 'DJF / jour',
        'kWh/m2/jour (global)', 'kWh/m2/DJU (CVC+gaz)', 'Prévision (MWh)', 'Écart / prévision', 'Hors talon (MWh)', '% hors talon',
        'T moy halls (°C)', 'T min (°C)', 'T max (°C)', '% relevés dans la plage confort', 'Nb relevés température'];
      var f = function (v) { return typeof v === 'number' ? String(Math.round(v * 1000) / 1000).replace('.', ',') : (v === undefined || v === null ? '' : String(v)); };
      var rows = b.salons.map(function (s) {
        var o = s.ind, t = o.temp || {};
        return [s.debut, s.fin, o.jours, s.salon, s.confort, o.surfaceLouee, o.elec, o.cvc, o.fm, o.ecl, o.autres, s.elecParc, s.pv, o.pvHall, o.pvSite, s.gaz,
          o.elecGaz, o.djuRetenus, o.djuJour, o.djfJour, o.kwhM2Jour, o.kwhM2DJU, o.prevision, o.ecart, o.horsTalon, o.pctHorsTalon,
          t.moy, t.min, t.max, t.pctConfort, t.nRel].map(f);
      });
      return [head].concat(rows).map(function (r) { return r.map(function (x) { return /[;"\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(';'); }).join('\n');
    });
  }

  /* ================= charte : import et état ================= */
  function reduire(dataUrl, maxW, mime, q) {
    return new Promise(function (ok, ko) {
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, maxW / im.naturalWidth), c = document.createElement('canvas');
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
        var g = c.getContext('2d'); if (mime === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL(mime, q));
      };
      im.onerror = function () { ko(new Error('Image illisible.')); };
      im.src = dataUrl;
    });
  }
  function b64Url(b64, mime) { return 'data:' + mime + ';base64,' + b64; }
  function importerCharte(nom, b64, role) {
    var ext = String(nom).toLowerCase().split('.').pop(), res = {};
    var suite;
    if (ext === 'pptx') {
      suite = lib('zip').then(function () { return window.JSZip.loadAsync(b64, { base64: true }); }).then(function (z) {
        var media = Object.keys(z.files).filter(function (n) { return /^ppt\/media\/.+\.(png|jpe?g)$/i.test(n); });
        if (!media.length) throw new Error('Aucune image trouvée dans la présentation.');
        var jpg = media.filter(function (n) { return /\.jpe?g$/i.test(n); }).sort(function (a, b) { return (z.files[b]._data.uncompressedSize || 0) - (z.files[a]._data.uncompressedSize || 0); })[0];
        var pngs = media.filter(function (n) { return /\.png$/i.test(n); });
        var logo = pngs.filter(function (n) { return /\/image1\.png$/i.test(n); })[0] || pngs[0];
        return Promise.all([jpg ? z.file(jpg).async('base64') : null, logo ? z.file(logo).async('base64') : null]);
      }).then(function (r) {
        return Promise.all([r[0] ? reduire(b64Url(r[0], 'image/jpeg'), 1400, 'image/jpeg', 0.85) : null, r[1] ? reduire(b64Url(r[1], 'image/png'), 700, 'image/png') : null]);
      }).then(function (r) { if (r[0]) res.photo = r[0]; if (r[1]) res.logo = r[1]; });
    } else if (/^(png|jpe?g)$/.test(ext)) {
      var r = role === 'logo' ? 'logo' : 'photo', mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      suite = reduire(b64Url(b64, mime), r === 'logo' ? 700 : 1400, r === 'logo' ? 'image/png' : 'image/jpeg', 0.85).then(function (u) { res[r] = u; });
    } else return Promise.reject(new Error('Format non pris en charge : .pptx, .png ou .jpg.'));
    return suite.then(lireCharte).then(function (cur) {
      var d = { photo: res.photo || cur.photo || '', logo: res.logo || cur.logo || '', source: nom + ' · ' + paris() };
      if ((d.photo.length + d.logo.length) > 950000) throw new Error('Images trop lourdes pour Firebase (1 Mo maximum).');
      return FB.ecrireDoc('ConsoServeur', 'charte', d).then(function () { CHARTE = d; return etatCharte(); }, function (e) {
        if (e && /refus|permission/i.test(e.message || '')) throw new Error('Firebase refuse l\'enregistrement de la charte : ajoute « charte » aux règles ConsoServeur (voir firestore-conso.rules).');
        throw e;
      });
    });
  }
  function etatCharte() {
    return lireCharte().then(function (c) { return { photo: !!c.photo, logo: !!c.logo, source: c.source || (c.photo || c.logo ? '' : 'pas encore importée dans Firebase : logo de l\'appli utilisé') }; });
  }

  /* ================= branchement sur l'interface ================= */
  window.CONSO_EXT = {
    exportResumeCsv: exportCsv,
    rapportSalonPdf: function (id, mode) { return mode === 'drive' ? FB.script('rapportSalonPdf', [id, mode]) : rapportSalon(id); },
    pvRapportPdf: function (mois, mode) { return mode === 'drive' ? FB.script('pvRapportPdf', [mois, mode]) : rapportPV(mois); },
    pvRapportPdfPer: function (R) { return rapportPVPer(R); },
    chEtatCharte: etatCharte,
    // mise à jour météo du matin : faite par Firebase (Cloud Scheduler 8 h 17 → conso-quotidien), plus par un déclencheur du script
    installerMajMeteoQuotidienne: function () { return 'Mise à jour météo quotidienne déjà assurée par Firebase (chaque matin vers 8 h 17).'; },
    etatMajQuotidienne: function () { return true; },
    chImporterCharte: importerCharte
  };
  window.CONSO_RAPPORTS = { rapportSalon: rapportSalon, rapportPV: rapportPV, exportCsv: exportCsv, planSvg: planSvg_ };
})();
