/* qr-votes.js — format des votes par carte transmis du smartphone (page de scan, P7) à la tablette (écran de vote).
   Copie de référence : typweb/site/js/qr-votes.js ; portail/pilotage/js/qr-votes.js en est une copie IDENTIQUE
   (outils/verifier_copies.py et tests/qr-votes.test.js le vérifient).

   Texte du QR :  TWV2;<question ou ->;<présents ou ->;<cartes>;<contrôle>
     présents : nombre d'élèves présents, saisi sur le smartphone (« - » s'il n'est pas donné)
     cartes   : « 3A,12C,40B » (numéro de carte puis lettre, numéros croissants) ; vide si aucune carte
     contrôle : une lettre (somme des codes des caractères de « <présents>;<cartes> », modulo 26) : détecte une
                lecture tronquée
   Ancien format, toujours lu : TWV1;<question ou ->;<cartes>;<contrôle> (sans présents ; contrôle sur <cartes>).
   Saisie à la main (sans QR) : « P22 3A 12C 40B » ou « 3A,12C,40B » (P22 : 22 présents, facultatif ; pas de
   préfixe ni de contrôle). Aucun nom : seulement des numéros de carte et un nombre.

   API (window.QrVotes, ou module Node) :
     encoder({ question?, presents?, cartes: { "3": "A", … } }) → texte
     decoder(texte) → { ok: true, question, presents (nombre ou null), cartes: { "3": "A", … }, n } | { ok: false, erreur }
     code({ presents?, cartes }) → « P22 3A 12C 40B » (le même contenu, à taper) */
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
  function presentsValides(p) {
    p = Number(p);
    return Number.isInteger(p) && p > 0 && p <= 999 ? p : null;
  }
  function encoder(o) {
    o = o || {};
    var c = listeCartes(o.cartes), q = String(o.question || "-").replace(/;/g, ""), p = presentsValides(o.presents);
    var ps = p === null ? "-" : String(p);
    return "TWV2;" + q + ";" + ps + ";" + c + ";" + controle(ps + ";" + c);
  }
  function code(o) {
    o = o || {};
    var p = presentsValides(o.presents), c = listeCartes(o.cartes).split(",").filter(Boolean);
    return (p === null ? [] : ["P" + p]).concat(c).join(" ");
  }
  function lireCartes(s) {
    var cartes = {}, n = 0, mauvais = [], presents = null;
    String(s).toUpperCase().split(/[\s,;]+/).filter(Boolean).forEach(function (m) {
      var p = /^P(\d{1,3})$/.exec(m);
      if (p) { presents = presentsValides(p[1]); if (presents === null) mauvais.push(m); return; }
      var x = /^(\d{1,3})\s*([ABCD])$/.exec(m);
      if (!x) { mauvais.push(m); return; }
      if (!(x[1] in cartes)) n++;
      cartes[String(+x[1])] = x[2];
    });
    return { cartes: cartes, n: n, mauvais: mauvais, presents: presents };
  }
  function decoder(texte) {
    var s = String(texte || "").trim();
    if (!s) return { ok: false, erreur: "code vide" };
    if (/^TWV\d;/i.test(s)) {
      var p = s.split(";"), v = p[0].toUpperCase(), r, pres = null;
      if (v === "TWV1") {
        if (p.length !== 4) return { ok: false, erreur: "QR incomplet : relis-le" };
        if (controle(p[2]) !== p[3].toUpperCase()) return { ok: false, erreur: "QR mal lu (contrôle faux) : relis-le" };
        r = lireCartes(p[2]);
      } else if (v === "TWV2") {
        if (p.length !== 5) return { ok: false, erreur: "QR incomplet : relis-le" };
        if (controle(p[2] + ";" + p[3]) !== p[4].toUpperCase()) return { ok: false, erreur: "QR mal lu (contrôle faux) : relis-le" };
        if (p[2] !== "-") { pres = presentsValides(p[2]); if (pres === null) return { ok: false, erreur: "QR illisible : présents « " + p[2] + " »" }; }
        r = lireCartes(p[3]);
      } else return { ok: false, erreur: "format de QR inconnu (" + p[0] + ")" };
      if (r.mauvais.length || r.presents !== null) return { ok: false, erreur: "QR illisible : " + r.mauvais.slice(0, 3).join(" ") };
      return { ok: true, question: p[1] === "-" ? null : p[1], presents: pres, cartes: r.cartes, n: r.n };
    }
    var m = lireCartes(s);                                  // saisie à la main
    if (m.mauvais.length) return { ok: false, erreur: "à corriger : " + m.mauvais.slice(0, 3).join(" ") + " (attendu : P22 12B 3A …)" };
    if (!m.n) return { ok: false, erreur: "aucune carte dans le code" };
    return { ok: true, question: null, presents: m.presents, cartes: m.cartes, n: m.n };
  }

  var API = { encoder: encoder, decoder: decoder, controle: controle, code: code };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else racine.QrVotes = API;
})(typeof window !== "undefined" ? window : this);
