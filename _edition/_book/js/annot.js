/* ============================================================
   annot.js — annotations personnelles sur le site
   - Stylo : dessiner par-dessus la page (schémas, figures, repères vides)
   - Surligneur : sélectionner un passage → il est surligné
   - Note : un post-it à l'endroit cliqué
   - Correction : un post-it rouge « à corriger », repris dans la liste
     (bouton « Copier » : texte prêt à coller pour corriger les notes)
   - Gomme : cliquer un trait, un surlignage ou un post-it pour l'effacer
   Tout est gardé dans CE navigateur (localStorage), page par page.
   « Exporter » / « Importer » : passer d'un ordinateur à l'autre.
   Les annotations sont accrochées à un bloc du texte (paragraphe,
   encadré, figure…) et suivent ce bloc si la mise en page change.
   ============================================================ */
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var PREF = "lim-annot:v1:";
  var CLE = PREF + location.pathname.replace(/index\.html$/, "");
  var BLOCS = "p, li, h1, h2, h3, h4, table, pre, figure, blockquote, .theo, .callout, .lp-fig, .lp-side, .aides, .activite, .cell-output, mjx-container";
  var COULEURS = [["noir", "var(--an-noir)"], ["rouge", "#c1002a"], ["bleu", "#1d6fb8"], ["vert", "#0a7d4d"]];

  var etat = { outil: null, coul: "rouge", visible: true };
  var data = { traits: [], surl: [], notes: [] };
  var racine, calque, barre, liste;

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
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- ancres : un bloc du texte, repéré par id + chemin ----------
  function bloc(node) {
    var e = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (e && e !== racine && !(e.matches && e.matches(BLOCS))) e = e.parentElement;
    if (!e || e === racine || !racine.contains(e)) return racine;
    // remonter aux conteneurs d'un bloc imbriqué (li dans .theo : garder li)
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
  function boite(e) {
    var r = e.getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: Math.max(r.width, 1), h: r.height };
  }

  // ---------- calque de dessin ----------
  function tailleCalque() {
    calque.setAttribute("width", 0); calque.setAttribute("height", 0);
    calque.style.width = "0px"; calque.style.height = "0px";
    var H = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    var W = document.documentElement.scrollWidth;
    calque.setAttribute("width", W); calque.setAttribute("height", H);
    calque.style.width = W + "px"; calque.style.height = H + "px";
  }
  function dessinerTout() {
    if (!calque) return;
    tailleCalque();
    while (calque.firstChild) calque.removeChild(calque.firstChild);
    data.traits.forEach(function (t) {
      var e = resoudre(t.ancre); if (!e) return;
      var b = boite(e);
      var d = t.pts.map(function (p, i) { return (i ? "L" : "M") + (b.x + p[0] * b.w).toFixed(1) + " " + (b.y + p[1] * b.w).toFixed(1); }).join("");
      var path = document.createElementNS(NS, "path");
      path.setAttribute("d", d); path.setAttribute("class", "an-trait");
      path.style.stroke = t.coul; path.style.strokeWidth = t.ep || 2.5;
      path.dataset.id = t.id;
      calque.appendChild(path);
    });
    placerNotes();
  }

  var enCours = null;
  function debutTrait(ev) {
    if (etat.outil !== "stylo" || ev.button > 0) return;
    ev.preventDefault();
    calque.style.pointerEvents = "none";
    var sous = document.elementFromPoint(ev.clientX, ev.clientY);
    calque.style.pointerEvents = "";
    var e = bloc(sous), b = boite(e);
    enCours = { id: uid(), ancre: ancre(e), coul: couleur(), ep: 2.5, pts: [], _b: b, _el: null };
    enCours._el = document.createElementNS(NS, "path");
    enCours._el.setAttribute("class", "an-trait");
    enCours._el.style.stroke = enCours.coul; enCours._el.style.strokeWidth = 2.5;
    calque.appendChild(enCours._el);
    ajouterPoint(ev);
    try { calque.setPointerCapture(ev.pointerId); } catch (e2) {}
  }
  function ajouterPoint(ev) {
    if (!enCours) return;
    var b = enCours._b, px = ev.pageX, py = ev.pageY;
    enCours.pts.push([+((px - b.x) / b.w).toFixed(4), +((py - b.y) / b.w).toFixed(4)]);
    var d = enCours._el.getAttribute("d") || "";
    enCours._el.setAttribute("d", d + (d ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1));
  }
  function finTrait() {
    if (!enCours) return;
    if (enCours.pts.length > 1) {
      data.traits.push({ id: enCours.id, ancre: enCours.ancre, coul: enCours.coul, ep: enCours.ep, pts: enCours.pts });
      sauver();
    }
    enCours = null; dessinerTout();
  }
  function couleur() {
    for (var i = 0; i < COULEURS.length; i++) if (COULEURS[i][0] === etat.coul) return COULEURS[i][1];
    return COULEURS[0][1];
  }

  // ---------- surligneur ----------
  function textesDe(e) {
    var w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT, null), out = [], n;
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest(".an-ui, script, style")) continue;
      out.push(n);
    }
    return out;
  }
  function decalage(e, node, off) {
    var t = textesDe(e), k = 0;
    for (var i = 0; i < t.length; i++) { if (t[i] === node) return k + off; k += t[i].data.length; }
    return -1;
  }
  function surlignerSelection() {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    var r = sel.getRangeAt(0);
    if (!racine.contains(r.commonAncestorContainer)) return;
    var e = bloc(r.commonAncestorContainer);
    var debut = decalage(e, r.startContainer, r.startOffset);
    var fin = decalage(e, r.endContainer, r.endOffset);
    if (r.startContainer.nodeType !== 3 || r.endContainer.nodeType !== 3 || debut < 0 || fin <= debut) {
      info("Sélectionne du texte à l'intérieur d'un même paragraphe ou encadré."); return;
    }
    var tout = textesDe(e).map(function (n) { return n.data; }).join("");
    var s = { id: uid(), ancre: ancre(e), texte: tout.slice(debut, fin),
              avant: tout.slice(Math.max(0, debut - 24), debut), coul: etat.coul === "noir" ? "jaune" : etat.coul };
    data.surl.push(s); sauver();
    sel.removeAllRanges();
    appliquerSurl(s);
  }
  function appliquerSurl(s) {
    var e = resoudre(s.ancre); if (!e) return;
    var noeuds = textesDe(e), tout = noeuds.map(function (n) { return n.data; }).join("");
    var i = tout.indexOf(s.avant + s.texte);
    var debut = i >= 0 ? i + s.avant.length : tout.indexOf(s.texte);
    if (debut < 0) return;
    var fin = debut + s.texte.length, k = 0;
    noeuds.forEach(function (n) {
      var a = k, b = k + n.data.length; k = b;
      var d = Math.max(debut, a), f = Math.min(fin, b);
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
  var couche;
  function nouvelleNote(ev, sorte) {
    var e = bloc(ev.target), b = boite(e);
    var n = { id: uid(), sorte: sorte, ancre: ancre(e), fx: +((ev.pageX - b.x) / b.w).toFixed(4),
              fy: +((ev.pageY - b.y) / b.w).toFixed(4), texte: "", contexte: (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 90) };
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
      ta.addEventListener("input", function () { n.texte = ta.value; sauver(); });
      var suppr = document.createElement("button"); suppr.type = "button"; suppr.className = "an-suppr"; suppr.textContent = "Supprimer";
      suppr.addEventListener("click", function () { supprimerNote(n.id); });
      var fermer = document.createElement("button"); fermer.type = "button"; fermer.className = "an-fermer"; fermer.textContent = "OK";
      fermer.addEventListener("click", function () { d.classList.remove("ouverte"); if (!n.texte) supprimerNote(n.id); });
      var act = document.createElement("div"); act.className = "an-act"; act.appendChild(suppr); act.appendChild(fermer);
      corps.appendChild(tete); corps.appendChild(ta); corps.appendChild(act);
      pastille.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (etat.outil === "gomme") { supprimerNote(n.id); return; }
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

  // ---------- barre d'outils ----------
  var msg;
  function info(t) { if (!msg) return; msg.textContent = t; msg.hidden = !t; clearTimeout(info._t); info._t = setTimeout(function () { msg.hidden = true; }, 3500); }
  function bouton(txt, titre, fn, cls) {
    var b = document.createElement("button"); b.type = "button"; b.className = "an-b " + (cls || "");
    b.innerHTML = txt; b.title = titre; b.setAttribute("aria-label", titre);
    b.addEventListener("click", fn); return b;
  }
  var AIDE = {
    stylo: "Stylo : dessine avec la souris, le doigt ou le stylet.",
    surligneur: "Surligneur : sélectionne un passage du texte.",
    note: "Note : clique à l'endroit où placer la note.",
    correction: "Correction : clique près de l'erreur, puis décris-la.",
    gomme: "Gomme : clique un trait, un surlignage ou une note pour l'effacer."
  };
  function choisirOutil(o) {
    etat.outil = etat.outil === o ? null : o;
    document.documentElement.dataset.annot = etat.outil || "";
    barre.querySelectorAll("[data-outil]").forEach(function (b) {
      b.classList.toggle("on", b.dataset.outil === etat.outil);
      b.setAttribute("aria-pressed", b.dataset.outil === etat.outil ? "true" : "false");
    });
    calque.style.pointerEvents = (etat.outil === "stylo" || etat.outil === "gomme") ? "auto" : "none";
    info(etat.outil ? AIDE[etat.outil] : "");
    if (etat.outil && !etat.visible) basculerVisible();
  }
  function basculerVisible() {
    etat.visible = !etat.visible;
    calque.style.display = etat.visible ? "" : "none";
    couche.hidden = !etat.visible;
    document.documentElement.classList.toggle("an-cache", !etat.visible);
    barre.querySelector(".an-vis").classList.toggle("on", !etat.visible);
  }

  function construire() {
    racine = document.getElementById("quarto-document-content") || document.querySelector("main") || document.body;
    charger();

    calque = document.createElementNS(NS, "svg");
    calque.setAttribute("class", "an-calque"); calque.setAttribute("aria-hidden", "true");
    document.body.appendChild(calque);
    couche = document.createElement("div"); couche.className = "an-couche an-ui";
    document.body.appendChild(couche);

    calque.addEventListener("pointerdown", function (ev) {
      if (etat.outil === "stylo") debutTrait(ev);
      else if (etat.outil === "gomme") {
        var t = ev.target;
        if (t && t.dataset && t.dataset.id) {
          data.traits = data.traits.filter(function (x) { return x.id !== t.dataset.id; }); sauver(); dessinerTout();
        } else {
          calque.style.pointerEvents = "none";
          var sous = document.elementFromPoint(ev.clientX, ev.clientY);
          calque.style.pointerEvents = "auto";
          var m = sous && sous.closest && sous.closest("mark.an-hl");
          if (m) retirerSurl(m.dataset.id);
        }
      }
    });
    calque.addEventListener("pointermove", function (ev) { if (enCours) ajouterPoint(ev); });
    calque.addEventListener("pointerup", finTrait);
    calque.addEventListener("pointercancel", finTrait);

    document.addEventListener("mouseup", function () { if (etat.outil === "surligneur") setTimeout(surlignerSelection, 0); });
    document.addEventListener("touchend", function () { if (etat.outil === "surligneur") setTimeout(surlignerSelection, 300); });
    document.addEventListener("click", function (ev) {
      if ((etat.outil === "note" || etat.outil === "correction") && racine.contains(ev.target) && !ev.target.closest(".an-ui")) {
        ev.preventDefault(); ev.stopPropagation();
        nouvelleNote(ev, etat.outil);
      }
    }, true);
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && etat.outil) choisirOutil(etat.outil); });

    // barre
    barre = document.createElement("div"); barre.className = "an-barre an-ui";
    var ouvrir = bouton("✎", "Annoter la page", function () {
      barre.classList.toggle("ouverte");
      if (!barre.classList.contains("ouverte") && etat.outil) choisirOutil(etat.outil);
    }, "an-ouvrir");
    // 4 lignes d'icônes : outils · autres outils · couleurs · fichiers
    var I = {
      stylo: '<path d="M3 17l1-4L14 3l3 3L7 16z M12 5l3 3" />',
      surligneur: '<path d="M4 16h12" stroke-width="3" opacity=".5"/><path d="M6 13l6-9 3 2-6 9H6z"/>',
      note: '<path d="M4 3h12v10l-4 4H4z M12 17v-4h4"/>',
      correction: '<path d="M10 3v9 M10 15v1.5" stroke-width="2.4"/>',
      gomme: '<path d="M8 17h9 M3 12l7-8 6 6-6 7H7z M6 9l6 6"/>',
      oeil: '<path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5z"/><circle cx="10" cy="10" r="2.2"/>',
      liste: '<path d="M7 5h10 M7 10h10 M7 15h10 M3 5h1 M3 10h1 M3 15h1"/>',
      poubelle: '<path d="M4 6h12 M8 6V4h4v2 M6 6l1 11h6l1-11"/>',
      exporter: '<path d="M10 3v10 M6 9l4 4 4-4 M4 17h12"/>',
      importer: '<path d="M10 13V3 M6 7l4-4 4 4 M4 17h12"/>'
    };
    function ico(nom) { return '<svg viewBox="0 0 20 20" aria-hidden="true">' + I[nom] + '</svg>'; }
    var outils = document.createElement("div"); outils.className = "an-outils";
    function ligne() { var l = document.createElement("div"); l.className = "an-ligne"; outils.appendChild(l); return l; }
    var l1 = ligne(), l2 = ligne(), l3 = ligne(), l4 = ligne();
    [["stylo", l1], ["surligneur", l1], ["note", l1], ["correction", l1], ["gomme", l2]].forEach(function (o) {
      var b = bouton(ico(o[0]), AIDE[o[0]], function () { choisirOutil(o[0]); }, "an-ico");
      b.dataset.outil = o[0]; b.setAttribute("aria-pressed", "false"); o[1].appendChild(b);
    });
    l2.appendChild(bouton(ico("oeil"), "Masquer ou afficher les annotations", basculerVisible, "an-ico an-vis"));
    l2.appendChild(bouton(ico("liste"), "Liste des corrections notées (toutes les pages)", function () {
      liste.hidden = !liste.hidden; majListe();
    }, "an-ico"));
    var effacer = bouton(ico("poubelle"), "Effacer les annotations de cette page (cliquer deux fois)", function () {
      if (effacer.dataset.confirme) {
        document.querySelectorAll("mark.an-hl").forEach(function (m) { retirerSurl(m.dataset.id); });
        data = { traits: [], surl: [], notes: [] }; sauver(); dessinerTout();
        delete effacer.dataset.confirme; effacer.classList.remove("confirme");
        info("Annotations de la page effacées.");
      } else {
        effacer.dataset.confirme = "1"; effacer.classList.add("confirme");
        info("Clique encore une fois pour effacer toutes les annotations de la page.");
        setTimeout(function () { delete effacer.dataset.confirme; effacer.classList.remove("confirme"); }, 4000);
      }
    }, "an-ico an-danger");
    l2.appendChild(effacer);
    COULEURS.forEach(function (c) {
      var b = bouton("", "Couleur : " + c[0], function () {
        etat.coul = c[0];
        l3.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); });
      }, "an-coul");
      b.style.background = c[1]; if (c[0] === etat.coul) b.classList.add("on");
      l3.appendChild(b);
    });
    l4.appendChild(bouton(ico("exporter"), "Exporter : enregistrer toutes les annotations dans un fichier", exporter, "an-ico"));
    var fin = document.createElement("input"); fin.type = "file"; fin.accept = ".json,application/json"; fin.hidden = true; fin.id = "an-import";
    fin.addEventListener("change", function () { if (fin.files[0]) importer(fin.files[0]); fin.value = ""; });
    l4.appendChild(fin);
    l4.appendChild(bouton(ico("importer"), "Importer des annotations exportées", function () { fin.click(); }, "an-ico"));
    msg = document.createElement("div"); msg.className = "an-msg"; msg.hidden = true; msg.setAttribute("aria-live", "polite");
    barre.appendChild(msg);
    barre.appendChild(outils);
    barre.appendChild(ouvrir);
    document.body.appendChild(barre);

    liste = document.createElement("div"); liste.className = "an-liste an-ui"; liste.hidden = true;
    liste.innerHTML = "<div class='an-liste-t'><b>Corrections notées</b><span></span></div><pre></pre>";
    var copier = bouton("Copier", "Copier la liste", function () {
      var t = texteCorrections();
      var ok = function () { info("Liste copiée."); };
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function () { selectionner(); });
      else selectionner();
    });
    function selectionner() { var r = document.createRange(); r.selectNodeContents(liste.querySelector("pre")); var s = getSelection(); s.removeAllRanges(); s.addRange(r); info("Texte sélectionné : Ctrl+C pour copier."); }
    var fermerL = bouton("Fermer", "Fermer la liste", function () { liste.hidden = true; });
    liste.querySelector(".an-liste-t span").appendChild(copier);
    liste.querySelector(".an-liste-t span").appendChild(fermerL);
    document.body.appendChild(liste);

    data.surl.forEach(appliquerSurl);
    dessinerTout();
    // les figures et les formules se construisent après : redessiner
    [300, 1200, 3000].forEach(function (t) { setTimeout(dessinerTout, t); });
    var ro = window.ResizeObserver ? new ResizeObserver(function () { dessinerTout(); }) : null;
    if (ro) ro.observe(racine);
    window.addEventListener("resize", dessinerTout);
  }

  if (document.readyState !== "loading") construire();
  else document.addEventListener("DOMContentLoaded", construire);
  window.Annot = { redessiner: function () { dessinerTout(); }, donnees: function () { return data; } };
})();
