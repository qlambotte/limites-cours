/* ============================================================
   annot.js — outil d'écriture sur les pages du site (v2, 2026-10-29)
   Même ergonomie que l'outil d'annotation des slides IMSV
   (slides/seance01/annotate.html) : un dock vertical dans la marge
   de droite, trait lissé, surligneur translucide, gomme, formes.

   - Le bouton ✎ (à côté du thème sur grand écran, en bas à gauche
     sinon) ouvre / ferme le dock. Dock fermé = page normale.
   - Outils : pointeur (C) · stylo (D) · surligneur (T) · gomme (Q)
     · formes : carré (Z), cercle (I), cercle trigonométrique (U),
     repère (X) · note et correction (post-it) · couleurs (1-4 et
     palette) · annuler (Ctrl/Cmd+Z) · effacer la page · masquer.
     Y ouvre / ferme le dock ; Échap repasse au pointeur.
     Les raccourcis ne servent que dock ouvert (sauf Y), et jamais
     pendant la frappe dans un champ.
   - Tout est gardé dans CE navigateur (localStorage), page par page,
     accroché au bloc du texte (paragraphe, encadré, figure…) : les
     traits suivent ce bloc si la mise en page change.
   - « Exporter » / « Importer » : passer d'un ordinateur à l'autre.
   - Données compatibles avec la v1 (traits, surlignages de texte,
     notes et corrections déjà enregistrés).
   ============================================================ */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var PREF = "lim-annot:v1:";
  var CLE = PREF + location.pathname.replace(/index\.html$/, "");
  var BLOCS = "p, li, h1, h2, h3, h4, table, pre, figure, blockquote, .theo, .exo, .callout, .lp-fig, .lp-side, .aides, .activite, .cell-output, mjx-container";
  var PALETTE = [["#e63946", "Rouge"], ["#1f5fbf", "Bleu"], ["#14304a", "Noir"], ["#ffd60a", "Jaune"],
                 ["#f77f00", "Orange"], ["#2e7d46", "Vert"], ["#7bc043", "Vert clair"], ["#00a6a6", "Turquoise"],
                 ["#4ea8de", "Bleu clair"], ["#7b3fa0", "Violet"], ["#f06fa8", "Rose"], ["#8a5a2b", "Marron"]];
  var ANCIENNES = { noir: "#14304a", rouge: "#c1002a", bleu: "#1d6fb8", vert: "#0a7d4d", jaune: "#ffd60a" };
  var DESSIN = { stylo: 1, surligneur: 1, gomme: 1, forme: 1, note: 1, correction: 1 };

  var etat = { outil: "pointeur", dernier: "stylo", coul: PALETTE[0][0], forme: "carre", visible: true, ouvert: false };
  var data = { traits: [], surl: [], notes: [] };
  var pile = [];                      // annuler : instantanés {traits, notes}
  var racine, calque, couche, poignee, dock, liste, msg, palette, menuFormes, menuPlus;

  // ---------- stockage ----------
  function charger() {
    try { var t = localStorage.getItem(CLE); if (t) data = JSON.parse(t); } catch (e) {}
    data.traits = data.traits || []; data.surl = data.surl || []; data.notes = data.notes || [];
  }
  function sauver() {
    data.titre = document.title; data.maj = new Date().toISOString();
    try {
      if (!data.traits.length && !data.surl.length && !data.notes.length) localStorage.removeItem(CLE);
      else localStorage.setItem(CLE, JSON.stringify(data));
    } catch (e) { info("Impossible d'enregistrer (stockage du navigateur indisponible)."); }
  }
  function memoriser() {
    pile.push(JSON.stringify({ traits: data.traits, notes: data.notes }));
    if (pile.length > 80) pile.shift();
  }
  function annuler() {
    if (!pile.length) { info("Rien à annuler."); return; }
    var s = JSON.parse(pile.pop());
    data.traits = s.traits; data.notes = s.notes;
    sauver(); dessinerTout(); majListe();
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- ancres : un bloc du texte, repéré par id + chemin ----------
  function bloc(node) {
    var e = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (e && e !== racine && !(e.matches && e.matches(BLOCS))) e = e.parentElement;
    if (!e || e === racine || !racine.contains(e)) return racine;
    return e;
  }
  function ancre(e) {
    var chemin = [], n = e;
    while (n && n !== racine && !n.id) {
      var p = n.parentElement;
      chemin.unshift(Array.prototype.indexOf.call(p.children, n));
      n = p;
    }
    return { id: n && n !== racine ? n.id : null, chemin: chemin };
  }
  function resoudre(a) {
    var n = a.id ? document.getElementById(a.id) : racine;
    for (var i = 0; n && i < a.chemin.length; i++) n = n.children[a.chemin[i]];
    return n || null;
  }
  // boîte d'un élément, en coordonnées du calque (coin haut gauche de la racine)
  var origine = { x: 0, y: 0 };
  function majOrigine() {
    var r = racine.getBoundingClientRect();
    origine = { x: r.left + window.scrollX, y: r.top + window.scrollY };
  }
  function boite(e) {
    var r = e.getBoundingClientRect();
    return { x: r.left + window.scrollX - origine.x, y: r.top + window.scrollY - origine.y, w: Math.max(r.width, 1), h: r.height };
  }
  function local(ev) {
    return [ev.pageX - origine.x, ev.pageY - origine.y];
  }
  function sousLePoint(ev) {
    calque.style.pointerEvents = "none";
    var s = document.elementFromPoint(ev.clientX, ev.clientY);
    calque.style.pointerEvents = "";
    return s;
  }

  // ---------- rendu ----------
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  // lissage : courbes quadratiques par les milieux des segments (comme les slides)
  function cheminLisse(p) {
    if (!p.length) return "";
    if (p.length === 1) return "M" + p[0][0] + " " + p[0][1] + "l0.01 0";
    var d = "M" + p[0][0].toFixed(1) + " " + p[0][1].toFixed(1);
    for (var i = 1; i < p.length - 1; i++) {
      var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
      d += "Q" + p[i][0].toFixed(1) + " " + p[i][1].toFixed(1) + " " + mx.toFixed(1) + " " + my.toFixed(1);
    }
    var z = p[p.length - 1];
    return d + "L" + z[0].toFixed(1) + " " + z[1].toFixed(1);
  }
  function couleurDe(t) { return ANCIENNES[t.coul] || t.coul || "#14304a"; }
  function epDe(t) { return t.mode === "surligneur" ? 16 : (t.ep || 3); }

  function fleche(g, x, y, ang, c) {
    var s = 9, ca = Math.cos(ang), sa = Math.sin(ang);
    function pt(dx, dy) { return (x + dx * ca - dy * sa).toFixed(1) + " " + (y + dx * sa + dy * ca).toFixed(1); }
    el("path", { d: "M" + pt(0, 0) + "L" + pt(-s, s * 0.55) + "L" + pt(-s, -s * 0.55) + "Z", fill: c, stroke: "none" }, g);
  }
  function texte(g, x, y, t, c, taille) {
    var e = el("text", { x: x, y: y, fill: c, "font-size": taille || 15, "font-family": "Inter, system-ui, sans-serif", "font-weight": 600 }, g);
    e.textContent = t;
  }
  function repere(g, ox, oy, ext, c) {
    el("path", { d: "M" + (ox - ext) + " " + oy + "H" + (ox + ext) + "M" + ox + " " + (oy + ext) + "V" + (oy - ext),
                 stroke: c, "stroke-width": 2.4, fill: "none" }, g);
    fleche(g, ox + ext, oy, 0, c); fleche(g, ox, oy - ext, -Math.PI / 2, c);
    texte(g, ox - 17, oy + 17, "O", c); texte(g, ox + ext - 4, oy - 8, "x", c); texte(g, ox + 8, oy - ext + 15, "y", c);
  }
  // une forme : deux points (centre/coin et poignée) → éléments SVG + points de contact pour la gomme
  function forme(g, t, p0, p1, c) {
    var contact = [];
    if (t.forme === "carre") {
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], cote = Math.max(Math.abs(dx), Math.abs(dy));
      var x = dx < 0 ? p0[0] - cote : p0[0], y = dy < 0 ? p0[1] - cote : p0[1];
      el("rect", { x: x, y: y, width: cote, height: cote, stroke: c, "stroke-width": 3, fill: "none" }, g);
      contact = [[x, y], [x + cote, y], [x + cote, y + cote], [x, y + cote], [x, y]];
    } else if (t.forme === "cercle" || t.forme === "trigo") {
      var r = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (t.forme === "trigo") {
        repere(g, p0[0], p0[1], r * 1.35, c);
        [[p0[0] + r, p0[1], 0, 6], [p0[0] - r, p0[1], 0, 6], [p0[0], p0[1] - r, 6, 0], [p0[0], p0[1] + r, 6, 0]].forEach(function (q) {
          el("path", { d: "M" + (q[0] - q[2]) + " " + (q[1] - q[3]) + "L" + (q[0] + q[2]) + " " + (q[1] + q[3]), stroke: c, "stroke-width": 2.2 }, g);
        });
        texte(g, p0[0] + r - 5, p0[1] - 10, "1", c, 13); texte(g, p0[0] - 15, p0[1] - r + 4, "1", c, 13);
      }
      el("circle", { cx: p0[0], cy: p0[1], r: r, stroke: c, "stroke-width": 3, fill: "none" }, g);
      for (var k = 0; k <= 36; k++) contact.push([p0[0] + r * Math.cos(k * Math.PI / 18), p0[1] + r * Math.sin(k * Math.PI / 18)]);
      if (t.forme === "trigo") contact.push(null, [p0[0] - r * 1.35, p0[1]], [p0[0] + r * 1.35, p0[1]], null, [p0[0], p0[1] - r * 1.35], [p0[0], p0[1] + r * 1.35]);
    } else {
      var ext = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      repere(g, p0[0], p0[1], ext, c);
      contact = [[p0[0] - ext, p0[1]], [p0[0] + ext, p0[1]], null, [p0[0], p0[1] - ext], [p0[0], p0[1] + ext]];
    }
    return contact;
  }
  var TAILLE_DEFAUT = { carre: [110, 110], cercle: [70, 0], trigo: [90, 0], repere: [110, 0] };

  // points absolus (calque) d'un trait enregistré
  function absolus(t) {
    var e = resoudre(t.ancre); if (!e) return null;
    var b = boite(e);
    return t.pts.map(function (p) { return [b.x + p[0] * b.w, b.y + p[1] * b.w]; });
  }
  function dessinerTrait(t, pts, parent) {
    var c = couleurDe(t), g = el("g", { "class": "an-t an-t-" + (t.mode || "stylo") }, parent);
    if (t.mode === "forme") { t._contact = forme(g, t, pts[0], pts[1], c); return g; }
    el("path", { d: cheminLisse(pts), stroke: c, "stroke-width": epDe(t), fill: "none" }, g);
    t._contact = pts;
    return g;
  }
  function tailleCalque() {
    calque.setAttribute("width", 0); calque.setAttribute("height", 0);
    calque.setAttribute("width", Math.max(racine.scrollWidth, 1));
    calque.setAttribute("height", Math.max(racine.scrollHeight, 1));
  }
  function dessinerTout() {
    if (!calque) return;
    majOrigine(); tailleCalque();
    while (calque.firstChild) calque.removeChild(calque.firstChild);
    data.traits.forEach(function (t) {
      var pts = absolus(t);
      t._contact = null;
      if (pts && pts.length) dessinerTrait(t, pts, calque);
    });
    placerNotes();
  }

  // ---------- tracé en cours ----------
  var enCours = null;
  function debut(ev) {
    if (ev.button > 0) return;
    var o = etat.outil;
    if (!DESSIN[o]) return;
    ev.preventDefault();
    majOrigine();
    if (o === "note" || o === "correction") { nouvelleNote(ev, o); return; }
    try { calque.setPointerCapture(ev.pointerId); } catch (e) {}
    if (o === "gomme") { enCours = { gomme: true, avant: JSON.stringify({ traits: data.traits, notes: data.notes }), touche: false }; gommer(ev); return; }
    var e = bloc(sousLePoint(ev)), b = boite(e), p = local(ev);
    enCours = { t: { id: uid(), ancre: ancre(e), coul: etat.coul, mode: o, pts: [] }, b: b, abs: [p, p], g: null };
    if (o === "forme") enCours.t.forme = etat.forme;
    else { enCours.t.ep = o === "surligneur" ? 16 : 3; enCours.abs = [p]; }
    retracer();
  }
  function retracer() {
    if (enCours.g) enCours.g.remove();
    enCours.g = dessinerTrait(enCours.t, enCours.abs, calque);
  }
  function bouge(ev) {
    if (!enCours) return;
    if (enCours.gomme) { gommer(ev); return; }
    var p = local(ev);
    if (enCours.t.mode === "forme") enCours.abs[1] = p;
    else {
      var z = enCours.abs[enCours.abs.length - 1];
      if (Math.hypot(p[0] - z[0], p[1] - z[1]) < 1.5) return;
      enCours.abs.push(p);
    }
    retracer();
  }
  function fin() {
    if (!enCours) return;
    var c = enCours; enCours = null;
    if (c.gomme) {
      if (c.touche) { pile.push(c.avant); sauver(); majListe(); }
      return;
    }
    var t = c.t, b = c.b;
    if (t.mode === "forme") {
      var p0 = c.abs[0], p1 = c.abs[1];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 6) {      // simple clic : forme de taille par défaut
        var d = TAILLE_DEFAUT[t.forme] || [100, 0];
        c.abs[1] = [p0[0] + d[0], p0[1] + d[1]];
      }
    }
    t.pts = c.abs.map(function (p) { return [+((p[0] - b.x) / b.w).toFixed(4), +((p[1] - b.y) / b.w).toFixed(4)]; });
    memoriser();
    data.traits.push(t);
    sauver(); dessinerTout();
  }

  // ---------- gomme : efface tout trait touché (trait entier) ----------
  function distSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    var u = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
  }
  function touche(t, p) {
    var c = t._contact; if (!c) return false;
    var marge = 12 + epDe(t) / 2;
    if (c.length === 1 || (c.length === 2 && !c[1])) return c[0] && Math.hypot(p[0] - c[0][0], p[1] - c[0][1]) < marge;
    for (var i = 1; i < c.length; i++) {
      if (!c[i] || !c[i - 1]) continue;
      if (distSeg(p, c[i - 1], c[i]) < marge) return true;
    }
    return false;
  }
  function gommer(ev) {
    var p = local(ev), avant = data.traits.length;
    data.traits = data.traits.filter(function (t) { return !touche(t, p); });
    if (data.traits.length !== avant) { enCours.touche = true; dessinerTout(); }
    var s = sousLePoint(ev), m = s && s.closest && s.closest("mark.an-hl");   // surlignages de texte (v1)
    if (m) { retirerSurl(m.dataset.id); }
  }

  // ---------- surlignages de texte de la v1 (affichage et gomme) ----------
  function textesDe(e) {
    var w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, null), out = [], n;
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest(".an-ui, script, style")) continue;
      out.push(n);
    }
    return out;
  }
  function appliquerSurl(s) {
    var e = resoudre(s.ancre); if (!e) return;
    var noeuds = textesDe(e), tout = noeuds.map(function (n) { return n.data; }).join("");
    var i = tout.indexOf(s.avant + s.texte);
    var deb = i >= 0 ? i + s.avant.length : tout.indexOf(s.texte);
    if (deb < 0) return;
    var fn = deb + s.texte.length, k = 0;
    noeuds.forEach(function (n) {
      var a = k, b = k + n.data.length; k = b;
      var d = Math.max(deb, a), f = Math.min(fn, b);
      if (d >= f) return;
      var r = document.createRange();
      r.setStart(n, d - a); r.setEnd(n, f - a);
      var m = document.createElement("mark");
      m.className = "an-hl an-hl-" + s.coul; m.dataset.id = s.id;
      try { r.surroundContents(m); } catch (e2) {}
    });
  }
  function retirerSurl(id) {
    document.querySelectorAll('mark.an-hl[data-id="' + id + '"]').forEach(function (m) {
      var p = m.parentNode; while (m.firstChild) p.insertBefore(m.firstChild, m); p.removeChild(m); p.normalize();
    });
    data.surl = data.surl.filter(function (s) { return s.id !== id; }); sauver();
  }

  // ---------- notes et corrections ----------
  function nouvelleNote(ev, sorte) {
    var e = bloc(sousLePoint(ev)), b = boite(e), p = local(ev);
    memoriser();
    var n = { id: uid(), sorte: sorte, ancre: ancre(e), fx: +((p[0] - b.x) / b.w).toFixed(4),
              fy: +((p[1] - b.y) / b.w).toFixed(4), texte: "", contexte: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90) };
    data.notes.push(n);
    placerNotes(n.id);
  }
  function placerNotes(ouvrir) {
    couche.innerHTML = "";
    data.notes.forEach(function (n) {
      var e = resoudre(n.ancre); if (!e) return;
      var b = boite(e);
      var d = document.createElement("div");
      d.className = "an-note an-ui an-" + n.sorte + (n.id === ouvrir || !n.texte ? " ouverte" : "");
      d.style.left = (b.x + n.fx * b.w) + "px"; d.style.top = (b.y + n.fy * b.w) + "px";
      d.dataset.id = n.id;
      var pastille = document.createElement("button");
      pastille.type = "button"; pastille.className = "an-pastille";
      pastille.textContent = n.sorte === "correction" ? "!" : "✎";
      pastille.title = n.sorte === "correction" ? "Correction" : "Note";
      pastille.setAttribute("aria-label", pastille.title);
      var corps = document.createElement("div"); corps.className = "an-corps";
      var tete = document.createElement("div"); tete.className = "an-tete";
      tete.textContent = n.sorte === "correction" ? "À corriger" : "Note";
      var ta = document.createElement("textarea");
      ta.value = n.texte; ta.rows = 3; ta.id = "an-" + n.id;
      ta.placeholder = n.sorte === "correction" ? "Ce qu'il faut corriger…" : "Ta note…";
      ta.addEventListener("input", function () { n.texte = ta.value; sauver(); majListe(); });
      var suppr = document.createElement("button"); suppr.type = "button"; suppr.className = "an-suppr"; suppr.textContent = "Supprimer";
      suppr.addEventListener("click", function () { memoriser(); supprimerNote(n.id); });
      var fermer = document.createElement("button"); fermer.type = "button"; fermer.className = "an-fermer"; fermer.textContent = "OK";
      fermer.addEventListener("click", function () { d.classList.remove("ouverte"); if (!n.texte) supprimerNote(n.id); });
      var act = document.createElement("div"); act.className = "an-act"; act.appendChild(suppr); act.appendChild(fermer);
      corps.appendChild(tete); corps.appendChild(ta); corps.appendChild(act);
      pastille.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (etat.outil === "gomme") { memoriser(); supprimerNote(n.id); return; }
        d.classList.toggle("ouverte");
      });
      d.appendChild(pastille); d.appendChild(corps);
      couche.appendChild(d);
      if (n.id === ouvrir) setTimeout(function () { ta.focus(); }, 0);
    });
    couche.hidden = !etat.visible;
  }
  function supprimerNote(id) {
    data.notes = data.notes.filter(function (n) { return n.id !== id; }); sauver(); placerNotes(); majListe();
  }

  // ---------- liste des corrections (toutes les pages) ----------
  function toutesLesPages() {
    var res = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf(PREF) === 0) res.push([k.slice(PREF.length), JSON.parse(localStorage.getItem(k))]);
      }
    } catch (e) {}
    return res.sort();
  }
  function texteCorrections() {
    var lignes = [];
    toutesLesPages().forEach(function (pg) {
      var corr = (pg[1].notes || []).filter(function (n) { return n.sorte === "correction" && n.texte; });
      if (!corr.length) return;
      lignes.push("## " + (pg[1].titre || pg[0]) + "  (" + pg[0] + ")");
      corr.forEach(function (n) { lignes.push("- près de « " + n.contexte + " » : " + n.texte); });
      lignes.push("");
    });
    return lignes.join("\n") || "Aucune correction notée.";
  }
  function majListe() {
    if (!liste || liste.hidden) return;
    liste.querySelector("pre").textContent = texteCorrections();
  }

  // ---------- export / import ----------
  function exporter() {
    var tout = {}; toutesLesPages().forEach(function (pg) { tout[pg[0]] = pg[1]; });
    var blob = new Blob([JSON.stringify(tout, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "annotations-" + ((window.TYPWEB && window.TYPWEB.cle) || "cours") + "-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function importer(fichier) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var tout = JSON.parse(r.result), n = 0;
        Object.keys(tout).forEach(function (k) { localStorage.setItem(PREF + k, JSON.stringify(tout[k])); n++; });
        info(n + " page(s) importée(s). Rechargement…");
        setTimeout(function () { location.reload(); }, 700);
      } catch (e) { info("Fichier illisible : choisis un fichier exporté depuis ce site."); }
    };
    r.readAsText(fichier);
  }

  // ---------- interface ----------
  function info(t) {
    if (!msg) return;
    msg.textContent = t || ""; msg.classList.toggle("on", !!t);
    clearTimeout(info._t); if (t) info._t = setTimeout(function () { msg.classList.remove("on"); }, 3500);
  }
  var SVG = {
    pointeur: '<path d="M5 3l14 7-6 2-2 6-6-15z"/>',
    stylo: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>',
    surligneur: '<path d="M11 4l9 9-3 3-9-9 3-3z"/><path d="M11 13l-2 2H5l2-4"/><path d="M4 20h5"/>',
    gomme: '<path d="M17 3l4 4-9.5 9.5H7L3 12.5z"/><path d="M7 16.5L3 20h8"/>',
    carre: '<rect x="5" y="5" width="14" height="14"/>',
    cercle: '<circle cx="12" cy="12" r="8"/>',
    trigo: '<circle cx="12" cy="12" r="7"/><line x1="1" y1="12" x2="23" y2="12"/><line x1="12" y1="1" x2="12" y2="23"/>',
    repere: '<path d="M3 12h18"/><path d="M12 21V3"/><path d="M17 8l4 4-4 4"/><path d="M8 7l4-4 4 4"/>',
    note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    correction: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.5"/>',
    annuler: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    effacer: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    oeil: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    plus: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    fermer: '<path d="M6 9l6 6 6-6"/>',
    crayon: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>'
  };
  function ico(n) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + SVG[n] + '</svg>';
  }
  function bouton(html, titre, fn, cls) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "an2-btn " + (cls || ""); b.innerHTML = html;
    b.title = titre; b.setAttribute("aria-label", titre);
    b.addEventListener("mousedown", function (e) { e.preventDefault(); });     // ne garde pas le focus
    b.addEventListener("click", fn);
    return b;
  }
  function groupe() { var g = document.createElement("div"); g.className = "an2-groupe"; dock.appendChild(g); return g; }
  function sep() { var s = document.createElement("div"); s.className = "an2-sep"; dock.appendChild(s); }
  var boutons = {}, boutonForme, pastilleCoul, effacerBtn;
  var NOMS = { pointeur: "Pointeur — page normale (C)", stylo: "Stylo (D)", surligneur: "Surligneur (T)", gomme: "Gomme : passe sur un trait pour l'effacer (Q)",
               note: "Note : clique où la placer", correction: "Correction : clique près de l'erreur, puis décris-la" };
  var FORMES = [["carre", "Carré (Z)"], ["cercle", "Cercle (I)"], ["trigo", "Cercle trigonométrique (U)"], ["repere", "Repère (X)"]];

  function choisirOutil(o) {
    etat.outil = o;
    if (o !== "pointeur") etat.dernier = o;
    document.documentElement.dataset.annot = o === "pointeur" ? "" : o;
    Object.keys(boutons).forEach(function (k) { boutons[k].classList.toggle("on", k === o); boutons[k].setAttribute("aria-pressed", k === o ? "true" : "false"); });
    calque.style.pointerEvents = DESSIN[o] ? "auto" : "none";
    calque.dataset.outil = o;
    dock.classList.toggle("actif", !!DESSIN[o]);
    if (o === "note" || o === "correction") info(NOMS[o]);
    if (DESSIN[o] && !etat.visible) basculerVisible();
    ouvrirMenu(null);
  }
  function choisirForme(f) {
    etat.forme = f;
    boutonForme.innerHTML = ico(f);
    menuFormes.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.forme === f); });
    choisirOutil("forme");
  }
  function choisirCouleur(c) {
    etat.coul = c;
    pastilleCoul.style.background = c;
    palette.querySelectorAll(".an2-pastille").forEach(function (b) { b.classList.toggle("on", b.dataset.coul === c); });
    if (etat.outil === "gomme" || etat.outil === "pointeur") choisirOutil("stylo");
    ouvrirMenu(null);
  }
  function ouvrirMenu(m) {
    [palette, menuFormes, menuPlus].forEach(function (x) { if (x) x.classList.toggle("ouvert", x === m && !x.classList.contains("ouvert")); });
  }
  function basculerVisible() {
    etat.visible = !etat.visible;
    calque.style.display = etat.visible ? "" : "none";
    couche.hidden = !etat.visible;
    document.documentElement.classList.toggle("an-cache", !etat.visible);
    boutons.oeil.classList.toggle("on", !etat.visible);
    info(etat.visible ? "" : "Annotations masquées (l'œil les réaffiche).");
  }
  function ouvrirDock(ouvrir) {
    etat.ouvert = ouvrir;
    dock.classList.toggle("ouvert", ouvrir);
    poignee.classList.toggle("ouverte", ouvrir);
    poignee.querySelector(".an-ouvrir").setAttribute("aria-expanded", ouvrir ? "true" : "false");
    choisirOutil(ouvrir ? etat.dernier : "pointeur");
    if (!ouvrir) { info(""); if (liste) liste.hidden = true; }
  }

  var CSS = [
    ".an2-calque{position:absolute;left:0;top:0;z-index:1030;pointer-events:none;overflow:visible}",
    ".an2-calque[data-outil=stylo],.an2-calque[data-outil=surligneur],.an2-calque[data-outil=forme]{cursor:crosshair;touch-action:none}",
    ".an2-calque[data-outil=gomme]{cursor:cell;touch-action:none}",
    ".an2-calque[data-outil=note],.an2-calque[data-outil=correction]{cursor:copy}",
    ".an2-calque path,.an2-calque rect,.an2-calque circle{stroke-linecap:round;stroke-linejoin:round}",
    ".an-t-surligneur path{stroke-opacity:.38;mix-blend-mode:multiply}",
    ":root[data-theme=dark] .an-t-surligneur path{mix-blend-mode:screen;stroke-opacity:.45}",
    ".an2-couche{position:absolute;left:0;top:0;width:0;height:0;z-index:1035}",
    "#quarto-document-content.an2-racine{position:relative}",
    ".an2-dock{position:fixed;right:14px;top:50%;transform:translateY(-50%) translateX(160%);z-index:1070;flex-direction:column;",
    " display:flex;align-items:center;gap:4px;padding:6px;background:rgba(255,255,255,.88);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);",
    " border:1px solid rgba(20,48,74,.08);border-radius:16px;box-shadow:0 6px 24px rgba(20,48,74,.16),0 1px 2px rgba(20,48,74,.08);",
    " font:14px/1.3 Inter,system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;max-height:calc(100vh - 16px)}",
    ".an2-dock.ouvert{transform:translateY(-50%);opacity:.6;pointer-events:auto}",
    ".an2-dock.ouvert:hover,.an2-dock.ouvert.actif{opacity:1}",
    ":root[data-theme=dark] .an2-dock{background:rgba(39,48,58,.92);border-color:rgba(255,255,255,.08)}",
    ".an2-groupe{display:flex;flex-direction:column;gap:2px;padding:2px 0;position:relative}",
    ".an2-sep{height:1px;align-self:stretch;margin:2px 4px;background:rgba(20,48,74,.12)}",
    ":root[data-theme=dark] .an2-sep{background:rgba(255,255,255,.14)}",
    ".an2-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:transparent;color:#14304a;cursor:pointer;padding:0}",
    ":root[data-theme=dark] .an2-btn{color:#dde2e8}",
    ".an2-btn svg{width:18px;height:18px}",
    ".an2-btn:hover{background:rgba(20,48,74,.07)}",
    ".an2-btn.on{background:#e7f0ff;color:#1f5fbf}",
    ":root[data-theme=dark] .an2-btn.on{background:#2f3f55;color:#a9c1de}",
    ".an2-btn.danger.confirme{background:#e63946;color:#fff}",
    ".an2-pt{width:20px;height:20px;border-radius:999px;border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(20,48,74,.35);display:block}",
    ".an2-menu{position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);display:none;padding:6px;background:rgba(255,255,255,.97);",
    " border:1px solid rgba(20,48,74,.1);border-radius:13px;box-shadow:0 6px 20px rgba(20,48,74,.18);z-index:2}",
    ":root[data-theme=dark] .an2-menu{background:#27303a;border-color:rgba(255,255,255,.1)}",
    ".an2-menu.ouvert{display:flex;gap:3px}",
    ".an2-menu.an2-palette.ouvert{display:grid;grid-template-columns:repeat(6,auto);gap:0}",
    ".an2-menu.an2-plus.ouvert{flex-direction:column;align-items:stretch;min-width:15rem}",
    ".an2-plus button{display:block;width:100%;text-align:left;border:0;background:none;color:inherit;padding:.4rem .6rem;border-radius:8px;cursor:pointer;font:inherit}",
    ".an2-plus button:hover{background:rgba(20,48,74,.07)}",
    ".an2-pastille{width:22px;height:22px;margin:4px;border-radius:999px;border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(20,48,74,.18);cursor:pointer;padding:0}",
    ".an2-pastille.on{box-shadow:0 0 0 2px #14304a}",
    ".an2-libre{position:relative;width:22px;height:22px;margin:4px;border-radius:999px;border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(20,48,74,.35);cursor:pointer;overflow:hidden;",
    " background:conic-gradient(#e63946,#ffd60a,#7bc043,#00a6a6,#1f5fbf,#7b3fa0,#e63946)}",
    ".an2-libre input{position:absolute;inset:-6px;width:40px;height:40px;opacity:0;cursor:pointer;padding:0;border:0}",
    ".an2-msg{position:fixed;right:72px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:1071;background:#14304a;color:#fff;",
    " font:13px/1.35 Inter,system-ui,sans-serif;border-radius:8px;padding:5px 10px;opacity:0;pointer-events:none;transition:opacity .15s;max-width:calc(100vw - 32px)}",
    ".an2-msg.on{opacity:1}",
    ".an-barre .an-ouvrir svg{width:20px;height:20px;display:block;margin:auto}",
    ".dans-outils .an-ouvrir svg{width:1.05rem;height:1.05rem}",
    "@media (max-height:760px){.an2-dock .an2-btn{width:30px;height:30px}.an2-dock{padding:4px}}",
    "@media (max-width:640px){.an2-dock{right:6px;transform:translateY(-50%) translateX(160%) scale(.86)}.an2-dock.ouvert{transform:translateY(-50%) scale(.86)}}",
    "@media print{.an2-dock,.an2-msg,.an-barre,.an-liste{display:none!important}}"
  ].join("\n");

  function construireInterface() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);

    // poignée : bouton ✎ (placé dans la barre d'outils du titre par tools.html sur grand écran)
    poignee = document.createElement("div"); poignee.className = "an-barre an-ui";
    var ouvrir = document.createElement("button");
    ouvrir.type = "button"; ouvrir.className = "an-ouvrir"; ouvrir.innerHTML = ico("crayon");
    ouvrir.title = "Écrire sur la page (Y)"; ouvrir.setAttribute("aria-label", ouvrir.title); ouvrir.setAttribute("aria-expanded", "false");
    ouvrir.addEventListener("click", function () { ouvrirDock(!etat.ouvert); });
    poignee.appendChild(ouvrir);
    document.body.appendChild(poignee);

    dock = document.createElement("div"); dock.className = "an2-dock an-ui"; dock.setAttribute("role", "toolbar"); dock.setAttribute("aria-label", "Outil d'écriture");
    var g1 = groupe();
    ["pointeur", "stylo", "surligneur", "gomme"].forEach(function (o) {
      boutons[o] = bouton(ico(o), NOMS[o], function () { choisirOutil(o); });
      g1.appendChild(boutons[o]);
    });
    var gf = document.createElement("div"); gf.className = "an2-groupe"; g1.appendChild(gf);
    boutonForme = bouton(ico("carre"), "Formes : carré (Z) · cercle (I) · cercle trigonométrique (U) · repère (X)", function (e) {
      e.stopPropagation(); choisirOutil("forme"); ouvrirMenu(menuFormes);
    });
    boutons.forme = boutonForme; gf.appendChild(boutonForme);
    menuFormes = document.createElement("div"); menuFormes.className = "an2-menu";
    FORMES.forEach(function (f) {
      var b = bouton(ico(f[0]), f[1], function (e) { e.stopPropagation(); choisirForme(f[0]); }, f[0] === etat.forme ? "on" : "");
      b.dataset.forme = f[0]; menuFormes.appendChild(b);
    });
    gf.appendChild(menuFormes);
    sep();
    var gc = groupe();
    pastilleCoul = document.createElement("span"); pastilleCoul.className = "an2-pt"; pastilleCoul.style.background = etat.coul;
    var bc = bouton("", "Couleur (1 à 4 : les quatre premières)", function (e) { e.stopPropagation(); ouvrirMenu(palette); });
    bc.appendChild(pastilleCoul); gc.appendChild(bc);
    palette = document.createElement("div"); palette.className = "an2-menu an2-palette";
    PALETTE.forEach(function (c, i) {
      var b = document.createElement("button"); b.type = "button"; b.className = "an2-pastille" + (i ? "" : " on");
      b.style.background = c[0]; b.dataset.coul = c[0]; b.title = c[1] + (i < 4 ? " (" + (i + 1) + ")" : ""); b.setAttribute("aria-label", c[1]);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function (e) { e.stopPropagation(); choisirCouleur(c[0]); });
      palette.appendChild(b);
    });
    var libre = document.createElement("label"); libre.className = "an2-libre"; libre.title = "Autre couleur";
    var inp = document.createElement("input"); inp.type = "color"; inp.value = etat.coul;
    inp.addEventListener("input", function () { choisirCouleur(inp.value); });
    libre.appendChild(inp); palette.appendChild(libre);
    gc.appendChild(palette);
    sep();
    var gn = groupe();
    ["note", "correction"].forEach(function (o) { boutons[o] = bouton(ico(o), NOMS[o], function () { choisirOutil(o); }); gn.appendChild(boutons[o]); });
    sep();
    var ga = groupe();
    ga.appendChild(bouton(ico("annuler"), "Annuler (Ctrl/Cmd+Z)", annuler));
    effacerBtn = bouton(ico("effacer"), "Effacer les annotations de cette page", effacerPage, "danger");
    ga.appendChild(effacerBtn);
    sep();
    var gm = groupe();
    boutons.oeil = bouton(ico("oeil"), "Masquer ou afficher les annotations", basculerVisible);
    gm.appendChild(boutons.oeil);
    gm.appendChild(bouton(ico("plus"), "Plus : corrections notées, exporter, importer", function (e) { e.stopPropagation(); ouvrirMenu(menuPlus); }));
    menuPlus = document.createElement("div"); menuPlus.className = "an2-menu an2-plus";
    var fin = document.createElement("input"); fin.type = "file"; fin.accept = ".json,application/json"; fin.hidden = true; fin.id = "an-import";
    fin.addEventListener("change", function () { if (fin.files[0]) importer(fin.files[0]); fin.value = ""; });
    [["Corrections notées (toutes les pages)", function () { liste.hidden = !liste.hidden; majListe(); }],
     ["Exporter mes annotations (fichier)", exporter],
     ["Importer des annotations", function () { fin.click(); }]].forEach(function (x) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = x[0];
      b.addEventListener("click", function (e) { e.stopPropagation(); ouvrirMenu(null); x[1](); });
      menuPlus.appendChild(b);
    });
    menuPlus.appendChild(fin);
    gm.appendChild(menuPlus);
    sep();
    groupe().appendChild(bouton(ico("fermer"), "Fermer l'outil d'écriture (Y)", function () { ouvrirDock(false); }));
    document.body.appendChild(dock);

    msg = document.createElement("div"); msg.className = "an2-msg an-ui"; msg.setAttribute("aria-live", "polite");
    document.body.appendChild(msg);

    liste = document.createElement("div"); liste.className = "an-liste an-ui"; liste.hidden = true;
    liste.innerHTML = "<div class='an-liste-t'><b>Corrections notées</b><span></span></div><pre></pre>";
    var copier = document.createElement("button"); copier.type = "button"; copier.className = "an-b"; copier.textContent = "Copier";
    copier.addEventListener("click", function () {
      var t = texteCorrections();
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(function () { info("Liste copiée."); }, selectionner);
      else selectionner();
    });
    function selectionner() { var r = document.createRange(); r.selectNodeContents(liste.querySelector("pre")); var s = getSelection(); s.removeAllRanges(); s.addRange(r); info("Texte sélectionné : Ctrl+C pour copier."); }
    var fermerL = document.createElement("button"); fermerL.type = "button"; fermerL.className = "an-b"; fermerL.textContent = "Fermer";
    fermerL.addEventListener("click", function () { liste.hidden = true; });
    liste.querySelector(".an-liste-t span").appendChild(copier);
    liste.querySelector(".an-liste-t span").appendChild(fermerL);
    document.body.appendChild(liste);

    document.addEventListener("pointerdown", function (e) {
      if (e.target.closest && e.target.closest(".an2-menu")) return;
      ouvrirMenu(null);
    }, true);
  }
  function effacerPage() {
    if (effacerBtn.dataset.confirme) {
      memoriser();
      document.querySelectorAll("mark.an-hl").forEach(function (m) { retirerSurl(m.dataset.id); });
      data.traits = []; data.notes = []; data.surl = [];
      sauver(); dessinerTout(); majListe();
      delete effacerBtn.dataset.confirme; effacerBtn.classList.remove("confirme");
      info("Annotations de la page effacées (Ctrl+Z pour annuler).");
    } else {
      effacerBtn.dataset.confirme = "1"; effacerBtn.classList.add("confirme");
      info("Clique encore une fois pour effacer toutes les annotations de la page.");
      setTimeout(function () { delete effacerBtn.dataset.confirme; effacerBtn.classList.remove("confirme"); }, 4000);
    }
  }

  // ---------- clavier ----------
  function enSaisie() {
    var a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  }
  window.addEventListener("keydown", function (ev) {
    if (enSaisie()) return;
    var k = (ev.key || "").toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
    var fait = true;
    if (k === "y" && !mod && !ev.altKey) ouvrirDock(!etat.ouvert);
    else if (!etat.ouvert) fait = false;
    else if (mod && k === "z") annuler();
    else if (mod || ev.altKey) fait = false;
    else if (k === "c") choisirOutil("pointeur");
    else if (k === "d") choisirOutil("stylo");
    else if (k === "t") choisirOutil("surligneur");
    else if (k === "q") choisirOutil("gomme");
    else if (k === "z") choisirForme("carre");
    else if (k === "i") choisirForme("cercle");
    else if (k === "u") choisirForme("trigo");
    else if (k === "x") choisirForme("repere");
    else if (k === "1" || k === "2" || k === "3" || k === "4") choisirCouleur(PALETTE[+k - 1][0]);
    else if (k === "escape") { if (etat.outil !== "pointeur") choisirOutil("pointeur"); else ouvrirDock(false); }
    else fait = false;
    if (fait) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);

  // ---------- démarrage ----------
  function construire() {
    racine = document.getElementById("quarto-document-content") || document.querySelector("main") || document.body;
    racine.classList.add("an2-racine");
    if (getComputedStyle(racine).position === "static") racine.style.position = "relative";
    charger();
    calque = document.createElementNS(NS, "svg");
    calque.setAttribute("class", "an2-calque an-calque"); calque.setAttribute("aria-hidden", "true");
    racine.appendChild(calque);
    couche = document.createElement("div"); couche.className = "an2-couche an-couche an-ui";
    racine.appendChild(couche);
    construireInterface();

    calque.addEventListener("pointerdown", debut);
    calque.addEventListener("pointermove", bouge);
    calque.addEventListener("pointerup", fin);
    calque.addEventListener("pointercancel", fin);
    calque.addEventListener("lostpointercapture", fin);

    data.surl.forEach(appliquerSurl);
    dessinerTout();
    choisirOutil("pointeur");
    // les figures et les formules se construisent après : redessiner
    [300, 1200, 3000].forEach(function (t) { setTimeout(dessinerTout, t); });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { if (!enCours) dessinerTout(); }) : null;
    if (ro) ro.observe(racine);
    window.addEventListener("resize", function () { if (!enCours) dessinerTout(); });
  }

  if (document.readyState !== "loading") construire();
  else document.addEventListener("DOMContentLoaded", construire);
  window.Annot = { redessiner: function () { dessinerTout(); }, donnees: function () { return data; },
                   ouvrir: function (o) { ouvrirDock(o !== false); } };
})();
