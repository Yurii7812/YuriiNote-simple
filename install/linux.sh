#!/bin/sh
# YuriiNote Simple を入れる・最新にする（Linux）。何度実行しても同じ結果になる
#   はじめて:  curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/bootstrap.sh | sh
#   あとから:  YuriiNote-Simple --update
# やること: git と Node.js の用意 → 最新の取得 → 部品とビルド → 起動コマンド・メニュー・アイコン。失敗したら、前の状態のまま
set -eu
# 実行中に、このファイルのある場所を入れ替えるので、一時ファイルに写して、そこから続ける
if [ -z "${YN_REEXEC:-}" ]; then T=$(mktemp); cp "$0" "$T"; YN_REEXEC=1 exec sh "$T" "$@"; fi
ROOT="${YURIINOTE_SIMPLE_ROOT:-$HOME/.local/share/YuriiNote-simple}"
APP="$ROOT/src"
REPO="${YURIINOTE_SIMPLE_REPO:-https://github.com/Yurii7812/YuriiNote-simple.git}"
RAW="${YURIINOTE_SIMPLE_RAW:-https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main}"
BIN="$HOME/.local/bin"; LAUNCH="$BIN/YuriiNote-Simple"
say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" = 0 ] || { have sudo && SUDO=sudo; }
OS=$(uname -s); ARCH=$(uname -m)
[ "$OS" = Linux ] || { say "Linux だけに対応しています"; exit 1; }
mkdir -p "$ROOT" "$BIN"

# ---- git
if ! have git; then
  say "git を入れます"
  if have apt-get; then $SUDO apt-get update && $SUDO apt-get install -y git ca-certificates curl
  elif have dnf; then $SUDO dnf install -y git
  elif have pacman; then $SUDO pacman -S --noconfirm git
  elif have zypper; then $SUDO zypper install -y git
  else say "git を自分で入れてから、もう一度実行してください"; exit 1; fi
fi
# ---- Node.js 18 以上（無ければ、公式の配布物を $ROOT/node に置く。システムは触らない）
[ -d "$ROOT/node/bin" ] && PATH="$ROOT/node/bin:$PATH"
nodeok() { have node && have npm && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! nodeok; then
  say "Node.js を用意します（$ROOT/node）"
  case "$ARCH" in x86_64) P=linux-x64 ;; aarch64|arm64) P=linux-arm64 ;; *) say "$ARCH には対応していません。Node.js 18 以上を入れてください"; exit 1 ;; esac
  V=https://nodejs.org/dist/latest-v22.x
  F=$(curl -fsSL "$V/SHASUMS256.txt" | grep "node-v.*-$P.tar.gz" | head -1 | awk '{print $2}')
  [ -n "$F" ] || { say "Node.js の取得先が見つかりません"; exit 1; }
  T=$(mktemp -d); curl -fL --progress-bar -o "$T/n.tgz" "$V/$F"
  rm -rf "$ROOT/node"; mkdir -p "$ROOT/node"; tar -xzf "$T/n.tgz" -C "$ROOT/node" --strip-components=1; rm -rf "$T"
  PATH="$ROOT/node/bin:$PATH"
fi
export PATH
# ---- 動いていたら、閉じてもらう
if pgrep -f "$APP/node_modules/electron" >/dev/null 2>&1; then say "YuriiNote-Simple が動いています。閉じてから、もう一度実行してください"; exit 1; fi

# ---- 取得・組み立て（入れ替えは、最後に一度だけ）
NEW="$ROOT/src-new"; OLD="$ROOT/src-old"
rm -rf "$NEW" "$OLD"
say "最新を取得しています…"
git clone --depth 1 "$REPO" "$NEW"
MOVED=0
if [ -d "$APP/node_modules" ]; then mv "$APP/node_modules" "$NEW/node_modules"; MOVED=1; fi   # 部品は引き継ぐ（足りない分は npm が入れる）
cd "$NEW"
say "部品を確認して、組み立てています（はじめては数分かかります）…"
if ! { npm install --no-audit --no-fund && npm run build; }; then
  say "失敗しました。前の状態のまま残しています"
  cd "$ROOT"; if [ "$MOVED" = 1 ] && [ -d "$NEW/node_modules" ]; then mv "$NEW/node_modules" "$APP/node_modules"; fi; rm -rf "$NEW"; exit 1
fi
[ -d "$APP" ] && mv "$APP" "$OLD"
mv "$NEW" "$APP"; rm -rf "$OLD"; cd "$APP"

# ---- 起動コマンド
cat > "$LAUNCH" <<'LAUNCHER'
#!/bin/sh
set -eu
ROOT="${YURIINOTE_SIMPLE_ROOT:-$HOME/.local/share/YuriiNote-simple}"
APP="$ROOT/src"
if [ -d "$ROOT/node/bin" ]; then PATH="$ROOT/node/bin:$PATH"; export PATH; fi
ARG=""
if [ "$#" -gt 0 ]; then ARG="$1"; fi
case "$ARG" in
  --update)
    if [ -f "$APP/install/linux.sh" ]; then exec sh "$APP/install/linux.sh"; fi
    exec sh -c 'curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/bootstrap.sh | sh'
    ;;
  --version)
    exec node -p 'require(process.argv[1]).version' "$APP/package.json"
    ;;
  --help|-h)
    printf '%s\n' 'YuriiNote-Simple             アプリを起動' \
       'YuriiNote-Simple --update    最新版に更新' \
       'YuriiNote-Simple --version   バージョンを表示'
    exit 0
    ;;
esac
[ -x "$APP/node_modules/.bin/electron" ] || {
  echo "アプリが見つかりません。次の1行で、入れ直してください:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/bootstrap.sh | sh" >&2
  exit 1
}
exec "$APP/node_modules/.bin/electron" "$APP" "$@"
LAUNCHER
chmod +x "$LAUNCH"

# ---- アイコンとメニュー
ICON="$APP/build/icon.png"
if [ -f "$ICON" ]; then
  for s in 16 24 32 48 64 128 256 512; do
    d="$HOME/.local/share/icons/hicolor/${s}x${s}/apps"; mkdir -p "$d"
    if have convert; then convert "$ICON" -resize "${s}x${s}" "$d/yuriinote-simple.png"
    elif [ "$s" = 512 ]; then cp "$ICON" "$d/yuriinote-simple.png"; fi
  done
  if have gtk-update-icon-cache; then gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true; fi
fi
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
if [ -d "$HOME/Desktop" ]; then printf '%s\n' "$ENTRY" > "$HOME/Desktop/YuriiNote Simple.desktop"; chmod +x "$HOME/Desktop/YuriiNote Simple.desktop"; fi
if have kbuildsycoca6; then kbuildsycoca6 --noincremental >/dev/null 2>&1 || true; fi

say "入れました: バージョン $(node -p "require('./package.json').version")"
case ":$PATH:" in *":$BIN:"*) say "ターミナルで YuriiNote-Simple と打つと開きます。更新は YuriiNote-Simple --update" ;;
  *) say "$BIN が PATH に無いので、ターミナルでは $LAUNCH と打ってください（メニューからも開けます）" ;; esac
