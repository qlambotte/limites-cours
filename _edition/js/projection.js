/* ============================================================
   projection.js — mode projection (TBI) : grand texte, un encadré
   à la fois (définitions, propriétés, exemples, exercices…).
   - bouton « écran » à côté du titre du cours, ou touche P ;
   - → / Espace / Page suivante : encadré suivant ; ← : précédent ;
   - + / − : taille du texte ; Échap : quitter ;
   - T : minuteur (durées : [site] minuteur de typweb.toml, ou au choix) ;
   - B : tableau blanc (énoncé de l'encadré en haut, page vierge pour écrire) ;
     aussi par le bouton « tableau » de l'en-tête de chaque encadré.
   Les réponses se dévoilent au clic, comme d'habitude ; l'outil
   d'annotation (crayon) est en bas à gauche.
   ============================================================ */
(function () {
  "use strict";
  var items = [], i = 0, actif = false, taille = 1.6, barre;
  var ICO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 2h13a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H9l2 3H9.8L8 11.6 6.2 14H5l2-3H1.5a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5zm.5 1v7h12V3H2z"/></svg>';

  function lister() {
    var main = document.querySelector("main") || document.body;
    return [].slice.call(main.querySelectorAll(".theo, .exo")).filter(function (e) {
      return !e.parentElement.closest(".theo, .exo") && !e.closest(".ae-cache, #ae-banque");
    });
  }
  function nettoyer() {
    document.querySelectorAll(".proj-actif, .proj-chemin").forEach(function (e) {
      e.classList.remove("proj-actif", "proj-chemin");
    });
  }
  function montrer(k) {
    if (!items.length) return;
    fermerTableau();
    i = Math.max(0, Math.min(items.length - 1, k));
    nettoyer();
    var it = items[i];
    it.classList.add("proj-actif");
    var suiv = it.nextElementSibling;                  // coups de pouce d'un exercice
    if (suiv && suiv.classList.contains("aides")) suiv.classList.add("proj-actif");
    for (var p = it.parentElement; p && p !== document.body; p = p.parentElement) p.classList.add("proj-chemin");
    var num = it.dataset.num ? " " + it.dataset.num : "";
    var nom = { definition: "Définition", propriete: "Propriété", remarque: "Remarque", exemple: "Exemple",
                activite: "Activité", exercice: "Exercice", methode: "Méthode", theoreme: "Théorème" }[it.dataset.sorte] || "";
    barre.querySelector(".proj-info").textContent = (nom ? nom + num + "   ·   " : "") + (i + 1) + " / " + items.length;
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("resize"));          // figures : se redessiner à la bonne taille
  }
  function appliquerTaille() { document.documentElement.style.setProperty("--proj-taille", taille + "rem"); }
  function entrer(cible) {
    items = lister();
    if (!items.length) { alerteBreve("Pas d'encadré sur cette page."); return; }
    actif = true;
    document.documentElement.classList.add("proj");
    appliquerTaille();
    // commencer à l'encadré visible en haut de l'écran
    var k = -1;
    items.forEach(function (e, j) {
      var r = e.getBoundingClientRect();
      if (k < 0 && r.height > 0 && r.bottom > 40) k = j;           // premier encadré (encore) visible
    });
    if (k < 0) k = 0;
    if (cible && items.indexOf(cible) >= 0) k = items.indexOf(cible);
    barre.hidden = false;
    var an = document.querySelector(".an-barre");        // outil d'annotation : en bas à gauche
    if (an) { an.classList.remove("dans-outils"); document.body.appendChild(an); }
    montrer(k);
  }
  function sortir() {
    fermerTableau();
    var it = items[i];
    actif = false;
    document.documentElement.classList.remove("proj");
    nettoyer();
    barre.hidden = true;
    if (window.typwebAccrocher) window.typwebAccrocher();   // annotation : retour à côté du titre
    window.dispatchEvent(new Event("resize"));
    if (it) it.scrollIntoView({ block: "start" });
  }
  function basculer() { if (actif) sortir(); else entrer(); }
  function alerteBreve(t) {
    var m = document.createElement("div"); m.className = "proj-msg"; m.textContent = t;
    document.body.appendChild(m); setTimeout(function () { m.remove(); }, 2500);
  }
  function bouton(txt, titre, fn) {
    var b = document.createElement("button"); b.type = "button"; b.className = "proj-b";
    b.textContent = txt; b.title = titre; b.setAttribute("aria-label", titre);
    b.addEventListener("click", fn); return b;
  }
  // ------------------------------------------------------------ minuteur
  var minu = null;                       // {fin, reste, pause, el, t}
  function fmt(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + ("0" + sec % 60).slice(-2); }
  function choixMinuteur() {
    var old = document.querySelector(".proj-minu-choix");
    if (old) { old.remove(); return; }
    var c = document.createElement("div"); c.className = "proj-minu-choix";
    var durees = ((window.TYPWEB || {}).minuteur) || [3, 5, 10, 15, 20];
    c.innerHTML = "<b>Minuteur</b>";
    durees.forEach(function (m) {
      c.appendChild(bouton(m + " min", "Lancer " + m + " minutes", function () { c.remove(); lancerMinuteur(m * 60); }));
    });
    var autre = document.createElement("input"); autre.type = "number"; autre.min = "1"; autre.max = "180";
    autre.placeholder = "min"; autre.className = "proj-minu-in"; autre.title = "Autre durée (minutes), puis Entrée";
    autre.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && +autre.value > 0) { c.remove(); lancerMinuteur(+autre.value * 60); }
      e.stopPropagation();
    });
    c.appendChild(autre);
    if (minu) c.appendChild(bouton("Arrêter", "Arrêter le minuteur", function () { c.remove(); arreterMinuteur(); }));
    document.body.appendChild(c);
    autre.focus({ preventScroll: true });
  }
  function lancerMinuteur(sec) {
    arreterMinuteur();
    var el = document.createElement("div"); el.className = "proj-minu"; el.title = "Clic : pause / reprise · double-clic : arrêter";
    document.body.appendChild(el);
    minu = { fin: Date.now() + sec * 1000, reste: sec, pause: false, el: el, total: sec };
    el.addEventListener("click", function () {
      if (!minu) return;
      if (minu.pause) { minu.fin = Date.now() + minu.reste * 1000; minu.pause = false; }
      else { minu.reste = (minu.fin - Date.now()) / 1000; minu.pause = true; }
      el.classList.toggle("pause", minu.pause);
    });
    el.addEventListener("dblclick", arreterMinuteur);
    function tic() {
      if (!minu) return;
      var r = minu.pause ? minu.reste : (minu.fin - Date.now()) / 1000;
      el.textContent = fmt(Math.ceil(r));
      el.classList.toggle("bientot", r <= 30 && r > 0);
      if (r <= 0) { el.textContent = "Temps écoulé"; el.classList.add("fini"); sonner(); clearInterval(minu.t); minu.t = null; }
    }
    minu.t = setInterval(tic, 250); tic();
  }
  function arreterMinuteur() {
    if (!minu) return;
    clearInterval(minu.t); minu.el.remove(); minu = null;
  }
  function sonner() {
    try {
      var A = new (window.AudioContext || window.webkitAudioContext)();
      [0, .35, .7].forEach(function (d) {
        var o = A.createOscillator(), g = A.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(A.destination);
        g.gain.setValueAtTime(.15, A.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, A.currentTime + d + .3);
        o.start(A.currentTime + d); o.stop(A.currentTime + d + .3);
      });
    } catch (e) {}
  }

  // ------------------------------------------------------- tableau blanc
  var tab = null;                        // {el, cv, ctx, traits, coul, item}
  var memoire = new Map();               // traits par encadré (jusqu'au rechargement de la page)
  function ouvrirTableau(item) {
    if (tab) { fermerTableau(); return; }
    item = item || items[i];
    var el = document.createElement("div"); el.className = "proj-tableau";
    var haut = document.createElement("div"); haut.className = "proj-tab-enonce";
    if (item) {
      var corps = item.querySelector(".exo-corps, .theo-body") || item;
      var tete = item.querySelector(".exo-titre, .theo-head");
      haut.innerHTML = (tete ? '<div class="proj-tab-titre">' + tete.textContent.trim() + "</div>" : "") + corps.innerHTML;
      haut.querySelectorAll(".suivi, .rep-tout, .proj-tab-btn").forEach(function (x) { x.remove(); });
    }
    var cv = document.createElement("canvas"); cv.className = "proj-tab-cv";
    var outils = document.createElement("div"); outils.className = "proj-tab-outils";
    el.appendChild(haut); el.appendChild(cv); el.appendChild(outils);
    document.body.appendChild(el);
    document.documentElement.classList.add("proj-tab-ouvert");
    tab = { el: el, cv: cv, ctx: cv.getContext("2d"), traits: memoire.get(item) || [], coul: "#111", ep: 3, item: item };
    memoire.set(item, tab.traits);
    [["#111", "Noir"], ["#c1002a", "Rouge"], ["#1d6fb8", "Bleu"], ["#0a7d4d", "Vert"]].forEach(function (c, k) {
      var b = bouton("", "Stylo " + c[1].toLowerCase(), function () {
        tab.coul = c[0]; outils.querySelectorAll(".proj-tab-c").forEach(function (x) { x.classList.toggle("on", x === b); });
      });
      b.className = "proj-b proj-tab-c" + (k === 0 ? " on" : ""); b.style.background = c[0];
      outils.appendChild(b);
    });
    outils.appendChild(bouton("↶", "Annuler le dernier trait (Ctrl+Z)", function () { tab.traits.pop(); dessiner(); }));
    outils.appendChild(bouton("Effacer", "Effacer la page", function () { tab.traits.length = 0; dessiner(); }));
    outils.appendChild(bouton("✕", "Fermer le tableau (B)", fermerTableau));
    var an = document.querySelector(".an-barre"); if (an) an.classList.add("proj-cache");
    function taille() {
      var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = r.width * d; cv.height = r.height * d; tab.ctx.setTransform(d, 0, 0, d, 0, 0); dessiner();
    }
    tab.taille = taille;
    window.addEventListener("resize", taille);
    var enCours = null;
    function pt(e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e.pressure || .5]; }
    cv.addEventListener("pointerdown", function (e) {
      cv.setPointerCapture(e.pointerId);
      enCours = { c: tab.coul, ep: tab.ep, p: [pt(e)] }; tab.traits.push(enCours); dessiner();
    });
    cv.addEventListener("pointermove", function (e) { if (enCours) { enCours.p.push(pt(e)); dessiner(); } });
    ["pointerup", "pointercancel"].forEach(function (t) { cv.addEventListener(t, function () { enCours = null; }); });
    setTimeout(taille, 0);
  }
  function dessiner() {
    if (!tab) return;
    var c = tab.ctx, w = tab.cv.clientWidth, h = tab.cv.clientHeight;
    c.clearRect(0, 0, w, h); c.lineCap = c.lineJoin = "round";
    tab.traits.forEach(function (t) {
      c.strokeStyle = t.c; c.lineWidth = t.ep; c.beginPath();
      t.p.forEach(function (q, k) { if (k) c.lineTo(q[0] * w, q[1] * h); else c.moveTo(q[0] * w, q[1] * h); });
      if (t.p.length === 1) c.lineTo(t.p[0][0] * w + .1, t.p[0][1] * h);
      c.stroke();
    });
  }
  function fermerTableau() {
    if (!tab) return;
    window.removeEventListener("resize", tab.taille);
    tab.el.remove(); tab = null;
    document.documentElement.classList.remove("proj-tab-ouvert");
    var an = document.querySelector(".an-barre"); if (an) an.classList.remove("proj-cache");
  }
  // bouton « tableau » dans l'en-tête des encadrés : projection + tableau sur cet encadré
  var ICO_TAB = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 2h14v9H1zM2 3v7h12V3zM7 11h2v2h3v1H4v-1h3z"/><path d="M4 8.5 7 5l2 2 2.5-3" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  function boutonsTableau() {
    if (!window.matchMedia("(min-width: 992px)").matches) return;      // utile en classe, sur grand écran
    lister().forEach(function (it) {
      var tete = it.querySelector(":scope > .exo-tete, :scope > .theo-head");
      if (!tete || tete.querySelector(".proj-tab-btn")) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "proj-tab-btn";
      b.innerHTML = ICO_TAB; b.title = "Au tableau : projeter cet énoncé avec une page blanche"; b.setAttribute("aria-label", b.title);
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!actif) entrer(it); else montrer(items.indexOf(it));
        ouvrirTableau(it);
      });
      var cible = tete.querySelector("p") || tete;
      cible.appendChild(b);
    });
  }

  function construire() {
    if (barre) return;
    barre = document.createElement("div"); barre.className = "proj-barre"; barre.hidden = true;
    barre.appendChild(bouton("←", "Encadré précédent (←)", function () { montrer(i - 1); }));
    var info = document.createElement("span"); info.className = "proj-info"; barre.appendChild(info);
    barre.appendChild(bouton("→", "Encadré suivant (→ ou Espace)", function () { montrer(i + 1); }));
    barre.appendChild(bouton("A−", "Texte plus petit (−)", function () { taille = Math.max(1, taille - .15); appliquerTaille(); }));
    barre.appendChild(bouton("A+", "Texte plus grand (+)", function () { taille = Math.min(3, taille + .15); appliquerTaille(); }));
    barre.appendChild(bouton("⏱", "Minuteur (T)", choixMinuteur));
    barre.appendChild(bouton("▭", "Tableau blanc avec l'énoncé (B)", function () { ouvrirTableau(); }));
    barre.appendChild(bouton("✕", "Quitter la projection (Échap)", sortir));
    document.body.appendChild(barre);
    // bouton à côté du titre (outils de la barre latérale)
    var essais = 0;
    (function ajouterOutil() {
      var host = document.querySelector(".sidebar-tools-main");
      if (!host) { if (++essais < 20) setTimeout(ajouterOutil, 150); return; }
      if (host.querySelector(".proj-outil")) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "imsv-tool proj-outil";
      b.innerHTML = ICO; b.title = "Projeter en classe : un encadré à la fois (P)"; b.setAttribute("aria-label", b.title);
      b.addEventListener("click", basculer);
      var theme = host.querySelector("button.imsv-tool:not(.proj-outil)");
      host.insertBefore(b, theme ? theme.nextSibling : null);
    })();
  }
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (tab && (e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); tab.traits.pop(); dessiner(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!actif) { if (e.key === "p" || e.key === "P") { e.preventDefault(); entrer(); } return; }
    if (e.key === "Escape" && document.querySelector(".proj-minu-choix")) { document.querySelector(".proj-minu-choix").remove(); return; }
    if (e.key === "Escape" && tab) { e.preventDefault(); fermerTableau(); return; }
    if (e.key === "b" || e.key === "B") { e.preventDefault(); ouvrirTableau(); return; }
    if (e.key === "t" || e.key === "T") { e.preventDefault(); choixMinuteur(); return; }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") { e.preventDefault(); sortir(); }
    else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); montrer(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); montrer(i - 1); }
    else if (e.key === "+" || e.key === "=") { taille = Math.min(3, taille + .15); appliquerTaille(); }
    else if (e.key === "-") { taille = Math.max(1, taille - .15); appliquerTaille(); }
  });
  function demarrer() { construire(); boutonsTableau(); setTimeout(boutonsTableau, 1500); }
  if (document.readyState !== "loading") demarrer(); else document.addEventListener("DOMContentLoaded", demarrer);
})();
