/* ============================================================
   lim-plot.js — « point mobile » pour le cours de limites (5UAA3)
   Usage : <div class="lim-plot" data-fig="c2-f19"></div>
   Données : window.LIM_FIGS[id], GÉNÉRÉES par outils/typ2site.py à
   partir des figures des notes Typst (_includes/figures-data.html).
   Réglages facultatifs sur le div : data-ecart, data-depassement.
   Aucune dépendance externe ; SVG + variables CSS (clair/sombre).
   ============================================================ */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var INF = Infinity;

  // ---------- nombres à la française ----------
  var NF = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 10, useGrouping: true });
  function fmt(v) {
    if (v === undefined || v === null || isNaN(v)) return "—";
    if (v === INF) return "+∞";
    if (v === -INF) return "−∞";
    var r = parseFloat(v.toPrecision(8));
    if (Math.abs(r) < 1e-12) r = 0;
    return NF.format(r).replace("-", "−");
  }
  function parseA(s) {
    if (typeof s === "number") return isNaN(s) ? null : s;
    s = String(s).trim().replace(",", ".").replace("−", "-").replace(/\s/g, "");
    if (/^\+?(inf|∞|\+∞|infinity)$/i.test(s)) return INF;
    if (/^-(inf|∞|infinity)$/i.test(s)) return -INF;
    var v = parseFloat(s);
    return isFinite(v) ? v : null;
  }
  function fmtA(a) { return a === INF ? "+∞" : a === -INF ? "−∞" : fmt(a); }

  // ---------- une courbe : morceaux + points isolés ----------
  // morceau exact : { expr: "(1.0 / x)", de, a, ferme: [bool, bool] }
  // morceau échantillonné : { ech: [[[x, y], …], …], gauche, droite }
  //   gauche / droite : ["AH", b] | ["AO", m, p] | ["AV", a, signe] | ["inf", signe] | null
  // isoles : [[x, y]] points pleins hors de la courbe ; exclus : abscisses retirées
  function compile(expr) {
    /* eslint-disable no-new-func */
    return new Function("x", "return (" + expr + ");");
  }
  function prepare(c) {
    if (c._pret) return;
    c._pret = true;
    c.morceaux.forEach(function (m) {
      if (m.expr !== undefined && !m.f) m.f = compile(m.expr);
      if (m.ech && !m.f) {
        m.pts = []; m.arcs = [];
        m.ech.slice().sort(function (p, q) { return p[0][0] - q[0][0]; })
          .forEach(function (arc) { m.pts = m.pts.concat(arc); m.arcs.push([arc[0][0], arc[arc.length - 1][0]]); });
        m.x0 = m.pts.length ? m.pts[0][0] : INF;
        m.x1 = m.pts.length ? m.pts[m.pts.length - 1][0] : -INF;
      }
    });
  }
  function interp(pts, x) {
    var lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (pts[mid][0] <= x) lo = mid; else hi = mid; }
    var A = pts[lo], B = pts[hi];
    return B[0] === A[0] ? A[1] : A[1] + (B[1] - A[1]) * (x - A[0]) / (B[0] - A[0]);
  }
  function extrap(b, xe, ye, x, fen) {
    var D = (fen[1] - fen[0]) / 4, dx = Math.abs(x - xe);
    if (b[0] === "AH") return b[1] + (ye - b[1]) * D / (D + dx);
    if (b[0] === "AO") { var L = function (t) { return b[1] * t + b[2]; }; return L(x) + (ye - L(xe)) * D / (D + dx); }
    if (b[0] === "AV") {
      var a = b[1];
      if ((x - a) * (xe - a) <= 0 || Math.abs(x - a) >= Math.abs(xe - a)) return undefined;
      var K = Math.abs(xe - a) * Math.abs(ye) || 1;
      return ye + b[2] * K * (1 / Math.abs(x - a) - 1 / Math.abs(xe - a));
    }
    if (b[0] === "inf") return ye + b[1] * dx * 2;
    return undefined;
  }
  function evaluer(c, x, fen) {
    if (!isFinite(x)) return undefined;
    prepare(c);
    var iso = c.isoles || [], exc = c.exclus || [], i, m, y;
    for (i = 0; i < iso.length; i++) if (Math.abs(iso[i][0] - x) < 1e-12) return iso[i][1];
    for (i = 0; i < exc.length; i++) if (Math.abs(exc[i] - x) < 1e-12) return undefined;
    for (i = 0; i < c.morceaux.length; i++) {
      m = c.morceaux[i];
      if (m.f) {
        var f = m.ferme || [false, false];
        var okG = f[0] ? x >= m.de : x > m.de;
        var okD = f[1] ? x <= m.a : x < m.a;
        if (okG && okD) { y = m.f(x); return (typeof y === "number" && isFinite(y)) ? y : undefined; }
      } else if (x >= m.x0 && x <= m.x1) {
        for (var k = 0; k < m.arcs.length; k++)
          if (x >= m.arcs[k][0] - 1e-9 && x <= m.arcs[k][1] + 1e-9) return interp(m.pts, x);
        return undefined;
      }
    }
    for (i = 0; i < c.morceaux.length; i++) {
      m = c.morceaux[i];
      if (m.f || !m.pts.length) continue;
      var n = m.pts.length;
      if (x < m.x0 && m.gauche) y = extrap(m.gauche, m.x0, m.pts[0][1], x, fen);
      else if (x > m.x1 && m.droite) y = extrap(m.droite, m.x1, m.pts[n - 1][1], x, fen);
      else continue;
      if (y !== undefined && isFinite(y)) return y;
    }
    return undefined;
  }

  // ---------- trajet du point : x en fonction du curseur v ----------
  // a fini (s = côté, e = écart de départ, p = dépassement) :
  //   v ∈ [0 ; 800]    approche géométrique  x = a + s·e·10^(−5v/800)
  //   v ∈ ]800 ; 850[  x = a (permis par la définition)
  //   v ∈ [850 ; 1000] dépassement  x = a − s·p·10^(−5 + 5u)
  // a = ±∞ : x = x0 ± (10^(6v/1000) − 1)
  function xDe(st, v) {
    var a = st.a;
    if (a === INF || a === -INF) return st.x0 + (a === INF ? 1 : -1) * (Math.pow(10, 6 * v / 1000) - 1);
    if (v <= 800) return a + st.cote * st.ecart * Math.pow(10, -5 * v / 800);
    if (v < 850) return a;
    return a - st.cote * st.dep * Math.pow(10, -5 + 5 * (v - 850) / 150);
  }
  function crans(st) {
    if (st.a === INF || st.a === -INF) return [0, 1, 2, 3, 4, 5, 6].map(function (k) { return k * 1000 / 6; });
    return [0, 160, 320, 480, 640, 800, 825, 850, 880, 910, 940, 970, 1000];
  }

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function normaliser(fig) {
    if (fig.courbes) return;
    fig.courbes = [{ morceaux: fig.morceaux || [], isoles: fig.isoles, exclus: fig.exclus,
                     pleins: fig.pleins, creux: fig.creux, approx: fig.approx }];
  }

  var uid = 0;

  function build(host) {
    if (host.dataset.wired) return;
    var fig = (window.LIM_FIGS || {})[host.dataset.fig];
    if (!fig) { host.textContent = "Figure inconnue : " + host.dataset.fig; return; }
    host.dataset.wired = "1";
    normaliser(fig);
    fig.courbes.forEach(prepare);
    var id = "lp" + (++uid);
    var W = fig.fenetre, xmin = W[0], xmax = W[1], ymin = W[2], ymax = W[3];
    var nomF = fig.nom || "f";

    // ---- géométrie (même unité en x et en y si possible, comme dans les notes) ----
    var Ux, Uy;
    var large = false;
    if (fig.taille) {                        // mêmes proportions que dans les notes
      var tw = fig.taille[0], th = fig.taille[1];
      large = tw / th > 1.6;
      var Wpx = large ? 640 : 400, Hpx = Wpx * th / tw;
      if (Hpx > 360) { Wpx *= 360 / Hpx; Hpx = 360; }
      Ux = Wpx / (xmax - xmin); Uy = Hpx / (ymax - ymin);
    } else {
      Ux = 400 / (xmax - xmin); Uy = 330 / (ymax - ymin);
      var U = Math.min(Ux, Uy);
      if (Math.max(Ux, Uy) / U > 6) { Ux = Math.min(Ux, 6 * U); Uy = Math.min(Uy, 6 * U); } else { Ux = Uy = U; }
    }
    var B = 54, LAB = 30;
    var PX0 = LAB + B, PX1 = PX0 + Ux * (xmax - xmin);
    var PY0 = LAB - 8 + B, PY1 = PY0 + Uy * (ymax - ymin);
    var SW = PX1 + B + LAB, SH = PY1 + B + LAB - 8;
    var Lx = (xmax - xmin) / 3, Ly = (ymax - ymin) / 3;
    function comp(t) { return t / (1 + t); }
    function X(x) {
      if (x === INF) return PX1 + B; if (x === -INF) return PX0 - B;
      if (x > xmax) return PX1 + B * comp((x - xmax) / Lx);
      if (x < xmin) return PX0 - B * comp((xmin - x) / Lx);
      return PX0 + (x - xmin) * Ux;
    }
    function Y(y) {
      if (y === INF) return PY0 - B; if (y === -INF) return PY1 + B;
      if (y > ymax) return PY0 - B * comp((y - ymax) / Ly);
      if (y < ymin) return PY1 + B * comp((ymin - y) / Ly);
      return PY1 - (y - ymin) * Uy;
    }
    function XL(x) { return PX0 + (x - xmin) * Ux; }      // linéaire (tracés découpés)
    function YL(y) { return PY1 - (y - ymin) * Uy; }
    var ox = (xmin <= 0 && 0 <= xmax) ? 0 : xmin;
    var oy = (ymin <= 0 && 0 <= ymax) ? 0 : ymin;

    // ---- DOM ----
    var wrap = h("div", "lp-wrap");
    var left = h("div", "lp-fig");
    var right = h("div", "lp-side");
    wrap.appendChild(left); wrap.appendChild(right);
    if (large) wrap.classList.add("lp-large");       // graphique large : menu en dessous
    host.appendChild(wrap);

    var svg = el("svg", { viewBox: "0 0 " + SW + " " + SH, role: "img", "aria-label": "Graphique" }, left);
    var defs = el("defs", {}, svg);
    var clip = el("clipPath", { id: id + "c" }, defs);
    el("rect", { x: PX0, y: PY0, width: PX1 - PX0, height: PY1 - PY0 }, clip);

    // grille (pas de grille si trop serrée)
    var gGrid = el("g", { "class": "lp-grid" }, svg);
    var gr = fig.grille || fig.pas || [1, 1];
    if ((xmax - xmin) / gr[0] <= 60)
      for (var gx = Math.ceil(xmin / gr[0] - 1e-9) * gr[0]; gx <= xmax + 1e-9; gx += gr[0])
        el("line", { x1: XL(gx), y1: PY0, x2: XL(gx), y2: PY1 }, gGrid);
    if ((ymax - ymin) / gr[1] <= 60)
      for (var gy = Math.ceil(ymin / gr[1] - 1e-9) * gr[1]; gy <= ymax + 1e-9; gy += gr[1])
        el("line", { x1: PX0, y1: YL(gy), x2: PX1, y2: YL(gy) }, gGrid);

    // cadre « à l'infini » + croix au bout des axes
    var gInf = el("g", { "class": "lp-inf" }, svg);
    el("rect", { x: PX0 - B, y: PY0 - B, width: PX1 - PX0 + 2 * B, height: PY1 - PY0 + 2 * B, "class": "lp-cadre" }, gInf);
    var bordG = el("line", { x1: PX0 - B, y1: PY0 - B, x2: PX0 - B, y2: PY1 + B, "class": "lp-bord" }, gInf);
    var bordD = el("line", { x1: PX1 + B, y1: PY0 - B, x2: PX1 + B, y2: PY1 + B, "class": "lp-bord" }, gInf);
    [[PX1 + B, YL(oy), "+∞", "start", 9, 5], [PX0 - B, YL(oy), "−∞", "end", -9, 5],
     [XL(ox), PY0 - B, "+∞", "middle", 0, -10], [XL(ox), PY1 + B, "−∞", "middle", 0, 21]].forEach(function (c) {
      var e = 6;
      el("path", { d: "M" + (c[0] - e) + " " + c[1] + "H" + (c[0] + e) + "M" + c[0] + " " + (c[1] - e) + "V" + (c[1] + e), "class": "lp-croix" }, gInf);
      var t = el("text", { x: c[0] + c[4], y: c[1] + c[5], "text-anchor": c[3], "class": "lp-inflab" }, gInf);
      t.textContent = c[2];
    });

    // axes + graduations
    var gAx = el("g", { "class": "lp-axes" }, svg);
    el("line", { x1: PX0, y1: YL(oy), x2: PX1 + 6, y2: YL(oy) }, gAx);
    el("line", { x1: XL(ox), y1: PY1, x2: XL(ox), y2: PY0 - 6 }, gAx);
    el("path", { d: "M" + (PX1 + 8) + " " + YL(oy) + "l-8 -4v8z", "class": "lp-fleche" }, gAx);
    el("path", { d: "M" + XL(ox) + " " + (PY0 - 8) + "l-4 8h8z", "class": "lp-fleche" }, gAx);
    var tx = el("text", { x: PX1 + 4, y: YL(oy) - 8, "class": "lp-axlab" }, gAx); tx.textContent = "x";
    var ty = el("text", { x: XL(ox) + 9, y: PY0 - 2, "class": "lp-axlab" }, gAx); ty.textContent = "y";
    var pas = fig.pas || [1, 1];
    for (var lx = Math.ceil(xmin / pas[0] - 1e-9) * pas[0]; lx <= xmax + 1e-9; lx += pas[0]) {
      if (Math.abs(lx - ox) < 1e-9) continue;
      el("line", { x1: XL(lx), y1: YL(oy) - 3, x2: XL(lx), y2: YL(oy) + 3 }, gAx);
      var t1 = el("text", { x: XL(lx), y: YL(oy) + 15, "text-anchor": "middle", "class": "lp-tick" }, gAx);
      t1.textContent = fmt(lx);
    }
    for (var ly = Math.ceil(ymin / pas[1] - 1e-9) * pas[1]; ly <= ymax + 1e-9; ly += pas[1]) {
      if (Math.abs(ly - oy) < 1e-9) continue;
      el("line", { x1: XL(ox) - 3, y1: YL(ly), x2: XL(ox) + 3, y2: YL(ly) }, gAx);
      var t2 = el("text", { x: XL(ox) - 6, y: YL(ly) + 4, "text-anchor": "end", "class": "lp-tick" }, gAx);
      t2.textContent = fmt(ly);
    }

    // repère de la valeur a
    var gA = el("g", { "class": "lp-a" }, svg);
    var aLine = el("line", { y1: PY0 - B, y2: PY1 + B }, gA);
    var aLab = el("text", { "class": "lp-alab" }, gA);

    // asymptotes (tirets)
    var gAsym = el("g", { "clip-path": "url(#" + id + "c)", "class": "lp-asym" }, svg);
    (fig.asymptotes || []).forEach(function (s) {
      el("line", { x1: XL(s[0][0]), y1: YL(s[0][1]), x2: XL(s[1][0]), y2: YL(s[1][1]) }, gAsym);
    });
    // décor (segments d'écart…)
    var gDeco = el("g", { "clip-path": "url(#" + id + "c)", "class": "lp-deco" }, svg);
    (fig.deco || []).forEach(function (pl) {
      el("path", { d: pl.map(function (p, k) { return (k ? "L" : "M") + XL(p[0]).toFixed(2) + " " + YL(p[1]).toFixed(2); }).join("") }, gDeco);
    });

    // courbes
    var gCurve = el("g", { "clip-path": "url(#" + id + "c)" }, svg);
    fig.courbes.forEach(function (c) {
      var g = el("g", { "class": "lp-courbe lp-c" + (c.couleur || 1) + (c.style === "pointille" ? " lp-pointille" : "") }, gCurve);
      c.morceaux.forEach(function (m) {
        if (!m.f) {
          (m.ech || []).forEach(function (arc) {
            el("path", { d: arc.map(function (p, k) { return (k ? "L" : "M") + XL(p[0]).toFixed(2) + " " + YL(p[1]).toFixed(2); }).join("") }, g);
          });
          return;
        }
        var lo = Math.max(m.de, xmin), hi = Math.min(m.a, xmax);
        if (!(lo < hi)) return;
        var xs = [], N = 600, i;
        for (i = 0; i <= N; i++) xs.push(lo + (hi - lo) * i / N);
        [1e-2, 3e-3, 1e-3, 3e-4, 1e-4, 3e-5, 1e-5].forEach(function (e) {
          if (m.de >= xmin && isFinite(m.de)) xs.push(m.de + e * (hi - lo));
          if (m.a <= xmax && isFinite(m.a)) xs.push(m.a - e * (hi - lo));
        });
        xs.sort(function (p, q) { return p - q; });
        var d = "", pen = false, big = 20 * (ymax - ymin);
        xs.forEach(function (x) {
          var y = m.f(x);
          if (typeof y !== "number" || !isFinite(y)) { pen = false; return; }
          y = Math.max(ymin - big, Math.min(ymax + big, y));
          d += (pen ? "L" : "M") + XL(x).toFixed(2) + " " + YL(y).toFixed(2);
          pen = true;
        });
        el("path", { d: d }, g);
      });
    });
    var gPts = el("g", { "class": "lp-pts" }, svg);
    fig.courbes.forEach(function (c) {
      var cl = " lp-c" + (c.couleur || 1);
      (c.creux || []).forEach(function (p) { el("circle", { cx: X(p[0]), cy: Y(p[1]), r: 4.2, "class": "lp-creux" + cl }, gPts); });
      (c.pleins || []).concat(c.isoles || []).forEach(function (p) { el("circle", { cx: X(p[0]), cy: Y(p[1]), r: 4.2, "class": "lp-plein" + cl }, gPts); });
    });
    var gBul = el("g", { "class": "lp-bulles" }, svg);
    (fig.bulles || []).forEach(function (b) {
      el("line", { x1: X(b[1][0]), y1: Y(b[1][1]), x2: X(b[0][0]), y2: Y(b[0][1]) }, gBul);
      el("circle", { cx: X(b[1][0]), cy: Y(b[1][1]), r: 10 }, gBul);
      var tb = el("text", { x: X(b[1][0]), y: Y(b[1][1]) + 4.5, "text-anchor": "middle" }, gBul);
      tb.textContent = b[2];
    });
    if (fig.mfixe) {            // le point M des notes : visible seulement panneau fermé
      el("circle", { cx: X(fig.mfixe[0]), cy: Y(fig.mfixe[1]), r: 4.2, "class": "lp-plein lp-c1 lp-mfixe" }, svg);
      var tm = el("text", { x: X(fig.mfixe[0]) + 7, y: Y(fig.mfixe[1]) - 7, "class": "lp-etiq lp-mfixe" }, svg);
      tm.textContent = "M";
    }
    (fig.textes || []).forEach(function (t) {
      var tt = el("text", { x: X(t[0][0]) + 7, y: Y(t[0][1]) - 7, "class": "lp-etiq" }, svg);
      tt.textContent = t[1];
    });

    if (fig.statique || !fig.courbes.length) {
      wrap.classList.add("lp-statique");
      right.remove();
      svg.style.cursor = "default";
      return;
    }

    // point mobile replié par défaut : bouton « ▸ point mobile » pour l'ouvrir
    // (fig.replie === false ou data-replie="0" : ouvert d'emblée)
    var ouvrir = null;
    if (fig.replie !== false && host.dataset.replie !== "0") {
      wrap.classList.add("lp-replie");
      ouvrir = h("button", "lp-ouvrir", "▸");
      ouvrir.type = "button"; ouvrir.setAttribute("aria-expanded", "false");
      ouvrir.setAttribute("aria-label", "Point mobile");
      ouvrir.title = "Afficher le point mobile et ses réglages";
      left.appendChild(ouvrir);
      ouvrir.addEventListener("click", function () {
        var ferme = wrap.classList.toggle("lp-replie");
        ouvrir.textContent = ferme ? "▸" : "▾";
        ouvrir.title = ferme ? "Afficher le point mobile et ses réglages" : "Masquer le point mobile";
        ouvrir.setAttribute("aria-expanded", ferme ? "false" : "true");
      });
    }

    // trace et point mobile
    var trail = el("path", { "class": "lp-trace" }, svg);
    var gM = el("g", { "class": "lp-M" }, svg);
    el("circle", { r: 5.5 }, gM);
    var Ml = el("text", { dx: 8, dy: -8 }, gM); Ml.textContent = "M";

    // ---- panneau ----
    var aBox = h("div", "lp-choix");
    aBox.appendChild(h("span", "lp-lbl", "<i>x</i> tend vers"));
    var chips = h("div", "lp-chips");
    aBox.appendChild(chips);
    right.appendChild(aBox);
    var chipEls = [];
    (fig.valeurs || []).concat(["+inf", "-inf"]).forEach(function (s) {
      var v = parseA(s);
      if (v === null) return;
      var b = h("button", "lp-chip", fmtA(v));
      b.type = "button";
      b.addEventListener("click", function () { choisirA(v); });
      chipEls.push([v, b]);
      chips.appendChild(b);
    });
    var aIn = document.createElement("input");
    aIn.type = "text"; aIn.inputMode = "decimal"; aIn.placeholder = "autre"; aIn.className = "lp-ain";
    aIn.id = id + "-a"; aIn.setAttribute("aria-label", "Autre valeur de a");
    aIn.addEventListener("change", function () { var v = parseA(aIn.value); if (v !== null) choisirA(v); });
    chips.appendChild(aIn);

    var info = h("p", "lp-info");
    right.appendChild(info);

    var ctrl = h("div", "lp-ctrl");
    var prev = h("button", "lp-btn", "◀"); prev.type = "button"; prev.setAttribute("aria-label", "Valeur précédente");
    var range = document.createElement("input");
    range.type = "range"; range.min = 0; range.max = 1000; range.step = "any"; range.value = 0; range.id = id + "-v";
    range.setAttribute("aria-label", "Faire avancer le point M");
    var next = h("button", "lp-btn", "▶"); next.type = "button"; next.setAttribute("aria-label", "Valeur suivante");
    ctrl.appendChild(prev); ctrl.appendChild(range); ctrl.appendChild(next);
    right.appendChild(ctrl);
    var echelle = h("div", "lp-echelle");
    right.appendChild(echelle);

    // valeurs : MASQUÉES par défaut (bouton)
    var live = h("div", "lp-live masque");
    var bVal = h("button", "lp-btn2 lp-ghost lp-voir", "Afficher les valeurs");
    bVal.type = "button"; bVal.setAttribute("aria-expanded", "false");
    var rowX = h("div", "lp-kv"), rowY = h("div", "lp-kv");
    rowX.innerHTML = '<span class="k"><i>x</i> =</span><span class="v" data-r="x">—</span>';
    rowY.innerHTML = '<span class="k"><i>f</i>(<i>x</i>) =</span><span class="v" data-r="y">—</span>';
    var vals = h("div", "lp-vals");
    vals.setAttribute("aria-live", "polite");
    vals.appendChild(rowX); vals.appendChild(rowY);
    var note = h("div", "lp-note");
    vals.appendChild(note);
    var rowE = null;
    if (fig.ecart && (fig.asymptotes || []).length) {
      rowE = h("div", "lp-kv lp-kv-ecart");
      rowE.innerHTML = '<span class="k">écart =</span><span class="v" data-r="e">—</span>';
      right.appendChild(rowE);
    }
    var segE = el("line", { "class": "lp-ecart" }, svg);
    var approx = fig.courbes.some(function (c) { return c.approx; });
    if (approx) vals.appendChild(h("div", "lp-approx", "Courbe dessinée point par point : valeurs lues sur le graphique, à 0,01 près."));
    var acts = h("div", "lp-acts");
    var bNote = h("button", "lp-btn2", "Noter la valeur"); bNote.type = "button";
    var bClr = h("button", "lp-btn2 lp-ghost", "Effacer"); bClr.type = "button";
    acts.appendChild(bNote); acts.appendChild(bClr);
    vals.appendChild(acts);
    var tab = h("table", "lp-tab");
    tab.innerHTML = "<thead><tr><th><i>x</i></th><th><i>f</i>(<i>x</i>)</th></tr></thead><tbody></tbody>";
    tab.hidden = true;
    vals.appendChild(tab);
    live.appendChild(bVal);
    live.appendChild(vals);
    right.appendChild(live);
    bVal.addEventListener("click", function () {
      var m = live.classList.toggle("masque");
      bVal.textContent = m ? "Afficher les valeurs" : "Masquer les valeurs";
      bVal.setAttribute("aria-expanded", m ? "false" : "true");
    });

    // ---- état ----
    function param(nomD, nomF) {
      var v = parseFloat(String(host.dataset[nomD] || "").replace(",", "."));
      if (isFinite(v) && v > 0) return v;
      return fig[nomF] > 0 ? fig[nomF] : 1;
    }
    var st = { a: null, x0: null, cote: 1, c: fig.courbes[0],
               ecart: param("ecart", "ecart"), dep: param("depassement", "depassement") };
    function ev(x) { return evaluer(st.c, x, W); }
    function fmtY(v) {
      if (v === undefined) return "n'existe pas";
      if (!st.c.approx) return fmt(v);
      return "≈ " + NF.format(Math.round(v * 100) / 100 || 0).replace("-", "−");
    }

    function snapX(x) {
      var q = (st.a === INF || st.a === -INF) ? 1 : 0.1;
      return parseFloat((Math.round(x / q) * q).toFixed(4));
    }

    function choisirA(a) {
      st.a = a; st.x0 = null; range.value = 0;
      chipEls.forEach(function (c) { c[1].classList.toggle("on", c[0] === a); });
      aIn.value = chipEls.some(function (c) { return c[0] === a; }) ? "" : fmtA(a);
      bordG.classList.toggle("on", a === -INF);
      bordD.classList.toggle("on", a === INF);
      if (isFinite(a)) {
        var on = a >= xmin && a <= xmax;
        aLine.setAttribute("x1", XL(a)); aLine.setAttribute("x2", XL(a));
        aLine.style.display = on ? "" : "none";
        aLab.setAttribute("x", XL(a) + 6); aLab.setAttribute("y", PY1 + B * 0.5);
        aLab.textContent = "a = " + fmt(a);
        aLab.style.display = on ? "" : "none";
      } else { aLine.style.display = "none"; aLab.style.display = "none"; }
      render();
    }

    function placer(x, courbe) {
      if (st.a === null) return;
      if (courbe) st.c = courbe;
      if (isFinite(st.a)) {
        if (Math.abs(x - st.a) < 1e-9) { info.textContent = "Clique à gauche ou à droite de a."; return; }
        st.cote = x > st.a ? 1 : -1;
        st.x0 = st.a + st.cote * st.ecart;
      } else {
        var x0 = snapX(x);
        st.x0 = ev(x0) === undefined ? x : x0;
      }
      range.value = 0; render();
    }

    function render() {
      echelle.innerHTML = "";
      if (st.a === null) { info.textContent = "Choisis une valeur de a."; return; }
      if (st.x0 === null) {
        info.innerHTML = "Clique sur la courbe pour placer le point <b>M</b>.";
        gM.style.display = "none"; trail.setAttribute("d", "");
        vals.querySelector('[data-r="x"]').textContent = "—";
        vals.querySelector('[data-r="y"]').textContent = "—";
        note.textContent = ""; range.disabled = true; prev.disabled = next.disabled = bNote.disabled = true;
        return;
      }
      range.disabled = false; prev.disabled = next.disabled = bNote.disabled = false;
      var inf = !isFinite(st.a);
      info.innerHTML = inf
        ? "Fais avancer <b>M</b> : <i>x</i> devient " + (st.a > 0 ? "de plus en plus grand." : "négatif, de plus en plus grand en valeur absolue.")
        : "Fais avancer <b>M</b> : <i>x</i> se rapproche de " + fmt(st.a) + " par la " + (st.cote > 0 ? "droite" : "gauche") + ", l'atteint, puis le dépasse.";
      echelle.innerHTML = inf
        ? "<span>départ</span><span>" + (st.a > 0 ? "vers +∞" : "vers −∞") + "</span>"
        : "<span>départ</span><span><i>x</i> = " + fmt(st.a) + "</span><span>au-delà</span>";

      var v = parseFloat(range.value);
      var x = xDe(st, v), y = ev(x);
      vals.querySelector('[data-r="x"]').textContent = fmt(x);
      vals.querySelector('[data-r="y"]').textContent = fmtY(y);
      if (y === undefined) {
        note.textContent = (isFinite(st.a) && x === st.a)
          ? "f(" + fmt(x) + ") n'existe pas : " + fmt(x) + " n'est pas dans le domaine. Pas de point M."
          : "Aucun point du graphique n'a cette abscisse : " + fmt(x) + " n'est pas dans le domaine.";
      } else if (isFinite(st.a) && x === st.a) {
        note.textContent = "x = a est permis : M est le point du graphique d'abscisse " + fmt(x) + ".";
      } else note.textContent = "";

      var d = "", pen = false, n = 240;
      for (var i = 0; i <= n; i++) {
        var vi = v * i / n, xi = xDe(st, vi), yi = ev(xi);
        if (yi === undefined) { pen = false; continue; }
        d += (pen ? "L" : "M") + X(xi).toFixed(2) + " " + Y(yi).toFixed(2);
        pen = true;
      }
      trail.setAttribute("d", d);
      // écart entre M et l'asymptote concernée
      segE.style.display = "none";
      if (rowE) {
        var txt = "—", asy = fig.asymptotes;
        if (y !== undefined) {
          if (isFinite(st.a)) {
            var av = asy.filter(function (s) { return Math.abs(s[0][0] - s[1][0]) < 1e-9 && Math.abs(s[0][0] - st.a) < 1e-9; })[0];
            if (av) {
              txt = fmt(Math.abs(x - st.a)) + " (horizontal : distance de x à " + fmt(st.a) + ")";
              segE.setAttribute("x1", X(x)); segE.setAttribute("x2", X(st.a));
              segE.setAttribute("y1", Y(y)); segE.setAttribute("y2", Y(y)); segE.style.display = "";
            }
          } else {
            var ob = asy.filter(function (s) { return Math.abs(s[0][0] - s[1][0]) > 1e-9; })[0];
            if (ob) {
              var m = (ob[1][1] - ob[0][1]) / (ob[1][0] - ob[0][0]), q = ob[0][1] - m * ob[0][0];
              var yd = m * x + q;
              txt = fmt(Math.abs(y - yd)) + " (vertical : entre f(x) et la droite)";
              segE.setAttribute("x1", X(x)); segE.setAttribute("x2", X(x));
              segE.setAttribute("y1", Y(y)); segE.setAttribute("y2", Y(yd)); segE.style.display = "";
            }
          }
        }
        rowE.querySelector('[data-r="e"]').textContent = txt;
      }
      if (y === undefined) gM.style.display = "none";
      else {
        gM.style.display = "";
        gM.setAttribute("transform", "translate(" + X(x).toFixed(2) + " " + Y(y).toFixed(2) + ")");
        gM.classList.toggle("dehors", x < xmin || x > xmax || y < ymin || y > ymax);
      }
    }

    function pas(dir) {
      var c = crans(st), v = parseFloat(range.value), k;
      if (dir > 0) { for (k = 0; k < c.length; k++) if (c[k] > v + 1e-6) break; if (k < c.length) range.value = c[k]; }
      else { for (k = c.length - 1; k >= 0; k--) if (c[k] < v - 1e-6) break; if (k >= 0) range.value = c[k]; }
      render();
    }

    range.addEventListener("input", render);
    prev.addEventListener("click", function () { pas(-1); });
    next.addEventListener("click", function () { pas(1); });
    bNote.addEventListener("click", function () {
      var x = xDe(st, parseFloat(range.value)), y = ev(x);
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>" + fmt(x) + "</td><td>" + fmtY(y) + "</td>";
      tab.tBodies[0].appendChild(tr); tab.hidden = false;
    });
    bClr.addEventListener("click", function () { tab.tBodies[0].innerHTML = ""; tab.hidden = true; });

    // clic sur une courbe : la plus proche, et l'abscisse du point visé
    svg.addEventListener("click", function (evt) {
      if (st.a === null) return;
      var pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
      var p = pt.matrixTransform(svg.getScreenCTM().inverse());
      if (p.x < PX0 || p.x > PX1 || p.y < PY0 || p.y > PY1) return;
      var best = null, bc = null, bd = 18;
      fig.courbes.forEach(function (c) {
        for (var sx = PX0; sx <= PX1; sx += 0.5) {
          var x = xmin + (sx - PX0) / Ux, y = evaluer(c, x, W);
          if (y === undefined || y < ymin || y > ymax) continue;
          var dd = Math.hypot(sx - p.x, YL(y) - p.y);
          if (dd < bd) { bd = dd; best = x; bc = c; }
        }
      });
      if (best === null) { info.textContent = "Clique plus près de la courbe."; return; }
      placer(best, bc);
    });

    // départ : la valeur proposée, côté où la fonction est définie
    if (fig.depart) {
      var a0 = parseA(fig.depart.a);
      choisirA(a0);
      if (isFinite(a0)) {
        var c0 = null, s0 = 1;
        fig.courbes.some(function (c) {
          if (evaluer(c, a0 + st.ecart, W) !== undefined) { c0 = c; s0 = 1; return true; }
          if (evaluer(c, a0 - st.ecart, W) !== undefined) { c0 = c; s0 = -1; return true; }
          return false;
        });
        if (fig.mfixe) {          // le point mobile part de l'endroit où les notes placent M
          var cm = null;
          fig.courbes.some(function (c) { var y = evaluer(c, fig.mfixe[0], W); if (y !== undefined && Math.abs(y - fig.mfixe[1]) < 0.05) { cm = c; return true; } return false; });
          if (cm) { placer(fig.mfixe[0], cm); c0 = null; }
        }
        if (c0) placer(a0 + s0 * st.ecart, c0);
      } else if (fig.depart.x0 !== undefined) placer(fig.depart.x0, fig.courbes[0]);
    } else render();
  }

  function setup() { document.querySelectorAll(".lim-plot").forEach(build); }
  if (document.readyState !== "loading") setup();
  document.addEventListener("DOMContentLoaded", setup);
  window.LimPlot = { setup: setup, evaluer: evaluer, xDe: xDe, fmt: fmt };
})();
