/* sw.js — GÉNÉRÉ par typweb : NE PAS ÉDITER. Mode hors-ligne du site.
   - pages (HTML) : réseau d'abord (toujours la dernière version), sinon copie
     gardée ; toutes les pages sont mises de côté à la première visite ;
   - le reste (scripts, styles, figures, polices, MathJax) : copie gardée,
     rafraîchie en arrière-plan. Les PDF ne sont pas mis de côté (trop lourds). */
var VERSION = "f545002271";
var CACHE = "typweb-" + VERSION;
var PAGES = ["./", "index.html", "autoeval.html", "ch1-fonctions/1-rappels.html", "ch1-fonctions/2-operations-sur-les-fonctions.html", "ch1-fonctions/3-reconnaitre-une-composee.html", "ch1-fonctions/4-recherche-algebrique-du-domaine-dune.html", "ch1-fonctions/5-asymptotes-premier-contact.html", "ch1-fonctions/index.html", "ch2-limites/1-quest-ce-quune-limite.html", "ch2-limites/2-chercher-les-points-creux-et.html", "ch2-limites/3-chercher-les-asymptotes-horizontales-et.html", "ch2-limites/index.html", "essentiel.html", "nouveautes.html", "objectifs.html"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(PAGES.map(function (p) {
      return c.add(new Request(p, { cache: "reload" })).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf("typweb-") === 0 && k !== CACHE; })
                         .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function garder(req, rep) {
  if (rep && (rep.ok || rep.type === "opaque")) {
    var copie = rep.clone();
    caches.open(CACHE).then(function (c) { c.put(req, copie); });
  }
  return rep;
}
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (/\.pdf$/i.test(url.pathname)) return;
  var page = req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") >= 0;
  if (page) {
    e.respondWith(fetch(req).then(function (r) { return garder(req, r); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (r) {
        return r || caches.match(new URL("index.html", self.registration.scope).href);
      });
    }));
    return;
  }
  if (url.origin !== location.origin && !/cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) return;
  e.respondWith(caches.match(req).then(function (enCache) {
    var reseau = fetch(req).then(function (r) { return garder(req, r); }).catch(function () { return enCache; });
    return enCache || reseau;
  }));
});
