'use strict';
// 行ごとの「年月日＋時刻」。行の先頭に「2026-11-13 12:54 本文」と書いて持つ。画面では、表示のオン・オフを切り替えるだけ。
// コピーして貼っても、日時が見える。見出し（# ）・箇条書き（- ）・引用（> ）・チェックボックスの記号は、そのまま行頭に残し、日時はその後ろに付ける
//   例:  - 2026-11-13 12:54 買い物      ## 2026-11-13 12:54 まとめ
// 昔の形（行末の <!--2026-11-13 12:54-->）も読める
const D = '\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}(?::\\d{2})?';   // 年月日 時:分:秒（昔の「時:分」までも読める）
const LEGACY = new RegExp('[ \\t]*<!--(' + D + ')-->[ \\t]*$');
const PREFIX = /^(\s*(?:>[ \t]?)*(?:#{1,6}[ \t]+|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?)/;
const HEAD = new RegExp('^(' + D + ')(?: |$)');
const pad = n => String(n).padStart(2, '0');
const nowStamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
// 先頭の日時: { p: 記号の長さ, at: 日時, end: 日時（と後ろの空白）の終わり } 。無ければ null
function parse(line) {
  const p = PREFIX.exec(line)[1].length, m = HEAD.exec(line.slice(p));
  return m ? { p, at: m[1], end: p + m[0].length } : null;
}
const prefixLen = line => PREFIX.exec(line)[1].length;
const stampOf = line => { const s = parse(String(line)); if (s) return s.at; const m = String(line).match(LEGACY); return m ? m[1] : ''; };
const stripLine = line => { line = String(line); const s = parse(line); return (s ? line.slice(0, s.p) + line.slice(s.end) : line).replace(LEGACY, ''); };
const strip = text => String(text).split('\n').map(stripLine).join('\n');   // 題・検索・一覧の見出しなど、日時がじゃまなところで使う
const body = line => stripLine(line).trim();   // 日時を除いた中身
const fenceOpen = line => { const m = line.match(/^\s*(`{3,}|~{3,})/); return m ? m[1] : null; };
// 目印を付けられない行: コード・ボード・mermaid の囲みの中、表の行、区切り線、自動で入る行（日記の「## 今日の記録」などの見出し、リンクだけの行、:ID だけの行）、中身のない箇条書き
const skipLine = line => /^\s*\|/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  || /^\s*##\s+(今日の記録|紙の日記|今日のノート)\s*$/.test(line) || /^\s*(-\s+)?!?\[[^\]]*\]\([^)]*\)\s*$/.test(line) || /^\s*(-\s+)?:[0-9a-z]+\s*$/.test(line)
  || /^\s*([-*+]|\d+[.)])\s*(\[[ xX]\])?\s*$/.test(line);
const stampable = line => line.trim() !== '' && !stampOf(line) && !skipLine(line);
// text の中の、まだ日時が無い行すべてに at を付ける（lines: 付ける行番号(0始まり)の集まり。省略で全部）
function add(text, at, lines) {
  const out = text.split('\n'); let fence = null;
  for (let i = 0; i < out.length; i++) {
    const f = fenceOpen(out[i]);
    if (fence) { if (f && f[0] === fence[0] && f.length >= fence.length && /^\s*[`~]+\s*$/.test(out[i])) fence = null; continue; }
    if (f) { fence = f; continue; }
    if (lines && !lines.has(i)) continue;
    if (stampable(out[i])) { const p = prefixLen(out[i]); out[i] = out[i].slice(0, p) + at + ' ' + out[i].slice(p); }
  }
  return out.join('\n');
}
// 昔の形（行末）の日時を、先頭の形に直す
function migrate(text) {
  return text.split('\n').map(l => { const m = l.match(LEGACY); if (!m || parse(l)) return l; const base = l.replace(LEGACY, ''), p = prefixLen(base); return base.slice(0, p) + m[1] + ' ' + base.slice(p); }).join('\n');
}
// 日記・メモ帳に昔あった「13:05 本文」（時刻だけ）の行を、その日の年月日つきにする（date: その日の 2026-11-13）。コード等の囲みの中は変えない
function adoptTimes(text, date) {
  const out = text.split('\n'); let fence = null;
  for (let i = 0; i < out.length; i++) {
    const f = fenceOpen(out[i]);
    if (fence) { if (f && f[0] === fence[0] && f.length >= fence.length && /^\s*[`~]+\s*$/.test(out[i])) fence = null; continue; }
    if (f) { fence = f; continue; }
    const p = prefixLen(out[i]), m = out[i].slice(p).match(/^([01]\d|2[0-3]):([0-5]\d)(?: |$)/);
    if (m && !stampOf(out[i])) out[i] = out[i].slice(0, p) + date + ' ' + m[1] + ':' + m[2] + out[i].slice(p + 5);
  }
  return out.join('\n');
}
// 画面に出すときの形。fmt: { sec: 秒まで出す, short: 今日の行は年月日を省く }（保存は、いつも秒まで）
const format = (at, fmt = {}, today = nowStamp().slice(0, 10)) => {
  if (!at) return '';
  let t = fmt.sec === false ? at.replace(/(\d{2}:\d{2}):\d{2}$/, '$1') : at;
  if (fmt.short && at.slice(0, 10) === today) t = t.slice(11);
  return t;
};
const show = (at, today) => format(at, { sec: false, short: !!today }, today || undefined);

module.exports = { LEGACY, nowStamp, parse, prefixLen, stampOf, stripLine, strip, body, stampable, add, adoptTimes, migrate, format, show };
