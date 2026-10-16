/* ============================================================
   vote-echauffement.js — mode B « Échauffement » (P3) : suite courte de 2 à 3 éléments
   (QCM ou exercices d'algèbre), volontairement allégée. Pas de comptage par option :
   le prof révèle, puis note d'un geste « Combien ont réussi ? » (presque tous / environ
   la moitié / peu). Un seul bouton principal en bas ; Espace fait la même chose.
   Chargé par vote.js. Documentation : typweb/doc/couche-prof.md.
   ============================================================ */
(function () {
  "use strict";
  var P = window.typwebProf, V = P && P.vote;
  if (!V) return;
  var U = V.u, h = U.h, bouton = U.bouton, md = U.md;

  var ROLES = { precedent: "Séance précédente", prerequis: "Prérequis", espace: "Révision espacée", algebre: "Algèbre" };
  var GENRES = { factoriser: "Factoriser", developper: "Développer", resoudre: "Résoudre" };
  // niveau de réussite (trois niveaux, mêmes pour les QCM et les exercices) : 2, 1, 0
  var NIVEAUX = [{ n: 2, texte: "Presque tous" }, { n: 1, texte: "Environ la moitié" }, { n: 0, texte: "Peu" }];
  var DUREE_MINUTEUR = 120;

  V.modes.echauffement = { ouvrir: ouvrir, NIVEAUX: NIVEAUX };

  function libelleNiveau(n) {
    for (var i = 0; i < NIVEAUX.length; i++) if (NIVEAUX[i].n === n) return NIVEAUX[i].texte;
    return "–";
  }
  function roleDe(it) {
    if (it.type === "exercice") return it.role && ROLES[it.role] ? ROLES[it.role] : "Algèbre";
    return it.role && ROLES[it.role] ? ROLES[it.role] : "Question";
  }

  function ouvrir(o) {
    var classe = o.classe, items = o.items, cours = (o.data && o.data.cours) || "";
    var ecran = U.ouvrirEcran("tv-ech", "Échauffement");
    var etats = items.map(function () { return { revealed: false, niveau: null, pieges: false }; });
    var cur = 0, vu = 0, dernier = null, minuteur = null;
    var r = {};

    r.points = h("span", { "class": "tv-points-prog", "aria-label": "Progression" });
    var haut = h("div", { "class": "tv-haut tv-prof" }, [
      h("span", { "class": "tv-marque", text: (o.titre || "Échauffement") + " · " + classe }),
      h("span", { "class": "tv-sp" }), r.points, h("span", { "class": "tv-sp" }),
      bouton("Quitter", "tv-lien", function () { ecran.fermer(); })
    ]);
    r.bPrec = bouton("← Précédent", "tv-lien", function () { aller(cur - 1); });
    r.bProj = bouton("Mode projeté", "tv-lien", function () { ecran.projeter(true); }, "Masque la barre et le pied (P ; Échap pour revenir)");
    r.bPrincipal = bouton("Révéler la réponse", "tv-primaire", function () { principal(); });
    var pied = h("div", { "class": "tv-pied tv-prof" }, [r.bPrec, r.bProj, h("span", { "class": "tv-sp" }), r.bPrincipal]);
    r.main = h("main", { "class": "tv-main" });
    ecran.el.appendChild(haut); ecran.el.appendChild(r.main); ecran.el.appendChild(pied);

    /* ----- journal ----- */
    function charge() {
      var lots = [];
      items.forEach(function (it, i) {
        if (i > vu) return;                            // éléments non atteints : pas posés
        var e = { id: it.id, type: it.type, role: it.role || (it.type === "exercice" ? "algebre" : null), niveau: etats[i].niveau };
        if (it.type === "exercice") e.graine = it.graine;
        lots.push(e);
      });
      return lots;
    }
    // Un événement `echauffement` (suite complète) + un événement `exercice` par exercice posé.
    // Écrit à l'arrivée au bilan, ou à la fermeture si au moins un niveau est noté ; réécrit
    // seulement si un niveau a changé depuis (le dernier événement de la session gagne).
    function enreg() {
      var lots = charge(), snap = JSON.stringify(lots);
      if (snap === dernier) return;
      var arrive = cur >= items.length, note = lots.some(function (e) { return e.niveau !== null; });
      if (!arrive && !note) return;
      if (!U.enregistrer(classe, "echauffement", "echauffement", { sid: o.sid, titre: o.titre || "", items: lots })) return;
      dernier = snap;
      lots.forEach(function (e) {
        if (e.type === "exercice") U.enregistrer(classe, e.id, "exercice", { sid: o.sid, graine: e.graine, niveau: e.niveau });
      });
    }

    /* ----- actions ----- */
    function arreterMinuteur() { if (minuteur) { clearInterval(minuteur); minuteur = null; } }
    function aller(i) {
      if (i < 0 || i > items.length || i === cur) return;
      arreterMinuteur();
      cur = i; vu = Math.max(vu, Math.min(i, items.length - 1));
      if (cur >= items.length) enreg();
      construire();
    }
    function principal() {
      if (cur >= items.length) {                       // bilan : retour au cours
        enreg();
        ecran.fermer();
        P.reprendre();
        return;
      }
      var st = etats[cur];
      if (!st.revealed) { st.revealed = true; maj(); U.composer(r.main); return; }
      aller(cur + 1);
    }
    function noter(n) {
      var st = etats[cur];
      st.niveau = st.niveau === n ? null : n;          // un second geste annule
      maj();
    }

    /* ----- rendu ----- */
    function construire() {
      r.main.textContent = "";
      r.main.scrollTop = 0;
      if (cur >= items.length) { bilan(); return; }
      var it = items[cur], tete = h("div", { "class": "tv-role" });
      r.role = tete;
      r.main.appendChild(tete);
      if (it.type === "qcm") qcm(it); else exercice(it);
      r.eval = h("div", { "class": "tv-eval tv-prof" }, [h("span", { text: "Combien ont réussi ?" })].concat(
        NIVEAUX.map(function (x) {
          var b = bouton(x.texte, "tv-niveau", function () { noter(x.n); });
          b.setAttribute("data-n", x.n);
          return b;
        })));
      r.main.appendChild(r.eval);
      maj();
      U.composer(r.main);
    }
    function qcm(it) {
      r.main.appendChild(h("h1", { "class": "tv-enonce", html: md(it.enonce, true) }));
      var opts = h("div", { "class": "tv-opts2" });
      it.options.forEach(function (op, i) {
        opts.appendChild(h("div", { "class": "tv-o2" + (i === it.bonne ? " bonne" : ""), "data-k": op.k }, [
          h("span", { "class": "tv-lettre2", text: op.k }),
          h("span", { "class": "tv-txt", html: md(op.r, true) })
        ]));
      });
      r.main.appendChild(opts);
      var pieges = h("div", { "class": "tv-pieges" });
      it.options.forEach(function (op, i) {
        if (i === it.bonne) return;
        pieges.appendChild(h("div", {}, [h("b", { text: op.k + " : " }), h("span", { html: md((op.erreur ? op.erreur + ". " : "") + (op.retour || ""), true) })]));
      });
      r.pieges = pieges;
      r.lienPieges = bouton("Voir les pièges", "tv-lien", function () { etats[cur].pieges = !etats[cur].pieges; maj(); U.composer(pieges); });
      var pourquoi = h("div", { "class": "tv-why" }, [
        it.explication ? h("div", { "class": "tv-why-t", html: md(it.explication, true) }) : null,
        h("div", {}, [r.lienPieges]), pieges
      ]);
      r.main.appendChild(pourquoi);
    }
    function exercice(it) {
      r.main.appendChild(h("div", { "class": "tv-enonce tv-enonce-ex", html: md(it.enonce, true) }));
      r.tm = h("span", { "class": "tv-tm", "aria-live": "off" });
      r.bTm = bouton("Minuteur 2:00", "tv-lien", function () { lancerMinuteur(); }, "Facultatif : décompte de 2 minutes");
      r.main.appendChild(h("div", { "class": "tv-prof tv-minuteur" }, [r.bTm, r.tm]));
      var corr = h("div", { "class": "tv-corr" }, it.etapes.map(function (x) {
        return h("div", { "class": "tv-etape", html: md(x, true) });
      }));
      corr.appendChild(h("div", { "class": "tv-rep" }, [h("span", { text: "Réponse : " }), h("span", { html: md(it.reponse, true) })]));
      r.main.appendChild(corr);
    }
    function lancerMinuteur() {
      if (minuteur) { arreterMinuteur(); r.tm.textContent = ""; r.bTm.textContent = "Minuteur 2:00"; return; }
      var t = DUREE_MINUTEUR;
      function aff() { r.tm.textContent = Math.floor(t / 60) + ":" + (t % 60 < 10 ? "0" : "") + (t % 60); }
      aff(); r.bTm.textContent = "Arrêter le minuteur";
      minuteur = setInterval(function () {
        t -= 1; aff();
        if (t <= 0) { arreterMinuteur(); r.tm.classList.add("fini"); r.bTm.textContent = "Minuteur 2:00"; }
      }, 1000);
      r.tm.classList.remove("fini");
    }
    function bilan() {
      r.main.appendChild(h("div", { "class": "tv-role", text: "Échauffement terminé" }));
      r.main.appendChild(h("h1", { "class": "tv-enonce", text: "Bilan" }));
      var liste = h("div", { "class": "tv-bilan" });
      items.forEach(function (it, i) {
        var n = etats[i].niveau;
        liste.appendChild(h("div", { "class": "tv-ligne" }, [
          h("span", { "class": "tv-num", text: String(i + 1) }),
          h("span", { "class": "tv-q", html: md(it.enonce, true) }),
          h("span", { "class": "tv-niv", text: libelleNiveau(n) }),
          h("span", {}, [n === 0 ? h("span", { "class": "tv-rev", text: "à reprendre" }) : null])
        ]));
      });
      r.main.appendChild(liste);
      r.main.appendChild(h("p", { "class": "tv-note tv-prof", text: "Le niveau de réussite de chaque élément est enregistré pour cette classe." }));
      maj();
      U.composer(r.main);
    }

    function maj() {
      var fin = cur >= items.length, st = etats[cur], it = items[cur];
      r.points.textContent = "";
      for (var i = 0; i <= items.length; i++) {
        (function (i) {
          r.points.appendChild(h("button", { type: "button", "class": "tv-point" + (i < cur ? " fait" : i === cur ? " now" : ""),
            "aria-label": i < items.length ? "Élément " + (i + 1) + " sur " + items.length : "Bilan",
            "aria-current": i === cur ? "step" : null, onclick: function () { aller(i); } }));
        })(i);
      }
      r.bPrec.style.visibility = cur > 0 ? "visible" : "hidden";
      if (fin) { r.bPrincipal.textContent = "Ouvrir le cours"; return; }
      r.main.classList.toggle("tv-revele", st.revealed);
      r.role.textContent = roleDe(it) + (it.type === "exercice" && GENRES[String(it.id).split(".")[0]] ? " · " + GENRES[String(it.id).split(".")[0]] :
                           cours ? " · " + cours : "") + " · " + (cur + 1) + " sur " + items.length;
      if (it.type === "qcm") {
        r.lienPieges.textContent = st.pieges ? "Masquer les pièges" : "Voir les pièges";
        r.pieges.classList.toggle("on", st.pieges);
      }
      Array.prototype.forEach.call(r.eval.querySelectorAll(".tv-niveau"), function (b) {
        var on = st.niveau !== null && +b.getAttribute("data-n") === st.niveau;
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      r.bPrincipal.textContent = !st.revealed ? (it.type === "qcm" ? "Révéler la réponse" : "Afficher la correction")
                                              : cur === items.length - 1 ? "Bilan →" : "Suivant →";
    }

    ecran.touches = function (e) {
      if (e.code === "Space") { if (!e.repeat) principal(); return true; }
      if (e.key === "ArrowRight") { aller(cur + 1); return true; }
      if (e.key === "ArrowLeft") { aller(cur - 1); return true; }
      if (e.key.length === 1 && e.key.toUpperCase() === "P") { ecran.projeter(!ecran.proj); return true; }
      return false;
    };
    ecran.sauver = enreg;
    ecran.surFermeture = function () {
      arreterMinuteur();
      enreg();
      if (o.apres) { try { o.apres(); } catch (e) {} }
    };

    construire();
    r.bPrincipal.focus({ preventScroll: true });
    return Promise.resolve(ecran);
  }
})();
