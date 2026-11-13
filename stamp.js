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
const fenceInfo = line => { const m = line.match(/^\s*(?:`{3,}|~{3,})\s*(\S*)/); return m ? m[1] : ''; };   // ``` のあとの言語名（無ければ ''）
// 目印を付けられない行: コード・ボード・mermaid の囲みの中、表の行、区切り線、自動で入る行（日記の「## 今日の記録」などの見出し、リンクだけの行、:ID だけの行）、中身のない箇条書き
const skipLine = line => /^\s*\|/.test(line) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  || /^\s*##\s+(今日の記録|紙の日記|今日のノート)\s*$/.test(line) || /^\s*(-\s+)?!?\[[^\]]*\]\([^)]*\)\s*$/.test(line) || /^\s*(-\s+)?:[0-9a-z]+\s*$/.test(line)
  || /^\s*([-*+]|\d+[.)])\s*(\[[ xX]\])?\s*$/.test(line);
const stampable = line => line.trim() !== '' && !stampOf(line) && !skipLine(line);
// text の中の、まだ日時が無い行すべてに at を付ける（lines: 付ける行番号(0始まり)の集まり。省略で全部）
function add(text, at, lines) {
  // 囲み（```）の中は、言語名が無い（ふつうの文章の引用）ときだけ、行ごとに付ける。mermaid・board・コードの言語つきには付けない
  const out = text.split('\n'); let fence = null, plain = false;
  for (let i = 0; i < out.length; i++) {
    const f = fenceOpen(out[i]);
    if (fence) { if (f && f[0] === fence[0] && f.length >= fence.length && /^\s*[`~]+\s*$/.test(out[i])) { fence = null; plain = false; continue; } if (!plain) continue; }
    else if (f) { fence = f; plain = fenceInfo(out[i]) === ''; continue; }
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
// 画面に出すときの形。fmt: 「全部」（保存したとおり）か、「カスタム」:
//   { y, mo, d, h, mi, s: 出す部分（年・月・日・時・分・秒）, dsep: 日付の区切り（既定 -）, tsep: 時刻の区切り（既定 :）, short: 今日の行は日付を省く }
// 昔の { sec, short } も読める（保存は、いつも「年月日 時:分:秒」）
const ALL = { all: true };
const normFmt = f => {
  if (!f || f.all) return ALL;
  if ('sec' in f && !('s' in f)) return { y: true, mo: true, d: true, h: true, mi: true, s: f.sec !== false, dsep: '-', tsep: ':', short: !!f.short };
  const t = k => f[k] !== false;
  return { y: t('y'), mo: t('mo'), d: t('d'), h: t('h'), mi: t('mi'), s: t('s'), dsep: f.dsep ?? '-', tsep: f.tsep ?? ':', short: !!f.short, ja: !!f.ja, name: f.name };
};
const format = (at, fmt, today = nowStamp().slice(0, 10)) => {
  if (!at) return '';
  const f = normFmt(fmt); if (f.all) return at;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(at); if (!m) return at;
  const date = f.ja ? [f.y && m[1] + '年', f.mo && m[2] + '月', f.d && m[3] + '日'].filter(Boolean).join('') : [f.y && m[1], f.mo && m[2], f.d && m[3]].filter(Boolean).join(f.dsep);
  const time = f.ja ? [f.h && m[4] + '時', f.mi && m[5] + '分', f.s && m[6] && m[6] + '秒'].filter(Boolean).join('') : [f.h && m[4], f.mi && m[5], f.s && m[6]].filter(Boolean).join(f.tsep);   // 秒が無い昔の行は、秒を出さない
  return [f.short && at.slice(0, 10) === today ? '' : date, time].filter(Boolean).join(' ');
};
const show = (at, today) => at ? format(at, { sec: false, short: !!today }, today || undefined) : '';

module.exports = { LEGACY, nowStamp, parse, prefixLen, stampOf, stripLine, strip, body, stampable, add, adoptTimes, migrate, format, normFmt, show };
