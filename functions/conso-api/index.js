/* Fonctions Firebase de l'appli Consommations halls (Eurexpo), à la place des scripts Google :
 *  - conso-api (HTTP) : appelée par l'appli
 *      { action: 'meteo' }                          → récupère chez Météo-France (DPClim) les jours manquants de l'année
 *      { action: 'fusionsolar', type, date }        → production PV du hall 4.3 (FusionSolar) : type = jour | mois | temps_reel | stations
 *    Accès : appareil qui a donné le code des réglages (jeton Firebase + ConsoSessions, comme les règles Firestore) ;
 *    jeton App Check vérifié s'il est présent (obligatoire quand REQUIRE_APP_CHECK=1).
 *  - conso-quotidien (Pub/Sub, lancé chaque matin par Cloud Scheduler) : mise à jour météo.
 * Météo écrite dans Firestore : ConsoMeteo/{année} (champ j : { 'aaaa-mm-jj': { tx, tn, src } }) et ConsoMeteo/etat.
 * Clés dans Secret Manager : meteo-cle, fusionsolar-user, fusionsolar-code (jamais dans le code ni dans Firebase).
 */
const functions = require('@google-cloud/functions-framework');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

const ORIGINES = ['https://eurexpobatiment.github.io'];
const DPCLIM = 'https://public-api.meteofrance.fr/public/DPClim/v1';
const FS_DOMAIN = (process.env.FS_DOMAIN || 'eu5.fusionsolar.huawei.com').replace(/^https?:\/\//, '').split('/')[0];
const FS_STATION = process.env.FS_STATION || 'NE=370904290'; // centrale du hall 4.3

const attendre = ms => new Promise(r => setTimeout(r, ms));
const pad = n => ('0' + n).slice(-2);
function auj() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' }).format(new Date()); }
function maintenant() {
  const p = {}; new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).forEach(x => { p[x.type] = x.value; });
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute;
}
const jourNum = d => { const p = d.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); };
const jourIso = n => { const d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
const nombre = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };

/* ================= Météo-France ================= */
async function meteoConnue(annee) {
  const m = {};
  // ce que publiait le script (classeur) puis ce qui est déjà dans ConsoMeteo
  try { const s = await db.doc('ConsoServeur/donnees').get(); if (s.exists) Object.assign(m, (JSON.parse(s.data().json || '{}').meteo) || {}); } catch (e) { console.warn(e); }
  const s2 = await db.doc('ConsoMeteo/' + annee).get();
  if (s2.exists) Object.assign(m, s2.data().j || {});
  return m;
}
async function majMeteo() {
  const cle = (process.env.METEO_CLE || '').trim();
  if (!cle) throw new Error('Clé API Météo-France absente (secret meteo-cle).');
  const ps = await db.doc('ConsoConfig/params').get(), p = (ps.exists && ps.data().p) || {};
  const annee = Number(p.Annee) || +auj().slice(0, 4), station = String(p.MeteoStation || '69029001');
  const meteo = await meteoConnue(annee);
  const hier = jourNum(auj()) - 1, d0 = jourNum(annee + '-01-01'), d1 = Math.min(hier, jourNum(annee + '-12-31'));
  let premier = -1;
  for (let d = d0; d <= d1; d++) { const x = meteo[jourIso(d)]; if (!x || nombre(x.tx) === null || nombre(x.tn) === null) { premier = d; break; } }
  const etat = db.doc('ConsoMeteo/etat');
  if (premier < 0) { await etat.set({ maj: maintenant(), message: 'Météo déjà à jour.' }); return { ajoutes: 0, message: 'Météo déjà à jour.' }; }
  const deb = Math.max(d0, premier - 3); // on reprend 3 jours avant (données consolidées parfois corrigées)
  const jours = await dpclim(cle, station, jourIso(deb), jourIso(d1));
  const j = {};
  jours.forEach(x => { if (x.tx !== null && x.tn !== null && x.date.slice(0, 4) === String(annee)) j[x.date] = { tx: x.tx, tn: x.tn, src: 'Météo-France' }; });
  if (Object.keys(j).length) await db.doc('ConsoMeteo/' + annee).set({ j }, { merge: true });
  const message = Object.keys(j).length + ' jour(s) récupéré(s) de Météo-France (' + jourIso(deb) + ' → ' + jourIso(d1) + ').';
  await etat.set({ maj: maintenant(), message });
  return { ajoutes: Object.keys(j).length, message };
}
async function dpclim(cle, station, d1, d2) {
  const h = { apikey: cle, accept: '*/*' };
  const r = await fetch(DPCLIM + '/commande-station/quotidienne?id-station=' + encodeURIComponent(station) +
    '&date-deb-periode=' + d1 + 'T00:00:00Z&date-fin-periode=' + d2 + 'T23:59:59Z', { headers: h });
  const body = await r.text();
  if (r.status === 401 || r.status === 403) throw new Error('Clé API Météo-France refusée ou expirée (' + r.status + '). Régénère une API Key sur portail-api.meteofrance.fr.');
  if (r.status === 404) throw new Error('Station introuvable (404). Vérifie le n° de station dans Réglages.');
  if (r.status >= 300) throw new Error('Météo-France : erreur ' + r.status + ' — ' + body.slice(0, 200));
  let id; try { id = JSON.parse(body).elaboreProduitAvecDemandeResponse['return']; } catch (e) { id = (body.match(/\d{6,}/) || [])[0]; }
  if (!id) throw new Error('Météo-France : commande non reconnue (' + body.slice(0, 120) + ')');
  for (let k = 0; k < 15; k++) {
    await attendre(k === 0 ? 1500 : 3000);
    const f = await fetch(DPCLIM + '/commande/fichier?id-cmde=' + id, { headers: h });
    if (f.status === 200 || f.status === 201) return lireCsv(Buffer.from(await f.arrayBuffer()).toString('utf8'));
    if (f.status !== 204 && f.status !== 202) throw new Error('Météo-France (fichier) : erreur ' + f.status + ' — ' + (await f.text()).slice(0, 200));
  }
  throw new Error('Météo-France n\'a pas fourni le fichier à temps, réessaie plus tard.');
}
function lireCsv(txt) {
  const l = txt.split(/\r?\n/).filter(x => x.trim());
  if (!l.length) return [];
  const h = l[0].split(';').map(x => x.trim().toUpperCase()), iD = h.indexOf('DATE'), iX = h.indexOf('TX'), iN = h.indexOf('TN');
  if (iD < 0 || iX < 0 || iN < 0) throw new Error('Colonnes DATE / TX / TN introuvables dans le fichier Météo-France.');
  return l.slice(1).map(x => { const c = x.split(';'), d = String(c[iD]).trim(); return { date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8), tx: nombre(c[iX]), tn: nombre(c[iN]) }; });
}

/* ================= FusionSolar (Huawei SmartPVMS, API Northbound) ================= */
let fsJeton = null, fsFin = 0;
async function fsLogin(forcer) {
  if (!forcer && fsJeton && Date.now() < fsFin) return fsJeton;
  const u = (process.env.FS_USER || '').trim(), c = (process.env.FS_CODE || '').trim();
  if (!u || !c) throw new Error('Identifiants FusionSolar absents (secrets fusionsolar-user / fusionsolar-code).');
  const r = await fetch('https://' + FS_DOMAIN + '/thirdData/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName: u, systemCode: c }) });
  const b = await r.json().catch(() => ({}));
  if (!b.success) throw new Error('Login FusionSolar refusé (failCode ' + b.failCode + ' ' + (b.message || '') + ')');
  let t = r.headers.get('xsrf-token');
  if (!t) { const m = (r.headers.get('set-cookie') || '').match(/XSRF-TOKEN=([^;]+)/); t = m && m[1]; }
  if (!t) throw new Error('XSRF-TOKEN absent de la réponse de login');
  fsJeton = t; fsFin = Date.now() + 25 * 60000; // jeton valable 30 min, login limité à 5 / 10 min
  return t;
}
async function fsCall(chemin, payload, retente) {
  const r = await fetch('https://' + FS_DOMAIN + '/thirdData/' + chemin, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'XSRF-TOKEN': await fsLogin(false) }, body: JSON.stringify(payload || {}) });
  const b = await r.json().catch(() => ({}));
  if (b.failCode === 305 && !retente) { await fsLogin(true); return fsCall(chemin, payload, true); }
  if (!b.success) throw new Error(chemin + ' : failCode ' + b.failCode + ' ' + (b.failCode === 407 ? 'trop d\'appels, réessayer dans quelques minutes' : (b.message || '')));
  return b.data;
}
const num = v => v == null || v === '' ? null : Number(v);
async function fusionsolar(type, date, station) {
  station = station || FS_STATION;
  if (type === 'stations') return ((await fsCall('stations', { pageNo: 1 })).list || []).map(s => ({ code: s.plantCode, nom: s.plantName, kWc: s.capacity, adresse: s.plantAddress }));
  if (type === 'temps_reel') {
    const d = await fsCall('getStationRealKpi', { stationCodes: station }), m = (d && d[0] && d[0].dataItemMap) || {};
    return { jour_kWh: num(m.day_power), mois_kWh: num(m.month_power), total_kWh: num(m.total_power), etat: m.real_health_state };
  }
  const api = type === 'mois' ? 'getKpiStationMonth' : 'getKpiStationDay';
  const t = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T12:00:00+01:00') : Date.now();
  const d = await fsCall(api, { stationCodes: station, collectTime: t });
  const jour = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' });
  return (d || []).map(r => {
    const m = r.dataItemMap || {};
    return { date: jour.format(new Date(r.collectTime)), production_kWh: num(m.inverter_power != null ? m.inverter_power : m.PVYield),
      injection_kWh: num(m.ongrid_power), autoconso_kWh: num(m.selfUsePower != null ? m.selfUsePower : m.self_use_power) };
  }).sort((a, b) => a.date < b.date ? -1 : 1);
}

/* ================= accès ================= */
async function verifier(req) {
  const m = String(req.get('Authorization') || '').match(/^Bearer (.+)$/);
  if (!m) { const e = new Error('Connexion Firebase absente.'); e.code = 401; throw e; }
  let uid;
  try { uid = (await admin.auth().verifyIdToken(m[1])).uid; } catch (e) { const x = new Error('Jeton Firebase invalide.'); x.code = 401; throw x; }
  const ac = req.get('X-Firebase-AppCheck');
  if (ac) { try { await admin.appCheck().verifyToken(ac); } catch (e) { const x = new Error('Jeton App Check refusé.'); x.code = 401; throw x; } }
  else if (process.env.REQUIRE_APP_CHECK === '1') { const x = new Error('Jeton App Check absent.'); x.code = 401; throw x; }
  const [s, c] = await Promise.all([db.doc('ConsoSessions/' + uid).get(), db.doc('ConsoSecret/code').get()]);
  if (!s.exists || !c.exists || s.data().code !== c.data().code) { const e = new Error('Code des réglages non validé sur cet appareil.'); e.code = 403; throw e; }
}

functions.http('api', async (req, res) => {
  const o = req.get('Origin');
  if (o && ORIGINES.includes(o)) { res.set('Access-Control-Allow-Origin', o); res.set('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST'); res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck'); res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, erreur: 'POST attendu.' });
  try {
    await verifier(req);
    const b = req.body || {};
    let data;
    if (b.action === 'meteo') data = await majMeteo();
    else if (b.action === 'fusionsolar') data = await fusionsolar(String(b.type || 'jour'), b.date, b.station);
    else return res.status(400).json({ ok: false, erreur: 'Action inconnue.' });
    res.json({ ok: true, data });
  } catch (e) {
    console.error(e);
    res.status(e.code === 401 || e.code === 403 ? e.code : 500).json({ ok: false, erreur: String(e.message || e) });
  }
});

// Chaque matin (Cloud Scheduler → Pub/Sub conso-quotidien)
functions.cloudEvent('quotidien', async () => {
  try { console.log((await majMeteo()).message); } catch (e) { console.error('Météo : ' + e.message); }
});
