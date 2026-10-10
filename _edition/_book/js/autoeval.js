/* autoeval.js — « S'autoévaluer » : composition, passage, bilan.
   GÉNÉRIQUE : tout le contenu est lu dans la page autoeval.html, générée
   par outils/typ2site.py (autoeval.py) à partir de <cours>-autoeval.typ :
     .ae-sec  (sections)   .ae-obj (objectifs)   .ae-qa (questionnaires)
     .ae-q    (questions : .ae-enonce, .ae-prop[.ae-bonne] > .ae-r/.ae-fb,
               ou .ae-rep + .ae-crit)
   Progression : dans le navigateur (localStorage), exportable en PDF
   (impression) et en fichier .json.
   Règles du bilan : un QCM est réussi s'il est trouvé du PREMIER coup ;
   une question ouverte est réussie si TOUS ses critères sont cochés.
   Par objectif, on regarde le dernier résultat de chaque question :
     maîtrisé     = au moins 2 questions réussies (1 si la banque n'en a
                    qu'une pour cet objectif) et aucun échec ;
     en cours     = au moins une réussie ;
     à travailler = tentée(s), aucune réussie. */
(function () {
  "use strict";

  var app, CLE, DATA, ETAT;
  var NIV = { 1: "★", 2: "★★", 3: "★★★" };
  var ETATS = {
    maitrise: ["Maîtrisé", "ae-e-ok"], encours: ["En cours", "ae-e-mid"],
    travailler: ["À travailler", "ae-e-ko"], vide: ["Pas encore évalué", "ae-e-vide"]
  };

  // ---------------------------------------------------------------- outils
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function h(tag, attrs, enfants) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "class") e.className = attrs[k];
      else if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (c) { if (c) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function melanger(t) {
    t = t.slice();
    for (var i = t.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = t[i]; t[i] = t[j]; t[j] = x; }
    return t;
  }
  function maths(el) {
    if (window.MathJax && MathJax.typesetPromise) { try { MathJax.typesetPromise([el]); } catch (e) {} }
  }
  function aujourdhui() { return new Date().toISOString().slice(0, 10); }
  function dateFr(iso) { if (!iso) return ""; var p = iso.slice(0, 10).split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

  // ------------------------------------------------------------- stockage
  function charger() {
    var vide = { v: 1, eleve: "", res: {}, hist: [] };
    try {
      var s = JSON.parse(localStorage.getItem("autoeval:" + CLE) || "null");
      if (s && s.v === 1) return s;
    } catch (e) {}
    return vide;
  }
  function sauver() {
    try { localStorage.setItem("autoeval:" + CLE, JSON.stringify(ETAT)); } catch (e) {}
    sauverBilan();
  }
  // résumé par objectif, lu par la page « Objectifs » (« Où j'en suis »)
  function sauverBilan() {
    if (!DATA) return;
    var b = {};
    DATA.objectifs.forEach(function (o) {
      var e = etatObjectif(o.code);
      b[o.code] = { cle: e.cle, raison: e.raison, total: e.total };
    });
    try { localStorage.setItem("autoeval-bilan:" + CLE, JSON.stringify(b)); } catch (e) {}
  }

  // ---------------------------------------------------------------- données
  function lire() {
    var d = { sections: [], objectifs: [], qas: [], questions: [], parId: {} };
    $$("#ae-banque .ae-sec").forEach(function (e) {
      d.sections.push({ id: e.dataset.id, chap: +e.dataset.chap, url: e.dataset.url, n: +e.dataset.n, html: e.innerHTML });
    });
    $$("#ae-banque .ae-obj").forEach(function (e) {
      d.objectifs.push({ code: e.dataset.code, cat: e.dataset.cat, html: e.innerHTML });
    });
    $$("#ae-banque .ae-qa").forEach(function (e) {
      var spec = {};
      try { spec = JSON.parse(e.dataset.spec); } catch (x) {}
      d.qas.push({ id: e.dataset.id, titre: $(".ae-qa-titre", e).innerHTML, desc: $(".ae-qa-desc", e).innerHTML,
                   questions: spec.questions, tirage: spec.tirage });
    });
    $$("#ae-banque .ae-q").forEach(function (e) {
      var q = { id: e.dataset.id, type: e.dataset.type, section: e.dataset.section,
                obj: (e.dataset.obj || "").split(/\s+/).filter(Boolean), niveau: +e.dataset.niveau,
                forme: e.dataset.forme || null, ordre: e.dataset.ordre || "melange", el: e };
      d.questions.push(q); d.parId[q.id] = q;
    });
    return d;
  }
  function objectif(code) { return DATA.objectifs.filter(function (o) { return o.code === code; })[0]; }
  function typeDe(q) { return q.type === "qcm" ? "qcm" : (q.forme === "courte" ? "courte" : "longue"); }
  var TYPES = { qcm: "QCM", courte: "Question ouverte courte", longue: "Question ouverte longue" };

  // --------------------------------------------------------------- bilan
  function etatObjectif(code) {
    var qs = DATA.questions.filter(function (q) { return q.obj.indexOf(code) >= 0 && ETAT.res[q.id]; });
    var ok = qs.filter(function (q) { return ETAT.res[q.id].ok; }).length;
    var ko = qs.length - ok, cle;
    var total = DATA.questions.filter(function (q) { return q.obj.indexOf(code) >= 0; }).length;
    if (!qs.length) cle = "vide";
    else if (ok >= Math.min(2, total) && ko === 0) cle = "maitrise";   // 1 seule question dans la banque : 1 suffit
    else if (ok >= 1) cle = "encours";
    else cle = "travailler";
    var besoin = Math.min(2, total), raison = "";
    if (cle === "encours") {
      var parts = [];
      if (ok < besoin) parts.push("encore " + (besoin - ok) + " question" + (besoin - ok > 1 ? "s" : "") + " à réussir");
      if (ko) parts.push(ko + " ratée" + (ko > 1 ? "s" : "") + " à refaire");
      raison = parts.join(" et ");
    } else if (cle === "travailler") raison = "aucune réussie pour l'instant";
    return { cle: cle, ok: ok, ko: ko, tentees: qs.length, total: total, raison: raison };
  }
  function pastille(cle) { return h("span", { "class": "ae-etat " + ETATS[cle][1], text: ETATS[cle][0] }); }

  // ------------------------------------------------------------ interface
  var onglet = "tout-faits";
  function coquille() {
    app.innerHTML = "";
    var nav = h("div", { "class": "ae-onglets", role: "tablist" });
    [["tout-faits", "Questionnaires tout faits"], ["composer", "Composer le mien"], ["bilan", "Mon bilan"]]
      .forEach(function (o) {
        nav.appendChild(h("button", { type: "button", role: "tab", "class": "ae-onglet" + (onglet === o[0] ? " on" : ""),
          "aria-selected": onglet === o[0] ? "true" : "false", text: o[1],
          onclick: function () { onglet = o[0]; afficher(); } }));
      });
    app.appendChild(nav);
    var corps = h("div", { "class": "ae-corps" });
    app.appendChild(corps);
    return corps;
  }
  function afficher() {
    var c = coquille();
    if (onglet === "tout-faits") vueToutFaits(c);
    else if (onglet === "composer") vueComposer(c);
    else vueBilan(c);
    maths(app);
  }

  // ---- questionnaires tout faits
  function idsDe(qa) {
    if (qa.questions) return qa.questions.filter(function (id) { return DATA.parId[id]; });
    return tirer(filtrer(qa.tirage || {}), (qa.tirage || {}).nombre || 10, false);
  }
  function vueToutFaits(c) {
    if (!DATA.qas.length) { c.appendChild(h("p", { text: "Aucun questionnaire tout fait pour l'instant : compose le tien." })); return; }
    DATA.qas.forEach(function (qa) {
      var n = qa.questions ? qa.questions.length : Math.min((qa.tirage || {}).nombre || 10, filtrer(qa.tirage || {}).length);
      var carte = h("div", { "class": "ae-carte" }, [
        h("div", { "class": "ae-carte-titre", html: qa.titre }),
        qa.desc ? h("div", { "class": "ae-carte-desc", html: qa.desc }) : null,
        h("div", { "class": "ae-carte-pied" }, [
          h("span", { "class": "ae-muted", text: n + " question" + (n > 1 ? "s" : "") + (qa.questions ? "" : " tirées au hasard") }),
          h("button", { type: "button", "class": "ae-btn ae-btn-p", text: "Commencer",
            onclick: function () { passer(idsDe(qa), qa.titre, qa.id); } })
        ])
      ]);
      c.appendChild(carte);
    });
  }

  // ---- composer
  var choix = null;
  function choixParDefaut() {
    return { sections: {}, obj: {}, types: { qcm: true, courte: true, longue: true }, niveaux: { 1: true, 2: true, 3: true },
             nombre: 10, pasReussies: true };
  }
  function filtrer(t) {
    return DATA.questions.filter(function (q) {
      if (t.sections && t.sections.length && t.sections.indexOf(q.section) < 0) return false;
      if (t.obj && t.obj.length && !q.obj.some(function (o) { return t.obj.indexOf(o) >= 0; })) return false;
      if (t.types && t.types.length && t.types.indexOf(typeDe(q)) < 0 && t.types.indexOf(q.type) < 0) return false;
      if (t.niveaux && t.niveaux.length && t.niveaux.indexOf(q.niveau) < 0) return false;
      return true;
    });
  }
  function tirer(qs, n, prioriteNonReussies) {
    var t = melanger(qs);
    if (prioriteNonReussies) {
      var rang = function (q) { var r = ETAT.res[q.id]; return !r ? 1 : (r.ok ? 2 : 0); };   // ratées, puis jamais vues, puis réussies
      t.sort(function (a, b) { return rang(a) - rang(b); });
    }
    return t.slice(0, n).map(function (q) { return q.id; });
  }
  function critereComposer() {
    var k = function (o) { return Object.keys(o).filter(function (x) { return o[x]; }); };
    return { sections: k(choix.sections), obj: k(choix.obj), types: k(choix.types),
             niveaux: k(choix.niveaux).map(Number) };
  }
  function vueComposer(c) {
    if (!choix) choix = choixParDefaut();
    var dispo = h("p", { "class": "ae-dispo" });
    function maj() {
      var n = filtrer(critereComposer()).length;
      dispo.textContent = n + " question" + (n > 1 ? "s" : "") + " correspond" + (n > 1 ? "ent" : "") + " à tes choix.";
      go.disabled = n === 0;
    }
    function caseA(obj, cle, libelle, html) {
      var id = "ae-c-" + Math.random().toString(36).slice(2, 8);
      var cb = h("input", { type: "checkbox", id: id, checked: obj[cle] ? "checked" : null,
        onchange: function () { obj[cle] = cb.checked; maj(); } });
      return h("label", { "class": "ae-case", "for": id }, [cb, h("span", html ? { html: libelle } : { text: libelle })]);
    }
    // sections, par chapitre
    var fsS = h("fieldset", { "class": "ae-fs" }, [h("legend", { text: "Sections du cours" }),
      h("p", { "class": "ae-muted", text: "Aucune case cochée = tout le cours." })]);
    var chap = null, bloc;
    DATA.sections.forEach(function (s) {
      if (!s.n) return;
      if (s.chap !== chap) { chap = s.chap; bloc = h("div", { "class": "ae-groupe" }, [h("div", { "class": "ae-groupe-t", text: "Chapitre " + chap })]); fsS.appendChild(bloc); }
      bloc.appendChild(caseA(choix.sections, s.id, s.html + ' <span class="ae-muted">(' + s.n + ")</span>", true));
    });
    // objectifs, par catégorie
    var fsO = h("fieldset", { "class": "ae-fs" }, [h("legend", { text: "Objectifs (compétences)" }),
      h("p", { "class": "ae-muted", text: "Aucune case cochée = tous les objectifs." })]);
    var cat = null;
    DATA.objectifs.forEach(function (o) {
      var n = DATA.questions.filter(function (q) { return q.obj.indexOf(o.code) >= 0; }).length;
      if (!n) return;
      if (o.cat !== cat) { cat = o.cat; bloc = h("div", { "class": "ae-groupe" }, [h("div", { "class": "ae-groupe-t", text: cat })]); fsO.appendChild(bloc); }
      bloc.appendChild(caseA(choix.obj, o.code, "<b>" + o.code + "</b> " + o.html, true));
    });
    // types et niveaux
    var fsT = h("fieldset", { "class": "ae-fs ae-fs-ligne" }, [h("legend", { text: "Types de questions" })]);
    Object.keys(TYPES).forEach(function (t) {
      if (DATA.questions.some(function (q) { return typeDe(q) === t; })) fsT.appendChild(caseA(choix.types, t, TYPES[t]));
    });
    var fsN = h("fieldset", { "class": "ae-fs ae-fs-ligne" }, [h("legend", { text: "Niveaux" })]);
    [1, 2, 3].forEach(function (n) { fsN.appendChild(caseA(choix.niveaux, n, NIV[n])); });
    // nombre
    var nb = h("input", { type: "number", min: 1, max: 60, value: choix.nombre, "class": "ae-nombre",
      oninput: function () { choix.nombre = Math.max(1, +nb.value || 1); } });
    var fsX = h("fieldset", { "class": "ae-fs ae-fs-ligne" }, [h("legend", { text: "Nombre de questions" }), nb,
      caseA(choix, "pasReussies", "d'abord celles que je n'ai pas encore réussies")]);
    var go = h("button", { type: "button", "class": "ae-btn ae-btn-p", text: "Commencer",
      onclick: function () {
        var qs = filtrer(critereComposer());
        passer(tirer(qs, choix.nombre, choix.pasReussies), "Mon questionnaire", null);
      } });
    [fsS, fsO, fsT, fsN, fsX, h("div", { "class": "ae-actions" }, [dispo, go])].forEach(function (e) { c.appendChild(e); });
    maj();
  }

  // ---- passage d'un questionnaire
  var run = null;
  function passer(ids, titreHtml, qaId) {
    if (!ids.length) return;
    run = { ids: ids, i: 0, titre: titreHtml, qa: qaId, res: {} };
    etape();
  }
  function rangerNoeuds() {
    var banque = $("#ae-banque");
    $$(".ae-prop[data-ae-pris] > .ae-choix").forEach(function (b) {   // défait le bouton du QCM
      var r = $(".ae-r", b), p = b.parentNode;
      if (r) p.insertBefore(r, b);
      p.removeChild(b);
    });
    $$(".ae-enonce[data-ae-pris], .ae-prop[data-ae-pris], .ae-rep[data-ae-pris], .ae-crit[data-ae-pris]").forEach(function (e) {
      var q = DATA.parId[e.dataset.aePris];
      e.removeAttribute("data-ae-pris");
      e.classList.remove("choisie", "juste", "fausse", "revelee");
      if (q) q.el.appendChild(e); else banque.appendChild(e);
    });
  }
  function prendre(e, q) { e.setAttribute("data-ae-pris", q.id); return e; }

  function etape() {
    rangerNoeuds();
    var c = coquille();
    $$(".ae-onglet", app).forEach(function (b) { b.classList.remove("on"); });
    var q = DATA.parId[run.ids[run.i]];
    var tete = h("div", { "class": "ae-run-tete" }, [
      h("span", { "class": "ae-run-titre", html: run.titre }),
      h("span", { "class": "ae-muted", text: "Question " + (run.i + 1) + " / " + run.ids.length }),
      h("button", { type: "button", "class": "ae-btn ae-btn-l", text: "Abandonner", onclick: function () { rangerNoeuds(); run = null; afficher(); } })
    ]);
    var barre = h("div", { "class": "ae-barre" }, [h("div", { style: "width:" + (100 * run.i / run.ids.length) + "%" })]);
    var meta = h("div", { "class": "ae-q-meta" }, [
      h("span", { "class": "ae-badge", text: TYPES[typeDe(q)] }),
      h("span", { "class": "ae-badge", text: NIV[q.niveau] }),
      h("span", { "class": "ae-badge", text: q.obj.join(", "), title: q.obj.map(function (o) { var x = objectif(o); return x ? o + " : " + x.html.replace(/<[^>]+>/g, "") : o; }).join("\n") })
    ]);
    var carte = h("div", { "class": "ae-q-carte" }, [meta, prendre($(".ae-enonce", q.el), q)]);
    var suite = h("button", { type: "button", "class": "ae-btn ae-btn-p ae-suivant", text: run.i + 1 < run.ids.length ? "Question suivante →" : "Voir mon résultat",
      disabled: "disabled", onclick: function () { run.i++; if (run.i < run.ids.length) etape(); else fin(); } });
    if (q.type === "qcm") qcm(q, carte, suite); else ouverte(q, carte, suite);
    [tete, barre, carte, h("div", { "class": "ae-actions" }, [suite])].forEach(function (e) { c.appendChild(e); });
    maths(c);
    window.scrollTo({ top: app.getBoundingClientRect().top + window.scrollY - 80 });
  }
  function enregistrer(q, ok, extra) {
    var r = { ok: ok, date: aujourdhui() };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    ETAT.res[q.id] = r; run.res[q.id] = ok; sauver();
  }

  function qcm(q, carte, suite) {
    var props = $$(".ae-prop", q.el);
    if (q.ordre !== "fixe") props = melanger(props);
    var liste = h("div", { "class": "ae-props", role: "group" });
    var essais = 0, fini = false;
    props.forEach(function (p, k) {
      prendre(p, q);
      var bouton = h("button", { type: "button", "class": "ae-choix" }, [h("span", { "class": "ae-lettre", text: "ABCDE"[k] })]);
      bouton.appendChild($(".ae-r", p));
      p.insertBefore(bouton, p.firstChild);
      bouton.addEventListener("click", function () {
        if (fini || p.classList.contains("choisie")) return;
        essais++;
        p.classList.add("choisie", "revelee");
        var juste = p.classList.contains("ae-bonne");
        p.classList.add(juste ? "juste" : "fausse");
        if (essais === 1) enregistrer(q, juste, { essais: 1 });
        if (juste) {
          fini = true;
          liste.classList.add("fini");
          suite.disabled = false;
          if (essais > 1) ETAT.res[q.id].essais = essais, sauver();
        }
        maths(p);
      });
      liste.appendChild(p);
    });
    carte.appendChild(h("p", { "class": "ae-consigne", text: "Choisis une proposition. Si tu te trompes, lis l'explication et réessaie : seul le premier essai compte dans ton bilan." }));
    carte.appendChild(liste);
  }
  function ouverte(q, carte, suite) {
    var zone = h("textarea", { "class": "ae-texte", rows: q.forme === "courte" ? 2 : 6,
      placeholder: "Écris ta réponse ici (ou sur papier), puis affiche la réponse type." });
    var rep = prendre($(".ae-rep", q.el), q);
    var crits = $$(".ae-crit", q.el).map(function (e) { return prendre(e, q); });
    var grille = h("div", { "class": "ae-grille" }, [h("div", { "class": "ae-grille-t", text: "Compare avec la réponse type et coche ce que tu as réussi :" })]);
    var cases = crits.map(function (cr) {
      var id = "ae-k-" + Math.random().toString(36).slice(2, 8);
      var cb = h("input", { type: "checkbox", id: id });
      var lab = h("label", { "class": "ae-case", "for": id }, [cb]);
      lab.appendChild(cr);
      grille.appendChild(lab);
      return cb;
    });
    var valider = h("button", { type: "button", "class": "ae-btn ae-btn-p", text: "Valider mon autoévaluation",
      onclick: function () {
        var coches = cases.map(function (c) { return c.checked; });
        var ok = coches.every(Boolean);
        enregistrer(q, ok, { criteres: coches });
        cases.forEach(function (c) { c.disabled = true; });
        valider.disabled = true;
        verdict.textContent = ok ? "Tous les critères sont réussis : question réussie."
          : coches.filter(Boolean).length + " critère(s) sur " + coches.length + " : relis la réponse type et reviens-y plus tard.";
        verdict.className = "ae-verdict " + (ok ? "ae-e-ok" : "ae-e-mid");
        suite.disabled = false;
      } });
    var verdict = h("p", { "class": "ae-verdict" });
    var bloc = h("div", { "class": "ae-cache-local" }, [h("div", { "class": "ae-rep-t", text: "Réponse type" }), rep, grille,
      h("div", { "class": "ae-actions" }, [valider]), verdict]);
    var voir = h("button", { type: "button", "class": "ae-btn", text: "Voir la réponse type",
      onclick: function () { bloc.classList.remove("ae-cache-local"); voir.remove(); maths(bloc); } });
    [zone, h("div", { "class": "ae-actions" }, [voir]), bloc].forEach(function (e) { carte.appendChild(e); });
  }

  function fin() {
    rangerNoeuds();
    var ids = run.ids, ok = ids.filter(function (id) { return run.res[id]; }).length;
    ETAT.hist.push({ date: aujourdhui(), qa: run.qa, n: ids.length, ok: ok });
    if (ETAT.hist.length > 200) ETAT.hist = ETAT.hist.slice(-200);
    sauver();
    var c = coquille();
    $$(".ae-onglet", app).forEach(function (b) { b.classList.remove("on"); });
    c.appendChild(h("h3", { "class": "ae-fin-t", text: "Résultat : " + ok + " / " + ids.length + " réussie" + (ok > 1 ? "s" : "") }));
    // objectifs touchés
    var codes = [];
    ids.forEach(function (id) { DATA.parId[id].obj.forEach(function (o) { if (codes.indexOf(o) < 0) codes.push(o); }); });
    codes.sort();
    c.appendChild(tableObjectifs(codes, true));
    var ratees = ids.filter(function (id) { return !run.res[id]; });
    var titre = run.titre;
    var actions = h("div", { "class": "ae-actions" }, [
      ratees.length ? h("button", { type: "button", "class": "ae-btn ae-btn-p", text: "Refaire les " + ratees.length + " question(s) ratée(s)",
        onclick: function () { passer(melanger(ratees), titre, null); } }) : null,
      h("button", { type: "button", "class": "ae-btn", text: "Mon bilan complet", onclick: function () { run = null; onglet = "bilan"; afficher(); } }),
      h("button", { type: "button", "class": "ae-btn", text: "Retour", onclick: function () { run = null; afficher(); } })
    ]);
    c.appendChild(actions);
    run = null;
    maths(c);
  }

  function tableObjectifs(codes, avecLiens) {
    var t = h("table", { "class": "ae-table" });
    t.appendChild(h("thead", {}, [h("tr", {}, [h("th", { text: "Objectif" }), h("th", { text: "Je suis capable de…" }),
      h("th", { text: "Questions réussies" }), h("th", { text: "État" })])]));
    var tb = h("tbody");
    codes.forEach(function (code) {
      var o = objectif(code) || { html: "" }, e = etatObjectif(code);
      tb.appendChild(h("tr", {}, [h("td", {}, [h("b", { text: code })]), h("td", { html: o.html }),
        h("td", { "class": "ae-num", text: e.tentees ? e.ok + " / " + e.tentees + (e.total > e.tentees ? " (sur " + e.total + ")" : "") : "— (" + e.total + " disponible" + (e.total > 1 ? "s" : "") + ")" }),
        h("td", {}, [pastille(e.cle)].concat(e.raison ? [h("div", { "class": "ae-raison", text: e.raison })] : []))]));
    });
    t.appendChild(tb);
    var boite = h("div", {}, [t, h("p", { "class": "ae-legende",
      text: "Maîtrisé : au moins 2 questions réussies (1 si l'objectif n'en a qu'une) et aucune ratée, "
        + "d'après ton dernier passage sur chaque question (1er essai). En cours : déjà une réussite, mais pas encore assez, ou une question ratée à refaire. "
        + "À travailler : aucune réussite pour l'instant." })]);
    return boite;
  }

  // ---- bilan
  var confirmerEffacer = false;
  function vueBilan(c) {
    var nom = h("input", { type: "text", "class": "ae-nom", value: ETAT.eleve || "", placeholder: "Prénom Nom",
      oninput: function () { ETAT.eleve = nom.value; sauver(); } });
    c.appendChild(h("div", { "class": "ae-print-tete" }, [
      h("div", { "class": "ae-print-cours", text: document.title.replace(/^S'autoévaluer\s*[–—-]\s*/, "") }),
      h("label", { "class": "ae-nom-l" }, ["Élève : ", nom]),
      h("span", { "class": "ae-print-date", text: "Bilan au " + dateFr(aujourdhui()) })
    ]));
    c.appendChild(h("p", { "class": "ae-legende" }, [
      "Pour chaque objectif, on regarde le dernier essai de chaque question. ",
      pastille("maitrise"), " au moins 2 questions réussies, aucun échec · ",
      pastille("encours"), " au moins une réussie · ", pastille("travailler"), " aucune réussie."
    ]));
    var codes = DATA.objectifs.map(function (o) { return o.code; })
      .filter(function (code) { return DATA.questions.some(function (q) { return q.obj.indexOf(code) >= 0; }); });
    c.appendChild(tableObjectifs(codes));
    c.appendChild(fiche(codes));
    // historique
    var hist = ETAT.hist.slice(-10).reverse();
    if (hist.length) {
      c.appendChild(h("h4", { text: "Derniers questionnaires" }));
      c.appendChild(h("ul", { "class": "ae-hist" }, hist.map(function (x) {
        return h("li", { text: dateFr(x.date) + " — " + x.ok + " / " + x.n + " réussie" + (x.ok > 1 ? "s" : "") });
      })));
    }
    var fichier = h("input", { type: "file", accept: ".json,application/json", style: "display:none",
      onchange: function () {
        var f = fichier.files[0]; if (!f) return;
        var lr = new FileReader();
        lr.onload = function () {
          try { var d = JSON.parse(lr.result); if (d && d.v === 1 && d.res) { ETAT = d; sauver(); afficher(); } } catch (e) {}
        };
        lr.readAsText(f);
      } });
    var effacer = h("button", { type: "button", "class": "ae-btn ae-btn-l", text: "Effacer ma progression",
      onclick: function () {
        if (!confirmerEffacer) { confirmerEffacer = true; effacer.textContent = "Cliquer encore pour confirmer"; return; }
        ETAT = { v: 1, eleve: ETAT.eleve, res: {}, hist: [] }; sauver(); confirmerEffacer = false; afficher();
      } });
    c.appendChild(h("div", { "class": "ae-actions ae-no-print" }, [
      h("button", { type: "button", "class": "ae-btn ae-btn-p", text: "Exporter en PDF",
        onclick: function () { document.body.classList.add("ae-impression"); window.print(); } }),
      h("button", { type: "button", "class": "ae-btn", text: "Imprimer ma fiche « à retravailler »",
        onclick: function () { document.body.classList.add("ae-impression", "ae-fiche-seule"); window.print(); } }),
      h("button", { type: "button", "class": "ae-btn", text: "Sauvegarder (fichier)",
        onclick: function () {
          var blob = new Blob([JSON.stringify(ETAT, null, 1)], { type: "application/json" });
          var a = h("a", { href: URL.createObjectURL(blob), download: "autoeval-" + CLE + "-" + aujourdhui() + ".json" });
          document.body.appendChild(a); a.click(); a.remove();
        } }),
      h("button", { type: "button", "class": "ae-btn", text: "Reprendre un fichier…", onclick: function () { fichier.click(); } }),
      fichier, effacer
    ]));
    c.appendChild(h("p", { "class": "ae-muted ae-no-print", text: "Ta progression reste dans ce navigateur (rien n'est envoyé). « Exporter en PDF » ouvre l'impression : choisis « Enregistrer au format PDF »." }));
  }
  window.addEventListener("afterprint", function () { document.body.classList.remove("ae-impression", "ae-fiche-seule"); });

  // fiche « Ce que je dois retravailler » : objectifs à travailler / en cours,
  // avec les sections et les exercices du cours qui les travaillent
  function fiche(codes) {
    var exos = [];
    try { exos = JSON.parse(($("#ae-exos") || {}).textContent || "[]"); } catch (e) {}
    var off = window.SITE_OFFSET || "";
    var lignes = codes.map(function (code) { return { code: code, e: etatObjectif(code) }; })
      .filter(function (x) { return x.e.cle === "travailler" || x.e.cle === "encours"; });
    var bloc = h("div", { "class": "ae-fiche" }, [h("h4", { text: "Ce que je dois retravailler" })]);
    if (!lignes.length) {
      bloc.appendChild(h("p", { "class": "ae-muted", text: codes.some(function (c) { return etatObjectif(c).cle !== "vide"; })
        ? "Rien pour l'instant : tous les objectifs testés sont maîtrisés." : "Fais d'abord un questionnaire : la fiche se remplit avec tes résultats." }));
      return bloc;
    }
    // d'abord « à travailler », puis « en cours »
    lignes.sort(function (a, b) { return (a.e.cle === "travailler" ? 0 : 1) - (b.e.cle === "travailler" ? 0 : 1); });
    lignes.forEach(function (x) {
      var o = objectif(x.code);
      var secs = {};
      DATA.questions.forEach(function (q) {
        if (q.obj.indexOf(x.code) >= 0 && ETAT.res[q.id] && !ETAT.res[q.id].ok) secs[q.section] = true;
      });
      var nomsSec = DATA.sections.filter(function (s) { return secs[s.id]; });
      var ex = exos.filter(function (e) { return e.obj.indexOf(x.code) >= 0; })
                   .sort(function (a, b) { return (a.niveau || 0) - (b.niveau || 0); });
      var li = h("div", { "class": "ae-fiche-obj" }, [
        h("div", { "class": "ae-fiche-t" }, [pastille(x.e.cle), " ", h("b", { text: x.code }), " ", h("span", { html: o ? o.html : "" })]),
        x.e.raison ? h("div", { "class": "ae-raison", text: x.e.raison }) : null
      ]);
      if (nomsSec.length) {
        var ps = h("div", { "class": "ae-fiche-l" }, [h("span", { text: "Relire : " })]);
        nomsSec.forEach(function (s, k) {
          if (k) ps.appendChild(document.createTextNode(" · "));
          var tmp = h("div", { html: s.html }), p1 = tmp.querySelector("p");
          ps.appendChild(h("a", { href: off + s.url, html: p1 && tmp.children.length === 1 ? p1.innerHTML : s.html }));
        });
        li.appendChild(ps);
      }
      if (ex.length) {
        var pe = h("div", { "class": "ae-fiche-l" }, [h("span", { text: "Exercices : " })]);
        ex.forEach(function (e, k) {
          if (k) pe.appendChild(document.createTextNode(" · "));
          pe.appendChild(h("a", { href: off + e.url, text: "Ex. " + e.num + (e.niveau ? " " + "★".repeat(e.niveau) : "") +
                                                          (e.page ? " (p. " + e.page + ")" : "") }));
        });
        li.appendChild(pe);
      }
      bloc.appendChild(li);
    });
    return bloc;
  }

  // ---------------------------------------------------------- démarrage
  // Lien « S'autoévaluer sur cette section » (#sections=…) ou « M'entraîner » d'un
  // objectif (#obj=…) : test lancé directement, N_DIRECT questions (moins s'il n'y
  // en a pas assez), d'abord celles pas encore réussies, puis par niveau croissant.
  // #composer&sections=… : ouvre seulement « Composer », cases déjà cochées ;
  // #…&n=15 : autre nombre de questions.
  var N_DIRECT = 10, direct = null;
  function lireHash() {
    var h = location.hash || "";
    var m = /sections=([^&]+)/.exec(h), o = /obj=([^&]+)/.exec(h), n = /[#&]n=(\d+)/.exec(h);
    direct = null;
    if (!m && !o) return;
    choix = choixParDefaut();
    if (m) decodeURIComponent(m[1]).split(",").forEach(function (s) { if (s) choix.sections[s] = true; });
    if (o) decodeURIComponent(o[1]).split(",").forEach(function (s) { if (s) choix.obj[s] = true; });
    choix.nombre = n ? Math.max(1, +n[1]) : N_DIRECT;
    choix.pasReussies = true;
    onglet = "composer";
    if (!/composer/.test(h)) {
      var titre = "";
      if (m) titre = DATA.sections.filter(function (s) { return choix.sections[s.id]; })
                                  .map(function (s) { return s.html; }).join(" · ");
      if (o) titre = (titre ? titre + " · " : "") + Object.keys(choix.obj).map(function (c) {
        var x = objectif(c); return "<b>" + c + "</b>" + (x ? " " + x.html : "");
      }).join(" · ");
      direct = { titre: titre || "Mon questionnaire" };
    }
  }
  function lancerDirect() {
    if (!direct) return false;
    var ids = tirer(filtrer(critereComposer()), choix.nombre, true);
    if (!ids.length) return false;
    ids.sort(function (a, b) { return DATA.parId[a].niveau - DATA.parId[b].niveau; });
    // le hash est « consommé » : recharger la page ne relance pas le même test
    try { history.replaceState(null, "", location.pathname + location.search + "#composer&" + location.hash.slice(1)); } catch (e) {}
    passer(ids, direct.titre, null);
    direct = null;
    return true;
  }
  function demarrer() {
    app = document.getElementById("ae-app");
    if (!app || app.dataset.aeWired) return;
    app.dataset.aeWired = "1";
    CLE = app.dataset.cle || "cours";
    DATA = lire();
    ETAT = charger();
    // oublier les résultats de questions retirées de la banque
    Object.keys(ETAT.res).forEach(function (id) { if (!DATA.parId[id]) delete ETAT.res[id]; });
    sauverBilan();
    lireHash();
    if (!lancerDirect()) afficher();
    window.addEventListener("hashchange", function () { if (!run) { lireHash(); if (!lancerDirect()) afficher(); } });
  }
  // ------------------------------------- page « Objectifs » : où j'en suis
  function suiviObjectifs() {
    var box = document.getElementById("obj-suivi");
    if (!box || box.dataset.pret) return;
    box.dataset.pret = "1";
    var b = null;
    try { b = JSON.parse(localStorage.getItem("autoeval-bilan:" + (box.dataset.cle || "cours")) || "null"); } catch (e) {}
    var lien = box.dataset.autoeval;
    var n = { maitrise: 0, encours: 0, travailler: 0, vide: 0 };
    $$(".obj[data-code]").forEach(function (row) {
      var code = row.dataset.code, e = (b && b[code]) || { cle: "vide", total: -1 };
      if (e.total === 0) return;                          // aucune question pour cet objectif
      n[e.cle] = (n[e.cle] || 0) + 1;
      var cell = h("div", { "class": "obj-etat" }, [pastille(e.cle)]);
      if (e.raison) cell.appendChild(h("div", { "class": "ae-raison", text: e.raison }));
      if (lien && e.cle !== "maitrise")
        cell.appendChild(h("a", { "class": "obj-go", href: lien + "#obj=" + encodeURIComponent(code),
                                  text: e.cle === "vide" ? "Me tester →" : "M'entraîner →" }));
      row.appendChild(cell);
      row.classList.add("obj-avec-etat");
    });
    if (!b) box.appendChild(h("p", { "class": "ae-muted", text: "Pas encore de résultat : passe par « S'autoévaluer » ; ton bilan par objectif s'affichera ici (il reste dans ce navigateur)." }));
    else box.appendChild(h("p", { "class": "obj-resume" }, [
      pastille("maitrise"), " " + n.maitrise + "   ", pastille("encours"), " " + n.encours + "   ",
      pastille("travailler"), " " + n.travailler + "   ", pastille("vide"), " " + n.vide]));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", suiviObjectifs); else suiviObjectifs();

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", demarrer); else demarrer();
  window.AutoEval = { etat: function () { return ETAT; }, donnees: function () { return DATA; } };
})();
