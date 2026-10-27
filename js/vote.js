/* ============================================================
   vote.js — écrans de vote en classe (P3), couche prof.
   Chargé par prof.js (mode prof seulement) : aucun élève ne le télécharge,
   ni vote.css, ni les deux modes, ni classe.json.
   Documentation : typweb/doc/couche-prof.md (« Écrans de vote »).

   Contenu :
   - données : classe.json (banque de classe, P2) en cache local ;
   - rendu des textes (Markdown + $…$) avec le MathJax des notes ;
   - écran plein cadre commun (plein écran, écran allumé, mode projeté, clavier) ;
   - points d'entrée : « Poser à la classe », « Tester la compréhension »,
     lanceur de test de l'échauffement ;
   - API : typwebProf.vote.start({mode, items, titre}).
   Les deux modes sont dans vote-comprehension.js (vote détaillé) et
   vote-echauffement.js (suite allégée) ; ils s'enregistrent dans V.modes.
   ============================================================ */
(function () {
  "use strict";
  var P = window.typwebProf;
  if (!P || P.vote) return;
  var I = P.interne;
  var BASE = I.base;

  var NOM_CACHE = "typweb-prof-classe";
  var VALIDITE = 12 * 3600 * 1000;                 // au-delà : on tente de rafraîchir (réseau d'abord)
  var UAA = I.uaa || "";
  // La banque (avec les bonnes réponses) vit dans le dépôt PRIVÉ de suivi : banques/<UAA>/classe.json, lue avec le
  // jeton de synchronisation (P5). Repli : un classe.json publié avec le site (anciens sites, sites de test).
  var CHEMIN_DEPOT = "banques/" + UAA + "/classe.json";
  var URL_CLASSE = (function () {
    try { return new URL((window.TYPWEB && window.TYPWEB.classe) || "prof-classe/classe.json", I.racine).href; }
    catch (e) { return "prof-classe/classe.json"; }
  })();
  var CLE_CACHE_T = "typweb.prof.classe.t." + (UAA || URL_CLASSE);   // une date de copie PAR cours
  var MSG_INDISPO = "La banque de classe n'est pas disponible sur cette tablette. Configure la synchronisation " +
                    "(jeton du dépôt privé) puis ouvre une page du cours avec une connexion, une seule fois.";

  var V = { modes: {}, u: {}, version: 1 };

  /* ---------- outils DOM ---------- */
  function h(tag, att, kids) {
    var e = document.createElement(tag), k;
    if (att) for (k in att) {
      if (!Object.prototype.hasOwnProperty.call(att, k) || att[k] === undefined || att[k] === null) continue;
      if (k === "class") e.className = att[k];
      else if (k === "text") e.textContent = att[k];
      else if (k === "html") e.innerHTML = att[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), att[k]);
      else e.setAttribute(k, att[k]);
    }
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }
  function bouton(texte, cls, fn, titre) {
    var b = h("button", { type: "button", "class": cls || "", text: texte, onclick: fn });
    if (titre) { b.title = titre; if (String(texte).length <= 1) b.setAttribute("aria-label", titre); }
    return b;
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  /* ---------- rendu des textes : Markdown léger + $…$ (MathJax des notes) ---------- */
  function texte(s) {                              // texte courant : gras, italique
    return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  }
  function md(s, enLigne) {
    s = String(s === null || s === undefined ? "" : s);
    var re = /(\\\$)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, m, last = 0, out = "";
    while ((m = re.exec(s))) {
      out += texte(s.slice(last, m.index));
      if (m[1]) out += "$";
      else if (m[2] !== undefined) out += '<span class="math display">\\[' + esc(m[2]) + "\\]</span>";
      else out += '<span class="math inline">\\(' + esc(m[3]) + "\\)</span>";
      last = re.lastIndex;
    }
    out += texte(s.slice(last));
    if (enLigne) return out.replace(/\n+/g, " ");
    return out.split(/\n{2,}/).map(function (p) { return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  // Compose les formules d'un conteneur avec le MathJax de la page (idempotent) ; réessaie
  // tant que MathJax (chargé en différé, CDN) n'est pas prêt, sans erreur s'il ne vient pas.
  // La page de pilotage n'a pas de MathJax : on le charge à la demande, copie locale du site d'abord
  // (js/mathjax/, installée par typweb, servie hors ligne), sinon le CDN.
  var MJ_LOCAL = BASE + "mathjax/es5/tex-chtml-full.js";
  var MJ_CDN = "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml-full.js";
  var mjCharge = false;
  function chargerMathJax() {
    if (mjCharge || window.MathJax || document.querySelector('script[src*="mathjax"]')) return;
    mjCharge = true;
    window.MathJax = { tex: { inlineMath: [["\\(", "\\)"]], displayMath: [["\\[", "\\]"]] },
                       options: { enableMenu: false }, startup: { typeset: false } };
    var s = document.createElement("script");
    s.src = MJ_LOCAL; s.async = true;
    s.onerror = function () { var c = document.createElement("script"); c.src = MJ_CDN; c.async = true; document.head.appendChild(c); };
    document.head.appendChild(s);
  }
  function composer(el) {
    var n = 0;
    (function essai() {
      var M = window.MathJax;
      try {
        if (M && M.typesetPromise) { M.typesetPromise([el]).catch(function () {}); return; }
        if (M && M.typeset) { M.typeset([el]); return; }
      } catch (e) { return; }
      if (n === 8) chargerMathJax();                   // 2 s sans MathJax : la page n'en a pas
      if (++n < 160 && document.body.contains(el)) setTimeout(essai, 250);
    })();
  }

  /* ---------- données : classe.json ---------- */
  var memo = null, donnees = null;
  var supplement = { qcm: {}, ex: {} };      // banques d'autres UAA ajoutées par la page de pilotage (P4)
  function lireCache() {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(NOM_CACHE).then(function (c) { return c.match(URL_CLASSE); })
      .then(function (r) { return r ? r.text() : null; }).catch(function () { return null; });
  }
  function ecrireCache(brut) {
    try { localStorage.setItem(CLE_CACHE_T, String(Date.now())); } catch (e) {}
    if (!window.caches) return Promise.resolve();
    return caches.open(NOM_CACHE).then(function (c) {
      return c.put(URL_CLASSE, new Response(brut, { headers: { "content-type": "application/json" } }));
    }).catch(function () {});
  }
  function ageCache() {
    try { return Date.now() - (+localStorage.getItem(CLE_CACHE_T) || 0); } catch (e) { return Infinity; }
  }
  // Attend que sync.js (chargé par prof.js juste après vote.js) soit prêt.
  function attendreSync(ms) {
    return new Promise(function (res) {
      var t0 = Date.now();
      (function essai() {
        if (window.typwebSync) return res(window.typwebSync);
        if (P.syncAbsente || Date.now() - t0 > ms) return res(null);
        setTimeout(essai, 100);
      })();
    });
  }
  function avecDelai(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error("délai dépassé")); }, ms); })]);
  }
  function depot(delai) {
    return attendreSync(1500).then(function (S) {
      if (!S || !S.lireFichier || !S.estConfigure || !S.estConfigure() || !UAA) throw new Error("dépôt privé non configuré");
      return avecDelai(S.lireFichier(CHEMIN_DEPOT), delai);
    });
  }
  // Version fraîche : dépôt privé d'abord, sinon le fichier publié avec le site (s'il existe encore).
  function frais(delai) { return depot(delai).catch(function () { return reseau(delai); }); }
  function reseau(delai) {
    var ctl = window.AbortController ? new AbortController() : null;
    var t = ctl ? setTimeout(function () { ctl.abort(); }, delai) : null;
    return fetch(URL_CLASSE, { cache: "no-cache", signal: ctl ? ctl.signal : undefined })
      .then(function (r) { if (t) clearTimeout(t); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .catch(function (e) { if (t) clearTimeout(t); throw e; });
  }
  function analyser(brut) {
    var j;
    try { j = JSON.parse(brut); } catch (e) { throw new Error("banque illisible"); }
    if (!j || typeof j.schema !== "string" || j.schema.indexOf("typweb-classe/1") !== 0 || !Array.isArray(j.qcm)) {
      throw new Error("format de banque inattendu (" + (j && j.schema) + ")");
    }
    return j;
  }
  // Charge classe.json : copie locale d'abord si elle est récente, sinon réseau puis copie.
  // Jamais appelé sans la couche prof. Renvoie la banque ; rejette avec un message clair.
  // force : ignore la copie récente (élément introuvable : la banque a sans doute changé depuis la copie).
  function charger(force) {
    if (donnees && !force) return Promise.resolve(donnees);
    if (memo && !force) return memo;
    var enLigne = navigator.onLine !== false;
    memo = lireCache().then(function (brut) {
      if (brut && !force && (!enLigne || ageCache() < VALIDITE)) return analyser(brut);
      if (!enLigne) { if (brut) return analyser(brut); throw new Error(MSG_INDISPO); }
      return frais(brut ? 6000 : 12000).then(function (txt) {
        var j = analyser(txt);
        ecrireCache(txt);
        return j;
      }, function () {
        if (brut) return analyser(brut);              // réseau absent ou lent : copie gardée
        throw new Error(MSG_INDISPO);
      });
    }).then(function (j) { donnees = indexer(j); return donnees; },
            function (e) { memo = null; throw e; });
    return memo;
  }
  function indexer(j) {
    var qcm = {}, ex = {};
    j.qcm.forEach(function (q) { qcm[q.id] = q; });
    ((j.exercices && j.exercices.lots) || []).forEach(function (lot) {
      (lot.variantes || []).forEach(function (v) { ex[v.graine] = { lot: lot, v: v }; });
    });
    j._qcm = qcm; j._ex = ex;
    return j;
  }

  /* ---------- éléments d'une suite ---------- */
  var LETTRES = ["A", "B", "C", "D"];
  function qcmVue(q, role) {
    return {
      type: "qcm", id: q.id, role: role || q.role || null, usage: q.usage, sur: q.sur, q: q,
      enonce: q.enonce, bonne: q.bonne, explication: q.explication || "",
      options: q.options.map(function (o, i) { return { k: LETTRES[i], r: o.r, erreur: o.erreur, retour: o.retour }; })
    };
  }
  // items : "5UAA3.c.001" (QCM) | "factoriser.trinome.5e:0007" (exercice) | { id | graine | soustype, role? }
  function resoudre(items, data) {
    var manquants = [], out = [];
    (items || []).forEach(function (it) {
      var o = typeof it === "string" ? (it.indexOf(":") >= 0 ? { graine: it } : { id: it }) : it || {};
      var q = o.id && (data._qcm[o.id] || supplement.qcm[o.id]), g = o.graine || (o.exercice && o.exercice.graine), e;
      if (q) { out.push(qcmVue(q, o.role)); return; }
      if (!g && o.soustype) {
        var lot = ((data.exercices && data.exercices.lots) || []).filter(function (l) { return l.soustype === o.soustype; })[0];
        g = lot && lot.variantes[0] && lot.variantes[0].graine;
      }
      e = g && (data._ex[g] || supplement.ex[g]);
      if (e) {
        out.push({ type: "exercice", id: e.lot.soustype, graine: e.v.graine, role: o.role || null,
                   enonce: e.v.enonce, etapes: e.v.etapes || [], reponse: e.v.reponse });
        return;
      }
      manquants.push(o.id || g || o.soustype || "?");
    });
    if (manquants.length) throw new Error("Éléments introuvables dans la banque de classe : " + manquants.join(", "));
    return out;
  }

  /* ---------- journal : combien de fois chaque question a été posée ---------- */
  // Même règle que la page de pilotage (pilotage/js/ev.js › poses) : un vote compte une fois par session,
  // un échauffement une fois par session (son dernier événement, une correction réécrit le même sid).
  function poses(classe) {
    var n = {}, vus = {}, ech = {};
    P.evenements().forEach(function (e) {
      if (!e || e.c !== classe) return;
      if (e.a === "vote") {
        var k = e.el + "|" + (e.sid || e.id);
        if (!vus[k]) { vus[k] = 1; n[e.el] = (n[e.el] || 0) + 1; }
      } else if (e.a === "echauffement" && Array.isArray(e.items)) {
        var s = e.sid || e.id;
        if (!ech[s] || e.t >= ech[s].t) ech[s] = e;
      }
    });
    Object.keys(ech).forEach(function (s) {
      ech[s].items.forEach(function (it) { if (it && it.id) n[it.id] = (n[it.id] || 0) + 1; });
    });
    return n;
  }
  function chaine(id) {                            // id, parent, grand-parent… (index.json)
    var parId = I.parId(), out = [], e = parId[id], garde = 0;
    while (e && garde++ < 20) { out.push(e.id); e = e.parent ? parId[e.parent] : null; }
    return out;
  }
  // 2 ou 3 QCM de compréhension pour une PAGE (une ou plusieurs sections), COHÉRENTS avec ce qui a été vu :
  // d'abord ceux du sous-arbre des sections de la page ; s'il y en a moins de 2, ceux des sections PRÉCÉDENTES
  // du même chapitre. Jamais une question sur une matière située plus loin dans le cours, ni d'un autre
  // chapitre : s'il n'y a rien, pas de bouton. Dans cette réserve : jamais posées à cette classe d'abord,
  // puis les moins posées ; à égalité, la plus proche de la page, puis l'ordre de la banque.
  function choisirComprehensionIds(sections, classe, nMax) {
    nMax = nMax || 3;
    var data = donnees; if (!data || !sections || !sections.length) return [];
    var n = poses(classe || P.classe());
    var niveaux = chaine(sections[0]);               // la section, ses parents… jusqu'au chapitre
    var chapitre = niveaux[niveaux.length - 1];
    var ix = I.index(), pos = {};
    (ix && ix.elements || []).forEach(function (e, i) { pos[e.id] = i; });
    var pMin = Infinity;
    sections.forEach(function (id) { if (pos[id] !== undefined && pos[id] < pMin) pMin = pos[id]; });
    var qcms = [];
    data.qcm.forEach(function (q, i) {
      if (q.usage !== "comprehension") return;
      var ch = chaine(q.sur);
      if (!ch.length) return;
      if (sections.some(function (id) { return ch.indexOf(id) >= 0; })) { qcms.push({ id: q.id, i: i, d: 0, p: pos[q.sur] }); return; }
      // même chapitre, matière située AVANT la page
      if (ch.indexOf(chapitre) >= 0 && pMin !== Infinity && pos[q.sur] !== undefined && pos[q.sur] < pMin)
        qcms.push({ id: q.id, i: i, d: 1, p: pos[q.sur] });
    });
    var reserve = qcms.filter(function (c) { return c.d === 0; });
    if (reserve.length < 2) reserve = qcms;
    return reserve.sort(function (a, b) {
      return ((n[a.id] || 0) - (n[b.id] || 0)) || (a.d - b.d) || ((b.p || 0) - (a.p || 0)) || (a.i - b.i);
    }).slice(0, nMax).map(function (c) { return c.id; });
  }
  function choisirComprehension(sectionId, classe, nMax) { return choisirComprehensionIds([sectionId], classe, nMax); }

  /* ---------- journal : écriture ---------- */
  function idSession() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function enregistrer(classe, el, action, extra) {
    var ok = I.ajouter(classe, el, action, extra);
    if (!ok) alerte("Journal non enregistré (stockage plein ou lecture seule).");
    return ok;
  }

  /* ---------- écran plein cadre commun ---------- */
  var courant = null, toastT = null;
  function alerte(msg) {
    var t = document.querySelector(".tv-toast");
    if (!t) { t = h("div", { "class": "tv-toast", role: "status" }); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 3200);
  }
  function pleinEcran() {
    var d = document.documentElement;
    if (document.fullscreenElement || !d.requestFullscreen) return;
    try {
      var p = d.requestFullscreen();
      if (p && p.then) p.then(function () { V.fs = true; }, function () {});
    } catch (e) {}
  }
  function finPleinEcran() {
    if (V.fs && document.fullscreenElement && document.exitFullscreen) { try { document.exitFullscreen(); } catch (e) {} }
    V.fs = false;
  }
  var verrou = null;
  function garderAllume() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (l) { verrou = l; }, function () {});
  }
  function relacher() { if (verrou) { try { verrou.release(); } catch (e) {} verrou = null; } }
  document.addEventListener("visibilitychange", function () {
    if (courant && document.visibilityState === "visible") garderAllume();
  });

  // Page fermée ou rechargée pendant un vote : ce qui peut l'être est écrit ; des votes comptés mais non
  // révélés déclenchent la confirmation du navigateur (sinon ils seraient perdus).
  window.addEventListener("pagehide", function () { if (courant && courant.sauver) { try { courant.sauver(); } catch (e) {} } });
  window.addEventListener("beforeunload", function (e) {
    if (courant && courant.aPerdre && courant.aPerdre()) { e.preventDefault(); e.returnValue = ""; return ""; }
  });
  function ouvrirEcran(cls, aria) {
    if (courant) courant.fermer();
    var precedent = document.activeElement;
    var el = h("div", { "class": "tv-ecran " + (cls || ""), role: "dialog", "aria-modal": "true", "aria-label": aria || "Écran de vote" });
    var sortie = bouton("", "tv-sortie-proj", function () { ecran.projeter(false); }, "Quitter le mode projeté");
    sortie.setAttribute("aria-label", "Quitter le mode projeté");
    el.appendChild(sortie);
    document.body.appendChild(el);
    document.documentElement.classList.add("tv-ouvert");
    garderAllume();
    var ecran = {
      el: el, touches: null, surFermeture: null, proj: false,
      projeter: function (oui) {
        ecran.proj = oui;
        el.classList.toggle("tv-proj", oui);
        if (oui) alerte("Mode projeté : touche le coin supérieur droit ou Échap pour revenir.");
        if (ecran.surProjection) ecran.surProjection(oui);
      },
      fermer: function () {
        if (courant !== ecran) return;
        courant = null;
        document.removeEventListener("keydown", cle, true);
        if (ecran.surFermeture) { try { ecran.surFermeture(); } catch (e) {} }
        el.remove();
        document.documentElement.classList.remove("tv-ouvert");
        relacher(); finPleinEcran();
        if (precedent && precedent.focus) { try { precedent.focus({ preventScroll: true }); } catch (e) {} }
      }
    };
    function cle(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var t = e.target && e.target.tagName;
      var champ = t === "INPUT" || t === "SELECT" || t === "TEXTAREA";
      if (e.key === "Escape") { if (ecran.proj) { ecran.projeter(false); e.preventDefault(); e.stopPropagation(); } return; }
      if (champ) return;
      if (ecran.touches && ecran.touches(e) === true) { e.preventDefault(); e.stopPropagation(); }
    }
    document.addEventListener("keydown", cle, true);
    courant = ecran;
    return ecran;
  }

  function message(titre, texteMsg, aria) {
    var ecran = ouvrirEcran("tv-message", aria || titre);
    ecran.el.appendChild(h("div", { "class": "tv-msg" }, [
      h("div", { "class": "tv-role", text: "Écran de vote" }),
      h("h1", { text: titre }),
      h("p", { text: texteMsg }),
      bouton("Fermer", "tv-primaire", function () { ecran.fermer(); })
    ]));
    return ecran;
  }

  /* ---------- votes par carte reçus du smartphone (P7) : QR lu par la caméra de la tablette, ou code tapé ---------- */
  var qrPret = null;
  function chargerQrVotes() {
    if (window.QrVotes) return Promise.resolve(window.QrVotes);
    if (!qrPret) qrPret = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = BASE + "qr-votes.js"; s.async = true;
      s.onload = function () { window.QrVotes ? res(window.QrVotes) : rej(new Error("qr-votes.js illisible")); };
      s.onerror = function () { qrPret = null; rej(new Error("qr-votes.js indisponible (hors ligne ?)")); };
      document.head.appendChild(s);
    });
    return qrPret;
  }
  // jsQR (Apache-2.0, fichier js/jsQR.js du site) lit les QR dans les navigateurs sans BarcodeDetector
  // (Firefox, Chrome/Chromium sous Linux ou Windows…). Chargé seulement si le navigateur n'a pas de lecteur natif.
  var jsqrPret = null;
  function chargerJsQr() {
    if (window.jsQR) return Promise.resolve(window.jsQR);
    if (!jsqrPret) jsqrPret = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = BASE + "jsQR.js"; s.async = true;
      s.onload = function () { window.jsQR ? res(window.jsQR) : rej(new Error("jsQR.js illisible")); };
      s.onerror = function () { jsqrPret = null; rej(new Error("Ce navigateur ne lit pas les QR et js/jsQR.js manque (voir doc/couche-prof.md) : tape le code affiché sous le QR (« Taper un code »).")); };
      document.head.appendChild(s);
    });
    return jsqrPret;
  }
  // Rend une fonction video → Promise(texte du QR | null) : lecteur natif si le navigateur en a un, sinon jsQR.
  function lecteurQr() {
    var natif = "BarcodeDetector" in window;
    var verif = !natif ? Promise.resolve(false)
      : Promise.resolve(window.BarcodeDetector.getSupportedFormats ? window.BarcodeDetector.getSupportedFormats() : ["qr_code"])
          .then(function (f) { return f.indexOf("qr_code") >= 0; }, function () { return false; });
    return verif.then(function (ok) {
      if (ok) {
        var det = new window.BarcodeDetector({ formats: ["qr_code"] });
        return function (video) { return det.detect(video).then(function (c) { return c && c.length ? c[0].rawValue : null; }); };
      }
      return chargerJsQr().then(function (jsQR) {
        var cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
        return function (video) {
          var w = video.videoWidth, h0 = video.videoHeight;
          if (!w || !h0) return Promise.resolve(null);
          var k = Math.min(1, 800 / w);
          cv.width = Math.round(w * k); cv.height = Math.round(h0 * k);
          cx.drawImage(video, 0, 0, cv.width, cv.height);
          var img = cx.getImageData(0, 0, cv.width, cv.height);
          var r = jsQR(img.data, cv.width, cv.height, { inversionAttempts: "dontInvert" });   // le QR du smartphone est noir sur blanc
          return Promise.resolve(r && r.data ? r.data : null);
        };
      });
    });
  }
  // Ouvre la caméra arrière, lit un QR (lecteur du navigateur, ou jsQR) et rend son texte. Rien n'est enregistré.
  // lireQr({ dans: élément }) : la caméra s'affiche dans cet élément (tiroir des cartes) au lieu du plein écran.
  function lireQr(opt) {
    var dans = opt && opt.dans;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return Promise.reject(new Error("Pas de caméra accessible (page en http ? caméra refusée ?) : tape le code affiché sous le QR (« Taper un code »)."));
    return lecteurQr()
      .then(function (lire) {
        return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" } } }).then(function (flux) {
          return { lire: lire, flux: flux };
        }, function (e) { throw new Error("Caméra refusée ou absente (" + ((e && e.name) || "erreur") + ") : tape le code affiché sous le QR (« Taper un code »)."); });
      })
      .then(function (o) {
        var flux = o.flux, lire = o.lire;
        return new Promise(function (res, rej) {
          var fini = false;
          var video = h("video", { "class": "tv-qr-video", playsinline: "", muted: "" });
          var fond = h("div", { "class": dans ? "tv-qr-dans" : "tv-qr", role: dans ? "group" : "dialog", "aria-label": "Lecture du QR des votes" }, [
            video, h("p", { text: "Vise le QR affiché par le smartphone." }),
            bouton("Annuler", dans ? "tv-lien" : "tv-primaire", function () { stop(); rej(new Error("lecture annulée")); })
          ]);
          function stop() { fini = true; flux.getTracks().forEach(function (t) { t.stop(); }); fond.remove(); }
          (dans || document.body).appendChild(fond);
          video.srcObject = flux; video.muted = true;
          video.play().catch(function () {});
          (function boucle() {
            if (fini) return;
            if (video.readyState < 2) { setTimeout(boucle, 150); return; }
            lire(video).then(function (texte) {
              if (fini) return;
              if (texte) { stop(); res(texte); } else setTimeout(boucle, 150);
            }, function () { setTimeout(boucle, 300); });
          })();
        });
      });
  }

  /* ---------- lancement ---------- */
  var scriptsPrets = null;
  function chargerScripts() {
    if (scriptsPrets) return scriptsPrets;
    function js(nom) {
      return new Promise(function (res) {
        var s = document.createElement("script");
        s.src = BASE + nom; s.async = false;
        s.onload = res; s.onerror = res;               // une erreur réseau se voit au « mode inconnu »
        document.head.appendChild(s);
      });
    }
    scriptsPrets = Promise.all([js("vote-comprehension.js"), js("vote-echauffement.js")]);
    return scriptsPrets;
  }
  // start({ mode: "comprehension" | "echauffement", items: […], titre, classe?, apres? })
  // Renvoie une promesse résolue quand l'écran est ouvert (rejetée si l'ouverture a échoué).
  function start(opts) {
    opts = opts || {};
    var mode = opts.mode || "comprehension";
    var classe = opts.classe || P.classe();
    if (!classe) {
      message("Choisis une classe", "Ouvre le bandeau en bas à gauche de la page et choisis la classe active.");
      return Promise.reject(new Error("pas de classe active"));
    }
    pleinEcran();                                      // doit suivre le geste de l'utilisateur
    return Promise.all([charger(), chargerScripts()]).then(function (r) {
      try { return [r[0], resoudre(opts.items, r[0])]; }
      catch (e) {                                      // copie de la banque plus ancienne que le tirage : on la relit
        if (navigator.onLine === false) throw e;
        return charger(true).then(function (d) { return [d, resoudre(opts.items, d)]; });
      }
    }).then(function (r) {
      var M = V.modes[mode];
      if (!M) throw new Error("mode inconnu : " + mode);
      var items = r[1];
      if (!items.length) throw new Error("aucun élément à poser");
      return M.ouvrir({ classe: classe, items: items, titre: opts.titre || "", data: r[0], apres: opts.apres, sid: idSession() });
    }).catch(function (e) {
      finPleinEcran();
      message("Impossible d'ouvrir l'écran", e && e.message ? e.message : String(e));
      throw e;
    });
  }

  /* ---------- points d'entrée dans le cours ---------- */
  var points = null, bulles = [], menuOuvert = null;
  function cibleDe(id) {
    var el = document.querySelector('[data-id="' + CSS.escape(id) + '"][data-type]');
    if (el) return el;
    var e = I.parId()[id], page = I.page();
    if (e && (e.type === "section" || e.type === "chapitre") && e.ancre.split("#")[0] === page) {
      return document.querySelector("h1.title, .quarto-title h1");
    }
    return null;
  }
  function titreSection(id) { var e = I.parId()[id]; return e ? String(e.titre || "").replace(/^Chapitre \d+\s*[—-]\s*/, "") : ""; }
  function fermerMenu() {
    if (menuOuvert) { if (menuOuvert._b) menuOuvert._b.setAttribute("aria-expanded", "false"); menuOuvert.remove(); menuOuvert = null; }
  }
  function poser(q) {
    fermerMenu();
    start({ mode: "comprehension", items: [q.id], titre: "" }).catch(function () {});
  }
  function ouvrirMenu(b, qs) {
    fermerMenu();
    var m = h("div", { "class": "tv-menu", role: "menu" });
    qs.forEach(function (q, i) {
      var t = String(q.enonce).replace(/\$/g, "").replace(/\s+/g, " ").slice(0, 70);
      m.appendChild(bouton((i + 1) + ". " + t, "tv-menu-item", function () { poser(q); }));
    });
    var r = b.getBoundingClientRect();
    m.style.top = (r.bottom + window.scrollY + 4) + "px";
    m.style.left = Math.max(8, r.right + window.scrollX - 300) + "px";
    m._b = b; b.setAttribute("aria-expanded", "true");
    points.appendChild(m); menuOuvert = m;
  }
  function majPoints() {
    if (!donnees || !I.index()) return;
    if (!points) {
      points = h("div", { "class": "tv-points" });
      document.body.appendChild(points);
      document.addEventListener("click", function (e) {
        if (menuOuvert && !e.target.closest(".tv-menu, .tv-pose")) fermerMenu();
      });
    }
    // 1. « Poser à la classe » près des éléments qui ont des QCM rattachés (champ `sur`)
    var parSur = {};
    donnees.qcm.forEach(function (q) { if (q.sur) (parSur[q.sur] = parSur[q.sur] || []).push(q); });
    var cles = Object.keys(parSur).filter(function (id) { return cibleDe(id); });
    var cle = cles.map(function (id) { return id + ":" + parSur[id].length; }).join("|");
    if (points._cle !== cle) {
      points._cle = cle; fermerMenu();
      Array.prototype.slice.call(points.querySelectorAll(".tv-pose")).forEach(function (b) { b.remove(); });
      bulles = cles.map(function (id) {
        var qs = parSur[id];
        var b = bouton(qs.length > 1 ? "Poser à la classe (" + qs.length + ")" : "Poser à la classe", "tv-pose", function () {
          if (qs.length === 1) poser(qs[0]);
          else if (menuOuvert && menuOuvert._b === b) fermerMenu();      // un second clic referme le menu
          else ouvrirMenu(b, qs);
        });
        b.setAttribute("data-sur", id);
        b.setAttribute("aria-haspopup", qs.length > 1 ? "menu" : "dialog");
        points.appendChild(b);
        return { id: id, b: b };
      });
    }
    positionner();
    // 2. « Tester la compréhension » à la place de « S'autoévaluer » en fin de section
    majTest();
  }
  function positionner() {
    if (!points) return;
    var sx = window.scrollX, sy = window.scrollY;
    bulles.forEach(function (o) {
      var cible = cibleDe(o.id), r = cible && cible.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) { o.b.style.display = "none"; return; }
      o.b.style.display = "";
      var w = o.b.offsetWidth, hb = o.b.offsetHeight;
      o.b.style.left = Math.max(4, r.right + sx - w - 12) + "px";
      o.b.style.top = (r.bottom + sy - hb / 2) + "px";
    });
  }
  // Toutes les sections (et le chapitre) dont la page est la page courante.
  function sectionsDePage() {
    var idx = I.index(), page = I.page(), out = [];
    if (!idx) return out;
    idx.elements.forEach(function (e) {
      if ((e.type === "section" || e.type === "chapitre") && e.ancre.split("#")[0] === page) out.push(e.id);
    });
    return out;
  }
  function titrePage(ids) { return ids.length ? titreSection(ids[0]) : ""; }
  // « Tester la compréhension » : un bouton À CÔTÉ de « S'autoévaluer » (qui reste celui des élèves, à la maison),
  // en fin de chaque page qui a une autoévaluation. Posé à la classe, avec les cartes.
  function majTest() {
    var blocs = document.querySelectorAll(".ae-lien");
    if (!blocs.length) return;
    var classe = P.classe(), ids = sectionsDePage();
    var qs = classe && ids.length ? choisirComprehensionIds(ids, classe) : [];
    Array.prototype.forEach.call(blocs, function (bloc) {
      var ligne = bloc.querySelector(".tv-test-ligne");
      if (!ligne) { ligne = h("p", { "class": "tv-test-ligne" }); bloc.appendChild(ligne); }
      // En mode prof, le lien « S'autoévaluer » des élèves est masqué (vote.css) : cette ligne est seule.
      if (!qs.length) {
        ligne.textContent = "";
        ligne.appendChild(h("span", { "class": "tv-test-vide" }));
        ligne.firstChild.textContent = classe ? "Aucune question de compréhension pour cette page dans la banque de classe."
                                              : "Choisis la classe active pour tester la compréhension.";
        return;
      }
      if (!ligne.firstChild || ligne.firstChild.tagName !== "A") {
        ligne.textContent = "";
        ligne.appendChild(h("a", { "class": "tv-test-btn", href: "#", role: "button" }));
      }
      var a = ligne.firstChild;
      a.textContent = "✔ Tester la compréhension en classe : " + qs.length + " question" + (qs.length > 1 ? "s" : "") + " →";
    });
  }
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a.tv-test-btn");
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var ids = sectionsDePage(), classe = P.classe();
    var qs = choisirComprehensionIds(ids, classe);
    if (!qs.length) return;
    start({ mode: "comprehension", items: qs, titre: titrePage(ids) }).catch(function () {});
  }, true);

  /* ---------- lanceur de test de l'échauffement (remplacé par la page de pilotage, P4) ---------- */
  function lancerTest() {
    return charger().then(function (data) {
      var qcm = data.qcm.filter(function (q) { return q.usage === "echauffement"; }).slice(0, 2).map(function (q) { return q.id; });
      var lots = (data.exercices && data.exercices.lots) || [];
      var items = qcm.slice();
      if (lots.length) {
        var lot = lots[0], v = lot.variantes[Math.floor(Math.random() * lot.variantes.length)];
        items.push({ graine: v.graine, role: "algebre" });
      }
      return start({ mode: "echauffement", items: items, titre: "Échauffement (test)" });
    }).catch(function (e) { message("Impossible d'ouvrir l'écran", e && e.message ? e.message : String(e)); });
  }
  function lanceurTest() {
    var panneau = document.querySelector(".tw-prof-panneau");
    if (!panneau || panneau.querySelector(".tv-test")) return;
    var b = bouton("Tester l'échauffement", "tw-prof-btn tv-test", function () { lancerTest(); },
                   "Lanceur de test : 2 QCM et 1 exercice d'algèbre de la banque de classe");
    panneau.insertBefore(b, panneau.querySelector(".tw-prof-btn"));
  }

  /* ---------- API et démarrage ---------- */
  V.u = { h: h, bouton: bouton, md: md, composer: composer, esc: esc, ouvrirEcran: ouvrirEcran, alerte: alerte,
          enregistrer: enregistrer, LETTRES: LETTRES, idSession: idSession, lireQr: lireQr, chargerQrVotes: chargerQrVotes };
  V.start = start;
  V.donnees = charger;
  // Ajoute la banque d'une autre UAA (objet ou texte de classe.json) pour que start() y retrouve ses éléments
  // (révision espacée de l'échauffement). Sans effet sur « Poser à la classe » ni « Tester la compréhension ».
  V.ajouterBanque = function (banque) {
    var txt = typeof banque === "string" ? banque : JSON.stringify(banque);
    var b = indexer(analyser(txt));
    if (UAA && b.uaa === UAA) {                        // banque de CE cours (plus fraîche que la copie) : elle la remplace
      donnees = b; memo = Promise.resolve(b); ecrireCache(txt); replanifier();
      return true;
    }
    Object.keys(b._qcm).forEach(function (k) { supplement.qcm[k] = b._qcm[k]; });
    Object.keys(b._ex).forEach(function (k) { supplement.ex[k] = b._ex[k]; });
    return true;
  };
  V.choisirComprehension = function (sectionId, classe, nMax) { return choisirComprehension(sectionId, classe, nMax); };
  V.choisirComprehensionPage = function (classe, nMax) { return choisirComprehensionIds(sectionsDePage(), classe, nMax); };
  V.poses = poses;
  V.md = md;
  V.fermer = function () { if (courant) courant.fermer(); };
  V.ouvert = function () { return !!courant; };
  // Votes par numéro de carte (P7). Sans effet hors du mode compréhension : renvoie { ok: false, erreur }.
  //   recevoirCartes({ "12": "B", … } | [[12, "B"], …] | [{ numero: 12, reponse: "B" }, …], { mode: "remplacer" | "fusionner" })
  //     → { ok: true, recues, total, remplace, refuses } : remplace le détail par carte de la question affichée (ou le complète)
  //       et recalcule les compteurs ; les entrées invalides sont listées dans `refuses`.
  //   cartes() → { "numéro": "lettre" } de la question affichée (vide si aucun écran de vote détaillé n'est ouvert).
  V.recevoirCartes = function (entree, opt) {
    if (!courant || !courant.recevoirCartes) return { ok: false, erreur: "aucun vote détaillé ouvert (mode compréhension)" };
    return courant.recevoirCartes(entree, opt);
  };
  V.cartes = function () { return courant && courant.cartes ? courant.cartes() : {}; };
  V.lancerTest = lancerTest;
  P.vote = V;

  var planifie = false;
  function replanifier() {
    if (planifie) return;
    planifie = true;
    requestAnimationFrame(function () { planifie = false; majPoints(); majEtat(); });
  }
  P.abonner(replanifier);
  window.addEventListener("resize", function () { positionner(); fermerMenu(); });
  window.addEventListener("load", function () { [0, 1000, 3000].forEach(function (t) { setTimeout(replanifier, t); }); });
  if (window.ResizeObserver) { try { new ResizeObserver(function () { positionner(); }).observe(document.body); } catch (e) {} }

  // État affiché dans le panneau du bandeau prof : sans classe choisie ou sans banque, le lien « S'autoévaluer »
  // reste celui des élèves sans rien dire ; cette ligne dit pourquoi.
  var erreurBanque = "";
  function majEtat() {
    var panneau = document.querySelector(".tw-prof-panneau"); if (!panneau) return;
    var d = panneau.querySelector(".tv-etat");
    if (!d) { d = h("div", { "class": "tv-etat" }); panneau.insertBefore(d, panneau.firstChild); }
    var txt, ok = false, classe = P.classe();
    if (erreurBanque) txt = "Banque de classe indisponible : " + erreurBanque;
    else if (!donnees) txt = "Banque de classe : chargement…";
    else if (!classe) txt = "Choisis la classe active (menu ci-dessus) : « Tester la compréhension » n'apparaît que pour une classe.";
    else {
      var nc = donnees.qcm.filter(function (q) { return q.usage === "comprehension"; }).length;
      txt = "Banque de classe : " + nc + " QCM de compréhension pour " + classe + ". « Tester la compréhension » remplace « S'autoévaluer » en fin de section."; ok = true;
    }
    d.textContent = txt; d.className = "tv-etat" + (ok ? " ok" : "");
  }
  function demarrer() {
    document.documentElement.classList.add("tv-mode-prof");      // masque « S'autoévaluer » (vote.css) : en mode prof, seul le test de compréhension
    var css = document.createElement("link");
    css.rel = "stylesheet"; css.href = BASE + "vote.css";
    document.head.appendChild(css);
    lanceurTest();
    chargerScripts();                                  // les deux modes en mémoire : fonctionne ensuite sans réseau
    charger().then(function () { erreurBanque = ""; replanifier(); },
                   function (e) { erreurBanque = (e && e.message) || "erreur inconnue"; majEtat(); });   // banque absente : pas de bouton ; la raison est dans le panneau
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
