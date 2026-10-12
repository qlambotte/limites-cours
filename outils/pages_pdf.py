#!/usr/bin/env python3
"""
pages_pdf.py — compile le cours imprimé et en extrait les repères pour le site.

  1. typst compile  → ../limites.pdf  (version ÉLÈVE : c'est celle qu'ils ont en main)
  2. typst query "<web>" → ../_data/pdf.json : une entrée par encadré
     (sorte, num, chap, sec, page imprimée, page du fichier), posée par
     _web() dans limites-lib.typ.

Usage (depuis le dossier du site) :
  python3 outils/pages_pdf.py                 # polices dans ~/fonts
  python3 outils/pages_pdf.py --fonts DOSSIER
"""
import argparse
import json
import os
import subprocess
import sys

ICI = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(ICI)
NOTES = os.path.normpath(os.path.join(SITE, "..", "limites-claude", "notes"))

ap = argparse.ArgumentParser()
ap.add_argument("--fonts", default=os.path.expanduser("~/fonts"))
ap.add_argument("--typst", default="typst")
args = ap.parse_args()

pdf = os.path.join(SITE, "limites.pdf")
base = [args.typst]
opts = ["--font-path", args.fonts]

print("→ compilation du PDF élève…")
r = subprocess.run(base + ["compile"] + opts + ["limites.typ", pdf], cwd=NOTES)
if r.returncode:
    sys.exit("échec de typst compile (voir ci-dessus)")

print("→ extraction des repères <web>…")
r = subprocess.run(base + ["query"] + opts + ["limites.typ", "<web>", "--field", "value"],
                   cwd=NOTES, capture_output=True, text=True)
if r.returncode:
    sys.exit("échec de typst query :\n" + r.stderr)
data = json.loads(r.stdout)
os.makedirs(os.path.join(SITE, "_data"), exist_ok=True)
with open(os.path.join(SITE, "_data", "pdf.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

# petit bilan par section
bilan = {}
for e in data:
    cle = (e["chap"], e["sec"])
    bilan.setdefault(cle, {}).setdefault(e["sorte"], 0)
    bilan[cle][e["sorte"]] += 1
for (c, s), d in sorted(bilan.items()):
    print("  %s.%s : %s" % (c, s, ", ".join("%d %s" % (n, k) for k, n in sorted(d.items()))))
print("%d repères écrits dans _data/pdf.json" % len(data))
