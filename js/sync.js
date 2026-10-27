/* ============================================================
   sync.js — synchronisation de l'état de classe (P5) vers un dépôt Git privé.
   Documentation : typweb/doc/couche-prof.md (« Synchronisation ») et
   typweb/doc/mise-en-place-depot.md (dépôt et jeton, pas à pas).

   Principes
   - Local d'abord : rien n'attend le réseau ; la file d'attente se déduit du journal
     (événements dont l'identifiant n'est pas encore dans le dépôt).
   - Aucune donnée d'élève : seulement les événements de typweb.prof.v1.
   - Pas de serveur : API REST de GitHub appelée depuis le navigateur, jeton « fine-grained »
     limité à un seul dépôt (Contents : lecture et écriture).
   - Lots immuables : journal/AAAA-MM/<appareil>_<horodatage>.json ; un lot ne se modifie jamais.
   - Rien n'est actif sans jeton configuré sur l'appareil.
   - Le jeton n'est jamais écrit dans l'état, le journal, les exports, les messages d'erreur.

   Ce fichier est la copie de référence (typweb/site/js/sync.js) ; portail/pilotage/js/sync.js en est
   une copie identique (un test vérifie qu'elles ne divergent pas).
   ============================================================ */
(function (root, fabrique) {
  var m = fabrique(root);
  if (typeof module === "object" && module.exports) module.exports = m;
  else {
    root.TypwebSync = m;
    // Démarrage automatique dans une page : une seule instance par page (la page de pilotage charge
    // sync.js avant la couche prof, qui s'y rattache ensuite par `lier`).
    if (!root.typwebSync) {
      root.typwebSync = m.creer({ P: root.typwebProf || null });
      if (root.typwebProf) root.typwebProf.sync = root.typwebSync;
      root.typwebSync.demarrer();
    } else if (root.typwebProf && root.typwebSync.lier) {
      root.typwebSync.lier(root.typwebProf);
    }
  }
})(typeof window !== "undefined" ? window : this, function (racine) {
  "use strict";

  var CLE_ETAT = "typweb.sync.v1", CLE_JETON = "typweb.sync.jeton", CLE_LOT = "typweb.sync.lot",
      CLE_VERROU = "typweb.sync.verrou", CLE_CONFIG = "typweb.sync.config", CLE_JOURNAL = "typweb.prof.v1";
  var FORMAT_LOT = "typweb.sync.lot.v1", FORMAT_CLE = "typweb.sync.cle.v1";
  var CHEMIN_CONFIG = "config/pilotage.json";
  var MAX_LOT = 500, MAX_LOTS_PAR_PASSE = 20, SIMULTANES = 4, DELAI_REQUETE = 15000, VERROU_MS = 60000;
  var ITERATIONS_PBKDF2 = 250000;
  var RE_DEPOT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  var RE_LOT = /^journal\/\d{4}-\d{2}\/[^\/]+\.json$/;

  /* ---------- erreurs (messages en français, sans jamais citer le jeton) ---------- */
  function Erreur(code, message, extra) {
    var e = new Error(message);
    e.name = "SyncErreur"; e.code = code; e.transitoire = false;
    if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
    return e;
  }
  function slug(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function horodatageNom(t) {                                  // 2026-10-12T08-52-10Z
    var d = new Date(t);
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" +
      pad(d.getUTCHours()) + "-" + pad(d.getUTCMinutes()) + "-" + pad(d.getUTCSeconds()) + "Z";
  }
  function jourFr(t) {
    try { return new Date(t).toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" }); }
    catch (e) { return new Date(t).toISOString().slice(0, 10); }
  }
  function bonEvenement(e) {
    return !!e && typeof e.id === "string" && typeof e.t === "number" && typeof e.c === "string" &&
           typeof e.el === "string" && typeof e.a === "string";
  }
  function cmpEv(a, b) {                                       // même ordre que prof.js : (t, appareil, id), par points de code
    var da = String(a.d || ""), db = String(b.d || "");
    return a.t - b.t || (da < db ? -1 : da > db ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }

  /* ---------- base64 UTF-8 ---------- */
  function versB64(texte) {
    var o = new TextEncoder().encode(texte), s = "", i;
    for (i = 0; i < o.length; i += 0x8000) s += String.fromCharCode.apply(null, o.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function deB64(b64) {
    var s = atob(String(b64).replace(/\s+/g, "")), o = new Uint8Array(s.length), i;
    for (i = 0; i < s.length; i++) o[i] = s.charCodeAt(i);
    return new TextDecoder().decode(o);
  }
  function octetsB64(o) { var s = ""; for (var i = 0; i < o.length; i++) s += String.fromCharCode(o[i]); return btoa(s); }
  function b64Octets(b) { var s = atob(b), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  function encChemin(c) { return c.split("/").map(encodeURIComponent).join("/"); }

  function memoire() {                                          // repli si localStorage est absent (tests, mode privé)
    var d = {};
    return { getItem: function (k) { return k in d ? d[k] : null; }, setItem: function (k, v) { d[k] = String(v); }, removeItem: function (k) { delete d[k]; } };
  }

  /* ============================================================ */
  function creer(opt) {
    opt = opt || {};
    var stock = opt.stockage || (function () { try { return localStorage; } catch (e) { return memoire(); } })();
    var fetchF = opt.fetch || (typeof fetch === "function" ? fetch.bind(racine) : null);
    var API = (opt.api || "https://api.github.com").replace(/\/$/, "");
    var maintenant = opt.maintenant || function () { return Date.now(); };
    var enLigne = opt.enLigne || function () { return typeof navigator === "undefined" || navigator.onLine !== false; };
    var cryptoW = opt.crypto || (typeof crypto !== "undefined" ? crypto : null);
    var attendre = opt.attendre || function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    var P = opt.P || null;
    var abonnes = [], jetonMem = null, chaine = Promise.resolve(), enCours = false;
    var erreur = null, reseau = true, prochainEssai = 0, echecs = 0, minuteur = null, dernierEssai = 0, derniereReception = 0;
    var ID_VERROU = Math.random().toString(36).slice(2);

    /* ---------- stockage local ---------- */
    function lire(cle) { try { return stock.getItem(cle); } catch (e) { return null; } }
    function ecrire(cle, v) { try { stock.setItem(cle, v); return true; } catch (e) { return false; } }
    function suppr(cle) { try { stock.removeItem(cle); } catch (e) {} }
    function lireJson(cle) { var b = lire(cle); if (!b) return null; try { return JSON.parse(b); } catch (e) { return null; } }
    function ecrireJson(cle, v) { return ecrire(cle, JSON.stringify(v)); }

    function chargerEtat() {
      var j = lireJson(CLE_ETAT) || {};
      var ids = {};
      (Array.isArray(j.ids) ? j.ids : []).forEach(function (i) { ids[i] = 1; });
      return {
        v: 1, appareil: j.appareil || "", depot: j.depot || "", branche: j.branche || "main",
        lots: j.lots && typeof j.lots === "object" ? j.lots : {}, ids: ids, etag: j.etag || "", configSha: j.configSha || "",
        derniere: j.derniere || 0, intervalle: j.intervalle > 0 ? j.intervalle : 5
      };
    }
    function sauverEtat(e) {
      return ecrireJson(CLE_ETAT, { v: 1, appareil: e.appareil, depot: e.depot, branche: e.branche, lots: e.lots,
        ids: Object.keys(e.ids), etag: e.etag, configSha: e.configSha, derniere: e.derniere, intervalle: e.intervalle });
    }

    /* ---------- jeton ---------- */
    function jetonChiffre() { var b = lire(CLE_JETON); return !!b && b.charAt(0) === "{"; }
    function jeton() {
      var b = lire(CLE_JETON);
      if (!b) return null;
      if (b.charAt(0) === "{") return jetonMem;                  // chiffré : déverrouillé en mémoire seulement
      return b;
    }
    function cacher(texte) {                                      // aucun jeton dans un message
      var t = String(texte == null ? "" : texte), j = jeton();
      if (j && t.indexOf(j) >= 0) t = t.split(j).join("•••");
      return t.replace(/github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+/g, "•••");
    }
    function configure() { var e = chargerEtat(); return !!(e.depot && e.appareil && lire(CLE_JETON)); }

    /* ---------- HTTP ---------- */
    function traduire(res, contexte) {
      var s = res.status, h = res.headers, corps = {};
      try { corps = JSON.parse(res.texte || "{}"); } catch (e) {}
      var msgGH = cacher(corps && corps.message ? String(corps.message).slice(0, 200) : "");
      var restant = h("x-ratelimit-remaining"), retry = h("retry-after"), reset = h("x-ratelimit-reset");
      if (s === 401) return Erreur("jeton", "Jeton invalide ou expiré : crée-en un nouveau (voir « mise en place du dépôt et du jeton »).", { status: s });
      if (s === 429 || (s === 403 && (restant === "0" || retry || /rate limit|abuse/i.test(msgGH)))) {
        var ms = retry ? Number(retry) * 1000 : (reset ? Math.max(Number(reset) * 1000 - maintenant(), 0) : 60000);
        if (!(ms >= 0)) ms = 60000;
        return Erreur("limite", "Limite de requêtes GitHub atteinte : nouvel essai automatique dans " + Math.max(Math.ceil(ms / 60000), 1) + " min.",
          { status: s, transitoire: true, reprise: ms });
      }
      // 403 sans réponse JSON de GitHub : c'est un filtre (proxy, pare-feu de l'école), pas le jeton
      if (s === 403 && !reponseGitHub(res)) return Erreur("filtre", "Accès à GitHub bloqué par le réseau (filtre ou pare-feu de l'école) : la file d'attente est conservée, nouvel essai automatique.", { status: s, transitoire: true });
      if (s === 403) return Erreur("portee", "Jeton refusé : droits insuffisants (il faut « Contents : lecture et écriture » sur ce seul dépôt)." + (msgGH ? " [" + msgGH + "]" : ""), { status: s });
      if (s === 404) return Erreur("introuvable", "Dépôt introuvable : vérifie son nom, ou le jeton n'a pas accès à ce dépôt.", { status: s });
      if (s === 409 || s === 422) return Erreur("conflit", "Conflit d'écriture dans le dépôt" + (msgGH ? " (" + msgGH + ")" : "") + " : nouvel essai automatique.", { status: s, transitoire: true });
      if (s >= 500) return Erreur("serveur", "GitHub est indisponible (HTTP " + s + ") : nouvel essai automatique.", { status: s, transitoire: true });
      return Erreur("http", "Réponse inattendue de GitHub (HTTP " + s + ")" + (msgGH ? " : " + msgGH : "") + (contexte ? " [" + contexte + "]" : ""), { status: s });
    }
    // La réponse vient-elle de l'API GitHub (et pas d'un portail Wi-Fi ou d'un filtre) ?
    function reponseGitHub(res) {
      if (res.headers("x-github-request-id")) return true;
      var ct = String(res.headers("content-type") || "");
      if (/json/i.test(ct)) { try { JSON.parse(res.texte || ""); return true; } catch (e) { return false; } }
      return false;
    }
    function json(res, contexte) {                               // JSON d'une réponse 2xx, sinon erreur transitoire lisible
      try { return JSON.parse(res.texte); }
      catch (e) { throw Erreur("filtre", "Réponse illisible (portail Wi-Fi ou filtre de l'école ?)" + (contexte ? " [" + contexte + "]" : "") + " : nouvel essai automatique.", { transitoire: true }); }
    }
    // appel(methode, chemin, { corps, accept, etag, tolere:[statuts], jeton }) → { status, headers(nom), texte }
    async function appel(methode, chemin, o) {
      o = o || {};
      var tok = o.jeton || jeton();
      if (!tok) throw Erreur(jetonChiffre() ? "verrouille" : "jeton", jetonChiffre() ? "Jeton verrouillé : saisis la phrase secrète pour synchroniser." : "Aucun jeton configuré sur cet appareil.", { transitoire: false });
      if (!fetchF) throw Erreur("reseau", "Réseau indisponible dans ce navigateur.", { transitoire: true });
      var entetes = { "Authorization": "Bearer " + tok, "Accept": o.accept || "application/vnd.github+json" };   // pas d'en-tête non standard : moins de risque de blocage CORS
      if (o.corps !== undefined) entetes["Content-Type"] = "application/json";
      if (o.etag) entetes["If-None-Match"] = o.etag;
      var ctl = typeof AbortController === "function" ? new AbortController() : null, minut = null, rep;
      try {
        if (ctl) minut = setTimeout(function () { ctl.abort(); }, DELAI_REQUETE);
        rep = await fetchF(API + chemin, { method: methode, headers: entetes, body: o.corps !== undefined ? JSON.stringify(o.corps) : undefined,
                                             cache: "no-store", signal: ctl ? ctl.signal : undefined });
      } catch (e) {
        reseau = false;
        throw Erreur("reseau", "Pas de connexion à GitHub (hors ligne ou réseau de l'école bloqué) : la file d'attente est conservée.", { transitoire: true });
      } finally { if (minut) clearTimeout(minut); }
      reseau = true;
      var texte = "";
      try { texte = await rep.text(); } catch (e) {}
      var res = { status: rep.status, texte: texte, headers: function (n) { try { return rep.headers.get(n); } catch (e) { return null; } } };
      if (res.status >= 200 && res.status < 300) return res;
      if (o.tolere && o.tolere.indexOf(res.status) >= 0) return res;
      throw traduire(res, methode + " " + chemin.split("?")[0].replace(/^\/repos\/[^\/]+\/[^\/]+/, ""));
    }

    /* ---------- journal local (via la couche prof, sinon lecture seule du journal brut) ---------- */
    function evenements() {
      if (P) return P.evenements();
      var j = lireJson(CLE_JOURNAL);
      return j && Array.isArray(j.ev) ? j.ev : [];
    }
    function enAttenteListe(e) {
      e = e || chargerEtat();
      return evenements().filter(function (ev) { return bonEvenement(ev) && !e.ids[ev.id]; });
    }

    /* ---------- exclusion (même onglet, puis autres onglets) ---------- */
    function exclusif(fn) {
      var suite = chaine.then(function () {
        var v = lireJson(CLE_VERROU);
        if (v && v.id !== ID_VERROU && maintenant() - v.t < VERROU_MS) throw Erreur("occupe", "Une synchronisation est déjà en cours dans un autre onglet.", { transitoire: true });
        ecrireJson(CLE_VERROU, { id: ID_VERROU, t: maintenant() });
        enCours = true; notifier();
        return fn();
      }).then(function (r) { fin(); return r; }, function (err) { fin(); throw err; });
      chaine = suite.catch(function () {});
      return suite;
    }
    function fin() {
      enCours = false;
      var v = lireJson(CLE_VERROU);
      if (v && v.id === ID_VERROU) suppr(CLE_VERROU);
      notifier();
    }

    /* ---------- envoi ---------- */
    function creerLot(e, evs) {
      var t = maintenant(), nom, chemin;
      for (;;) {                                                  // nom unique pour cet appareil, à la seconde près
        nom = e.appareil + "_" + horodatageNom(t) + ".json";
        chemin = "journal/" + new Date(t).toISOString().slice(0, 7) + "/" + nom;
        if (!e.lots[chemin]) break;
        t += 1000;
      }
      var cree = new Date(t).toISOString();
      var tries = evs.slice().sort(cmpEv);                     // les événements sont envoyés tels quels (jamais complétés : même ordre partout)
      return { nom: nom, chemin: chemin, cree: cree, appareil: e.appareil,
               corps: { format: FORMAT_LOT, appareil: e.appareil, cree: cree, v: (P && P.version) || 2, ev: tries } };
    }
    function idsDe(lot) { return lot.corps.ev.map(function (x) { return x.id; }); }

    async function poserLot(e, lot) {
      var essais = 0, conflits = 0;
      for (;;) {
        var rep = await appel("PUT", "/repos/" + e.depot + "/contents/" + encChemin(lot.chemin),
          { corps: { message: "Lot " + lot.nom, content: versB64(JSON.stringify(lot.corps)), branch: e.branche }, tolere: [409, 422] });
        if (rep.status === 200 || rep.status === 201) return;
        if (rep.status === 409) {                                 // la branche a bougé entre-temps : on réessaie
          if (++conflits > 3) throw traduire(rep);
          await attendre(300 * conflits); continue;
        }
        // 422 : le fichier existe déjà. Soit c'est notre envoi interrompu (même contenu) : succès. Soit un autre lot : on change de nom.
        var ex = await appel("GET", "/repos/" + e.depot + "/contents/" + encChemin(lot.chemin) + "?ref=" + encodeURIComponent(e.branche),
          { accept: "application/vnd.github.raw+json", tolere: [404] });
        if (ex.status === 200) {
          var present = {};
          try { (JSON.parse(ex.texte).ev || []).forEach(function (x) { present[x.id] = 1; }); } catch (err) {}
          if (idsDe(lot).every(function (i) { return present[i]; })) return;
        }
        if (++essais > 5) throw traduire(rep);
        lot.nom = lot.nom.replace(/(-\d+)?\.json$/, "-" + (essais + 1) + ".json");
        lot.chemin = lot.chemin.replace(/[^\/]+$/, lot.nom);
        ecrireJson(CLE_LOT, lot);
      }
    }

    async function envoyerInterne() {
      var e = chargerEtat(), nbLots = 0, nbEv = 0;
      if (!e.depot) throw Erreur("config", "Dépôt non configuré.");
      for (var i = 0; i < MAX_LOTS_PAR_PASSE; i++) {
        var lot = lireJson(CLE_LOT);
        if (lot && !lot.corps) lot = null;
        if (!lot) {
          var file = enAttenteListe(e);
          if (!file.length) break;
          lot = creerLot(e, file.slice(0, MAX_LOT));
          ecrireJson(CLE_LOT, lot);                                 // le lot est figé avant l'envoi : un essai ultérieur le reprend tel quel
        }
        await poserLot(e, lot);
        e = chargerEtat();
        idsDe(lot).forEach(function (id) { e.ids[id] = 1; });
        e.lots[lot.chemin] = 1; e.derniere = maintenant();
        // Si l'état ne peut pas être enregistré (stockage plein), on s'arrête : sinon le même contenu repartirait à chaque passage.
        if (!sauverEtat(e)) throw Erreur("stockage", "Stockage de l'appareil plein : la synchronisation est suspendue (exporte l'état, puis libère de la place).");
        suppr(CLE_LOT);
        nbLots++; nbEv += lot.corps.ev.length;
      }
      return { lots: nbLots, evenements: nbEv };
    }

    /* ---------- réception ---------- */
    async function parallele(taches, n) {
      var res = new Array(taches.length), suivant = 0;
      async function ouvrier() {
        while (suivant < taches.length) { var k = suivant++; try { res[k] = { ok: true, v: await taches[k]() }; } catch (err) { res[k] = { ok: false, err: err }; } }
      }
      var ouvriers = []; for (var i = 0; i < Math.min(n, taches.length); i++) ouvriers.push(ouvrier());
      await Promise.all(ouvriers);
      return res;
    }
    async function recevoirInterne(o) {
      o = o || {};
      var e = chargerEtat();
      if (!e.depot) throw Erreur("config", "Dépôt non configuré.");
      var arbre = await appel("GET", "/repos/" + e.depot + "/git/trees/" + encodeURIComponent(e.branche) + "?recursive=1",
        { etag: o.tout ? null : e.etag, tolere: [304, 404, 409] });
      var bilan = { lotsNouveaux: 0, ajoutes: 0, ignores: 0, invalides: 0, lots: 0, evenements: 0, classes: [], de: null, a: null, tronque: false };
      if (arbre.status === 304) { derniereReception = maintenant(); return bilan; }
      if (arbre.status === 409) { derniereReception = maintenant(); return bilan; }   // dépôt vide
      if (arbre.status === 404) {
        var dep = await appel("GET", "/repos/" + e.depot, { tolere: [404] });
        if (dep.status === 404) throw traduire(dep);
        throw Erreur("introuvable", "Branche « " + e.branche + " » introuvable dans le dépôt.", { status: 404 });
      }
      var arb = json(arbre, "liste des lots");
      bilan.tronque = !!arb.truncated;
      var fichiers = (arb.tree || []).filter(function (t) { return t.type === "blob" && RE_LOT.test(t.path); });
      bilan.lots = fichiers.length;
      var nouveaux = fichiers.filter(function (t) { return o.tout || !e.lots[t.path]; });
      bilan.lotsNouveaux = nouveaux.length;
      var etagNouveau = arbre.headers("etag") || "";
      var dl = await parallele(nouveaux.map(function (t) {
        return function () {
          return appel("GET", "/repos/" + e.depot + "/contents/" + encChemin(t.path) + "?ref=" + encodeURIComponent(e.branche),
            { accept: "application/vnd.github.raw+json", tolere: [404] }).then(function (r) { return { chemin: t.path, rep: r }; });
        };
      }), SIMULTANES);
      var pris = [], echec = null, evs = [], idsVus = {};
      dl.forEach(function (r) {
        if (!r.ok) { echec = echec || r.err; return; }
        if (r.v.rep.status === 404) return;
        var lot;
        try { lot = JSON.parse(r.v.rep.texte); } catch (err) { bilan.invalides++; pris.push({ chemin: r.v.chemin, ids: [] }); return; }
        if (!lot || lot.format !== FORMAT_LOT || !Array.isArray(lot.ev)) { bilan.invalides++; pris.push({ chemin: r.v.chemin, ids: [] }); return; }
        var ids = [];
        lot.ev.forEach(function (x) {
          if (!bonEvenement(x)) { bilan.invalides++; return; }
          ids.push(x.id);
          if (!idsVus[x.id]) { idsVus[x.id] = 1; evs.push(x); }
        });
        pris.push({ chemin: r.v.chemin, ids: ids });
      });
      if (evs.length) {
        if (!P) throw Erreur("prof", "Couche prof indisponible : impossible de fusionner pour l'instant.", { transitoire: true });
        var imp = P.importer({ format: "typweb.prof.v1", exporte: new Date(maintenant()).toISOString(), v: P.version || 2, ev: evs });
        if (!imp.ok) throw Erreur("import", "Fusion impossible : " + cacher(imp.erreur), {});
        bilan.ajoutes = imp.ajoutes; bilan.ignores = imp.ignores;
        evs.forEach(function (x) {
          if (bilan.classes.indexOf(x.c) < 0) bilan.classes.push(x.c);
          if (bilan.de === null || x.t < bilan.de) bilan.de = x.t;
          if (bilan.a === null || x.t > bilan.a) bilan.a = x.t;
        });
        bilan.classes.sort();
      }
      bilan.evenements = evs.length;
      e = chargerEtat();
      pris.forEach(function (p) { e.lots[p.chemin] = 1; p.ids.forEach(function (i) { e.ids[i] = 1; }); });
      if (!echec) e.etag = etagNouveau;                              // l'ETag n'est retenu que si tout a été lu
      sauverEtat(e);
      derniereReception = maintenant();
      if (echec) throw echec;
      return bilan;
    }

    /* ---------- configuration (config/pilotage.json du dépôt) ---------- */
    // → { texte, sha, change } ; texte = null si le fichier n'existe pas dans le dépôt.
    async function configDepotInterne(o) {
      o = o || {};
      var e = chargerEtat();
      if (!e.depot) throw Erreur("config", "Dépôt non configuré.");
      var r = await appel("GET", "/repos/" + e.depot + "/contents/" + CHEMIN_CONFIG + "?ref=" + encodeURIComponent(e.branche), { tolere: [404] });
      if (r.status === 404) return { texte: null, sha: null, change: false };
      var j = json(r, "configuration"), texte = deB64(j.content || "");
      var change = j.sha !== e.configSha;
      e.configSha = j.sha; sauverEtat(e);
      ecrire(CLE_CONFIG, texte);
      return { texte: texte, sha: j.sha, change: change };
    }
    async function publierConfigInterne(texte) {
      var e = chargerEtat();
      if (!e.depot) throw Erreur("config", "Dépôt non configuré.");
      try { JSON.parse(texte); } catch (err) { throw Erreur("config", "La configuration n'est pas un JSON valide : rien n'est envoyé."); }
      var ex = await appel("GET", "/repos/" + e.depot + "/contents/" + CHEMIN_CONFIG + "?ref=" + encodeURIComponent(e.branche), { tolere: [404] });
      var corps = { message: "Configuration du pilotage", content: versB64(texte), branch: e.branche };
      if (ex.status === 200) corps.sha = json(ex, "configuration").sha;
      var r = await appel("PUT", "/repos/" + e.depot + "/contents/" + CHEMIN_CONFIG, { corps: corps });
      var sha = json(r, "configuration").content.sha;
      e = chargerEtat(); e.configSha = sha; sauverEtat(e); ecrire(CLE_CONFIG, texte);
      return { sha: sha };
    }

    /* ---------- lecture d'un fichier du dépôt (banques de classe : banques/<UAA>/classe.json) ---------- */
    // → texte du fichier ; rejette (SyncErreur) s'il est absent, si le jeton manque ou si le réseau est coupé.
    // Lecture seule, hors file d'attente : n'attend pas une synchronisation en cours.
    async function lireFichierInterne(chemin) {
      var e = chargerEtat();
      if (!e.depot) throw Erreur("config", "Dépôt non configuré.");
      if (!/^[A-Za-z0-9_.\/-]+$/.test(chemin) || chemin.indexOf("..") >= 0) throw Erreur("config", "Chemin invalide : " + chemin);
      var r = await appel("GET", "/repos/" + e.depot + "/contents/" + encChemin(chemin) + "?ref=" + encodeURIComponent(e.branche),
        { accept: "application/vnd.github.raw+json", tolere: [404] });
      if (r.status === 404) throw Erreur("absent", "« " + chemin + " » n'existe pas dans le dépôt.", { status: 404 });
      return r.texte;
    }

    /* ---------- pilotage des opérations : erreurs, reprises, état ---------- */
    function noter(err) {
      // une exception inattendue (pas une SyncErreur) n'est pas une erreur de configuration : on réessaie
      if (!err || err.name !== "SyncErreur") err = Erreur("inconnue", "Erreur inattendue : " + (err && err.message ? err.message : String(err)) + " (nouvel essai automatique).", { transitoire: true });
      erreur = { code: err.code || "inconnue", message: cacher(err.message), quand: maintenant(), transitoire: !!err.transitoire };
      if (err.code === "reseau") { /* hors ligne : ce n'est pas une panne à afficher en rouge */ }
      if (err.transitoire) {
        echecs++;
        var delai = err.reprise != null ? err.reprise : Math.min(600000, 30000 * Math.pow(2, Math.min(echecs - 1, 5)));
        prochainEssai = maintenant() + delai;
      } else { prochainEssai = Infinity; }                         // erreur de configuration : pas de réessai automatique
    }
    function reussi() { erreur = null; echecs = 0; prochainEssai = 0; }
    async function operation(fn) {
      dernierEssai = maintenant();
      try { var r = await exclusif(fn); reussi(); notifier(); return r; }
      catch (err) { if (err.code !== "occupe" && err.code !== "verrouille") noter(err); notifier(); throw err; }
    }

    var api = {
      /* --- configuration de l'appareil --- */
      // { jeton, depot, appareil, branche?, intervalle?, phrase? } ; la phrase (facultative) chiffre le jeton.
      configurer: async function (c) {
        var depot = String(c.depot || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
        if (!RE_DEPOT.test(depot)) throw Erreur("config", "Nom de dépôt invalide : écris « compte/suivi-classes ».");
        var appareil = slug(c.appareil);
        if (!appareil) throw Erreur("config", "Donne un nom à l'appareil (par exemple « tablette »).");
        var tok = c.jeton ? String(c.jeton).trim() : jeton();
        if (!tok) throw Erreur("jeton", "Colle le jeton (il commence par « github_pat_ »).");
        if (/^gh[pousr]_/.test(tok)) throw Erreur("jeton", "Ce jeton est un jeton « classique » (accès à tous tes dépôts) : crée un jeton « fine-grained » limité à ce seul dépôt.");
        if (!/^github_pat_[A-Za-z0-9_]{20,}$/.test(tok)) throw Erreur("jeton", "Ce jeton n'a pas la forme attendue (« github_pat_… »).");
        var e = chargerEtat();
        if (e.depot && e.depot !== depot) { e.lots = {}; e.ids = {}; e.etag = ""; e.configSha = ""; }
        e.depot = depot; e.appareil = appareil; e.branche = c.branche || e.branche || "main";
        if (c.intervalle > 0) e.intervalle = c.intervalle;
        if (c.phrase) await api.chiffrerJeton(tok, c.phrase);            // aussi pour chiffrer un jeton déjà enregistré
        else if (c.jeton) { ecrire(CLE_JETON, tok); jetonMem = null; }
        sauverEtat(e); reussi(); notifier();
        return { depot: depot, appareil: appareil };
      },
      // Vérifie : dépôt accessible et privé, droit d'écriture, jeton fine-grained limité à ce seul dépôt.
      tester: async function (c) {
        c = c || {};
        var e = chargerEtat(), depot = (c.depot || e.depot || "").trim(), tok = c.jeton || jeton(), etapes = [];
        function etape(ok, texte) { etapes.push({ ok: ok, texte: texte }); return ok; }
        try {
          if (!RE_DEPOT.test(depot)) throw Erreur("config", "Nom de dépôt invalide : écris « compte/suivi-classes ».");
          if (!tok) throw Erreur("jeton", "Aucun jeton à tester.");
          if (/^gh[pousr]_/.test(tok)) { etape(false, "Jeton « classique » refusé : il donnerait accès à tous tes dépôts."); return { ok: false, etapes: etapes, erreur: "Jeton classique : crée un jeton fine-grained." }; }
          var r = await appel("GET", "/repos/" + depot, { jeton: tok });
          var d = json(r, "dépôt");
          etape(true, "Dépôt « " + (d.full_name || depot) + " » accessible.");
          if (r.headers("x-oauth-scopes") !== null && r.headers("x-oauth-scopes") !== undefined) {
            etape(false, "Jeton « classique » (portées : " + (r.headers("x-oauth-scopes") || "aucune") + ") : refusé.");
            return { ok: false, etapes: etapes, erreur: "Jeton classique : crée un jeton fine-grained limité à ce dépôt." };
          }
          if (!etape(d.private === true, d.private === true ? "Le dépôt est privé." : "Le dépôt est PUBLIC : les données seraient visibles de tous. Passe-le en privé.")) return { ok: false, etapes: etapes, erreur: "Dépôt public." };
          var perm = d.permissions || {};
          if (!etape(perm.push === true, perm.push === true ? "Droit d'écriture sur le contenu : oui." : "Pas de droit d'écriture : le jeton doit avoir « Contents : lecture et écriture ».")) return { ok: false, etapes: etapes, erreur: "Écriture refusée." };
          // Un jeton fine-grained lit TOUJOURS les dépôts publics (lecture seule, comme sans jeton) : GitHub les
          // liste aussi. Seuls comptent les AUTRES dépôts PRIVÉS : ceux-là, le jeton ne doit pas y accéder.
          var u = await appel("GET", "/user/repos?per_page=100", { jeton: tok, tolere: [403] });
          if (u.status === 200) {
            var autres = json(u, "dépôts").filter(function (x) { return x.full_name !== d.full_name && x.private === true; })
              .map(function (x) { return x.full_name; });
            if (!etape(!autres.length, !autres.length ? "Le jeton ne donne accès qu'à ce dépôt privé (les dépôts publics restent lisibles par tous)."
                : "Le jeton donne aussi accès à d'autres dépôts privés (" + autres.slice(0, 3).join(", ") + (autres.length > 3 ? "…" : "") +
                  ") : dans « Repository access », choisis « Only select repositories » et seulement « " + d.full_name.split("/")[1] + " »."))
              return { ok: false, etapes: etapes, erreur: "Jeton trop large." };
          } else etape(true, "Portée : liste des dépôts non vérifiable avec ce jeton (acceptable).");
          return { ok: true, etapes: etapes };
        } catch (err) {
          etape(false, cacher(err.message));
          return { ok: false, etapes: etapes, erreur: cacher(err.message), code: err.code };
        }
      },
      oublierJeton: function () {
        suppr(CLE_JETON); jetonMem = null;
        erreur = null; prochainEssai = Infinity; notifier();
        return true;
      },
      // Oublie aussi l'état de synchronisation (dépôt, appareil, lots connus) : l'appareil redevient « non configuré ».
      reinitialiser: function () {
        api.oublierJeton(); suppr(CLE_ETAT); suppr(CLE_LOT); suppr(CLE_CONFIG); suppr(CLE_VERROU); notifier();
        return true;
      },
      estConfigure: configure,
      infos: function () { var e = chargerEtat(); return { depot: e.depot, appareil: e.appareil, branche: e.branche, intervalle: e.intervalle, chiffre: jetonChiffre(), verrouille: jetonChiffre() && !jetonMem, jeton: !!lire(CLE_JETON) }; },

      /* --- chiffrement facultatif du jeton (phrase secrète, WebCrypto) --- */
      chiffrerJeton: async function (tok, phrase) {
        if (!cryptoW || !cryptoW.subtle) throw Erreur("crypto", "Le chiffrement n'est pas disponible dans ce navigateur (page non sécurisée ?).");
        if (!phrase || String(phrase).length < 8) throw Erreur("crypto", "Phrase secrète trop courte (8 caractères au moins).");
        tok = tok || jeton();
        if (!tok) throw Erreur("jeton", "Aucun jeton à chiffrer.");
        var sel = cryptoW.getRandomValues(new Uint8Array(16)), iv = cryptoW.getRandomValues(new Uint8Array(12));
        var cle = await derivee(phrase, sel);
        var ct = new Uint8Array(await cryptoW.subtle.encrypt({ name: "AES-GCM", iv: iv }, cle, new TextEncoder().encode(tok)));
        ecrire(CLE_JETON, JSON.stringify({ v: 1, chiffre: true, iter: ITERATIONS_PBKDF2, sel: octetsB64(sel), iv: octetsB64(iv), ct: octetsB64(ct) }));
        jetonMem = tok; notifier();
        return true;
      },
      deverrouiller: async function (phrase) {
        var b = lireJson(CLE_JETON);
        if (!b || !b.chiffre) return true;
        try {
          var cle = await derivee(phrase, b64Octets(b.sel), b.iter);
          var clair = await cryptoW.subtle.decrypt({ name: "AES-GCM", iv: b64Octets(b.iv) }, cle, b64Octets(b.ct));
          jetonMem = new TextDecoder().decode(clair);
        } catch (err) { throw Erreur("phrase", "Phrase secrète incorrecte."); }
        notifier();
        return true;
      },
      verrouiller: function () { jetonMem = null; notifier(); },
      // Retire le chiffrement (le jeton est de nouveau stocké en clair sur l'appareil).
      dechiffrerJeton: function () { if (!jetonMem) throw Erreur("verrouille", "Déverrouille d'abord le jeton."); ecrire(CLE_JETON, jetonMem); notifier(); return true; },

      /* --- clé de synchronisation : un fichier qui remet l'appareil en service (navigateur qui efface ses données) ---
         Le jeton y est chiffré par une phrase secrète (PBKDF2-SHA256 puis AES-GCM, le dépôt sert de données associées) ;
         le dépôt et le nom d'appareil sont en clair. Le fichier reste sur l'appareil ou une clé USB : jamais dans un dépôt. */
      exporterCle: async function (phrase) {
        if (!cryptoW || !cryptoW.subtle) throw Erreur("crypto", "Le chiffrement n'est pas disponible dans ce navigateur (page non sécurisée ?).");
        if (!phrase || String(phrase).length < 8) throw Erreur("crypto", "Phrase secrète trop courte (8 caractères au moins).");
        var e = chargerEtat(), tok = jeton();
        if (!e.depot || !lire(CLE_JETON)) throw Erreur("jeton", "La synchronisation n'est pas configurée sur cet appareil : rien à enregistrer.");
        if (!tok) throw Erreur("verrouille", "Déverrouille d'abord le jeton (phrase secrète de l'appareil).");
        var sel = cryptoW.getRandomValues(new Uint8Array(16)), iv = cryptoW.getRandomValues(new Uint8Array(12));
        var cle = await derivee(phrase, sel);
        var ct = new Uint8Array(await cryptoW.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: donneesAssociees(e.depot) }, cle, new TextEncoder().encode(tok)));
        return JSON.stringify({ format: FORMAT_CLE, cree: new Date(maintenant()).toISOString(), depot: e.depot, appareil: e.appareil,
          branche: e.branche, intervalle: e.intervalle,
          jeton: { kdf: "PBKDF2-SHA256", chiffre: "AES-GCM", iter: ITERATIONS_PBKDF2, sel: octetsB64(sel), iv: octetsB64(iv), ct: octetsB64(ct) },
          note: "Clé de synchronisation du pilotage. Le jeton est chiffré par ta phrase secrète. Ne place pas ce fichier dans un dépôt ni dans un dossier publié." }, null, 1);
      },
      // Lit une clé sans la déchiffrer (pour l'afficher) : { depot, appareil, cree } ; erreur « cle » si le fichier n'en est pas une.
      lireCle: function (texte) { var k = lireCleObj(texte); return { depot: k.depot, appareil: k.appareil, cree: k.cree || "" }; },
      // Déchiffre la clé et configure l'appareil. o : { appareil?, garderChiffre? } (garderChiffre : le jeton reste chiffré
      // sur l'appareil par la même phrase, à saisir à chaque session).
      importerCle: async function (texte, phrase, o) {
        o = o || {};
        var k = lireCleObj(texte), tok;
        if (!cryptoW || !cryptoW.subtle) throw Erreur("crypto", "Le chiffrement n'est pas disponible dans ce navigateur (page non sécurisée ?).");
        try {
          var cle = await derivee(phrase, b64Octets(k.jeton.sel), k.jeton.iter);
          tok = new TextDecoder().decode(await cryptoW.subtle.decrypt({ name: "AES-GCM", iv: b64Octets(k.jeton.iv), additionalData: donneesAssociees(k.depot) }, cle, b64Octets(k.jeton.ct)));
        } catch (err) { throw Erreur("phrase", "Phrase secrète incorrecte (ou clé abîmée)."); }
        return api.configurer({ jeton: tok, depot: k.depot, appareil: o.appareil || k.appareil, branche: k.branche,
                                intervalle: k.intervalle, phrase: o.garderChiffre ? phrase : undefined });
      },

      /* --- opérations --- */
      enAttente: function () { return enAttenteListe().length; },
      envoyer: function () { return operation(envoyerInterne); },
      recevoir: function (o) { return operation(function () { return recevoirInterne(o); }); },
      // Envoi puis réception ; ne rejette jamais (l'erreur est dans statut()).
      synchroniser: function (o) {
        return operation(async function () {
          var a = await envoyerInterne(), b = await recevoirInterne(o);
          return { envoyes: a, recus: b };
        }).then(function (r) { return Object.assign({ ok: true }, r); }, function (err) { return { ok: false, erreur: cacher(err.message), code: err.code }; });
      },
      // Reconstitue l'état depuis le dépôt (appareil neuf) : fusion de TOUS les lots et de la configuration.
      restaurer: function () {
        return operation(async function () {
          var e = chargerEtat(); e.lots = {}; e.ids = {}; e.etag = ""; sauverEtat(e);
          var bilan = await recevoirInterne({ tout: true });
          var cfg = null;
          try { cfg = await configDepotInterne(); } catch (err) { /* la configuration est facultative */ }
          bilan.configuration = !!(cfg && cfg.texte);
          bilan.deJour = bilan.de === null ? null : jourFr(bilan.de);
          bilan.aJour = bilan.a === null ? null : jourFr(bilan.a);
          return bilan;
        });
      },
      configDepot: function (o) { return operation(function () { return configDepotInterne(o); }); },
      configLocale: function () { return lire(CLE_CONFIG); },
      // Lit un fichier du dépôt privé (banque de classe…) ; rejette si indisponible. Ne touche pas à l'état affiché.
      lireFichier: function (chemin) {
        if (!configure()) return Promise.reject(Erreur("config", "Synchronisation non configurée sur cet appareil."));
        if (!enLigne()) return Promise.reject(Erreur("reseau", "Hors ligne.", { transitoire: true }));
        return lireFichierInterne(chemin);
      },
      // La couche prof liée (ou null) : la page de pilotage vérifie qu'elle est assez récente (P5).
      couche: function () { return P; },
      publierConfig: function (texte) { return operation(function () { return publierConfigInterne(texte); }); },
      finSeance: function () { return api.synchroniser(); },

      /* --- état affiché --- */
      statut: function () {
        if (!configure()) return { etat: "inactif", texte: "Synchronisation non configurée", n: 0, detail: ["Aucun jeton sur cet appareil : rien n'est envoyé."] };
        var e = chargerEtat(), n = enAttenteListe(e).length, etat, texte;
        var hors = !enLigne() || (erreur && erreur.code === "reseau");
        if (jetonChiffre() && !jetonMem && !(erreur && !erreur.transitoire)) { etat = "verrouille"; texte = n ? "À synchroniser (" + n + ") · jeton verrouillé" : "Jeton verrouillé"; }
        else if (erreur && erreur.code !== "reseau") { etat = "erreur"; texte = "Erreur : " + erreur.message; }
        else if (hors) { etat = "hors-ligne"; texte = "Hors ligne" + (n ? " · " + n + " en attente" : ""); }
        else if (enCours) { etat = "en-cours"; texte = "Synchronisation…"; }
        else if (n > 0) { etat = "a-synchroniser"; texte = "À synchroniser (" + n + ")"; }
        else { etat = "synchronise"; texte = "Synchronisé"; }
        var detail = ["Dépôt : " + e.depot + " (branche " + e.branche + ")", "Appareil : " + e.appareil,
          "File d'attente : " + n + " événement(s)", "Lots connus : " + Object.keys(e.lots).length,
          "Dernier envoi : " + (e.derniere ? new Date(e.derniere).toLocaleString("fr-BE") : "jamais")];
        if (erreur) detail.push("Dernière erreur : " + erreur.message + (erreur.transitoire && isFinite(prochainEssai) ? " — nouvel essai vers " + new Date(prochainEssai).toLocaleTimeString("fr-BE") : ""));
        return { etat: etat, texte: texte, n: n, detail: detail };
      },
      abonner: function (f) { abonnes.push(f); return function () { abonnes = abonnes.filter(function (g) { return g !== f; }); }; },

      /* --- cycle de vie --- */
      lier: function (couche) {
        if (P === couche) return;
        P = couche;
        if (P && P.abonner) P.abonner(function () { notifier(); });
        if (P) P.sync = api;
        notifier();
        if (configure() && enLigne() && jeton()) api.synchroniser();
      },
      demarrer: function () {
        if (minuteur || typeof window === "undefined") return;
        if (P && P.abonner) P.abonner(function () { notifier(); });
        window.addEventListener("online", function () { prochainEssai = 0; if (configure() && jeton()) api.synchroniser(); notifier(); });
        window.addEventListener("offline", notifier);
        document.addEventListener("visibilitychange", function () {
          if (document.visibilityState === "hidden" && configure() && enLigne() && jeton() && enAttenteListe().length) api.envoyer().catch(function () {});
        });
        minuteur = setInterval(tic, 30000);
        if (configure() && enLigne() && jeton()) setTimeout(function () { api.synchroniser(); }, 1500);
      },
      arreter: function () { if (minuteur) clearInterval(minuteur); minuteur = null; }
    };

    function donneesAssociees(depot) { return new TextEncoder().encode(FORMAT_CLE + "|" + depot); }
    function lireCleObj(texte) {
      var k = null;
      try { k = typeof texte === "string" ? JSON.parse(texte) : texte; } catch (e) { k = null; }
      var j = k && k.jeton;
      if (!k || k.format !== FORMAT_CLE || !RE_DEPOT.test(String(k.depot || "")) || !j || typeof j.sel !== "string" || typeof j.iv !== "string" ||
          typeof j.ct !== "string" || !(j.iter >= 100000 && j.iter <= 5000000))
        throw Erreur("cle", "Ce fichier n'est pas une clé de synchronisation du pilotage.");
      return k;
    }
    async function derivee(phrase, sel, iter) {
      var base = await cryptoW.subtle.importKey("raw", new TextEncoder().encode(String(phrase)), "PBKDF2", false, ["deriveKey"]);
      return cryptoW.subtle.deriveKey({ name: "PBKDF2", salt: sel, iterations: iter || ITERATIONS_PBKDF2, hash: "SHA-256" }, base,
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }
    function notifier() { abonnes.slice().forEach(function (f) { try { f(api.statut()); } catch (e) {} }); }
    // Toutes les 30 s : envoie la file toutes les N minutes, relit le dépôt toutes les N minutes, si connecté et sans erreur bloquante.
    function tic() {
      if (!configure() || !enLigne() || !jeton() || enCours || maintenant() < prochainEssai) return;
      var e = chargerEtat(), periode = e.intervalle * 60000;
      if (maintenant() - dernierEssai < periode) return;
      api.synchroniser();
    }
    return api;
  }

  return { creer: creer, slug: slug, FORMAT_LOT: FORMAT_LOT, FORMAT_CLE: FORMAT_CLE, CLES: { etat: CLE_ETAT, jeton: CLE_JETON, lot: CLE_LOT, config: CLE_CONFIG } };
});
