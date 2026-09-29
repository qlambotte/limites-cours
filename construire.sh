#!/bin/sh
# Construit le site. SEULS les .typ des notes font foi.
#   ./construire.sh            PDF + pages + quarto render
#   ./construire.sh preview    idem, puis aperçu en direct
#   ./construire.sh sans-pdf   sans recompiler le PDF
set -e
cd "$(dirname "$0")"
TYPWEB="${TYPWEB:-../../../typweb/typweb.py}"
case "$1" in
  preview)  python3 "$TYPWEB" construire . --preview ;;
  sans-pdf) python3 "$TYPWEB" construire . --sans-pdf ;;
  *)        python3 "$TYPWEB" construire . ;;
esac
