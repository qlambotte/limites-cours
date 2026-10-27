/* ============================================================
   prof.js — couche prof (P1) : marquage ✓ « vu en classe ».
   Chargée seulement si localStorage["typweb.prof"] === "1" (voir
   le chargeur de _includes/scripts.html). Aucun élève ne la voit.
   Documentation : typweb/doc/couche-prof.md

   - clic / tap sur un encadré ou un exercice : ✓ dans la marge droite ;
     second clic : retiré ;
   - journal d'événements en ajout seulement (localStorage, clé
     « typweb.prof.v1 ») ; l'état affiché = dernier événement par
     (classe, élément) ;
   - rien n'est ajouté à la structure de la page (classes CSS seulement),
     hormis le bandeau, dernier enfant de <body>.
   ============================================================ */
(function () {
  "use strict";
  if (window.typwebProf) return;

  var CLE = "typweb.prof.v1";
  var CLE_CLASSE = "typweb.classe";
  var CLE_DRAPEAU = "typweb.prof";
  var SCHEMA = 2;               // 2 : événements vote / echauffement / exercice (doc/couche-prof.md)
  var MARQUABLES = { definition: 1, propriete: 1, remarque: 1, exemple: 1, activite: 1, exercice: 1 };
  var SELECTEUR = "[data-id][data-type]";
  // Zones où un clic ne marque pas (liens, boutons, champs, réponses cachées,
  // indices/solutions, QCM d'autoévaluation, figures interactives, la couche elle-même).
  var IGNORER = "a, button, input, select, textarea, label, summary, [role=button], [contenteditable], " +
                "[data-bs-toggle], .rep, .rep-bloc, .aides, .panel-tabset, .solution-classe, .ae-q, " +
                ".lim-plot, .tw-prof";
  var ANTI_REBOND = 350;    // ms : un double tap ne bascule pas deux fois

  /* ---------- chemins : prof.css et prof-config.json sont à côté de prof.js ---------- */
  var script = document.currentScript;
  var BASE = script && script.src ? script.src.replace(/[^\/]*$/, "") : "";
  var RACINE = (function () {                       // racine du site
    try { return new URL(window.SITE_OFFSET || "", location.href); } catch (e) { return new URL(".", location.href); }
  })();
  var UAA = (window.TYPWEB && window.TYPWEB.uaa) || "";

  function lien(href) {
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    document.head.appendChild(l);
  }
  if (BASE) lien(BASE + "prof.css");

  /* ---------- stockage ---------- */
  var erreurStockage = "";
  var lectureSeule = false;
  var abonnes = [];

  function lire() {
    var brut = null, j;
    try { brut = localStorage.getItem(CLE); } catch (e) { erreurStockage = "stockage local inaccessible"; return []; }
    if (!brut) return [];
    try { j = JSON.parse(brut); } catch (e) {
      // journal illisible : on le garde tel quel dans une clé de secours, on repart à vide
      try { if (!localStorage.getItem(CLE + ".corrompu")) localStorage.setItem(CLE + ".corrompu", brut); } catch (e2) {}
      erreurStockage = "journal illisible (copie de secours conservée)";
      return [];
    }
    if (!j || typeof j !== "object" || !Array.isArray(j.ev)) { erreurStockage = "journal de format inconnu"; lectureSeule = true; return []; }
    if (j.v > SCHEMA) { lectureSeule = true; erreurStockage = "journal d'une version plus récente (lecture seule)"; }
    return j.ev;
  }
  function ecrire(ev) {
    try { localStorage.setItem(CLE, JSON.stringify({ v: SCHEMA, ev: ev })); return true; }
    catch (e) { erreurStockage = "écriture impossible (stockage plein ?)"; return false; }
  }
  function idEvenement() {
    var a = "";
    try { var u = new Uint32Array(2); crypto.getRandomValues(u); a = u[0].toString(36) + u[1].toString(36); }
    catch (e) { a = Math.random().toString(36).slice(2, 12); }
    return Date.now().toString(36) + "-" + a;
  }
  // Identifiant d'appareil (P5) : fixé à la configuration de la synchronisation ; sert à départager deux
  // événements simultanés au moment de la fusion. Absent tant que la synchronisation n'est pas configurée.
  function appareilId() {
    try { var j = JSON.parse(localStorage.getItem("typweb.sync.v1") || "null"); return j && typeof j.appareil === "string" ? j.appareil : ""; }
    catch (e) { return ""; }
  }
  function ajouter(classe, el, action, extra) {
    if (lectureSeule || !classe || !el) return false;
    var ev = lire();                                   // relire juste avant d'écrire (autres onglets)
    if (lectureSeule) return false;
    // Horodatage « causal » : un geste est toujours daté après tout événement déjà connu sur le même
    // (classe, élément), même si celui-ci vient d'un appareil dont l'horloge avance (P5).
    var t = Date.now(), i;
    for (i = 0; i < ev.length; i++) if (ev[i] && ev[i].c === classe && ev[i].el === el && ev[i].t >= t) t = ev[i].t + 1;
    var e = { id: idEvenement(), t: t, c: classe, el: el, a: action }, d = appareilId();
    if (d) e.d = d;
    if (extra) Object.keys(extra).forEach(function (k) { if (!(k in e)) e[k] = extra[k]; });
    ev.push(e);
    var ok = ecrire(ev);
    if (ok) notifier();
    return ok;
  }
  // Ordre total des événements, identique sur tous les appareils : (t, appareil, id), comparaison de chaînes
  // par points de code (pas de localeCompare : son résultat dépend de la langue du navigateur).
  function cmpEv(a, b) {
    var da = String(a.d || ""), db = String(b.d || "");
    return a.t - b.t || (da < db ? -1 : da > db ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  function jourDe(t) {                                 // AAAA-MM-JJ, heure locale de l'appareil
    var d = new Date(t), m = d.getMonth() + 1, j = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (j < 10 ? "0" : "") + j;
  }

  /* ---------- classe active ---------- */
  var classes = [], effectifs = {};
  var EFFECTIF_DEFAUT = 24;
  // effectif de la classe (prof-config.json, champ « effectif »), sinon valeur par défaut
  function effectif(classe) {
    var n = effectifs[classe || classeActive()];
    return n > 0 ? n : EFFECTIF_DEFAUT;
  }
  // Classes et effectifs fournis par la page de pilotage (P4) : le site et les notes ne dépendent pas des
  // classes. Quand cette liste existe, elle remplace celle de prof-config.json (qui reste un repli).
  var CLE_CLASSES = "typweb.prof.classes";
  function classesLocales() {
    var brut = null;
    try { brut = localStorage.getItem(CLE_CLASSES); } catch (e) { return null; }
    if (!brut) return null;
    try { var j = JSON.parse(brut); return Array.isArray(j) ? j : null; } catch (e) { return null; }
  }
  function appliquerClassesLocales() {
    var l = classesLocales();
    if (!l) return false;
    classes = []; effectifs = {};
    l.forEach(function (c) {
      var code = String(c && typeof c === "object" ? c.code : c);
      classes.push(code);
      if (c && typeof c === "object" && c.effectif > 0) effectifs[code] = Math.round(c.effectif);
    });
    return true;
  }
  // liste : [{ code, effectif? }] ou [code]. Écrit dans le stockage local de l'appareil.
  function definirClasses(liste) {
    if (!Array.isArray(liste)) return false;
    var propre = liste.map(function (c) {
      return c && typeof c === "object" ? { code: String(c.code), effectif: c.effectif > 0 ? Math.round(c.effectif) : undefined } : { code: String(c) };
    });
    try { localStorage.setItem(CLE_CLASSES, JSON.stringify(propre)); } catch (e) { return false; }
    appliquerClassesLocales();
    notifier();
    return true;
  }
  function classeActive() {
    try { return localStorage.getItem(CLE_CLASSE) || ""; } catch (e) { return ""; }
  }
  function fixerClasse(c) {
    try { if (c) localStorage.setItem(CLE_CLASSE, c); else localStorage.removeItem(CLE_CLASSE); } catch (e) {}
    notifier();
  }

  /* ---------- état dérivé du journal ---------- */
  // { élément: { t, jour } } pour les éléments actuellement « vu » dans la classe
  // Dernier événement « vu » / « annule » par élément, selon (t, appareil, id), quel que soit l'ordre du tableau.
  // Un « annule » qui porte `ref` annule CE « vu » seulement (erreur de clic sur un élément revu : la marque
  // d'une séance précédente réapparaît) ; un « annule » sans `ref` (ancien format, API annuler) retire l'élément.
  function derniers(ev, classe) {
    var dernier = {}, annules = {}, i, e;
    for (i = 0; i < ev.length; i++) { e = ev[i]; if (e && e.c === classe && e.a === "annule" && e.ref) annules[e.ref] = 1; }
    for (i = 0; i < ev.length; i++) {
      e = ev[i];
      if (!e || e.c !== classe || (e.a !== "vu" && e.a !== "annule")) continue;
      if (e.a === "annule" && e.ref) continue;
      if (e.a === "vu" && annules[e.id]) continue;
      if (!dernier[e.el] || cmpEv(e, dernier[e.el]) > 0) dernier[e.el] = e;
    }
    return dernier;
  }
  function etat(classe) {
    classe = classe || classeActive();
    var out = {}, dernier = derniers(lire(), classe);
    Object.keys(dernier).forEach(function (el) {
      if (dernier[el].a === "vu") out[el] = { t: dernier[el].t, jour: jourDe(dernier[el].t) };
    });
    return out;
  }
  function dansCours(id, prefixe) { return !prefixe || id.indexOf(prefixe + ".") === 0; }
  // Point d'arrêt : l'élément vu le plus AVANCÉ dans le cours (ordre de index.json) ; revoir une définition
  // d'un chapitre précédent ne fait donc pas reculer la reprise. Sans index : le plus récent.
  function dernierMarque(classe, prefixe) {
    var s = etat(classe), best = null, pos = positions();
    Object.keys(s).forEach(function (el) {
      if (!dansCours(el, prefixe)) return;
      var p = pos ? (pos[el] === undefined ? -1 : pos[el]) : 0;
      if (!best || p > best.p || (p === best.p && s[el].t >= best.t)) best = { el: el, t: s[el].t, p: p };
    });
    return best ? { el: best.el, t: best.t } : null;
  }
  function seance(classe, jour, prefixe) {
    jour = jour || jourDe(Date.now());
    var s = etat(classe);
    return Object.keys(s).filter(function (el) { return s[el].jour === jour && dansCours(el, prefixe); })
      .sort(function (a, b) { return s[a].t - s[b].t; });
  }

  /* ---------- index du cours (sections « vues », total, reprise entre pages) ---------- */
  var index = null, enfants = {}, parId = {};
  function chargerIndex() {
    var url = window.TYPWEB && window.TYPWEB.index;
    if (!url) return Promise.resolve(null);
    return fetch(url, { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !Array.isArray(j.elements)) return null;
        index = j; enfants = {}; parId = {}; pos = null;
        j.elements.forEach(function (e) {
          parId[e.id] = e;
          if (e.parent) (enfants[e.parent] = enfants[e.parent] || []).push(e.id);
        });
        return j;
      }).catch(function () { return null; });
  }
  var pos = null;
  function positions() {                              // { id: rang dans index.json } ou null
    if (!index) return null;
    if (!pos) { pos = {}; index.elements.forEach(function (e, i) { pos[e.id] = i; }); }
    return pos;
  }
  function marquableIndex(e) {
    return !!MARQUABLES[e.type] && (e.etiquettes || []).indexOf("maison") < 0;
  }
  function totalCours() {
    return index ? index.elements.filter(marquableIndex).length : null;
  }
  // { section: true } pour les sections / chapitres dont tous les éléments marquables sont vus
  function sections(classe) {
    var out = {};
    if (!index) return out;
    var s = etat(classe), memo = {};
    function bilan(id) {                              // [vus, total] sous id
      if (memo[id]) return memo[id];
      var e = parId[id], v = 0, n = 0;
      (enfants[id] || []).forEach(function (f) {
        var fe = parId[f];
        if (marquableIndex(fe)) { n++; if (s[f]) v++; }
        else if (fe.type === "section" || fe.type === "chapitre") { var b = bilan(f); v += b[0]; n += b[1]; }
      });
      return (memo[id] = [v, n]);
    }
    index.elements.forEach(function (e) {
      if (e.type !== "section" && e.type !== "chapitre") return;
      var b = bilan(e.id);
      if (b[1] > 0 && b[0] === b[1]) out[e.id] = true;
    });
    return out;
  }

  /* ---------- éléments marquables de la page ---------- */
  function etiquettes(el) { return (el.getAttribute("data-tags") || "").split(/\s+/); }
  function marquable(el) {
    return !!MARQUABLES[el.getAttribute("data-type")] && etiquettes(el).indexOf("maison") < 0;
  }
  function elementsPage() {
    return Array.prototype.filter.call(document.querySelectorAll(SELECTEUR), marquable);
  }
  function pageCourante() {                           // chemin relatif à la racine du site
    var p = location.pathname, r = RACINE.pathname;
    p = p.indexOf(r) === 0 ? p.slice(r.length) : p;
    return p === "" || p.slice(-1) === "/" ? p + "index.html" : p;
  }

  /* ---------- rendu ---------- */
  var bandeau = null;
  function rendre() {
    var classe = classeActive(), s = classe ? etat(classe) : {}, auj = jourDe(Date.now());
    var els = elementsPage();
    els.forEach(function (el) {
      var v = s[el.getAttribute("data-id")];
      el.classList.add("tw-m");
      el.classList.toggle("tw-vu", !!v);
      el.classList.toggle("tw-vu-ancien", !!v && v.jour !== auj);
    });
    // section de la page : ✓ à côté du titre quand tout est vu
    var titre = document.querySelector("h1.title, .quarto-title h1");
    if (titre) {
      var vue = false;
      if (index && classe) {
        var sec = sections(classe), page = pageCourante();
        index.elements.forEach(function (e) {
          if ((e.type === "section" || e.type === "chapitre") && e.ancre.split("#")[0] === page && sec[e.id]) vue = true;
        });
      }
      titre.classList.toggle("tw-section-vue", vue);
    }
    aligner(els);
    majBandeau(els.length, s);
  }

  // ✓ dans la marge, centré sur l'en-tête (titre) de l'encadré ; si la marge est trop
  // étroite pour le contenir, il rentre dans l'en-tête (classe tw-marge-etroite).
  var LARG = 28, ECART = 8;
  function aligner(els) {
    var gapMin = Infinity, vw = document.documentElement.clientWidth;
    els.forEach(function (el) {
      var cs = getComputedStyle(el), r = parseFloat(cs.borderTopLeftRadius) || 0;
      el.style.setProperty("--tw-rl", Math.max(r - parseFloat(cs.borderLeftWidth), 0) + "px");
      el.style.setProperty("--tw-rr", Math.max(r - parseFloat(cs.borderRightWidth), 0) + "px");
      el.style.setProperty("--tw-rt", Math.max(r - parseFloat(cs.borderTopWidth), 0) + "px");
      el.style.setProperty("--tw-rb", Math.max(r - parseFloat(cs.borderBottomWidth), 0) + "px");
      var tete = el.querySelector(":scope > .theo-head, :scope > .exo-tete");
      if (tete) el.style.setProperty("--tw-top", Math.round(tete.offsetTop + tete.offsetHeight / 2 - LARG / 2) + "px");
      gapMin = Math.min(gapMin, vw - el.getBoundingClientRect().right);
    });
    if (els.length) document.documentElement.classList.toggle("tw-marge-etroite", gapMin < LARG + ECART + 6);
  }
  window.addEventListener("resize", function () { rendre(); });
  window.addEventListener("load", function () { [0, 1000, 3000].forEach(function (t) { setTimeout(rendre, t); }); });

  /* ---------- bandeau ---------- */
  function noeud(tag, cls, txt) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt !== undefined) n.textContent = txt;
    return n;
  }
  function construireBandeau() {
    bandeau = noeud("div", "tw-prof");
    bandeau.setAttribute("role", "region");
    bandeau.setAttribute("aria-label", "Couche prof");
    var puce = noeud("button", "tw-prof-puce");
    puce.type = "button"; puce.setAttribute("aria-expanded", "false");
    var panneau = noeud("div", "tw-prof-panneau");
    panneau.hidden = true;
    var sel = noeud("select", "tw-prof-classe");
    sel.setAttribute("aria-label", "Classe active");
    var compteur = noeud("div", "tw-prof-compteur");
    var etatTxt = noeud("div", "tw-prof-etat");
    var bOff = noeud("button", "tw-prof-btn", "Mode prof : off");
    bOff.type = "button"; bOff.title = "Désactiver le mode prof sur cet appareil";
    var bExp = noeud("button", "tw-prof-btn", "Exporter les marques");
    bExp.type = "button";
    var syncTxt = noeud("div", "tw-prof-sync"); syncTxt.hidden = true;
    var bSync = noeud("button", "tw-prof-btn", "Synchroniser"); bSync.type = "button"; bSync.hidden = true;
    bSync.addEventListener("click", function () { if (window.typwebSync) window.typwebSync.synchroniser(); });
    panneau.appendChild(sel); panneau.appendChild(compteur); panneau.appendChild(etatTxt);
    panneau.appendChild(syncTxt); panneau.appendChild(bSync);
    // Sonomètre (P8) : le module n'est chargé qu'au premier clic ; sonometre.js met à jour ce bouton
    var bSon = noeud("button", "tw-prof-btn", "Sonomètre : arrêté ▶");
    bSon.type = "button"; bSon.setAttribute("data-outil", "sonometre");
    bSon.title = "Marche / arrêt du sonomètre de classe (touche S)";
    bSon.addEventListener("click", function () { surSonometre(function (s) { s.basculer(); }); });
    var bSonReg = noeud("button", "tw-prof-btn", "Réglages du sonomètre");
    bSonReg.type = "button";
    bSonReg.addEventListener("click", function () { surSonometre(function (s) { s.ouvrirReglages(true); }); });
    panneau.appendChild(bSon); panneau.appendChild(bSonReg);
    panneau.appendChild(bExp); panneau.appendChild(bOff);
    bandeau.appendChild(puce); bandeau.appendChild(panneau);
    puce.addEventListener("click", function () { ouvrirBandeau(panneau.hidden); });
    sel.addEventListener("change", function () { fixerClasse(sel.value); });
    bOff.addEventListener("click", function () {
      try { localStorage.removeItem(CLE_DRAPEAU); } catch (e) {}
      location.reload();
    });
    bExp.addEventListener("click", exporter);
    var alerte = noeud("div", "tw-prof-avis"); alerte.hidden = true; alerte.setAttribute("role", "status");
    bandeau.appendChild(alerte);
    bandeau._r = { puce: puce, panneau: panneau, sel: sel, compteur: compteur, etat: etatTxt, sync: syncTxt, bSync: bSync, alerte: alerte };
    document.body.appendChild(bandeau);
  }
  function ouvrirBandeau(oui) {
    if (!bandeau) return;
    var r = bandeau._r;
    r.panneau.hidden = !oui;
    r.puce.setAttribute("aria-expanded", oui ? "true" : "false");
  }
  function majBandeau(nbPage, s) {
    if (!bandeau) return;
    var r = bandeau._r, classe = classeActive();
    // liste des classes (+ la classe active si elle n'est pas dans la configuration)
    var liste = classes.slice();
    if (classe && liste.indexOf(classe) < 0) liste.push(classe);
    var cle = liste.join("|") + "#" + classe;
    if (r.sel._cle !== cle) {
      r.sel._cle = cle;
      r.sel.textContent = "";
      var o0 = noeud("option", "", "— classe —"); o0.value = ""; r.sel.appendChild(o0);
      liste.forEach(function (c) { var o = noeud("option", "", c); o.value = c; r.sel.appendChild(o); });
      r.sel.value = classe;
    }
    var n = Object.keys(s).filter(function (id) { return dansCours(id, UAA); }).length;
    var tot = totalCours();
    r.compteur.textContent = "✓ " + n + (tot ? " / " + tot : "");
    r.puce.textContent = "✓ " + n + (classe ? " · " + classe : " · ?");
    var msg = "";
    if (erreurStockage) msg = erreurStockage;
    else if (!classe) msg = "Choisis une classe pour marquer.";
    else if (nbPage === 0) msg = "Aucun élément marquable sur cette page.";
    r.etat.textContent = msg;
    r.etat.hidden = !msg;
  }
  // État de la synchronisation dans le panneau (rien tant qu'aucun jeton n'est configuré sur l'appareil).
  function majSync() {
    if (!bandeau) return;
    var r = bandeau._r, st = window.typwebSync && window.typwebSync.statut ? window.typwebSync.statut() : null;
    var actif = !!st && st.etat !== "inactif";
    r.sync.hidden = r.bSync.hidden = !actif;
    if (actif) { r.sync.textContent = st.texte; r.sync.setAttribute("data-etat", st.etat); }
  }
  function objetExport() {
    return { format: "typweb.prof.v1", exporte: new Date().toISOString(), v: SCHEMA, ev: lire() };
  }
  // Fusionne un export (objet ou texte JSON) dans le journal : événements réunis, dédoublonnés par id,
  // triés par (t, id). Ne supprime rien. Renvoie { ok, ajoutes, ignores } ou { ok: false, erreur }.
  function importer(source) {
    var obj = source;
    if (typeof source === "string") { try { obj = JSON.parse(source); } catch (e) { return { ok: false, erreur: "fichier illisible (JSON invalide)" }; } }
    if (!obj || typeof obj !== "object" || !Array.isArray(obj.ev) || (obj.format && obj.format !== "typweb.prof.v1"))
      return { ok: false, erreur: "fichier non reconnu : un export de marques typweb est attendu" };
    if (obj.v > SCHEMA) return { ok: false, erreur: "export d'une version plus récente de la couche prof (v" + obj.v + ")" };
    var cur = lire();
    if (lectureSeule) return { ok: false, erreur: "journal en lecture seule (" + erreurStockage + ")" };
    var connus = {}, ajoutes = 0, ignores = 0;
    cur.forEach(function (e) { if (e && e.id) connus[e.id] = 1; });
    obj.ev.forEach(function (e) {
      var bon = e && typeof e.id === "string" && typeof e.t === "number" && typeof e.c === "string" &&
                typeof e.el === "string" && typeof e.a === "string";
      if (!bon || connus[e.id]) { ignores++; return; }
      connus[e.id] = 1; cur.push(e); ajoutes++;
    });
    if (ajoutes) {
      cur.sort(cmpEv);                                    // (t, appareil, id) : même ordre sur tous les appareils
      if (!ecrire(cur)) return { ok: false, erreur: erreurStockage };
      notifier();
    }
    return { ok: true, ajoutes: ajoutes, ignores: ignores };
  }
  function exporter() {
    var charge = JSON.stringify(objetExport(), null, 1);
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([charge], { type: "application/json" }));
    a.download = "marques-typweb-" + jourDe(Date.now()) + ".json";
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- clic / tap ---------- */
  var dernierClic = { el: null, t: 0 };
  // Un tap qui ne fait que dissiper une sélection ne marque pas : le navigateur
  // l'efface avant le « click », on retient donc l'état au « pointerdown ».
  var selAvant = false;
  function selectionNonVide() { var s = window.getSelection && window.getSelection(); return !!s && String(s).length > 0; }
  window.addEventListener("pointerdown", function () { selAvant = selectionNonVide(); }, true);
  function surClic(ev) {
    if (ev.defaultPrevented || ev.button > 0) return;
    var t = ev.target;
    if (!t || !t.closest) return;
    var cible = t.closest(SELECTEUR);
    if (!cible || !marquable(cible)) return;
    var interdit = t.closest(IGNORER);
    if (interdit && (cible.contains(interdit) || interdit === cible)) return;
    if (selAvant || selectionNonVide()) { selAvant = false; return; }   // sélection en cours
    if (document.documentElement.dataset.annot) return;           // outil d'annotation actif
    var classe = classeActive();
    if (!classe) { ouvrirBandeau(true); return; }
    var id = cible.getAttribute("data-id"), now = Date.now();
    if (dernierClic.el === cible && now - dernierClic.t < ANTI_REBOND) return;
    dernierClic = { el: cible, t: now };
    var v = etat(classe)[id];
    // pas encore vu, ou vu à une séance précédente : on (re)marque pour aujourd'hui ;
    // vu aujourd'hui : on retire (erreur de clic)
    if (v && v.jour === jourDe(now)) {
      var d = derniers(lire(), classe)[id];
      ajouter(classe, id, "annule", d && d.a === "vu" ? { ref: d.id } : null);
    } else ajouter(classe, id, "vu");
  }

  /* ---------- reprise du cours (?reprise=1) ---------- */
  function trouver(id) {
    return document.querySelector(SELECTEUR.replace("[data-id]", '[data-id="' + CSS.escape(id) + '"]'));
  }
  function surbrillance(el) {
    el.classList.add("tw-reprise");
    setTimeout(function () { el.classList.remove("tw-reprise"); }, 2500);
  }
  function reprise() {
    if (new URLSearchParams(location.search).get("reprise") !== "1") return;
    reprendre();
  }
  // Va au dernier élément marqué de la classe active (ou le rejoint sur sa page).
  // Renvoie false s'il n'y a rien à reprendre.
  function reprendre() {
    var p = new URLSearchParams(location.search);
    var classe = classeActive();
    if (!classe) { ouvrirBandeau(true); return false; }
    var d = dernierMarque(classe, UAA);
    if (!d) return false;
    p.delete("reprise");
    var q = p.toString();
    try { history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash); } catch (e) {}
    var el = trouver(d.el);
    if (el) {
      var bouge = false;
      var marque = function () { bouge = true; };
      ["wheel", "touchstart", "keydown"].forEach(function (n) { window.addEventListener(n, marque, { passive: true, once: true }); });
      var aller = function () { if (!bouge) el.scrollIntoView({ block: "center" }); };
      aller(); surbrillance(el);
      setTimeout(aller, 1200);                                    // après la mise en page de MathJax
      return true;
    }
    // l'élément est sur une autre page du cours : y aller (l'index donne l'adresse)
    var e = index && parId[d.el];
    if (!e) return false;
    var u = new URL(e.ancre, RACINE);
    u.searchParams.set("reprise", "1");
    location.href = u.href;
    return true;
  }

  // La classe active a été changée ailleurs (page de pilotage, autre onglet) : bien visible quelques secondes.
  function signalerClasse(c) {
    if (!bandeau) return;
    var r = bandeau._r;
    r.puce.classList.add("tw-prof-alerte");
    r.alerte.textContent = "Classe active changée : " + c + " (autre onglet). Vérifie avant de marquer.";
    r.alerte.hidden = false;
    clearTimeout(signalerClasse.t);
    signalerClasse.t = setTimeout(function () { r.puce.classList.remove("tw-prof-alerte"); r.alerte.hidden = true; }, 8000);
  }

  /* ---------- abonnements, API ---------- */
  function notifier() {
    rendre();
    abonnes.slice().forEach(function (f) { try { f(); } catch (e) {} });
  }
  window.addEventListener("storage", function (ev) {
    if (ev.key === CLE_CLASSES) appliquerClassesLocales();
    if (ev.key === CLE_CLASSE && ev.newValue && ev.oldValue && ev.newValue !== ev.oldValue) signalerClasse(ev.newValue);
    if (ev.key === CLE || ev.key === CLE_CLASSE || ev.key === CLE_CLASSES || ev.key === null) notifier();
  });

  window.typwebProf = {
    version: SCHEMA,
    // Fonctions disponibles : la page de pilotage refuse une couche trop ancienne (cours à reconstruire).
    capacites: ["sync", "annule-ref", "arret-position", "banque-privee"],
    classes: function () { return classes.slice(); },
    classe: classeActive,
    fixerClasse: fixerClasse,
    etat: etat,                       // (classe?) → { id: { t, jour } } des éléments vus
    dernier: dernierMarque,           // (classe?, prefixeUAA?) → { el, t } | null
    seance: seance,                   // (classe?, jour?, prefixeUAA?) → [id] vus ce jour-là, dans l'ordre
    sections: sections,               // (classe?) → { idSection: true } (tout vu)
    marquer: function (id, classe) { return ajouter(classe || classeActive(), id, "vu"); },
    annuler: function (id, classe) { return ajouter(classe || classeActive(), id, "annule"); },
    evenements: function () { return lire().slice(); },
    exporter: objetExport,            // () → { format, exporte, v, ev } : tout le journal
    importer: importer,               // (objet | texte) → { ok, ajoutes, ignores } | { ok: false, erreur } ; fusion sans perte
    definirClasses: definirClasses,   // ([{ code, effectif? }]) → true ; liste fournie par la page de pilotage (P4)
    effectif: effectif,               // (classe?) → effectif de la classe (prof-config.json)
    reprendre: reprendre,             // () → va au dernier élément marqué ; false s'il n'y en a pas
    abonner: function (f) {
      abonnes.push(f);
      return function () { abonnes = abonnes.filter(function (g) { return g !== f; }); };
    },
    // Pour vote.js (P3) : ne pas utiliser ailleurs.
    interne: {
      ajouter: ajouter,               // (classe, el, action, extra?) → ajoute un événement au journal
      index: function () { return index; },
      parId: function () { return parId; },
      racine: RACINE, base: BASE, uaa: UAA,
      page: pageCourante
    }
  };

  /* ---------- écrans de vote (P3) : chargés avec la couche prof, jamais pour les élèves ---------- */
  function chargerVote() {
    if (!BASE) return;
    var s = document.createElement("script");
    s.src = BASE + "vote.js"; s.async = false;
    document.head.appendChild(s);
  }

  /* ---------- synchronisation (P5) : chargée avec la couche prof, inactive sans jeton configuré ---------- */
  function chargerSync() {
    if (window.typwebSync) { window.typwebSync.lier(window.typwebProf); relierSync(); return; }   // déjà chargée (page de pilotage)
    if (!BASE) return;
    var s = document.createElement("script");
    s.src = BASE + "sync.js"; s.async = false;
    s.onload = function () { relierSync(); };
    s.onerror = function () { window.typwebProf.syncAbsente = true; };     // site sans sync.js (ancien site, test)
    document.head.appendChild(s);
  }
  function relierSync() {
    if (window.typwebSync && window.typwebSync.abonner) window.typwebSync.abonner(majSync);
    majSync();
  }

  /* ---------- sonomètre (P8) : chargé À LA DEMANDE (bouton, touche S, reprise), jamais avec la couche ---------- */
  var attenteSon = null;
  function surSonometre(f) {
    if (window.typwebSonometre) { f(window.typwebSonometre); return; }
    if (!BASE) return;
    if (!attenteSon) {
      attenteSon = [];
      var s = document.createElement("script");
      s.src = BASE + "sonometre.js"; s.async = true;
      s.onload = function () {
        var liste = attenteSon; attenteSon = null;
        liste.forEach(function (g) { if (window.typwebSonometre) g(window.typwebSonometre); });
      };
      s.onerror = function () { attenteSon = null; };
      document.head.appendChild(s);
    }
    attenteSon.push(f);
  }
  // Clavier : V marque (ou retire) l'élément marquable au centre de l'écran, comme un clic.
  function elementCentral() {
    var y = window.innerHeight / 2, best = null, dmin = Infinity;
    elementsPage().forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (!r.height) return;
      var d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      if (d < dmin) { dmin = d; best = el; }
    });
    return best;
  }
  document.addEventListener("keydown", function (e) {
    if ((e.key !== "v" && e.key !== "V") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var c = e.target;
    if (c && (c.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName))) return;
    if (document.documentElement.classList.contains("tv-ouvert")) return;      // écran de vote ouvert
    var el = elementCentral();
    if (!el) return;
    var classe = classeActive();
    if (!classe) { ouvrirBandeau(true); return; }
    var id = el.getAttribute("data-id"), v = etat(classe)[id];
    if (v && v.jour === jourDe(Date.now())) {
      var d = derniers(lire(), classe)[id];
      ajouter(classe, id, "annule", d && d.a === "vu" ? { ref: d.id } : null);
    } else ajouter(classe, id, "vu");
    el.classList.add("tw-reprise"); setTimeout(function () { el.classList.remove("tw-reprise"); }, 600);
  });
  document.addEventListener("keydown", function (e) {      // S : marche / arrêt (hors champs de saisie)
    if ((e.key !== "s" && e.key !== "S") || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    var c = e.target;
    if (c && (c.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(c.tagName))) return;
    surSonometre(function (s) { s.basculer(); });
  });

  /* ---------- démarrage ---------- */
  function demarrer() {
    appliquerClassesLocales();
    construireBandeau();
    document.addEventListener("click", surClic);
    rendre();
    var config = BASE ? fetch(BASE + "prof-config.json", { cache: "no-cache" })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      : Promise.resolve(null);
    chargerVote();
    chargerSync();
    // page suivante du cours : le sonomètre qui tournait reprend (micro déjà autorisé), sinon rien n'est chargé
    try { if (sessionStorage.getItem("typweb.sonometre.actif") === "1") surSonometre(function (s) { s.reprendre(); }); } catch (e) {}
    Promise.all([config, chargerIndex()]).then(function (res) {
      if (res[0] && Array.isArray(res[0].classes)) {
        // « 5GT-A » ou { "code": "5GT-A", "effectif": 24 } (les deux formes sont acceptées)
        classes = res[0].classes.map(function (c) { return String(c && typeof c === "object" ? c.code : c); });
        res[0].classes.forEach(function (c) {
          if (c && typeof c === "object" && c.effectif > 0) effectifs[String(c.code)] = Math.round(c.effectif);
        });
        if (res[0].effectifDefaut > 0) EFFECTIF_DEFAUT = Math.round(res[0].effectifDefaut);
      }
      appliquerClassesLocales();                    // la liste de la page de pilotage l'emporte
      notifier();                                   // index chargé : les abonnés (vote.js) se rafraîchissent
      reprise();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
