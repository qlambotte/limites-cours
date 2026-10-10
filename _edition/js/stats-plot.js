/* ============================================================
   stats-plot.js — figures interactives pour la statistique à
   deux variables. Aucune dépendance : SVG + variables CSS
   (clair/sombre). Réutilise les styles .sp-canvas / .sp-ctrl.

   Usage (bloc HTML brut dans un .qmd) :
     <div class="stat-plot"
          data-mode="nuage|regression|moindres|correlation"
          data-points="[[5.1,54.1],[7.8,71.7], …]"
          data-xlabel="PIB/hab." data-ylabel="Espérance"
          data-caption="…"></div>
   - nuage       : points + point moyen G.
   - regression  : points + G + droite des moindres carrés (+ r).
   - moindres    : curseur de pente (pivot en G), résidus et somme
                   des carrés en direct, bouton « meilleure droite ».
   - correlation : curseur de dispersion, r recalculé en direct.
   ============================================================ */
(function () {
  "use strict";

  function css(el, v) { return getComputedStyle(el).getPropertyValue(v).trim(); }
  function fmt(x, d) {
    if (!isFinite(x)) return "∞";
    d = (d == null) ? 2 : d;
    var m = Math.pow(10, d), r = Math.round(x * m) / m;
    return String(r).replace(".", ",");
  }
  function mean(a) { var s = 0, i; for (i = 0; i < a.length; i++) s += a[i]; return s / a.length; }

  function stats(pts) {
    var xs = [], ys = [], i;
    for (i = 0; i < pts.length; i++) { xs.push(pts[i][0]); ys.push(pts[i][1]); }
    var mx = mean(xs), my = mean(ys), Sxx = 0, Sxy = 0, Syy = 0;
    for (i = 0; i < pts.length; i++) {
      var dx = xs[i] - mx, dy = ys[i] - my;
      Sxx += dx * dx; Sxy += dx * dy; Syy += dy * dy;
    }
    var a = Sxx ? Sxy / Sxx : 0, b = my - a * mx;
    var r = (Sxx && Syy) ? Sxy / Math.sqrt(Sxx * Syy) : 0;
    return { xs: xs, ys: ys, mx: mx, my: my, Sxx: Sxx, Sxy: Sxy, Syy: Syy, a: a, b: b, r: r, n: pts.length };
  }

  function bounds(vals, forceZero, pad) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (forceZero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (hi === lo) hi = lo + 1;
    var p = (hi - lo) * (pad == null ? 0.1 : pad);
    return [lo - p, hi + p];
  }

  function sse(st, a, b) {
    var s = 0, i;
    for (i = 0; i < st.n; i++) { var e = st.ys[i] - (a * st.xs[i] + b); s += e * e; }
    return s;
  }

  function draw(host, plot, st, o) {
    var xb = o.xb, yb = o.yb;
    var W = 480, H = 320, ml = 52, mr = 16, mt = 16, mb = 34;
    var iw = W - ml - mr, ih = H - mt - mb;
    function X(x) { return ml + ((x - xb[0]) / (xb[1] - xb[0])) * iw; }
    function Y(y) { return mt + ih - ((y - yb[0]) / (yb[1] - yb[0])) * ih; }

    var axis = css(host, "--muted") || "#5a6b7b";
    var rule = css(host, "--rule") || "#e5e9ef";
    var acc  = css(host, "--accent") || "#1f5fbf";
    var prop = css(host, "--prop-accent") || "#c1002a";
    var txt  = css(host, "--text") || "#24313d";

    var dx = Math.abs(xb[1] - xb[0]), dy = Math.abs(yb[1] - yb[0]);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" preserveAspectRatio="xMidYMid meet">';
    var i;
    for (i = 0; i <= 5; i++) {
      var xv = xb[0] + (i / 5) * (xb[1] - xb[0]);
      s += '<line x1="' + X(xv) + '" y1="' + mt + '" x2="' + X(xv) + '" y2="' + (mt + ih) + '" stroke="' + rule + '" stroke-width="1"/>';
      s += '<text x="' + X(xv) + '" y="' + (mt + ih + 18) + '" fill="' + axis + '" font-size="11" text-anchor="middle">' + fmt(xv, dx >= 20 ? 0 : 1) + '</text>';
    }
    for (i = 0; i <= 5; i++) {
      var yv = yb[0] + (i / 5) * (yb[1] - yb[0]);
      s += '<line x1="' + ml + '" y1="' + Y(yv) + '" x2="' + (ml + iw) + '" y2="' + Y(yv) + '" stroke="' + rule + '" stroke-width="1"/>';
      s += '<text x="' + (ml - 6) + '" y="' + (Y(yv) + 4) + '" fill="' + axis + '" font-size="10" text-anchor="end">' + fmt(yv, dy >= 20 ? 0 : 1) + '</text>';
    }
    s += '<line x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (mt + ih) + '" stroke="' + axis + '" stroke-width="1.4"/>';
    s += '<line x1="' + ml + '" y1="' + (mt + ih) + '" x2="' + (ml + iw) + '" y2="' + (mt + ih) + '" stroke="' + axis + '" stroke-width="1.4"/>';
    if (o.xlabel) s += '<text x="' + (ml + iw) + '" y="' + (mt + ih + 30) + '" fill="' + axis + '" font-size="12" text-anchor="end">' + o.xlabel + '</text>';
    if (o.ylabel) s += '<text x="' + (ml - 44) + '" y="' + (mt - 5) + '" fill="' + axis + '" font-size="12" text-anchor="start">' + o.ylabel + '</text>';

    if (o.line) {
      var a = o.line.a, b = o.line.b;
      var xa = xb[0], xz = xb[1];
      s += '<line x1="' + X(xa) + '" y1="' + Y(a * xa + b) + '" x2="' + X(xz) + '" y2="' + Y(a * xz + b) + '" stroke="' + acc + '" stroke-width="2"/>';
      if (o.showResid) {
        for (i = 0; i < st.n; i++) {
          var qy = a * st.xs[i] + b;
          s += '<line x1="' + X(st.xs[i]) + '" y1="' + Y(st.ys[i]) + '" x2="' + X(st.xs[i]) + '" y2="' + Y(qy) + '" stroke="' + prop + '" stroke-width="1.3" stroke-dasharray="3,2"/>';
        }
      }
    }
    for (i = 0; i < st.n; i++) {
      s += '<circle cx="' + X(st.xs[i]) + '" cy="' + Y(st.ys[i]) + '" r="4" fill="' + txt + '"/>';
    }
    if (o.showG) {
      s += '<circle cx="' + X(st.mx) + '" cy="' + Y(st.my) + '" r="5.5" fill="none" stroke="' + prop + '" stroke-width="2"/>';
      s += '<text x="' + (X(st.mx) + 8) + '" y="' + (Y(st.my) - 6) + '" fill="' + prop + '" font-size="13" font-weight="700">G</text>';
    }
    s += '</svg>';
    plot.innerHTML = s;
  }

  // ---- construction d'un hôte -------------------------------
  function build(host) {
    if (host.dataset.wired) return;
    host.dataset.wired = "1";
    var mode = host.dataset.mode || "nuage";
    var xlabel = host.dataset.xlabel || "x", ylabel = host.dataset.ylabel || "y";

    var basePts = [];
    try { basePts = JSON.parse(host.dataset.points || "[]"); } catch (e) { basePts = []; }

    // corrélation : on fabrique un nuage dont la dispersion est pilotée
    // par un curseur (démonstration ; ce ne sont pas des données réelles).
    var NOISE = [0.3, -0.8, 0.6, -0.4, 0.9, -0.6, 0.2, -0.9, 0.5, -0.3, 0.7, -0.5];
    function corrPts(noise) {
      var p = [], i, nx = NOISE.length;
      for (i = 0; i < nx; i++) {
        var x = i + 1;
        p.push([x, 2 + 0.7 * x + noise * NOISE[i]]);
      }
      return p;
    }

    var plot = document.createElement("div");
    plot.className = "sp-canvas";
    host.appendChild(plot);

    var readout = null, ctrl = null, range = null, buttons = null;

    function makeReadout() { readout = document.createElement("div"); readout.className = "sp-readout"; host.appendChild(readout); }
    function makeCtrl(lo, hi, step, val, sym) {
      ctrl = document.createElement("div"); ctrl.className = "sp-ctrl";
      ctrl.innerHTML = '<label>' + sym + '</label>';
      range = document.createElement("input");
      range.type = "range"; range.min = lo; range.max = hi; range.step = step; range.value = val;
      ctrl.appendChild(range); host.appendChild(ctrl);
    }

    // état + rendu selon le mode
    var st, xb, yb, current;

    if (mode === "correlation") {
      var noise = 2;
      makeCtrl(0, 8, 0.1, noise, "dispersion&nbsp;:&nbsp;");
      makeReadout();
      var render1 = function () {
        noise = parseFloat(range.value);
        var pts = corrPts(noise);
        st = stats(pts);
        xb = [0, NOISE.length + 1];
        yb = bounds(st.ys, false, 0.15);
        draw(host, plot, st, { xb: xb, yb: yb, xlabel: xlabel, ylabel: ylabel, line: { a: st.a, b: st.b }, showG: false });
        readout.innerHTML = '<span class="sp-key">coefficient de corrélation</span> &nbsp; r = ' + fmt(st.r, 2);
      };
      range.addEventListener("input", render1);
      current = render1;
    } else {
      st = stats(basePts);
      var forceZeroY = host.dataset.ymin === "0";
      xb = host.dataset.xmin != null && host.dataset.xmax != null
        ? [parseFloat(host.dataset.xmin), parseFloat(host.dataset.xmax)]
        : bounds(st.xs, host.dataset.xmin === "0", 0.08);
      yb = host.dataset.ymin != null && host.dataset.ymax != null
        ? [parseFloat(host.dataset.ymin), parseFloat(host.dataset.ymax)]
        : bounds(st.ys, forceZeroY, 0.12);

      if (mode === "nuage") {
        current = function () { draw(host, plot, st, { xb: xb, yb: yb, xlabel: xlabel, ylabel: ylabel, showG: true }); };

      } else if (mode === "regression") {
        makeReadout();
        current = function () {
          draw(host, plot, st, { xb: xb, yb: yb, xlabel: xlabel, ylabel: ylabel, line: { a: st.a, b: st.b }, showG: true });
          readout.innerHTML = '<span class="sp-key">droite</span> y ≈ ' + fmt(st.a, 2) + ' x ' + (st.b < 0 ? "− " : "+ ") + fmt(Math.abs(st.b), 2)
            + ' &nbsp;·&nbsp; <span class="sp-key">r</span> = ' + fmt(st.r, 2);
        };

      } else { // moindres
        var span = Math.max(Math.abs(st.a), 0.3);
        var lo = st.a - 2 * span, hi = st.a + 2 * span;
        var a = 0; if (a < lo || a > hi) a = st.a + 1.5 * span;
        makeCtrl(lo, hi, (hi - lo) / 120, a, "pente&nbsp;a&nbsp;:&nbsp;");
        makeReadout();
        buttons = document.createElement("div"); buttons.className = "sp-buttons";
        var best = document.createElement("button"); best.type = "button"; best.className = "sp-btn"; best.textContent = "Meilleure droite";
        buttons.appendChild(best); host.appendChild(buttons);
        var sseMin = sse(st, st.a, st.b);
        var render2 = function () {
          a = parseFloat(range.value);
          var b = st.my - a * st.mx;           // pivot au point moyen G
          draw(host, plot, st, { xb: xb, yb: yb, xlabel: xlabel, ylabel: ylabel, line: { a: a, b: b }, showResid: true, showG: true });
          var S = sse(st, a, b);
          var atMin = Math.abs(a - st.a) < (hi - lo) / 120;
          readout.innerHTML = '<span class="sp-key">pente</span> a = ' + fmt(a, 2)
            + ' &nbsp;·&nbsp; <span class="sp-key">somme des carrés des résidus</span> = ' + fmt(S, 1)
            + (atMin ? ' &nbsp;— <strong>minimum !</strong>' : '');
        };
        range.addEventListener("input", render2);
        best.addEventListener("click", function () { range.value = st.a; render2(); });
        current = render2;
      }
    }

    current();
    if (host.dataset.caption) {
      var cap = document.createElement("div"); cap.className = "sp-caption"; cap.textContent = host.dataset.caption;
      host.appendChild(cap);
    }

    var mo = new MutationObserver(current);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    if (window.matchMedia) {
      try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", current); } catch (e) {}
    }
  }

  function setup() { document.querySelectorAll(".stat-plot").forEach(build); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setup(); setTimeout(setup, 120); });
  else { setup(); setTimeout(setup, 120); }
})();
