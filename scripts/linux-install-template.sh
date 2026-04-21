#!/bin/sh
set -e

APP_ID="nab.app"
APP_DIR="$HOME/.local/share/$APP_ID"
LAUNCHER="$APP_DIR/stable/app/bin/launcher"
BIN_LINK="$HOME/.local/bin/nab"
DESKTOP="$HOME/.local/share/applications/nab.desktop"
UNINSTALL="$HOME/.local/bin/nab-uninstall"

# Handle uninstall — triggered either by --uninstall flag or if invoked as nab-uninstall
if [ "$1" = "--uninstall" ] || [ "$(basename "$0")" = "nab-uninstall" ]; then
  echo "Uninstalling Nab..."
  rm -rf "$APP_DIR"
  rm -f "$BIN_LINK"
  rm -f "$DESKTOP"
  rm -f "$UNINSTALL"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "Nab uninstalled."
  exit 0
fi

INSTALLER_TMP=$(mktemp /tmp/nab-installer-XXXXXX)
tail -n +__LINES__ "$0" | base64 -d > "$INSTALLER_TMP"
chmod +x "$INSTALLER_TMP"
echo "Running Nab installer..."
"$INSTALLER_TMP"
rm -f "$INSTALLER_TMP"

mkdir -p "$HOME/.local/bin"
ln -sf "$LAUNCHER" "$BIN_LINK"
echo "Created command: nab"

ICON_SRC="$APP_DIR/stable/app/Resources/app/icon.png"
ICON_DEST="$HOME/.local/share/icons/hicolor/256x256/apps/nab.png"

mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
cp "$ICON_SRC" "$ICON_DEST" 2>/dev/null || true
update-icon-caches "$HOME/.local/share/icons" 2>/dev/null || true

ICON_VALUE="$ICON_DEST"
if [ ! -f "$ICON_DEST" ] && [ -f "$ICON_SRC" ]; then
  ICON_VALUE="$ICON_SRC"
fi

mkdir -p "$HOME/.local/share/applications"
printf '[Desktop Entry]\nName=Nab\nExec=%s\nIcon=%s\nType=Application\nCategories=Graphics;Science;\n' "$LAUNCHER" "$ICON_VALUE" > "$DESKTOP"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Created app menu entry"

cp "$0" "$UNINSTALL"
chmod +x "$UNINSTALL"
echo "Created command: nab-uninstall"

echo ""
echo "Done! Run 'nab' or find 'Nab' in your app menu."
echo "To uninstall: nab-uninstall"
exit 0
