/**
 * Consommations Halls – passage à Firebase
 * Fichier à AJOUTER au projet Apps Script de l'appli (nom : Firebase), en DERNIER dans la liste des fichiers.
 * Il ne modifie ni Code.gs, ni Index.html, ni Api.gs.
 *
 * Avant tout : dans Paramètres du projet › Propriétés du script, ajouter CONSO_CODE = le code des réglages
 * (le même que le champ « code » du document ConsoSecret/code dans Firestore).
 *
 *  1. copierVersFirebase() : copie le classeur dans Firebase (paramètres, surfaces, lignes de comptage,
 *     correspondance des températures, salons, index) et publie la météo, les DJU, Conso_Site et le PV.
 *     Peut être relancée tant que la bascule n'est pas faite (elle remplace ce qui est dans Firebase).
 *  2. installerFirebase() : LA BASCULE. À partir de là, Firebase est la référence : toutes les 10 minutes
 *     (et avant chaque rapport PDF ou export), le classeur est recopié depuis Firebase, puis la météo,
 *     Conso_Site et le PV sont republiés dans Firebase. Ce qui serait saisi dans l'ancienne version est écrasé.
 *  3. desinstallerFirebase() : arrête la copie automatique (retour en arrière possible : le classeur redevient la référence).
 *
 * Les clés (Météo-France…) restent dans les propriétés du script et dans l'onglet Parametres : jamais dans Firebase.
 */

var CFB_PROJECT = 'equipe-batiment';
var CFB_KEY = 'AIzaSyARtP0RMkulG6c53-bnazwpGTspl0LgAhk'; // clé publique Firebase (pas un secret)
var CFB_DOCS = 'projects/' + CFB_PROJECT + '/databases/(default)/documents';
var CFB_URL = 'https://firestore.googleapis.com/v1/' + CFB_DOCS;
/** Paramètres gérés dans l'appli (Firebase). MeteoCle et MeteoMaj restent gérés par le script. */
var CFB_PARAMS = ['Annee', 'Talon', 'BaseDJU', 'SeuilDJF', 'CoeffPrev', 'DJUmini', 'DJUnegatifs', 'MeteoStation', 'ConfortMin', 'ConfortMax', 'TempSheetId'];
var CFB_LIGNES = ['id', 'ordre', 'tgbt', 'ligne', 'nb', 'coefs', 'total', 'usage', 'actif'];

/* ======================= Mise en route ======================= */

function copierVersFirebase() {
  var tok = cfbToken_();
  var W = [];
  // paramètres
  var p = {};
  rows_(SH.PARAMS).forEach(function (r) { var k = String(r[0]).trim(); if (CFB_PARAMS.indexOf(k) >= 0) p[k] = cfbCell_(r[1]); });
  W.push(cfbSet_('ConsoConfig/params', { p: p }));
  // surfaces des halls
  W.push(cfbSet_('ConsoConfig/halls', { liste: readHalls_() }));
  // lignes de comptage (toutes, y compris « Actif : NON »)
  var lignes = rows_(SH.LIGNES).filter(function (r) { return String(r[0]).trim(); }).map(function (r) {
    var o = {}; CFB_LIGNES.forEach(function (k, i) { o[k] = cfbCell_(r[i]); }); o.id = String(o.id); return o;
  });
  W.push(cfbSet_('ConsoConfig/lignes', { liste: lignes }));
  // correspondance halls ↔ températures
  var corr = {}, sc = ss_().getSheetByName(SH.CORR);
  if (sc) sc.getDataRange().getValues().slice(1).forEach(function (r) {
    var h = String(r[0]).trim(); if (h) corr[h] = String(r[1] || '').split(';').map(function (x) { return x.trim(); }).filter(String);
  });
  W.push(cfbSet_('ConsoConfig/corr', { map: corr }));
  // salons
  var salons = readSalons_();
  var deja = cfbIds_(tok, 'ConsoSalons');
  salons.forEach(function (s) {
    var o = {}; SALON_KEYS.forEach(function (k) { o[k] = cfbCell_(s[k]); }); o.id = String(s.id);
    W.push(cfbSet_('ConsoSalons/' + s.id, o)); delete deja[s.id];
  });
  Object.keys(deja).forEach(function (id) { W.push({ 'delete': CFB_DOCS + '/ConsoSalons/' + id }); });
  // index
  var parSalon = {};
  readReleves_().forEach(function (r) {
    var l = (parSalon[r.salon] = parSalon[r.salon] || {});
    l[r.ligne] = { av: r.av.map(cfbNul_), ap: r.ap.map(cfbNul_), maj: r.maj };
  });
  var dejaR = cfbIds_(tok, 'ConsoReleves');
  Object.keys(parSalon).forEach(function (sid) { W.push(cfbSet_('ConsoReleves/' + sid, { l: parSalon[sid] })); delete dejaR[sid]; });
  Object.keys(dejaR).forEach(function (id) { W.push({ 'delete': CFB_DOCS + '/ConsoReleves/' + id }); });
  cfbCommit_(tok, W);
  cfbPublier_(tok);
  console.log('Copié dans Firebase : ' + Object.keys(p).length + ' paramètres, ' + readHalls_().length + ' halls, ' + lignes.length + ' lignes de comptage, '
    + salons.length + ' salons, index de ' + Object.keys(parSalon).length + ' salons, plus météo / DJU / Conso_Site / PV.');
}

/** LA BASCULE : Firebase devient la référence, le classeur en est la copie. */
function installerFirebase() {
  PropertiesService.getScriptProperties().setProperty('CONSO_FB_ACTIF', '1');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'majFirebase') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('majFirebase').timeBased().everyMinutes(10).create();
  majFirebase();
  console.log('Bascule faite : classeur recopié depuis Firebase toutes les 10 minutes, météo / Conso_Site / PV republiés.');
}

function desinstallerFirebase() {
  PropertiesService.getScriptProperties().deleteProperty('CONSO_FB_ACTIF');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'majFirebase') ScriptApp.deleteTrigger(t); });
  console.log('Copie automatique arrêtée : le classeur redevient la référence.');
}

/** Lancée toutes les 10 minutes après la bascule */
function majFirebase() {
  var tok = cfbToken_();
  if (cfbActif_()) cfbTirer_(tok);
  try { majElecGazParc_(); } catch (e) { console.warn('majElecGazParc_ : ' + e); }
  cfbPublier_(tok);
}

/** Appelée par l'appli (Réglages) : enregistre la clé Météo-France dans le classeur, jamais dans Firebase. */
function fbCleMeteo(cle, code) {
  var ref = PropertiesService.getScriptProperties().getProperty('CONSO_CODE');
  if (!ref || String(code || '') !== ref) throw new Error('Code des réglages incorrect : clé non enregistrée.');
  cle = String(cle || '').trim();
  if (!cle) throw new Error('Clé vide.');
  withLock_(function () { writeParams_({ MeteoCle: cle }); });
  try { cfbPublier_(cfbToken_()); } catch (e) { console.warn(e); }
  return true;
}

/** Appelée par l'appli : republie tout de suite la météo / Conso_Site / PV (après une action du script). */
function fbPublier() { cfbPublier_(cfbToken_()); return true; }

/* ======================= Firebase → classeur ======================= */

function cfbActif_() { return PropertiesService.getScriptProperties().getProperty('CONSO_FB_ACTIF') === '1'; }

function cfbTirer_(tok) {
  var cfg = {};
  ['params', 'halls', 'lignes', 'corr'].forEach(function (id) { cfg[id] = cfbGet_(tok, 'ConsoConfig/' + id) || {}; });
  var salons = cfbListe_(tok, 'ConsoSalons'), releves = cfbListe_(tok, 'ConsoReleves');
  if (!salons.length && !cfg.lignes.liste) throw new Error('Firebase vide : lancer d\'abord copierVersFirebase.');
  withLock_(function () {
    // paramètres
    var p = cfg.params.p || {}, maj = {};
    CFB_PARAMS.forEach(function (k) { if (k in p) maj[k] = p[k] === null ? '' : p[k]; });
    writeParams_(maj);
    // halls
    if (Array.isArray(cfg.halls.liste)) {
      cfbRemplir_(SH.HALLS, cfg.halls.liste.filter(function (h) { return h && h.hall; }).map(function (h) { return [h.hall, n0_(h.surface)]; }), 2);
    }
    // lignes de comptage
    if (Array.isArray(cfg.lignes.liste)) {
      cfbRemplir_(SH.LIGNES, cfg.lignes.liste.map(function (L) { return CFB_LIGNES.map(function (k) { return L[k] === undefined || L[k] === null ? '' : L[k]; }); }), CFB_LIGNES.length);
    }
    // correspondance
    if (cfg.corr.map) {
      var sc = ss_().getSheetByName(SH.CORR) || ss_().insertSheet(SH.CORR);
      var m = cfg.corr.map;
      sc.clearContents();
      var rows = [['Hall', 'Colonnes du classeur températures (séparées par ;)']].concat(Object.keys(m).map(function (h) { return [h, (m[h] || []).join(' ; ')]; }));
      sc.getRange(1, 1, rows.length, 2).setValues(rows);
    }
    // salons
    cfbRemplir_(SH.SALONS, salons.sort(function (a, b) { return String(a.id) < String(b.id) ? -1 : 1; })
      .map(function (s) { return SALON_KEYS.map(function (k) { return s[k] === undefined || s[k] === null ? '' : s[k]; }); }), SALON_KEYS.length);
    // index
    var rr = [];
    releves.forEach(function (d) {
      var l = d.l || {};
      Object.keys(l).forEach(function (lid) {
        var x = l[lid] || {}, av = x.av || [], ap = x.ap || [], row = [d.__id, lid];
        for (var i = 0; i < 5; i++) row.push(av[i] === null || av[i] === undefined ? '' : av[i]);
        for (var j = 0; j < 5; j++) row.push(ap[j] === null || ap[j] === undefined ? '' : ap[j]);
        row.push(x.maj || '');
        if (row.slice(2, 12).some(function (v) { return v !== ''; })) rr.push(row);
      });
    });
    cfbRemplir_(SH.RELEVES, rr, RELEVE_COLS.length);
  });
  SITE_ROWS_ = null;
  try { invaliderCacheAccueil_(); } catch (e) {}
}

/** Remplace les lignes 2… d'un onglet (colonnes 1 à nbCol), en gardant la ligne d'en-tête et les autres colonnes */
function cfbRemplir_(name, rows, nbCol) {
  var sh = sheet_(name), last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, nbCol).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, nbCol).setValues(rows);
}

/* ======================= classeur → Firebase (données gérées par le script) ======================= */

function cfbPublier_(tok) {
  var P = readParams_();
  var hist = rows_(SH.HIST).map(function (r) { return { annee: n0_(r[0]), mois: n0_(r[1]), dju: n0_(r[2]) }; });
  SITE_ROWS_ = null;
  var siteOk = !!ss_().getSheetByName('Conso_Site');
  var site = readSite_();
  var parking = {};
  if (ss_().getSheetByName('PV_Parking')) rows_('PV_Parking').forEach(function (r) {
    var d = iso_(r[0]), v = num_(r[1]); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v !== '') parking[d] = v;
  });
  var h43 = {};
  try { pvVals_(PV_SH.H43).forEach(function (r) { var d = pvJour_(r[0]), v = pvNum_(r[1]); if (d && v !== null) h43[d] = v; }); } catch (e) {}
  var data = {
    meteo: readMeteo_(), hist: hist, site: site, siteOk: siteOk, parking: parking, h43: h43,
    meteoMaj: P.meteoMaj, meteoCleOk: !!P.meteoCle, sheetUrl: ss_().getUrl(), maj: nowStr_()
  };
  cfbCommit_(tok, [cfbSet_('ConsoServeur/donnees', { json: JSON.stringify(data) }), cfbSet_('ConsoServeur/logo', { data: logoDataUri_() })]);
}

/* ======================= Liens avec les fonctions existantes ======================= */
(function () {
  // fonctions appelables par l'appli Firebase
  if (typeof PWA_ECRITURE !== 'undefined') ['fbCleMeteo', 'fbPublier'].forEach(function (n) { if (PWA_ECRITURE.indexOf(n) < 0) PWA_ECRITURE.push(n); });
  // avant un rapport / un export : classeur remis à jour depuis Firebase (après la bascule)
  ['rapportSalonPdf', 'exportResumeCsv'].forEach(function (n) {
    var f = globalThis[n]; if (typeof f !== 'function' || f.__cfbAvant) return;
    var w = function () { if (cfbActif_()) { try { cfbTirer_(cfbToken_()); } catch (e) { console.warn('Firebase → classeur : ' + e); } } return f.apply(this, arguments); };
    w.__cfbAvant = true; globalThis[n] = w;
  });
  // après une action du script sur la météo ou le PV : republié dans Firebase
  ['majMeteo', 'saveMeteoJour', 'pvEnregistrer', 'pvSupprimerIndispo'].forEach(function (n) {
    var f = globalThis[n]; if (typeof f !== 'function' || f.__cfbApres) return;
    var w = function () {
      var r = f.apply(this, arguments);
      try { var tok = cfbToken_(); if (n === 'pvEnregistrer' || n === 'pvSupprimerIndispo') { if (cfbActif_()) cfbTirer_(tok); majElecGazParc_(); } cfbPublier_(tok); }
      catch (e) { console.warn('Publication Firebase : ' + e); }
      return r;
    };
    w.__cfbApres = true; globalThis[n] = w;
  });
})();

/* ======================= REST Firestore ======================= */

/** Connexion anonyme + session avec le code des réglages (propriété CONSO_CODE) */
function cfbToken_() {
  var props = PropertiesService.getScriptProperties();
  var code = props.getProperty('CONSO_CODE');
  if (!code) throw new Error('Propriété du script CONSO_CODE absente (Paramètres du projet › Propriétés du script).');
  var refresh = props.getProperty('CONSO_FB_REFRESH'), tok = null;
  if (refresh) {
    var r = UrlFetchApp.fetch('https://securetoken.googleapis.com/v1/token?key=' + CFB_KEY,
      { method: 'post', payload: { grant_type: 'refresh_token', refresh_token: refresh }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) { var j = JSON.parse(r.getContentText()); tok = { id: j.id_token, uid: j.user_id }; props.setProperty('CONSO_FB_REFRESH', j.refresh_token); }
  }
  if (!tok) {
    var s = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CFB_KEY,
      { method: 'post', contentType: 'application/json', payload: JSON.stringify({ returnSecureToken: true }), muteHttpExceptions: true });
    if (s.getResponseCode() !== 200) throw new Error('Connexion à Firebase refusée : ' + s.getContentText());
    var k = JSON.parse(s.getContentText()); tok = { id: k.idToken, uid: k.localId }; props.setProperty('CONSO_FB_REFRESH', k.refreshToken);
  }
  try { cfbFetch_('patch', CFB_URL + '/ConsoSessions/' + tok.uid, tok.id, { fields: cfbFields_({ code: code, at: new Date().toISOString() }) }); }
  catch (e) { throw new Error('Code refusé par Firebase : CONSO_CODE doit être identique au champ code de ConsoSecret/code (' + e.message + ')'); }
  return tok.id;
}

function cfbSet_(path, obj) { return { update: { name: CFB_DOCS + '/' + path, fields: cfbFields_(obj) } }; }
function cfbCommit_(tok, writes) { for (var i = 0; i < writes.length; i += 400) cfbFetch_('post', CFB_URL + ':commit', tok, { writes: writes.slice(i, i + 400) }); }
function cfbGet_(tok, path) {
  var r = UrlFetchApp.fetch(CFB_URL + '/' + path, { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Firebase ' + r.getResponseCode() + ' : lecture de ' + path);
  return cfbObj_(JSON.parse(r.getContentText()).fields || {});
}
function cfbListe_(tok, coll) {
  var out = [], page = '';
  do {
    var r = UrlFetchApp.fetch(CFB_URL + '/' + coll + '?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''),
      { headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Firebase ' + r.getResponseCode() + ' : lecture de ' + coll);
    var j = JSON.parse(r.getContentText() || '{}');
    (j.documents || []).forEach(function (d) { var o = cfbObj_(d.fields || {}); o.__id = d.name.split('/').pop(); out.push(o); });
    page = j.nextPageToken || '';
  } while (page);
  return out;
}
function cfbIds_(tok, coll) { var o = {}; cfbListe_(tok, coll).forEach(function (d) { o[d.__id] = true; }); return o; }
function cfbFetch_(method, url, tok, body) {
  var r = UrlFetchApp.fetch(url, { method: method, contentType: 'application/json', payload: JSON.stringify(body),
    headers: { Authorization: 'Bearer ' + tok }, muteHttpExceptions: true });
  var c = r.getResponseCode();
  if (c < 200 || c >= 300) { var m = r.getContentText(); try { m = JSON.parse(m).error.message; } catch (e) {} throw new Error('Firebase ' + c + ' : ' + m); }
  return JSON.parse(r.getContentText() || 'null');
}
/** Valeur de cellule → valeur Firebase (dates en aaaa-mm-jj) */
function cfbCell_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return iso_(v);
  return v === undefined ? '' : v;
}
function cfbNul_(v) { return v === '' ? null : v; }
function cfbFields_(obj) { var f = {}; Object.keys(obj).forEach(function (k) { f[k] = cfbVal_(obj[k]); }); return f; }
function cfbVal_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return isFinite(v) ? { doubleValue: v } : { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(cfbVal_) } };
  if (Object.prototype.toString.call(v) === '[object Date]') return { stringValue: iso_(v) };
  if (typeof v === 'object') return { mapValue: { fields: cfbFields_(v) } };
  return { stringValue: String(v) };
}
function cfbObj_(fields) { var o = {}; Object.keys(fields || {}).forEach(function (k) { o[k] = cfbDec_(fields[k]); }); return o; }
function cfbDec_(v) {
  if (!v || 'nullValue' in v) return null;
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('integerValue' in v) return Number(v.integerValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return cfbObj_(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(cfbDec_);
  return null;
}
