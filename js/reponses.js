/* ============================================================
   reponses.js — réponses des activités et exemples (rep, repc,
   rep-lignes des notes) : cachées, dévoilées au clic.
   - une réponse en ligne (.rep, y compris dans une formule) :
     clic dessus pour la voir / la recacher ;
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
      bl.setAttribute("title", "Clique pour afficher ou cacher la réponse");
    });
    document.querySelectorAll("span.rep").forEach(function (r) {
      if (r.dataset.pret) return;
      r.dataset.pret = "1";
      r.setAttribute("tabindex", "0"); r.setAttribute("role", "button");
      r.setAttribute("title", "Clique pour voir la réponse");
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
  document.addEventListener("click", function (ev) {
    if (!ev.target.closest) return;
    if (ev.target.closest("a, button, input, .lim-plot")) return;
    var r = ev.target.closest(".rep, .rep-bloc");
    if (r) basculer(r);
  });
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
