#!/usr/bin/env python3
"""
typ2site.py — génère TOUT le contenu du site à partir des notes Typst.

    python3 outils/typ2site.py            (depuis le dossier du site)

Seuls les fichiers .typ de ../limites-claude/notes/ font foi :
  - limites.typ          : ordre des chapitres (#include)
  - fonctions.typ, limites-ch.typ… : le cours (texte, encadrés, figures)
  - limites-aides.typ    : les coups de pouce des exercices (3 indices,
                           solution, pièges), absents du PDF
  - courbes-anciennes.typ: arcs de Bézier de l'ancien cours
Produit (à ne jamais éditer à la main) :
  - _quarto.yml (liste des chapitres), index des chapitres, une page .qmd
    par section (chXX-…/NN-….qmd) ;
  - _includes/figures-data.html (données des figures dynamiques) ;
  - _rapport.txt (avertissements : ce que le convertisseur n'a pas compris).
Pages imprimées : si _data/pdf.json existe (outils/pages_pdf.py), chaque
encadré reçoit sa page, pour la bulle « Cours imprimé p. N ».
"""
import json
import math
import os
import re
import shutil
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import typst_mini as T
from typst_mini import N, seq, avert, Builtin, Symbole, Fonction, Longueur
import autoeval

ICI = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(ICI)
NOTES = os.path.normpath(os.environ.get("NOTES", os.path.join(SITE, "..", "limites-claude", "notes")))
INF = math.inf
PRINCIPAL = "limites.typ"                 # livre principal (ordre des chapitres)
CLE = os.path.splitext(PRINCIPAL)[0]      # préfixe des fichiers associés (…-autoeval.typ)


# =====================================================================
#  Fonctions de la bibliothèque des notes → nœuds
# =====================================================================
def contenu_de(v):
    if isinstance(v, N):
        return v
    return seq([]) if v is None else N("texte", s=str(v))


def boite(sorte, avec_titre=True):
    def f(a, I):
        corps = a.pos[-1] if a.pos else seq([])
        return N("boite", sorte=sorte, titre=a.get("titre") if avec_titre else None,
                 niveau=a.get("niveau", 1), comp=a.get("comp"), maison=bool(a.get("maison", False)),
                 corps=contenu_de(corps))
    return f


def ignorer(a, I):
    return None


def f_rep(a, I):
    return N("rep", corps=contenu_de(a.pos[0] if a.pos else None))


def f_rep_lignes(a, I):
    return N("repbloc", corps=contenu_de(a.pos[0] if a.pos else None))


def f_vg(a, I):
    # appelé avec des valeurs brutes (voir code_dans_balisage : vgraw)
    return N("math", latex="%s{,}%s" % (a.pos[0], a.pos[1]), bloc=False)


def f_h(a, I):
    return N("texte", s=" ")


def f_align(a, I):
    return a.pos[-1] if a.pos else None


def f_texte(a, I):
    return a.pos[-1] if a.pos else None


def f_super(a, I):
    return N("super", corps=contenu_de(a.pos[-1]))


def f_strong(a, I):
    return N("strong", corps=contenu_de(a.pos[-1]))


def f_emph(a, I):
    return N("emph", corps=contenu_de(a.pos[-1]))


def f_columns(a, I):
    return N("colonnes", n=a.pos[0] if a.pos else 2, corps=contenu_de(a.pos[-1]))


def f_cadre_info(a, I):
    return N("cadre", corps=contenu_de(a.pos[-1]))


def n_colonnes(c):
    if isinstance(c, int):
        return c
    if isinstance(c, list):
        return len(c)
    return 1


def f_grid(a, I):
    cellules = [contenu_de(c) for c in a.pos if c is not None or True]
    return N("grille", n=n_colonnes(a.get("columns", 1)), cellules=cellules)


def f_table(a, I):
    entete = None
    cellules = []
    for c in a.pos:
        if isinstance(c, N) and c.kind == "entete":
            entete = c.cellules
        else:
            cellules.append(contenu_de(c))
    return N("table", n=n_colonnes(a.get("columns", 1)), entete=entete, cellules=cellules)


def f_table_header(a, I):
    return N("entete", cellules=[contenu_de(c) for c in a.pos])


def f_limg(cote):
    def f(a, I):
        x = T.latex_de_contenu(a.pos[0]) if a.pos else "a"
        return Symbole(r"\lim\limits_{\substack{x \to %s \\ x %s %s}}" % (x, "<" if cote == "g" else ">", x))
    return f


def f_math_op(a, I):
    return Symbole(r"\operatorname{%s}" % a.pos[0])


def f_tab_signes(a, I):
    bornes, lignes = a.pos[0], a.pos[1]
    entete = [N("math", latex="x", bloc=False)]
    for i, b in enumerate(bornes):
        entete.append(contenu_de(b))
        if i < len(bornes) - 1:
            entete.append(seq([]))
    cellules = []
    rep = a.get("reponse", False)
    for nom, cases in lignes:
        cellules.append(contenu_de(nom))
        cellules.append(seq([]))
        for c in cases:
            cellules.append(N("rep", corps=contenu_de(c)) if rep else contenu_de(c))
        cellules.append(seq([]))
    return N("table", n=len(entete), entete=entete, cellules=cellules, classe="tab-signes")


def f_tab_local(a, I):
    av, lignes = a.pos[0], a.pos[1]
    entete = [N("math", latex="x", bloc=False), N("texte", s="juste à gauche"), contenu_de(av),
              N("texte", s="juste à droite")]
    cellules = []
    rep = a.get("reponse", False)
    for nom, cases in lignes:
        cellules.append(contenu_de(nom))
        for c in cases:
            cellules.append(N("rep", corps=contenu_de(c)) if rep else contenu_de(c))
    return N("table", n=4, entete=entete, cellules=cellules, classe="tab-signes")


def poly3(c, t):
    return c[0] + t * (c[1] + t * (c[2] + t * c[3]))


def f_morceaux_param(a, I):
    coeffs = a.pos[0]
    n = a.get("n", 48)
    return [[(poly3(cx, i / n), poly3(cy, i / n)) for i in range(n + 1)] for cx, cy in coeffs]


def calc(f):
    def g(a, I):
        try:
            return f(*[float(x) for x in a.pos])
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            raise ValueError
    return g


# ---------------- figures ----------------
FIGURES = {}          # id -> données (pour le site)
COMPTEUR_FIG = [0]


def f_graphe(sorte):
    def f(a, I):
        return N("figure", sorte=sorte, args=a, legende=a.get("legende"))
    return f


BUILTINS = {
    "definition": boite("definition"), "propriete": boite("propriete"),
    "remarque": boite("remarque", False), "exemple": boite("exemple"),
    "activite": boite("activite"), "exercice": boite("exercice", False),
    "preuve": boite("preuve", False),
    "cadre-info": f_cadre_info, "rep": f_rep, "repc": f_rep, "rep-lignes": f_rep_lignes,
    "vg": f_vg, "h": f_h, "v": ignorer, "align": f_align, "text": f_texte, "box": f_texte,
    "block": f_texte, "super": f_super, "strong": f_strong, "emph": f_emph,
    "columns": f_columns, "grid": f_grid, "table": f_table, "table.header": f_table_header,
    "rgb": ignorer, "luma": ignorer, "raz-chapitre": None, "init-mode": None,
    "limg": f_limg("g"), "limd": f_limg("d"), "math.op": f_math_op,
    "tab-signes": f_tab_signes, "tab-local": f_tab_local, "morceaux-param": f_morceaux_param,
    "graphe-fonction": f_graphe("fonction"), "graphe-fonctions": f_graphe("fonctions"),
    "graphe-libre": f_graphe("libre"), "repere-vide": f_graphe("vide"),
    "calc.pow": calc(math.pow), "calc.sqrt": calc(math.sqrt), "calc.abs": calc(abs),
    "calc.sin": calc(math.sin), "calc.cos": calc(math.cos), "calc.exp": calc(math.exp),
    "calc.ln": calc(math.log),
    "col-def": None, "col-prop": None, "col-rem": None, "col-ex": None, "col-exo": None,
    "col-act": None, "col-rep": None, "col-soft": None, "col-asym": None,
    "center": None, "horizon": None, "left": None, "right": None, "top": None, "bottom": None,
    "white": None, "black": None,
    "vi": Symbole(r"\Vert"),
    "a-la-maison": N("maison"),
    "voir": None,
}


def builtins():
    d = {}
    for k, v in BUILTINS.items():
        if callable(v) and not isinstance(v, N):
            d[k] = Builtin(k, v)
        else:
            d[k] = v
    # voir(sorte, num)[texte] : lien vers un encadré (dans limites-aides.typ)
    d["voir"] = Builtin("voir", lambda a, I: N("lien", cle=str(a.pos[0]),
                                                   corps=contenu_de(a.pos[1]) if len(a.pos) > 1 else None))
    return d


# =====================================================================
#  Figures : arguments Typst → données pour lim-plot.js
# =====================================================================
def fen_de(a):
    return [float(a.get("x-min", -5)), float(a.get("x-max", 5)),
            float(a.get("y-min", -5)), float(a.get("y-max", 5))]


def arrondi(v, k=5):
    if v is None:
        return None
    if v == INF:
        return "+inf"
    if v == -INF:
        return "-inf"
    return round(v, k)


def courbe_fonction(I, f, de, a, exclure, fen, pleins=(), creux=(), style="plein", couleur=1, de_strict=False):
    """Une fonction anonyme Typst → courbe (morceaux exacts en JS si
    possible, sinon échantillonnés)."""
    x0, x1 = fen[0], fen[1]
    larg = x1 - x0
    de = x0 if de is None else float(de)
    a = x1 if a is None else float(a)
    ev = lambda x: T.evaluer_fonction(I, f, x)
    strict = de_strict
    # bornes : restriction de dessin (fonction définie au-delà) ou bord du domaine ?
    eps = 1e-3 * larg
    ferme = [False, False]
    if not strict and ev(de - eps) is not None and ev(de - 10 * eps) is not None:
        de = -INF
    else:
        ferme[0] = ev(de) is not None
    if not strict and ev(a + eps) is not None and ev(a + 10 * eps) is not None:
        a = INF
    else:
        ferme[1] = ev(a) is not None
    exclure = sorted(float(e) for e in (exclure or []))
    js = T.vers_js(f.corps, f.params[0][0], lambda n: I.globals.d.get(n)) if isinstance(f, Fonction) else None
    # bords du domaine cachés dans la fonction (x => if x >= 2 {…} else {none}) :
    # on repère où elle cesse d'être définie, puis on affine par dichotomie
    transitions = []
    lo_s, hi_s = max(de, x0), min(a, x1)
    n_s = 400
    xs_s = [lo_s + (hi_s - lo_s) * i / n_s for i in range(n_s + 1)]
    def defini(x):
        return ev(x) is not None
    for x_a, x_b in zip(xs_s, xs_s[1:]):
        if any(x_a <= e <= x_b for e in exclure):
            continue
        da, db = defini(x_a), defini(x_b)
        if da != db:
            g, d_ = x_a, x_b
            for _ in range(50):
                mid = (g + d_) / 2
                if defini(mid) == da:
                    g = mid
                else:
                    d_ = mid
            t = round((g + d_) / 2, 6)
            if abs(t - round(t)) < 1e-5:
                t = float(round(t))
            transitions.append(t)
    # morceaux : intervalles entre les points exclus et les bords trouvés
    bornes = sorted(set([de] + [e for e in exclure if de < e < a] + transitions + [a]))
    morceaux = []
    for k in range(len(bornes) - 1):
        lo, hi = bornes[k], bornes[k + 1]
        milieu = (max(lo, x0 - 1) + min(hi, x1 + 1)) / 2 if (math.isinf(lo) or math.isinf(hi)) else (lo + hi) / 2
        if not defini(milieu) and not defini(lo + (hi - lo) * 0.25 if math.isfinite(hi - lo) else milieu):
            continue                                   # morceau hors du domaine
        fg = ferme[0] if k == 0 else (lo in transitions and defini(lo))
        fd = ferme[1] if k == len(bornes) - 2 else (hi in transitions and defini(hi))
        m = {"de": arrondi(lo), "a": arrondi(hi), "ferme": [fg, fd]}
        if js:
            m["expr"] = js
        else:
            # échantillonnage dans la fenêtre (valeurs exactes aux points
            # d'approche usuels a ± 10^-k)
            pts = echantillons(ev, max(lo, x0), min(hi, x1), fen)
            m = {"ech": [pts] if pts else [], "gauche": None, "droite": None}
            avert("fonction non traduite en JavaScript (courbe échantillonnée) : %r" % (f.corps,)[:90])
        morceaux.append(m)
    c = {"style": style, "couleur": couleur, "morceaux": morceaux, "exclus": exclure, "bords": transitions}
    c["pleins"] = [list(map(float, p)) for p in pleins]
    c["creux"] = [list(map(float, p)) for p in creux]
    xs_pleins = {round(p[0], 6) for p in c["pleins"]}
    c["exclus"] = sorted(set(round(e, 6) for e in exclure) | ({round(p[0], 6) for p in c["creux"]} - xs_pleins))
    iso = []
    for p in c["pleins"]:
        y = ev(p[0]) if not any(abs(p[0] - e) < 1e-9 for e in exclure) else None
        if y is None or abs(y - p[1]) > 0.05 or round(p[0], 6) in {round(q[0], 6) for q in c["creux"]}:
            iso.append(p)
    c["isoles"] = iso
    return c


def echantillons(ev, lo, hi, fen, n=400):
    if not lo < hi:
        return []
    xs = [lo + (hi - lo) * i / n for i in range(n + 1)]
    for a in range(math.ceil(lo), math.floor(hi) + 1):
        for k in range(1, 7):
            for s in (-1, 1):
                x = a + s * 10 ** -k
                if lo <= x <= hi:
                    xs.append(x)
    pts = []
    for x in sorted(set(xs)):
        y = ev(x)
        if y is not None:
            pts.append([round(x, 9), y])
    return pts


def bouts_depuis_asymptotes(arc_pts, asym, fen):
    """Comportement d'une courbe échantillonnée au-delà de ses extrémités,
    déduit des asymptotes dessinées (droites en tirets)."""
    def un_bout(p, cote):
        x, y = p
        tol = 0.08 * (fen[3] - fen[2])
        # près d'une A.V. ?
        for (p1, p2) in asym:
            if abs(p1[0] - p2[0]) < 1e-9 and abs(x - p1[0]) < 0.15 * (fen[1] - fen[0]) and \
               (abs(y - fen[3]) < tol or abs(y - fen[2]) < tol):
                signe = 1 if y > (fen[2] + fen[3]) / 2 else -1
                return ["AV", p1[0], signe]
        # le long d'une A.H. / A.O. ?
        au_bord = x <= fen[0] + 0.3 or x >= fen[1] - 0.3 or y <= fen[2] + tol or y >= fen[3] - tol
        if not au_bord:
            return None
        for (p1, p2) in asym:
            if abs(p1[0] - p2[0]) < 1e-9:
                continue
            m = (p2[1] - p1[1]) / (p2[0] - p1[0])
            q = p1[1] - m * p1[0]
            if abs(y - (m * x + q)) < 0.6:
                return ["AH", q] if abs(m) < 1e-9 else ["AO", m, q]
        if abs(y - fen[3]) < tol:
            return ["inf", 1]
        if abs(y - fen[2]) < tol:
            return ["inf", -1]
        return None
    return un_bout(arc_pts[0], "g"), un_bout(arc_pts[-1], "d")


def courbe_morceaux(arcs, asym, fen, pleins=(), creux=(), style="plein", couleur=1):
    """Arcs de points (morceaux-param) → courbe échantillonnée. Les arcs qui
    se touchent sont regroupés (un morceau = une portion sans trou)."""
    arcs = [sorted(arc, key=lambda p: p[0]) for arc in arcs if len(arc) > 1]
    arcs.sort(key=lambda arc: arc[0][0])
    groupes = []
    for arc in arcs:
        if groupes and abs(groupes[-1][-1][-1][0] - arc[0][0]) < 1e-6 and abs(groupes[-1][-1][-1][1] - arc[0][1]) < 1e-6:
            groupes[-1].append(arc)
        else:
            groupes.append([arc])
    morceaux = []
    for g in groupes:
        g_, d_ = bouts_depuis_asymptotes(g[0], asym, fen)
        _, d_ = bouts_depuis_asymptotes(g[-1], asym, fen)
        g_, _ = bouts_depuis_asymptotes(g[0], asym, fen)
        morceaux.append({"ech": [[[round(x, 4), round(y, 4)] for x, y in arc] for arc in g],
                         "gauche": g_, "droite": d_})
    c = {"style": style, "couleur": couleur, "morceaux": morceaux, "approx": True}
    c["pleins"] = [list(map(float, p)) for p in pleins]
    c["creux"] = [list(map(float, p)) for p in creux]
    xs_pleins = {round(p[0], 6) for p in c["pleins"]}
    c["exclus"] = sorted({round(p[0], 6) for p in c["creux"]} - xs_pleins)
    # pleins hors courbe
    iso = []
    for p in c["pleins"]:
        sur = False
        for arc in arcs:
            if arc[0][0] - 1e-6 <= p[0] <= arc[-1][0] + 1e-6:
                for (xa, ya), (xb, yb) in zip(arc, arc[1:]):
                    if xa - 1e-9 <= p[0] <= xb + 1e-9:
                        y = ya if xb == xa else ya + (yb - ya) * (p[0] - xa) / (xb - xa)
                        sur = sur or abs(y - p[1]) < 0.08
        if not sur or round(p[0], 6) in {round(q[0], 6) for q in c["creux"]}:
            iso.append(p)
    c["isoles"] = iso
    return c


def segments(v):
    out = []
    for s in v or []:
        (p, q) = s
        out.append([[float(p[0]), float(p[1])], [float(q[0]), float(q[1])]])
    return out


def construire_figure(fig, I):
    a, sorte = fig.args, fig.sorte
    fen = fen_de(a)
    taille = a.get("size", (7, 7))
    d = {"fenetre": fen, "pas": [float(a.get("x-step", 1)), float(a.get("y-step", 1))],
         "taille": [float(taille[0]), float(taille[1])],
         "courbes": [], "asymptotes": [], "bulles": [], "deco": [], "textes": []}
    xg, yg = a.get("x-grille", "auto"), a.get("y-grille", "auto")
    d["grille"] = [float(xg) if isinstance(xg, (int, float)) else d["pas"][0],
                   float(yg) if isinstance(yg, (int, float)) else d["pas"][1]]
    asym = []
    if sorte == "fonction":
        f = a.pos[0]
        for c in a.get("asymptotes-verticales", ()) or ():
            asym.append([[float(c), fen[2]], [float(c), fen[3]]])
        b = a.get("asymptote-horizontale")
        if b is not None:
            asym.append([[fen[0], float(b)], [fen[1], float(b)]])
        o = a.get("asymptote-oblique")
        if o is not None:
            m, p = float(o[0]), float(o[1])
            asym.append([[fen[0], m * fen[0] + p], [fen[1], m * fen[1] + p]])
        d["courbes"].append(courbe_fonction(I, f, None, None, a.get("exclure"), fen))
    elif sorte == "fonctions":
        for k, c in enumerate(a.pos[0]):
            pts = c.get("points", ()) or ()
            pleins = [(p[0], p[1]) for p in pts if p[2]]
            creux = [(p[0], p[1]) for p in pts if not p[2]]
            d["courbes"].append(courbe_fonction(I, c["f"], c.get("de"), c.get("a"), c.get("exclure"), fen,
                                                pleins, creux, style=c.get("trait", "plein"), couleur=k + 1))
    elif sorte == "libre":
        asym = segments(a.get("asymptotes"))
        pleins, creux = a.get("pleins", ()) or (), a.get("creux", ()) or ()
        fonctions = a.get("fonctions", ()) or ()
        morceaux = a.get("morceaux", ()) or ()
        if morceaux:
            d["courbes"].append(courbe_morceaux(morceaux, asym, fen, pleins, creux))
        for k, c in enumerate(fonctions):
            p_ = pleins if (k == 0 and not morceaux) else ()
            c_ = creux if (k == 0 and not morceaux) else ()
            d["courbes"].append(courbe_fonction(I, c["f"], c.get("de"), c.get("a"), c.get("exclure"), fen, p_, c_,
                                                de_strict=bool(c.get("strict", False))))
        if fonctions and len(fonctions) > 1 and (pleins or creux):
            avert("graphe-libre : plusieurs fonctions, points pleins/creux attribués à la première")
        for k, c in enumerate(a.get("autres", ()) or ()):
            ms = c.get("morceaux", ()) or ()
            if ms and all(abs(s[0][0] - s[-1][0]) < 1e-9 for s in ms):
                d["deco"].extend([[list(map(float, p)) for p in s] for s in ms])
            elif ms:
                d["courbes"].append(courbe_morceaux(ms, asym, fen, c.get("pleins", ()) or (), c.get("creux", ()) or (),
                                                    style="pointille" if c.get("pointille") else "plein", couleur=2))
        for (pt, bu, n) in a.get("bulles", ()) or ():
            d["bulles"].append([list(map(float, pt)), list(map(float, bu)), texte_brut(n)])
        for (pos, c, anc) in a.get("etiquettes", ()) or ():
            d["textes"].append([list(map(float, pos)), texte_brut(c), anc])
    elif sorte == "vide":
        d["statique"] = True
    d["asymptotes"] = asym
    # valeurs de a proposées + départ du point mobile
    cands = []
    for c in d["courbes"]:
        for e in c.get("exclus", []) + c.get("bords", []):
            cands.append(e)
        for m in c["morceaux"]:
            for b in ("de", "a"):
                v = m.get(b)
                if isinstance(v, (int, float)) and fen[0] < v < fen[1]:
                    cands.append(v)
        for p in c.get("isoles", []):
            cands.append(p[0])
    for s in asym:
        if abs(s[0][0] - s[1][0]) < 1e-9:
            cands.append(s[0][0])
    vus, valeurs = set(), []
    for v in cands:
        r = round(v, 6)
        if r not in vus and fen[0] <= r <= fen[1]:
            vus.add(r)
            valeurs.append(r)
    valeurs.sort()
    d["valeurs"] = [T.fmt_nombre(v).replace(",", ".") for v in valeurs[:6]]
    if not d.get("statique") and d["courbes"]:
        if valeurs:
            d["depart"] = {"a": d["valeurs"][0], "x0": valeurs[0] + 1}
        else:
            d["depart"] = {"a": "+inf", "x0": round((fen[0] + fen[1]) / 2)}
    return d


def texte_brut(n):
    if n is None:
        return ""
    if isinstance(n, (int, float, str)):
        return str(n)
    if isinstance(n, N):
        if n.kind == "texte":
            return n.s
        if n.kind == "seq":
            return "".join(texte_brut(c) for c in n.children).strip()
        if n.kind == "math":
            return n.latex
        if hasattr(n, "corps"):
            return texte_brut(n.corps)
    return ""


# =====================================================================
#  Émission Markdown (Quarto)
# =====================================================================
ETIQ = {"definition": "Définition", "propriete": "Propriété", "exemple": "Exemple",
        "remarque": "Remarque", "activite": "Activité", "exercice": "Exercice", "preuve": "Démonstration"}


def esc(t):
    t = t.replace("\\", "\\\\")
    for c in "*_[]`$<>#|@":
        t = t.replace(c, "\\" + c)
    return t


class Emetteur:
    def __init__(self, I, chap, pdf, aides):
        self.I = I
        self.chap = chap
        self.pdf = pdf
        self.aides = aides
        self.compte = {}
        self.enum_style = None
        self.figs = 0
        self.dossier = self.fichier = None
        self.avant_limites = False
        self.dans_exercice = False

    # ---------- inline ----------
    def inline(self, n):
        if n is None:
            return ""
        k = n.kind
        if k == "seq":
            return "".join(self.inline(c) for c in n.children)
        if k == "texte":
            return esc(n.s)
        if k in ("parbreak", "linebreak"):
            return " "
        if k == "strong":
            t = self.inline(n.corps).strip()
            return "**%s**" % t if t else ""
        if k == "emph":
            t = self.inline(n.corps).strip()
            return "*%s*" % t if t else ""
        if k == "super":
            return "^%s^" % self.inline(n.corps).strip().replace(" ", "\\ ")
        if k == "math":
            if n.bloc:
                return "$$%s$$" % n.latex
            return "$%s$" % n.latex.strip() if n.latex.strip() else ""
        if k == "rep":
            return "[%s]{.rep}" % self.inline(n.corps).strip()
        if k == "maison":
            return "[⟵ à faire à la maison]{.maison}"
        if k == "lien":
            txt = self.inline(n.corps).strip() if n.corps else esc(n.cle)
            cible = trouver_cible(n.cle)
            if not cible:
                if CIBLES:      # au second passage seulement
                    avert("lien introuvable : #voir(%r)" % n.cle)
                return txt
            dossier, fichier, ident = cible
            if self.dossier is None:                     # page à la racine du site
                href = "%s/%s#%s" % (dossier, fichier, ident)
            elif dossier == self.dossier and fichier == self.fichier:
                href = "#" + ident
            elif dossier == self.dossier:
                href = "%s#%s" % (fichier, ident)
            else:
                href = "../%s/%s#%s" % (dossier, fichier, ident)
            return "[%s](%s)" % (txt, href)
        if k == "item":
            return self.inline(n.corps)
        # blocs rencontrés en ligne (cellule de tableau…)
        return " ".join(self.bloc(n).split("\n")).strip()

    # ---------- blocs ----------
    def bloc(self, n):
        """Renvoie du Markdown (plusieurs lignes)."""
        if n is None:
            return ""
        k = n.kind
        if k == "seq":
            return self.suite(n.children)
        if k == "titre":
            niv = max(1, n.niveau - 1)
            return "%s %s" % ("#" * niv, self.inline(n.corps).strip())
        if k == "boite":
            return self.boite(n)
        if k == "figure":
            return self.figure(n)
        if k == "table":
            return self.table(n)
        if k == "grille":
            cells = "\n\n".join("::: {.cellule}\n%s\n:::" % self.bloc(c) for c in n.cellules)
            return '::: {.grille style="--n:%d"}\n%s\n:::' % (n.n, cells)
        if k == "colonnes":
            return '::: {.colonnes style="--n:%d"}\n%s\n:::' % (n.n, self.bloc(n.corps))
        if k == "cadre":
            titre = ""
            for c in n.corps.children if n.corps.kind == "seq" else [n.corps]:
                if c.kind == "strong":
                    titre = texte_brut(c.corps); break
            ident = "cadre-" + slug(titre)[:40] if titre else "cadre-%d" % len(CIBLES_N)
            CIBLES_N["cadre: " + norm(titre)] = (self.dossier, self.fichier, ident)
            return "::: {#%s .cadre-info}\n%s\n:::" % (ident, self.bloc(n.corps))
        if k == "repbloc":
            return "::: {.rep-bloc}\n%s\n:::" % self.bloc(n.corps)
        if k == "math" and n.bloc:
            return "$$\n%s\n$$" % n.latex
        if k == "setenum":
            self.enum_style = n.style
            return ""
        return self.inline(n)

    def suite(self, enfants):
        blocs, para = [], []
        liste = []

        def vider_para():
            t = "".join(para).strip()
            t = re.sub(r"[ \t]+", " ", t)
            if t:
                blocs.append(t)
            para.clear()

        def vider_liste():
            if not liste:
                return
            lignes = []
            num_attendu = 1
            for it in liste:
                if it.sorte == "liste":
                    marque = "-"
                else:
                    num = it.num or num_attendu
                    num_attendu = num + 1
                    if self.enum_style == "a)":
                        marque = "%s)" % chr(ord("a") + num - 1)
                    else:
                        marque = "%d." % num
                corps = self.bloc(it.corps).strip() or " "
                ind = " " * (len(marque) + 1)
                corps_lignes = corps.split("\n")
                lignes.append(marque + " " + corps_lignes[0])
                for l in corps_lignes[1:]:
                    lignes.append((ind + l) if l.strip() else "")
            blocs.append("\n".join(lignes))
            liste.clear()

        for c in enfants:
            if c is None:
                continue
            k = c.kind
            if k == "item":
                vider_para()
                if liste and liste[-1].sorte != c.sorte:
                    vider_liste()
                liste.append(c)
                continue
            if k == "parbreak":
                vider_para()
                vider_liste()
                continue
            if k == "linebreak":
                para.append("\\\n")
                continue
            if k == "texte" and not c.s.strip() and liste:
                continue
            if k in ("boite", "figure", "table", "grille", "colonnes", "cadre", "repbloc", "titre", "setenum") \
                    or (k == "math" and c.bloc):
                vider_para()
                vider_liste()
                b = self.bloc(c)
                if b:
                    blocs.append(b)
                continue
            if liste:
                vider_liste()
            para.append(self.inline(c))
        vider_para()
        vider_liste()
        return "\n\n".join(b for b in blocs if b.strip())

    # ---------- encadrés ----------
    def numero(self, sorte):
        self.compte[sorte] = self.compte.get(sorte, 0) + 1
        return "%d.%d" % (self.chap, self.compte[sorte])

    def attrs_page(self, sorte, num):
        e = self.pdf.get((sorte, num))
        if not e:
            return ""
        return ' data-page="%s" data-phys="%s"' % (e["page"], e.get("phys", e["page"]))

    def boite(self, n):
        sorte = n.sorte
        num = self.numero(sorte)
        ident = "%s-%s" % (sorte, num.replace(".", "-"))
        cible = (self.dossier, self.fichier, ident)
        CIBLES_N["%s %s" % (sorte, num)] = cible
        if n.titre is not None:
            CIBLES_N[norm(texte_brut(contenu_de(n.titre)))] = cible
        attrs = '#%s data-sorte="%s" data-num="%s"%s' % (ident, sorte, num, self.attrs_page(sorte, num))
        if sorte == "exercice":
            self.dans_exercice = True      # figures des exercices : menu replié
            try:
                corps = self.bloc(n.corps)
                niv = int(n.niveau or 1)
                etoiles = "★" * niv + "☆" * (3 - niv)
                tete = "[✎ Exercice %s]{.exo-titre}" % num
                if n.maison:
                    tete += " [⟵ à faire à la maison]{.exo-maison}"
                meta = ("[%s]{.exo-comp} " % n.comp if n.comp else "") + etoiles
                tete += " [%s]{.exo-meta}" % meta
                md = "::: {%s .exo}\n::: {.exo-tete}\n%s\n:::\n\n::: {.exo-corps}\n%s\n:::\n:::" % (attrs, tete, corps)
                md += "\n\n" + self.aides_de(num, n)
                return md
            finally:
                self.dans_exercice = False
        corps = self.bloc(n.corps)
        titre = ""
        if n.titre is not None:
            titre = " — " + self.inline(contenu_de(n.titre)).strip()
        tete = "**%s %s**%s" % (ETIQ[sorte], num, titre)
        return "::: {%s .theo .theo-%s}\n::: {.theo-head}\n%s\n:::\n\n::: {.theo-body}\n%s\n:::\n:::" % (
            attrs, sorte, tete, corps)

    def aides_de(self, num, n):
        a = self.aides.get(num)
        debut = re.sub(r"\s+", " ", texte_brut(n.corps))[:60]
        if a is None:
            avert("exercice %s sans coups de pouce (limites-aides.typ) : « %s… »" % (num, debut[:40]))
            return ""
        attendu = texte_brut(a.get("debut"))
        if attendu and not norm(debut).startswith(norm(attendu)[:25]):
            avert("coups de pouce de l'exercice %s : le début ne correspond pas (« %s » ≠ « %s ») — "
                  "numéros décalés ?" % (num, attendu[:30], debut[:30]))
        onglets = [("Indice 1", "i1"), ("Indice 2", "i2"), ("Indice 3", "i3"), ("Solution", "solution"), ("Pièges", "pieges")]
        parts = []
        for titre, cle in onglets:
            v = a.get(cle)
            if v is None:
                avert("exercice %s : onglet « %s » manquant" % (num, titre))
                continue
            corps = self.bloc(contenu_de(v))
            if cle == "solution" and a.get("detaillee"):
                corps = "::: {.solution-classe}\n%s\n:::" % corps
            parts.append("## %s {.unlisted}\n\n%s" % (titre, corps))
        return "::: {.aides}\n::: {.panel-tabset}\n%s\n:::\n:::" % "\n\n".join(parts)

    # ---------- figures ----------
    def figure(self, n):
        self.figs += 1
        ident = "c%d-f%d" % (self.chap, len(FIGURES) + 1)
        try:
            FIGURES[ident] = construire_figure(n, self.I)
            if self.avant_limites or self.dans_exercice:
                FIGURES[ident]["replie"] = True
            if self.avant_limites:
                FIGURES[ident]["ecart"] = True
        except Exception as e:     # une figure ratée ne doit pas tout bloquer
            avert("figure %s non construite : %s" % (ident, e))
            return "::: {.callout-warning}\nFigure non disponible en ligne : voir le cours imprimé.\n:::"
        md = '```{=html}\n<div class="lim-plot" data-fig="%s"></div>\n```' % ident
        if n.legende is not None:
            md += "\n\n::: {.lp-legende}\n%s\n:::" % self.inline(contenu_de(n.legende)).strip()
        return md

    # ---------- tableaux ----------
    def table(self, n):
        cols = max(1, n.n)
        cells = [self.inline(c).strip().replace("|", "\\|") or " " for c in n.cellules]
        if n.entete:
            tete = [self.inline(c).strip().replace("|", "\\|") or " " for c in n.entete]
        else:
            tete, cells = cells[:cols], cells[cols:]
        while len(tete) < cols:
            tete.append(" ")
        lignes = ["| " + " | ".join(tete) + " |", "|" + "|".join([":---:"] * cols) + "|"]
        for i in range(0, len(cells), cols):
            ligne = cells[i:i + cols]
            ligne += [" "] * (cols - len(ligne))
            lignes.append("| " + " | ".join(ligne) + " |")
        classe = getattr(n, "classe", None)
        t = "\n".join(lignes)
        return "::: {.tableau%s}\n%s\n:::" % (" ." + classe if classe else "", t)


CIBLES = {}      # cibles du passage précédent : clé → (dossier, fichier, ident)
CIBLES_N = {}    # cibles du passage en cours


def trouver_cible(cle):
    m = re.match(r"(definition|propriete|remarque|exemple|activite|exercice)\s+(\d+\.\d+)$", cle.strip())
    if m:
        return CIBLES.get("%s %s" % (m.group(1), m.group(2)))
    if cle.startswith("cadre:"):
        k = norm(cle[6:])
        for c, v in CIBLES.items():
            if c.startswith("cadre: ") and c[7:].startswith(k[:20]):
                return v
        return None
    k = norm(cle)
    if k in CIBLES:
        return CIBLES[k]
    for c, v in CIBLES.items():
        if not c.startswith("cadre") and " " not in c and k and k in c:
            return v
    return None


def norm(s):
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"[^a-z0-9]", "", s.lower())


def slug(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s.lower()).strip("-")
    mots = s.split("-")
    return "-".join(mots[:5])


# =====================================================================
#  Programme principal
# =====================================================================
def charger_interp():
    I = T.Interprete(builtins())
    # courbes de l'ancien cours
    ca = os.path.join(NOTES, "courbes-anciennes.typ")
    if os.path.exists(ca):
        I.fichier(open(ca, encoding="utf-8").read(), "courbes-anciennes.typ", I.globals)
    return I


def ordre_chapitres():
    src = open(os.path.join(NOTES, PRINCIPAL), encoding="utf-8").read()
    src = re.sub(r"//.*", "", src)
    return re.findall(r'#include\s+"([^"]+)"', src)


SORTES_PDF = {"Activité": "activite", "Définition": "definition", "Propriété": "propriete",
              "Remarque": "remarque", "Exemple": "exemple", "Exercice": "exercice"}


def pages_depuis_pdf(pdf):
    """Repères de pages lus dans le TEXTE du PDF des notes (titres des
    encadrés + « Page N » en pied de page). Sert quand _data/pdf.json
    (typst query) n'existe pas. Il faut pdftotext (paquet poppler-utils)
    ou le module Python pypdf."""
    import subprocess
    textes = None
    try:
        r = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, timeout=60)
        if r.returncode == 0:
            textes = r.stdout.split("\f")
    except (OSError, subprocess.TimeoutExpired):
        pass
    if textes is None:
        try:
            import pypdf
            textes = [pg.extract_text() or "" for pg in pypdf.PdfReader(pdf).pages]
        except Exception:
            return None
    res, vus = [], set()
    for phys, t in enumerate(textes, 1):
        m = re.findall(r"Page\s+(\d+)\s*$", t.strip())
        page = int(m[-1]) if m else phys
        for sorte, num in re.findall(r"(Activité|Définition|Propriété|Remarque|Exemple|Exercice)\s+(\d+\.\d+)", t):
            cle = (SORTES_PDF[sorte], num)
            if cle not in vus:
                vus.add(cle)
                res.append({"sorte": cle[0], "num": num, "page": page, "phys": phys})
    return res


def lire_pdf():
    p = os.path.join(SITE, "_data", "pdf.json")
    if os.path.exists(p):
        donnees = json.load(open(p, encoding="utf-8"))
    else:
        pdf = os.path.join(NOTES, "limites.pdf")
        donnees = pages_depuis_pdf(pdf) if os.path.exists(pdf) else None
        if donnees is None:
            avert("pages des notes inconnues (pas de _data/pdf.json, et limites.pdf illisible) : "
                  "la case « page N des notes » n'apparaîtra pas. Lancer outils/pages_pdf.py, "
                  "ou installer pdftotext (sudo apt install poppler-utils).")
            return {}
        avert("pages lues dans le texte de ../limites-claude/notes/limites.pdf (recompiler le PDF "
              "après chaque modification des notes, sinon les pages sont celles de l'ancienne version)")
    d = {}
    for e in donnees:
        d[(e["sorte"], str(e["num"]))] = e
    return d


def lire_aides(I):
    p = os.path.join(NOTES, "limites-aides.typ")
    if not os.path.exists(p):
        avert("limites-aides.typ absent : aucun coup de pouce")
        return {}
    env = T.Env(I.globals)
    I.fichier(open(p, encoding="utf-8").read(), "limites-aides.typ", env)
    try:
        return env.get("aides")
    except KeyError:
        avert("limites-aides.typ ne définit pas « aides »")
        return {}


def titre_texte(n):
    return texte_brut(n.corps).strip()


def generer():
    T.AVERTISSEMENTS.clear()
    FIGURES.clear()
    CIBLES_N.clear()
    I = charger_interp()
    pdf = lire_pdf()
    aides = lire_aides(I)
    chapitres = []           # (num, titre, dossier, intro_md, [(titre, fichier, md)])
    num_chap = 0
    for fichier in ordre_chapitres():
        src = open(os.path.join(NOTES, fichier), encoding="utf-8").read()
        doc = I.fichier(src, fichier, T.Env(I.globals))
        # découpage : = chapitre, == section
        courant = None
        for c in doc.children:
            if c.kind == "titre" and c.niveau == 1:
                num_chap += 1
                courant = {"num": num_chap, "titre": titre_texte(c), "intro": [], "sections": []}
                chapitres.append(courant)
                continue
            if courant is None:
                continue
            if c.kind == "titre" and c.niveau == 2:
                courant["sections"].append({"titre": c.corps, "label": getattr(c, "label", None), "enfants": []})
                continue
            if courant["sections"]:
                courant["sections"][-1]["enfants"].append(c)
            else:
                courant["intro"].append(c)
    # chapitres placés avant celui des limites : point mobile replié, écart affiché
    num_limites = next((c["num"] for c in chapitres if "limite" in c["titre"].lower()), 10 ** 6)
    # sections : label → page (pour l'autoévaluation)
    sections = {}
    for ch in chapitres:
        ch["dossier"] = "ch%d-%s" % (ch["num"], slug(ch["titre"])[:20].strip("-"))
        for k, s in enumerate(ch["sections"], 1):
            s["nomf"] = "%d-%s.qmd" % (k, slug(texte_brut(s["titre"]))[:40].strip("-"))
            s["label"] = s["label"] or "sec-" + slug(texte_brut(s["titre"]))
            sections[s["label"]] = {"titre": s["titre"], "chap": ch["num"],
                                    "url": "%s/%s" % (ch["dossier"], s["nomf"].replace(".qmd", ".html"))}
    objectifs = autoeval.lire_objectifs(I, os.path.join(NOTES, "objectifs.typ"))
    banque, questionnaires = autoeval.lire_banque(I, os.path.join(NOTES, CLE + "-autoeval.typ"))
    banque = autoeval.controler(banque, questionnaires, sections, objectifs)
    # émission
    fichiers = {}
    liste_yml = []
    for ch in chapitres:
        E = Emetteur(I, ch["num"], pdf, aides)
        E.avant_limites = ch["num"] < num_limites
        dossier = ch["dossier"]
        E.dossier, E.fichier = dossier, "index.qmd"
        intro = E.suite(ch["intro"])
        sec_liens = []
        pages = []
        for k, s in enumerate(ch["sections"], 1):
            titre_md = E.inline(s["titre"]).strip()
            nomf = s["nomf"]
            E.dossier, E.fichier = dossier, nomf
            corps = E.suite(s["enfants"])
            n_ae = sum(1 for q in banque if q["section"] == s["label"])
            if n_ae:
                corps += "\n\n" + autoeval.lien_section(s["label"], n_ae)
            md = '---\ntitle: "%s"\n---\n\n%s\n%s\n' % (texte_brut(s["titre"]).replace('"', '\\"'),
                                                         entete_genere(), corps)
            fichiers[os.path.join(dossier, nomf)] = md
            pages.append(os.path.join(dossier, nomf))
            sec_liens.append("%d. [%s](%s)" % (k, titre_md, nomf))
        idx = '---\ntitle: "Chapitre %d — %s"\n---\n\n%s\n%s\n\n## Sections\n\n%s\n' % (
            ch["num"], ch["titre"], entete_genere(), intro, "\n".join(sec_liens))
        fichiers[os.path.join(dossier, "index.qmd")] = idx
        liste_yml.append((os.path.join(dossier, "index.qmd"), pages))
    if banque:
        E = Emetteur(I, 0, pdf, aides)
        E.dossier, E.fichier = None, "autoeval.qmd"
        E.dans_exercice = True                 # figures : point mobile replié

        def rendre(n, bloc=True):
            n = contenu_de(n)
            return E.bloc(n) if bloc else E.inline(n).strip()
        fichiers["autoeval.qmd"] = autoeval.page(rendre, banque, questionnaires, sections, objectifs, CLE)
        liste_yml.append(("autoeval.qmd", None))
    return fichiers, liste_yml


def entete_genere(fichier_src=""):
    return "<!-- GÉNÉRÉ par outils/typ2site.py à partir des notes Typst : NE PAS ÉDITER (les modifications seraient écrasées). -->\n"


def ecrire_si_change(p, texte):
    if os.path.exists(p) and open(p, encoding="utf-8").read() == texte:
        return
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(texte)


def ecrire(fichiers, liste_yml):
    # anciens dossiers de chapitres générés : on les remplace
    # pages générées qui n'existent plus (section renommée…) : supprimées
    attendus = {os.path.normpath(os.path.join(SITE, c)) for c in fichiers}
    for d in os.listdir(SITE):
        dd = os.path.join(SITE, d)
        if re.match(r"ch\d+-", d) and os.path.isdir(dd):
            for f in os.listdir(dd):
                if f.endswith(".qmd") and os.path.normpath(os.path.join(dd, f)) not in attendus:
                    os.remove(os.path.join(dd, f))
            if not os.listdir(dd):
                os.rmdir(dd)
    for vieux in ("boites.lua", "figures.json", os.path.join("outils", "figures.py")):   # restes de la v1
        if os.path.exists(os.path.join(SITE, vieux)):
            os.remove(os.path.join(SITE, vieux))
    if "autoeval.qmd" not in fichiers and os.path.exists(os.path.join(SITE, "autoeval.qmd")):
        os.remove(os.path.join(SITE, "autoeval.qmd"))
    for chemin, md in fichiers.items():
        ecrire_si_change(os.path.join(SITE, chemin), md)
    # figures
    js = json.dumps(FIGURES, ensure_ascii=False, separators=(",", ":"))
    js = js.replace('"+inf"', "Infinity").replace('"-inf"', "-Infinity")
    ecrire_si_change(os.path.join(SITE, "_includes", "figures-data.html"),
                     "<!-- GÉNÉRÉ par outils/typ2site.py — ne pas éditer -->\n<script>window.LIM_FIGS = %s;</script>\n" % js)
    # _quarto.yml : liste des chapitres entre deux marqueurs
    yml_p = os.path.join(SITE, "_quarto.yml")
    yml = open(yml_p, encoding="utf-8").read()
    bloc = ["    - index.qmd"]
    for idx, pages in liste_yml:
        if pages is None:                      # page isolée (autoévaluation)
            bloc.append("    - %s" % idx)
            continue
        bloc.append("    - part: %s" % idx)
        bloc.append("      chapters:")
        for p in pages:
            bloc.append("        - %s" % p)
    nouveau = "  chapters:  # GÉNÉRÉ par outils/typ2site.py\n" + "\n".join(bloc) + "\n  # fin des chapitres générés\n"
    yml = re.sub(r"  chapters:.*?(  # fin des chapitres générés\n|(?=  page-footer:))", nouveau, yml, flags=re.S)
    ecrire_si_change(yml_p, yml)
    ecrire_si_change(os.path.join(SITE, "_rapport.txt"), "\n".join(T.AVERTISSEMENTS) + "\n")


def main():
    generer()                       # 1er passage : repérer les encadrés (liens)
    CIBLES.clear(); CIBLES.update(CIBLES_N)
    fichiers, liste = generer()     # 2e passage
    ecrire(fichiers, liste)
    print("%d pages, %d figures ; %d avertissement(s) dans _rapport.txt" % (
        len(fichiers), len(FIGURES), len(T.AVERTISSEMENTS)))
    for a in T.AVERTISSEMENTS[:40]:
        print("  !", a)


if __name__ == "__main__":
    main()
