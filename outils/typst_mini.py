"""
typst_mini.py — un petit interprète du sous-ensemble de Typst utilisé dans les
notes (limites-claude/notes/*.typ), pour produire le site SANS second texte.

Il lit la SOURCE Typst (on ne dépend pas de la sortie de `typst query`) :
  - balisage : titres, paragraphes, listes (- + 1.), *gras*, _italique_,
    $maths$, \\ (retour à la ligne), échappements, commentaires ;
  - code : #appel(args)[contenu], #let, tableaux et dictionnaires, `..spread`,
    fonctions anonymes (x => …), if/else, opérateurs, longueurs (1.2cm, 1fr) ;
  - maths : converties en LaTeX (fractions a/b, attaches ^ _, lim, sqrt, abs,
    root, symboles oo, plus.minus, in.not…).

Les fonctions de la bibliothèque des notes (activite, exercice, graphe-libre,
rep, tab-signes…) ne sont pas interprétées depuis limites-lib.typ : elles sont
reconnues par leur nom et traduites (voir typ2site.py). Tout ce qui n'est pas
reconnu est signalé (avertissement), jamais ignoré en silence.
"""
import math
import re

AVERTISSEMENTS = []


def avert(msg):
    if msg not in AVERTISSEMENTS:
        AVERTISSEMENTS.append(msg)


class ErreurTypst(Exception):
    pass


# =====================================================================
#  Nœuds de contenu (représentation intermédiaire, indépendante du HTML)
# =====================================================================
class N:
    """Nœud générique : kind + champs."""
    def __init__(self, kind, **kw):
        self.kind = kind
        self.__dict__.update(kw)

    def __repr__(self):
        champs = ", ".join("%s=%r" % (k, v) for k, v in self.__dict__.items() if k != "kind")
        return "N(%s%s)" % (self.kind, ", " + champs if champs else "")


def seq(items):
    out = []
    for it in items:
        if it is None:
            continue
        if isinstance(it, list):
            out.extend(seq(it))
        elif isinstance(it, N) and it.kind == "seq":
            out.extend(it.children)
        else:
            out.append(it)
    return N("seq", children=out)


class Longueur:
    def __init__(self, v, unite):
        self.v, self.unite = v, unite

    def __repr__(self):
        return "%g%s" % (self.v, self.unite)


class Fonction:
    """Fonction définie dans le texte (x => …, #let f(a) = …)."""
    def __init__(self, params, corps, env, nom=None):
        self.params, self.corps, self.env, self.nom = params, corps, env, nom


class Builtin:
    def __init__(self, nom, f):
        self.nom, self.f = nom, f


class Label(str):
    """Valeur d'un label Typst <nom>."""
    def __repr__(self):
        return "<%s>" % str(self)


LABEL = re.compile(r"<([A-Za-z0-9_\-.:]+)>")


class Symbole:
    """Valeur « mathématique » (math.op("dom"), sym.arrow…)."""
    def __init__(self, latex):
        self.latex = latex


# =====================================================================
#  Analyse syntaxique
# =====================================================================
LETTRE = re.compile(r"[A-Za-zÀ-ÿ_]")
IDENT = re.compile(r"[A-Za-zÀ-ÿ_][A-Za-zÀ-ÿ0-9_-]*")
NOMBRE = re.compile(r"(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)(cm|mm|pt|em|fr|%|deg|rad|in)?")


class Parseur:
    def __init__(self, src, nom="?"):
        self.s = src
        self.nom = nom

    def err(self, i, msg):
        ligne = self.s.count("\n", 0, i) + 1
        raise ErreurTypst("%s, ligne %d : %s" % (self.nom, ligne, msg))

    # ---------- utilitaires ----------
    def ws(self, i, lignes=True):
        """Saute blancs et commentaires (mode code)."""
        s = self.s
        while i < len(s):
            c = s[i]
            if c in " \t\r" or (lignes and c == "\n"):
                i += 1
            elif s.startswith("//", i):
                j = s.find("\n", i)
                i = len(s) if j < 0 else j
            elif s.startswith("/*", i):
                j = s.find("*/", i)
                i = len(s) if j < 0 else j + 2
            else:
                break
        return i

    # =================================================================
    #  MODE BALISAGE
    # =================================================================
    def markup(self, i, fin=None, indent_min=-1, debut_ligne=True, consommer=True):
        """Analyse du balisage à partir de i. S'arrête sur `fin` (']')
        non échappé, ou sur une ligne d'indentation <= indent_min (corps
        d'un élément de liste). Renvoie (liste de nœuds-AST, i)."""
        s = self.s
        out = []
        texte = []

        def vider():
            if texte:
                out.append(("texte", "".join(texte)))
                texte.clear()

        while i < len(s):
            if debut_ligne:
                # indentation de la ligne
                j = i
                while j < len(s) and s[j] in " \t":
                    j += 1
                if j < len(s) and s[j] == "\n":           # ligne vide
                    if indent_min >= 0:
                        # continue seulement si une ligne plus indentée suit
                        k = j + 1
                        while True:
                            m = k
                            while m < len(s) and s[m] in " \t":
                                m += 1
                            if m < len(s) and s[m] == "\n":
                                k = m + 1
                                continue
                            break
                        if m >= len(s) or (m - k) <= indent_min or (fin and s[m] == fin):
                            vider()
                            return out, j + 1
                    vider()
                    out.append(("parbreak",))
                    i = j + 1
                    while i < len(s):                     # lignes vides suivantes
                        k = i
                        while k < len(s) and s[k] in " \t":
                            k += 1
                        if k < len(s) and s[k] == "\n":
                            i = k + 1
                        else:
                            break
                    continue
                ind = j - i
                if indent_min >= 0 and j < len(s) and ind <= indent_min and not (fin and s[j] == fin):
                    vider()
                    return out, i
                i = j
                debut_ligne = False
                # titre
                m = re.match(r"(=+)\s", s[i:])
                if m and fin is None:
                    vider()
                    niveau = len(m.group(1))
                    k = s.find("\n", i)
                    k = len(s) if k < 0 else k
                    ligne = s[i + len(m.group(0)):k]
                    ml = re.search(r"\s*<([A-Za-z0-9_\-.:]+)>\s*$", ligne)
                    etiquette = None
                    if ml:
                        etiquette, ligne = ml.group(1), ligne[:ml.start()]
                    corps, _ = Parseur(ligne, self.nom).markup(0)
                    out.append(("titre", niveau, corps, etiquette))
                    i = k + 1
                    debut_ligne = True
                    continue
                # éléments de liste
                m = re.match(r"(-|\+|\d+\.)(\s)", s[i:])
                if m and not s.startswith("--", i):
                    vider()
                    marque = m.group(1)
                    corps, i = self.markup(i + len(m.group(0)), fin=fin, indent_min=ind, debut_ligne=False, consommer=False)
                    sorte = "liste" if marque == "-" else "enum"
                    num = int(marque[:-1]) if marque[0].isdigit() else None
                    out.append(("item", sorte, num, corps))
                    debut_ligne = True
                    continue
            c = s[i]
            if fin and c == fin:
                vider()
                return out, (i + 1 if consommer else i)
            if c == "\n":
                texte.append(" ")
                i += 1
                debut_ligne = True
                continue
            if s.startswith("//", i) and not s[max(0, i - 1)] == ":":
                j = s.find("\n", i)
                i = len(s) if j < 0 else j
                continue
            if s.startswith("/*", i):
                j = s.find("*/", i)
                i = len(s) if j < 0 else j + 2
                continue
            if c == "\\":
                n = s[i + 1] if i + 1 < len(s) else "\n"
                if n in " \n\t":
                    vider()
                    out.append(("linebreak",))
                    i += 2 if n == " " else 1
                    continue
                texte.append(n)
                i += 2
                continue
            if c == "$":
                vider()
                node, i = self.math_bloc(i)
                out.append(node)
                continue
            if c == "#":
                vider()
                node, i = self.code_dans_balisage(i + 1)
                if node is not None:
                    out.append(node)
                continue
            if c == "*":
                vider()
                corps, i = self.markup(i + 1, fin="*", debut_ligne=False)
                out.append(("strong", corps))
                continue
            if c == "_" and (i == 0 or not s[i - 1].isalnum()):
                vider()
                corps, i = self.markup(i + 1, fin="_", debut_ligne=False)
                out.append(("emph", corps))
                continue
            if c == "~":
                texte.append(" ")
                i += 1
                continue
            if s.startswith("---", i):
                texte.append("—"); i += 3; continue
            if s.startswith("--", i):
                texte.append("–"); i += 2; continue
            if s.startswith("...", i):
                texte.append("…"); i += 3; continue
            if c == "'":
                texte.append("’"); i += 1; continue
            if c == "[" and fin != "]":
                # crochet littéral équilibré
                texte.append("["); i += 1; continue
            texte.append(c)
            i += 1
        if fin and fin not in ("*", "_"):
            self.err(i, "« %s » manquant" % fin)
        vider()
        return out, i

    def code_dans_balisage(self, i):
        """Après un #, en balisage : mot-clé ou expression simple (sans
        opérateur binaire) suivie d'appels / accès / contenus."""
        s = self.s
        m = IDENT.match(s, i)
        if m:
            mot = m.group(0)
            if mot == "let":
                return self.let(m.end())
            if mot == "vg" and s.startswith("(", m.end()):
                # #vg(1,001) : on garde le texte BRUT (001), pas l'entier 1
                j = s.find(")", m.end())
                brut = s[m.end() + 1:j].strip()
                if brut.startswith('"'):             # forme actuelle : #vg("1,001")
                    a, b = brut.strip('"').split(",", 1)
                else:                                # ancienne forme : #vg(1,001)
                    a, b = [x.strip() for x in brut.split(",", 1)]
                return ("code", ("vgraw", a.strip(), b.strip())), j + 1
            if mot == "set":
                mm = re.match(r'\s*enum\(\s*numbering:\s*"([^"]*)"\s*\)', s[m.end():])
                j = self.fin_instruction(m.end())
                if mm:
                    return ("code", ("setenum", mm.group(1))), j
                return None, j
            if mot in ("show", "import", "include"):
                # jusqu'à la fin de l'expression (équilibrée)
                j = self.fin_instruction(m.end())
                if mot == "include":
                    avert("#include ignoré dans un fichier de contenu")
                return None, j
            if mot == "if":
                node, j = self.si(m.end())
                return node, j
        node, i = self.primaire(i, en_balisage=True)
        return ("code", node), i

    def fin_instruction(self, i):
        """Fin d'une instruction #set / #import : jusqu'au bout de la ligne,
        parenthèses équilibrées."""
        s = self.s
        prof = 0
        while i < len(s):
            c = s[i]
            if c in "([{":
                prof += 1
            elif c in ")]}":
                prof -= 1
            elif c == '"':
                _, i = self.chaine(i)
                continue
            elif c == "\n" and prof <= 0:
                return i
            i += 1
        return i

    def let(self, i):
        s = self.s
        i = self.ws(i, lignes=False)
        m = IDENT.match(s, i)
        if not m:
            self.err(i, "nom attendu après #let")
        nom = m.group(0)
        i = m.end()
        params = None
        if i < len(s) and s[i] == "(":
            params, i = self.parametres(i)
        i = self.ws(i, lignes=False)
        if s[i] != "=":
            self.err(i, "« = » attendu dans #let")
        expr, i = self.expression(i + 1)
        if params is not None:
            expr = ("closure", params, expr)
        return ("let", nom, expr), i

    def parametres(self, i):
        s = self.s
        assert s[i] == "("
        i += 1
        params = []
        while True:
            i = self.ws(i)
            if s[i] == ")":
                return params, i + 1
            m = IDENT.match(s, i)
            nom = m.group(0)
            i = self.ws(m.end())
            defaut = None
            if s[i] == ":":
                defaut, i = self.expression(i + 1)
                i = self.ws(i)
            params.append((nom, defaut))
            if s[i] == ",":
                i += 1

    # =================================================================
    #  MODE CODE
    # =================================================================
    def chaine(self, i):
        s = self.s
        assert s[i] == '"'
        j = i + 1
        out = []
        while s[j] != '"':
            if s[j] == "\\":
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(s[j + 1], s[j + 1]))
                j += 2
            else:
                out.append(s[j])
                j += 1
        return "".join(out), j + 1

    def primaire(self, i, en_balisage=False):
        s = self.s
        i0 = i
        c = s[i] if i < len(s) else ""
        if c == "(":
            node, i = self.parentheses(i)
        elif c == "[":
            corps, i = self.markup(i + 1, fin="]", debut_ligne=False)
            node = ("contenu", corps)
        elif c == "{":
            node, i = self.bloc_code(i)
        elif c == "$":
            node, i = self.math_bloc(i)
            node = ("mathval", node)
        elif c == '"':
            v, i = self.chaine(i)
            node = ("lit", v)
        elif c == "<" and not en_balisage and LABEL.match(s, i):
            ml = LABEL.match(s, i)
            node = ("lit", Label(ml.group(1)))
            i = ml.end()
        elif c == "-" and not en_balisage:
            op, i = self.primaire(i + 1)
            node = ("neg", op)
        else:
            m = NOMBRE.match(s, i)
            if m and (c.isdigit() or c == "."):
                v = float(m.group(1))
                if v == int(v) and "." not in m.group(1) and "e" not in m.group(1):
                    v = int(v)
                if m.group(2):
                    node = ("lit", Longueur(v, m.group(2)))
                else:
                    node = ("lit", v)
                i = m.end()
            else:
                m = IDENT.match(s, i)
                if not m:
                    self.err(i, "expression attendue (trouvé %r)" % s[i:i + 12])
                mot = m.group(0)
                # un identifiant en balisage ne prend pas le « - » final
                if en_balisage and mot.endswith("-"):
                    mot = mot.rstrip("-")
                i = i0 + len(mot)
                if mot == "if" and not en_balisage:
                    return self.si(i)
                if mot in ("true", "false"):
                    node = ("lit", mot == "true")
                elif mot == "none":
                    node = ("lit", None)
                elif mot == "auto":
                    node = ("lit", "auto")
                elif mot == "not":
                    op, i = self.unaire(self.ws(i))
                    node = ("not", op)
                else:
                    node = ("var", mot)
                # fonction anonyme x => …
                j = self.ws(i, lignes=False)
                if not en_balisage and s.startswith("=>", j):
                    corps, i = self.expression(j + 2)
                    return ("closure", [(mot, None)], corps), i
        # suffixes : .champ, (args), [contenu]
        while i < len(s):
            if s[i] == "." and i + 1 < len(s) and LETTRE.match(s[i + 1]):
                m = IDENT.match(s, i + 1)
                champ = m.group(0)
                if en_balisage and champ.endswith("-"):
                    champ = champ.rstrip("-")
                node = ("champ", node, champ)
                i = i + 1 + len(champ)
            elif s[i] == "(":
                args, i = self.arguments(i)
                node = ("appel", node, args)
            elif s[i] == "[":
                corps, i = self.markup(i + 1, fin="]", debut_ligne=False)
                if node[0] == "appel":
                    node = ("appel", node[1], node[2] + [("pos", ("contenu", corps))])
                else:
                    node = ("appel", node, [("pos", ("contenu", corps))])
            else:
                break
        return node, i

    def parentheses(self, i):
        """( … ) : groupe, tableau, dictionnaire, ou paramètres d'une
        fonction anonyme (a, b) => …"""
        s = self.s
        # fonction anonyme à plusieurs paramètres ?
        j = self.apparier(i)
        k = self.ws(j, lignes=False)
        if s.startswith("=>", k):
            params, _ = self.parametres(i)
            corps, k = self.expression(k + 2)
            return ("closure", params, corps), k
        args, i = self.arguments(i)
        if len(args) == 1 and args[0][0] == "pos" and not self.virgule_finale:
            return args[0][1], i
        if args and all(a[0] == "nomme" for a in args):
            return ("dict", args), i
        if not args and s[i - 2:i] == ":)":
            return ("dict", []), i
        return ("tableau", args), i

    def apparier(self, i):
        s = self.s
        prof = 0
        while i < len(s):
            c = s[i]
            if c == '"':
                _, i = self.chaine(i)
                continue
            if c == "$":
                _, i = self.math_bloc(i)
                continue
            if c == "[":
                _, i = self.markup(i + 1, fin="]", debut_ligne=False)
                continue
            if c in "({":
                prof += 1
            elif c in ")}":
                prof -= 1
                if prof == 0:
                    return i + 1
            i += 1
        self.err(i, "parenthèse non fermée")

    def arguments(self, i):
        s = self.s
        assert s[i] == "("
        i += 1
        args = []
        self.virgule_finale = False
        while True:
            i = self.ws(i)
            if s[i] == ")":
                return args, i + 1
            if s[i] == ":" and s[i + 1] == ")":        # dictionnaire vide (:)
                return [], i + 2
            if s.startswith("..", i):
                e, i = self.expression(i + 2)
                args.append(("spread", e))
            else:
                m = IDENT.match(s, i)
                j = self.ws(m.end(), lignes=False) if m else i
                if m and j < len(s) and s[j] == ":" and not s.startswith("::", j):
                    e, i = self.expression(j + 1)
                    args.append(("nomme", m.group(0), e))
                elif s[i] == '"' and s[self.chaine(i)[1]:].lstrip().startswith(":"):
                    cle, k = self.chaine(i)
                    k = self.ws(k)
                    e, i = self.expression(k + 1)
                    args.append(("nomme", cle, e))
                else:
                    e, i = self.expression(i)
                    args.append(("pos", e))
            i = self.ws(i)
            self.virgule_finale = False
            if s[i] == ",":
                i += 1
                self.virgule_finale = True
            elif s[i] != ")":
                self.err(i, "« , » ou « ) » attendu (trouvé %r)" % s[i:i + 10])

    def bloc_code(self, i):
        s = self.s
        assert s[i] == "{"
        i += 1
        instr = []
        while True:
            i = self.ws(i)
            if s[i] == "}":
                return ("bloc", instr), i + 1
            m = IDENT.match(s, i)
            if m and m.group(0) == "let":
                node, i = self.let(m.end())
            else:
                node, i = self.expression(i)
            instr.append(node)
            i = self.ws(i, lignes=False)
            if i < len(s) and s[i] == ";":
                i += 1

    def si(self, i):
        cond, i = self.expression(i)
        i = self.ws(i)
        alors, i = self.primaire(i)
        j = self.ws(i)
        sinon = None
        if self.s.startswith("else", j):
            j = self.ws(j + 4)
            if self.s.startswith("if", j):
                sinon, i = self.si(j + 2)
            else:
                sinon, i = self.primaire(j)
        return ("si", cond, alors, sinon), i

    OPS = [("or",), ("and",), ("==", "!=", "<=", ">=", "<", ">", "in"), ("+", "-"), ("*", "/")]

    def expression(self, i, niveau=0):
        i = self.ws(i)
        if niveau == len(self.OPS):
            return self.unaire(i)
        g, i = self.expression(i, niveau + 1)
        while True:
            j = self.ws(i)
            op = None
            for o in self.OPS[niveau]:
                if self.s.startswith(o, j):
                    if o.isalpha() and (j + len(o) < len(self.s) and self.s[j + len(o)].isalnum()):
                        continue
                    if o in ("<", ">") and self.s.startswith(o + "=", j):
                        continue
                    if o == "=" or (o in ("+", "-") and self.s.startswith("=>", j)):
                        continue
                    op = o
                    break
            if op is None or (op == "/" and self.s.startswith("//", j)):
                return g, i
            d, i = self.expression(j + len(op), niveau + 1)
            g = ("binop", op, g, d)

    def unaire(self, i):
        s = self.s
        i = self.ws(i)
        if s[i] == "-":
            e, i = self.unaire(i + 1)
            return ("neg", e), i
        if s[i] == "+":
            return self.unaire(i + 1)
        if s.startswith("not ", i):
            e, i = self.unaire(i + 4)
            return ("not", e), i
        return self.primaire(i)

    # =================================================================
    #  MATHS  →  arbre, puis LaTeX
    # =================================================================
    def math_bloc(self, i):
        s = self.s
        assert s[i] == "$"
        j = i + 1
        bloc = j < len(s) and s[j] in " \n\t"
        items, j = self.math_seq(j, stop="$")
        fin = j - 1
        bloc = bloc and s[fin - 1] in " \n\t"
        return ("math", items, bloc), j

    def math_seq(self, i, stop):
        """Suite d'éléments mathématiques jusqu'à `stop` (caractère ou
        ensemble). Renvoie (items, i après stop)."""
        s = self.s
        items = []
        while True:
            if i >= len(s):
                self.err(i, "maths non fermées")
            c = s[i]
            if c in stop and not (c == "," and stop == ",)" and False):
                return items, i + 1
            if c in " \t\n":
                items.append(("esp",))
                i += 1
                continue
            item, i = self.math_item(i, stop)
            if item is None:
                continue
            # attaches
            while True:
                j = i
                if j < len(s) and s[j] in "^_":
                    sorte = s[j]
                    arg, i = self.math_item(j + 1, stop, pour_attache=True)
                    item = ("attach", item, sorte, arg) if item[0] != "attach" else ("attach", item, sorte, arg)
                elif j < len(s) and s[j] == "'":
                    item = ("prime", item)
                    i = j + 1
                else:
                    break
            items.append(item)
        # jamais atteint

    def math_item(self, i, stop, pour_attache=False):
        s = self.s
        c = s[i]
        if c == "(":
            inner, j = self.math_seq(i + 1, stop=")")
            return ("groupe", inner), j
        if c == "\\":
            n = s[i + 1]
            if n in " \n":
                return ("sautligne",), i + 2
            return ("litt", n), i + 2
        if c == '"':
            v, j = self.chaine(i)
            return ("texte", v), j
        if c == "#":
            node, j = self.code_dans_balisage(i + 1)
            return ("codem", node), j
        if c.isdigit():
            m = re.match(r"\d+(\.\d+)?", s[i:])
            return ("nombre", m.group(0)), i + m.end()
        if LETTRE.match(c) and c != "_":
            m = re.match(r"[A-Za-zÀ-ÿ]+(\.[A-Za-z]+)*", s[i:])
            mot = m.group(0)
            j = i + len(mot)
            if len(mot) == 1 and not pour_attache and not ("." in mot):
                pass
            # appel de fonction mathématique : mot( sans espace
            if j < len(s) and s[j] == "(" and len(mot) > 1:
                args, j = self.math_args(j)
                return ("mappel", mot, args), j
            return ("ident", mot), j
        for op in ("<=>", "->", "=>", "<=", ">=", "!=", "...", ":=", "<<", ">>", "|->"):
            if s.startswith(op, i):
                return ("op", op), i + len(op)
        if c == "/":
            return ("frac",), i + 1
        if c == "&":
            return None, i + 1
        return ("op", c), i + 1

    def math_args(self, i):
        """Arguments d'un appel mathématique f(a, b) — séparés par des
        virgules de premier niveau ; « ; » aussi toléré."""
        s = self.s
        assert s[i] == "("
        i += 1
        args = []
        cur = []
        prof = 0
        while True:
            c = s[i]
            if c == ")" and prof == 0:
                args.append(cur)
                return [a for a in args], i + 1
            if c == "," and prof == 0:
                args.append(cur)
                cur = []
                i += 1
                continue
            if c == "(":
                inner, i = self.math_seq(i + 1, stop=")")
                cur.append(("groupe", inner))
                continue
            if c in " \t\n":
                cur.append(("esp",))
                i += 1
                continue
            item, i = self.math_item(i, ")")
            if item is None:
                continue
            while i < len(s) and s[i] in "^_":
                sorte = s[i]
                arg, i = self.math_item(i + 1, ")", pour_attache=True)
                item = ("attach", item, sorte, arg)
            cur.append(item)


# =====================================================================
#  Maths → LaTeX
# =====================================================================
SYMBOLES = {
    "oo": r"\infty", "infinity": r"\infty", "plus.minus": r"\pm", "minus.plus": r"\mp",
    "in": r"\in", "in.not": r"\notin", "eq.not": r"\neq", "RR": r"\mathbb{R}", "NN": r"\mathbb{N}",
    "ZZ": r"\mathbb{Z}", "QQ": r"\mathbb{Q}", "without": r"\setminus", "union": r"\cup",
    "sect": r"\cap", "inter": r"\cap", "dot": r"\cdot", "compose": r"\circ", "approx": r"\approx", "forall": r"\forall",
    "exists": r"\exists", "quad": r"\quad", "qquad": r"\qquad", "thin": r"\,", "med": r"\:",
    "thick": r"\;", "lim": r"\lim\limits", "sin": r"\sin", "cos": r"\cos", "tan": r"\tan",
    "ln": r"\ln", "log": r"\log", "exp": r"\exp", "max": r"\max", "min": r"\min",
    "arrow": r"\to", "arrow.r": r"\rightarrow", "arrow.l": r"\leftarrow", "arrow.r.double": r"\Rightarrow",
    "arrow.l.r.double": r"\Leftrightarrow", "arrow.l.long": r"\longleftarrow", "arrow.r.long": r"\longrightarrow",
    "bar.v.double": r"\Vert", "bar.v": r"\vert", "times": r"\times", "div": r"\div",
    "lt.eq": r"\leq", "gt.eq": r"\geq", "subset": r"\subset", "emptyset": r"\emptyset",
    "alpha": r"\alpha", "beta": r"\beta", "delta": r"\delta", "Delta": r"\Delta", "epsilon": r"\varepsilon",
    "pi": r"\pi", "sigma": r"\sigma", "theta": r"\theta", "lambda": r"\lambda", "mu": r"\mu",
    "dom": r"\operatorname{dom}", "degree": r"^\circ", "percent": r"\%", "star": r"\star",
    "dots": r"\ldots", "dots.h": r"\ldots", "ast": r"\ast", "prime": "'", "not": r"\neg",
}
OPS_LATEX = {"<=>": r"\Leftrightarrow", "|->": r"\mapsto", "->": r"\to", "=>": r"\Rightarrow", "<=": r"\leq", ">=": r"\geq", "!=": r"\neq",
             "...": r"\ldots", "%": r"\%", "{": r"\{", "}": r"\}", "#": r"\#", "~": r"\sim"}


class MathVersLatex:
    """Convertit un arbre mathématique en LaTeX. `evalue` : fonction qui
    évalue un nœud de code (#…) et renvoie une valeur."""

    def __init__(self, evalue, vers_latex_valeur):
        self.evalue = evalue
        self.valeur = vers_latex_valeur

    def seq(self, items):
        # regrouper les fractions : x / y
        items = [it for it in items]
        out = []
        k = 0
        while k < len(items):
            it = items[k]
            if it[0] == "frac":
                # numérateur : dernier élément non espace
                while out and out[-1][0] == "esp":
                    out.pop()
                num = out.pop() if out else ("vide",)
                # P(x)/Q(x) : un appel de fonction f(x) forme un seul numérateur
                if num[0] == "groupe" and out and out[-1][0] == "ident":
                    num = ("suite", [out.pop(), num])
                k += 1
                while k < len(items) and items[k][0] == "esp":
                    k += 1
                den = items[k] if k < len(items) else ("vide",)
                if den[0] == "ident" and k + 1 < len(items) and items[k + 1][0] == "groupe":
                    den = ("suite", [den, items[k + 1]])
                    k += 1
                # « -x/y » : le signe ne fait pas partie du numérateur ; ok
                out.append(("fraction", num, den))
                k += 1
                continue
            out.append(it)
            k += 1
        morceaux = []
        for it in out:
            morceaux.append(self.item(it))
        return self.joindre(morceaux)

    def joindre(self, morceaux):
        txt = ""
        for m in morceaux:
            if m == " ":
                if txt and not txt.endswith(" "):
                    txt += " "
                continue
            if txt and re.search(r"\\[A-Za-z]+$", txt) and re.match(r"[A-Za-z]", m):
                txt += " "
            txt += m
        txt = re.sub(r"(\d),(\d)", r"\1{,}\2", txt)
        return txt.strip()

    def sans_parentheses(self, it):
        if it[0] == "groupe":
            return self.seq(it[1])
        return self.item(it)

    def item(self, it):
        k = it[0]
        if k == "esp":
            return " "
        if k == "vide":
            return ""
        if k == "nombre":
            return it[1]
        if k == "ident":
            mot = it[1]
            if mot in SYMBOLES:
                return SYMBOLES[mot]
            if len(mot) == 1:
                return mot
            racine = mot.split(".")[0]
            if racine in SYMBOLES and "." in mot:
                avert("symbole mathématique approché : %s" % mot)
                return SYMBOLES[racine]
            v = self.evalue(("var", mot), silencieux=True)
            if v is not None:
                return self.valeur(v)
            avert("mot inconnu en maths : %s" % mot)
            return r"\text{%s}" % mot
        if k == "texte":
            return r"\text{%s}" % it[1].replace("%", r"\%")
        if k == "litt":
            c = it[1]
            return {"{": r"\{", "}": r"\}", "[": "[", "]": "]", "/": "/", "$": r"\$",
                    "#": r"\#", "%": r"\%", "&": r"\&", "_": r"\_"}.get(c, c)
        if k == "sautligne":
            return r" \\ "
        if k == "op":
            return OPS_LATEX.get(it[1], it[1])
        if k == "groupe":
            return "(" + self.seq(it[1]) + ")"
        if k == "suite":
            return self.joindre([self.item(x) for x in it[1]])
        if k == "fraction":
            return r"\frac{%s}{%s}" % (self.sans_parentheses(it[1]), self.sans_parentheses(it[2]))
        if k == "attach":
            base = self.item(it[1])
            arg = it[3]
            if arg[0] == "groupe":
                inner = arg[1]
                if any(x[0] == "sautligne" for x in inner):
                    lignes, cur = [], []
                    for x in inner:
                        if x[0] == "sautligne":
                            lignes.append(cur); cur = []
                        else:
                            cur.append(x)
                    lignes.append(cur)
                    txt = r"\substack{" + r" \\ ".join(self.seq(l) for l in lignes) + "}"
                else:
                    txt = self.seq(inner)
            else:
                txt = self.item(arg)
            return "%s%s{%s}" % (base, it[2], txt)
        if k == "prime":
            return self.item(it[1]) + "'"
        if k == "mappel":
            return self.appel(it[1], it[2])
        if k == "codem":
            node = it[1]
            if node is None:
                return ""
            if node[0] == "code":
                v = self.evalue(node[1])
                return self.valeur(v)
            if node[0] == "let":
                self.evalue(node)
                return ""
            return ""
        avert("élément mathématique non traité : %r" % (it,))
        return ""

    def appel(self, nom, args):
        A = [self.seq(a) for a in args]
        if nom == "sqrt":
            return r"\sqrt{%s}" % A[0]
        if nom == "root":
            return r"\sqrt[%s]{%s}" % (A[0], A[1])
        if nom == "abs":
            return r"\left|%s\right|" % A[0]
        if nom in ("norm",):
            return r"\left\|%s\right\|" % A[0]
        if nom == "frac":
            return r"\frac{%s}{%s}" % (A[0], A[1])
        if nom in ("bold", "upright", "italic", "cal", "bb"):
            return {"bold": r"\mathbf{%s}", "upright": r"\mathrm{%s}", "italic": "%s",
                    "cal": r"\mathcal{%s}", "bb": r"\mathbb{%s}"}[nom] % A[0]
        if nom == "op":
            return r"\operatorname{%s}" % A[0].replace(r"\text{", "").rstrip("}")
        if nom == "cases":
            return r"\begin{cases}" + r" \\ ".join(A) + r"\end{cases}"
        if nom == "vec":
            return r"\begin{pmatrix}" + r" \\ ".join(A) + r"\end{pmatrix}"
        if nom == "overline":
            return r"\overline{%s}" % A[0]
        if nom == "text":
            return r"\text{%s}" % A[0]
        # fonction de l'environnement (limg, limd, vg…) : on l'évalue
        v = self.evalue(("appelmath", nom, args), silencieux=True)
        if v is not None:
            return self.valeur(v)
        # symbole suivi d'une parenthèse : dom(f), sin(x)…
        if nom in SYMBOLES:
            return SYMBOLES[nom] + "(" + ", ".join(A) + ")"
        avert("fonction mathématique inconnue : %s(…)" % nom)
        return r"\operatorname{%s}(%s)" % (nom, ", ".join(A))


# =====================================================================
#  Évaluation
# =====================================================================
class Env:
    def __init__(self, parent=None):
        self.d = {}
        self.parent = parent

    def get(self, nom):
        e = self
        while e is not None:
            if nom in e.d:
                return e.d[nom]
            e = e.parent
        raise KeyError(nom)

    def has(self, nom):
        try:
            self.get(nom)
            return True
        except KeyError:
            return False


class Args:
    def __init__(self, pos, nommes):
        self.pos, self.nommes = pos, nommes

    def get(self, cle, defaut=None):
        return self.nommes.get(cle, defaut)


class Interprete:
    def __init__(self, builtins):
        self.globals = Env()
        for nom, f in builtins.items():
            self.globals.d[nom] = f if not callable(f) or isinstance(f, (Builtin, Fonction)) else Builtin(nom, f)
        self.mathconv = MathVersLatex(self._evalue_pour_math, self.latex_de_valeur)
        self._env_courant = self.globals

    # ---------- contenu ----------
    def contenu(self, ast, env, portee=True):
        out = []
        if portee:
            env = Env(env)
        for node in ast:
            k = node[0]
            if k == "texte":
                out.append(N("texte", s=node[1]))
            elif k == "parbreak":
                out.append(N("parbreak"))
            elif k == "linebreak":
                out.append(N("linebreak"))
            elif k == "titre":
                out.append(N("titre", niveau=node[1], corps=seq(self.contenu(node[2], env)),
                             label=node[3] if len(node) > 3 else None))
            elif k == "item":
                out.append(N("item", sorte=node[1], num=node[2], corps=seq(self.contenu(node[3], env))))
            elif k == "strong":
                out.append(N("strong", corps=seq(self.contenu(node[1], env))))
            elif k == "emph":
                out.append(N("emph", corps=seq(self.contenu(node[1], env))))
            elif k == "math":
                out.append(self.math(node, env))
            elif k == "let":
                self.let(node, env)
            elif k == "code":
                v = self.eval(node[1], env)
                out.append(self.en_contenu(v))
            elif k == "si":
                v = self.eval(node, env)
                out.append(self.en_contenu(v))
            else:
                avert("nœud de balisage inconnu %s" % k)
        return out

    def math(self, node, env):
        ancien = self._env_courant
        self._env_courant = env
        try:
            latex = self.mathconv.seq(node[1])
        finally:
            self._env_courant = ancien
        return N("math", latex=latex, bloc=node[2])

    def en_contenu(self, v):
        if v is None:
            return None
        if isinstance(v, N):
            return v
        if isinstance(v, list) and all(isinstance(x, N) for x in v):
            return seq(v)
        if isinstance(v, bool):
            return N("texte", s="true" if v else "false")
        if isinstance(v, (int, float)):
            return N("texte", s=fmt_nombre(v))
        if isinstance(v, str):
            return N("texte", s=v)
        if isinstance(v, Symbole):
            return N("math", latex=v.latex, bloc=False)
        if isinstance(v, Longueur):
            return None
        avert("valeur non affichable : %r" % (v,))
        return None

    def latex_de_valeur(self, v):
        if v is None:
            return ""
        if isinstance(v, Symbole):
            return v.latex
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return fmt_nombre(v).replace(",", "{,}")
        if isinstance(v, str):
            return r"\text{%s}" % v
        if isinstance(v, N):
            return latex_de_contenu(v)
        return ""

    def _evalue_pour_math(self, node, silencieux=False):
        env = self._env_courant
        try:
            if node[0] == "appelmath":
                nom, args = node[1], node[2]
                if not env.has(nom):
                    return None
                f = env.get(nom)
                if isinstance(f, Symbole):
                    return Symbole(f.latex + "(" + ", ".join(self.mathconv.seq(a) for a in args) + ")")
                # arguments mathématiques : on les passe en contenu math
                vals = [N("math", latex=self.mathconv.seq(a), bloc=False) for a in args]
                return self.appeler(f, Args(vals, {}), env)
            if node[0] == "var" and silencieux and not env.has(node[1]):
                return None
            if node[0] == "let":
                self.let(node, env)
                return None
            return self.eval(node, env)
        except KeyError:
            return None

    PROTEGES = {"voir"}   # fonctions du convertisseur qu'un fichier ne doit pas remplacer

    def let(self, node, env):
        _, nom, expr = node
        if nom in self.PROTEGES and self.globals.has(nom):
            return
        v = self.eval(expr, env)
        if isinstance(v, Fonction) and v.nom is None:
            v.nom = nom
        env.d[nom] = v

    # ---------- expressions ----------
    def eval(self, node, env):
        k = node[0]
        if k == "lit":
            return node[1]
        if k == "var":
            try:
                return env.get(node[1])
            except KeyError:
                avert("nom inconnu : %s" % node[1])
                return None
        if k == "contenu":
            return seq(self.contenu(node[1], env))
        if k == "mathval":
            return self.math(node[1], env)
        if k == "tableau":
            out = []
            for a in node[1]:
                if a[0] == "spread":
                    out.extend(self.eval(a[1], env) or [])
                else:
                    out.append(self.eval(a[1], env))
            return out
        if k == "dict":
            d = {}
            for a in node[1]:
                if a[0] == "spread":
                    d.update(self.eval(a[1], env) or {})
                else:
                    d[a[1]] = self.eval(a[2], env)
            return d
        if k == "champ":
            base = node[1]
            chemin = []
            while base[0] == "champ":
                chemin.insert(0, base[2]); base = base[1]
            if base[0] == "var" and base[1] in ("calc", "sym", "math", "table", "grid", "enum", "list"):
                nom = ".".join([base[1]] + chemin + [node[2]])
                try:
                    return env.get(nom)
                except KeyError:
                    if base[1] == "sym":
                        return Symbole(SYMBOLES.get(".".join(chemin + [node[2]]), "?"))
                    avert("inconnu : %s" % nom)
                    return None
            v = self.eval(node[1], env)
            if isinstance(v, dict):
                return v.get(node[2])
            if isinstance(v, list) and node[2] in ("len",):
                return Builtin("len", lambda a, e: len(v))
            avert("accès à un champ non géré : .%s" % node[2])
            return None
        if k == "appel":
            f = self.eval(node[1], env) if node[1][0] != "champ" or True else None
            args = self.args(node[2], env)
            if f is None:
                nom = node[1][1] if node[1][0] == "var" else "?"
                avert("fonction inconnue : %s" % nom)
                return None
            return self.appeler(f, args, env)
        if k == "closure":
            return Fonction(node[1], node[2], env)
        if k == "binop":
            return self.binop(node[1], self.eval(node[2], env), self.eval(node[3], env))
        if k == "neg":
            v = self.eval(node[1], env)
            return -v if isinstance(v, (int, float)) else v
        if k == "not":
            return not self.eval(node[1], env)
        if k == "si":
            if self.eval(node[1], env):
                return self.eval(node[2], env)
            return self.eval(node[3], env) if node[3] else None
        if k == "bloc":
            e2 = Env(env)
            res = []
            for ins in node[1]:
                if ins[0] == "let":
                    self.let(ins, e2)
                else:
                    res.append(self.eval(ins, e2))
            res = [r for r in res if r is not None]
            if len(res) == 1:
                return res[0]
            if all(isinstance(r, N) for r in res):
                return seq(res)
            return res[-1] if res else None
        if k == "let":
            self.let(node, env)
            return None
        if k == "vgraw":
            return N("math", latex="%s{,}%s" % (node[1], node[2]), bloc=False)
        if k == "setenum":
            return N("setenum", style=node[1])
        avert("expression non gérée : %s" % k)
        return None

    def binop(self, op, a, b):
        try:
            if op == "+":
                if isinstance(a, list) and isinstance(b, list):
                    return a + b
                if isinstance(a, N) or isinstance(b, N):
                    return seq([self.en_contenu(a), self.en_contenu(b)])
                return a + b
            if op == "-":
                return a - b
            if op == "*":
                if isinstance(a, list) and isinstance(b, int):
                    return a * b
                if isinstance(b, list) and isinstance(a, int):
                    return b * a
                if isinstance(a, Longueur):
                    return Longueur(a.v * b, a.unite)
                return a * b
            if op == "/":
                return a / b
            if op == "==":
                return a == b
            if op == "!=":
                return a != b
            if op == "<":
                return a < b
            if op == ">":
                return a > b
            if op == "<=":
                return a <= b
            if op == ">=":
                return a >= b
            if op == "and":
                return a and b
            if op == "or":
                return a or b
            if op == "in":
                return a in b
        except (TypeError, ZeroDivisionError):
            return None
        return None

    def args(self, liste, env):
        pos, nommes = [], {}
        for a in liste:
            if a[0] == "pos":
                pos.append(self.eval(a[1], env))
            elif a[0] == "nomme":
                nommes[a[1]] = self.eval(a[2], env)
            elif a[0] == "spread":
                v = self.eval(a[1], env)
                if isinstance(v, dict):
                    nommes.update(v)
                elif isinstance(v, list):
                    pos.extend(v)
        return Args(pos, nommes)

    def appeler(self, f, args, env):
        if isinstance(f, Builtin):
            return f.f(args, self)
        if isinstance(f, Fonction):
            e = Env(f.env)
            for idx, (nom, defaut) in enumerate(f.params):
                if idx < len(args.pos):
                    e.d[nom] = args.pos[idx]
                elif nom in args.nommes:
                    e.d[nom] = args.nommes[nom]
                else:
                    e.d[nom] = self.eval(defaut, f.env) if defaut else None
            return self.eval(f.corps, e)
        avert("appel d'une valeur non fonction : %r" % (f,))
        return None

    # ---------- fichiers ----------
    def fichier(self, src, nom, env=None):
        p = Parseur(src, nom)
        ast, _ = p.markup(0)
        return seq(self.contenu(ast, env or Env(self.globals), portee=False))


def fmt_nombre(v):
    if isinstance(v, float) and v == int(v) and abs(v) < 1e15:
        v = int(v)
    s = repr(v) if isinstance(v, float) else str(v)
    return s.replace(".", ",")


def latex_de_contenu(n):
    """Contenu (souvent mathématique) → LaTeX, pour l'intérieur des maths."""
    if n is None:
        return ""
    if n.kind == "math":
        return n.latex
    if n.kind == "seq":
        return " ".join(latex_de_contenu(c) for c in n.children).strip()
    if n.kind == "texte":
        t = n.s.strip()
        return r"\text{%s}" % n.s if t else " "
    if n.kind == "rep":
        return r"\class{rep}{%s}" % latex_de_contenu(n.corps)
    if n.kind in ("strong", "emph"):
        return latex_de_contenu(n.corps)
    return ""


# =====================================================================
#  Traduction d'une fonction anonyme x => … en JavaScript / évaluation
# =====================================================================
JS_CALC = {"calc.pow": "Math.pow", "calc.sqrt": "Math.sqrt", "calc.abs": "Math.abs",
           "calc.sin": "Math.sin", "calc.cos": "Math.cos", "calc.tan": "Math.tan",
           "calc.exp": "Math.exp", "calc.ln": "Math.log", "calc.root": None}


def vers_js(node, var, env_valeurs):
    """Renvoie une chaîne JavaScript, ou None si non traduisible."""
    k = node[0]
    if k == "lit":
        v = node[1]
        if v is None:
            return "NaN"          # « none » : hors du domaine
        return repr(float(v)) if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    if k == "var":
        if node[1] == var:
            return "x"
        v = env_valeurs(node[1])
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return repr(float(v))
        return None
    if k == "neg":
        a = vers_js(node[1], var, env_valeurs)
        return None if a is None else "(-%s)" % a
    if k == "binop":
        a = vers_js(node[2], var, env_valeurs)
        b = vers_js(node[3], var, env_valeurs)
        if a is None or b is None:
            return None
        op = {"and": "&&", "or": "||", "==": "===", "!=": "!=="}.get(node[1], node[1])
        return "(%s %s %s)" % (a, op, b)
    if k == "appel" and node[1][0] == "champ":
        nom = []
        b = node[1]
        while b[0] == "champ":
            nom.insert(0, b[2]); b = b[1]
        if b[0] != "var":
            return None
        nom = b[1] + "." + ".".join(nom)
        js = JS_CALC.get(nom)
        args = [vers_js(a[1], var, env_valeurs) for a in node[2] if a[0] == "pos"]
        if js is None or any(a is None for a in args):
            return None
        return "%s(%s)" % (js, ", ".join(args))
    if k == "si":
        c = vers_js(node[1], var, env_valeurs)
        a = vers_js(node[2], var, env_valeurs)
        b = vers_js(node[3], var, env_valeurs) if node[3] else None
        if None in (c, a, b):
            return None
        return "(%s ? %s : %s)" % (c, a, b)
    if k == "bloc" and len(node[1]) == 1:
        return vers_js(node[1][0], var, env_valeurs)
    if k == "not":
        a = vers_js(node[1], var, env_valeurs)
        return None if a is None else "(!%s)" % a
    return None


def evaluer_fonction(interp, f, x):
    """f : Fonction Typst à un paramètre. Renvoie un float ou None."""
    try:
        y = interp.appeler(f, Args([float(x)], {}), f.env)
    except (ZeroDivisionError, ValueError, OverflowError, TypeError):
        return None
    if isinstance(y, bool) or not isinstance(y, (int, float)):
        return None
    if isinstance(y, complex) or not math.isfinite(y):
        return None
    return float(y)
