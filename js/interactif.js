/* ============================================================
   interactif.js — figures interactives génériques (module typweb
   « interactif »). Chaque figure est un <div class="ia" data-ia="…"
   data-cfg='{…}'> généré depuis les notes Typst :
     suite      #suite-graphe   points, escalier, toile, bande de convergence,
                                curseurs sur les paramètres (raison, premier terme…)
                nuage…          (module suites) termes dévoilés un à un ; figure fixe,
                                points cachés (réponse) ou reliés
     droite     droite graduée  termes reportés sur une droite (réponse cachée ou donnée)
     rangs      axe des rangs   se repérer : terme suivant, précédent…
     tangente   #tangente       tangente mobile, sécante, graphe de f'
     trigo      #cercle-trigo   cercle trigonométrique ↔ graphe
     log        #repere-log     échelle linéaire / semi-log / log-log
     riemann    #riemann        rectangles, trapèzes, somme ↔ intégrale
     binomiale  #loi-binomiale  diagramme en bâtons, P(X = k), P(X ≤ k)
     normale    #loi-normale    courbe, aire P(a ≤ X ≤ b)
   Aucune dépendance. Couleurs : variables CSS du thème (clair/sombre).
   Les fonctions arrivent sous forme d'expression JavaScript en x
   (traduite depuis x => … par typweb) ou d'un échantillon de points.
   ============================================================ */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------ outils
  function fmt(v, d) {
    if (v === Infinity) return "+∞";
    if (v === -Infinity) return "−∞";
    if (!isFinite(v)) return "—";
    d = d == null ? 3 : d;
    var m = Math.pow(10, d), r = Math.round(v * m) / m;
    if (Object.is(r, -0)) r = 0;
    return String(r).replace(".", ",").replace("-", "−");
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
    if (html != null) e.innerHTML = html;
    return e;
  }
  function fonction(c) {
    if (!c) return null;
    if (c.js) {
      try { var f = new Function("x", "return (" + c.js + ");"); f(0); return function (x) { var y = f(x); return typeof y === "number" ? y : NaN; }; } catch (e) {}
    }
    if (c.ech && c.ech.length) {             // échantillon [[x, y], …] (null = hors domaine)
      var pts = c.ech;
      return function (x) {
        var lo = 0, hi = pts.length - 1;
        if (x < pts[0][0] || x > pts[hi][0]) return NaN;
        while (hi - lo > 1) { var m = (lo + hi) >> 1; if (pts[m][0] <= x) lo = m; else hi = m; }
        var a = pts[lo], b = pts[hi];
        if (a[1] == null || b[1] == null) return NaN;
        return a[1] + (b[1] - a[1]) * (x - a[0]) / ((b[0] - a[0]) || 1);
      };
    }
    return null;
  }
  function curseur(label, min, max, pas, val, onInput, unite) {
    var w = h("label", "ia-curseur");
    var t = h("span", "ia-lab", label);
    var r = h("input"); r.type = "range"; r.min = min; r.max = max; r.step = pas; r.value = val;
    var v = h("span", "ia-val");
    function maj() { v.textContent = (unite ? unite(+r.value) : fmt(+r.value, 3)); onInput(+r.value); }
    r.addEventListener("input", maj);
    w.appendChild(t); w.appendChild(r); w.appendChild(v);
    w.maj = maj; w.input = r;
    return w;
  }
  function bouton(txt, on) { var b = h("button", "ia-btn", txt); b.type = "button"; b.addEventListener("click", on); return b; }
  function ctrl() { return h("div", "ia-ctrl"); }
  function info() { return h("div", "ia-info"); }

  // Repère : graduations « rondes », grille en tirets, axes, échelles log facultatives
  function pasRond(etendue, n) {
    var brut = etendue / (n || 6), e = Math.pow(10, Math.floor(Math.log10(brut))), m = brut / e;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
  }
  function Repere(parent, o) {
    var W = o.w || 520, H = o.h || 340, M = { g: 44, d: 14, h: 14, b: 30 };
    var R = { xmin: o.xmin, xmax: o.xmax, ymin: o.ymin, ymax: o.ymax, xlog: !!o.xlog, ylog: !!o.ylog };
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "ia-svg", role: "img" });
    parent.appendChild(svg);
    var fond = el("g", {}, svg), corps = el("g", {}, svg), dessus = el("g", {}, svg);
    function tx(x) { return R.xlog ? Math.log10(x) : x; }
    function ty(y) { return R.ylog ? Math.log10(y) : y; }
    R.X = function (x) { return M.g + (tx(x) - tx(R.xmin)) / (tx(R.xmax) - tx(R.xmin)) * (W - M.g - M.d); };
    R.Y = function (y) { return H - M.b - (ty(y) - ty(R.ymin)) / (ty(R.ymax) - ty(R.ymin)) * (H - M.h - M.b); };
    R.Xinv = function (px) { var t = tx(R.xmin) + (px - M.g) / (W - M.g - M.d) * (tx(R.xmax) - tx(R.xmin)); return R.xlog ? Math.pow(10, t) : t; };
    R.svg = svg; R.corps = corps; R.dessus = dessus; R.W = W; R.H = H; R.M = M;
    function pasFixe(min, max, pas) {         // graduations imposées (pas donné dans les notes)
      var t = [];
      for (var k = Math.ceil(min / pas - 1e-9); k * pas <= max + 1e-9; k++) t.push(Math.abs(k * pas) < 1e-12 ? 0 : k * pas);
      return t;
    }
    function graduations(min, max, log, n) {
      var t = [];
      if (log) {
        for (var p = Math.floor(Math.log10(min)); p <= Math.ceil(Math.log10(max)); p++) {
          var v = Math.pow(10, p); if (v >= min * 0.999 && v <= max * 1.001) t.push(v);
        }
        return t;
      }
      var s = pasRond(max - min, n);
      for (var v2 = Math.ceil(min / s) * s; v2 <= max + 1e-9; v2 += s) t.push(Math.abs(v2) < 1e-12 ? 0 : v2);
      return t;
    }
    R.dessinerAxes = function () {
      while (fond.firstChild) fond.removeChild(fond.firstChild);
      var gx = o.sansgrad ? [] : (o.xpas && !R.xlog) ? pasFixe(R.xmin, R.xmax, o.xpas) : graduations(R.xmin, R.xmax, R.xlog, o.nx || 8),
          gy = o.sansgrad ? [] : (o.ypas && !R.ylog) ? pasFixe(R.ymin, R.ymax, o.ypas) : graduations(R.ymin, R.ymax, R.ylog, o.ny || 6);
      gx.forEach(function (v) {
        el("line", { x1: R.X(v), y1: M.h, x2: R.X(v), y2: H - M.b, "class": "ia-grille" }, fond);
        var t = el("text", { x: R.X(v), y: H - M.b + 16, "class": "ia-grad", "text-anchor": "middle" }, fond);
        t.textContent = R.xlog ? "10" + exposant(Math.round(Math.log10(v))) : fmt(v, 3);
      });
      gy.forEach(function (v) {
        el("line", { x1: M.g, y1: R.Y(v), x2: W - M.d, y2: R.Y(v), "class": "ia-grille" }, fond);
        var t = el("text", { x: M.g - 5, y: R.Y(v) + 4, "class": "ia-grad", "text-anchor": "end" }, fond);
        t.textContent = R.ylog ? "10" + exposant(Math.round(Math.log10(v))) : fmt(v, 3);
      });
      function mineures(min, max) {
        var t = [];
        for (var p = Math.floor(Math.log10(min)); p < Math.ceil(Math.log10(max)); p++)
          for (var k = 2; k <= 9; k++) { var v = k * Math.pow(10, p); if (v > min && v < max) t.push(v); }
        return t;
      }
      if (R.xlog) mineures(R.xmin, R.xmax).forEach(function (v) { el("line", { x1: R.X(v), y1: M.h, x2: R.X(v), y2: H - M.b, "class": "ia-grille ia-grille-fine" }, fond); });
      if (R.ylog) mineures(R.ymin, R.ymax).forEach(function (v) { el("line", { x1: M.g, y1: R.Y(v), x2: W - M.d, y2: R.Y(v), "class": "ia-grille ia-grille-fine" }, fond); });
      if (!R.ylog && R.ymin <= 0 && R.ymax >= 0) el("line", { x1: M.g, y1: R.Y(0), x2: W - M.d, y2: R.Y(0), "class": "ia-axe" }, fond);
      else el("line", { x1: M.g, y1: H - M.b, x2: W - M.d, y2: H - M.b, "class": "ia-axe" }, fond);
      if (!R.xlog && R.xmin <= 0 && R.xmax >= 0) el("line", { x1: R.X(0), y1: M.h, x2: R.X(0), y2: H - M.b, "class": "ia-axe" }, fond);
      else el("line", { x1: M.g, y1: M.h, x2: M.g, y2: H - M.b, "class": "ia-axe" }, fond);
      if (o.xlabel) { var a = el("text", { x: W - M.d, y: H - M.b - 6, "class": "ia-lab-axe", "text-anchor": "end" }, fond); a.textContent = o.xlabel; }
      if (o.ylabel) { var b = el("text", { x: M.g + 6, y: M.h + 10, "class": "ia-lab-axe" }, fond); b.textContent = o.ylabel; }
    };
    R.vider = function () { while (corps.firstChild) corps.removeChild(corps.firstChild); while (dessus.firstChild) dessus.removeChild(dessus.firstChild); };
    R.courbe = function (f, cls, x0, x1, parent) {
      x0 = x0 == null ? R.xmin : x0; x1 = x1 == null ? R.xmax : x1;
      var n = 500, d = "", avant = null, lo = R.ymin - (R.ymax - R.ymin) * 3, hi = R.ymax + (R.ymax - R.ymin) * 3;
      for (var i = 0; i <= n; i++) {
        var x = R.xlog ? Math.pow(10, Math.log10(x0) + (Math.log10(x1) - Math.log10(x0)) * i / n) : x0 + (x1 - x0) * i / n;
        var y = f(x);
        var ok = isFinite(y) && y > lo && y < hi && (!R.ylog || y > 0);
        if (ok && avant !== null && Math.abs(R.Y(y) - R.Y(avant)) > H * 1.5) ok = false;   // saut (asymptote)
        if (ok) { d += (avant === null ? "M" : "L") + R.X(x).toFixed(1) + " " + R.Y(y).toFixed(1); avant = y; }
        else avant = null;
      }
      return el("path", { d: d, "class": cls || "ia-courbe" }, parent || corps);
    };
    R.point = function (x, y, cls, r, parent) { return el("circle", { cx: R.X(x), cy: R.Y(y), r: r || 4, "class": cls || "ia-pt" }, parent || corps); };
    R.segment = function (x1, y1, x2, y2, cls, parent) { return el("line", { x1: R.X(x1), y1: R.Y(y1), x2: R.X(x2), y2: R.Y(y2), "class": cls || "ia-seg" }, parent || corps); };
    R.clip = function () {
      var id = "iac" + Math.random().toString(36).slice(2, 8);
      var cp = el("clipPath", { id: id }, svg);
      el("rect", { x: M.g, y: M.h, width: W - M.g - M.d, height: H - M.h - M.b }, cp);
      corps.setAttribute("clip-path", "url(#" + id + ")");
    };
    R.dessinerAxes(); R.clip();
    return R;
  }
  function exposant(n) {
    var s = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" };
    return String(n).split("").map(function (c) { return s[c] || c; }).join("");
  }
  function legende(host, cfg) { if (cfg.legende) host.appendChild(h("div", "ia-legende", cfg.legende)); }

  // ------------------------------------------------------------ suites
  // Fonction d'une suite qui dépend de paramètres (curseurs) : expression JS en x
  // et en les noms des paramètres, évaluée avec leurs valeurs courantes P.
  function fonctionP(spec, noms, P) {
    if (!spec) return null;
    if (!noms.length || !spec.js) return fonction(spec);
    var F;
    try { F = new Function(["x"].concat(noms).join(","), "return (" + spec.js + ");"); } catch (e) { return fonction(spec); }
    return function (x) {
      var y = F.apply(null, [x].concat(noms.map(function (n) { return P[n]; })));
      return typeof y === "number" ? y : NaN;
    };
  }
  // Étiquette d'un terme : "u", ["u", "0"] (indice) → éléments <tspan> du SVG.
  function etiquette(t, lab) {
    if (Array.isArray(lab)) {
      t.textContent = lab[0];
      if (lab[1] != null && lab[1] !== "") {
        var sub = el("tspan", { "baseline-shift": "sub", "font-size": "75%" }, t); sub.textContent = lab[1];
      }
    } else t.textContent = lab == null ? "" : String(lab);
    return t;
  }
  // Réponse cachée dans une figure : groupe .rep (dévoilé par reponses.js, par
  // « Tout afficher » de l'encadré, ou par le bouton de la figure).
  function groupeReponse(parent) { return el("g", { "class": "ia-rep rep" }, parent); }
  function boutonReponse(host) {
    var b = bouton("voir la réponse", function () {
      var vu = !b.classList.contains("on");
      host.querySelectorAll(".ia-rep").forEach(function (g) { g.classList.toggle("vu", vu); });
      b.classList.toggle("on", vu); b.textContent = vu ? "cacher la réponse" : "voir la réponse";
    });
    var cc = ctrl(); cc.appendChild(b); host.appendChild(cc);
    return b;
  }

  function suite(host, c) {
    var noms = c.params || [], P = {};
    (c.curseurs || []).forEach(function (k) { P[k.nom] = k.val; });
    var f = null, g = null;
    function fonctions() { f = fonctionP(c.u, noms, P); g = fonctionP(c.rec, noms, P); }
    fonctions();
    var pts = c.points || null;                  // valeurs données : [[n, u_n], …]
    if (pts) { pts = pts.slice().sort(function (p, q) { return p[0] - q[0]; }); c.n0 = c.n0 != null ? c.n0 : pts[0][0]; c.nmax = c.nmax || pts[pts.length - 1][0]; }
    var n0 = c.n0 || 0, nmax = c.nmax || 10;
    function premier() { return c.rec && P.u0 != null ? P.u0 : c.u0; }
    function terme(n) {
      if (pts) { for (var i = 0; i < pts.length; i++) if (pts[i][0] === n) return pts[i][1]; return NaN; }
      if (f) return f(n);
      var u = premier();
      for (var k = n0; k < n; k++) u = g(u);
      return u;
    }
    var vals = [];
    // termes calculés bien au-delà de la figure : le rang d'entrée dans la bande peut être grand
    var LOIN = c.limite != null ? 10000 : 60;
    function calculer() {
      vals = [];
      if (pts) { for (var n = n0; n <= nmax; n++) vals.push(terme(n)); return; }
      if (f) { for (var m = n0; m <= Math.max(nmax, n0 + LOIN); m++) vals.push(f(m)); return; }
      var u = premier();
      for (var k = n0; k <= Math.max(nmax, n0 + LOIN); k++) { vals.push(u); u = g(u); }
    }
    calculer();
    var serie2 = c.points2 || [];
    var ymin, ymax;
    function fenetre() {
      var vis = vals.slice(0, nmax - n0 + 1).filter(isFinite).concat(serie2.map(function (p) { return p[1]; }));
      if (c.zero) vis.push(0);
      var ref = c.limite != null ? c.limite : vis[0];
      ymin = c.ymin != null ? c.ymin : Math.min.apply(null, vis.concat([ref]));
      ymax = c.ymax != null ? c.ymax : Math.max.apply(null, vis.concat([ref]));
      if (ymin === ymax) { ymin -= 1; ymax += 1; }
      var marge = (ymax - ymin) * 0.08; if (c.ymin == null) ymin -= marge; if (c.ymax == null) ymax += marge;
    }
    fenetre();
    var nfin = pts ? pts[pts.length - 1][0] : nmax;       // dernier terme connu
    var fixe = !!(c.fixe || c.cache);                     // figure fixe (données à lire, réponse)
    var mode = c.mode || "points", N = (pts || fixe) ? nfin : Math.min(nmax, n0 + 5),
        eps = c.limite != null ? (c.bande != null ? c.bande : (ymax - ymin) / 8) : 0;
    var zone = h("div", "ia-zone"); host.appendChild(zone);
    var R = null, Rt = null;
    function construire() {
      zone.innerHTML = "";
      if (mode === "toile") {
        var lo = c.xmin != null ? c.xmin : Math.min(ymin, 0), hi = c.xmax != null ? c.xmax : ymax;
        Rt = Repere(zone, { xmin: lo, xmax: hi, ymin: lo, ymax: hi, w: 420, h: 420, xlabel: "x", ylabel: "y" });
        R = null;
      } else {
        R = Repere(zone, { xmin: n0 - 0.5, xmax: nmax + 0.5, ymin: ymin, ymax: ymax, xlabel: c.xlabel || "n",
          ylabel: c.ylabel || (c.nom ? c.nom + "ₙ" : "uₙ"), nx: Math.min(nmax - n0 + 1, 12),
          xpas: c.xpas, ypas: c.ypas, w: c.largeur, h: c.hauteur });
        Rt = null;
      }
      dessiner();
    }
    function dessiner() {
      if (R) {
        R.vider();
        if (c.zero && ymin < 0 && ymax > 0) R.segment(n0 - 0.5, 0, nmax + 0.5, 0, "ia-asym");
        if (c.limite != null) {
          el("rect", { x: R.X(n0 - 0.5), y: R.Y(c.limite + eps), width: R.X(nmax + 0.5) - R.X(n0 - 0.5), height: Math.max(0, R.Y(c.limite - eps) - R.Y(c.limite + eps)), "class": "ia-bande" }, R.corps);
          R.segment(n0 - 0.5, c.limite, nmax + 0.5, c.limite, "ia-asym");
        }
        var rang = null;
        if (c.limite != null) {        // rang à partir duquel tous les termes (calculés) restent dans la bande
          for (var k = vals.length - 1; k >= 0; k--) { if (!(Math.abs(vals[k] - c.limite) < eps - 1e-9 * Math.max(1, Math.abs(c.limite)))) { rang = n0 + k + 1; break; } }   // écart strictement inférieur (arrondis flottants)
          if (rang === null) rang = n0;
          if (rang > n0 + vals.length - 1) rang = Infinity;      // encore hors de la bande au dernier terme calculé
        }
        var cible = c.cache ? groupeReponse(R.corps) : R.corps;
        if (c.relie) {
          var d = "";
          for (var n1 = n0; n1 <= N; n1++) { var u1 = vals[n1 - n0]; if (isFinite(u1)) d += (d ? "L" : "M") + R.X(n1).toFixed(1) + " " + R.Y(u1).toFixed(1); }
          el("path", { d: d, "class": "ia-relie" }, cible);
        }
        for (var n = n0; n <= N; n++) {
          var u = vals[n - n0];
          if (!isFinite(u)) continue;
          if (mode === "escalier" && n < N) {
            R.segment(n, u, n + 1, u, "ia-escalier", cible); R.segment(n + 1, u, n + 1, vals[n + 1 - n0], "ia-escalier", cible);
          }
          var dedans = c.limite != null && rang !== null && n >= rang;
          R.point(n, u, dedans ? "ia-pt ia-pt-ok" : "ia-pt", fixe ? 4 : 4.5, cible);
        }
        serie2.forEach(function (p) {
          if (p[0] > N) return;
          var X = R.X(p[0]), Y = R.Y(p[1]);
          el("path", { d: "M" + (X - 4) + " " + (Y - 4) + "L" + (X + 4) + " " + (Y + 4) + "M" + (X - 4) + " " + (Y + 4) + "L" + (X + 4) + " " + (Y - 4), "class": "ia-croix" }, cible);
        });
        if (fixe) return;
        txt.innerHTML = "<b>" + (c.nom || "u") + "<sub>" + N + "</sub> = " + fmt(vals[N - n0], 4) + "</b>" +
          (c.limite != null ? " · bande de demi-largeur ε = " + fmt(eps, 4) + " autour de " + fmt(c.limite, 4) +
            (rang === Infinity ? " : les " + vals.length + " premiers termes ne restent pas tous dans la bande"
              : " : tous les termes restent dans la bande à partir du rang <b>" + rang + "</b>") : "");
      } else {
        Rt.vider();
        Rt.courbe(g, "ia-courbe");
        Rt.courbe(function (x) { return x; }, "ia-asym");
        var u2 = premier(), dd = "M" + Rt.X(u2).toFixed(1) + " " + Rt.Y(Math.max(Rt.ymin, 0)).toFixed(1);
        for (var k2 = n0; k2 < N; k2++) {
          var v = g(u2);
          dd += "L" + Rt.X(u2).toFixed(1) + " " + Rt.Y(v).toFixed(1) + "L" + Rt.X(v).toFixed(1) + " " + Rt.Y(v).toFixed(1);
          u2 = v;
        }
        el("path", { d: dd, "class": "ia-toile" }, Rt.corps);
        var u3 = premier();
        for (var k3 = n0; k3 <= N; k3++) { Rt.point(u3, 0 >= Rt.ymin && 0 <= Rt.ymax ? 0 : Rt.ymin, "ia-pt", 3.5); u3 = g(u3); }
        txt.innerHTML = "Toile : on part de " + (c.nom || "u") + "<sub>" + n0 + "</sub> sur l'axe, on monte jusqu'à la courbe de f, puis on revient sur la droite y = x pour lire le terme suivant. " +
          "<b>" + (c.nom || "u") + "<sub>" + N + "</sub> = " + fmt(vals[N - n0], 4) + "</b>";
      }
      var lignes = [];
      for (var m = n0; m <= N; m++) lignes.push("<tr><td>" + m + "</td><td>" + fmt(vals[m - n0], 5) + "</td></tr>");
      table.innerHTML = "<tr><th>n</th><th>" + (c.nom || "u") + "<sub>n</sub></th></tr>" + lignes.join("");
    }
    if (fixe) {                                     // figure fixe : ni curseur ni texte
      construire();
      if (c.cache) boutonReponse(host);
      return;
    }
    var txt = info(), table = h("table", "ia-table"), boite = h("div", "ia-tab-boite"); boite.appendChild(table); boite.hidden = true;
    var cc = ctrl();
    var cN = curseur("termes jusqu'au rang n =", n0, nfin, 1, N, function (v) { N = v; dessiner(); }, function (v) { return String(v); });
    cc.appendChild(cN);
    var cEps = null;
    if (c.limite != null) cc.appendChild(cEps = curseur("ε =", (ymax - ymin) / 200, (ymax - ymin) / 3, (ymax - ymin) / 400, eps, function (v) { eps = v; dessiner(); }, function (v) { return fmt(v, 3); }));
    var cp = null;
    if (c.curseurs && c.curseurs.length) {          // paramètres de la suite (raison, premier terme…)
      cp = ctrl();
      c.curseurs.forEach(function (k) {
        cp.appendChild(curseur((k.etiquette || k.nom) + " =", k.min, k.max, k.pas, k.val, function (v) {
          P[k.nom] = v; fonctions(); calculer();
          if (c.ymin == null || c.ymax == null) { fenetre(); construire(); } else dessiner();
        }));
      });
    }
    var modes = ctrl();
    [["points", "points"], ["escalier", "escalier"]].concat(g ? [["toile", "toile (récurrence)"]] : []).forEach(function (m) {
      var b = bouton(m[1], function () {
        mode = m[0]; if (cEps) cEps.hidden = mode === "toile";
        construire(); [].forEach.call(modes.children, function (x) { x.classList.toggle("on", x === b); });
      });
      if (m[0] === mode) b.classList.add("on");
      modes.appendChild(b);
    });
    modes.appendChild(bouton("tableau de valeurs", function () { boite.hidden = !boite.hidden; }));
    host.appendChild(cc); if (cp) host.appendChild(cp); host.appendChild(modes); host.appendChild(txt); host.appendChild(boite);
    construire(); cN.maj();
    if (cp) [].forEach.call(cp.children, function (x) { x.maj(); });
  }

  // ------------------------------------------------------------ droite graduée
  // c = { min, max, pas, valeurs: [[v, étiquette], …], cache: bool }
  function droite(host, c) {
    var W = c.largeur || 560, H = 92, G = 26, D = 34, Y0 = 58;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "ia-svg ia-droite", role: "img" });
    host.appendChild(svg);
    function X(v) { return G + (v - c.min) / (c.max - c.min) * (W - G - D); }
    el("line", { x1: G - 10, y1: Y0, x2: W - 8, y2: Y0, "class": "ia-axe" }, svg);
    el("path", { d: "M" + (W - 8) + " " + Y0 + "l-8 -4v8z", "class": "ia-fleche" }, svg);
    for (var k = 0; c.min + k * c.pas <= c.max + 1e-9; k++) {
      var v = c.min + k * c.pas;
      el("line", { x1: X(v), y1: Y0 - 5, x2: X(v), y2: Y0 + 5, "class": "ia-axe" }, svg);
      var t = el("text", { x: X(v), y: Y0 + 20, "class": "ia-grad", "text-anchor": "middle" }, svg); t.textContent = fmt(v, 4);
    }
    var cible = c.cache ? groupeReponse(svg) : svg;
    // étiquettes trop proches : on les décale en hauteur (alternance)
    var vs = (c.valeurs || []).slice().sort(function (a, b) { return a[0] - b[0]; }), dernier = -1e9, haut = 0;
    vs.forEach(function (p) {
      var x = X(p[0]);
      haut = (x - dernier < 22) ? 1 - haut : 0; dernier = x;
      el("circle", { cx: x, cy: Y0, r: 4.5, "class": "ia-pt" }, cible);
      etiquette(el("text", { x: x, y: Y0 - 12 - 16 * haut, "class": "ia-etiq", "text-anchor": "middle" }, cible), p[1]);
    });
    if (c.cache) boutonReponse(host);
  }

  // ------------------------------------------------------------ axe des rangs
  // c = { rangs: [3, 4, …], reperes: [[rang, étiquette, toujours], …], vertical: bool }
  function rangs(host, c) {
    var r = c.rangs, mn = Math.min.apply(null, r), mx = Math.max.apply(null, r), pas = 64, V = !!c.vertical;
    var L = (mx - mn) * pas + 90, W = V ? 200 : L + 40, H = V ? L + 30 : 96;
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, "class": "ia-svg ia-rangs", role: "img" });
    svg.style.maxWidth = W + "px";
    host.appendChild(svg);
    function P(k) { var d = (k - mn) * pas + 40; return V ? [70, H - 20 - d] : [20 + d, 62]; }
    var a = P(mn - 0.5), b = P(mx + 0.9);
    el("line", { x1: a[0], y1: a[1], x2: b[0], y2: b[1], "class": "ia-axe" }, svg);
    var t0 = el("text", V ? { x: b[0], y: b[1] - 8, "class": "ia-lab-axe", "text-anchor": "middle" } : { x: b[0] + 6, y: b[1] + 4, "class": "ia-lab-axe" }, svg);
    t0.textContent = V ? "rang" : "n";
    r.forEach(function (k) {
      var p = P(k);
      el("line", V ? { x1: p[0] - 5, y1: p[1], x2: p[0] + 5, y2: p[1], "class": "ia-axe" } : { x1: p[0], y1: p[1] - 5, x2: p[0], y2: p[1] + 5, "class": "ia-axe" }, svg);
      var t = el("text", V ? { x: p[0] - 12, y: p[1] + 4, "class": "ia-grad", "text-anchor": "end" } : { x: p[0], y: p[1] + 20, "class": "ia-grad", "text-anchor": "middle" }, svg);
      t.textContent = String(k);
    });
    var rep = null;
    (c.reperes || []).forEach(function (q) {
      var p = P(q[0]), cible = svg;
      if (!q[2]) { if (!rep) rep = groupeReponse(svg); cible = rep; }
      el("circle", { cx: p[0], cy: p[1], r: 4.5, "class": q[2] ? "ia-pt ia-pt-donne" : "ia-pt" }, cible);
      etiquette(el("text", V ? { x: p[0] + 14, y: p[1] + 5, "class": "ia-etiq" } : { x: p[0], y: p[1] - 14, "class": "ia-etiq", "text-anchor": "middle" }, cible), q[1]);
    });
    if (rep) boutonReponse(host);
  }

  // ------------------------------------------------------------ tangente
  function tangente(host, c) {
    var f = fonction(c.f), a = c.a != null ? c.a : (c.xmin + c.xmax) / 2, hh = 1, voirSec = !!c.secante, voirDer = false;
    var R = Repere(host, { xmin: c.xmin, xmax: c.xmax, ymin: c.ymin, ymax: c.ymax, xlabel: "x", ylabel: "y" });
    function der(x) { var e = 1e-5; return (f(x + e) - f(x - e)) / (2 * e); }
    var trace = [];
    function dessiner() {
      R.vider();
      R.courbe(f, "ia-courbe");
      if (voirDer) {
        R.courbe(der, "ia-courbe2");
      }
      var ya = f(a), m = der(a);
      if (isFinite(ya) && isFinite(m)) {
        R.courbe(function (x) { return ya + m * (x - a); }, "ia-tangente");
        if (voirSec) {
          var yb = f(a + hh), ms = (yb - ya) / hh;
          R.courbe(function (x) { return ya + ms * (x - a); }, "ia-secante");
          R.point(a + hh, yb, "ia-pt ia-pt2", 4.5);
        }
        if (voirDer) R.point(a, m, "ia-pt ia-pt2", 4.5);
        R.point(a, ya, "ia-pt", 5.5);
      }
      txt.innerHTML = "a = " + fmt(a, 3) + " · f(a) = " + fmt(ya, 4) + " · <b>pente de la tangente f′(a) ≈ " + fmt(m, 4) + "</b>" +
        (voirSec ? " · pente de la sécante (f(a+h) − f(a))/h = " + fmt((f(a + hh) - ya) / hh, 4) : "");
    }
    var txt = info(), cc = ctrl();
    var ca = curseur("a =", c.xmin, c.xmax, pasRond(c.xmax - c.xmin, 6) / 100, a, function (v) { a = v; dessiner(); });
    var ch = curseur("h =", -2, 2, 0.01, hh, function (v) { hh = Math.abs(v) < 1e-3 ? 1e-3 : v; dessiner(); });
    ch.hidden = !voirSec;
    cc.appendChild(ca); cc.appendChild(ch);
    var bs = ctrl();
    bs.appendChild(bouton("sécante", function () { voirSec = !voirSec; ch.hidden = !voirSec; this.classList.toggle("on", voirSec); dessiner(); }));
    bs.appendChild(bouton("graphe de f′", function () { voirDer = !voirDer; this.classList.toggle("on", voirDer); dessiner(); }));
    if (voirSec) bs.firstChild.classList.add("on");
    host.appendChild(cc); host.appendChild(bs); host.appendChild(txt);
    ca.maj(); ch.maj();
  }

  // ------------------------------------------------------------ cercle trigonométrique
  function trigo(host, c) {
    var fn = c.fonction || "sin", t = c.angle != null ? c.angle : Math.PI / 3;
    var zone = h("div", "ia-trigo"); host.appendChild(zone);
    var C = Repere(zone, { xmin: -1.3, xmax: 1.3, ymin: -1.3, ymax: 1.3, w: 300, h: 300, nx: 4, ny: 4 });
    var G = Repere(zone, { xmin: 0, xmax: 2 * Math.PI, ymin: -1.3, ymax: 1.3, w: 460, h: 300, xlabel: "θ", nx: 8, ny: 4 });
    var sinf = Math.sin, cosf = Math.cos;
    function dessiner() {
      C.vider(); G.vider();
      el("circle", { cx: C.X(0), cy: C.Y(0), r: C.X(1) - C.X(0), "class": "ia-courbe ia-cercle" }, C.corps);
      var x = cosf(t), y = sinf(t);
      el("path", { d: "M" + C.X(0) + " " + C.Y(0) + "L" + C.X(0.3) + " " + C.Y(0) + "A" + (C.X(0.3) - C.X(0)) + " " + (C.X(0.3) - C.X(0)) + " 0 " + (t % (2 * Math.PI) > Math.PI ? 1 : 0) + " 0 " + C.X(0.3 * x) + " " + C.Y(0.3 * y), "class": "ia-angle" }, C.corps);
      C.segment(0, 0, x, y, "ia-seg");
      if (fn !== "cos") C.segment(x, 0, x, y, "ia-sin");
      if (fn !== "sin") C.segment(0, 0, x, 0, "ia-cos");
      C.point(x, y, "ia-pt", 5);
      if (fn !== "cos") { G.courbe(sinf, "ia-fantome"); G.courbe(sinf, "ia-sin-c", 0, t); G.segment(t, 0, t, sinf(t), "ia-sin"); G.point(t, sinf(t), "ia-pt", 4.5); }
      if (fn !== "sin") { G.courbe(cosf, "ia-fantome"); G.courbe(cosf, "ia-cos-c", 0, t); G.segment(t, 0, t, cosf(t), "ia-cos"); G.point(t, cosf(t), "ia-pt ia-pt2", 4.5); }
      var deg = t * 180 / Math.PI;
      txt.innerHTML = "θ = " + fmt(deg, 1) + "° = " + fmt(t / Math.PI, 3) + " π rad" +
        (fn !== "cos" ? " · <span class='ia-sin-t'>sin θ = " + fmt(y, 4) + "</span>" : "") +
        (fn !== "sin" ? " · <span class='ia-cos-t'>cos θ = " + fmt(x, 4) + "</span>" : "");
    }
    var txt = info(), cc = ctrl();
    var ct = curseur("θ =", 0, 2 * Math.PI, Math.PI / 180, t, function (v) { t = v; dessiner(); }, function (v) { return fmt(v * 180 / Math.PI, 0) + "°"; });
    cc.appendChild(ct);
    var bs = ctrl();
    [["sin", "sinus"], ["cos", "cosinus"], ["les-deux", "les deux"]].forEach(function (m) {
      var b = bouton(m[1], function () { fn = m[0]; [].forEach.call(bs.children, function (x) { x.classList.toggle("on", x === b); }); dessiner(); });
      if (m[0] === fn) b.classList.add("on");
      bs.appendChild(b);
    });
    host.appendChild(cc); host.appendChild(bs); host.appendChild(txt);
    ct.maj();
  }

  // ------------------------------------------------------------ repère log
  function replog(host, c) {
    var fs = (c.fonctions || []).map(fonction), ech = c.echelle || "semilog", zone = h("div", "ia-zone");
    host.appendChild(zone);
    function construire() {
      zone.innerHTML = "";
      var ylog = ech === "semilog" || ech === "loglog", xlog = ech === "loglog";
      var ymin = ylog ? c.ymin : Math.min(0, c.ymin), xmin = c.xmin;
      var R = Repere(zone, { xmin: xmin, xmax: c.xmax, ymin: ymin, ymax: c.ymax, xlog: xlog, ylog: ylog, xlabel: c.xlabel || "x", ylabel: c.ylabel || "y" });
      fs.forEach(function (f, k) { if (f) R.courbe(f, k ? "ia-courbe2" : "ia-courbe"); });
      (c.points || []).forEach(function (p) { if (!ylog || p[1] > 0) R.point(p[0], p[1], "ia-pt", 4); });
      txt.textContent = ech === "lineaire" ? "Échelle linéaire sur les deux axes." :
        ech === "semilog" ? "Échelle logarithmique en ordonnée : chaque graduation vaut 10 fois la précédente. Une exponentielle y devient une droite." :
          "Échelle logarithmique sur les deux axes : une fonction puissance y devient une droite.";
    }
    var txt = info(), bs = ctrl();
    [["lineaire", "linéaire"], ["semilog", "semi-log"], ["loglog", "log-log"]].forEach(function (m) {
      if (m[0] === "loglog" && c.xmin <= 0) return;
      var b = bouton(m[1], function () { ech = m[0]; [].forEach.call(bs.children, function (x) { x.classList.toggle("on", x === b); }); construire(); });
      if (m[0] === ech) b.classList.add("on");
      bs.appendChild(b);
    });
    host.appendChild(bs); host.appendChild(txt);
    construire();
  }

  // ------------------------------------------------------------ sommes de Riemann
  function riemann(host, c) {
    var f = fonction(c.f), n = c.n || 4, meth = c.methode || "gauche";
    var R = Repere(host, { xmin: c.xmin, xmax: c.xmax, ymin: c.ymin, ymax: c.ymax, xlabel: "x", ylabel: "y" });
    function integrale() {                    // Simpson, 2000 sous-intervalles
      var N = 2000, s = 0, dx = (c.b - c.a) / N;
      for (var i = 0; i <= N; i++) s += (i === 0 || i === N ? 1 : i % 2 ? 4 : 2) * f(c.a + i * dx);
      return s * dx / 3;
    }
    var I = integrale();
    function dessiner() {
      R.vider();
      var dx = (c.b - c.a) / n, S = 0;
      for (var i = 0; i < n; i++) {
        var x0 = c.a + i * dx, x1 = x0 + dx, y;
        if (meth === "trapezes") {
          var y0 = f(x0), y1 = f(x1); S += (y0 + y1) / 2 * dx;
          el("path", { d: "M" + R.X(x0) + " " + R.Y(0) + "L" + R.X(x0) + " " + R.Y(y0) + "L" + R.X(x1) + " " + R.Y(y1) + "L" + R.X(x1) + " " + R.Y(0) + "Z", "class": y0 + y1 >= 0 ? "ia-rect" : "ia-rect ia-neg" }, R.corps);
          continue;
        }
        y = f(meth === "gauche" ? x0 : meth === "droite" ? x1 : (x0 + x1) / 2);
        S += y * dx;
        el("rect", { x: R.X(x0), y: Math.min(R.Y(y), R.Y(0)), width: R.X(x1) - R.X(x0), height: Math.abs(R.Y(y) - R.Y(0)), "class": y >= 0 ? "ia-rect" : "ia-rect ia-neg" }, R.corps);
      }
      R.courbe(f, "ia-courbe");
      txt.innerHTML = "n = " + n + " · somme des aires = <b>" + fmt(S, 5) + "</b> · intégrale ≈ " + fmt(I, 5) + " · écart = " + fmt(S - I, 5);
    }
    var txt = info(), cc = ctrl();
    var cn = curseur("n =", 1, c.nmax || 100, 1, n, function (v) { n = v; dessiner(); }, function (v) { return String(v); });
    cc.appendChild(cn);
    var bs = ctrl();
    [["gauche", "à gauche"], ["droite", "à droite"], ["milieu", "au milieu"], ["trapezes", "trapèzes"]].forEach(function (m) {
      var b = bouton(m[1], function () { meth = m[0]; [].forEach.call(bs.children, function (x) { x.classList.toggle("on", x === b); }); dessiner(); });
      if (m[0] === meth) b.classList.add("on");
      bs.appendChild(b);
    });
    host.appendChild(cc); host.appendChild(bs); host.appendChild(txt);
    cn.maj();
  }

  // ------------------------------------------------------------ probabilités
  function comb(n, k) { var r = 1; for (var i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }
  function binomiale(host, c) {
    var n = c.n || 10, p = c.p != null ? c.p : 0.5, k = c.k != null ? c.k : Math.round(n * p), cumul = !!c.cumul;
    var zone = h("div", "ia-zone"); host.appendChild(zone);
    function dessiner() {
      zone.innerHTML = "";
      var P = []; for (var j = 0; j <= n; j++) P.push(comb(n, j) * Math.pow(p, j) * Math.pow(1 - p, n - j));
      var R = Repere(zone, { xmin: -0.7, xmax: n + 0.7, ymin: 0, ymax: Math.max.apply(null, P) * 1.12 || 1, xlabel: "k", ylabel: "P(X = k)", nx: Math.min(n + 1, 12) });
      var larg = Math.max(2, (R.X(1) - R.X(0)) * 0.7), tot = 0;
      for (var i = 0; i <= n; i++) {
        var sel = cumul ? i <= k : i === k;
        if (sel) tot += P[i];
        el("rect", { x: R.X(i) - larg / 2, y: R.Y(P[i]), width: larg, height: R.Y(0) - R.Y(P[i]), "class": sel ? "ia-barre ia-sel" : "ia-barre" }, R.corps);
      }
      R.segment(n * p, 0, n * p, R.ymax, "ia-asym");
      txt.innerHTML = "X ~ B(" + n + " ; " + fmt(p, 3) + ") · espérance E(X) = np = " + fmt(n * p, 3) + " · écart type = " + fmt(Math.sqrt(n * p * (1 - p)), 3) +
        " · <b>P(X " + (cumul ? "≤" : "=") + " " + k + ") = " + fmt(tot, 4) + "</b>";
    }
    var txt = info(), cc = ctrl();
    var ck;
    var cn = curseur("n =", 1, c.nmax || 50, 1, n, function (v) { n = v; ck.input.max = n; if (k > n) { k = n; ck.input.value = n; } dessiner(); }, function (v) { return String(v); });
    var cp = curseur("p =", 0, 1, 0.01, p, function (v) { p = v; dessiner(); }, function (v) { return fmt(v, 2); });
    ck = curseur("k =", 0, n, 1, k, function (v) { k = v; dessiner(); }, function (v) { return String(v); });
    [cn, cp, ck].forEach(function (x) { cc.appendChild(x); });
    var bs = ctrl();
    var b1 = bouton("P(X = k)", function () { cumul = false; b1.classList.add("on"); b2.classList.remove("on"); dessiner(); });
    var b2 = bouton("P(X ≤ k)", function () { cumul = true; b2.classList.add("on"); b1.classList.remove("on"); dessiner(); });
    (cumul ? b2 : b1).classList.add("on");
    bs.appendChild(b1); bs.appendChild(b2);
    host.appendChild(cc); host.appendChild(bs); host.appendChild(txt);
    cn.maj(); cp.maj(); ck.maj();
  }
  function erf(x) {                      // Abramowitz-Stegun 7.1.26 (erreur < 1,5·10⁻⁷)
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function normale(host, c) {
    var mu = c.mu || 0, sg = c.sigma || 1, a = c.a != null ? c.a : mu - sg, b = c.b != null ? c.b : mu + sg;
    var X0 = c.xmin != null ? c.xmin : mu - 4 * sg, X1 = c.xmax != null ? c.xmax : mu + 4 * sg;
    var zone = h("div", "ia-zone"); host.appendChild(zone);
    function dens(x) { return Math.exp(-0.5 * Math.pow((x - mu) / sg, 2)) / (sg * Math.sqrt(2 * Math.PI)); }
    function Phi(x) { return 0.5 * (1 + erf((x - mu) / (sg * Math.SQRT2))); }
    function dessiner() {
      zone.innerHTML = "";
      var R = Repere(zone, { xmin: X0, xmax: X1, ymin: 0, ymax: (c.ymax || 1.15 / (sg * Math.sqrt(2 * Math.PI))), xlabel: "x", ylabel: "densité" });
      var lo = Math.min(a, b), hi = Math.max(a, b), d = "M" + R.X(lo) + " " + R.Y(0);
      for (var i = 0; i <= 200; i++) { var x = lo + (hi - lo) * i / 200; d += "L" + R.X(x).toFixed(1) + " " + R.Y(dens(x)).toFixed(1); }
      d += "L" + R.X(hi) + " " + R.Y(0) + "Z";
      el("path", { d: d, "class": "ia-aire" }, R.corps);
      R.courbe(dens, "ia-courbe");
      R.segment(mu, 0, mu, dens(mu), "ia-asym");
      txt.innerHTML = "X ~ N(" + fmt(mu, 3) + " ; " + fmt(sg, 3) + "²) · <b>P(" + fmt(lo, 3) + " ≤ X ≤ " + fmt(hi, 3) + ") ≈ " + fmt(Phi(hi) - Phi(lo), 4) + "</b>";
    }
    var txt = info(), cc = ctrl(), pas = pasRond(X1 - X0, 6) / 100;
    cc.appendChild(curseur("μ =", c.mumin != null ? c.mumin : X0, c.mumax != null ? c.mumax : X1, pas, mu, function (v) { mu = v; dessiner(); }));
    cc.appendChild(curseur("σ =", sg / 5, sg * 3, sg / 50, sg, function (v) { sg = v; dessiner(); }));
    cc.appendChild(curseur("a =", X0, X1, pas, a, function (v) { a = v; dessiner(); }));
    cc.appendChild(curseur("b =", X0, X1, pas, b, function (v) { b = v; dessiner(); }));
    host.appendChild(cc); host.appendChild(txt);
    [].forEach.call(cc.children, function (x) { x.maj(); });
  }

  // ------------------------------------------------------------ démarrage

  // ------------------------------------------------------------ graphe (module « reperes »)
  // Repère et courbes d'une bibliothèque de cours (repere, faisceau, nuage,
  // repere-semilog, repere-loglog) : couleurs du cours, réponses cachées,
  // lecture des coordonnées au survol, bascule d'échelle pour les repères log.
  var PALETTE = ["#1d6fb8", "#c1002a", "#0a7d4d", "#8a5a00", "#6d3bbf"];
  function graphe(host, c) {
    var traces = (c.courbes || []).map(function (t, k) {
      var coul = t.couleur || PALETTE[k % PALETTE.length];
      return { t: t, f: t.f ? fonction(t.f) : null, coul: coul };
    });
    var aRep = (c.points || []).some(function (p) { return p.rep; }) || traces.some(function (x) { return x.t.rep; });
    var ech = c.xlog ? "loglog" : c.ylog ? "semilog" : "lineaire", zone = h("div", "ia-zone"), txt = info();
    host.appendChild(zone);
    var vu = false;
    function construire() {
      zone.innerHTML = "";
      var ylog = ech !== "lineaire", xlog = ech === "loglog";
      var R = Repere(zone, { xmin: c.xmin, xmax: c.xmax, ymin: ylog ? c.ymin : Math.min(0, c.ymin), ymax: c.ymax,
        xlog: xlog, ylog: ylog, xpas: c.xpas, ypas: ylog ? null : (c.ylog ? null : c.ypas), sansgrad: c.sansgrad,
        xlabel: c.xlabel, ylabel: c.ylabel, w: c.w, h: c.h });
      var gRep = groupeReponse(R.corps); if (vu) gRep.classList.add("vu");
      traces.forEach(function (x) {
        var parent = x.t.rep ? gRep : R.corps, e;
        if (x.t.segment) e = R.segment(x.t.segment[0][0], x.t.segment[0][1], x.t.segment[1][0], x.t.segment[1][1], "ia-trace", parent);
        else if (x.f) e = R.courbe(x.f, "ia-trace", x.t.de, x.t.a, parent);
        if (!e) return;
        e.style.stroke = x.coul;
        e.style.strokeWidth = (1.35 * (x.t.ep || 1.3)).toFixed(2);
        if (x.t.pointille) e.style.strokeDasharray = "6 4";
      });
      (c.points || []).forEach(function (p) {
        if (ylog && p.y <= 0) return;
        var parent = p.rep ? gRep : R.dessus;
        if (p.croix) {
          var X = R.X(p.x), Y = R.Y(p.y);
          el("path", { d: "M" + (X - 4) + " " + (Y - 4) + "l8 8m0 -8l-8 8", "class": "ia-croix" }, parent);
        } else {
          R.point(p.x, p.y, p.rep ? "ia-pt" : "ia-pt ia-pt-donne", 4, parent);
        }
        if (p.etiquette) { var t = el("text", { x: R.X(p.x) + 7, y: R.Y(p.y) - 7, "class": "ia-etiq" }, parent); t.textContent = p.etiquette; }
      });
      if (c.lecture) lecture(R);
    }
    function lecture(R) {
      var lignes = traces.filter(function (x) { return x.f && !x.t.rep && !x.t.segment; });
      if (!lignes.length) return;
      var g = el("g", { "class": "ia-lecture" }, R.svg), v = el("line", { y1: R.M.h, y2: R.H - R.M.b }, g);
      var pts = lignes.map(function (x) { var p = el("circle", { r: 4 }, g); p.style.fill = x.coul; return p; });
      g.style.display = "none";
      function bouge(ev) {
        var r = R.svg.getBoundingClientRect(), px = (ev.clientX - r.left) * R.W / r.width;
        if (px < R.M.g || px > R.W - R.M.d) { g.style.display = "none"; return; }
        var x = R.Xinv(px), morceaux = ["x = " + fmt(x, 2)];
        g.style.display = "";
        v.setAttribute("x1", px); v.setAttribute("x2", px);
        lignes.forEach(function (l, k) {
          var y = (l.t.de != null && (x < l.t.de || x > l.t.a)) ? NaN : l.f(x), ok = isFinite(y) && y >= R.ymin && y <= R.ymax && (!R.ylog || y > 0);
          pts[k].style.display = ok ? "" : "none";
          if (ok) { pts[k].setAttribute("cx", px); pts[k].setAttribute("cy", R.Y(y)); }
          if (isFinite(y)) morceaux.push('<span style="color:' + l.coul + '">y = ' + fmt(y, 3) + "</span>");
        });
        txt.innerHTML = morceaux.join(" · ");
      }
      R.svg.addEventListener("pointermove", bouge);
      R.svg.addEventListener("pointerdown", bouge);
      R.svg.addEventListener("pointerleave", function () { g.style.display = "none"; });
    }
    if (c.echelles) {
      var bs = ctrl();
      [["lineaire", "échelle linéaire"], ["semilog", "semi-log"], ["loglog", "log-log"]].forEach(function (m) {
        if (m[0] === "loglog" && !(c.xmin > 0)) return;
        var b = bouton(m[1], function () { ech = m[0]; [].forEach.call(bs.children, function (x) { x.classList.toggle("on", x === b); }); construire(); });
        if (m[0] === ech) b.classList.add("on");
        bs.appendChild(b);
      });
      host.appendChild(bs);
    }
    if (aRep) {
      var b = boutonReponse(host);
      b.addEventListener("click", function () { vu = b.classList.contains("on"); });
    }
    if (c.lecture) { txt.textContent = "Survole le graphique pour lire les coordonnées."; host.appendChild(txt); }
    construire();
  }

  // ------------------------------------------------------------ fonction à paramètres (curseurs)
  function fcurseurs(host, c) {
    var P = {}, noms = c.params || [], f;
    (c.curseurs || []).forEach(function (k) { P[k.nom] = k.val; });
    var fixes = (c.fixes || []).map(fonction);
    var R = Repere(host, { xmin: c.xmin, xmax: c.xmax, ymin: c.ymin, ymax: c.ymax, xlabel: c.xlabel || "x", ylabel: c.ylabel || "y" });
    var txt = info();
    function dessiner() {
      R.vider();
      fixes.forEach(function (g) { if (g) R.courbe(g, "ia-courbe2 ia-tirets"); });
      f = fonctionP(c.f, noms, P);
      if (c.points) {
        var pas = P[c.points], n = 0;
        if (pas > 0) for (var x = Math.ceil(c.xmin / pas - 1e-9) * pas; x <= c.xmax + 1e-9 && n < 2000; x += pas, n++) {
          var y = f(x); if (isFinite(y) && y >= c.ymin && y <= c.ymax) R.point(x, y, "ia-pt", n > 200 ? 2 : 3.5);
        }
        txt.textContent = n + " points";
      } else {
        R.courbe(f, "ia-courbe");
        txt.textContent = "";
      }
    }
    var cc = ctrl();
    (c.curseurs || []).forEach(function (k) {
      cc.appendChild(curseur(k.etiquette + " =", k.min, k.max, k.pas, k.val, function (v) { P[k.nom] = v; dessiner(); }));
    });
    host.appendChild(cc); host.appendChild(txt);
    [].forEach.call(cc.children, function (w) { w.maj(); });
    dessiner();
  }
  var WIDGETS = { curseurs: fcurseurs, graphe: graphe, suite: suite, droite: droite, rangs: rangs, tangente: tangente, trigo: trigo, log: replog, riemann: riemann, binomiale: binomiale, normale: normale };
  function construire(host) {
    if (host.dataset.wired) return;
    host.dataset.wired = "1";
    var cfg = {};
    try { cfg = JSON.parse(host.dataset.cfg || "{}"); } catch (e) { host.textContent = "Figure : réglages illisibles."; return; }
    var w = WIDGETS[host.dataset.ia];
    if (!w) { host.textContent = "Figure inconnue : " + host.dataset.ia; return; }
    try { w(host, cfg); legende(host, cfg); } catch (e) { host.textContent = "Figure non disponible (" + e.message + ")."; }
  }
  function setup() { document.querySelectorAll(".ia").forEach(construire); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup); else setup();
  window.TypwebInteractif = { setup: setup };
})();
