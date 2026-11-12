#!/bin/sh
# YuriiNote Simple: user-local Linux installation and update.
# Install: curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/linux.sh | sh
# Update:  ~/.local/bin/YuriiNote-simple --update
# No sudo, no modifications to original YuriiNote or its data.
set -eu

REPO="Yurii7812/YuriiNote-simple"
BASE="$HOME/.local/share/YuriiNote-simple"
SRC="$BASE/src"
NODE_HOME="$BASE/node"
BIN="$HOME/.local/bin/YuriiNote-simple"
APP_ENTRY="$HOME/.local/share/applications/yuriinote-simple.desktop"

say() { printf '%s\n' "$*"; }
fail() { say "エラー: $*" >&2; exit 1; }
has() { command -v "$1" >/dev/null 2>&1; }

[ "$(uname -s)" = "Linux" ] || fail "このスクリプトはLinux専用です。"
[ "$(id -u)" -ne 0 ] || fail "rootでは実行しないでください。sudoも不要です。"
has curl || fail "curlが必要です。Debian/Ubuntuなら: sudo apt install curl"
has tar || fail "tarが必要です。Debian/Ubuntuなら: sudo apt install tar"
has sha256sum || fail "sha256sumが必要です。"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) NODE_PLATFORM="linux-x64" ;;
  aarch64|arm64) NODE_PLATFORM="linux-arm64" ;;
  *) fail "未対応のアーキテクチャ: $ARCH (x86_64 / arm64のみ)" ;;
esac

mkdir -p "$BASE" "$HOME/.local/bin" "$HOME/.local/share/applications"
TMP=$(mktemp -d "$BASE/.install.XXXXXXXX") || fail "作業フォルダを作成できません。"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM

# Prefer system Node.js 22+, otherwise install official archive under HOME.
node_ok() {
  has node && has npm &&
  [ "$(node -p 'parseInt(process.versions.node.split(".")[0],10)' 2>/dev/null || printf 0)" -ge 22 ]
}
if [ -x "$NODE_HOME/bin/node" ]; then
  PATH="$NODE_HOME/bin:$PATH"
  export PATH
fi
if ! node_ok; then
  say "Node.js 22をユーザー領域にインストールします。"
  NODE_URL="https://nodejs.org/dist/latest-v22.x"
  curl --fail --location --silent --show-error "$NODE_URL/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt" ||
    fail "Node.jsのチェックサム取得に失敗しました。"
  ARCHIVE=$(awk -v platform="$NODE_PLATFORM" '$2 ~ "^node-v[0-9]+[.][0-9]+[.][0-9]+-"platform"[.]tar[.]gz$" {print $2; exit}' "$TMP/SHASUMS256.txt")
  [ -n "$ARCHIVE" ] || fail "Node.jsのLinuxパッケージが見つかりません。"
  curl --fail --location --silent --show-error "$NODE_URL/$ARCHIVE" -o "$TMP/$ARCHIVE" ||
    fail "Node.jsのダウンロードに失敗しました。"
  awk -v file="$ARCHIVE" '$2 == file {print; found=1} END {if (!found) exit 1}' "$TMP/SHASUMS256.txt" > "$TMP/expected.sha256" ||
    fail "チェックサムを確認できません。"
  (cd "$TMP" && sha256sum --check --status expected.sha256) ||
    fail "Node.jsの検証に失敗しました。"
  mkdir -p "$TMP/node-new"
  tar -xzf "$TMP/$ARCHIVE" -C "$TMP/node-new" --strip-components=1 ||
    fail "Node.jsの展開に失敗しました。"
  rm -rf "$NODE_HOME"
  mv "$TMP/node-new" "$NODE_HOME"
  PATH="$NODE_HOME/bin:$PATH"
  export PATH
fi

say "YuriiNote Simpleの最新版を取得します。"
curl --fail --location --silent --show-error \
  "https://codeload.github.com/$REPO/tar.gz/refs/heads/main" \
  -o "$TMP/source.tar.gz" || fail "GitHubからソースを取得できません。"
mkdir -p "$TMP/src-new"
tar -xzf "$TMP/source.tar.gz" -C "$TMP/src-new" --strip-components=1 ||
  fail "ソースの展開に失敗しました。"
[ -f "$TMP/src-new/package.json" ] || fail "ソースの内容が不完全です。"
[ -f "$TMP/src-new/main.js" ] || fail "アプリの起動ファイルがありません。"

say "アプリに必要な部品をインストールします。"
(cd "$TMP/src-new" && npm install --no-audit --no-fund) ||
  fail "npm installに失敗しました。ネット接続とエラー表示を確認してください。"
[ -x "$TMP/src-new/node_modules/.bin/electron" ] ||
  fail "Electronのインストールを確認できませんでした。"

# Do not overwrite a working installation until npm install finishes.
if [ -d "$SRC" ]; then mv "$SRC" "$TMP/src-old" || fail "旧版を退避できません。"; fi
if ! mv "$TMP/src-new" "$SRC"; then
  if [ -d "$TMP/src-old" ]; then mv "$TMP/src-old" "$SRC" || :; fi
  fail "アプリを配置できませんでした。"
fi

cat > "$BIN" <<'LAUNCHER'
#!/bin/sh
set -eu
ROOT="$HOME/.local/share/YuriiNote-simple"
APP="$ROOT/src"
if [ -d "$ROOT/node/bin" ]; then PATH="$ROOT/node/bin:$PATH"; export PATH; fi
ARG=""
if [ "$#" -gt 0 ]; then ARG="$1"; fi
case "$ARG" in
  --update)
    [ -f "$APP/install/linux.sh" ] || { echo "インストーラーが見つかりません" >&2; exit 1; }
    exec sh "$APP/install/linux.sh"
    ;;
  --version)
    exec node -p 'require(process.argv[1]).version' "$APP/package.json"
    ;;
  --help|-h)
    printf '%s\n' 'YuriiNote-simple             アプリを起動' \
       'YuriiNote-simple --update    最新版に更新' \
       'YuriiNote-simple --version   バージョンを表示'
    exit 0
    ;;
esac
[ -x "$APP/node_modules/.bin/electron" ] || {
  echo "アプリが見つかりません。再インストールしてください。" >&2
  exit 1
}
exec "$APP/node_modules/.bin/electron" "$APP" "$@"
LAUNCHER
chmod 755 "$BIN"

# FreeDesktop launcher, including XFCE's app menu.
printf '[Desktop Entry]\nType=Application\nName=YuriiNote Simple\nComment=Minimal paper-style PKM\nExec="%s"\nTerminal=false\nCategories=Office;Utility;\nStartupNotify=true\n' \
  "$BIN" > "$APP_ENTRY"
chmod 644 "$APP_ENTRY"

if [ -d "$HOME/Desktop" ]; then
  cp "$APP_ENTRY" "$HOME/Desktop/YuriiNote Simple.desktop"
  chmod 755 "$HOME/Desktop/YuriiNote Simple.desktop"
fi

say ""
say "YuriiNote Simple のインストール／更新が完了しました。"
say "アプリ一覧: YuriiNote Simple"
say "起動: $BIN"
say "更新: $BIN --update"
say "データは元のYuriiNoteとは別の場所に保存されます。"
if ! command -v YuriiNote-simple >/dev/null 2>&1; then
  say "コマンド名だけで起動できない場合は、新しいターミナルを開くか、上記のフルパスで起動してください。"
fi
