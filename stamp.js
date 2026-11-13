'use strict';
// 行ごとの「年月日＋時刻」。本文の行末に <!--2026-11-13 13:05--> として持ち、画面では表示のオン・オフを切り替えるだけ。
// 行頭の書き方（# 見出し・- 箇条書き・[ ]）やリンクを壊さず、ほかの Markdown アプリでは見えない。
const RE = /[ \t]*<!--(\d{4}-\d{2}-\d{2} \d{2}:\d{2})-->[ \t]*$/;
const pad = n => String(n).padStart(2, '0');
const nowStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const stampOf = line => { const m = String(line).match(RE); return m ? m[1] : ''; };
const stripLine = line => String(line).replace(RE, '');
const strip = text => String(text).split('\n').map(stripLine).join('\n');   // 題・検索・一覧の見出しなど、目印がじゃまなところで使う
const stampable = line => line.trim() !== '' && !RE.test(line);
const fenceOpen = line => { const m = line.match(/^\s*(`{3,}|~{3,})/); return m ? m[1] : null; };
// 目印を付けられない行: コード・ボード・mermaid の囲みの中、表の行、区切り線
const skipLine = (line, inFence) => inFence || /^\s*\|/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line);
// text の中の、まだ目印が無い行すべてに at を付ける（lines: 付ける行番号(0始まり)の集まり。省略で全部）
function add(text, at, lines) {
  const out = text.split('\n'); let fence = null;
  for (let i = 0; i < out.length; i++) {
    const f = fenceOpen(out[i]);
    if (fence) { if (f && f[0] === fence[0] && f.length >= fence.length && /^\s*[`~]+\s*$/.test(out[i])) fence = null; continue; }
    if (f) { fence = f; continue; }
    if (lines && !lines.has(i)) continue;
    if (stampable(out[i]) && !skipLine(out[i], false)) out[i] = out[i].replace(/[ \t]+$/, '') + ` <!--${at}-->`;
  }
  return out.join('\n');
}
// 画面に出すときの形。同じ日なら時刻だけ（today を渡したとき）、そうでなければ年月日と時刻
const show = (at, today) => at ? (today && at.slice(0, 10) === today ? at.slice(11) : at) : '';

module.exports = { RE, nowStamp, stampOf, stripLine, strip, add, show };
