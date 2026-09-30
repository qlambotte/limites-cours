/* ============================================================
   projection.js — mode projection (TBI) : grand texte, un encadré
   à la fois (définitions, propriétés, exemples, exercices…).
   - bouton « écran » à côté du titre du cours, ou touche P ;
   - → / Espace / Page suivante : encadré suivant ; ← : précédent ;
   - + / − : taille du texte ; Échap : quitter.
   Les réponses se dévoilent au clic, comme d'habitude.
   ============================================================ */
(function () {
  "use strict";
  var items = [], i = 0, actif = false, taille = 1.6, barre;
  var ICO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 2h13a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H9l2 3H9.8L8 11.6 6.2 14H5l2-3H1.5a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5zm.5 1v7h12V3H2z"/></svg>';

  function lister() {
    var main = document.querySelector("main") || document.body;
    return [].slice.call(main.querySelectorAll(".theo, .exo")).filter(function (e) {
      return !e.parentElement.closest(".theo, .exo") && !e.closest(".ae-cache, #ae-banque");
    });
  }
  function nettoyer() {
    document.querySelectorAll(".proj-actif, .proj-chemin").forEach(function (e) {
      e.classList.remove("proj-actif", "proj-chemin");
    });
  }
  function montrer(k) {
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, k));
    nettoyer();
    var it = items[i];
    it.classList.add("proj-actif");
    var suiv = it.nextElementSibling;                  // coups de pouce d'un exercice
    if (suiv && suiv.classList.contains("aides")) suiv.classList.add("proj-actif");
    for (var p = it.parentElement; p && p !== document.body; p = p.parentElement) p.classList.add("proj-chemin");
    var num = it.dataset.num ? " " + it.dataset.num : "";
    var nom = { definition: "Définition", propriete: "Propriété", remarque: "Remarque", exemple: "Exemple",
                activite: "Activité", exercice: "Exercice", methode: "Méthode", theoreme: "Théorème" }[it.dataset.sorte] || "";
    barre.querySelector(".proj-info").textContent = (nom ? nom + num + "   ·   " : "") + (i + 1) + " / " + items.length;
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("resize"));          // figures : se redessiner à la bonne taille
  }
  function appliquerTaille() { document.documentElement.style.setProperty("--proj-taille", taille + "rem"); }
  function entrer() {
    items = lister();
    if (!items.length) { alerteBreve("Pas d'encadré sur cette page."); return; }
    actif = true;
    document.documentElement.classList.add("proj");
    appliquerTaille();
    // commencer à l'encadré visible en haut de l'écran
    var k = -1;
    items.forEach(function (e, j) {
      var r = e.getBoundingClientRect();
      if (k < 0 && r.height > 0 && r.bottom > 40) k = j;           // premier encadré (encore) visible
    });
    if (k < 0) k = 0;
    barre.hidden = false;
    montrer(k);
  }
  function sortir() {
    var it = items[i];
    actif = false;
    document.documentElement.classList.remove("proj");
    nettoyer();
    barre.hidden = true;
    window.dispatchEvent(new Event("resize"));
    if (it) it.scrollIntoView({ block: "start" });
  }
  function basculer() { if (actif) sortir(); else entrer(); }
  function alerteBreve(t) {
    var m = document.createElement("div"); m.className = "proj-msg"; m.textContent = t;
    document.body.appendChild(m); setTimeout(function () { m.remove(); }, 2500);
  }
  function bouton(txt, titre, fn) {
    var b = document.createElement("button"); b.type = "button"; b.className = "proj-b";
    b.textContent = txt; b.title = titre; b.setAttribute("aria-label", titre);
    b.addEventListener("click", fn); return b;
  }
  function construire() {
    if (barre) return;
    barre = document.createElement("div"); barre.className = "proj-barre"; barre.hidden = true;
    barre.appendChild(bouton("←", "Encadré précédent (←)", function () { montrer(i - 1); }));
    var info = document.createElement("span"); info.className = "proj-info"; barre.appendChild(info);
    barre.appendChild(bouton("→", "Encadré suivant (→ ou Espace)", function () { montrer(i + 1); }));
    barre.appendChild(bouton("A−", "Texte plus petit (−)", function () { taille = Math.max(1, taille - .15); appliquerTaille(); }));
    barre.appendChild(bouton("A+", "Texte plus grand (+)", function () { taille = Math.min(3, taille + .15); appliquerTaille(); }));
    barre.appendChild(bouton("✕", "Quitter la projection (Échap)", sortir));
    document.body.appendChild(barre);
    // bouton à côté du titre (outils de la barre latérale)
    var essais = 0;
    (function ajouterOutil() {
      var host = document.querySelector(".sidebar-tools-main");
      if (!host) { if (++essais < 20) setTimeout(ajouterOutil, 150); return; }
      if (host.querySelector(".proj-outil")) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "imsv-tool proj-outil";
      b.innerHTML = ICO; b.title = "Projeter en classe : un encadré à la fois (P)"; b.setAttribute("aria-label", b.title);
      b.addEventListener("click", basculer);
      var theme = host.querySelector("button.imsv-tool:not(.proj-outil)");
      host.insertBefore(b, theme ? theme.nextSibling : null);
    })();
  }
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (!actif) { if (e.key === "p" || e.key === "P") { e.preventDefault(); entrer(); } return; }
    if (e.key === "Escape" || e.key === "p" || e.key === "P") { e.preventDefault(); sortir(); }
    else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); montrer(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); montrer(i - 1); }
    else if (e.key === "+" || e.key === "=") { taille = Math.min(3, taille + .15); appliquerTaille(); }
    else if (e.key === "-") { taille = Math.max(1, taille - .15); appliquerTaille(); }
  });
  if (document.readyState !== "loading") construire(); else document.addEventListener("DOMContentLoaded", construire);
})();
