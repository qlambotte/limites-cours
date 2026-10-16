/* ============================================================
   sonometre.js — sonomètre de classe (P8).
   Chargé À LA DEMANDE par prof.js (bouton « Sonomètre » du bandeau ou touche S),
   donc jamais pour un élève. Documentation : typweb/doc/sonometre.md

   - mesure le NIVEAU RELATIF du son (Web Audio, micro de la tablette) ;
     ce n'est pas un sonomètre étalonné : aucune valeur en dB SPL ;
   - jauge verte → rouge dans la marge droite, repère de seuil, gong synthétisé
     quand le niveau reste trop haut ;
   - AUCUN enregistrement : on lit un tampon de 2048 échantillons toutes les 50 ms,
     on en tire UN nombre (le niveau) et le tampon est écrasé au tour suivant.
     Rien n'est stocké, rien n'est envoyé : ce fichier n'utilise ni MediaRecorder,
     ni réseau (tests/sonometre.test.js le vérifie) ;
   - réglages et compteur de gongs : localStorage, clés « typweb.sonometre.* ».

   Première partie : la logique pure (seuil, durée, réarmement, calibrage),
   testée sous Node. Seconde partie : navigateur (micro, jauge, panneau, gong).
   ============================================================ */
(function (global) {
  "use strict";

  /* =====================================================================
     1. LOGIQUE PURE — aucune dépendance au navigateur
     ===================================================================== */
  var DEFAUTS = {
    seuil: 0.70,        // position du seuil sur la jauge (0 = silence calibré, 1 = haut de la jauge)
    duree: 4,           // s au-dessus du seuil avant le gong
    cooldown: 60,       // s de réarmement, comptées après la fin du gong
    volume: 0.6,        // volume du gong (0 à 1)
    etendue: 35,        // sensibilité : écart (en dB relatifs) entre le bas et le haut de la jauge
    compter: false,     // compter les gongs de la séance
    zeroDb: null,       // niveau du silence calibré (dB pleine échelle) ; null = jamais calibré
    zeroDate: null      // date du calibrage (texte)
  };
  var LIMITES = { seuil: [0.2, 0.95], duree: [1, 30], cooldown: [10, 300], volume: [0, 1], etendue: [15, 60] };
  var ZERO_PAR_DEFAUT = -60;   // dB pleine échelle supposés pour le silence tant que rien n'est calibré
  var DUREE_GONG_MS = 3300;    // durée du gong synthétisé
  var QUEUE_MS = 1500;         // détection encore suspendue après la fin du gong (résonance de la pièce)
  var TROU_MS = 1000;          // plus d'une seconde sans mesure : la durée au-dessus du seuil repart de zéro
  var ATTAQUE_MS = 300;        // lissage : montée rapide
  var RELACHE_MS = 1500;       // lissage : descente lente
  var CALIBRAGE_MS = 5000;

  function borner(x, a, b) { return x < a ? a : x > b ? b : x; }
  function nombre(v, defaut) {
    var x = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    return typeof x === "number" && isFinite(x) ? x : defaut;
  }
  function arrondir(x, n) { var k = Math.pow(10, n); return Math.round(x * k) / k; }

  // Réglages valides à partir de n'importe quoi (stockage abîmé, valeur hors limites…).
  function normaliser(src) {
    var s = src && typeof src === "object" ? src : {}, r = {};
    Object.keys(LIMITES).forEach(function (k) {
      r[k] = arrondir(borner(nombre(s[k], DEFAUTS[k]), LIMITES[k][0], LIMITES[k][1]), 3);
    });
    r.compter = s.compter === true;
    var z = nombre(s.zeroDb, null);
    r.zeroDb = z === null ? null : arrondir(borner(z, -100, 0), 1);
    r.zeroDate = r.zeroDb !== null && typeof s.zeroDate === "string" ? s.zeroDate.slice(0, 40) : null;
    return r;
  }

  // Niveau (RMS, échelle 0..1 de l'audio) → dB pleine échelle (≤ 0).
  function dbDepuisRms(rms) { return rms > 1e-5 ? 20 * Math.log10(rms) : -100; }

  // dB pleine échelle → position sur la jauge, 0 (silence calibré) à 1 (haut).
  function position(db, zeroDb, etendue) {
    var z = zeroDb === null || zeroDb === undefined ? ZERO_PAR_DEFAUT : zeroDb;
    return borner((db - z) / etendue, 0, 1);
  }

  // Lissage exponentiel asymétrique : monte vite, redescend lentement (pas de clignotement).
  function lisseur(attaque, relache) {
    var a = attaque || ATTAQUE_MS, rl = relache || RELACHE_MS, y = null, tPrec = null;
    return {
      pas: function (x, t) {
        if (y === null) { y = x; tPrec = t; return y; }
        var dt = borner(t - tPrec, 0, 500);
        tPrec = t;
        var tau = x > y ? a : rl;
        y += (x - y) * (1 - Math.exp(-dt / tau));
        return y;
      },
      valeur: function () { return y === null ? 0 : y; },
      fixer: function (v, t) { y = v; tPrec = t; },
      vider: function () { y = null; tPrec = null; }
    };
  }

  // Zéro de la jauge d'après des mesures faites dans le calme : 90e centile (un bruit ponctuel
  // ne fait pas monter le zéro). Renvoie aussi un avertissement quand la mesure paraît douteuse.
  function calibrer(ech) {
    if (!ech || ech.length < 20) return { ok: false, erreur: "Trop peu de mesures pour calibrer." };
    var tri = ech.slice().sort(function (a, b) { return a - b; });
    function q(p) { return tri[Math.min(tri.length - 1, Math.floor(p * (tri.length - 1) + 0.5))]; }
    var zero = q(0.9), mediane = q(0.5), avert = "";
    if (zero < -85) avert = "Niveau presque nul : le micro est peut-être coupé ou masqué.";
    else if (zero > -25) avert = "Niveau élevé pendant le calibrage : la classe était-elle calme ?";
    else if (zero - mediane > 8) avert = "Le niveau a varié pendant le calibrage (bruit ponctuel) : recommence dans le calme.";
    return { ok: true, zeroDb: arrondir(zero, 1), avertissement: avert };
  }

  /* Déclencheur : reçoit le niveau LISSÉ (0..1) et l'heure (ms), dit s'il faut sonner.
     États : "arme" (sous le seuil) → "depasse" (au-dessus, la durée court) → gong →
     "suspendu" (pendant le gong et sa queue : on ne mesure plus) → "cooldown" → "arme".
     Après le réarmement, la durée au-dessus du seuil repart de zéro. `r` est lu à chaque
     pas : changer un réglage prend effet tout de suite. */
  function declencheur(r, opts) {
    opts = opts || {};
    var dureeGong = opts.dureeGong != null ? opts.dureeGong : DUREE_GONG_MS;
    var queue = opts.queue != null ? opts.queue : QUEUE_MS;
    var trou = opts.trou != null ? opts.trou : TROU_MS;
    var etat = "arme", depuis = null, finSusp = 0, finCool = 0, dernier = null;

    function sortie(gong, t) {
      return {
        etat: etat,
        gong: !!gong,
        depasse: depuis === null ? 0 : t - depuis,                                   // ms au-dessus du seuil
        reste: (etat === "suspendu" || etat === "cooldown") ? Math.max(0, finCool - t) : 0   // ms avant réarmement
      };
    }
    function pause(t, avecCooldown) {
      etat = "suspendu"; depuis = null;
      finSusp = t + dureeGong + queue;
      finCool = avecCooldown ? finSusp + r.cooldown * 1000 : finSusp;
    }
    return {
      pas: function (niveau, t) {
        if (etat === "suspendu" && t >= finSusp) etat = "cooldown";
        if (etat === "cooldown" && t >= finCool) { etat = "arme"; depuis = null; }
        if (etat === "suspendu" || etat === "cooldown") { dernier = t; return sortie(false, t); }
        if (dernier !== null && t - dernier > trou) depuis = null;     // mesure interrompue : on ne compte pas le vide
        dernier = t;
        if (niveau >= r.seuil) {
          if (depuis === null) depuis = t;
          if (t - depuis >= r.duree * 1000) { pause(t, true); return sortie(true, t); }
          etat = "depasse";
        } else { depuis = null; etat = "arme"; }
        return sortie(false, t);
      },
      // gong de test joué pendant la mesure : détection suspendue, sans délai de réarmement
      suspendre: function (t) { pause(t, false); },
      estSuspendu: function (t) { return etat === "suspendu" && t < finSusp; },
      etat: function () { return etat; },
      reinitialiser: function () { etat = "arme"; depuis = null; dernier = null; }
    };
  }

  var Logique = {
    DEFAUTS: DEFAUTS, LIMITES: LIMITES,
    CONSTANTES: { ZERO_PAR_DEFAUT: ZERO_PAR_DEFAUT, DUREE_GONG_MS: DUREE_GONG_MS, QUEUE_MS: QUEUE_MS, TROU_MS: TROU_MS,
                  ATTAQUE_MS: ATTAQUE_MS, RELACHE_MS: RELACHE_MS, CALIBRAGE_MS: CALIBRAGE_MS },
    normaliser: normaliser, dbDepuisRms: dbDepuisRms, position: position,
    lisseur: lisseur, calibrer: calibrer, declencheur: declencheur
  };
  if (typeof module === "object" && module.exports) module.exports = Logique;

  // Sous Node (tests) : on s'arrête ici.
  if (typeof document === "undefined" || !document.createElement) return;
  if (global.typwebSonometre) return;

  /* =====================================================================
     2. NAVIGATEUR — micro, jauge, panneau, gong
     ===================================================================== */
  var CLE_REGLAGES = "typweb.sonometre.v1";
  var CLE_GONGS = "typweb.sonometre.gongs.v1";
  var CLE_ACTIF = "typweb.sonometre.actif";       // sessionStorage : reprise d'une page à l'autre, dans l'onglet
  var PERIODE_MS = 50;

  var script = document.currentScript;
  var BASE = (script && script.src ? script.src.replace(/[^\/]*$/, "") : "") ||
             (global.typwebProf && global.typwebProf.interne && global.typwebProf.interne.base) || "";
  (function () {
    if (!BASE) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = BASE + "sonometre.css";
    document.head.appendChild(l);
  })();

  /* ---------- réglages ---------- */
  var R = lireReglages();
  function lireReglages() {
    try { return normaliser(JSON.parse(localStorage.getItem(CLE_REGLAGES) || "null")); }
    catch (e) { return normaliser(null); }
  }
  function ecrireReglages() {
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(R)); } catch (e) {}
  }
  function definir(partiel) {
    var m = {}; Object.keys(R).forEach(function (k) { m[k] = R[k]; });
    Object.keys(partiel || {}).forEach(function (k) { m[k] = partiel[k]; });
    var n = normaliser(m);
    Object.keys(n).forEach(function (k) { R[k] = n[k]; });      // R reste le même objet (lu par le déclencheur)
    ecrireReglages(); majTout();
    return reglages();
  }
  function reglages() { var c = {}; Object.keys(R).forEach(function (k) { c[k] = R[k]; }); return c; }
  function reinitialiser() {       // réglages par défaut ; le zéro calibré de cette tablette est conservé
    var zero = R.zeroDb, date = R.zeroDate;
    var n = normaliser(null);
    Object.keys(n).forEach(function (k) { R[k] = n[k]; });
    R.zeroDb = zero; R.zeroDate = date;
    ecrireReglages(); majTout();
  }

  /* ---------- compteur de gongs (option) : « jour|classe » → nombre, rien d'autre ---------- */
  function jourLocal() {
    var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
  }
  function classeActive() {
    try { return (global.typwebProf && global.typwebProf.classe && global.typwebProf.classe()) || ""; } catch (e) { return ""; }
  }
  function lireGongs() {
    try { var o = JSON.parse(localStorage.getItem(CLE_GONGS) || "null"); return o && o.s && typeof o.s === "object" ? o.s : {}; }
    catch (e) { return {}; }
  }
  function nbGongs() { return lireGongs()[jourLocal() + "|" + classeActive()] || 0; }
  function compterGong() {
    if (!R.compter) return;
    var s = lireGongs(), k = jourLocal() + "|" + classeActive();
    s[k] = (s[k] || 0) + 1;
    var cles = Object.keys(s).sort();               // on ne garde que les 60 dernières séances
    while (cles.length > 60) delete s[cles.shift()];
    try { localStorage.setItem(CLE_GONGS, JSON.stringify({ v: 1, s: s })); } catch (e) {}
  }

  /* ---------- gong : oscillateurs sinusoïdaux à enveloppe, sans fichier audio ---------- */
  var PARTIELS = [       // r : rapport à la fondamentale ; a : amplitude ; d : durée de la résonance (s)
    { r: 1.000, a: 0.50, d: 3.2 }, { r: 1.006, a: 0.40, d: 3.0 },     // fondamentale doublée : battement lent
    { r: 2.000, a: 0.25, d: 2.4 }, { r: 2.760, a: 0.20, d: 1.8 }, { r: 4.100, a: 0.10, d: 1.1 }
  ];
  var F0 = 174.6;
  function jouerGong(ctx, volume) {
    var t0 = ctx.currentTime + 0.03;
    var maitre = ctx.createGain();
    maitre.gain.value = Math.pow(volume, 2) * 0.6;      // courbe quadratique : le curseur « sonne » plus uniformément
    maitre.connect(ctx.destination);
    PARTIELS.forEach(function (p) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = F0 * p.r;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(p.a, t0 + 0.012);        // attaque : 12 ms
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);       // résonance
      o.connect(g); g.connect(maitre);
      o.start(t0); o.stop(t0 + p.d + 0.05);
    });
    return 3.3;
  }

  /* ---------- état ---------- */
  var TEXTES = {
    arrete: "Arrêté", demande: "Demande d'accès au micro…", ecoute: "À l'écoute", calibrage: "Calibrage du silence…",
    pause: "Gong : détection en pause", refuse: "Micro refusé", absent: "Aucun micro détecté",
    occupe: "Micro indisponible", insecurise: "Micro impossible sans HTTPS", indisponible: "Mesure du son impossible ici",
    interrompu: "Micro interrompu", erreur: "Erreur du micro", veille: "Écoute en pause : touche la page"
  };
  var AIDES = {
    refuse: "Autorise le micro : touche l'icône à gauche de l'adresse → Autorisations → Micro → Autoriser, puis « Réessayer ». " +
            "Si l'option manque : Paramètres Android → Applications → Chrome → Autorisations → Micro.",
    absent: "Aucun micro n'a été trouvé sur cet appareil.",
    occupe: "Une autre application utilise peut-être le micro (visio, enregistreur). Ferme-la, puis « Réessayer ».",
    insecurise: "Le navigateur n'autorise le micro que sur une page en HTTPS.",
    indisponible: "Ce navigateur n'offre pas la mesure du son (Web Audio) ou l'accès au micro.",
    interrompu: "Le micro s'est arrêté (autre application, appareil débranché). Relance avec « Réessayer ».",
    erreur: "Le micro n'a pas pu démarrer. Réessaie ; si cela persiste, recharge la page.",
    veille: "Le navigateur a mis l'écoute en pause. Touche l'écran pour la reprendre."
  };

  var etatCode = "arrete", avertissement = "", messageCalib = "";
  var flux = null, ctx = null, analyseur = null, source = null, tampon = null, minuteur = null, verrou = null;
  var demarrage = null, calib = null;
  var lisse = lisseur(), decl = declencheur(R), niveau = 0, dernierSortie = null, dernierRms = 0;
  var abonnes = [];

  function maintenant() { return (global.performance && performance.now) ? performance.now() : Date.now(); }
  function actif() { return !!flux; }

  /* ---------- micro ---------- */
  function sessionDrapeau(v) {
    try { if (v) sessionStorage.setItem(CLE_ACTIF, "1"); else sessionStorage.removeItem(CLE_ACTIF); } catch (e) {}
  }
  function codeErreur(e) {
    var n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") return "refuse";
    if (n === "NotFoundError" || n === "DevicesNotFoundError") return "absent";
    if (n === "NotReadableError" || n === "AbortError" || n === "TrackStartError") return "occupe";
    return "erreur";
  }
  function liberer() {                 // libère réellement le micro, le contexte audio et le verrou d'écran
    if (minuteur) { clearInterval(minuteur); minuteur = null; }
    if (flux) { flux.getTracks().forEach(function (t) { try { t.onended = null; t.stop(); } catch (e) {} }); flux = null; }
    try { if (source) source.disconnect(); } catch (e) {}
    source = null; analyseur = null; tampon = null;
    if (ctx) { try { ctx.close(); } catch (e) {} ctx = null; }
    if (verrou) { try { verrou.release(); } catch (e) {} verrou = null; }
    calib = null;
    lisse.vider(); decl.reinitialiser(); niveau = 0; dernierSortie = null;
  }
  function demarrer(auto) {
    if (flux) return Promise.resolve(true);
    if (demarrage) return demarrage;
    avertissement = ""; messageCalib = "";
    var AC = global.AudioContext || global.webkitAudioContext;
    var md = global.navigator && navigator.mediaDevices;
    if (!global.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") { etatCode = "insecurise"; majTout(); return Promise.resolve(false); }
    if (!AC || !md || !md.getUserMedia) { etatCode = "indisponible"; majTout(); return Promise.resolve(false); }
    etatCode = "demande"; majTout();
    try { ctx = new AC(); } catch (e) { ctx = null; etatCode = "indisponible"; majTout(); return Promise.resolve(false); }
    var contexte = ctx;
    // Traitements du navigateur DÉSACTIVÉS : suppression de bruit, annulation d'écho et gain automatique
    // fausseraient la mesure (ils « gomment » justement le bruit de classe).
    demarrage = md.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false })
      .then(function (stream) {
        demarrage = null;
        if (ctx !== contexte) { stream.getTracks().forEach(function (t) { t.stop(); }); return false; }   // arrêté entre-temps
        flux = stream;
        var piste = stream.getAudioTracks()[0];
        var st = piste && piste.getSettings ? piste.getSettings() : {};
        var ignores = [];
        if (st.echoCancellation === true) ignores.push("annulation d'écho");
        if (st.noiseSuppression === true) ignores.push("suppression de bruit");
        if (st.autoGainControl === true) ignores.push("gain automatique");
        if (ignores.length) avertissement = "Ce navigateur n'a pas désactivé : " + ignores.join(", ") + ". La mesure est moins fiable.";
        if (piste) piste.onended = function () { liberer(); sessionDrapeau(false); etatCode = "interrompu"; majTout(); };
        source = contexte.createMediaStreamSource(stream);
        analyseur = contexte.createAnalyser();
        analyseur.fftSize = 2048; analyseur.smoothingTimeConstant = 0;
        source.connect(analyseur);                 // jamais relié aux haut-parleurs : pas de larsen
        tampon = new Float32Array(analyseur.fftSize);
        etatCode = "ecoute";
        lisse.vider(); decl.reinitialiser();
        try { contexte.resume(); } catch (e) {}
        minuteur = setInterval(tic, PERIODE_MS);
        prendreVerrou();
        sessionDrapeau(true);
        majTout();
        return true;
      })
      .catch(function (e) {
        demarrage = null;
        if (ctx === contexte) { liberer(); etatCode = codeErreur(e); majTout(); }
        return false;
      });
    return demarrage;
  }
  function arreter() {
    liberer(); sessionDrapeau(false);
    etatCode = "arrete"; avertissement = ""; messageCalib = "";
    majTout();
  }
  function basculer() { return flux || demarrage ? (arreter(), Promise.resolve(false)) : demarrer(); }
  // Reprise automatique sur la page suivante (navigation dans le cours), seulement si le micro est DÉJÀ autorisé.
  function reprendre() {
    if (flux || demarrage) return;
    var voulu = false;
    try { voulu = sessionStorage.getItem(CLE_ACTIF) === "1"; } catch (e) {}
    if (!voulu) return;                              // arrêté volontairement (ou jamais lancé) dans cet onglet
    var p = global.navigator && navigator.permissions && navigator.permissions.query;
    if (!p) { sessionDrapeau(false); return; }
    navigator.permissions.query({ name: "microphone" }).then(function (s) {
      if (s.state === "granted") demarrer(true); else sessionDrapeau(false);
    }, function () { sessionDrapeau(false); });
  }
  function prendreVerrou() {                       // écran maintenu allumé pendant la mesure (sinon la tablette coupe le micro)
    if (!flux || verrou || !(global.navigator && navigator.wakeLock && navigator.wakeLock.request)) return;
    navigator.wakeLock.request("screen").then(function (w) {
      if (!flux) { try { w.release(); } catch (e) {} return; }
      verrou = w;
      w.addEventListener("release", function () { if (verrou === w) verrou = null; });
    }).catch(function () {});
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !flux) return;
    prendreVerrou();
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
  });
  document.addEventListener("click", function () {      // le navigateur exige un geste pour relancer l'audio
    if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
  }, true);
  global.addEventListener("pagehide", liberer);         // l'indicateur de micro disparaît ; le drapeau de reprise reste

  /* ---------- mesure : un seul nombre par tour ---------- */
  function tic() {
    if (!analyseur) return;
    if (ctx.state !== "running") {
      try { ctx.resume(); } catch (e) {}
      if (etatCode !== "veille") { etatCode = "veille"; majTout(); }
      return;
    }
    if (etatCode === "veille") etatCode = calib ? "calibrage" : "ecoute";
    analyseur.getFloatTimeDomainData(tampon);
    var s = 0, i, n = tampon.length;
    for (i = 0; i < n; i++) s += tampon[i] * tampon[i];
    var db = dbDepuisRms(Math.sqrt(s / n));          // seul résultat conservé ; le tampon est réécrit au tour suivant
    var t = maintenant();
    dernierRms = db;

    if (calib) {                                     // calibrage : on collecte des niveaux (nombres), pas de gong
      calib.ech.push(db);
      if (t >= calib.fin) terminerCalibrage(); else majTout();
      return;
    }
    var pos = position(db, R.zeroDb, R.etendue);
    if (!decl.estSuspendu(t)) niveau = lisse.pas(pos, t);        // pendant le gong : niveau figé (le gong ne doit pas se mesurer)
    var sortie = decl.pas(niveau, t);
    dernierSortie = sortie;
    if (sortie.gong) { compterGong(); sonner(); }
    var code = (sortie.etat === "suspendu" || sortie.etat === "cooldown") ? "pause" : "ecoute";
    if (code !== etatCode) etatCode = code;
    majTout();
  }
  function sonner() {
    if (ctx && ctx.state === "running") jouerGong(ctx, R.volume);
  }

  /* ---------- calibrage du silence ---------- */
  function calibrerSilence() {
    var p = flux ? Promise.resolve(true) : demarrer();
    return p.then(function (ok) {
      if (!ok) return false;
      messageCalib = "";
      calib = { ech: [], fin: maintenant() + CALIBRAGE_MS };
      etatCode = "calibrage"; majTout();
      return true;
    });
  }
  function terminerCalibrage() {
    var res = calibrer(calib.ech);
    calib = null;
    etatCode = "ecoute";
    if (res.ok) {
      var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; };
      R.zeroDb = res.zeroDb; R.zeroDate = z(d.getHours()) + ":" + z(d.getMinutes());
      ecrireReglages();
      messageCalib = res.avertissement || "";           // la date du zéro est affichée à part
      lisse.vider(); decl.reinitialiser(); niveau = 0;
    } else messageCalib = res.erreur;
    majTout();
  }

  /* ---------- gong de test ---------- */
  function testerGong() {
    if (ctx && flux) {                                // en cours de mesure : détection suspendue pendant le test
      decl.suspendre(maintenant());
      try { ctx.resume(); } catch (e) {}
      jouerGong(ctx, R.volume);
      return;
    }
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return;
    var c = new AC();
    try { c.resume(); } catch (e) {}
    jouerGong(c, R.volume);
    setTimeout(function () { try { c.close(); } catch (e) {} }, 3800);
  }

  /* =====================================================================
     3. INTERFACE
     ===================================================================== */
  function noeud(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  }
  var racine, gaugeEl, piste, degrade, repereSeuil, curseur, ouvrir, panneau;
  var champs = {};   // sliders et zones de texte du panneau

  function construire() {
    // --- jauge, dans la marge droite ---
    racine = noeud("div", "tw-son"); racine.hidden = true;
    piste = noeud("div", "tw-son-piste");
    piste.setAttribute("role", "meter");
    piste.setAttribute("aria-label", "Niveau sonore relatif de la classe");
    piste.setAttribute("aria-valuemin", "0"); piste.setAttribute("aria-valuemax", "100");
    degrade = noeud("div", "tw-son-degrade");
    repereSeuil = noeud("div", "tw-son-seuil");
    curseur = noeud("div", "tw-son-curseur");
    piste.appendChild(degrade);
    racine.appendChild(piste); racine.appendChild(repereSeuil); racine.appendChild(curseur);
    ouvrir = noeud("button", "tw-son-ouvrir");
    ouvrir.type = "button"; ouvrir.setAttribute("aria-label", "Sonomètre : ouvrir les réglages");
    ouvrir.addEventListener("click", function () { ouvrirPanneau(panneau.hidden); });
    racine.appendChild(ouvrir);

    // --- panneau de réglages ---
    panneau = noeud("div", "tw-son-panneau"); panneau.hidden = true;
    panneau.setAttribute("role", "dialog"); panneau.setAttribute("aria-label", "Réglages du sonomètre");
    var titre = noeud("div", "tw-son-titre", "Sonomètre — niveau relatif (pas des dB)");
    champs.etat = noeud("div", "tw-son-etat"); champs.etat.setAttribute("aria-live", "polite");
    champs.aide = noeud("div", "tw-son-aide");
    champs.avert = noeud("div", "tw-son-aide");
    champs.niveau = noeud("div", "tw-son-niveau");
    champs.zero = noeud("div", "tw-son-aide");
    champs.marche = noeud("button", "tw-son-btn"); champs.marche.type = "button";
    champs.marche.addEventListener("click", function () { basculer(); });
    champs.calib = noeud("button", "tw-son-btn", "Calibrer le silence"); champs.calib.type = "button";
    champs.calib.title = "Mesure 5 s de calme : c'est le zéro de la jauge. Pas un mot pendant ce temps.";
    champs.calib.addEventListener("click", function () { calibrerSilence(); });
    champs.test = noeud("button", "tw-son-btn", "Tester le gong"); champs.test.type = "button";
    champs.test.addEventListener("click", testerGong);
    var rangMarche = noeud("div", "tw-son-rang"); rangMarche.appendChild(champs.marche); rangMarche.appendChild(champs.calib);
    panneau.appendChild(titre); panneau.appendChild(champs.etat); panneau.appendChild(champs.aide); panneau.appendChild(champs.avert);
    panneau.appendChild(champs.niveau); panneau.appendChild(champs.zero);
    panneau.appendChild(rangMarche); panneau.appendChild(champs.test);

    ligne("seuil", "Seuil d'alerte", 20, 95, 1, function (v) { return v + " %"; }, function (v) { return v / 100; }, function (x) { return Math.round(x * 100); });
    ligne("duree", "Durée au-dessus du seuil", 1, 30, 1, function (v) { return v + " s"; });
    ligne("cooldown", "Délai de réarmement", 10, 300, 5, function (v) { return v + " s"; });
    ligne("volume", "Volume du gong", 0, 100, 5, function (v) { return v + " %"; }, function (v) { return v / 100; }, function (x) { return Math.round(x * 100); });
    ligne("etendue", "Sensibilité (étendue)", 15, 60, 1, function (v) { return v + " dB"; });
    champs.sensNote = noeud("div", "tw-son-aide", "Étendue plus petite = jauge plus sensible.");
    panneau.appendChild(champs.sensNote);

    var lc = noeud("label", "tw-son-case");
    champs.compter = noeud("input"); champs.compter.type = "checkbox";
    champs.compter.addEventListener("change", function () { definir({ compter: champs.compter.checked }); });
    champs.gongs = noeud("span", "", "");
    lc.appendChild(champs.compter); lc.appendChild(document.createTextNode(" Compter les gongs de la séance ")); lc.appendChild(champs.gongs);
    panneau.appendChild(lc);

    var bas = noeud("div", "tw-son-rang");
    var bRaz = noeud("button", "tw-son-btn", "Réinitialiser"); bRaz.type = "button";
    bRaz.title = "Remet les réglages par défaut (le zéro calibré est conservé)";
    bRaz.addEventListener("click", reinitialiser);
    var bFermer = noeud("button", "tw-son-btn", "Fermer"); bFermer.type = "button";
    bFermer.addEventListener("click", function () { ouvrirPanneau(false); });
    bas.appendChild(bRaz); bas.appendChild(bFermer);
    panneau.appendChild(bas);

    document.body.appendChild(racine); document.body.appendChild(panneau);
  }
  // Une ligne de réglage : libellé, curseur, valeur. `versR` / `depuisR` convertissent curseur ↔ réglage.
  function ligne(cle, libelle, min, max, pas, fmt, versR, depuisR) {
    versR = versR || function (v) { return v; };
    depuisR = depuisR || function (x) { return x; };
    var rang = noeud("div", "tw-son-reglage");
    var id = "tw-son-" + cle;
    var lab = noeud("label", "", libelle); lab.htmlFor = id;
    var val = noeud("output", "tw-son-val"); val.htmlFor = id;
    var inp = noeud("input"); inp.type = "range"; inp.id = id;
    inp.min = String(min); inp.max = String(max); inp.step = String(pas);
    inp.addEventListener("input", function () {
      var p = {}; p[cle] = versR(Number(inp.value)); definir(p);
    });
    var tete = noeud("div", "tw-son-tete"); tete.appendChild(lab); tete.appendChild(val);
    rang.appendChild(tete); rang.appendChild(inp);
    panneau.appendChild(rang);
    champs[cle] = { inp: inp, val: val, fmt: fmt, depuisR: depuisR };
  }
  function ouvrirPanneau(oui) {
    if (!panneau) return;
    panneau.hidden = !oui;
    majTout();
  }

  /* ---------- affichage ---------- */
  function libelleBouton() {
    if (etatCode === "arrete") return "Sonomètre : arrêté ▶";
    if (etatCode === "ecoute" || etatCode === "pause" || etatCode === "calibrage") return "Sonomètre : à l'écoute ■";
    if (etatCode === "demande") return "Sonomètre : démarrage…";
    if (etatCode === "veille") return "Sonomètre : en pause";
    return "Sonomètre : " + (TEXTES[etatCode] || "arrêté").toLowerCase();
  }
  function majTout() {
    if (!racine) return;
    var marche = !!flux;
    racine.hidden = !marche;
    var pct = Math.round(niveau * 100);
    var surSeuil = marche && niveau >= R.seuil && etatCode !== "pause" && etatCode !== "calibrage";
    var pause = etatCode === "pause" || etatCode === "calibrage" || etatCode === "veille";
    racine.className = "tw-son" + (surSeuil ? " tw-son-alerte" : "") + (pause ? " tw-son-pause" : "");
    degrade.style.setProperty("--n", pct + "%");
    curseur.style.bottom = pct + "%";
    repereSeuil.style.bottom = Math.round(R.seuil * 100) + "%";
    piste.setAttribute("aria-valuenow", String(pct));
    piste.setAttribute("aria-valuetext", "niveau relatif " + pct + " %, " + (surSeuil ? "au-dessus du seuil" : "sous le seuil"));

    var b = document.querySelector('[data-outil="sonometre"]');
    if (b) { b.textContent = libelleBouton(); b.setAttribute("aria-pressed", marche ? "true" : "false"); }
    if (panneau.hidden) return;

    var etatTxt = TEXTES[etatCode] || "";
    if (etatCode === "calibrage" && calib) etatTxt += " " + Math.max(0, Math.ceil((calib.fin - maintenant()) / 1000)) + " s";
    if (etatCode === "pause" && dernierSortie) etatTxt += " (réarmement dans " + Math.ceil(dernierSortie.reste / 1000) + " s)";
    champs.etat.textContent = (marche ? "● " : "○ ") + etatTxt;
    champs.aide.textContent = AIDES[etatCode] || "";
    champs.aide.hidden = !AIDES[etatCode];
    var av = avertissement || messageCalib;
    champs.avert.textContent = av; champs.avert.hidden = !av;
    champs.niveau.textContent = !marche ? "" :
      (R.zeroDb === null ? "Non calibré : touche « Calibrer le silence » dans une classe calme."
                         : "Écart au calme : environ +" + Math.round(niveau * R.etendue) + " (relatif)");
    champs.zero.textContent = R.zeroDb === null ? "" : "Zéro calibré" + (R.zeroDate ? " à " + R.zeroDate : "") + ". À refaire si tu déplaces la tablette.";
    champs.zero.hidden = R.zeroDb === null;
    champs.marche.textContent = marche || demarrage ? "Arrêter (S)" : "Démarrer (S)";
    ["seuil", "duree", "cooldown", "volume", "etendue"].forEach(function (k) {
      var c = champs[k], v = c.depuisR(R[k]);
      if (document.activeElement !== c.inp) c.inp.value = String(v);
      c.val.textContent = c.fmt(v);
    });
    champs.compter.checked = !!R.compter;
    champs.gongs.textContent = R.compter ? "(aujourd'hui" + (classeActive() ? ", " + classeActive() : "") + " : " + nbGongs() + ")" : "";
    if (etatCode === "refuse" || etatCode === "absent" || etatCode === "occupe" || etatCode === "interrompu" || etatCode === "erreur") {
      champs.marche.textContent = "Réessayer";
    }
  }

  /* ---------- API ---------- */
  global.typwebSonometre = {
    version: 1,
    demarrer: function () { return demarrer(); },
    arreter: arreter,
    basculer: basculer,
    reprendre: reprendre,
    actif: actif,
    calibrer: calibrerSilence,
    testerGong: testerGong,
    reglages: reglages,
    definir: definir,
    reinitialiser: reinitialiser,
    ouvrirReglages: function (oui) { ouvrirPanneau(oui !== false); },
    etat: function () {
      return { actif: actif(), code: etatCode, texte: TEXTES[etatCode] || "", niveau: niveau, dbMesure: dernierRms,
               seuil: R.seuil, gongsAujourdhui: nbGongs(), avertissement: avertissement };
    },
    logique: Logique
  };

  function init() { construire(); majTout(); }
  if (document.body) init(); else document.addEventListener("DOMContentLoaded", init);
})(typeof window !== "undefined" ? window : globalThis);
