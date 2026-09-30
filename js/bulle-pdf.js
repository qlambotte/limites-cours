/* ============================================================
   bulle-pdf.js — « ← page N des notes »
   Chaque encadré porte data-page (numéro imprimé) et data-phys
   (page du fichier PDF), posés par typ2site.py à partir de
   _data/pdf.json. Pendant le défilement, on affiche la page du
   dernier encadré passé en haut de l'écran ; un clic ouvre le PDF
   à cette page.
   - écran large : cadre vert en haut de la marge droite, AU-DESSUS
     du sommaire « Sur cette page », qui est replié par défaut ;
   - écran étroit (pas de marge) : bulle en bas à droite ;
   - mode projection : la bulle, calée sur l'encadré projeté.
   ============================================================ */
(function () {
  "use strict";

  function sommaireReplie() {
    var toc = document.getElementById("TOC");
    if (!toc || toc.dataset.replie) return;
    toc.dataset.replie = "1";
    var titre = document.getElementById("toc-title") || toc.querySelector("h2, h3");
    if (!titre) return;
    toc.classList.add("toc-ferme");
    titre.setAttribute("role", "button");
    titre.setAttribute("tabindex", "0");
    titre.setAttribute("aria-expanded", "false");
    function basculer() {
      var ferme = toc.classList.toggle("toc-ferme");
      titre.setAttribute("aria-expanded", ferme ? "false" : "true");
    }
    titre.addEventListener("click", basculer);
    titre.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); basculer(); } });
  }

  function construire() {
    sommaireReplie();
    var reperes = Array.prototype.slice.call(document.querySelectorAll("[data-page]"));
    if (!reperes.length) return;
    var off = document.querySelector('meta[name="quarto:offset"]');
    var base = (window.SITE_OFFSET !== undefined ? window.SITE_OFFSET : (off ? off.getAttribute("content") : "")) + ((window.TYPWEB && window.TYPWEB.pdf) || "cours.pdf");

    // cadre dans la marge (écran large)
    var marge = document.getElementById("quarto-margin-sidebar");
    var cadre = document.createElement("a");
    cadre.className = "page-notes";
    cadre.target = "_blank"; cadre.rel = "noopener";
    cadre.innerHTML = '<span class="pn-fl" aria-hidden="true">←</span><span>page <b class="pn-p"></b> des notes</span>';
    if (marge) marge.insertBefore(cadre, marge.firstChild);

    // bulle (écran étroit)
    var bulle = document.createElement("a");
    bulle.className = "bulle-pdf";
    bulle.target = "_blank"; bulle.rel = "noopener";
    bulle.innerHTML = '<span class="bp-l">Notes</span><span class="bp-p"></span>';
    document.body.appendChild(bulle);
    if (!marge) bulle.classList.add("toujours");

    var courant = null;
    function maj() {
      var seuil = window.innerHeight * 0.35, choix = reperes[0];
      if (document.documentElement.classList.contains("proj")) {   // mode projection : l'encadré projeté
        var actif = document.querySelector(".proj-actif");
        choix = actif && (actif.dataset.page ? actif : actif.querySelector("[data-page]"));
        bulle.classList.toggle("pn-aucune", !choix);
        if (!choix) return;
      } else {
        bulle.classList.remove("pn-aucune");
        for (var i = 0; i < reperes.length; i++) {
          if (reperes[i].getBoundingClientRect().top <= seuil) choix = reperes[i]; else break;
        }
      }
      if (choix === courant) return;
      courant = choix;
      var p = choix.dataset.page, phys = choix.dataset.phys || p;
      var href = base + "#page=" + phys;
      var titre = "Ouvrir le PDF à la page " + p + " (" + (choix.dataset.sorte || "") + " " + (choix.dataset.num || "") + ")";
      cadre.querySelector(".pn-p").textContent = p;
      bulle.querySelector(".bp-p").textContent = "p. " + p;
      [cadre, bulle].forEach(function (e) {
        e.href = href; e.title = titre;   // statique : pas d'animation au changement de page
      });
    }
    var attente = false;
    window.addEventListener("scroll", function () {
      if (attente) return; attente = true;
      requestAnimationFrame(function () { attente = false; maj(); });
    }, { passive: true });
    window.addEventListener("resize", maj);
    maj();
  }
  if (document.readyState !== "loading") construire();
  else document.addEventListener("DOMContentLoaded", construire);
})();
