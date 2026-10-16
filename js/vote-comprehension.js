/* ============================================================
   vote-comprehension.js — mode A « Compréhension » (P3) : vote détaillé sur un QCM.
   Les élèves lèvent une carte A/B/C/D (ou montrent leur ardoise) ; le prof compte
   option par option, révèle la réponse, lit le taux de réussite et décide :
   avancer ou, sous le seuil, laisser discuter les voisins puis revoter (facultatif).
   Chargé par vote.js. Documentation : typweb/doc/couche-prof.md.
   ============================================================ */
(function () {
  "use strict";
  var P = window.typwebProf, V = P && P.vote;
  if (!V) return;
  var U = V.u, h = U.h, bouton = U.bouton, md = U.md, LET = U.LETTRES;
  var CLE_SEUIL = "typweb.vote.seuil";               // seuil de réussite (appareil), 70 % par défaut
  var SEUIL_DEFAUT = 70;

  function lireSeuil() {
    try { var n = +localStorage.getItem(CLE_SEUIL); if (n >= 5 && n <= 100) return Math.round(n); } catch (e) {}
    return SEUIL_DEFAUT;
  }
  function ecrireSeuil(n) { try { localStorage.setItem(CLE_SEUIL, String(n)); } catch (e) {} }

  V.modes.comprehension = { ouvrir: ouvrir, SEUIL_DEFAUT: SEUIL_DEFAUT };

  function ouvrir(o) {
    var classe = o.classe, items = o.items.filter(function (it) { return it.type === "qcm"; });
    if (!items.length) return Promise.reject(new Error("le mode compréhension ne prend que des QCM"));
    var effectif = P.effectif(classe), seuil = lireSeuil(), cur = 0;
    var etats = items.map(function (it) {
      return { it: it, manche: 1, votes: { A: 0, B: 0, C: 0, D: 0 }, revealed: false, enreg: null, histo: [] };
    });
    var ecran = U.ouvrirEcran("tv-comp", "Moment de vérification");
    var r = {};                                        // références DOM de la question affichée

    /* ----- barre du haut, pied : persistants ----- */
    r.points = h("span", { "class": "tv-points-prog", "aria-label": "Progression" });
    r.bProj = bouton("Mode projeté", "tv-lien", function () { ecran.projeter(true); }, "Masque la barre et les boutons (P ; Échap pour revenir)");
    var haut = h("div", { "class": "tv-haut tv-prof" }, [
      h("span", { "class": "tv-marque", text: "Moment de vérification · " + classe }),
      h("span", { "class": "tv-sp" }), r.points, h("span", { "class": "tv-sp" }),
      r.bProj,
      bouton("Quitter", "tv-lien", function () { ecran.fermer(); })
    ]);
    r.bPrec = bouton("← Précédent", "tv-lien", function () { aller(cur - 1); });
    r.bRaz = bouton("Remise à zéro", "tv-lien", function () { raz(); }, "Remet les compteurs à zéro (R)");
    r.effectif = h("span", { "class": "tv-reglage" }, [
      h("span", { text: "Présents" }),
      bouton("−", "tv-pm", function () { effectif = Math.max(1, effectif - 1); maj(); }, "Un élève présent de moins"),
      h("b", { "class": "tv-val" }),
      bouton("+", "tv-pm", function () { effectif += 1; maj(); }, "Un élève présent de plus")
    ]);
    r.seuil = h("span", { "class": "tv-reglage" }, [
      h("span", { text: "Seuil" }),
      bouton("−", "tv-pm", function () { seuil = Math.max(5, seuil - 5); ecrireSeuil(seuil); maj(); }, "Seuil de réussite −5 points"),
      h("b", { "class": "tv-val" }),
      bouton("+", "tv-pm", function () { seuil = Math.min(100, seuil + 5); ecrireSeuil(seuil); maj(); }, "Seuil de réussite +5 points")
    ]);
    r.bRevote = bouton("Revoter", "tv-lien", function () { revoter(); },
                       "Facultatif : nouvelle manche, compteurs à zéro (la manche précédente reste dans le journal)");
    r.bPrincipal = bouton("Révéler la réponse", "tv-primaire", function () { principal(); });
    var pied = h("div", { "class": "tv-pied tv-prof" }, [
      r.bPrec, r.bRaz, r.effectif, r.seuil, h("span", { "class": "tv-sp" }), r.bRevote, r.bPrincipal
    ]);
    r.main = h("main", { "class": "tv-main" });
    ecran.el.appendChild(haut); ecran.el.appendChild(r.main); ecran.el.appendChild(pied);

    /* ----- état ----- */
    function s() { return etats[cur]; }
    function total(st) { return LET.reduce(function (a, k) { return a + st.votes[k]; }, 0); }
    function nbonnes(st) { return st.votes[LET[st.it.bonne]]; }
    function taux(st) { var t = total(st); return t ? nbonnes(st) / t : null; }
    function snapshot(st) { return JSON.stringify([st.manche, LET.map(function (k) { return st.votes[k]; })]); }

    // Journal : un événement `vote` par manche, écrit à la révélation puis corrigé (même manche,
    // même session : le dernier gagne) si les compteurs changent ensuite. Rien si aucun vote compté.
    function enreg(st) {
      var t = total(st);
      if (!t || !st.revealed) return;
      var snap = snapshot(st);
      if (snap === st.enreg) return;
      var n = LET.map(function (k) { return st.votes[k]; });
      if (U.enregistrer(classe, st.it.id, "vote", {
        sid: o.sid, manche: st.manche, n: n, total: t,
        taux: Math.round(1000 * n[st.it.bonne] / t) / 1000, bonne: LET[st.it.bonne]
      })) st.enreg = snap;
    }
    function enregTout() { etats.forEach(enreg); }

    /* ----- actions ----- */
    function bump(k, d) {
      var st = s();
      st.votes[k] = Math.max(0, st.votes[k] + d);
      maj();
    }
    function raz() {
      var st = s();
      LET.forEach(function (k) { st.votes[k] = 0; });
      st.revealed = false; st.enreg = null;
      maj();
    }
    function reveler(oui) {
      var st = s();
      st.revealed = oui;
      if (oui) enreg(st);
      maj();
      if (oui) U.composer(r.main);
    }
    function revoter() {
      var st = s();
      if (!st.revealed) return;
      enreg(st);
      st.histo.push({ manche: st.manche, taux: taux(st) });
      st.manche += 1; st.enreg = null; st.revealed = false;
      LET.forEach(function (k) { st.votes[k] = 0; });
      maj();
    }
    function aller(i) {
      if (i < 0 || i >= etats.length || i === cur) return;
      enreg(s());
      cur = i; construire();
    }
    function principal() {
      var st = s();
      if (!st.revealed) { reveler(true); return; }
      if (cur < etats.length - 1) aller(cur + 1);
      else ecran.fermer();
    }

    /* ----- rendu ----- */
    function construire() {
      var st = s(), it = st.it;
      r.main.textContent = "";
      r.opts = {};
      var ctx = h("div", { "class": "tv-ctx" });
      r.ctx = ctx;
      var opts = h("div", { "class": "tv-opts" });
      it.options.forEach(function (op) {
        var bonne = op.k === LET[it.bonne];
        var o1 = {
          bonne: bonne,
          n: h("span", { "class": "tv-n", text: "0" }),
          pc: h("span", { "class": "tv-pc" }),
          barre: h("div", { "class": "tv-barre" })
        };
        var moins = bouton("−", "tv-pm tv-gros tv-prof", function () { bump(op.k, -1); }, "Retirer un vote pour " + op.k);
        moins.setAttribute("aria-label", "Retirer un vote pour " + op.k);
        var plus = bouton("+", "tv-pm tv-gros tv-prof", function () { bump(op.k, 1); }, "Ajouter un vote pour " + op.k);
        plus.setAttribute("aria-label", "Ajouter un vote pour " + op.k);
        var fb = h("div", { "class": "tv-fb" }, [
          h("div", { "class": "tv-fb-t", text: bonne ? "Bonne réponse" : "Piège : " + (op.erreur || "") }),
          bonne ? null : h("div", { "class": "tv-fb-c", html: md(op.retour, true) })
        ]);
        if (bonne && it.explication) fb.appendChild(h("div", { "class": "tv-fb-c", html: md(it.explication, true) }));
        o1.el = h("div", { "class": "tv-opt", "data-k": op.k }, [
          h("div", { "class": "tv-opt-tete" }, [
            h("span", { "class": "tv-lettre", text: op.k }),
            h("span", { "class": "tv-txt", html: md(op.r, true) })
          ]),
          h("div", { "class": "tv-compte" }, [moins, o1.n, plus, o1.pc]),
          h("div", { "class": "tv-piste" }, [o1.barre]),
          fb
        ]);
        r.opts[op.k] = o1;
        opts.appendChild(o1.el);
      });
      r.total = h("div", { "class": "tv-total-n" });
      r.hint = h("div", { "class": "tv-hint tv-prof", role: "status" });
      var somme = h("div", { "class": "tv-somme" }, [
        h("div", {}, [r.total, h("div", { "class": "tv-ctx", text: "votes comptés" })]),
        r.hint
      ]);
      r.legende = h("div", { "class": "tv-legende tv-prof", html:
        "Raccourcis : <kbd>A</kbd> <kbd>B</kbd> <kbd>C</kbd> <kbd>D</kbd> ajoutent un vote (avec <kbd>Maj</kbd> : en retirent un) · " +
        "<kbd>Espace</kbd> révèle · <kbd>R</kbd> remet à zéro · <kbd>←</kbd> <kbd>→</kbd> changent de question · <kbd>P</kbd> mode projeté." });
      r.main.appendChild(ctx);
      r.main.appendChild(h("h1", { "class": "tv-enonce", html: md(it.enonce, true) }));
      r.main.appendChild(somme);                       // total et taux en haut : toujours visibles, même quand les retours allongent la page
      r.main.appendChild(opts);
      r.main.appendChild(r.legende);
      r.main.scrollTop = 0;
      maj();
      U.composer(r.main);
    }

    function maj() {
      var st = s(), it = st.it, t = total(st), ok = taux(st), rev = st.revealed;
      ecran.el.classList.toggle("tv-revele", rev);
      r.main.classList.toggle("tv-revele", rev);
      // progression
      r.points.textContent = "";
      if (etats.length > 1) {
        etats.forEach(function (e, i) {
          var p = h("button", { type: "button", "class": "tv-point" + (i < cur ? " fait" : i === cur ? " now" : ""),
                                "aria-label": "Question " + (i + 1) + " sur " + etats.length, "aria-current": i === cur ? "step" : null,
                                onclick: function () { aller(i); } });
          r.points.appendChild(p);
        });
      }
      r.ctx.textContent = (o.titre ? o.titre + " · " : "") + (etats.length > 1 ? "Question " + (cur + 1) + " sur " + etats.length + " · " : "") +
                          (st.manche > 1 ? "Manche " + st.manche : "Vote");
      // compteurs, pourcentages, histogramme
      LET.forEach(function (k) {
        var o1 = r.opts[k], n = st.votes[k];
        o1.n.textContent = n;
        o1.pc.textContent = t ? Math.round(100 * n / t) + " %" : "";
        o1.barre.style.width = (t ? 100 * n / t : 0) + "%";
        o1.el.classList.toggle("bonne", rev && o1.bonne);
        o1.el.classList.toggle("autre", rev && !o1.bonne);
        o1.el.classList.toggle("zero", rev && !o1.bonne && n === 0);
      });
      // total sur l'effectif
      r.total.textContent = t + " / " + effectif;
      r.effectif.querySelector(".tv-val").textContent = effectif;
      r.seuil.querySelector(".tv-val").textContent = seuil + " %";
      // indications (prof seulement)
      var msg = "", cls = "";
      if (!rev) {
        if (!t) msg = "Compte les cartes levées, puis touche + pour chaque réponse (ou les touches A à D).";
        else if (t < effectif) msg = "Il manque " + (effectif - t) + " vote" + (effectif - t > 1 ? "s" : "") + ".";
        else if (t > effectif) msg = "Plus de votes que d'élèves présents : corrige un compteur ou l'effectif.";
        else msg = "Tous les votes sont comptés : tu peux révéler.";
      } else if (!t) {
        msg = "Aucun vote compté : pas de taux de réussite.";
      } else {
        var pct = Math.round(100 * ok);
        msg = "<b>" + pct + " % de réussite</b>" + (st.manche > 1 ? " (manche " + st.manche + ")" : "") + ". " +
          (100 * ok >= seuil ? "Seuil de " + seuil + " % atteint : on peut avancer."
                             : "Sous le seuil de " + seuil + " % : discussion entre voisins, puis revote (facultatif).");
        if (st.histo.length) msg += " Avant : " + st.histo.map(function (x) {
          return "manche " + x.manche + " : " + (x.taux === null ? "–" : Math.round(100 * x.taux) + " %"); }).join(", ") + ".";
        cls = 100 * ok >= seuil ? "atteint" : "sous";
      }
      r.hint.innerHTML = msg;
      r.hint.className = "tv-hint tv-prof " + cls;
      // boutons
      r.bPrec.style.visibility = cur > 0 ? "visible" : "hidden";
      r.bRevote.style.display = rev && t ? "" : "none";
      r.bPrincipal.textContent = !rev ? "Révéler la réponse" : cur < etats.length - 1 ? "Question suivante →" : "Terminer";
    }

    /* ----- clavier ----- */
    ecran.touches = function (e) {
      var k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      if (e.key.length === 1 && "ABCD".indexOf(k) >= 0) { if (!e.repeat) bump(k, e.shiftKey ? -1 : 1); return true; }
      if (e.code === "Space") { if (!e.repeat) reveler(!s().revealed); return true; }
      if (k === "R") { raz(); return true; }
      if (k === "P") { ecran.projeter(!ecran.proj); return true; }
      if (e.key === "ArrowRight") { aller(cur + 1); return true; }
      if (e.key === "ArrowLeft") { aller(cur - 1); return true; }
      return false;
    };
    ecran.surFermeture = function () {
      enregTout();
      if (o.apres) { try { o.apres(); } catch (e) {} }
    };

    construire();
    r.bPrincipal.focus({ preventScroll: true });
    return Promise.resolve(ecran);
  }
})();
