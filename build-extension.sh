#!/bin/bash
# TaskFlow Chrome拡張機能ビルドスクリプト
# 共有ファイル + 拡張専用ファイルを dist/ にまとめる

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/dist"

echo "=== TaskFlow Extension Build ==="

# クリーン
rm -rf "$DIST"
mkdir -p "$DIST/icons"

# 共有ファイルをコピー (firebase-sync.jsは拡張版を使う)
cp "$SCRIPT_DIR/app.js"           "$DIST/"
cp "$SCRIPT_DIR/styles.css"       "$DIST/"
cp "$SCRIPT_DIR/icons/"*          "$DIST/icons/"

# 拡張専用ファイルをコピー
cp "$SCRIPT_DIR/extension/tab.html"         "$DIST/"
cp "$SCRIPT_DIR/extension/manifest.json"    "$DIST/"
cp "$SCRIPT_DIR/extension/background.js"    "$DIST/"
cp "$SCRIPT_DIR/extension/calendar.js"      "$DIST/"
cp "$SCRIPT_DIR/extension/firebase-sync.js" "$DIST/"

echo "Done! Load '$DIST' as unpacked extension in Chrome."
echo "Files:"
ls -la "$DIST"
