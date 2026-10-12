# Limites et asymptotes — site (Quarto, généré par typweb)

**Seuls les fichiers `.typ` des notes font foi.** Tout le site est GÉNÉRÉ à partir de
`../notes/` par **typweb** (`../../../typweb/`, voir son README).
Réglages du cours : `typweb.toml`. Page d'accueil : `index.qmd` (écrite à la main).
Ne jamais éditer `_quarto.yml`, `js/`, `_includes/`, `theme.scss`, `ch1-…/`, `ch2-…/`,
`autoeval.qmd` : ils sont écrasés à chaque construction.

```bash
./construire.sh            # PDF + pages + quarto render
./construire.sh preview    # idem, puis aperçu en direct
./construire.sh sans-pdf   # sans recompiler le PDF
```

Lire `_rapport.txt` après chaque construction (vide = tout va bien).

## Où écrire quoi

| Quoi | Où (dans `../notes/`) |
|---|---|
| Le cours | `fonctions.typ`, `limites-notion.typ`, `limites-av.typ`, `limites-ah-ao.typ` ; ordre des chapitres : `limites.typ` |
| Les coups de pouce des exercices | `limites-aides.typ` (3 indices, solution, pièges ; `#voir("titre")[texte]` pour un lien) |
| Les questions d'autoévaluation | `limites-autoeval.typ` (compilé seul : aperçu imprimable de la banque) |
| La grille d'objectifs | `objectifs.typ` |
