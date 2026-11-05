/* ============================================================
   annot.js — outil d'écriture sur les pages du site (v4, 2026-10-29)
   Dans l'esprit de tldraw : l'outil choisi reste actif, on écrit sur
   toute la page, et ce qui est dessiné se sélectionne et se déplace.

   - Le bouton ✎ (à côté du thème sur grand écran, en bas à gauche
     sinon) ouvre / ferme le dock, posé dans la marge de droite.
   - Outils (raccourcis comme tldraw) :
       page (C) : la page fonctionne normalement (liens, réponses…)
       sélection (V) : cliquer ou encadrer, puis déplacer, agrandir
         avec la poignée, supprimer (Suppr), dupliquer (Ctrl+D) ;
         double-clic sur un texte pour le modifier
       stylo (D) : trait lissé, épaisseur selon la pression du stylet
         (à la souris : selon la vitesse)
       surligneur (M) · gomme (E) · texte (T) · flèche (A)
       formes : rectangle (R), ellipse (O), ligne (L), cercle
         trigonométrique (U), repère (X) — Maj : carré / cercle
       note et correction (post-it)
     Couleurs (1 à 4, palette), tailles S M L XL, annuler (Ctrl+Z),
     rétablir (Ctrl+Maj+Z), effacer la page, masquer.
     Y ouvre / ferme le dock ; Échap désélectionne puis revient à « page ».
     Les raccourcis ne servent que dock ouvert (sauf Y), jamais pendant
     la frappe dans un champ.
   - Écran tactile : le doigt fait défiler la page, le stylet (et la
     souris) écrit ; le bouton « main » permet au doigt d'écrire.
   - « Brouillon » sous chaque exercice et activité : une zone de
     dessin (blanc, quadrillé ou repère), agrandissable, gardée.
   - Tout est gardé dans CE navigateur (localStorage), page par page,
     accroché au bloc du texte (paragraphe, encadré, figure…).
   - Données compatibles avec les versions précédentes.
   ============================================================ */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var PREF = "lim-annot:v1:";
  var CLE = PREF + location.pathname.replace(/index\.html$/, "");
  var BLOCS = "p, li, h1, h2, h3, h4, table, pre, figure, blockquote, .theo, .exo, .callout, .lp-fig, .lp-side, .aides, .activite, .cell-output, mjx-container, .an-brouillon";
  var PALETTE = [["#14304a", "Noir"], ["#e63946", "Rouge"], ["#1f5fbf", "Bleu"], ["#ffd60a", "Jaune"],
                 ["#f77f00", "Orange"], ["#2e7d46", "Vert"], ["#7bc043", "Vert clair"], ["#00a6a6", "Turquoise"],
                 ["#4ea8de", "Bleu clair"], ["#7b3fa0", "Violet"], ["#f06fa8", "Rose"], ["#8a5a2b", "Marron"]];
  var ANCIENNES = { noir: "#14304a", rouge: "#c1002a", bleu: "#1d6fb8", vert: "#0a7d4d", jaune: "#ffd60a" };
  var TAILLES = ["s", "m", "l", "xl"];
  var EP = { stylo: { s: 2, m: 3.5, l: 6, xl: 10 }, surligneur: { s: 10, m: 16, l: 24, xl: 34 },
             forme: { s: 1.5, m: 2.5, l: 4, xl: 6 }, texte: { s: 14, m: 18, l: 26, xl: 38 } };
  // outils qui écrivent sur le calque (le reste : « page »)
  var DESSIN = { selection: 1, stylo: 1, surligneur: 1, gomme: 1, texte: 1, forme: 1, note: 1, correction: 1 };

  var etat = { outil: "page", dernier: "stylo", coul: PALETTE[0][0], taille: "m", forme: "rect",
               visible: true, ouvert: false, doigt: "defile" };
  try { if (localStorage.getItem("an2-doigt") === "ecrit") etat.doigt = "ecrit"; } catch (e) {}
  var TACTILE = (navigator.maxTouchPoints || 0) > 0;
  var data = { traits: [], surl: [], notes: [], brouillons: {} };
  var pile = [], refaire = [];          // annuler / rétablir : instantanés {traits, notes}
  var sel = [];                         // ids sélectionnés
  var racine, calque, couche, couchePied, poignee, dock, liste, msg, palette, menuFormes, menuPlus, menuTaille;

  // ---------- stockage ----------
  function charger() {
    try { var t = localStorage.getItem(CLE); if (t) data = JSON.parse(t); } catch (e) {}
    data.traits = data.traits || []; data.surl = data.surl || []; data.notes = data.notes || [];
    data.brouillons = data.brouillons || {};
  }
  function sauver() {
    data.titre = document.title; data.maj = new Date().toISOString();
    var propre = { titre: data.titre, maj: data.maj, surl: data.surl, notes: data.notes, brouillons: data.brouillons,
                   traits: data.traits.map(nettoyer) };
    try {
      if (!data.traits.length && !data.surl.length && !data.notes.length && !Object.keys(data.brouillons).length) localStorage.removeItem(CLE);
      else localStorage.setItem(CLE, JSON.stringify(propre));
    } catch (e) { info("Impossible d'enregistrer (stockage du navigateur indisponible)."); }
  }
  function nettoyer(t) {          // retire les champs de travail (_contact, _g…)
    var o = {}; for (var k in t) if (k.charAt(0) !== "_") o[k] = t[k]; return o;
  }
  function instantane() { return JSON.stringify({ traits: data.traits.map(nettoyer), notes: data.notes }); }
  function memoriser() {
    pile.push(instantane()); refaire = [];
    if (pile.length > 100) pile.shift();
  }
  function restaurer(s) { s = JSON.parse(s); data.traits = s.traits; data.notes = s.notes; sel = []; sauver(); dessinerTout(); majListe(); }
  function annuler() {
    if (!pile.length) { info("Rien à annuler."); return; }
    refaire.push(instantane()); restaurer(pile.pop());
  }
  function retablir() {
    if (!refaire.length) { info("Rien à rétablir."); return; }
    pile.push(instantane()); restaurer(refaire.pop());
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function trouver(id) { for (var i = 0; i < data.traits.length; i++) if (data.traits[i].id === id) return data.traits[i]; return null; }

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
  // coordonnées du calque = coordonnées de la page (le calque couvre toute la page)
  var origine = { x: 0, y: 0 };
  function majOrigine() {
    var r = calque.getBoundingClientRect();
    origine = { x: r.left + window.scrollX, y: r.top + window.scrollY };
  }
  function boite(e) {
    var r = e.getBoundingClientRect();
    return { x: r.left + window.scrollX - origine.x, y: r.top + window.scrollY - origine.y, w: Math.max(r.width, 1), h: r.height };
  }
  function local(ev) { return [ev.pageX - origine.x, ev.pageY - origine.y]; }
  function sousLePoint(ev) {
    var a = calque.style.pointerEvents, b = couche.style.pointerEvents;
    calque.style.pointerEvents = "none"; couche.style.pointerEvents = "none";
    var s = document.elementFromPoint(ev.clientX, ev.clientY);
    calque.style.pointerEvents = a; couche.style.pointerEvents = b;
    return s;
  }
  // enregistre des points absolus dans le repère d'un bloc
  function normaliser(t, abs, b) {
    t.pts = abs.map(function (p) {
      var q = [+((p[0] - b.x) / b.w).toFixed(4), +((p[1] - b.y) / b.w).toFixed(4)];
      if (p.length > 2) q.push(+p[2].toFixed(2));
      return q;
    });
  }
  function boiteAncre(t) {
    var e = resoudre(t.ancre); if (!e) return null;
    if (e !== racine && !e.getClientRects().length) return null;     // brouillon fermé, bloc masqué
    return boite(e);
  }
  function absolus(t) {
    var b = boiteAncre(t); if (!b) return null;
    return t.pts.map(function (p) { var q = [b.x + p[0] * b.w, b.y + p[1] * b.w]; if (p.length > 2) q.push(p[2]); return q; });
  }

  // ---------- rendu ----------
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function f1(v) { return v.toFixed(1); }
  // lissage : courbes quadratiques par les milieux des segments
  function cheminLisse(p) {
    if (!p.length) return "";
    if (p.length === 1) return "M" + f1(p[0][0]) + " " + f1(p[0][1]) + "l0.01 0";
    var d = "M" + f1(p[0][0]) + " " + f1(p[0][1]);
    for (var i = 1; i < p.length - 1; i++) {
      var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
      d += "Q" + f1(p[i][0]) + " " + f1(p[i][1]) + " " + f1(mx) + " " + f1(my);
    }
    var z = p[p.length - 1];
    return d + "L" + f1(z[0]) + " " + f1(z[1]);
  }
  // trait à épaisseur variable (pression) : contour rempli, à la façon de tldraw / perfect-freehand
  function lisser(p) {
    if (p.length < 3) return p.slice();
    var o = [p[0]];
    for (var i = 1; i < p.length - 1; i++)
      o.push([(p[i - 1][0] + 2 * p[i][0] + p[i + 1][0]) / 4, (p[i - 1][1] + 2 * p[i][1] + p[i + 1][1]) / 4,
              ((p[i - 1][2] || .5) + 2 * (p[i][2] || .5) + (p[i + 1][2] || .5)) / 4]);
    o.push(p[p.length - 1]);
    return o;
  }
  function contourStylo(pts, taille) {
    var p = lisser(lisser(pts)), n = p.length;
    if (n === 1 || (n === 2 && Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) < 1)) {
      var r0 = taille * (0.4 + 0.6 * (p[0][2] || .5));
      return "M" + f1(p[0][0] - r0) + " " + f1(p[0][1]) + "a" + f1(r0) + " " + f1(r0) + " 0 1 0 " + f1(2 * r0) + " 0a" + f1(r0) + " " + f1(r0) + " 0 1 0 " + f1(-2 * r0) + " 0Z";
    }
    var g = [], d = [];
    for (var i = 0; i < n; i++) {
      var a = p[Math.max(0, i - 1)], b = p[Math.min(n - 1, i + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      var pr = p[i][2] === undefined ? .5 : p[i][2];
      var r = taille * (0.35 + 0.65 * pr) / 2;
      if (i === 0 || i === n - 1) r *= 0.85;
      var nx = -ty / l * r, ny = tx / l * r;
      g.push([p[i][0] + nx, p[i][1] + ny]); d.push([p[i][0] - nx, p[i][1] - ny]);
    }
    function cote(q, deb) {
      var s = deb ? "M" + f1(q[0][0]) + " " + f1(q[0][1]) : "L" + f1(q[0][0]) + " " + f1(q[0][1]);
      for (var k = 1; k < q.length - 1; k++)
        s += "Q" + f1(q[k][0]) + " " + f1(q[k][1]) + " " + f1((q[k][0] + q[k + 1][0]) / 2) + " " + f1((q[k][1] + q[k + 1][1]) / 2);
      var z = q[q.length - 1];
      return s + "L" + f1(z[0]) + " " + f1(z[1]);
    }
    var fin = p[n - 1], debut = p[0];
    var rf = Math.hypot(g[n - 1][0] - fin[0], g[n - 1][1] - fin[1]), rd = Math.hypot(g[0][0] - debut[0], g[0][1] - debut[1]);
    d.reverse();
    return cote(g, true) + "A" + f1(rf) + " " + f1(rf) + " 0 0 1 " + f1(d[0][0]) + " " + f1(d[0][1]) +
           cote(d, false).replace(/^L[^QAL]*/, "") + "A" + f1(rd) + " " + f1(rd) + " 0 0 1 " + f1(g[0][0]) + " " + f1(g[0][1]) + "Z";
  }
  function couleurDe(t) { return ANCIENNES[t.coul] || t.coul || "#14304a"; }
  function tailleDe(t) {
    if (t.taille) return t.taille;
    if (t.ep) return t.ep >= 14 ? "m" : (t.ep >= 5 ? "l" : "m");      // anciennes données
    return "m";
  }
  function epDe(t) {
    var m = t.mode === "surligneur" ? "surligneur" : (t.mode === "forme" ? "forme" : "stylo");
    return EP[m][tailleDe(t)] * (m === "forme" ? 1 : (t.echelleEp || 1));
  }
  function fleche(g, x, y, ang, c, s) {
    s = s || 9;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    function pt(dx, dy) { return f1(x + dx * ca - dy * sa) + " " + f1(y + dx * sa + dy * ca); }
    el("path", { d: "M" + pt(0, 0) + "L" + pt(-s, s * 0.55) + "L" + pt(-s, -s * 0.55) + "Z", fill: c, stroke: "none" }, g);
  }
  function texteSvg(g, x, y, t, c, taille) {
    var e = el("text", { x: x, y: y, fill: c, "font-size": taille || 15, "font-family": "Inter, system-ui, sans-serif", "font-weight": 600 }, g);
    e.textContent = t;
  }
  function repere(g, ox, oy, ext, c, ep) {
    el("path", { d: "M" + (ox - ext) + " " + oy + "H" + (ox + ext) + "M" + ox + " " + (oy + ext) + "V" + (oy - ext),
                 stroke: c, "stroke-width": ep, fill: "none" }, g);
    fleche(g, ox + ext, oy, 0, c, 6 + 2 * ep); fleche(g, ox, oy - ext, -Math.PI / 2, c, 6 + 2 * ep);
    texteSvg(g, ox - 17, oy + 17, "O", c); texteSvg(g, ox + ext - 4, oy - 8, "x", c); texteSvg(g, ox + 8, oy - ext + 15, "y", c);
  }
  function anneau(cx, cy, rx, ry) {
    var c = []; for (var k = 0; k <= 48; k++) c.push([cx + rx * Math.cos(k * Math.PI / 24), cy + ry * Math.sin(k * Math.PI / 24)]); return c;
  }
  // forme : deux points → éléments SVG ; renvoie les points de contact (gomme, sélection)
  function forme(g, t, p0, p1, c) {
    var ep = epDe(t), contact = [], f = t.forme;
    if (f === "carre") {            // anciennes données : carré
      var dx = p1[0] - p0[0], dy = p1[1] - p0[1], cote = Math.max(Math.abs(dx), Math.abs(dy));
      p1 = [p0[0] + (dx < 0 ? -cote : cote), p0[1] + (dy < 0 ? -cote : cote)]; f = "rect";
    }
    if (f === "rect") {
      var x = Math.min(p0[0], p1[0]), y = Math.min(p0[1], p1[1]), w = Math.abs(p1[0] - p0[0]), h = Math.abs(p1[1] - p0[1]);
      el("rect", { x: x, y: y, width: w, height: h, rx: 4, stroke: c, "stroke-width": ep, fill: "none" }, g);
      contact = [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    } else if (f === "ellipse") {
      var cx = (p0[0] + p1[0]) / 2, cy = (p0[1] + p1[1]) / 2, rx = Math.abs(p1[0] - p0[0]) / 2, ry = Math.abs(p1[1] - p0[1]) / 2;
      el("ellipse", { cx: cx, cy: cy, rx: rx, ry: ry, stroke: c, "stroke-width": ep, fill: "none" }, g);
      contact = anneau(cx, cy, rx, ry);
    } else if (f === "cercle" || f === "trigo") {   // centre + rayon
      var r = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      if (f === "trigo") {
        repere(g, p0[0], p0[1], r * 1.35, c, ep);
        [[p0[0] + r, p0[1], 0, 6], [p0[0] - r, p0[1], 0, 6], [p0[0], p0[1] - r, 6, 0], [p0[0], p0[1] + r, 6, 0]].forEach(function (q) {
          el("path", { d: "M" + (q[0] - q[2]) + " " + (q[1] - q[3]) + "L" + (q[0] + q[2]) + " " + (q[1] + q[3]), stroke: c, "stroke-width": ep }, g);
        });
        texteSvg(g, p0[0] + r - 5, p0[1] - 10, "1", c, 13); texteSvg(g, p0[0] - 15, p0[1] - r + 4, "1", c, 13);
      }
      el("circle", { cx: p0[0], cy: p0[1], r: r, stroke: c, "stroke-width": ep, fill: "none" }, g);
      contact = anneau(p0[0], p0[1], r, r);
      if (f === "trigo") contact.push(null, [p0[0] - r * 1.35, p0[1]], [p0[0] + r * 1.35, p0[1]], null, [p0[0], p0[1] - r * 1.35], [p0[0], p0[1] + r * 1.35]);
    } else if (f === "ligne" || f === "fleche") {
      el("path", { d: "M" + f1(p0[0]) + " " + f1(p0[1]) + "L" + f1(p1[0]) + " " + f1(p1[1]), stroke: c, "stroke-width": ep, fill: "none" }, g);
      if (f === "fleche" && Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 2)
        fleche(g, p1[0], p1[1], Math.atan2(p1[1] - p0[1], p1[0] - p0[0]), c, 8 + 3 * ep);
      contact = [p0, p1];
    } else {                        // repère : centre + demi-portée
      var ext = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      repere(g, p0[0], p0[1], ext, c, ep);
      contact = [[p0[0] - ext, p0[1]], [p0[0] + ext, p0[1]], null, [p0[0], p0[1] - ext], [p0[0], p0[1] + ext]];
    }
    return contact;
  }
  var TAILLE_DEFAUT = { rect: [120, 80], ellipse: [120, 80], cercle: [70, 0], trigo: [90, 0], repere: [110, 0], ligne: [120, 0], fleche: [120, 0], carre: [110, 110] };

  function dessinerTrait(t, pts, parent) {
    var c = couleurDe(t), g = el("g", { "class": "an-t an-t-" + (t.mode || "stylo") }, parent);
    g.dataset.id = t.id; t._g = g;
    if (t.mode === "forme") { t._contact = forme(g, t, pts[0], pts[1], c); return g; }
    if (t.mode === "surligneur") el("path", { d: cheminLisse(pts), stroke: c, "stroke-width": epDe(t), fill: "none" }, g);
    else el("path", { d: contourStylo(pts, epDe(t)), fill: c, stroke: "none" }, g);
    t._contact = pts;
    return g;
  }
  // texte : un bloc HTML dans la couche (modifiable)
  function dessinerTexte(t, pts) {
    var d = document.createElement("div");
    d.className = "an-texte an-ui"; d.dataset.id = t.id;
    d.style.left = pts[0][0] + "px"; d.style.top = pts[0][1] + "px";
    d.style.color = couleurDe(t); d.style.fontSize = (EP.texte[tailleDe(t)] * (t.echelle || 1)).toFixed(1) + "px";
    d.textContent = t.texte || "";
    couche.appendChild(d);
    t._d = d; t._g = null; t._contact = null;
    return d;
  }
  function tailleCalque() {
    calque.setAttribute("width", 0); calque.setAttribute("height", 0);
    var d = document.documentElement;
    calque.setAttribute("width", Math.max(d.scrollWidth, document.body.scrollWidth, 1));
    calque.setAttribute("height", Math.max(d.scrollHeight, document.body.scrollHeight, 1));
  }
  function dessinerTout() {
    if (!calque || (enCours && !enCours.gomme)) return;
    majOrigine(); tailleCalque();
    while (calque.firstChild) calque.removeChild(calque.firstChild);
    couche.querySelectorAll(".an-texte").forEach(function (d) { if (d !== edition) d.remove(); });
    data.traits.forEach(function (t) {
      t._contact = null; t._g = null; t._d = null;
      var pts = absolus(t);
      if (!pts || !pts.length) return;
      if (t.mode === "texte") { if (edition && edition.dataset.id === t.id) t._d = edition; else dessinerTexte(t, pts); }
      else dessinerTrait(t, pts, calque);
    });
    sel = sel.filter(function (id) { var t = trouver(id); return t && (t._g || t._d); });
    dessinerSelection();
    placerNotes();
  }

  // ---------- boîtes et sélection ----------
  function boiteItem(t) {
    if (t._d) {
      var r = t._d.getBoundingClientRect();
      return { x: r.left + window.scrollX - origine.x, y: r.top + window.scrollY - origine.y, w: r.width, h: r.height };
    }
    if (t._g) { try { var b = t._g.getBBox(); var e = t.mode === "surligneur" ? epDe(t) / 2 : 0; return { x: b.x - e, y: b.y - e, w: b.width + 2 * e, h: b.height + 2 * e }; } catch (e2) {} }
    return null;
  }
  function union(bs) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    bs.forEach(function (b) { if (!b) return; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  var gSel = null;
  function boiteSelection() { return union(sel.map(function (id) { var t = trouver(id); return t && boiteItem(t); })); }
  function dessinerSelection() {
    if (gSel) { gSel.remove(); gSel = null; }
    couche.querySelectorAll(".an-texte.choisi").forEach(function (d) { d.classList.remove("choisi"); });
    if (!sel.length) return;
    var b = boiteSelection(); if (!b) return;
    gSel = el("g", { "class": "an-sel" }, calque);
    el("rect", { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 4, "class": "an-sel-cadre" }, gSel);
    el("rect", { x: b.x + b.w + 6 - 7, y: b.y + b.h + 6 - 7, width: 14, height: 14, rx: 3, "class": "an-sel-poignee" }, gSel);
    sel.forEach(function (id) { var t = trouver(id); if (t && t._d) t._d.classList.add("choisi"); });
  }
  function surPoignee(p) {
    var b = boiteSelection(); if (!b) return false;
    return Math.abs(p[0] - (b.x + b.w + 6)) < 12 && Math.abs(p[1] - (b.y + b.h + 6)) < 12;
  }
  function dansBoiteSel(p) {
    var b = boiteSelection(); if (!b) return false;
    return p[0] >= b.x - 6 && p[0] <= b.x + b.w + 6 && p[1] >= b.y - 6 && p[1] <= b.y + b.h + 6;
  }
  function choisir(ids) { sel = ids; dessinerSelection(); majBoutonsSel(); }

  // ---------- tracé en cours ----------
  // Doigt sur écran tactile : fait défiler la page (le stylet et la souris écrivent),
  // sauf si l'élève a choisi « le doigt écrit » dans le dock.
  var pan = null, inertie = 0;
  function panDebut(ev) {
    cancelAnimationFrame(inertie);
    pan = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), vx: 0, vy: 0 };
    try { calque.setPointerCapture(ev.pointerId); } catch (e) {}
  }
  function panBouge(ev) {
    if (ev.pointerId !== pan.id) return;
    var dx = ev.clientX - pan.x, dy = ev.clientY - pan.y, t = performance.now(), dt = Math.max(8, t - pan.t);
    window.scrollBy(-dx, -dy);
    pan.vx = 0.7 * (-dx / dt) + 0.3 * pan.vx; pan.vy = 0.7 * (-dy / dt) + 0.3 * pan.vy;
    pan.x = ev.clientX; pan.y = ev.clientY; pan.t = t;
  }
  function panFin() {
    var vx = pan.vx * 16, vy = pan.vy * 16; pan = null;
    (function glisse() {
      if (Math.abs(vx) < 0.4 && Math.abs(vy) < 0.4) return;
      window.scrollBy(vx, vy); vx *= 0.94; vy *= 0.94;
      inertie = requestAnimationFrame(glisse);
    })();
  }
  // pression : celle du stylet ; à la souris, simulée par la vitesse (lent = épais)
  function pression(ev, prec) {
    if (ev.pointerType === "pen" && ev.pressure > 0) return Math.min(1, Math.max(0.05, ev.pressure));
    if (!prec) return 0.5;
    var v = Math.hypot(ev.pageX - prec.x, ev.pageY - prec.y) / Math.max(1, ev.timeStamp - prec.t);
    return Math.max(0.15, Math.min(0.85, 0.85 - v * 0.35));
  }

  var enCours = null, edition = null;
  function debut(ev) {
    // bouton du stylet (button 2) : on écrit quand même ; clic droit de la souris : ignoré (menu bloqué plus bas)
    if (ev.button > 0 && !(ev.pointerType === "pen" && ev.button === 2)) return;
    var o = etat.outil;
    if (!DESSIN[o]) return;
    ev.preventDefault();
    if (enCours || pan) return;                                   // un seul geste à la fois
    // un bouton de l'interface (brouillon…) reste cliquable sous le calque
    var dessous = sousLePoint(ev), ui = dessous && dessous.closest && dessous.closest(".an-ui button, .an-ui label");
    if (ui) { ui.click(); return; }
    // couche prof : toucher la pastille ✓ d'un encadré le coche, sans quitter l'outil
    var P = window.typwebProf, cible = P && P.pastilleSous ? P.pastilleSous(ev.clientX, ev.clientY) : null;
    if (cible) { P.basculerElement(cible); return; }
    if (ev.pointerType === "touch" && etat.doigt !== "ecrit") { panDebut(ev); return; }
    if (edition) { terminerEdition(); if (o === "texte") return; }
    majOrigine();
    var p = local(ev);
    if (o === "note" || o === "correction") { nouvelleNote(ev, o); return; }
    try { calque.setPointerCapture(ev.pointerId); } catch (e) {}
    if (o === "selection") { debutSelection(ev, p); return; }
    if (o === "gomme") { enCours = { gomme: true, avant: instantane(), touche: false }; gommer(ev); return; }
    var e = bloc(dessous), b = boite(e);
    if (o === "texte") { nouveauTexte(e, b, p); return; }
    var t = { id: uid(), ancre: ancre(e), coul: etat.coul, mode: o, taille: etat.taille, pts: [] };
    enCours = { t: t, b: b, abs: [p, p], g: null, maj: ev.shiftKey, prec: { x: ev.pageX, y: ev.pageY, t: ev.timeStamp } };
    if (o === "forme") t.forme = etat.forme;
    else if (o === "stylo") { p.push(pression(ev, null)); enCours.abs = [p]; }
    else enCours.abs = [p];
    retracer();
  }
  function retracer() {
    if (enCours.g) enCours.g.remove();
    var abs = enCours.abs;
    if (enCours.t.mode === "forme" && enCours.maj) abs = contraindre(enCours.t.forme, abs);
    enCours.g = dessinerTrait(enCours.t, abs, calque);
  }
  // Maj : carré, cercle, ligne à 45°
  function contraindre(f, abs) {
    var p0 = abs[0], p1 = abs[1], dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    if (f === "rect" || f === "ellipse") { var m = Math.max(Math.abs(dx), Math.abs(dy)); return [p0, [p0[0] + (dx < 0 ? -m : m), p0[1] + (dy < 0 ? -m : m)]]; }
    if (f === "ligne" || f === "fleche") {
      var a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(dx, dy);
      return [p0, [p0[0] + l * Math.cos(a), p0[1] + l * Math.sin(a)]];
    }
    return abs;
  }
  function bouge(ev) {
    if (pan) { panBouge(ev); return; }
    if (!enCours) return;
    if (enCours.gomme) { gommer(ev); return; }
    if (enCours.selection) { bougeSelection(ev); return; }
    var p = local(ev);
    enCours.maj = ev.shiftKey;
    if (enCours.t.mode === "forme") enCours.abs[1] = p;
    else {
      var z = enCours.abs[enCours.abs.length - 1];
      if (Math.hypot(p[0] - z[0], p[1] - z[1]) < 1.5) return;
      if (enCours.t.mode === "stylo") { p.push(pression(ev, enCours.prec)); enCours.prec = { x: ev.pageX, y: ev.pageY, t: ev.timeStamp }; }
      enCours.abs.push(p);
    }
    retracer();
  }
  function fin(ev) {
    if (pan && (!ev || ev.pointerId === pan.id)) { panFin(); return; }
    if (!enCours) return;
    var c = enCours; enCours = null;
    if (c.gomme) {
      if (c.touche) { pile.push(c.avant); refaire = []; sauver(); majListe(); }
      return;
    }
    if (c.selection) { finSelection(c); return; }
    var t = c.t, b = c.b;
    if (t.mode === "forme") {
      var p0 = c.abs[0], p1 = c.abs[1];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 6) {      // simple clic : forme de taille par défaut
        var d = TAILLE_DEFAUT[t.forme] || [100, 0];
        c.abs[1] = [p0[0] + d[0], p0[1] + d[1]];
      } else if (c.maj) c.abs = contraindre(t.forme, c.abs);
    }
    normaliser(t, c.abs, b);
    memoriser();
    data.traits.push(t);
    sauver(); dessinerTout();
  }

  // ---------- sélection : cliquer / encadrer, déplacer, agrandir ----------
  function itemSous(p) {
    for (var i = data.traits.length - 1; i >= 0; i--) {
      var t = data.traits[i];
      if (t._d) { var b = boiteItem(t); if (b && p[0] >= b.x - 4 && p[0] <= b.x + b.w + 4 && p[1] >= b.y - 4 && p[1] <= b.y + b.h + 4) return t; }
      else if (touche(t, p)) return t;
    }
    return null;
  }
  function debutSelection(ev, p) {
    if (sel.length && surPoignee(p)) {
      var b = boiteSelection();
      enCours = { selection: "taille", o: [b.x, b.y], b0: b, p0: p, avant: instantane() };
      return;
    }
    var t = itemSous(p);
    if (t) {
      if (sel.indexOf(t.id) < 0) choisir(ev.shiftKey ? sel.concat([t.id]) : [t.id]);
      else if (ev.shiftKey) { choisir(sel.filter(function (x) { return x !== t.id; })); return; }
      enCours = { selection: "deplacer", p0: p, avant: instantane() };
      return;
    }
    if (sel.length && dansBoiteSel(p)) { enCours = { selection: "deplacer", p0: p, avant: instantane() }; return; }
    if (!ev.shiftKey) choisir([]);
    enCours = { selection: "cadre", p0: p, g: el("rect", { "class": "an-sel-cadre an-cadre", x: p[0], y: p[1], width: 0, height: 0 }, calque) };
  }
  function transformer(fn) {       // applique une transformation à l'aperçu (groupes SVG et textes)
    sel.forEach(function (id) {
      var t = trouver(id); if (!t) return;
      if (t._g) t._g.setAttribute("transform", fn.svg);
      if (t._d) t._d.style.transform = fn.css;
    });
    if (gSel) gSel.setAttribute("transform", fn.svg);
  }
  function bougeSelection(ev) {
    var c = enCours, p = local(ev);
    if (c.selection === "cadre") {
      var x = Math.min(p[0], c.p0[0]), y = Math.min(p[1], c.p0[1]);
      c.g.setAttribute("x", x); c.g.setAttribute("y", y);
      c.g.setAttribute("width", Math.abs(p[0] - c.p0[0])); c.g.setAttribute("height", Math.abs(p[1] - c.p0[1]));
      c.p1 = p;
    } else if (c.selection === "deplacer") {
      c.dx = p[0] - c.p0[0]; c.dy = p[1] - c.p0[1];
      transformer({ svg: "translate(" + f1(c.dx) + " " + f1(c.dy) + ")", css: "translate(" + f1(c.dx) + "px," + f1(c.dy) + "px)" });
    } else {
      var b = c.b0, sx = (p[0] - b.x) / Math.max(b.w, 1), sy = (p[1] - b.y) / Math.max(b.h, 1);
      var s = Math.max(0.1, Math.max(sx, sy)); c.s = s;
      transformer({ svg: "translate(" + f1(b.x) + " " + f1(b.y) + ") scale(" + s.toFixed(3) + ") translate(" + f1(-b.x) + " " + f1(-b.y) + ")",
                    css: "scale(" + s.toFixed(3) + ")" });
      sel.forEach(function (id) {
        var t = trouver(id); if (!t || !t._d) return;
        var bt = boiteItem(t);
        t._d.style.transformOrigin = f1(b.x - (bt ? bt.x : 0)) + "px " + f1(b.y - (bt ? bt.y : 0)) + "px";
      });
    }
  }
  function finSelection(c) {
    if (c.selection === "cadre") {
      c.g.remove();
      if (!c.p1) { dessinerSelection(); return; }
      var x0 = Math.min(c.p0[0], c.p1[0]), x1 = Math.max(c.p0[0], c.p1[0]), y0 = Math.min(c.p0[1], c.p1[1]), y1 = Math.max(c.p0[1], c.p1[1]);
      var ids = sel.slice();
      data.traits.forEach(function (t) {
        var b = boiteItem(t); if (!b || ids.indexOf(t.id) >= 0) return;
        if (b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0) ids.push(t.id);
      });
      choisir(ids);
      return;
    }
    if (c.selection === "deplacer" && !c.dx && !c.dy) { dessinerSelection(); return; }
    pile.push(c.avant); refaire = [];
    sel.forEach(function (id) {
      var t = trouver(id); if (!t) return;
      var b = boiteAncre(t), abs = absolus(t); if (!b || !abs) return;
      if (c.selection === "deplacer") abs = abs.map(function (q) { var r = [q[0] + c.dx, q[1] + c.dy]; if (q.length > 2) r.push(q[2]); return r; });
      else {
        var s = c.s || 1, o = c.o;
        abs = abs.map(function (q) { var r = [o[0] + (q[0] - o[0]) * s, o[1] + (q[1] - o[1]) * s]; if (q.length > 2) r.push(q[2]); return r; });
        if (t.mode === "texte") t.echelle = +((t.echelle || 1) * s).toFixed(3);
        else if (t.mode === "stylo" || t.mode === "surligneur") t.echelleEp = +((t.echelleEp || 1) * s).toFixed(3);
      }
      normaliser(t, abs, b);
    });
    sauver(); dessinerTout();
  }
  function supprimerSelection() {
    if (!sel.length) return;
    memoriser();
    data.traits = data.traits.filter(function (t) { return sel.indexOf(t.id) < 0; });
    sel = []; sauver(); dessinerTout(); majBoutonsSel();
  }
  function dupliquerSelection() {
    if (!sel.length) return;
    memoriser();
    var nouveaux = [];
    sel.forEach(function (id) {
      var t = trouver(id); if (!t) return;
      var b = boiteAncre(t), abs = absolus(t); if (!b || !abs) return;
      var n = JSON.parse(JSON.stringify(nettoyer(t))); n.id = uid();
      normaliser(n, abs.map(function (q) { var r = [q[0] + 16, q[1] + 16]; if (q.length > 2) r.push(q[2]); return r; }), b);
      data.traits.push(n); nouveaux.push(n.id);
    });
    sauver(); sel = nouveaux; dessinerTout(); majBoutonsSel();
  }
  // couleur / taille appliquées à la sélection (comme tldraw)
  function appliquerASelection(fn) {
    if (!sel.length) return false;
    memoriser();
    sel.forEach(function (id) { var t = trouver(id); if (t) fn(t); });
    sauver(); dessinerTout();
    return true;
  }

  // ---------- texte ----------
  function nouveauTexte(e, b, p) {
    var t = { id: uid(), ancre: ancre(e), coul: etat.coul, mode: "texte", taille: etat.taille, texte: "", pts: [] };
    normaliser(t, [[p[0], p[1] - EP.texte[etat.taille] * 0.7]], b);
    memoriser();
    data.traits.push(t);
    dessinerTout();
    editer(t);
  }
  function editer(t) {
    if (!t._d) return;
    edition = t._d;
    edition.contentEditable = "true"; edition.classList.add("edition");
    edition.focus();
    var r = document.createRange(); r.selectNodeContents(edition); r.collapse(false);
    var s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function terminerEdition() {
    if (!edition) return;
    var d = edition, t = trouver(d.dataset.id); edition = null;
    d.contentEditable = "false"; d.classList.remove("edition");
    if (t) {
      t.texte = d.innerText.replace(/\n$/, "");
      if (!t.texte.trim()) data.traits = data.traits.filter(function (x) { return x !== t; });
    }
    sauver(); dessinerTout();
  }

  // ---------- gomme : efface tout trait touché (trait entier) ----------
  function distSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    var u = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
  }
  function touche(t, p) {
    if (t._d) { var b = boiteItem(t); return !!b && p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h; }
    var c = t._contact; if (!c) return false;
    var marge = 10 + epDe(t) / 2;
    if (c.length === 1 || (c.length === 2 && !c[1])) return c[0] && Math.hypot(p[0] - c[0][0], p[1] - c[0][1]) < marge;
    for (var i = 1; i < c.length; i++) {
      if (!c[i] || !c[i - 1]) continue;
      if (distSeg(p, c[i - 1], c[i]) < marge) return true;
    }
    return false;
  }
  function gommer(ev) {
    var p = local(ev), avant = data.traits.length;
    data.traits = data.traits.filter(function (t) {
      if (!touche(t, p)) return true;
      if (t._g) t._g.remove(); if (t._d) t._d.remove();
      return false;
    });
    if (data.traits.length !== avant) { enCours.touche = true; sel = []; dessinerSelection(); }
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
    couchePied.innerHTML = "";
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
      couchePied.appendChild(d);
      if (n.id === ouvrir) setTimeout(function () { ta.focus(); }, 0);
    });
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
    page: '<path d="M5 3l14 7-6 2-2 6-6-15z"/>',
    selection: '<path d="M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4"/><path d="M9 9l7 3-3 1-1 3z"/>',
    stylo: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>',
    surligneur: '<path d="M11 4l9 9-3 3-9-9 3-3z"/><path d="M11 13l-2 2H5l2-4"/><path d="M4 20h5"/>',
    gomme: '<path d="M17 3l4 4-9.5 9.5H7L3 12.5z"/><path d="M7 16.5L3 20h8"/>',
    texte: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    fleche: '<path d="M5 19L19 5"/><path d="M9 5h10v10"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="6.5"/>',
    ligne: '<path d="M5 19L19 5"/>',
    carre: '<rect x="5" y="5" width="14" height="14"/>',
    cercle: '<circle cx="12" cy="12" r="8"/>',
    trigo: '<circle cx="12" cy="12" r="7"/><line x1="1" y1="12" x2="23" y2="12"/><line x1="12" y1="1" x2="12" y2="23"/>',
    repere: '<path d="M3 12h18"/><path d="M12 21V3"/><path d="M17 8l4 4-4 4"/><path d="M8 7l4-4 4 4"/>',
    note: '<path d="M4 4h16v11l-5 5H4z"/><path d="M15 20v-5h5"/>',
    correction: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 16.5v.5"/>',
    annuler: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
    retablir: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 000 12h3"/>',
    effacer: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
    oeil: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>',
    plus: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
    fermer: '<path d="M9 6l6 6-6 6"/>',
    crayon: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
    main: '<path d="M8 13V5a1.5 1.5 0 013 0v6"/><path d="M11 10V4a1.5 1.5 0 013 0v6"/><path d="M14 10V6a1.5 1.5 0 013 0v7a7 7 0 01-7 7h-.5A5.5 5.5 0 014 16.5L3 13a1.5 1.5 0 012.6-1.4L8 14"/>',
    grille: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 16h16M10 4v16M16 4v16"/>',
    dupliquer: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>'
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
  var boutons = {}, boutonForme, pastilleCoul, effacerBtn, boutonTaille;
  var NOMS = { page: "Page : utiliser la page normalement (C)", selection: "Sélection : cliquer ou encadrer, puis déplacer ou agrandir (V)",
               stylo: "Stylo (D)", surligneur: "Surligneur (M)", gomme: "Gomme : passe sur un trait pour l'effacer (E)",
               texte: "Texte : clique où écrire (T)", note: "Note : clique où la placer", correction: "Correction : clique près de l'erreur, puis décris-la" };
  var FORMES = [["rect", "Rectangle (R) — Maj : carré"], ["ellipse", "Ellipse (O) — Maj : cercle"], ["ligne", "Ligne (L) — Maj : à 45°"],
                ["trigo", "Cercle trigonométrique (U)"], ["repere", "Repère (X)"]];

  function choisirOutil(o, f) {
    if (edition && o !== "texte") terminerEdition();
    etat.outil = o;
    if (o !== "page") etat.dernier = o;
    if (f) etat.forme = f;
    if (o !== "selection" && sel.length) choisir([]);
    document.documentElement.dataset.annot = o === "page" ? "" : o;
    Object.keys(boutons).forEach(function (k) {
      if (k === "doigt" || k === "oeil" || k === "dupliquer") return;
      var on = k === "fleche" ? (o === "forme" && etat.forme === "fleche")
             : k === "forme" ? (o === "forme" && etat.forme !== "fleche") : k === o;
      boutons[k].classList.toggle("on", on); boutons[k].setAttribute("aria-pressed", on ? "true" : "false");
    });
    calque.style.pointerEvents = DESSIN[o] ? "auto" : "none";
    calque.dataset.outil = o; couche.dataset.outil = o;
    dock.classList.toggle("actif", !!DESSIN[o]);
    if (o === "note" || o === "correction" || o === "texte") info(NOMS[o]);
    if (DESSIN[o] && !etat.visible) basculerVisible();
    ouvrirMenu(null);
  }
  function choisirForme(f) {
    if (f !== "fleche") { etat.forme = f; boutonForme.innerHTML = ico(f); }
    menuFormes.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.forme === f); });
    choisirOutil("forme", f);
  }
  function choisirCouleur(c) {
    etat.coul = c;
    pastilleCoul.style.background = c;
    palette.querySelectorAll(".an2-pastille").forEach(function (b) { b.classList.toggle("on", b.dataset.coul === c); });
    if (!appliquerASelection(function (t) { t.coul = c; }) && (etat.outil === "gomme" || etat.outil === "page" || etat.outil === "selection")) choisirOutil("stylo");
    if (edition) { edition.style.color = c; var t = trouver(edition.dataset.id); if (t) t.coul = c; }
    ouvrirMenu(null);
  }
  function choisirTaille(s) {
    etat.taille = s;
    boutonTaille.querySelector(".an2-taille-txt").textContent = s.toUpperCase();
    menuTaille.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.dataset.taille === s); });
    appliquerASelection(function (t) { t.taille = s; t.echelle = 1; t.echelleEp = 1; delete t.ep; });
    ouvrirMenu(null);
  }
  function ouvrirMenu(m) {
    [palette, menuFormes, menuPlus, menuTaille].forEach(function (x) { if (x) x.classList.toggle("ouvert", x === m && !x.classList.contains("ouvert")); });
  }
  function majBoutonsSel() {
    if (!boutons.dupliquer) return;
    boutons.dupliquer.disabled = !sel.length;
  }
  function basculerVisible() {
    etat.visible = !etat.visible;
    calque.style.display = etat.visible ? "" : "none";
    couche.hidden = !etat.visible; couchePied.hidden = !etat.visible;
    document.documentElement.classList.toggle("an-cache", !etat.visible);
    boutons.oeil.classList.toggle("on", !etat.visible);
    info(etat.visible ? "" : "Annotations masquées (l'œil les réaffiche).");
  }
  function ouvrirDock(ouvrir) {
    etat.ouvert = ouvrir;
    dock.classList.toggle("ouvert", ouvrir);
    poignee.classList.toggle("ouverte", ouvrir);
    poignee.querySelector(".an-ouvrir").setAttribute("aria-expanded", ouvrir ? "true" : "false");
    choisirOutil(ouvrir ? etat.dernier : "page");
    if (!ouvrir) { info(""); if (liste) liste.hidden = true; }
  }

  // ---------- doigt : défiler ou écrire (écrans tactiles) ----------
  function majDoigt() {
    if (!boutons.doigt) return;
    var e = etat.doigt === "ecrit";
    boutons.doigt.classList.toggle("on", e);
    boutons.doigt.title = e ? "Le doigt écrit (cliquer : le doigt fait défiler la page)"
                            : "Le doigt fait défiler la page ; le stylet et la souris écrivent (cliquer : le doigt écrit)";
    boutons.doigt.setAttribute("aria-label", boutons.doigt.title);
  }
  function basculerDoigt() {
    etat.doigt = etat.doigt === "ecrit" ? "defile" : "ecrit";
    try { localStorage.setItem("an2-doigt", etat.doigt); } catch (e) {}
    majDoigt();
    info(etat.doigt === "ecrit" ? "Le doigt écrit. Pour faire défiler : outil « page » (C)."
                                : "Le doigt fait défiler la page ; le stylet (ou la souris) écrit.");
  }

  // ---------- brouillon : une zone de dessin sous chaque exercice / activité ----------
  var FONDS = [["blanc", "Blanc"], ["quadrille", "Quadrillé"], ["repere", "Repère"]];
  function etatBrouillon(id) { return data.brouillons[id] || (data.brouillons[id] = { ouvert: false, h: 280, fond: "quadrille" }); }
  function zoneBrouillon(bx, cible) {
    var id = "brouillon-" + bx.id, z = document.getElementById(id);
    if (z) return z;
    var st = etatBrouillon(bx.id);
    z = document.createElement("div"); z.id = id; z.className = "an-brouillon";
    var barre = document.createElement("div"); barre.className = "an-brouillon-barre an-ui";
    var titre = document.createElement("span"); titre.className = "an-brouillon-titre"; titre.textContent = "Brouillon";
    barre.appendChild(titre);
    FONDS.forEach(function (f) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = f[1]; b.dataset.fond = f[0];
      b.addEventListener("click", function () { st.fond = f[0]; appliquer(); sauver(); });
      barre.appendChild(b);
    });
    function petit(txt, titreB, fn) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = txt; b.title = titreB; b.setAttribute("aria-label", titreB);
      b.addEventListener("click", fn); barre.appendChild(b); return b;
    }
    petit("＋", "Agrandir le brouillon", function () { st.h = Math.min(st.h + 200, 2400); appliquer(); sauver(); });
    petit("−", "Réduire le brouillon", function () { st.h = Math.max(st.h - 200, 160); appliquer(); sauver(); });
    var eff = petit("Effacer", "Effacer ce brouillon (cliquer deux fois)", function () {
      if (!eff.dataset.confirme) {
        eff.dataset.confirme = "1"; eff.classList.add("confirme"); info("Clique encore une fois pour effacer ce brouillon.");
        setTimeout(function () { delete eff.dataset.confirme; eff.classList.remove("confirme"); }, 4000);
        return;
      }
      memoriser();
      data.traits = data.traits.filter(function (t) { return !(t.ancre && t.ancre.id === id); });
      sauver(); dessinerTout(); info("Brouillon effacé (Ctrl+Z pour annuler).");
    });
    petit("Fermer", "Fermer le brouillon (ce qui est dessiné est gardé)", function () { st.ouvert = false; appliquer(); sauver(); });
    z.appendChild(barre);
    function appliquer() {
      z.style.height = st.h + "px";
      z.hidden = !st.ouvert;
      z.className = "an-brouillon fond-" + st.fond;
      barre.querySelectorAll("[data-fond]").forEach(function (b) { b.classList.toggle("on", b.dataset.fond === st.fond); });
      var bt = cible.querySelector(".an-brouillon-btn");
      if (bt) bt.hidden = st.ouvert;
      setTimeout(dessinerTout, 0);
    }
    z._appliquer = appliquer;
    var bt = cible.querySelector(".an-brouillon-btn");
    cible.insertBefore(z, bt || null);
    return z;
  }
  function ouvrirBrouillon(bx, cible, outil) {
    var st = etatBrouillon(bx.id);
    st.ouvert = true;
    var z = zoneBrouillon(bx, cible);
    z._appliquer(); sauver();
    if (outil) {
      if (!etat.ouvert) ouvrirDock(true);
      if (!DESSIN[etat.outil] || etat.outil === "note" || etat.outil === "correction" || etat.outil === "selection") choisirOutil("stylo");
      setTimeout(function () { z.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50);
    }
  }
  function preparerBrouillons() {
    racine.querySelectorAll(".exo, .theo-activite").forEach(function (bx) {
      if (!bx.id || bx.dataset.anBrouillon) return;
      bx.dataset.anBrouillon = "1";
      var cible = bx.querySelector(".exo-corps, .theo-body") || bx;
      var b = document.createElement("button"); b.type = "button"; b.className = "an-brouillon-btn an-ui";
      b.innerHTML = ico("grille") + "<span>Brouillon</span>";
      b.title = "Ouvrir une zone de brouillon pour chercher cet exercice";
      b.addEventListener("click", function () { ouvrirBrouillon(bx, cible, true); });
      cible.appendChild(b);
      var st = data.brouillons[bx.id];
      if (st && st.ouvert) ouvrirBrouillon(bx, cible, false);
    });
  }

  var CSS = [
    ".an2-calque{position:absolute;left:0;top:0;z-index:1030;pointer-events:none;overflow:visible}",
    ".an2-calque[data-outil=stylo],.an2-calque[data-outil=surligneur],.an2-calque[data-outil=forme]{cursor:crosshair;touch-action:none}",
    ".an2-calque[data-outil=selection]{cursor:default;touch-action:none}",
    ".an2-calque[data-outil=gomme]{cursor:cell;touch-action:none}",
    ".an2-calque[data-outil=texte]{cursor:text;touch-action:none}",
    ".an2-calque[data-outil=note],.an2-calque[data-outil=correction]{cursor:copy;touch-action:none}",
    ".an2-calque path,.an2-calque rect,.an2-calque circle,.an2-calque ellipse{stroke-linecap:round;stroke-linejoin:round}",
    ".an-t-surligneur path{stroke-opacity:.38;mix-blend-mode:multiply}",
    ":root[data-theme=dark] .an-t-surligneur path{mix-blend-mode:screen;stroke-opacity:.45}",
    ".an-sel-cadre{fill:rgba(31,95,191,.04);stroke:#1f5fbf;stroke-width:1.2;stroke-dasharray:5 4;pointer-events:none}",
    ".an-sel-poignee{fill:#fff;stroke:#1f5fbf;stroke-width:1.5;pointer-events:none}",
    ".an2-couche,.an2-pied{position:absolute;left:0;top:0;width:0;height:0}",
    ".an2-couche{z-index:1031}",
    ".an2-pied{z-index:1035}",
    ".an-texte{position:absolute;white-space:pre;font:600 18px/1.3 Inter,system-ui,sans-serif;padding:2px 4px;border-radius:4px;pointer-events:none;min-width:1ch;outline:none}",
    ".an-texte.edition{pointer-events:auto;box-shadow:0 0 0 1.5px #1f5fbf;background:rgba(255,255,255,.75);cursor:text}",
    ":root[data-theme=dark] .an-texte.edition{background:rgba(30,36,44,.8)}",
    ".an-texte.choisi{box-shadow:0 0 0 1px rgba(31,95,191,.5)}",
    ".an2-dock{position:fixed;right:14px;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(160%);z-index:1070;flex-direction:column;",
    " display:flex;align-items:center;gap:2px;padding:6px;background:rgba(255,255,255,.9);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);",
    " border:1px solid rgba(20,48,74,.08);border-radius:16px;box-shadow:0 6px 24px rgba(20,48,74,.16),0 1px 2px rgba(20,48,74,.08);",
    " font:14px/1.3 Inter,system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;max-height:calc(100vh - 16px)}",
    ".an2-dock.ouvert{transform:none;opacity:.8;pointer-events:auto}",
    ".an2-dock.ouvert:hover,.an2-dock.ouvert.actif{opacity:1}",
    ":root[data-theme=dark] .an2-dock{background:rgba(39,48,58,.94);border-color:rgba(255,255,255,.08)}",
    ".an2-groupe{display:flex;flex-direction:column;gap:2px;padding:1px 0;position:relative}",
    ".an2-sep{height:1px;align-self:stretch;margin:2px 4px;background:rgba(20,48,74,.12)}",
    ":root[data-theme=dark] .an2-sep{background:rgba(255,255,255,.14)}",
    ".an2-btn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:transparent;color:#14304a;cursor:pointer;padding:0}",
    ":root[data-theme=dark] .an2-btn{color:#dde2e8}",
    ".an2-btn svg{width:18px;height:18px}",
    ".an2-btn:hover{background:rgba(20,48,74,.07)}",
    ".an2-btn.on{background:#e7f0ff;color:#1f5fbf}",
    ".an2-btn:disabled{opacity:.35;cursor:default}",
    ":root[data-theme=dark] .an2-btn.on{background:#2f3f55;color:#a9c1de}",
    ".an2-btn.danger.confirme{background:#e63946;color:#fff}",
    ".an2-taille-txt{font:700 11px Inter,system-ui,sans-serif;letter-spacing:.02em}",
    ".an2-pt{width:20px;height:20px;border-radius:999px;border:2px solid #fff;box-shadow:0 0 0 1.5px rgba(20,48,74,.35);display:block}",
    ".an2-menu{position:absolute;right:calc(100% + 10px);bottom:0;display:none;padding:6px;background:rgba(255,255,255,.97);",
    " border:1px solid rgba(20,48,74,.1);border-radius:13px;box-shadow:0 6px 20px rgba(20,48,74,.18);z-index:2}",
    ":root[data-theme=dark] .an2-menu{background:#27303a;border-color:rgba(255,255,255,.1)}",
    ".an2-menu.ouvert{display:flex;gap:3px}",
    ".an2-menu.an2-palette.ouvert{display:grid;grid-template-columns:repeat(6,auto);gap:0}",
    ".an2-menu.an2-plus.ouvert{flex-direction:column;align-items:stretch;min-width:15rem}",
    ".an2-plus button{display:block;width:100%;text-align:left;border:0;background:none;color:inherit;padding:.4rem .6rem;border-radius:8px;cursor:pointer;font:inherit}",
    ".an2-plus button:hover{background:rgba(20,48,74,.07)}",
    ".an2-menu.an2-tailles button{font:700 12px Inter,system-ui,sans-serif;width:38px}",
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
    // disposition « menu » (grand écran) : deux lignes sous les symboles du menu de gauche
    ".an2-dock[data-mode=menu]{position:relative;z-index:1060;right:auto;bottom:auto;transform:none;display:none;flex-direction:row;flex-wrap:wrap;",
    " width:232px;max-width:100%;margin:10px 0 6px;padding:4px;opacity:1;transition:none;box-shadow:0 1px 4px rgba(20,48,74,.12);}",
    ".an2-dock[data-mode=menu].ouvert{display:flex}",
    ".an2-dock[data-mode=menu] .an2-groupe{display:contents}",
    ".an2-dock[data-mode=menu] .an2-sep{display:none}",
    ".an2-dock[data-mode=menu] .an2-btn{width:28px;height:28px}",
    ".an2-dock[data-mode=menu] .an2-btn svg{width:16px;height:16px}",
    ".an2-dock[data-mode=menu] .an2-menu{right:auto;bottom:auto;left:0;top:calc(100% + 6px)}",
    "html.an2-dans-menu[data-annot]:not([data-annot='']) #quarto-sidebar{z-index:1040!important}",
    ".an2-plus button[hidden]{display:none}",
    "@media (max-width:640px){.an2-dock{right:6px}}",
    ".an-brouillon-btn{display:inline-flex;align-items:center;gap:.35rem;margin:.7rem 0 .1rem;border:0;border-radius:99px;padding:.3rem .85rem;",
    " font:600 .85rem Inter,system-ui,sans-serif;background:var(--q,#f2f3f5);color:var(--accent,#46607e);cursor:pointer}",
    ".an-brouillon-btn svg{width:16px;height:16px}",
    ".an-brouillon-btn[hidden]{display:none}",
    ".an-brouillon{position:relative;margin:.8rem 0 .3rem;border:1.5px solid var(--rule,#e4e8ee);border-radius:14px;background-color:var(--carte,#fff);overflow:hidden}",
    ".an-brouillon[hidden]{display:none}",
    ".an-brouillon.fond-quadrille{background-image:linear-gradient(var(--an-grille,#d9dfe6) 1px,transparent 1px),linear-gradient(90deg,var(--an-grille,#d9dfe6) 1px,transparent 1px);background-size:20px 20px}",
    ".an-brouillon.fond-repere{background-image:linear-gradient(var(--h,#2f3a47),var(--h,#2f3a47)),linear-gradient(var(--h,#2f3a47),var(--h,#2f3a47)),",
    " linear-gradient(var(--an-grille,#d9dfe6) 1px,transparent 1px),linear-gradient(90deg,var(--an-grille,#d9dfe6) 1px,transparent 1px);",
    " background-size:100% 1.5px,1.5px 100%,20px 20px,20px 20px;background-position:0 50%,50% 0,0 0,0 0;background-repeat:no-repeat,no-repeat,repeat,repeat}",
    ":root[data-theme=dark]{--an-grille:#3a4552}",
    ".an-brouillon-barre{position:absolute;top:6px;left:8px;right:8px;display:flex;flex-wrap:wrap;align-items:center;gap:4px;z-index:1;pointer-events:none}",
    ".an-brouillon-barre>*{pointer-events:auto}",
    ".an-brouillon-titre{font:700 .68rem Inter,system-ui,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--muted,#59626e);margin-right:auto;pointer-events:none!important}",
    ".an-brouillon-barre button{font:600 .75rem Inter,system-ui,sans-serif;border:0;border-radius:99px;padding:.2rem .6rem;cursor:pointer;",
    " background:rgba(255,255,255,.9);color:var(--muted,#59626e);box-shadow:0 1px 3px rgba(0,0,0,.12)}",
    ":root[data-theme=dark] .an-brouillon-barre button{background:rgba(39,48,58,.95)}",
    ".an-brouillon-barre button.on{color:var(--accent,#46607e);box-shadow:0 0 0 1.5px var(--accent,#46607e)}",
    ".an-brouillon-barre button.confirme{background:#e63946;color:#fff}",
    "@media print{.an2-dock,.an2-msg,.an-barre,.an-liste,.an-brouillon-btn,.an-brouillon-barre,.an-sel{display:none!important}}"
  ].join("\n");

  // ---------- disposition : sous les symboles du menu de gauche (grand écran) ou en bas à droite ----------
  var VISIBLES = {
    menu: ["page", "selection", "stylo", "surligneur", "gomme", "texte", "fleche", "forme", "couleur", "taille", "annuler", "retablir", "effacer", "plus"],
    bas: ["page", "selection", "stylo", "gomme", "forme", "couleur", "taille", "annuler", "plus"]
  };
  var cles = {};                 // clé → bouton du dock
  var entreesPlus = {};          // clé → entrée du menu « ⋯ »
  var grandEcran = window.matchMedia("(min-width: 992px)");
  function disposer() {
    var lieu = document.querySelector("#quarto-sidebar .sidebar-title");
    var mode = grandEcran.matches && lieu && !document.documentElement.classList.contains("proj") ? "menu" : "bas";
    if (dock.dataset.mode === mode && (mode === "bas" ? dock.parentNode === document.body : dock.previousSibling === lieu)) return;
    dock.dataset.mode = mode;
    document.documentElement.classList.toggle("an2-dans-menu", mode === "menu");
    if (mode === "menu") lieu.parentNode.insertBefore(dock, lieu.nextSibling); else document.body.appendChild(dock);
    Object.keys(cles).forEach(function (k) { cles[k].style.display = VISIBLES[mode].indexOf(k) >= 0 ? "" : "none"; });
    Object.keys(entreesPlus).forEach(function (k) { entreesPlus[k].hidden = VISIBLES[mode].indexOf(k) >= 0; });
    ouvrirMenu(null);
  }

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
    ["page", "selection", "stylo", "surligneur", "gomme", "texte"].forEach(function (o) {
      boutons[o] = cles[o] = bouton(ico(o), NOMS[o], function () { choisirOutil(o); });
      g1.appendChild(boutons[o]);
    });
    boutons.fleche = cles.fleche = bouton(ico("fleche"), "Flèche (A) — Maj : à 45°", function () { choisirForme("fleche"); });
    g1.appendChild(boutons.fleche);
    var gf = document.createElement("div"); gf.className = "an2-groupe"; g1.appendChild(gf);
    boutonForme = bouton(ico("rect"), "Formes : rectangle (R), ellipse (O), ligne (L), cercle trigonométrique (U), repère (X)", function (e) {
      e.stopPropagation();
      var ouvert = menuFormes.classList.contains("ouvert");
      choisirOutil("forme", etat.forme === "fleche" ? "rect" : etat.forme);
      if (!ouvert) ouvrirMenu(menuFormes);
    });
    boutons.forme = cles.forme = boutonForme; gf.appendChild(boutonForme);
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
    bc.appendChild(pastilleCoul); gc.appendChild(bc); cles.couleur = bc;
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
    boutonTaille = bouton('<span class="an2-taille-txt">M</span>', "Taille du trait et du texte : S, M, L, XL", function (e) { e.stopPropagation(); ouvrirMenu(menuTaille); });
    gc.appendChild(boutonTaille); cles.taille = boutonTaille;
    menuTaille = document.createElement("div"); menuTaille.className = "an2-menu an2-tailles";
    TAILLES.forEach(function (s) {
      var b = bouton(s.toUpperCase(), "Taille " + s.toUpperCase(), function (e) { e.stopPropagation(); choisirTaille(s); }, s === etat.taille ? "on" : "");
      b.dataset.taille = s; menuTaille.appendChild(b);
    });
    gc.appendChild(menuTaille);
    sep();
    var gn = groupe();
    ["note", "correction"].forEach(function (o) { boutons[o] = cles[o] = bouton(ico(o), NOMS[o], function () { choisirOutil(o); }); gn.appendChild(boutons[o]); });
    if (TACTILE) {
      boutons.doigt = cles.doigt = bouton(ico("main"), "", basculerDoigt);
      gn.appendChild(boutons.doigt);
      majDoigt();
    }
    sep();
    var ga = groupe();
    ga.appendChild(cles.annuler = bouton(ico("annuler"), "Annuler (Ctrl/Cmd+Z)", annuler));
    ga.appendChild(cles.retablir = bouton(ico("retablir"), "Rétablir (Ctrl/Cmd+Maj+Z)", retablir));
    boutons.dupliquer = cles.dupliquer = bouton(ico("dupliquer"), "Dupliquer la sélection (Ctrl/Cmd+D)", dupliquerSelection);
    ga.appendChild(boutons.dupliquer);
    effacerBtn = bouton(ico("effacer"), "Supprimer la sélection (Suppr) ; sans sélection : effacer la page", function () {
      if (sel.length) supprimerSelection(); else effacerPage();
    }, "danger");
    ga.appendChild(effacerBtn); cles.effacer = effacerBtn;
    sep();
    var gm = groupe();
    boutons.oeil = cles.oeil = bouton(ico("oeil"), "Masquer ou afficher les annotations", basculerVisible);
    gm.appendChild(boutons.oeil);
    gm.appendChild(cles.plus = bouton(ico("plus"), "Plus d'outils et d'actions", function (e) { e.stopPropagation(); ouvrirMenu(menuPlus); }));
    menuPlus = document.createElement("div"); menuPlus.className = "an2-menu an2-plus";
    var fin = document.createElement("input"); fin.type = "file"; fin.accept = ".json,application/json"; fin.hidden = true; fin.id = "an-import";
    fin.addEventListener("change", function () { if (fin.files[0]) importer(fin.files[0]); fin.value = ""; });
    // entrées du « ⋯ » : une entrée dont le bouton est déjà visible dans la barre est masquée
    [["surligneur", "Surligneur (M)", function () { choisirOutil("surligneur"); }],
     ["texte", "Texte (T)", function () { choisirOutil("texte"); }],
     ["fleche", "Flèche (A)", function () { choisirForme("fleche"); }],
     ["note", "Note", function () { choisirOutil("note"); }],
     ["correction", "Correction", function () { choisirOutil("correction"); }],
     ["retablir", "Rétablir (Ctrl+Maj+Z)", retablir],
     ["dupliquer", "Dupliquer la sélection (Ctrl+D)", dupliquerSelection],
     ["effacer", "Supprimer la sélection / effacer la page", function () { effacerBtn.click(); }],
     ["oeil", "Masquer ou afficher les annotations", basculerVisible],
     ["doigt", "Doigt : défiler ou écrire", basculerDoigt],
     ["", "Corrections notées (toutes les pages)", function () { liste.hidden = !liste.hidden; majListe(); }],
     ["", "Exporter mes annotations (fichier)", exporter],
     ["", "Importer des annotations", function () { fin.click(); }],
     ["fermer", "Fermer l'outil d'écriture (Y)", function () { ouvrirDock(false); }]].forEach(function (x) {
      if (x[0] === "doigt" && !TACTILE) return;
      var b = document.createElement("button"); b.type = "button"; b.textContent = x[1];
      b.addEventListener("click", function (e) { e.stopPropagation(); ouvrirMenu(null); x[2](); });
      menuPlus.appendChild(b);
      if (x[0]) entreesPlus[x[0]] = b;
    });
    menuPlus.appendChild(fin);
    gm.appendChild(menuPlus);
    gm.appendChild(cles.fermer = bouton(ico("fermer"), "Fermer l'outil d'écriture (Y)", function () { ouvrirDock(false); }));
    [boutonForme, bc, boutonTaille, cles.plus].forEach(function (b) { b.dataset.ouvreMenu = "1"; });
    document.body.appendChild(dock);
    disposer();
    if (grandEcran.addEventListener) grandEcran.addEventListener("change", disposer);
    new MutationObserver(disposer).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    [400, 1300].forEach(function (t) { setTimeout(disposer, t); });      // la barre de titre est construite par tools.html
    majBoutonsSel();

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
      // un clic dans un menu, ou sur le bouton qui l'ouvre (le second clic le referme), ne ferme rien ici
      if (e.target.closest && e.target.closest(".an2-menu, [data-ouvre-menu]")) return;
      ouvrirMenu(null);
    }, true);
  }
  function effacerPage() {
    if (effacerBtn.dataset.confirme) {
      memoriser();
      document.querySelectorAll("mark.an-hl").forEach(function (m) { retirerSurl(m.dataset.id); });
      data.traits = []; data.notes = []; data.surl = []; sel = [];
      sauver(); dessinerTout(); majListe();
      delete effacerBtn.dataset.confirme; effacerBtn.classList.remove("confirme");
      info("Annotations de la page effacées (Ctrl+Z pour annuler).");
    } else {
      effacerBtn.dataset.confirme = "1"; effacerBtn.classList.add("confirme");
      info("Clique encore une fois pour effacer toutes les annotations de la page.");
      setTimeout(function () { delete effacerBtn.dataset.confirme; effacerBtn.classList.remove("confirme"); }, 4000);
    }
  }

  // ---------- clavier (raccourcis de tldraw) ----------
  function enSaisie() {
    var a = document.activeElement;
    return a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
  }
  window.addEventListener("keydown", function (ev) {
    var k = (ev.key || "").toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
    if (edition) {                                   // texte en cours de frappe
      if (k === "escape" || (k === "enter" && mod)) { ev.preventDefault(); terminerEdition(); }
      return;
    }
    if (enSaisie()) return;
    var fait = true;
    if (k === "y" && !mod && !ev.altKey) ouvrirDock(!etat.ouvert);
    else if (!etat.ouvert) fait = false;
    else if (mod && k === "z") { if (ev.shiftKey) retablir(); else annuler(); }
    else if (mod && k === "y") retablir();
    else if (mod && k === "d") dupliquerSelection();
    else if (mod && k === "a" && etat.outil === "selection") choisir(data.traits.filter(function (t) { return t._g || t._d; }).map(function (t) { return t.id; }));
    else if (mod || ev.altKey) fait = false;
    else if ((k === "delete" || k === "backspace") && sel.length) supprimerSelection();
    else if (k === "c") choisirOutil("page");
    else if (k === "v") choisirOutil("selection");
    else if (k === "d" || k === "p") choisirOutil("stylo");
    else if (k === "m") choisirOutil("surligneur");
    else if (k === "e") choisirOutil("gomme");
    else if (k === "t") choisirOutil("texte");
    else if (k === "a") choisirForme("fleche");
    else if (k === "r") choisirForme("rect");
    else if (k === "o") choisirForme("ellipse");
    else if (k === "l") choisirForme("ligne");
    else if (k === "u") choisirForme("trigo");
    else if (k === "x") choisirForme("repere");
    else if (k === "1" || k === "2" || k === "3" || k === "4") choisirCouleur(PALETTE[+k - 1][0]);
    else if (k === "escape") { if (sel.length) choisir([]); else if (etat.outil !== "page") choisirOutil("page"); else ouvrirDock(false); }
    else fait = false;
    if (fait) { ev.preventDefault(); ev.stopImmediatePropagation(); }
  }, true);

  // ---------- démarrage ----------
  function construire() {
    racine = document.getElementById("quarto-document-content") || document.querySelector("main") || document.body;
    charger();
    calque = document.createElementNS(NS, "svg");
    calque.setAttribute("class", "an2-calque an-calque"); calque.setAttribute("aria-hidden", "true");
    document.body.appendChild(calque);             // toute la page : texte, marges, menu
    couche = document.createElement("div"); couche.className = "an2-couche an-ui";     // textes
    document.body.appendChild(couche);
    couchePied = document.createElement("div"); couchePied.className = "an2-pied an-couche an-ui";   // notes
    document.body.appendChild(couchePied);
    construireInterface();

    calque.addEventListener("pointerdown", debut);
    // outil d'écriture actif : pas de menu contextuel (clic droit, bouton du stylet, appui long)
    document.addEventListener("contextmenu", function (ev) {
      if (document.documentElement.dataset.annot) ev.preventDefault();
    }, true);
    calque.addEventListener("pointermove", bouge);
    calque.addEventListener("pointerup", fin);
    calque.addEventListener("pointercancel", fin);
    calque.addEventListener("lostpointercapture", fin);
    // double-clic (outil sélection ou texte) sur un texte : le modifier
    calque.addEventListener("dblclick", function (ev) {
      if (etat.outil !== "selection" && etat.outil !== "texte") return;
      majOrigine();
      var t = itemSous(local(ev));
      if (t && t.mode === "texte") { choisir([]); editer(t); }
    });

    data.surl.forEach(appliquerSurl);
    preparerBrouillons();
    dessinerTout();
    choisirOutil("page");
    // les figures et les formules se construisent après : redessiner
    [300, 1200, 3000].forEach(function (t) { setTimeout(dessinerTout, t); });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { if (!enCours && !edition) dessinerTout(); }) : null;
    if (ro) { ro.observe(racine); ro.observe(document.body); }
    window.addEventListener("resize", function () { if (!enCours && !edition) dessinerTout(); });
  }

  if (document.readyState !== "loading") construire();
  else document.addEventListener("DOMContentLoaded", construire);
  window.Annot = { redessiner: function () { dessinerTout(); }, donnees: function () { return data; },
                   ouvrir: function (o) { ouvrirDock(o !== false); }, outil: function (o) { choisirOutil(o); } };
})();
