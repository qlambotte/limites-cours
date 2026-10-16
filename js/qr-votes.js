/* qr-votes.js — format des votes par carte transmis du smartphone (page de scan, P7) à la tablette (écran de vote).
   Copie de référence : typweb/site/js/qr-votes.js ; portail/pilotage/js/qr-votes.js en est une copie IDENTIQUE
   (outils/verifier_copies.py et tests/qr-votes.test.js le vérifient).

   Texte du QR :  TWV1;<question ou ->;<cartes>;<contrôle>
     cartes   : « 3A,12C,40B » (numéro de carte puis lettre, numéros croissants) ; vide si aucune carte
     contrôle : une lettre (somme des codes des caractères de <cartes>, modulo 26) : détecte une lecture tronquée
   Saisie à la main (sans QR) : « 3A 12C 40B » ou « 3A,12C,40B » suffit (pas de préfixe ni de contrôle).
   Aucun nom : seulement des numéros de carte.

   API (window.QrVotes, ou module Node) :
     encoder({ question?, cartes: { "3": "A", … } }) → texte
     decoder(texte) → { ok: true, question, cartes: { "3": "A", … }, n } | { ok: false, erreur } */
(function (racine) {
  "use strict";
  var LET = "ABCD";

  function controle(s) {
    var t = 0;
    for (var i = 0; i < s.length; i++) t = (t + s.charCodeAt(i)) % 26;
    return String.fromCharCode(65 + t);
  }
  function listeCartes(cartes) {
    return Object.keys(cartes || {}).map(Number).filter(function (n) { return n >= 0 && n <= 999 && LET.indexOf(cartes[n]) >= 0; })
      .sort(function (a, b) { return a - b; }).map(function (n) { return n + cartes[n]; }).join(",");
  }
  function encoder(o) {
    o = o || {};
    var c = listeCartes(o.cartes), q = String(o.question || "-").replace(/;/g, "");
    return "TWV1;" + q + ";" + c + ";" + controle(c);
  }
  function lireCartes(s) {
    var cartes = {}, n = 0, mauvais = [];
    String(s).toUpperCase().split(/[\s,;]+/).filter(Boolean).forEach(function (m) {
      var x = /^(\d{1,3})\s*([ABCD])$/.exec(m);
      if (!x) { mauvais.push(m); return; }
      if (!(x[1] in cartes)) n++;
      cartes[String(+x[1])] = x[2];
    });
    return { cartes: cartes, n: n, mauvais: mauvais };
  }
  function decoder(texte) {
    var s = String(texte || "").trim();
    if (!s) return { ok: false, erreur: "code vide" };
    if (/^TWV\d;/i.test(s)) {
      var p = s.split(";");
      if (p[0].toUpperCase() !== "TWV1") return { ok: false, erreur: "format de QR inconnu (" + p[0] + ")" };
      if (p.length !== 4) return { ok: false, erreur: "QR incomplet : relis-le" };
      if (controle(p[2]) !== p[3].toUpperCase()) return { ok: false, erreur: "QR mal lu (contrôle faux) : relis-le" };
      var r = lireCartes(p[2]);
      if (r.mauvais.length) return { ok: false, erreur: "QR illisible : " + r.mauvais.slice(0, 3).join(" ") };
      return { ok: true, question: p[1] === "-" ? null : p[1], cartes: r.cartes, n: r.n };
    }
    var m = lireCartes(s);                                  // saisie à la main
    if (m.mauvais.length) return { ok: false, erreur: "à corriger : " + m.mauvais.slice(0, 3).join(" ") + " (attendu : 12B 3A …)" };
    if (!m.n) return { ok: false, erreur: "aucune carte dans le code" };
    return { ok: true, question: null, cartes: m.cartes, n: m.n };
  }

  var API = { encoder: encoder, decoder: decoder, controle: controle };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else racine.QrVotes = API;
})(typeof window !== "undefined" ? window : this);
