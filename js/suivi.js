/* ============================================================
   suivi.js — « Mon suivi » des exercices (dans CE navigateur)
   - sous chaque exercice : « Fait » / « Réussi » (réussi ⇒ fait) ;
   - en haut d'une page qui a des exercices : bilan de la page ;
   - sur la page d'un chapitre : bilan de chaque section
     (span.suivi-sec data-exos="2.9 2.10 …", écrit par typweb).
   Stockage : localStorage « suivi:<cle> » = { "2.9": 1 (fait) | 2 (réussi) }.
   ============================================================ */
(function () {
  "use strict";
  var CLE = "suivi:" + ((window.TYPWEB || {}).cle || "cours");
  function lire() { try { return JSON.parse(localStorage.getItem(CLE) || "{}") || {}; } catch (e) { return {}; } }
  function ecrire(d) { try { localStorage.setItem(CLE, JSON.stringify(d)); } catch (e) {} }

  function compte(nums, d) {
    var r = { n: nums.length, fait: 0, reussi: 0 };
    nums.forEach(function (k) { if (d[k] >= 1) r.fait++; if (d[k] === 2) r.reussi++; });
    return r;
  }
  function texteBilan(c) {
    return c.reussi + " réussi" + (c.reussi > 1 ? "s" : "") + " · " + (c.fait - c.reussi) + " à revoir · " +
           (c.n - c.fait) + " pas encore fait" + (c.n - c.fait > 1 ? "s" : "");
  }
  function barre(c) {
    var b = document.createElement("span"); b.className = "suivi-barre";
    b.innerHTML = '<span class="suivi-ok" style="width:' + (100 * c.reussi / c.n) + '%"></span>' +
                  '<span class="suivi-mid" style="width:' + (100 * (c.fait - c.reussi) / c.n) + '%"></span>';
    return b;
  }

  var bilanPage = null;
  function majBilanPage() {
    if (!bilanPage) return;
    var nums = [].map.call(document.querySelectorAll(".exo[data-num]"), function (e) { return e.dataset.num; });
    var c = compte(nums, lire());
    bilanPage.innerHTML = "<b>Mon suivi</b> — " + c.n + " exercice" + (c.n > 1 ? "s" : "") + " sur cette page : ";
    bilanPage.appendChild(barre(c));
    bilanPage.appendChild(document.createTextNode(" " + texteBilan(c)));
  }

  function preparer() {
    var exos = document.querySelectorAll(".exo[data-num]");
    exos.forEach(function (ex) {
      if (ex.querySelector(".suivi")) return;
      var num = ex.dataset.num;
      var zone = document.createElement("div"); zone.className = "suivi";
      zone.innerHTML = '<span class="suivi-lab">Mon suivi :</span>';
      var bFait = document.createElement("button"), bOk = document.createElement("button");
      bFait.type = bOk.type = "button";
      bFait.className = "suivi-b"; bOk.className = "suivi-b suivi-b-ok";
      bFait.textContent = "Fait"; bOk.textContent = "Réussi";
      bFait.title = "Je l'ai fait (à revoir si pas réussi)"; bOk.title = "Je l'ai réussi seul(e)";
      function maj() {
        var v = lire()[num] || 0;
        bFait.classList.toggle("on", v >= 1); bOk.classList.toggle("on", v === 2);
        bFait.setAttribute("aria-pressed", v >= 1); bOk.setAttribute("aria-pressed", v === 2);
        ex.classList.toggle("exo-fait", v === 1); ex.classList.toggle("exo-reussi", v === 2);
      }
      function poser(v) {
        var d = lire();
        if (v) d[num] = v; else delete d[num];
        ecrire(d); maj(); majBilanPage();
      }
      bFait.addEventListener("click", function () { var v = lire()[num] || 0; poser(v >= 1 ? 0 : 1); });
      bOk.addEventListener("click", function () { var v = lire()[num] || 0; poser(v === 2 ? 1 : 2); });
      zone.appendChild(bFait); zone.appendChild(bOk);
      var corps = ex.querySelector(".exo-corps");
      (corps ? corps.parentNode : ex).appendChild(zone);
      maj();
    });
    if (exos.length && !bilanPage) {
      bilanPage = document.createElement("div"); bilanPage.className = "suivi-page";
      var h = document.querySelector("#title-block-header") || document.querySelector("main h1");
      if (h) { h.parentNode.insertBefore(bilanPage, h.nextSibling); majBilanPage(); }
    }
    // page d'un chapitre : une barre par section
    var d = lire();
    document.querySelectorAll("span.suivi-sec[data-exos]").forEach(function (s) {
      var nums = s.dataset.exos.split(/\s+/).filter(Boolean);
      if (!nums.length) return;
      var c = compte(nums, d);
      s.innerHTML = "";
      s.title = texteBilan(c);
      s.appendChild(barre(c));
      s.appendChild(document.createTextNode(" " + c.reussi + "/" + c.n));
    });
  }
  window.addEventListener("storage", function (e) { if (e.key === CLE) { majBilanPage(); } });
  if (document.readyState !== "loading") preparer(); else document.addEventListener("DOMContentLoaded", preparer);
})();
