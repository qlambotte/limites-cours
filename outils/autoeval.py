"""
autoeval.py — partie « S'autoévaluer » du site, GÉNÉRIQUE (aucun contenu
propre à un cours ici).

Conventions (dans le dossier des notes) :
  <principal>-autoeval.typ : la banque (#let banque = …, #let questionnaires = …),
                             écrite avec autoeval-lib.typ (qcm, ouverte,
                             questionnaire, verifier) ;
  objectifs.typ            : la grille ; chaque objectif est un appel
                             puce("A2")[texte] ;
  titres « == … <sec-…> »  : le label identifie la section (les questions
                             y renvoient par  section: <sec-…>).

Produit :
  - autoeval.qmd : l'application (div #ae-app) + la banque rendue en
    Markdown, cachée (lue par js/autoeval.js) ;
  - pour chaque section qui a des questions, un lien « S'autoévaluer sur
    cette section » (voir lien_section) ;
  - des avertissements dans _rapport.txt (typst_mini.avert).
"""
import json
import os
import re

import typst_mini as T
from typst_mini import N, Builtin, Label, avert

NB_FAUSSES = 3            # QCM : 4 propositions (1 bonne + 3 fausses)
NIVEAUX = (1, 2, 3)
FORMES = ("courte", "longue")
TYPES = ("qcm", "ouverte")
CATEGORIES = {"C": "Connaître", "A": "Appliquer", "T": "Transférer"}


# =====================================================================
#  Constructeurs (mêmes noms et mêmes contrôles que autoeval-lib.typ)
# =====================================================================
def _liste(v):
    if v is None:
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


def _commun(quoi, a):
    ident = a.get("id")
    if not isinstance(ident, str) or not ident:
        avert("autoéval : %s sans « id »" % quoi)
        return None
    q = {"id": ident, "section": a.get("section"), "obj": [str(o) for o in _liste(a.get("obj"))],
         "niveau": a.get("niveau", 1), "enonce": a.get("enonce")}
    ou = "autoéval : %s « %s »" % (quoi, ident)
    ok = True
    if not isinstance(q["section"], (Label, str)) or not q["section"]:
        avert(ou + " : « section » manquante"); ok = False
    if not q["obj"]:
        avert(ou + " : « obj » manquant"); ok = False
    if q["niveau"] not in NIVEAUX:
        avert(ou + " : « niveau » vaut 1, 2 ou 3"); ok = False
    if q["enonce"] is None:
        avert(ou + " : « enonce » manquant"); ok = False
    q["section"] = str(q["section"]) if q["section"] else None
    return q if ok else None


def _prop(ou, p, rang):
    if not isinstance(p, dict) or "r" not in p or "fb" not in p:
        avert(ou + " : la proposition %s doit être (r: […], fb: […])" % rang)
        return None
    return {"r": p["r"], "fb": p["fb"]}


def f_qcm(a, I):
    q = _commun("qcm", a)
    if q is None:
        return None
    ou = "autoéval : qcm « %s »" % q["id"]
    bonne = _prop(ou, a.get("bonne"), "bonne")
    fausses = _liste(a.get("fausses"))
    if len(fausses) != NB_FAUSSES:
        avert(ou + " : il faut exactement %d propositions fausses (%d en tout)" % (NB_FAUSSES, NB_FAUSSES + 1))
        return None
    fausses = [_prop(ou, p, "fausse %d" % (k + 1)) for k, p in enumerate(fausses)]
    ordre = a.get("ordre", "melange")
    if bonne is None or None in fausses or ordre not in ("melange", "fixe"):
        return None
    q.update(type="qcm", bonne=bonne, fausses=fausses, ordre=ordre)
    return q


def f_ouverte(a, I):
    q = _commun("ouverte", a)
    if q is None:
        return None
    ou = "autoéval : ouverte « %s »" % q["id"]
    forme = a.get("forme", "longue")
    criteres = _liste(a.get("criteres"))
    if forme not in FORMES:
        avert(ou + " : forme = \"courte\" ou \"longue\""); return None
    if a.get("reponse") is None:
        avert(ou + " : réponse type manquante"); return None
    if len(criteres) < 2:
        avert(ou + " : il faut au moins 2 critères"); return None
    q.update(type="ouverte", forme=forme, reponse=a.get("reponse"), criteres=criteres)
    return q


def f_questionnaire(a, I):
    ident = a.get("id")
    if not isinstance(ident, str) or not ident:
        avert("autoéval : questionnaire sans « id »"); return None
    qs, tirage = a.get("questions"), a.get("tirage")
    if (qs is None) == (tirage is None):
        avert("autoéval : questionnaire « %s » : donner SOIT questions, SOIT tirage" % ident); return None
    if tirage is not None and (not isinstance(tirage, dict) or "nombre" not in tirage):
        avert("autoéval : questionnaire « %s » : tirage sans « nombre »" % ident); return None
    t = None
    if tirage is not None:
        t = {"nombre": int(tirage["nombre"]),
             "sections": [str(s) for s in _liste(tirage.get("sections"))],
             "obj": [str(o) for o in _liste(tirage.get("obj"))],
             "types": [str(o) for o in _liste(tirage.get("types"))],
             "niveaux": [int(n) for n in _liste(tirage.get("niveaux"))]}
    return {"type": "questionnaire", "id": ident, "titre": a.get("titre"),
            "description": a.get("description"),
            "questions": [str(x) for x in qs] if qs is not None else None, "tirage": t}


def f_verifier(a, I):
    return [q for q in _liste(a.pos[0] if a.pos else None) if q is not None]


def builtins():
    return {"qcm": Builtin("qcm", f_qcm), "ouverte": Builtin("ouverte", f_ouverte),
            "questionnaire": Builtin("questionnaire", f_questionnaire),
            "verifier": Builtin("verifier", f_verifier),
            "apercu": Builtin("apercu", lambda a, I: None)}


# =====================================================================
#  Lecture
# =====================================================================
def _crochets(src, i):
    """src[i] == '[' : renvoie l'indice du ']' correspondant."""
    prof = 0
    while i < len(src):
        c = src[i]
        if c == "\\":
            i += 2; continue
        if c == "[":
            prof += 1
        elif c == "]":
            prof -= 1
            if prof == 0:
                return i
        i += 1
    return -1


def lire_objectifs(I, chemin):
    """[(code, contenu N)] dans l'ordre de la grille."""
    if not os.path.exists(chemin):
        avert("autoéval : %s absent : objectifs sans intitulé" % os.path.basename(chemin))
        return []
    src = open(chemin, encoding="utf-8").read()
    res = []
    for m in re.finditer(r'puce\(\s*"([^"]+)"\s*\)\s*\[', src):
        j = _crochets(src, m.end() - 1)
        corps = src[m.end():j]
        try:
            n = I.fichier(corps, "objectifs", T.Env(I.globals))
        except Exception:
            n = N("texte", s=re.sub(r"[_*]", "", corps))
        res.append((m.group(1), n))
    return res


def lire_banque(I, chemin):
    """(banque, questionnaires) ; ([], []) si le fichier n'existe pas."""
    if not os.path.exists(chemin):
        return [], []
    env = T.Env(I.globals)
    env.d.update(builtins())
    try:
        I.fichier(open(chemin, encoding="utf-8").read(), os.path.basename(chemin), env)
    except T.ErreurTypst as e:
        avert("autoéval : %s illisible : %s" % (os.path.basename(chemin), e))
        return [], []
    try:
        banque = env.get("banque")
    except KeyError:
        avert("autoéval : %s ne définit pas « banque »" % os.path.basename(chemin))
        return [], []
    try:
        qa = env.get("questionnaires")
    except KeyError:
        qa = []
    return [q for q in _liste(banque) if q], [q for q in _liste(qa) if q]


def controler(banque, questionnaires, sections, objectifs):
    """Contrôles croisés ; renvoie la banque nettoyée (questions valides)."""
    codes = {c for c, _ in objectifs}
    vus, bonne = set(), []
    for q in banque:
        ou = "autoéval : « %s »" % q["id"]
        if q["id"] in vus:
            avert(ou + " : identifiant en double (seule la 1re est gardée)"); continue
        vus.add(q["id"])
        if q["section"] not in sections:
            avert(ou + " : section <%s> inconnue (label d'un titre == des notes ?)" % q["section"]); continue
        inconnus = [o for o in q["obj"] if codes and o not in codes]
        if inconnus:
            avert(ou + " : objectif(s) absent(s) de la grille : %s" % ", ".join(inconnus))
        bonne.append(q)
    ids = {q["id"] for q in bonne}
    for qa in questionnaires:
        if qa["questions"]:
            manque = [x for x in qa["questions"] if x not in ids]
            if manque:
                avert("autoéval : questionnaire « %s » : question(s) inconnue(s) : %s" % (qa["id"], ", ".join(manque)))
                qa["questions"] = [x for x in qa["questions"] if x in ids]
        else:
            t = qa["tirage"]
            for s in t["sections"]:
                if s not in sections:
                    avert("autoéval : questionnaire « %s » : section <%s> inconnue" % (qa["id"], s))
    # couverture : chaque objectif a-t-il au moins une question ?
    couverts = {o for q in bonne for o in q["obj"]}
    for c, _ in objectifs:
        if c not in couverts:
            avert("autoéval : aucune question pour l'objectif %s" % c)
    return bonne


# =====================================================================
#  Émission
# =====================================================================
def _attr(v):
    return str(v).replace('"', "&quot;")


def page(rendre, banque, questionnaires, sections, objectifs, cle_site):
    """rendre(contenu N, bloc=True) → Markdown.
    sections : {label: {"titre": N, "chap": int, "url": str}} dans l'ordre du cours."""
    L = ['---\ntitle: "S\'autoévaluer"\nsearch: false\n---\n',
         "<!-- GÉNÉRÉ par outils/typ2site.py (autoeval.py) : NE PAS ÉDITER. -->\n",
         "::: {#ae-app data-cle=\"%s\"}\n::: {.ae-attente}\nChargement…\n:::\n:::\n" % _attr(cle_site),
         "::: {#ae-banque .ae-cache}"]
    # sections
    for lab, s in sections.items():
        n = sum(1 for q in banque if q["section"] == lab)
        L.append('::: {.ae-sec data-id="%s" data-chap="%s" data-url="%s" data-n="%d"}\n%s\n:::'
                 % (_attr(lab), s["chap"], _attr(s["url"]), n, rendre(s["titre"], False)))
    # objectifs
    for code, n in objectifs:
        L.append('::: {.ae-obj data-code="%s" data-cat="%s"}\n%s\n:::'
                 % (_attr(code), _attr(CATEGORIES.get(code[:1], "")), rendre(n, False)))
    # questionnaires
    for qa in questionnaires:
        spec = {"questions": qa["questions"], "tirage": qa["tirage"]}
        titre = rendre(qa["titre"], False) if qa["titre"] is not None else qa["id"]
        desc = rendre(qa["description"], True) if qa["description"] is not None else ""
        L.append("::: {.ae-qa data-id=\"%s\" data-spec='%s'}\n::: {.ae-qa-titre}\n%s\n:::\n\n::: {.ae-qa-desc}\n%s\n:::\n:::"
                 % (_attr(qa["id"]), json.dumps(spec, ensure_ascii=False).replace("'", "&#39;"), titre, desc))
    # questions
    for q in banque:
        tete = ('::: {.ae-q data-id="%s" data-type="%s" data-section="%s" data-obj="%s" data-niveau="%d"'
                % (_attr(q["id"]), q["type"], _attr(q["section"]), _attr(" ".join(q["obj"])), q["niveau"]))
        if q["type"] == "qcm":
            tete += ' data-ordre="%s"}' % q["ordre"]
            props = ["::: {.ae-prop .ae-bonne}\n::: {.ae-r}\n%s\n:::\n\n::: {.ae-fb}\n%s\n:::\n:::"
                     % (rendre(q["bonne"]["r"]), rendre(q["bonne"]["fb"]))]
            for p in q["fausses"]:
                props.append("::: {.ae-prop}\n::: {.ae-r}\n%s\n:::\n\n::: {.ae-fb}\n%s\n:::\n:::"
                             % (rendre(p["r"]), rendre(p["fb"])))
            corps = "\n\n".join(props)
        else:
            tete += ' data-forme="%s"}' % q["forme"]
            crit = "\n\n".join("::: {.ae-crit}\n%s\n:::" % rendre(c) for c in q["criteres"])
            corps = "::: {.ae-rep}\n%s\n:::\n\n%s" % (rendre(q["reponse"]), crit)
        L.append("%s\n::: {.ae-enonce}\n%s\n:::\n\n%s\n:::" % (tete, rendre(q["enonce"]), corps))
    L.append(":::\n")
    return "\n\n".join(L)


def lien_section(label, n, prefixe=".."):
    """Markdown à placer en fin de page de section."""
    if not n:
        return ""
    return ('::: {.ae-lien}\n[✔ S\'autoévaluer sur cette section (%d question%s) →](%s/autoeval.qmd#sections=%s)\n:::'
            % (n, "s" if n > 1 else "", prefixe, label))
