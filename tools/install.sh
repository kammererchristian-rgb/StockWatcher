#!/bin/sh
# Nachkauf-Radar – Installation und Update für Home Assistant OS
# Ausführen im Add-on "Terminal & SSH" (oder "Advanced SSH & Web Terminal"):
#   sh /share/install.sh
# Voraussetzung: nachkauf-radar-ha.zip liegt in /share (z. B. per Samba in den Ordner "share" kopiert).
set -eu

ZIP="${1:-/share/nachkauf-radar-ha.zip}"
SLUG="local_nachkauf_radar"
TARGET="/addons/nachkauf_radar"
TMP="$(mktemp -d)"

[ -f "$ZIP" ] || { echo "FEHLER: $ZIP nicht gefunden. Bitte die ZIP-Datei nach /share kopieren."; exit 1; }
[ -d /addons ] || { echo "FEHLER: /addons nicht gefunden. Läuft das Skript im SSH-Add-on von Home Assistant OS?"; exit 1; }

echo "» Entpacke $ZIP"
unzip -q -o "$ZIP" -d "$TMP"
SRC="$(find "$TMP" -type f -name config.yaml -path '*nachkauf_radar/config.yaml' | head -n1 | xargs dirname)"
[ -n "$SRC" ] || { echo "FEHLER: Add-on-Ordner im ZIP nicht gefunden."; rm -rf "$TMP"; exit 1; }
NEWVER="$(sed -n 's/^version: *"\{0,1\}\([^"]*\)"\{0,1\}/\1/p' "$SRC/config.yaml")"

echo "» Kopiere Dateien nach $TARGET (Version $NEWVER)"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -r "$SRC/." "$TARGET/"
rm -rf "$TMP"

echo "» Lade Add-on-Store neu"
ha store reload >/dev/null 2>&1 || ha addons reload >/dev/null 2>&1 || true
sleep 3

if ha addons info "$SLUG" --raw-json 2>/dev/null | grep -q '"version": *"[0-9]'; then
  INSTVER="$(ha addons info "$SLUG" --raw-json | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | head -n1)"
  if [ "$INSTVER" != "$NEWVER" ]; then
    echo "» Update $INSTVER → $NEWVER (baut das Image neu, kann einige Minuten dauern)"
    ha addons update "$SLUG"
  else
    echo "» Gleiche Version $NEWVER – baue neu"
    ha addons rebuild "$SLUG"
  fi
else
  echo "» Erstinstallation (baut das Image, kann einige Minuten dauern)"
  ha addons install "$SLUG"
fi

ha addons start "$SLUG" >/dev/null 2>&1 || ha addons restart "$SLUG" >/dev/null 2>&1 || true

echo
echo "✔ Nachkauf-Radar $NEWVER installiert und gestartet."
echo "  Prüfsummen:"
( cd "$TARGET/app" && sha256sum server.js public/app.js public/analysis.js public/index.html )
echo
echo "  Öffnen: Seitenleiste → Nachkauf-Radar (beim ersten Mal ggf. im Add-on 'In Seitenleiste anzeigen' aktivieren)"
echo "  Log:    ha addons logs $SLUG"
