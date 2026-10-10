/* ============================================================
   trigo.js — animations du module typweb « trigo » (trigonométrie).
   Chaque animation est un <div class="tg" data-tg="…" data-cfg='{…}'>
   généré depuis les notes Typst par #anim("…", réglages)[texte] :
     enroulement      le point tourne sur le cercle ; sin, cos ou tan de x
                      se trace en même temps sur le graphique
     roue             grande roue : la cabine tourne, h(t) se trace
     anneaux          aire du disque : anneaux, deux escaliers, s_n et S_n
     cercle-equation  sin x = a, cos x = a, tan x = a : points et solutions
     parametres       a sin(bx + c) : curseurs, prédiction (choix / esquisse)
     pente-sinus      tangente qui glisse sur sin, pente tracée
     axe-tours        réel sur l'axe ↔ point du cercle, tours, mesure principale
   SVG natif, aucune dépendance. Couleurs : variables du thème (mêmes
   classes que interactif.css). Valeurs : Math.sin / Math.cos (exactes à la
   précision du nombre flottant), affichées avec virgule décimale.
   ============================================================ */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var PI = Math.PI;

  // ------------------------------------------------------------ outils
  function fmt(v, d) {
    if (!isFinite(v)) return "—";
    var s = (Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v).toFixed(d);
    return s.replace("-", "−").replace(".", ",");
  }
  // décimal sans zéros inutiles (au plus d décimales)
  function fmtc(v, d) { var s = fmt(v, d == null ? 4 : d); return s.indexOf(",") < 0 ? s : s.replace(/0+$/, "").replace(/,$/, ""); }
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function bouton(txt, on, titre) { var b = h("button", "ia-btn", txt); b.type = "button"; if (titre) b.title = titre; b.addEventListener("click", on); return b; }
  function curseur(label, min, max, pas, val, onInput, affiche) {
    var w = h("label", "ia-curseur");
    w.appendChild(h("span", "ia-lab", label));
    var r = h("input"); r.type = "range"; r.min = min; r.max = max; r.step = pas; r.value = val;
    var v = h("span", "ia-val");
    w.appendChild(r); w.appendChild(v);
    function maj() { v.textContent = affiche ? affiche(+r.value) : fmt(+r.value, 2); onInput(+r.value); }
    r.addEventListener("input", maj);
    w.regler = function (x) { r.value = x; v.textContent = affiche ? affiche(x) : fmt(x, 2); };   // x exact (pas arrondi au pas du curseur)
    w.maj = maj;
    return w;
  }
  // multiple de π écrit exactement si possible (dénominateurs 1, 2, 3, 4, 6), sinon décimal
  function enPi(x) {
    var dens = [1, 2, 3, 4, 6];
    for (var i = 0; i < dens.length; i++) {
      var d = dens[i], k = Math.round(x / PI * d);
      if (Math.abs(x - k * PI / d) < 1e-9) {
        if (k === 0) return "0";
        var g = pgcd(Math.abs(k), d), n = k / g, q = d / g;
        var num = (n === 1 ? "" : n === -1 ? "−" : String(n).replace("-", "−")) + "π";
        return q === 1 ? num : num + "/" + q;
      }
    }
    return fmt(x, 4);
  }
  function pgcd(a, b) { return b ? pgcd(b, a % b) : a; }
  function reduitMouvement() { return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // Panneau de valeurs : caché par défaut, ouvert par un bouton.
  function panneauValeurs(host, titre) {
    var boite = h("div", "ia-tab-boite tg-valeurs"); boite.hidden = true;
    var b = bouton("valeurs", function () {
      boite.hidden = !boite.hidden; b.classList.toggle("on", !boite.hidden);
      if (!boite.hidden && boite.remplir) boite.remplir();
    }, titre || "afficher les valeurs");
    boite.bouton = b;
    return boite;
  }

  // Lecture / pause (requestAnimationFrame). avance(dt en s) ; renvoie false pour s'arrêter.
  function animateur(avance, surEtat) {
    var actif = false, t0 = null, id = null;
    function boucle(t) {
      if (!actif) return;
      if (t0 != null && avance((t - t0) / 1000) === false) { arreter(); return; }
      t0 = t; id = requestAnimationFrame(boucle);
    }
    function lancer() { if (actif) return; actif = true; t0 = null; id = requestAnimationFrame(boucle); surEtat(true); }
    function arreter() { actif = false; if (id) cancelAnimationFrame(id); surEtat(false); }
    return { lancer: lancer, arreter: arreter, actif: function () { return actif; } };
  }

  // ------------------------------------------------------------ enroulement
  // Cercle trigonométrique (rayon = unité) à gauche, graphique à droite, avec la
  // MÊME unité : l'arc parcouru sur le cercle se retrouve, déroulé, sur l'axe.
  // sin : ordonnée de P(x) ; cos : abscisse de P(x) ; tan : ordonnée du point où
  // la droite OP(x) coupe l'axe des tangentes (x = 1), c.-à-d. la pente de OP(x).
  function enroulement(host, c) {
    var fn = c.fonction === "cos" || c.fonction === "tan" ? c.fonction : "sin";
    var tours = Math.max(1, Math.min(3, Math.round(c.tours || 1)));
    var xmax = 2 * PI * tours;
    var sens = c.arriere ? -1 : 1;                          // −1 : tours en arrière (sens horaire, x < 0)
    var lo, hi, x = sens * Math.min(xmax, Math.abs(+c.x || 0));
    var R = 62, M = 14;                                     // rayon (px) = unité
    var ext = fn === "tan" ? 2.5 : 1, lim = ext + 0.2;      // demi-hauteur utile (unités)
    var zone = h("div", "tg-zone"); host.appendChild(zone);

    // cercle
    var Wc = 2 * R + 2 * M + 34, Hc = 2 * ext * R + 2 * M + 34;
    var sc = el("svg", { viewBox: "0 0 " + Wc + " " + Hc, "class": "ia-svg tg-cercle", role: "img", "aria-label": "cercle trigonométrique" }, null);
    zone.appendChild(sc);
    var cx = M + R + 10, cy = M + ext * R + 18;
    function CX(u) { return cx + u * R; } function CY(v) { return cy - v * R; }
    el("line", { x1: CX(-1.2), y1: cy, x2: CX(1.25), y2: cy, "class": "ia-axe" }, sc);
    el("line", { x1: cx, y1: CY(-1.2), x2: cx, y2: CY(1.22), "class": "ia-axe" }, sc);
    el("circle", { cx: cx, cy: cy, r: R, "class": "ia-courbe tg-cercle-trace" }, sc);
    el("text", { x: CX(1) + 3, y: cy + 13, "class": "ia-grad" }, sc).textContent = "1";
    if (fn === "tan") {                                     // axe des tangentes, gradué
      el("line", { x1: CX(1), y1: CY(-lim), x2: CX(1), y2: CY(lim), "class": "tg-axe-tan" }, sc);
      [-2, -1, 1, 2].forEach(function (v) {
        el("line", { x1: CX(1) - 3, y1: CY(v), x2: CX(1) + 3, y2: CY(v), "class": "tg-axe-tan" }, sc);
        el("text", { x: CX(1) + 6, y: CY(v) + 4, "class": "ia-grad" }, sc).textContent = v < 0 ? "−" + (-v) : String(v);
      });
    }
    var gC = el("g", {}, sc);

    // graphique : [0 ; 2π·tours] (sens trigonométrique) ou [−2π·tours ; 0] (en arrière)
    var u = R, Hg = Hc, gauche, gy0 = cy;
    var sg = el("svg", { "class": "ia-svg tg-graphe", role: "img", "aria-label": "graphique" }, null);
    zone.appendChild(sg);
    function GX(v) { return gauche + (v - lo) * u; } function GY(v) { return gy0 - v * u; }
    var gFond = el("g", {}, sg);
    var etiq = el("text", { y: GY(ext + 0.12), "class": "ia-lab-axe" }, sg);
    var fantome = el("path", { "class": "ia-fantome" }, sg);
    var gG = el("g", {}, sg);
    function fond() {
      lo = sens > 0 ? 0 : -xmax; hi = sens > 0 ? xmax : 0;
      gauche = sens > 0 ? M + 18 : M + 8;
      sg.setAttribute("viewBox", "0 0 " + ((hi - lo) * u + gauche + 40) + " " + Hg);
      gFond.innerHTML = "";
      for (var k = 0; k <= 4 * tours; k++) {
        var xv = lo + k * PI / 2;
        el("line", { x1: GX(xv), y1: GY(ext + 0.2), x2: GX(xv), y2: GY(-ext - 0.2), "class": "ia-grille" }, gFond);
        if (Math.abs(xv) > 1e-9) el("text", { x: GX(xv), y: gy0 + 16, "text-anchor": "middle", "class": "ia-grad" }, gFond).textContent = enPi(xv);
        if (fn === "tan" && k % 2 === 1)                    // asymptotes x = π/2 + kπ
          el("line", { x1: GX(xv), y1: GY(lim), x2: GX(xv), y2: GY(-lim), "class": "ia-asym" }, gFond);
      }
      (fn === "tan" ? [-2, -1, 1, 2] : [-1, 1]).forEach(function (v) {
        el("line", { x1: GX(lo), y1: GY(v), x2: GX(hi), y2: GY(v), "class": "ia-grille" }, gFond);
        el("text", { x: sens > 0 ? GX(0) - 6 : GX(0) + 6, y: GY(v) + 4, "text-anchor": sens > 0 ? "end" : "start", "class": "ia-grad" }, gFond).textContent = v < 0 ? "−" + (-v) : String(v);
      });
      el("line", { x1: GX(lo) - 4, y1: gy0, x2: GX(hi) + 14, y2: gy0, "class": "ia-axe" }, gFond);
      el("line", { x1: GX(0), y1: GY(-ext - 0.25), x2: GX(0), y2: GY(ext + 0.3), "class": "ia-axe" }, gFond);
      el("text", { x: GX(hi) + 16, y: gy0 + 4, "class": "ia-lab-axe" }, gFond).textContent = "x";
      etiq.setAttribute("x", GX(lo + (fn === "tan" ? PI : PI / 2)) + 8);
    }
    fond();

    function f(t) {
      if (fn === "sin") return Math.sin(t);
      if (fn === "cos") return Math.cos(t);
      return Math.abs(Math.cos(t)) < 1e-12 ? NaN : Math.tan(t);   // tan n'existe pas si cos x = 0
    }
    function borne(v) { return Math.max(-lim, Math.min(lim, v)); }
    // tracé de y = f(t) entre a et b, coupé aux asymptotes et au bord du cadre
    function chemin(a, b) {
      var n = Math.max(2, Math.ceil(Math.abs(b - a) / (PI / 180))), d = "", stylo = false, prec = null;
      for (var i = 0; i <= n; i++) {
        var t = a + (b - a) * i / n, y = f(t);
        if (fn === "tan" && prec != null && Math.cos(prec.t) * Math.cos(t) <= 0) { stylo = false; prec = null; }
        if (!isFinite(y)) { stylo = false; prec = null; continue; }
        var dedans = Math.abs(y) <= lim, P = GX(t).toFixed(2) + " " + GY(borne(y)).toFixed(2);
        if (dedans) {
          if (!stylo) d += prec ? "M" + GX(prec.t).toFixed(2) + " " + GY(borne(prec.y)).toFixed(2) + "L" + P : "M" + P;
          else d += "L" + P;
          stylo = true;
        } else if (stylo) { d += "L" + P; stylo = false; }
        prec = { t: t, y: y };
      }
      return d;
    }
    var voirCourbe = !!c.courbe;

    function dessiner() {
      gC.innerHTML = ""; gG.innerHTML = "";
      var co = Math.cos(x), si = Math.sin(x), px = CX(co), py = CY(si), y = f(x);
      // arc parcouru (plusieurs tours : on repasse sur le cercle) ; en arrière : sens horaire
      var reste = Math.abs(x), debut = 0, s = x < 0 ? -1 : 1;
      while (reste > 1e-9) {
        var pas = Math.min(reste, 2 * PI - 1e-6), a1 = debut, a2 = debut + s * pas;
        var grand = pas > PI ? 1 : 0;
        el("path", { d: "M" + CX(Math.cos(a1)) + " " + CY(Math.sin(a1)) + "A" + R + " " + R + " 0 " + grand + " " + (s > 0 ? 0 : 1) + " " + CX(Math.cos(a2)) + " " + CY(Math.sin(a2)), "class": "tg-arc" }, gC);
        reste -= pas; debut = a2;
      }
      if (fn === "tan") {
        // droite OP(x) prolongée jusqu'à l'axe des tangentes (ou jusqu'au bord)
        if (isFinite(y)) {
          var ty = borne(y), tx = Math.abs(y) <= lim ? 1 : ty / y;
          el("line", { x1: px, y1: py, x2: CX(tx), y2: CY(ty), "class": "tg-report" }, gC);
          el("line", { x1: cx, y1: cy, x2: CX(tx), y2: CY(ty), "class": "tg-report" }, gC);
          el("line", { x1: CX(1), y1: cy, x2: CX(1), y2: CY(ty), "class": "tg-valeur" }, gC);
          if (Math.abs(y) <= lim) {
            el("line", { x1: CX(1), y1: CY(y), x2: Wc, y2: CY(y), "class": "tg-report" }, gC);
            el("circle", { cx: CX(1), cy: CY(y), r: 4, "class": "ia-pt ia-pt2" }, gC);
          }
        } else {                                            // OP(x) verticale : parallèle à l'axe des tangentes
          el("line", { x1: cx, y1: CY(-lim), x2: cx, y2: CY(lim), "class": "tg-report" }, gC);
        }
      }
      el("line", { x1: cx, y1: cy, x2: px, y2: py, "class": "ia-seg" }, gC);
      if (fn === "sin") {
        el("line", { x1: px, y1: cy, x2: px, y2: py, "class": "tg-valeur" }, gC);
        el("line", { x1: px, y1: py, x2: Wc, y2: py, "class": "tg-report" }, gC);
      } else if (fn === "cos") {
        el("line", { x1: cx, y1: cy, x2: px, y2: cy, "class": "tg-valeur" }, gC);
      }
      el("circle", { cx: px, cy: py, r: 5, "class": fn === "tan" ? "ia-pt" : "ia-pt ia-pt2" }, gC);
      // graphique : segment de l'axe = arc déroulé ; courbe tracée jusqu'à x
      el("line", { x1: GX(0), y1: gy0, x2: GX(x), y2: gy0, "class": "tg-arc" }, gG);
      if (Math.abs(x) > 1e-9) el("path", { d: chemin(0, x), "class": "ia-courbe" }, gG);
      if (isFinite(y)) {
        el("line", { x1: GX(x), y1: gy0, x2: GX(x), y2: GY(borne(y)), "class": "tg-valeur" }, gG);
        if (fn !== "cos" && Math.abs(y) <= lim) el("line", { x1: sens > 0 ? 0 : GX(x), y1: GY(y), x2: sens > 0 ? GX(x) : GX(hi) + 40, y2: GY(y), "class": "tg-report" }, gG);
        if (Math.abs(y) <= lim) el("circle", { cx: GX(x), cy: GY(y), r: 5, "class": "ia-pt ia-pt2" }, gG);
      }
      fantome.setAttribute("d", voirCourbe ? chemin(lo, hi) : "");
      etiq.textContent = "y = " + fn + " x";
      info.innerHTML = "x = <b>" + enPi(x) + "</b>" + (enPi(x).indexOf("π") >= 0 ? " ≈ " + fmt(x, 4) : "") +
        " · longueur de l'arc parcouru = " + fmt(Math.abs(x), 2) + " rayon(s)" + (x < -1e-9 ? ", sens horaire" : "") +
        " · <span class='tg-val'>" + fn + " x " + (isFinite(y) ? "= " + fmt(y, 4) : "n'existe pas (cos x = 0)") + "</span>";
      if (!valeurs.hidden) valeurs.remplir();
      cx_.regler(x);
    }

    // panneau de valeurs : la valeur courante + les multiples de π/6 (π/4 aussi pour tan) déjà atteints
    var valeurs = panneauValeurs(host, "valeurs de x et de " + fn + " x");
    function val(t) { var y = f(t); return isFinite(y) ? fmt(y, 4) : "n'existe pas"; }
    valeurs.remplir = function () {
      var lignes = ["<tr><th>x</th><th></th><th>" + fn + " x</th></tr>"], ts = [];
      for (var k = 0; k * PI / 12 <= Math.abs(x) + 1e-9; k++) if (k % 2 === 0 || (fn === "tan" && k % 3 === 0)) ts.push(sens * k * PI / 12);
      ts.forEach(function (t) { lignes.push("<tr><td>" + enPi(t) + "</td><td>≈ " + fmt(t, 4) + "</td><td>" + val(t) + "</td></tr>"); });
      lignes.push("<tr class='tg-courant'><td>x actuel</td><td>" + fmt(x, 4) + "</td><td>" + val(x) + "</td></tr>");
      valeurs.innerHTML = "<table class='ia-table'>" + lignes.join("") + "</table>";
    };

    var info = h("div", "ia-info");
    var cc = h("div", "ia-ctrl");
    var cx_ = curseur("x =", lo, hi, 0.001, x, function (v) {
      var k = Math.round(v / (PI / 12));                  // aimant : multiples de π/12 (valeurs exactes)
      x = Math.abs(v - k * PI / 12) < 0.006 ? k * PI / 12 : v;
      if (!anim.actif()) dessiner();
    }, function (v) { return enPi(v) === fmt(v, 4) ? fmt(v, 2) : enPi(v); });
    cc.appendChild(cx_);
    var cb = h("div", "ia-ctrl");
    var lecture = bouton("▶ lecture", function () { if (anim.actif()) anim.arreter(); else { if (Math.abs(x) >= xmax - 1e-6) x = 0; anim.lancer(); } });
    var anim = animateur(function (dt) {
      x = sens * Math.min(xmax, Math.abs(x) + dt * (2 * PI / 8));   // un tour en 8 secondes
      dessiner();
      return Math.abs(x) < xmax;
    }, function (on) { lecture.textContent = on ? "❚❚ pause" : "▶ lecture"; lecture.classList.toggle("on", on); });
    cb.appendChild(lecture);
    cb.appendChild(bouton("↺ 0", function () { anim.arreter(); x = 0; dessiner(); }, "revenir au départ"));
    // changer de fonction : on reconstruit l'animation (la hauteur du cadre change pour tan)
    var choix = c.fonctions || ["sin", "cos", "tan"];
    [["sin", "sinus"], ["cos", "cosinus"], ["tan", "tangente"]].forEach(function (m) {
      if (choix.indexOf(m[0]) < 0) return;
      var b = bouton(m[1], function () {
        if (m[0] === fn) return;
        anim.arreter(); host.innerHTML = "";
        enroulement(host, { fonction: m[0], fonctions: choix, tours: tours, x: Math.abs(x), arriere: sens < 0, courbe: voirCourbe, valeurs: !valeurs.hidden });
      });
      b.classList.add("tg-fn"); if (m[0] === fn) b.classList.add("on");
      cb.appendChild(b);
    });
    var ba = bouton("↻ en arrière", function () {
      anim.arreter(); sens = -sens; x = -x; ba.classList.toggle("on", sens < 0);
      fond(); var r = cx_.querySelector("input"); r.min = lo; r.max = hi; dessiner();
    }, "tourner dans le sens horaire : x négatif");
    if (sens < 0) ba.classList.add("on");
    cb.appendChild(ba);
    var bc = bouton("courbe entière", function () { voirCourbe = !voirCourbe; bc.classList.toggle("on", voirCourbe); dessiner(); });
    if (voirCourbe) bc.classList.add("on");
    cb.appendChild(bc);
    cb.appendChild(valeurs.bouton);
    if (c.valeurs) { valeurs.hidden = false; valeurs.bouton.classList.add("on"); }
    host.appendChild(cc); host.appendChild(cb); host.appendChild(info); host.appendChild(valeurs);
    dessiner();
  }

  // ------------------------------------------------------------ roue
  // Grande roue : la cabine tourne à vitesse constante ; sa hauteur (au-dessus de
  // l'axe, ou du sol) se trace en fonction du temps. Même échelle verticale (m)
  // sur le dessin et sur le graphique. Réglages : rayon, durée d'un tour, départ.
  function roue(host, c) {
    var r = +c.rayon || 60, T = +c.periode || 30, axe = c.axe != null ? +c.axe : r + 15;
    var DEPARTS = { bas: -PI / 2, "axe-montant": 0, haut: PI / 2, "axe-descendant": PI };
    var depart = DEPARTS[c.depart] != null ? c.depart : "bas";
    var tours = Math.max(1, Math.min(3, Math.round(c.tours || 2)));
    var rmax = Math.max(80, r), Ymax = rmax + 6, Ymin = -Math.max(rmax, axe) - 6;
    var s = 78 / rmax;                                      // px par mètre (même échelle partout)
    var t = 0, sol = !!c.sol, voirPoints = false;
    var zone = h("div", "tg-zone"); host.appendChild(zone);
    var Ht = (Ymax - Ymin) * s + 34, top = 14;
    function Y(v) { return top + (Ymax - v) * s; }          // v : hauteur au-dessus de l'axe (m)

    // dessin de la roue
    var Wr = 2 * rmax * s + 40, ox = Wr / 2;
    var sr = el("svg", { viewBox: "0 0 " + Wr + " " + Ht, "class": "ia-svg tg-cercle", role: "img", "aria-label": "grande roue" }, null);
    zone.appendChild(sr);
    var gR = el("g", {}, sr);

    // graphique h(t)
    var Wg = 470, gx0 = 46, ux = (Wg - gx0 - 30) / (tours * T);
    var sg = el("svg", { viewBox: "0 0 " + Wg + " " + Ht, "class": "ia-svg tg-graphe", role: "img", "aria-label": "graphique de la hauteur" }, null);
    zone.appendChild(sg);
    function GX(v) { return gx0 + v * ux; }
    var gF = el("g", {}, sg), gG = el("g", {}, sg);

    function theta(tt) { return 2 * PI * tt / T + DEPARTS[depart]; }
    function hauteur(tt) { var v = r * Math.sin(theta(tt)); return Math.abs(v) < 1e-9 ? 0 : v; }
    function aff(v) { return sol ? v + axe : v; }           // valeur affichée

    function fond() {
      gF.innerHTML = "";
      var base = sol ? -axe : 0;                            // niveau de l'axe des temps
      var pasY = sol ? 25 : 20;
      for (var v = Math.ceil((Ymin - base) / pasY) * pasY; v + base <= Ymax; v += pasY) {
        var yy = Y(v + base);
        el("line", { x1: gx0, y1: yy, x2: GX(tours * T), y2: yy, "class": "ia-grille" }, gF);
        el("text", { x: gx0 - 6, y: yy + 4, "text-anchor": "end", "class": "ia-grad" }, gF).textContent = fmt(v, 0);
      }
      var pasT = T / 4;
      for (var k = 0; k * pasT <= tours * T + 1e-9; k++) {
        var xx = GX(k * pasT);
        el("line", { x1: xx, y1: Y(Ymax), x2: xx, y2: Y(Ymin), "class": "ia-grille" }, gF);
        if (k) el("text", { x: xx, y: Y(base) + 15, "text-anchor": "middle", "class": "ia-grad" }, gF).textContent = fmt(k * pasT, pasT % 1 ? 1 : 0);
      }
      el("line", { x1: gx0 - 4, y1: Y(base), x2: GX(tours * T) + 14, y2: Y(base), "class": "ia-axe" }, gF);
      el("line", { x1: gx0, y1: Y(Ymin), x2: gx0, y2: Y(Ymax), "class": "ia-axe" }, gF);
      el("text", { x: Wg - 4, y: Y(base) - 6, "text-anchor": "end", "class": "ia-lab-axe" }, gF).textContent = "t (min)";
      el("text", { x: gx0 + 6, y: Y(Ymax) + 12, "class": "ia-lab-axe" }, gF).textContent = sol ? "hauteur au-dessus du sol (m)" : "h (m) : hauteur au-dessus de l'axe";
      if (sol) el("line", { x1: gx0, y1: Y(0), x2: GX(tours * T), y2: Y(0), "class": "ia-asym" }, gF);
    }

    function chemin(a, b) {
      var n = Math.max(2, Math.ceil((b - a) / (T / 240))), d = "";
      for (var i = 0; i <= n; i++) { var tt = a + (b - a) * i / n; d += (i ? "L" : "M") + GX(tt).toFixed(2) + " " + Y(hauteur(tt)).toFixed(2); }
      return d;
    }

    function dessiner() {
      gR.innerHTML = ""; gG.innerHTML = "";
      var oy = Y(0), R = r * s, th = theta(t), hv = hauteur(t);
      // sol, mât, roue, rayons
      if (-axe >= Ymin) el("line", { x1: 4, y1: Y(-axe), x2: Wr - 4, y2: Y(-axe), "class": "ia-axe" }, gR);
      if (-axe >= Ymin) {
        el("line", { x1: ox, y1: oy, x2: ox - R * 0.45, y2: Y(-axe), "class": "tg-mat" }, gR);
        el("line", { x1: ox, y1: oy, x2: ox + R * 0.45, y2: Y(-axe), "class": "tg-mat" }, gR);
      }
      el("circle", { cx: ox, cy: oy, r: R, "class": "ia-courbe tg-cercle-trace" }, gR);
      for (var k = 0; k < 8; k++) {
        var a = th + k * PI / 4;
        el("line", { x1: ox, y1: oy, x2: ox + R * Math.cos(a), y2: oy - R * Math.sin(a), "class": "tg-rayon" }, gR);
      }
      if (voirPoints) for (k = 0; k < 12; k++) {
        var ak = DEPARTS[depart] + k * PI / 6;
        el("circle", { cx: ox + R * Math.cos(ak), cy: oy - R * Math.sin(ak), r: 2.5, "class": "ia-pt" }, gR);
      }
      el("line", { x1: 4, y1: oy, x2: Wr - 4, y2: oy, "class": "tg-report" }, gR);
      var cxp = ox + R * Math.cos(th), cyp = oy - R * Math.sin(th);
      el("line", { x1: cxp, y1: sol ? Y(-axe) : oy, x2: cxp, y2: cyp, "class": "tg-valeur" }, gR);
      el("line", { x1: cxp, y1: cyp, x2: Wr, y2: cyp, "class": "tg-report" }, gR);
      el("circle", { cx: ox, cy: oy, r: 3, "class": "ia-pt" }, gR);
      el("rect", { x: cxp - 6, y: cyp - 6, width: 12, height: 12, rx: 3, "class": "tg-cabine" }, gR);
      // graphique
      if (t > 0) el("path", { d: chemin(0, t), "class": "ia-courbe" }, gG);
      if (voirPoints) for (k = 0; k * T / 12 <= tours * T + 1e-9; k++)
        el("circle", { cx: GX(k * T / 12), cy: Y(hauteur(k * T / 12)), r: 3, "class": "ia-pt" }, gG);
      el("line", { x1: GX(t), y1: Y(sol ? -axe : 0), x2: GX(t), y2: Y(hv), "class": "tg-valeur" }, gG);
      el("line", { x1: 0, y1: Y(hv), x2: GX(t), y2: Y(hv), "class": "tg-report" }, gG);
      el("circle", { cx: GX(t), cy: Y(hv), r: 5, "class": "ia-pt ia-pt2" }, gG);
      var deg = 360 * t / T;
      info.innerHTML = "t = <b>" + fmt(t, 2) + " min</b> · la roue a tourné de " + fmt(deg, 1) + "°" +
        " · <span class='tg-val'>" + (sol ? "hauteur au-dessus du sol = " + fmt(hv + axe, 2) : "h = " + fmt(hv, 2)) + " m</span>";
      if (!valeurs.hidden) valeurs.remplir();
      ct.regler(t);
    }

    var valeurs = panneauValeurs(host, "valeurs de t et de la hauteur");
    valeurs.remplir = function () {
      var lignes = ["<tr><th>t (min)</th><th>angle</th><th>" + (sol ? "hauteur / sol (m)" : "h (m)") + "</th></tr>"];
      for (var k = 0; k * T / 12 <= t + 1e-9; k++) {
        var tt = k * T / 12;
        lignes.push("<tr><td>" + fmt(tt, 2) + "</td><td>" + (30 * k) + "°</td><td>" + fmt(aff(hauteur(tt)), 2) + "</td></tr>");
      }
      lignes.push("<tr class='tg-courant'><td>" + fmt(t, 2) + "</td><td>" + fmt(360 * t / T, 1) + "°</td><td>" + fmt(aff(hauteur(t)), 2) + "</td></tr>");
      valeurs.innerHTML = "<table class='ia-table'>" + lignes.join("") + "</table>";
    };

    var info = h("div", "ia-info");
    var cc = h("div", "ia-ctrl");
    var ct = curseur("t =", 0, tours * T, 0.01, t, function (v) {
      var k = Math.round(v / (T / 24));                     // aimant : multiples de T/24
      t = Math.abs(v - k * T / 24) < T / 300 ? k * T / 24 : v;
      if (!anim.actif()) dessiner();
    }, function (v) { return fmt(v, 2) + " min"; });
    cc.appendChild(ct);
    var cr = curseur("rayon", 10, rmax, 5, r, function (v) { r = v; dessiner(); }, function (v) { return fmt(v, 0) + " m"; });
    var cp = curseur("un tour en", 10, 60, 5, T, function (v) {
      var f = t / T; T = v; ux = (Wg - gx0 - 30) / (tours * T); t = f * T;
      var inp = ct.querySelector("input"); inp.max = tours * T; fond(); dessiner();
    }, function (v) { return fmt(v, 0) + " min"; });
    cr.regler(r); cp.regler(T);
    cc.appendChild(cr); cc.appendChild(cp);
    var cb = h("div", "ia-ctrl");
    var lecture = bouton("▶ lecture", function () { if (anim.actif()) anim.arreter(); else { if (t >= tours * T - 1e-9) t = 0; anim.lancer(); } });
    var anim = animateur(function (dt) {
      t = Math.min(tours * T, t + dt * T / 10);           // un tour en 10 secondes
      dessiner();
      return t < tours * T;
    }, function (on) { lecture.textContent = on ? "❚❚ pause" : "▶ lecture"; lecture.classList.toggle("on", on); });
    cb.appendChild(lecture);
    cb.appendChild(bouton("↺ 0", function () { anim.arreter(); t = 0; dessiner(); }, "revenir au départ"));
    var cd = h("div", "ia-ctrl");
    cd.appendChild(h("span", "ia-lab", "départ :"));
    [["bas", "en bas"], ["axe-montant", "à l'axe, en montant"], ["haut", "en haut"], ["axe-descendant", "à l'axe, en descendant"]].forEach(function (m) {
      var b = bouton(m[1], function () {
        depart = m[0]; [].forEach.call(cd.querySelectorAll(".ia-btn"), function (y) { y.classList.toggle("on", y === b); }); dessiner();
      });
      if (m[0] === depart) b.classList.add("on");
      cd.appendChild(b);
    });
    var bs = bouton("hauteur au-dessus du sol", function () { sol = !sol; bs.classList.toggle("on", sol); fond(); dessiner(); },
      "axe de la roue à " + fmt(axe, 0) + " m du sol");
    if (sol) bs.classList.add("on");
    var bp = bouton("une position par 1/12 de tour", function () { voirPoints = !voirPoints; bp.classList.toggle("on", voirPoints); dessiner(); });
    cb.appendChild(bs); cb.appendChild(bp); cb.appendChild(valeurs.bouton);
    host.appendChild(cc); host.appendChild(cd); host.appendChild(cb); host.appendChild(info); host.appendChild(valeurs);
    fond(); dessiner();
  }

  // ------------------------------------------------------------ outils communs (repère)
  // Repère cartésien : graduations en multiples de π/pid sur l'axe horizontal.
  function repere(parent, o) {
    var ux = o.ux, uy = o.uy, ml = o.ml || 30, mr = o.mr || 22, mt = o.mt || 16, mb = o.mb || 22;
    var W = (o.xmax - o.xmin) * ux + ml + mr, H = (o.ymax - o.ymin) * uy + mt + mb;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "ia-svg " + (o.cls || "tg-graphe"), role: "img", "aria-label": o.label || "graphique" }, null);
    parent.appendChild(svg);
    function X(x) { return ml + (x - o.xmin) * ux; } function Y(y) { return mt + (o.ymax - y) * uy; }
    var pid = o.pid || 2, etiq = o.etiq || 1;
    var k0 = Math.ceil(o.xmin * pid / PI - 1e-9), k1 = Math.floor(o.xmax * pid / PI + 1e-9);
    for (var k = k0; k <= k1; k++) {
      var x = k * PI / pid;
      el("line", { x1: X(x), y1: Y(o.ymin), x2: X(x), y2: Y(o.ymax), "class": "ia-grille" }, svg);
      if (k && k % etiq === 0) el("text", { x: X(x), y: Y(0) + 14, "text-anchor": "middle", "class": "ia-grad" }, svg).textContent = enPi(x);
    }
    var ys = o.ystep || 1;
    for (var y = Math.ceil(o.ymin / ys) * ys; y <= o.ymax + 1e-9; y += ys) {
      if (Math.abs(y) < 1e-9) continue;
      el("line", { x1: X(o.xmin), y1: Y(y), x2: X(o.xmax), y2: Y(y), "class": "ia-grille" }, svg);
      el("text", { x: X(0) - 5, y: Y(y) + 4, "text-anchor": "end", "class": "ia-grad" }, svg).textContent = fmtc(y, 2);
    }
    el("line", { x1: X(o.xmin), y1: Y(0), x2: X(o.xmax) + 10, y2: Y(0), "class": "ia-axe" }, svg);
    el("line", { x1: X(0), y1: Y(o.ymin), x2: X(0), y2: Y(o.ymax) - 6, "class": "ia-axe" }, svg);
    el("text", { x: X(o.xmax) + 12, y: Y(0) + 4, "class": "ia-lab-axe" }, svg).textContent = "x";
    var g = el("g", {}, svg);
    return { svg: svg, X: X, Y: Y, g: g, W: W, H: H, o: o };
  }
  function trace(R, f, a, b, cls, parent) {
    var n = 400, d = "", up = false;
    for (var i = 0; i <= n; i++) {
      var x = a + (b - a) * i / n, y = f(x);
      if (!isFinite(y) || y > R.o.ymax + 0.3 || y < R.o.ymin - 0.3) { up = false; continue; }
      d += (up ? "L" : "M") + R.X(x).toFixed(2) + " " + R.Y(y).toFixed(2); up = true;
    }
    return el("path", { d: d, "class": cls || "ia-courbe" }, parent || R.g);
  }
  // valeur exacte remarquable (0, ±1/2, ±√2/2, ±√3/2, ±1, ±√3, ±√3/3) ou décimal
  function exact(v) {
    var t = [[0, "0"], [0.5, "1/2"], [Math.SQRT2 / 2, "√2/2"], [Math.sqrt(3) / 2, "√3/2"], [1, "1"], [Math.sqrt(3), "√3"], [Math.sqrt(3) / 3, "√3/3"]];
    for (var i = 0; i < t.length; i++) if (Math.abs(Math.abs(v) - t[i][0]) < 1e-9) return (v < 0 && t[i][0] ? "−" : "") + t[i][1];
    return null;
  }

  // ------------------------------------------------------------ anneaux
  // Aire du disque : n anneaux d'épaisseur r/n déroulés en rectangles,
  // empilés en deux escaliers (par défaut s_n, par excès S_n) autour du triangle.
  function anneaux(host, c) {
    var n = Math.max(1, Math.min(60, Math.round(c.n || 5))), voir = "les deux";
    var zone = h("div", "tg-zone"); host.appendChild(zone);
    var Rp = 70;                                            // rayon (px) : r = 1
    var sd = el("svg", { viewBox: "0 0 170 170", "class": "ia-svg tg-cercle", role: "img", "aria-label": "disque découpé en anneaux" }, null);
    zone.appendChild(sd);
    var gD = el("g", {}, sd);
    var u = 62, uv = 130, W = 2 * PI * u + 50, H = uv + 46;
    var se = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "ia-svg tg-graphe", role: "img", "aria-label": "escaliers" }, null);
    zone.appendChild(se);
    var x0 = 20, y0 = H - 24;                               // coin bas gauche
    function EX(v) { return x0 + v * u; } function EY(v) { return y0 - v * uv; }
    var gE = el("g", {}, se);
    function dessiner() {
      gD.innerHTML = ""; gE.innerHTML = "";
      for (var k = n - 1; k >= 0; k--) {                    // anneaux, du bord vers le centre
        el("circle", { cx: 85, cy: 85, r: Rp * (k + 1) / n, "class": k % 2 ? "ia-rect" : "ia-aire", style: "stroke-width:.6" }, gD);
      }
      el("circle", { cx: 85, cy: 85, r: Rp, "class": "ia-courbe tg-cercle-trace", style: "fill:none" }, gD);
      el("line", { x1: 85, y1: 85, x2: 85 + Rp, y2: 85, "class": "ia-seg" }, gD);
      el("text", { x: 85 + Rp / 2, y: 80, "text-anchor": "middle", "class": "ia-grad" }, gD).textContent = "r = 1";
      // escaliers : niveau j (en partant du bas) = anneau k = n − 1 − j
      for (var j = 0; j < n; j++) {
        var k = n - 1 - j, e = 1 / n;
        if (voir !== "excès") el("rect", { x: EX(0), y: EY((j + 1) * e), width: 2 * PI * k * e * u, height: e * uv, "class": "ia-rect" }, gE);
        if (voir !== "défaut") el("rect", { x: EX(0), y: EY((j + 1) * e), width: 2 * PI * (k + 1) * e * u, height: e * uv, "class": "tg-excès" }, gE);
      }
      el("path", { d: "M" + EX(0) + " " + EY(1) + "L" + EX(2 * PI) + " " + EY(0) + "L" + EX(0) + " " + EY(0) + "Z", "class": "tg-triangle" }, gE);
      el("line", { x1: EX(0) - 4, y1: EY(0), x2: EX(2 * PI) + 12, y2: EY(0), "class": "ia-axe" }, gE);
      el("line", { x1: EX(0), y1: EY(0) + 4, x2: EX(0), y2: EY(1) - 8, "class": "ia-axe" }, gE);
      el("text", { x: EX(2 * PI), y: EY(0) + 15, "text-anchor": "middle", "class": "ia-grad" }, gE).textContent = "2π r";
      el("text", { x: EX(0) - 5, y: EY(1) + 4, "text-anchor": "end", "class": "ia-grad" }, gE).textContent = "r";
      var s = PI * (1 - 1 / n), S = PI * (1 + 1 / n);
      info.innerHTML = "n = <b>" + n + "</b> anneaux · s<sub>n</sub> = π(1 − 1/n) ≈ " + fmt(s, 4) +
        " · S<sub>n</sub> = π(1 + 1/n) ≈ " + fmt(S, 4) + " · <span class='tg-val'>écart S<sub>n</sub> − s<sub>n</sub> = 2π/n ≈ " + fmt(S - s, 4) +
        "</span> · aire du triangle : π ≈ " + fmt(PI, 4);
      if (!valeurs.hidden) valeurs.remplir();
      cn.regler(n);
    }
    var valeurs = panneauValeurs(host, "valeurs de s_n et S_n");
    valeurs.remplir = function () {
      var ns = [1, 2, 5, 10, 20, 50, 100, 1000];
      if (ns.indexOf(n) < 0) ns.push(n);
      ns.sort(function (a, b) { return a - b; });
      var L = ["<tr><th>n</th><th>s<sub>n</sub></th><th>S<sub>n</sub></th><th>S<sub>n</sub> − s<sub>n</sub></th></tr>"];
      ns.forEach(function (m) {
        L.push("<tr" + (m === n ? " class='tg-courant'" : "") + "><td>" + m + "</td><td>" + fmt(PI * (1 - 1 / m), 4) + "</td><td>" + fmt(PI * (1 + 1 / m), 4) + "</td><td>" + fmt(2 * PI / m, 4) + "</td></tr>");
      });
      valeurs.innerHTML = "<table class='ia-table'>" + L.join("") + "</table>";
    };
    var info = h("div", "ia-info"), cc = h("div", "ia-ctrl"), cb = h("div", "ia-ctrl");
    var cn = curseur("n =", 1, 60, 1, n, function (v) { n = Math.round(v); dessiner(); }, function (v) { return String(Math.round(v)); });
    cc.appendChild(cn);
    [["défaut", "par défaut (s_n)"], ["excès", "par excès (S_n)"], ["les deux", "les deux"]].forEach(function (m) {
      var b = bouton(m[1], function () { voir = m[0]; [].forEach.call(cb.querySelectorAll(".tg-voir"), function (y) { y.classList.toggle("on", y === b); }); dessiner(); });
      b.classList.add("tg-voir"); if (m[0] === voir) b.classList.add("on"); cb.appendChild(b);
    });
    cb.appendChild(valeurs.bouton);
    host.appendChild(cc); host.appendChild(cb); host.appendChild(info); host.appendChild(valeurs);
    dessiner();
  }

  // ------------------------------------------------------------ cercle-equation
  // sin x = a, cos x = a, tan x = a : la droite sur le cercle, ses points,
  // et toutes les solutions sur un axe gradué de −2π à 4π.
  function cercleEquation(host, c) {
    var fn = ["sin", "cos", "tan"].indexOf(c.fonction) >= 0 ? c.fonction : "sin";
    var a = c.a != null ? +c.a : 0.5;
    var zone = h("div", "tg-zone"); host.appendChild(zone);
    var R = 66, cx = 100, cy = 100;
    var sc = el("svg", { viewBox: "0 0 200 200", "class": "ia-svg tg-cercle", role: "img", "aria-label": "cercle trigonométrique" }, null);
    zone.appendChild(sc);
    function CX(v) { return cx + v * R; } function CY(v) { return cy - v * R; }
    el("line", { x1: CX(-1.4), y1: cy, x2: CX(1.4), y2: cy, "class": "ia-axe" }, sc);
    el("line", { x1: cx, y1: CY(-1.4), x2: cx, y2: CY(1.4), "class": "ia-axe" }, sc);
    el("circle", { cx: cx, cy: cy, r: R, "class": "ia-courbe tg-cercle-trace" }, sc);
    var gC = el("g", {}, sc);
    var lo = -2 * PI, hi = 4 * PI, u = 26, W = (hi - lo) * u + 30;
    var sa = el("svg", { viewBox: "0 0 " + W + " 52", "class": "ia-svg tg-axe-reel", role: "img", "aria-label": "axe des réels" }, null);
    var ax = h("div", "tg-zone"); ax.appendChild(sa);
    function AX(x) { return 15 + (x - lo) * u; }
    el("line", { x1: AX(lo), y1: 22, x2: AX(hi), y2: 22, "class": "ia-axe" }, sa);
    for (var k = -4; k <= 8; k++) {
      el("line", { x1: AX(k * PI / 2), y1: 17, x2: AX(k * PI / 2), y2: 27, "class": "ia-axe" }, sa);
      el("text", { x: AX(k * PI / 2), y: 42, "text-anchor": "middle", "class": "ia-grad" + (k % 2 ? " tg-demi" : "") }, sa).textContent = enPi(k * PI / 2);
    }
    var gA = el("g", {}, sa);
    function base() {
      if (fn === "tan") { var t = Math.atan(a); return [t]; }
      if (Math.abs(a) > 1 + 1e-12) return [];
      var al = fn === "sin" ? Math.asin(a) : Math.acos(a);
      var b2 = fn === "sin" ? PI - al : -al;
      return Math.abs(b2 - al) < 1e-9 || Math.abs(Math.abs(b2 - al) - 2 * PI) < 1e-9 ? [al] : [al, b2];
    }
    function sols(l, r) {
      var per = fn === "tan" ? PI : 2 * PI, out = [];
      base().forEach(function (b) { for (var k = -8; k <= 8; k++) { var x = b + k * per; if (x >= l - 1e-9 && x <= r + 1e-9 && !out.some(function (y) { return Math.abs(y - x) < 1e-9; })) out.push(x); } });
      return out.sort(function (p, q) { return p - q; });
    }
    function ecrit(x) { var e = enPi(x); return e === fmt(x, 4) ? "≈ " + e : e; }
    function egal(x) { var e = enPi(x); return e === fmt(x, 4) ? "≈ " + e : "= " + e; }
    function dessiner() {
      gC.innerHTML = ""; gA.innerHTML = "";
      if (fn === "sin") el("line", { x1: CX(-1.4), y1: CY(a), x2: CX(1.4), y2: CY(a), "class": "tg-report", style: "stroke-dasharray:none" }, gC);
      else if (fn === "cos") el("line", { x1: CX(a), y1: CY(-1.4), x2: CX(a), y2: CY(1.4), "class": "tg-report", style: "stroke-dasharray:none" }, gC);
      else {
        var m = Math.min(1.4, 1.4 / Math.max(Math.abs(a), 1e-9));
        el("line", { x1: CX(-m), y1: CY(-m * a), x2: CX(m), y2: CY(m * a), "class": "tg-report", style: "stroke-dasharray:none" }, gC);
        el("line", { x1: CX(1), y1: CY(-1.4), x2: CX(1), y2: CY(1.4), "class": "tg-axe-tan" }, gC);
      }
      var pts = fn === "tan" ? [Math.atan(a), Math.atan(a) + PI] : base();
      pts.forEach(function (x, i) {
        el("circle", { cx: CX(Math.cos(x)), cy: CY(Math.sin(x)), r: 5, "class": i ? "ia-pt" : "ia-pt ia-pt2" }, gC);
      });
      var S = sols(lo, hi);
      S.forEach(function (x) { el("circle", { cx: AX(x), cy: 22, r: 4, "class": "ia-pt ia-pt2" }, gA); });
      var ea = exact(a), ta = ea ? ea : fmtc(a, 2);
      var txt = fn + " x = " + ta + " : ";
      if (!pts.length) txt += "<span class='tg-val'>aucune solution</span> (" + fn + " x est toujours entre −1 et 1).";
      else {
        var al = pts[0];
        txt += "calculatrice : α = " + fn + "<sup>−1</sup>(" + ta + ") " + egal(al) + " ; ";
        if (fn === "tan") txt += "solutions <span class='tg-val'>x = α + kπ</span>";
        else if (pts.length === 1) txt += "un seul point : <span class='tg-val'>x = α + 2kπ</span>";
        else txt += "solutions <span class='tg-val'>x = α + 2kπ ou x = " + (fn === "sin" ? "π − α" : "−α") + " + 2kπ</span>";
        txt += " (k ∈ ℤ) · dans [0 ; 2π] : " + sols(0, 2 * PI).map(ecrit).join(" ; ");
      }
      info.innerHTML = txt;
      if (!valeurs.hidden) valeurs.remplir();
      ca.regler(a);
    }
    var valeurs = panneauValeurs(host, "solutions sur l'axe");
    valeurs.remplir = function () {
      var L = ["<tr><th>forme</th><th>solution</th><th>valeur</th></tr>"], B = base(), per = fn === "tan" ? PI : 2 * PI;
      var noms = fn === "tan" ? ["α"] : fn === "sin" ? ["α", "π − α"] : ["α", "−α"];
      sols(lo, hi).forEach(function (x) {
        var forme = "";
        B.forEach(function (b, i) { var k = Math.round((x - b) / per); if (!forme && Math.abs(b + k * per - x) < 1e-9) { var m = Math.abs(k) * (fn === "tan" ? 1 : 2); forme = noms[i] + (k ? (k > 0 ? " + " : " − ") + (m === 1 ? "" : m) + "π" : ""); } });
        L.push("<tr><td>" + forme + "</td><td>" + ecrit(x) + "</td><td>" + fmt(x, 4) + "</td></tr>");
      });
      valeurs.innerHTML = "<table class='ia-table'>" + L.join("") + "</table>";
    };
    var info = h("div", "ia-info"), cc = h("div", "ia-ctrl"), cb = h("div", "ia-ctrl");
    var REM = [0, 0.5, Math.SQRT2 / 2, Math.sqrt(3) / 2, 1, Math.sqrt(3), Math.sqrt(3) / 3];
    var ca = curseur("a =", -1.5, 1.5, 0.01, a, function (v) {
      var best = v;
      REM.forEach(function (r) { [r, -r].forEach(function (s) { if (Math.abs(v - s) < 0.012) best = s; }); });
      a = best; dessiner();
    }, function (v) { var e = exact(a); return e || fmtc(v, 2); });
    function bornes() { var r = ca.querySelector("input"); r.min = fn === "tan" ? -3 : -1.5; r.max = fn === "tan" ? 3 : 1.5; }
    cc.appendChild(ca);
    [["sin", "sin x = a"], ["cos", "cos x = a"], ["tan", "tan x = a"]].forEach(function (m) {
      var b = bouton(m[1], function () { fn = m[0]; [].forEach.call(cb.querySelectorAll(".tg-fn"), function (y) { y.classList.toggle("on", y === b); }); bornes(); dessiner(); });
      b.classList.add("tg-fn"); if (m[0] === fn) b.classList.add("on"); cb.appendChild(b);
    });
    cb.appendChild(valeurs.bouton);
    host.appendChild(ax); host.appendChild(cc); host.appendChild(cb); host.appendChild(info); host.appendChild(valeurs);
    bornes(); dessiner();
  }

  // ------------------------------------------------------------ parametres
  // f(x) = a sin(bx + c) avec curseurs ; mode « prédiction » : une fonction est
  // tirée, on choisit sa courbe parmi quatre OU on l'esquisse, puis on révèle.
  function parametres(host, c) {
    var a = c.a != null ? +c.a : 1, b = c.b != null ? +c.b : 1, cc_ = c.c != null ? +c.c : 0;
    var mode = "libre", cible = null, esquisse = [], dessine = false, revele = false;
    var O = { xmin: -PI, xmax: 2 * PI, ymin: -3.5, ymax: 3.5, ux: 34, uy: 22, pid: 2, ystep: 1 };
    var zone = h("div", "tg-zone"); host.appendChild(zone);
    var R = repere(zone, O);
    var gS = el("g", {}, R.svg);
    function F(p) { return function (x) { return p.a * Math.sin(p.b * x + p.c); }; }
    function txtC(v) { var e = enPi(Math.abs(v)); return (v < 0 ? " − " : " + ") + e; }
    function expr(p) {
      var A = p.a === 1 ? "" : p.a === -1 ? "−" : fmtc(p.a, 1) + " ";
      var B = p.b === 1 ? "x" : (Math.abs(p.b - 0.5) < 1e-9 ? "x/2" : fmtc(p.b, 1) + "x");
      return A + "sin(" + B + (Math.abs(p.c) < 1e-9 ? "" : txtC(p.c)) + ")";
    }
    function cinq(p) {
      var L = []; for (var j = 0; j <= 4; j++) { var x = (j * PI / 2 - p.c) / p.b; L.push([x, p.a * [0, 1, 0, -1, 0][j]]); } return L;
    }
    function dessiner() {
      R.g.innerHTML = ""; gS.innerHTML = "";
      trace(R, Math.sin, O.xmin, O.xmax, "ia-fantome");
      var p = mode === "libre" ? { a: a, b: b, c: cc_ } : cible;
      if (mode === "libre" || revele) {
        trace(R, F(p), O.xmin, O.xmax, "ia-courbe");
        cinq(p).forEach(function (q) { if (q[0] >= O.xmin && q[0] <= O.xmax) el("circle", { cx: R.X(q[0]), cy: R.Y(q[1]), r: 3.5, "class": "ia-pt ia-pt2" }, R.g); });
      }
      if (esquisse.length > 1) el("path", { d: "M" + esquisse.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join("L"), "class": "ia-courbe2" }, gS);
      if (mode === "libre") {
        info.innerHTML = "f(x) = <b>" + expr(p) + "</b> · amplitude " + fmtc(Math.abs(p.a), 1) + " · période 2π/" + fmtc(Math.abs(p.b), 1) + " = " + enPi(2 * PI / Math.abs(p.b)) +
          " · déphasage −c/b = " + enPi(-p.c / p.b);
      } else {
        info.innerHTML = "Prédis le graphique de <b>f(x) = " + expr(cible) + "</b>" + (revele ? " · amplitude " + fmtc(Math.abs(cible.a), 1) + ", période " + enPi(2 * PI / Math.abs(cible.b)) + ", déphasage " + enPi(-cible.c / cible.b) : "");
      }
      if (!valeurs.hidden) valeurs.remplir();
    }
    // tirage d'une fonction et de trois erreurs typiques
    var AS = [2, 3, -2, 1.5, -1], BS = [1, 2, 0.5, 3], CS = [0, PI / 2, -PI / 3, PI / 4, -PI / 2];
    function hasard(t) { return t[Math.floor(Math.random() * t.length)]; }
    function tirer() {
      cible = { a: hasard(AS), b: hasard(BS), c: hasard(CS) };
      if (cible.b === 1 && cible.c === 0 && Math.abs(cible.a) === 1) return tirer();
      revele = false; esquisse = [];
    }
    function erreurs(p) {
      var L = [
        { a: p.a, b: p.b === 1 ? 2 : 1 / p.b, c: p.c },        // b confondu avec la période
        { a: p.a, b: p.b, c: -p.c || PI / 2 },                // sens du décalage
        { a: -p.a, b: p.b, c: p.c },                          // signe de a
        { a: p.a * 2, b: p.b, c: p.c },                       // amplitude
      ];
      var out = [];
      L.forEach(function (q) {
        var diff = function (r) { for (var x = -3; x < 6; x += 0.37) if (Math.abs(F(q)(x) - F(r)(x)) > 0.3) return true; return false; };
        if (diff(p) && out.every(diff) && out.length < 3) out.push(q);
      });
      return out;
    }
    var choix = h("div", "tg-choix");
    function proposer() {
      choix.innerHTML = "";
      var opts = [cible].concat(erreurs(cible)).sort(function () { return Math.random() - 0.5; });
      opts.forEach(function (p, i) {
        var carte = h("button", "tg-carte"); carte.type = "button";
        var Rm = repere(carte, { xmin: -PI / 2, xmax: 2 * PI, ymin: -4, ymax: 4, ux: 15, uy: 7, pid: 2, etiq: 2, ystep: 2, ml: 16, mr: 12, mt: 6, mb: 16, cls: "tg-mini" });
        trace(Rm, Math.sin, -PI / 2, 2 * PI, "ia-fantome"); trace(Rm, F(p), -PI / 2, 2 * PI, "ia-courbe");
        carte.insertBefore(h("span", "tg-lettre", "ABCD"[i]), carte.firstChild);
        carte.addEventListener("click", function () {
          var bon = p === cible;
          carte.classList.add(bon ? "tg-bon" : "tg-faux");
          retour.innerHTML = bon ? "Oui. Vérifie avec les cinq points : l'argument vaut 0, π/2, π, 3π/2, 2π." : "Non : compare l'amplitude, la période (2π/b) et l'endroit où l'argument vaut 0.";
          if (bon) { revele = true; dessiner(); }
        });
        choix.appendChild(carte);
      });
    }
    var retour = h("div", "ia-info");
    // esquisse au doigt ou à la souris
    function pos(ev) {
      var r = R.svg.getBoundingClientRect(), vb = R.svg.viewBox.baseVal;
      return [(ev.clientX - r.left) * vb.width / r.width, (ev.clientY - r.top) * vb.height / r.height];
    }
    R.svg.addEventListener("pointerdown", function (ev) { if (mode !== "esquisse" || revele) return; dessine = true; esquisse = [pos(ev)]; R.svg.setPointerCapture(ev.pointerId); ev.preventDefault(); dessiner(); });
    R.svg.addEventListener("pointermove", function (ev) { if (!dessine) return; esquisse.push(pos(ev)); dessiner(); });
    R.svg.addEventListener("pointerup", function () { dessine = false; });
    R.svg.style.touchAction = "none";

    var valeurs = panneauValeurs(host, "cinq points clés");
    valeurs.remplir = function () {
      var p = mode === "libre" ? { a: a, b: b, c: cc_ } : cible;
      if (mode !== "libre" && !revele) { valeurs.innerHTML = "<p>Révèle d'abord la courbe.</p>"; return; }
      var L = ["<tr><th>argument</th><th>x</th><th>f(x)</th></tr>"];
      cinq(p).forEach(function (q, j) { L.push("<tr><td>" + ["0", "π/2", "π", "3π/2", "2π"][j] + "</td><td>" + enPi(q[0]) + "</td><td>" + fmtc(q[1], 2) + "</td></tr>"); });
      valeurs.innerHTML = "<table class='ia-table'>" + L.join("") + "</table>";
    };
    var info = h("div", "ia-info");
    var cl = h("div", "ia-ctrl");
    var ca = curseur("a =", -3, 3, 0.5, a, function (v) { a = v || 0.5; dessiner(); }, function (v) { return fmtc(v || 0.5, 1); });
    var cbb = curseur("b =", 0.5, 4, 0.5, b, function (v) { b = v; dessiner(); }, function (v) { return fmtc(v, 1); });
    var cc2 = curseur("c =", -PI, PI, PI / 12, cc_, function (v) { cc_ = Math.round(v / (PI / 12)) * PI / 12; dessiner(); }, function (v) { return enPi(Math.round(v / (PI / 12)) * PI / 12); });
    ca.regler(a); cbb.regler(b); cc2.regler(cc_);
    cl.appendChild(ca); cl.appendChild(cbb); cl.appendChild(cc2);
    var cp = h("div", "ia-ctrl"), cm = h("div", "ia-ctrl");
    function regler(m) {
      mode = m; esquisse = []; revele = false;
      [].forEach.call(cm.querySelectorAll(".tg-mode"), function (y) { y.classList.toggle("on", y.dataset.m === m); });
      cl.hidden = m !== "libre"; cp.hidden = m === "libre"; choix.hidden = m !== "choix"; retour.innerHTML = "";
      if (m !== "libre") { tirer(); if (m === "choix") proposer(); }
      bEff.hidden = m !== "esquisse";
      dessiner();
    }
    [["libre", "curseurs"], ["choix", "prédire : choisir parmi 4"], ["esquisse", "prédire : esquisser"]].forEach(function (m) {
      var bt = bouton(m[1], function () { regler(m[0]); }); bt.classList.add("tg-mode"); bt.dataset.m = m[0]; cm.appendChild(bt);
    });
    cm.appendChild(valeurs.bouton);
    var bEff = bouton("effacer", function () { esquisse = []; dessiner(); });
    cp.appendChild(bouton("révéler", function () { revele = true; dessiner(); }));
    cp.appendChild(bEff);
    cp.appendChild(bouton("nouvelle fonction", function () { regler(mode); }));
    host.appendChild(cl); host.appendChild(cm); host.appendChild(cp); host.appendChild(choix); host.appendChild(info); host.appendChild(retour); host.appendChild(valeurs);
    regler("libre");
  }

  // ------------------------------------------------------------ pente-sinus
  // Une tangente glisse sur y = sin x ; sa pente se trace en même temps.
  function penteSinus(host, c) {
    var x = c.x != null ? +c.x : 0, voirCos = false;
    var O = { xmin: -0.3, xmax: 2 * PI + 0.2, ymin: -1.4, ymax: 1.4, ux: 58, uy: 70, pid: 6, etiq: 3, ystep: 0.5 };
    var zone = h("div", "tg-zone"); host.appendChild(zone);
    var R = repere(zone, O);
    trace(R, Math.sin, 0, 2 * PI, "ia-courbe", R.svg);
    var etq = el("text", { x: R.X(PI / 2) + 6, y: R.Y(1.15), "class": "ia-lab-axe" }, R.svg); etq.textContent = "y = sin x";
    var gCos = el("g", {}, R.svg); var gG = el("g", {}, R.svg);
    R.svg.appendChild(R.g);
    function dessiner() {
      gG.innerHTML = ""; gCos.innerHTML = "";
      if (voirCos) trace(R, Math.cos, 0, 2 * PI, "ia-fantome", gCos);
      // trace des pentes déjà parcourues
      if (x > 0) {
        var d = "", n = Math.max(2, Math.ceil(x / (PI / 90)));
        for (var i = 0; i <= n; i++) { var t = x * i / n; d += (i ? "L" : "M") + R.X(t).toFixed(2) + " " + R.Y(Math.cos(t)).toFixed(2); }
        el("path", { d: d, "class": "ia-courbe2" }, gG);
      }
      var m = Math.cos(x), y = Math.sin(x), L = 0.9;
      var dx = L / Math.sqrt(1 + m * m);
      el("line", { x1: R.X(x - dx), y1: R.Y(y - m * dx), x2: R.X(x + dx), y2: R.Y(y + m * dx), "class": "ia-tangente" }, gG);
      el("line", { x1: R.X(x), y1: R.Y(y), x2: R.X(x + 0.5), y2: R.Y(y), "class": "tg-report" }, gG);
      el("line", { x1: R.X(x + 0.5), y1: R.Y(y), x2: R.X(x + 0.5), y2: R.Y(y + 0.5 * m), "class": "tg-valeur" }, gG);
      el("circle", { cx: R.X(x), cy: R.Y(y), r: 5, "class": "ia-pt" }, gG);
      el("circle", { cx: R.X(x), cy: R.Y(m), r: 5, "class": "ia-pt ia-pt2" }, gG);
      var e = enPi(x);
      info.innerHTML = "x = <b>" + e + "</b>" + (e.indexOf("π") >= 0 ? " ≈ " + fmt(x, 4) : "") + " · sin x = " + fmt(y, 4) +
        " · <span class='tg-val'>pente de la tangente = " + fmt(m, 4) + "</span> (point orange : (x ; pente))";
      if (!valeurs.hidden) valeurs.remplir();
      cx_.regler(x);
    }
    var valeurs = panneauValeurs(host, "pentes");
    valeurs.remplir = function () {
      var L = ["<tr><th>x</th><th>(sin(x + 0,01) − sin x)/0,01</th><th>cos x</th></tr>"];
      for (var k = 0; k <= 12; k++) { var t = k * PI / 6; L.push("<tr><td>" + enPi(t) + "</td><td>" + fmt((Math.sin(t + 0.01) - Math.sin(t)) / 0.01, 3) + "</td><td>" + fmt(Math.cos(t), 3) + "</td></tr>"); }
      valeurs.innerHTML = "<table class='ia-table'>" + L.join("") + "</table>";
    };
    var info = h("div", "ia-info"), cc = h("div", "ia-ctrl"), cb = h("div", "ia-ctrl");
    var cx_ = curseur("x =", 0, 2 * PI, 0.001, x, function (v) {
      var k = Math.round(v / (PI / 12)); x = Math.abs(v - k * PI / 12) < 0.006 ? k * PI / 12 : v; if (!anim.actif()) dessiner();
    }, function (v) { return enPi(v) === fmt(v, 4) ? fmt(v, 2) : enPi(v); });
    cc.appendChild(cx_);
    var lecture = bouton("▶ lecture", function () { if (anim.actif()) anim.arreter(); else { if (x >= 2 * PI - 1e-6) x = 0; anim.lancer(); } });
    var anim = animateur(function (dt) { x = Math.min(2 * PI, x + dt * 2 * PI / 10); dessiner(); return x < 2 * PI; },
      function (on) { lecture.textContent = on ? "❚❚ pause" : "▶ lecture"; lecture.classList.toggle("on", on); });
    cb.appendChild(lecture);
    cb.appendChild(bouton("↺ 0", function () { anim.arreter(); x = 0; dessiner(); }));
    var bc = bouton("comparer à cos", function () { voirCos = !voirCos; bc.classList.toggle("on", voirCos); dessiner(); });
    cb.appendChild(bc); cb.appendChild(valeurs.bouton);
    host.appendChild(cc); host.appendChild(cb); host.appendChild(info); host.appendChild(valeurs);
    dessiner();
  }

  // ------------------------------------------------------------ axe-tours
  // Un réel sur l'axe gradué (multiples de π/6) ↔ le point P(x) du cercle ;
  // nombre de tours et mesure principale.
  function axeTours(host, c) {
    var x = c.x != null ? +c.x : 7 * PI / 3;
    var lo = -4 * PI, hi = 4 * PI;
    var zone = h("div", "tg-zone"); host.appendChild(zone);
    var R = 60, cx = 90, cy = 90;
    var sc = el("svg", { viewBox: "0 0 180 180", "class": "ia-svg tg-cercle", role: "img", "aria-label": "cercle" }, null);
    zone.appendChild(sc);
    function CX(v) { return cx + v * R; } function CY(v) { return cy - v * R; }
    el("line", { x1: CX(-1.3), y1: cy, x2: CX(1.3), y2: cy, "class": "ia-axe" }, sc);
    el("line", { x1: cx, y1: CY(-1.3), x2: cx, y2: CY(1.3), "class": "ia-axe" }, sc);
    el("circle", { cx: cx, cy: cy, r: R, "class": "ia-courbe tg-cercle-trace" }, sc);
    for (var k = 0; k < 12; k++) el("circle", { cx: CX(Math.cos(k * PI / 6)), cy: CY(Math.sin(k * PI / 6)), r: 1.6, "class": "ia-pt" }, sc);
    var gC = el("g", {}, sc);
    var u = 22, W = (hi - lo) * u + 30;
    var sa = el("svg", { viewBox: "0 0 " + W + " 60", "class": "ia-svg tg-axe-reel", role: "img", "aria-label": "axe gradué" }, null);
    var ax = h("div", "tg-zone"); ax.appendChild(sa);
    function AX(v) { return 15 + (v - lo) * u; }
    for (var t = -2; t < 2; t++) el("rect", { x: AX(2 * t * PI), y: 8, width: 2 * PI * u, height: 8, "class": t % 2 ? "ia-aire" : "ia-rect", style: "stroke:none" }, sa);
    el("line", { x1: AX(lo), y1: 26, x2: AX(hi), y2: 26, "class": "ia-axe" }, sa);
    for (k = -24; k <= 24; k++) {
      var v = k * PI / 6, grand = k % 3 === 0;
      el("line", { x1: AX(v), y1: grand ? 21 : 23, x2: AX(v), y2: grand ? 31 : 29, "class": "ia-axe" }, sa);
      if (k % 6 === 0) el("text", { x: AX(v), y: 46, "text-anchor": "middle", "class": "ia-grad" }, sa).textContent = enPi(v);
    }
    var gA = el("g", {}, sa);
    function dessiner() {
      gC.innerHTML = ""; gA.innerHTML = "";
      var reste = Math.abs(x), debut = 0, s = x < 0 ? -1 : 1, rr = R;
      while (reste > 1e-9) {
        var pas = Math.min(reste, 2 * PI - 1e-6), a2 = debut + s * pas;
        el("path", { d: "M" + (cx + rr * Math.cos(debut)) + " " + (cy - rr * Math.sin(debut)) + "A" + rr + " " + rr + " 0 " + (pas > PI ? 1 : 0) + " " + (s > 0 ? 0 : 1) + " " + (cx + rr * Math.cos(a2)) + " " + (cy - rr * Math.sin(a2)), "class": "tg-arc" }, gC);
        reste -= pas; debut = a2; rr += 7;                  // chaque tour un peu plus loin du cercle
      }
      el("line", { x1: cx, y1: cy, x2: CX(Math.cos(x)), y2: CY(Math.sin(x)), "class": "ia-seg" }, gC);
      el("circle", { cx: CX(Math.cos(x)), cy: CY(Math.sin(x)), r: 5, "class": "ia-pt ia-pt2" }, gC);
      el("line", { x1: AX(0), y1: 26, x2: AX(x), y2: 26, "class": "tg-arc" }, gA);
      el("circle", { cx: AX(x), cy: 26, r: 5, "class": "ia-pt ia-pt2" }, gA);
      var mp = ((x % (2 * PI)) + 2 * PI) % (2 * PI); if (Math.abs(mp - 2 * PI) < 1e-9) mp = 0;
      var tours = Math.round((x - mp) / (2 * PI));
      info.innerHTML = "x = <b>" + enPi(x) + "</b> · " + (tours === 0 ? "moins d'un tour" : Math.abs(tours) + " tour" + (Math.abs(tours) > 1 ? "s" : "") + " complet" + (Math.abs(tours) > 1 ? "s" : "") + (tours < 0 ? " dans le sens horlogique" : "")) +
        " · <span class='tg-val'>mesure principale : " + enPi(mp) + "</span> (x = " + enPi(mp) + (tours ? (tours > 0 ? " + " : " − ") + Math.abs(tours) + "·2π" : "") + ")";
      if (!valeurs.hidden) valeurs.remplir();
      cx_.regler(x);
    }
    var valeurs = panneauValeurs(host, "autres mesures");
    valeurs.remplir = function () {
      var mp = ((x % (2 * PI)) + 2 * PI) % (2 * PI), L = ["<tr><th>k</th><th>x + 2kπ</th></tr>"];
      for (var k = -2; k <= 2; k++) { var v = x + 2 * k * PI; L.push("<tr" + (Math.abs(v - mp) < 1e-9 ? " class='tg-courant'" : "") + "><td>" + String(k).replace("-", "−") + "</td><td>" + enPi(v) + "</td></tr>"); }
      valeurs.innerHTML = "<table class='ia-table'>" + L.join("") + "</table>";
    };
    var info = h("div", "ia-info"), cc = h("div", "ia-ctrl"), cb = h("div", "ia-ctrl");
    var cx_ = curseur("x =", lo, hi, PI / 6, x, function (v) { x = Math.round(v / (PI / 6)) * PI / 6; dessiner(); }, function (v) { return enPi(Math.round(v / (PI / 6)) * PI / 6); });
    cc.appendChild(cx_);
    [["−2π", -2 * PI], ["−π/6", -PI / 6], ["+π/6", PI / 6], ["+2π", 2 * PI]].forEach(function (m) {
      cb.appendChild(bouton(m[0], function () { x = Math.max(lo, Math.min(hi, Math.round((x + m[1]) / (PI / 6)) * PI / 6)); dessiner(); }));
    });
    cb.appendChild(valeurs.bouton);
    host.appendChild(ax); host.appendChild(cc); host.appendChild(cb); host.appendChild(info); host.appendChild(valeurs);
    dessiner();
  }

  function enPreparation(host) {
    host.appendChild(h("div", "ia-info", "Animation en préparation : voir la figure du cours imprimé."));
  }

  var WIDGETS = { enroulement: enroulement, roue: roue, anneaux: anneaux, "cercle-equation": cercleEquation, parametres: parametres, "pente-sinus": penteSinus, "axe-tours": axeTours };
  function construire(host) {
    if (host.dataset.wired) return;
    host.dataset.wired = "1";
    host.classList.add("ia");
    var cfg = {};
    try { cfg = JSON.parse(host.dataset.cfg || "{}"); } catch (e) { host.textContent = "Animation : réglages illisibles."; return; }
    var w = WIDGETS[host.dataset.tg] || enPreparation;
    try { w(host, cfg); } catch (e) { host.textContent = "Animation non disponible (" + e.message + ")."; }
  }
  function setup() { document.querySelectorAll(".tg").forEach(construire); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
  window.TypwebTrigo = { setup: setup, enPi: enPi };
})();
