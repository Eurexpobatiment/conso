/* Consommations Halls – version Firebase : remplace google.script.run.
 * - Paramètres, surfaces, lignes de comptage, correspondance, salons, index : dans Firebase (projet equipe-batiment),
 *   lus et écrits directement par l'appli (copie gardée sur l'appareil : consultation et saisie sans réseau).
 * - Calculs : metier.js (mêmes formules que le script Google).
 * - Météo Météo-France, DJU historiques, Conso_Site, PV, rapports PDF, charte : toujours faits par le script Google
 *   (les clés restent dans le script), qui publie ses résultats dans Firebase (ConsoServeur).
 * - Réglages : protégés par le code des réglages (demandé une fois par appareil).
 */
(function () {
  'use strict';
  var API_URL = 'https://script.google.com/macros/s/AKfycby2L49T5N9wyJn6kAJbGbBUhFu1EuMIw35mn-OFkBz1-ebMLq7XmT_xLIafBbJ4xelv/exec';
  var FIREBASE = {
    apiKey: 'AIzaSyARtP0RMkulG6c53-bnazwpGTspl0LgAhk', // clé publique (faite pour être dans la page)
    authDomain: 'equipe-batiment.firebaseapp.com',
    projectId: 'equipe-batiment',
    storageBucket: 'equipe-batiment.firebasestorage.app',
    messagingSenderId: '408022301135',
    appId: '1:408022301135:web:69dee0a5fb479154657aba'
  };
  var FBV = '10.14.1';
  var TEMP_URL = 'https://eurexpobatiment.github.io/temp/';
  /* Fonctions du script Google en lecture : réponse gardée sur l'appareil pour le hors-ligne */
  var LECTURE = ['getEauSynthese', 'exportResumeCsv', 'pvMois', 'chEtatCharte', 'etatMajQuotidienne'];

  var LS = window.localStorage;
  function lsGet(k) { try { return JSON.parse(LS.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function msg(t) { if (typeof window.toast === 'function') window.toast(t, 1); else console.warn(t); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function withTimeout(p, ms, m) { return Promise.race([p, wait(ms).then(function () { throw new Error(m); })]); }

  /* ================= Firebase ================= */
  var D = { params: {}, halls: [], lignes: [], corr: {}, salons: [], releves: {}, srv: {}, logo: '', temp: null };
  var A, F, auth, db;
  var recu = {}, attendus = ['config', 'salons', 'releves', 'srv', 'temp', 'logo'];
  var pret, pretOk, pretKo;
  pret = new Promise(function (ok, ko) { pretOk = ok; pretKo = ko; });
  function arrive(k) { recu[k] = true; if (attendus.every(function (x) { return recu[x]; })) pretOk(); }

  function fbErr(e) {
    var c = e && e.code || '';
    if (c === 'permission-denied') return 'Accès refusé par Firebase (règles « Consommations halls » publiées ? code des réglages ?)';
    if (c === 'unavailable' || c === 'auth/network-request-failed') return 'Pas de connexion au serveur.';
    if (c === 'auth/admin-restricted-operation' || c === 'auth/operation-not-allowed') return 'Connexion anonyme non activée dans Firebase.';
    return (e && e.message ? e.message : String(e || 'Erreur inconnue.')).replace(/^Error:\s*/, '');
  }

  var demarrage = Promise.all([
    import('https://www.gstatic.com/firebasejs/' + FBV + '/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/' + FBV + '/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/' + FBV + '/firebase-firestore.js')
  ]).then(function (m) {
    A = m[1]; F = m[2];
    var app = m[0].initializeApp(FIREBASE);
    auth = A.getAuth(app);
    try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
    catch (e) { db = F.getFirestore(app); }
    ecouter();
  }).catch(function (e) { pretKo(new Error('Chargement de Firebase impossible (' + fbErr(e) + ')')); });

  function ecouter() {
    var ko = function (e) { pretKo(new Error('Lecture Firebase impossible : ' + fbErr(e))); };
    F.onSnapshot(F.collection(db, 'ConsoConfig'), function (s) {
      s.docs.forEach(function (d) {
        var x = d.data();
        if (d.id === 'params') D.params = x.p || {};
        else if (d.id === 'halls') D.halls = x.liste || [];
        else if (d.id === 'lignes') D.lignes = x.liste || [];
        else if (d.id === 'corr') D.corr = x.map || {};
      });
      if (s.size || !s.metadata.fromCache) arrive('config');
    }, ko);
    F.onSnapshot(F.collection(db, 'ConsoSalons'), function (s) {
      D.salons = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
      if (s.size || !s.metadata.fromCache) arrive('salons');
    }, ko);
    F.onSnapshot(F.collection(db, 'ConsoReleves'), function (s) {
      var r = {}; s.docs.forEach(function (d) { r[d.id] = d.data().l || {}; }); D.releves = r;
      if (s.size || !s.metadata.fromCache) arrive('releves');
    }, ko);
    F.onSnapshot(F.doc(db, 'ConsoServeur', 'donnees'), function (s) {
      if (s.exists()) { try { D.srv = JSON.parse(s.data().json || '{}'); } catch (e) { D.srv = {}; } }
      if (s.exists() || !s.metadata.fromCache) arrive('srv');
    }, ko);
    F.onSnapshot(F.doc(db, 'ConsoServeur', 'logo'), function (s) { if (s.exists()) D.logo = s.data().data || ''; if (s.exists() || !s.metadata.fromCache) arrive('logo'); }, function () { arrive('logo'); });
    // Températures des halls : appli Dalkia (même projet Firebase)
    var pts = null, seuils = {}, rel = null;
    function majTemp() {
      if (!pts || !rel) return;
      var label = {}; pts.forEach(function (p) { label[p[0]] = p[1]; });
      var fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris' });
      var rows = [];
      rel.forEach(function (o) {
        var at = new Date(o.at); if (isNaN(at)) return;
        var vals = {}, v = o.values || {};
        Object.keys(v).forEach(function (id) { if (label[id] && typeof v[id] === 'number') vals[label[id]] = v[id]; });
        rows.push({ id: o.id, day: fmt.format(at), salon: String(o.salon || ''), vals: vals });
      });
      D.temp = { rows: rows, cols: pts.map(function (p) { return p[1]; }),
        seuilBas: typeof seuils.min === 'number' ? seuils.min : '', seuilHaut: typeof seuils.max === 'number' ? seuils.max : '', url: TEMP_URL };
      arrive('temp');
    }
    var tempKo = function (e) { D.temp = { err: 'Températures Firebase illisibles : ' + fbErr(e) }; arrive('temp'); };
    F.onSnapshot(F.doc(db, 'TempReglages', 'points'), function (s) {
      if (!s.exists()) { if (!s.metadata.fromCache) { D.temp = { err: 'Points de mesure des températures absents de Firebase.' }; arrive('temp'); } return; }
      try { pts = JSON.parse(s.data().json || '[]'); } catch (e) { pts = []; } majTemp();
    }, tempKo);
    F.onSnapshot(F.doc(db, 'TempReglages', 'seuils'), function (s) { seuils = s.exists() ? s.data() : {}; majTemp(); }, function () {});
    F.onSnapshot(F.collection(db, 'TempReleves'), function (s) {
      rel = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); majTemp();
    }, tempKo);
  }

  function prets() {
    return demarrage.then(function () { return withTimeout(pret, 25000, 'Firebase ne répond pas : la toute première ouverture sur cet appareil demande internet.'); })
      .then(function () {
        if (!D.salons.length && !D.lignes.length) throw new Error('Aucune donnée dans Firebase : la copie du classeur (copierVersFirebase) n\'est pas encore faite.');
      });
  }
  function ensureAuth() {
    return demarrage.then(function () { return auth.authStateReady(); }).then(function () {
      if (!auth.currentUser) return withTimeout(A.signInAnonymously(auth), 15000, 'Pas de connexion : la première saisie sur cet appareil demande internet.');
    });
  }
  /** Écriture sans attendre le serveur (gardée sur l'appareil, envoyée dès que possible) */
  function ecrire(p, quoi) {
    p.catch(function (e) { msg('⚠ ' + quoi + ' non enregistré(e) : ' + fbErr(e)); });
  }

  /* ---------- code des réglages ---------- */
  function session(forcer) {
    return ensureAuth().then(function () {
      var uid = auth.currentUser.uid;
      if (!forcer && LS.getItem('conso_reglages_uid') === uid) return;
      var code = window.prompt('Code des réglages :');
      if (code === null) throw new Error('Modification annulée.');
      code = code.trim();
      return withTimeout(F.setDoc(F.doc(db, 'ConsoSessions', uid), { code: code, at: new Date().toISOString() }), 15000, 'Pas de connexion au serveur.')
        .then(function () { LS.setItem('conso_reglages_uid', uid); LS.setItem('conso_code', code); },
          function (e) { if (e && e.code === 'permission-denied') throw new Error('Code des réglages incorrect.'); throw new Error(fbErr(e)); });
    });
  }
  /** Écriture d'un réglage : demande d'abord le code ; réessaie une fois avec le code si Firebase refuse */
  function reglage(fn) {
    if (navigator.onLine === false) return Promise.reject(new Error('Pas de connexion : la modification des réglages demande internet.'));
    return session(false).then(function () {
      return withTimeout(fn(), 20000, 'Firebase ne répond pas.').catch(function (e) {
        if (!(e && e.code === 'permission-denied')) throw new Error(fbErr(e));
        LS.removeItem('conso_reglages_uid');
        return session(true).then(function () { return withTimeout(fn(), 20000, 'Firebase ne répond pas.'); });
      });
    });
  }

  /* ---------- script Google ---------- */
  function post(body, lecture, essais) {
    essais = essais || (lecture ? 3 : 1);
    var ctl = lecture && window.AbortController ? new AbortController() : null;
    var t = ctl && setTimeout(function () { ctl.abort(); }, 45000);
    return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), redirect: 'follow', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (t) clearTimeout(t);
        if (!r.ok) { var e = new Error('Erreur du script Google (HTTP ' + r.status + ')'); if (r.status >= 500 || r.status === 429) e.reseau = true; throw e; }
        return r.json();
      }, function (e) {
        if (t) clearTimeout(t);
        var x = new Error(e && e.name === 'AbortError' ? 'Le script Google met trop de temps à répondre' : 'Pas de connexion au script Google'); x.reseau = true; throw x;
      }).then(function (j) { if (!j.ok) { var e = new Error(j.error); e.serveur = true; throw e; } return j.data; })
      .catch(function (e) {
        if (e.reseau && essais > 1) return wait(1500).then(function () { return post(body, lecture, essais - 1); });
        throw e;
      });
  }
  function script(fn, args) {
    var lecture = LECTURE.indexOf(fn) >= 0, kc = 'conso_c_' + fn + JSON.stringify(args);
    return post({ fn: fn, args: args }, lecture).then(function (d) { if (lecture) lsSet(kc, d); return d; }, function (e) {
      if (lecture && (e.reseau || !navigator.onLine)) {
        var c = lsGet(kc);
        if (c !== null) { setTimeout(function () { msg('Hors ligne : dernières données connues affichées'); }, 300); return c; }
      }
      throw e;
    });
  }
  /** Relit tout de suite les données publiées par le script (après une action du script) */
  function relireServeur() {
    return F.getDocFromServer(F.doc(db, 'ConsoServeur', 'donnees')).then(function (s) {
      if (s.exists()) D.srv = JSON.parse(s.data().json || '{}');
    }).catch(function () {});
  }

  /* ================= Fonctions appelées par l'interface ================= */
  function bootstrap() { return M.getBootstrap(D); }
  var LOCAL = {
    getBootstrap: function () { return prets().then(bootstrap); },
    getReleves: function (sid) { return prets().then(function () { return M.getReleves(D, sid); }); },

    saveReleve: function (sid, lid, av, ap) {
      return prets().then(ensureAuth).then(function () {
        var x = { av: M.cinq(av), ap: M.cinq(ap), maj: M.maintenant() };
        var vide = x.av.concat(x.ap).every(function (v) { return v === null; });
        var l = {}; l[lid] = vide ? F.deleteField() : x;
        ecrire(F.setDoc(F.doc(db, 'ConsoReleves', sid), { l: l }, { merge: true }), 'Index');
        var cur = D.releves[sid] = Object.assign({}, D.releves[sid] || {});
        if (vide) delete cur[lid]; else cur[lid] = x;
        return M.getSalonCalcule(D, sid);
      });
    },
    setDatesReleve: function (sid, da, dp) {
      return prets().then(ensureAuth).then(function () {
        var s = D.salons.filter(function (x) { return x.id === sid; })[0];
        if (!s) throw new Error('Salon introuvable');
        var o = Object.assign({}, s, { dateAvant: da || '', dateApres: dp || '' });
        var w = M.preparerSalon(D, o);
        ecrire(F.setDoc(F.doc(db, 'ConsoSalons', sid), w), 'Date');
        D.salons = D.salons.map(function (x) { return x.id === sid ? w : x; });
        return M.getSalonCalcule(D, sid);
      });
    },
    saveSalon: function (s) {
      return prets().then(ensureAuth).then(function () {
        var w = M.preparerSalon(D, Object.assign({}, s));
        ecrire(F.setDoc(F.doc(db, 'ConsoSalons', w.id), w), 'Salon');
        var trouve = false;
        D.salons = D.salons.map(function (x) { if (x.id === w.id) { trouve = true; return w; } return x; });
        if (!trouve) D.salons = D.salons.concat([w]);
        return M.getSalonCalcule(D, w.id);
      });
    },
    deleteSalon: function (sid) {
      return prets().then(ensureAuth).then(function () {
        ecrire(F.deleteDoc(F.doc(db, 'ConsoSalons', sid)), 'Suppression du salon');
        ecrire(F.deleteDoc(F.doc(db, 'ConsoReleves', sid)), 'Suppression des index');
        D.salons = D.salons.filter(function (x) { return x.id !== sid; });
        delete D.releves[sid];
        return true;
      });
    },

    saveParams: function (p) {
      return prets().then(function () {
        p = Object.assign({}, p);
        var cle = String(p.MeteoCle || '').trim(); delete p.MeteoCle;
        var suite = Promise.resolve();
        if (Object.keys(p).length) {
          var np = Object.assign({}, D.params, p);
          suite = reglage(function () { return F.setDoc(F.doc(db, 'ConsoConfig', 'params'), { p: np }); }).then(function () { D.params = np; });
        }
        if (cle) suite = suite.then(function () { return session(false); }).then(function () {
          return script('fbCleMeteo', [cle, LS.getItem('conso_code') || '']).then(function () { D.srv.meteoCleOk = true; });
        });
        return suite.then(bootstrap);
      });
    },
    saveHalls: function (list) {
      return prets().then(function () {
        var l = list.filter(function (h) { return h.hall; }).map(function (h) { var n = M.num(h.surface); return { hall: String(h.hall).trim(), surface: n === '' ? 0 : n }; });
        return reglage(function () { return F.setDoc(F.doc(db, 'ConsoConfig', 'halls'), { liste: l }); }).then(function () { D.halls = l; return bootstrap(); });
      });
    },
    saveCorr: function (list) {
      return prets().then(function () {
        var m = {}; list.forEach(function (x) { m[x.hall] = (x.cols || []).slice(); });
        return reglage(function () { return F.setDoc(F.doc(db, 'ConsoConfig', 'corr'), { map: m }); }).then(function () { D.corr = m; return bootstrap(); });
      });
    },
    /** Nouveau : lignes de comptage modifiées dans Réglages */
    saveLignes: function (list) {
      return prets().then(function () {
        var vus = {}, l = list.map(M.nettoyerLigne);
        l.forEach(function (L) {
          if (!L.id) throw new Error('Ligne sans identifiant.');
          if (vus[L.id]) throw new Error('Identifiant en double : ' + L.id); vus[L.id] = 1;
          if (!L.tgbt || !L.ligne) throw new Error('Chaque ligne doit avoir un TGBT et un nom (ligne ' + L.id + ').');
        });
        return reglage(function () { return F.setDoc(F.doc(db, 'ConsoConfig', 'lignes'), { liste: l }); }).then(function () { D.lignes = l; return bootstrap(); });
      });
    },

    // Actions du script Google qui changent la météo ou le PV : on relit ensuite ce qu'il a publié
    saveMeteoJour: function (d, tx, tn) { return script('saveMeteoJour', [d, tx, tn]).then(relireServeur).then(bootstrap); },
    majMeteo: function () { return script('majMeteo', []).then(function (r) { return relireServeur().then(function () { return r; }); }); },
    pvEnregistrer: function (p) { return script('pvEnregistrer', [p]).then(function (r) { return relireServeur().then(function () { return r; }); }); },
    pvSupprimerIndispo: function (k) { return script('pvSupprimerIndispo', [k]).then(function (r) { return relireServeur().then(function () { return r; }); }); }
  };

  function appel(fn, args) {
    if (LOCAL[fn]) return Promise.resolve().then(function () { return LOCAL[fn].apply(null, args); });
    return script(fn, args);
  }
  function runner(ok, ko) {
    return new Proxy({}, { get: function (_, p) {
      if (p === 'withSuccessHandler') return function (h) { return runner(h, ko); };
      if (p === 'withFailureHandler') return function (h) { return runner(ok, h); };
      if (p === 'withUserObject') return function () { return runner(ok, ko); };
      return function () {
        appel(p, [].slice.call(arguments)).then(function (d) { if (ok) ok(d); }, function (e) { if (ko) ko(e); else console.error(e); });
      };
    } });
  }
  window.google = { script: { run: runner(null, null), host: { close: function () {}, setHeight: function () {}, setWidth: function () {}, editor: {} } } };
  window.CONSO_FB = { D: D, appel: appel };
})();
