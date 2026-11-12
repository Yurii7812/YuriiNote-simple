#!/bin/sh
# YuriiNote Simple を、1行で入れる（Linux）:
#   curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/bootstrap.sh | sh
# 本体の install/linux.sh を取ってきて実行するだけ。もう一度実行すると、最新になる（YuriiNote-Simple --update も同じ）
set -eu
RAW="${YURIINOTE_SIMPLE_RAW:-https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main}"
T=$(mktemp)
curl -fsSL "$RAW/install/linux.sh" -o "$T"
exec sh "$T"
