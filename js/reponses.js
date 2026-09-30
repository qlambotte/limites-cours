/* ============================================================
   reponses.js — réponses des activités et exemples (rep, repc,
   rep-lignes des notes) : cachées, dévoilées au clic.
   - une réponse en ligne (.rep, y compris dans une formule) :
     clic dessus pour la voir / la recacher ;
   - un clic dans une zone de réponse ne fait QUE afficher / cacher :
     il n'atteint pas MathJax (pas d'exploration surlignée en bleu ni
     d'infobulle) et ne sélectionne pas le texte ;
   - une réponse longue (.rep-bloc) : bouton « Voir la réponse » ;
   - dans l'en-tête de chaque encadré qui en contient :
     « Afficher les réponses » (toutes d'un coup, pour projeter).
   ============================================================ */
(function () {
  "use strict";
  function basculer(e, force) {
    var vu = force === undefined ? !e.classList.contains("vu") : force;
    e.classList.toggle("vu", vu);
    e.setAttribute("aria-expanded", vu ? "true" : "false");
  }
  function preparer() {
    document.querySelectorAll(".rep-bloc").forEach(function (bl) {
      if (bl.dataset.pret) return;
      bl.dataset.pret = "1";
      bl.setAttribute("tabindex", "0"); bl.setAttribute("role", "button");
      bl.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll("span.rep").forEach(function (r) {
      if (r.dataset.pret) return;
      r.dataset.pret = "1";
      r.setAttribute("tabindex", "0"); r.setAttribute("role", "button");
      r.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".theo, .exo").forEach(function (bx) {
      if (bx.dataset.repPret) return;
      if (!bx.querySelector(".rep, .rep-bloc")) return;
      bx.dataset.repPret = "1";
      var tete = bx.querySelector(".theo-head, .exo-tete");
      if (!tete) return;
      var b = document.createElement("button");
      b.type = "button"; b.className = "rep-tout"; b.textContent = "Tout afficher";
      var ouvert = false;
      b.addEventListener("click", function () {
        ouvert = !ouvert;
        bx.querySelectorAll(".rep, .rep-bloc").forEach(function (e) { basculer(e, ouvert); });
        b.textContent = ouvert ? "Tout cacher" : "Tout afficher";
      });
      tete.appendChild(b);
    });
  }
  // Zone de réponse visée par un événement (null si ce n'est pas le cas,
  // si c'est un lien / bouton / figure, ou si un outil d'annotation est actif).
  function zone(ev) {
    var t = ev.target;
    if (!t || !t.closest) return null;
    if (document.documentElement.dataset.annot) return null;
    if (t.closest("a, button, input, select, textarea, .lim-plot")) return null;
    return t.closest(".rep, .rep-bloc");
  }
  // Phase de capture sur window : avant MathJax (explorateur) et les autres scripts.
  ["pointerdown", "mousedown", "mouseup", "touchstart", "dblclick"].forEach(function (type) {
    window.addEventListener(type, function (ev) {
      if (!zone(ev)) return;
      ev.stopPropagation();
      if (type === "mousedown" || type === "dblclick") ev.preventDefault();   // ni focus, ni sélection
    }, true);
  });
  window.addEventListener("click", function (ev) {
    var r = zone(ev);
    if (!r) return;
    ev.stopPropagation(); ev.preventDefault();
    basculer(r);
  }, true);
  document.addEventListener("keydown", function (ev) {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.classList &&
        (ev.target.classList.contains("rep") || ev.target.classList.contains("rep-bloc"))) {
      ev.preventDefault(); basculer(ev.target);
    }
  });
  if (document.readyState !== "loading") preparer();
  document.addEventListener("DOMContentLoaded", preparer);
  // MathJax crée les éléments \class{rep} après le chargement
  [800, 2500].forEach(function (t) { setTimeout(preparer, t); });
})();
