#!/bin/sh
# YuriiNote Simple を最新にする（YuriiNote-Simple --update から呼ばれる。ターミナルで直接実行してもよい）
#   GitHub から最新を取ってきて、部品を確認し、ビルドして、アイコンとメニューの登録を直す。失敗したら、元のまま
set -eu
# 実行中に、このファイルのある場所を入れ替えるので、一時ファイルに写して、そこから続ける
if [ -z "${YN_REEXEC:-}" ]; then T=$(mktemp); cp "$0" "$T"; YN_REEXEC=1 exec sh "$T" "$@"; fi
ROOT="$HOME/.local/share/YuriiNote-simple"
APP="$ROOT/src"
REPO="${YURIINOTE_SIMPLE_REPO:-https://github.com/Yurii7812/YuriiNote-simple.git}"
if [ -d "$ROOT/node/bin" ]; then PATH="$ROOT/node/bin:$PATH"; export PATH; fi
say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
have git || { say "git がありません。入れてから、もう一度実行してください"; exit 1; }
have node && have npm || { say "Node.js がありません。入れてから、もう一度実行してください"; exit 1; }
if pgrep -f "$APP/node_modules/electron" >/dev/null 2>&1; then say "YuriiNote-Simple が動いています。閉じてから、もう一度実行してください"; exit 1; fi

NEW="$ROOT/src-new"; OLD="$ROOT/src-old"
rm -rf "$NEW" "$OLD"
say "最新を取得しています…"
git clone --depth 1 "$REPO" "$NEW"
MOVED=0
if [ -d "$APP/node_modules" ]; then mv "$APP/node_modules" "$NEW/node_modules"; MOVED=1; fi   # 部品は引き継ぐ（足りない分は npm が入れる）
back() { if [ "$MOVED" = 1 ] && [ -d "$NEW/node_modules" ]; then mv "$NEW/node_modules" "$APP/node_modules"; fi; rm -rf "$NEW"; }
cd "$NEW"
say "部品を確認しています…"
if ! { npm install --no-audit --no-fund && npm run build; }; then say "失敗しました。元のまま残しています"; cd "$ROOT"; back; exit 1; fi

# 入れ替え
mv "$APP" "$OLD"; mv "$NEW" "$APP"
rm -rf "$OLD"
cd "$APP"

# アイコンとメニュー
ICON="$APP/build/icon.png"
if [ -f "$ICON" ]; then
  for s in 16 24 32 48 64 128 256 512; do
    d="$HOME/.local/share/icons/hicolor/${s}x${s}/apps"; mkdir -p "$d"
    if have convert; then convert "$ICON" -resize "${s}x${s}" "$d/yuriinote-simple.png"
    elif [ "$s" = 512 ]; then cp "$ICON" "$d/yuriinote-simple.png"; fi
  done
  have gtk-update-icon-cache && gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi
LAUNCH="$HOME/.local/bin/YuriiNote-Simple"
if [ -x "$LAUNCH" ]; then
  ENTRY="[Desktop Entry]
Type=Application
Name=YuriiNote Simple
Comment=Minimal paper-style PKM
Exec=\"$LAUNCH\"
Icon=yuriinote-simple
Terminal=false
Categories=Office;Utility;
StartupNotify=true"
  mkdir -p "$HOME/.local/share/applications"; printf '%s\n' "$ENTRY" > "$HOME/.local/share/applications/yuriinote-simple.desktop"
  [ -f "$HOME/Desktop/YuriiNote Simple.desktop" ] && printf '%s\n' "$ENTRY" > "$HOME/Desktop/YuriiNote Simple.desktop" || true
  have kbuildsycoca6 && kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
fi
say "更新しました: バージョン $(node -p "require('./package.json').version")"
