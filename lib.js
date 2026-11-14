// YuriiNote の共通処理（main と画面の両方で使う）
// ID: 1 → 並列 1a,1b … → 分岐 1a1 …
const ID = '[0-9]+[a-z0-9]*';
const isId = s => new RegExp('^' + ID + '$').test(s);
const tok = id => id.match(/\d+|[a-z]+/g) || [];

function cmpTok(a, b) {
  const an = /\d/.test(a), bn = /\d/.test(b);
  if (an && bn) return +a - +b;
  if (!an && !bn) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  return an ? -1 : 1;
}
function cmpId(x, y) {
  const a = tok(x), b = tok(y);
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpTok(a[i], b[i]); if (c) return c; }
  return a.length - b.length;
}
function incLetters(s) {
  const c = s.split(''); let i = c.length - 1;
  while (i >= 0) { if (c[i] === 'z') { c[i] = 'a'; i--; } else { c[i] = String.fromCharCode(c[i].charCodeAt(0) + 1); return c.join(''); } }
  return 'a' + c.join('');
}
function sibling(id) { // 並列: 1a→1b, 1→2, 1a1→1a2
  const t = tok(id); if (!t.length) return '1';
  const l = t.pop(); t.push(/\d/.test(l) ? String(+l + 1) : incLetters(l)); return t.join('');
}
function child(id) { // 分岐: 1→1a, 1a→1a1
  const t = tok(id); if (!t.length) return '1';
  return id + (/\d/.test(t[t.length - 1]) ? 'a' : '1');
}
// いちばん近い、実在する祖先（無ければ null）
function parentIn(id, has) {
  const t = tok(id);
  while (t.length > 1) { t.pop(); const p = t.join(''); if (has(p)) return p; }
  return null;
}
const root = id => tok(id)[0] || id;
// '1a(1)' → { id: '1a', n: '1' }（(番号) が無ければ n は undefined）
const splitAnchor = raw => { const m = String(raw).match(/^(.*?)(?:[(（](\d+)[)）])?$/); return { id: m[1], n: m[2] }; };

// ===== 本文のリンク =====
// ->1b（この箇所から 1b へ続く）　1a->（1a からこの箇所へ続く）　->1b,1c,1d　1a,1b->　->1a(2) 1a(2)->（別ノートの (2)）　->(1) (1)->（同じノートの (1)）
// (1) は位置ID。リンクとは別の仕組み（素の (1) は、ただの目印）。昔の :ID と ID: は ->ID と ID-> に直した（colonToArrow）
const A = '(?:->|→)', LP = '[(（]', RP = '[)）]';
const SEP0 = '[,，、]';
const RE = `(?<![0-9A-Za-z])(?:(${A})?(${ID})?${LP}(\\d+)${RP}(${A})?|${A}(${ID})(?![0-9A-Za-z]|-\\d)|(${ID}(?:${SEP0}${ID})*)${A}(?![0-9A-Za-z]))`;
const OLD_C = ':';   // 全角の「：」は、ふつうの句読点（「元：1d-1」など）なので、リンクにしない
const OLD_RE = `(?<![0-9A-Za-z])(?:(${OLD_C})?(${ID})?${LP}(\\d+)${RP}(${OLD_C})?|${OLD_C}(${ID})(?![0-9A-Za-z]|-\\d)|(${ID})${OLD_C}(?![0-9]))`;

const MDLINK = /!?\[[^\]\n]*\]\([^)\s]*\)/g; // [名前](パス) と ![名前](パス)
// コードの範囲（``` で囲んだ行・`コード`・``コード``）。この中は、リンクにしない
function codeRanges(text) {
  const r = []; let pos = 0, open = -1;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { if (open < 0) open = pos; else { r.push([open, pos + line.length]); open = -1; } }
    pos += line.length + 1;
  }
  if (open >= 0) r.push([open, text.length]);
  const inFence = i => r.some(([a, b]) => i >= a && i < b);
  for (const m of text.matchAll(/(`+)[^`\n][^\n]*?\1(?!`)/g)) if (!inFence(m.index)) r.push([m.index, m.index + m[0].length]);
  return r;
}
const SEP = '[,，、]';
// ->1a(p)  ->1a(p)(2)  ->1a(2)(p)  — ID のあとの (p)（紙）・(d)（デジタル）と、(番号)（ノートの中の場所）。書かなければ、いまのノートと同じ側
const SPN = /^[(（]([pdPD])[)）]/, NN = /^[(（](\d+)[)）]/;
// 各リンクは { k:'ref'|'self', ... from, to, text }。矢印は arrow:[from,to]、リストのコンマは sep:[from,to]、向きは dir:'to'（->ID）か 'from'（ID->）
function tokens(text) {
  const re = new RegExp(RE, 'g'), out = [], skip = [...text.matchAll(MDLINK)].map(m => [m.index, m.index + m[0].length]).concat(codeRanges(text)); let m;
  const hit = (a, b) => skip.some(([x, y]) => a < y && b > x);
  // ->2026-10-11（日記）／->2026-10-21-夢（時系列記録の、その日）。ID とは別のトークン（k:'day'）
  const DAY = /->(\d{4}-\d{2}-\d{2})(?:-([^\s,，、。．()（）\[\]「」]+))?/g, days = []; let dm;
  while ((dm = DAY.exec(text))) { if (hit(dm.index, dm.index + dm[0].length)) continue; days.push({ k: 'day', date: dm[1], kind: dm[2] || '日記', from: dm.index, to: dm.index + dm[0].length, text: dm[0] }); }
  const inDay = (a, b) => days.some(d => a < d.to && d.from < b);
  const extend = t => {
    let end = t.to;
    for (let g = 0; g < 2; g++) {
      const rest = text.slice(end); let x;
      if (t.sp === undefined && (x = rest.match(SPN))) { t.sp = x[1].toLowerCase(); end += x[0].length; continue; }
      if (t.n === undefined && (x = rest.match(NN))) { t.n = x[1]; end += x[0].length; continue; }
      break;
    }
    t.to = end; t.text = text.slice(t.from, end); return t;
  };
  const A_OK = 'x', arrowLen = (pos) => text.startsWith('->', pos) ? 2 : text.startsWith('→', pos) ? 1 : 0;
  while ((m = re.exec(text))) {
    if (hit(m.index, m.index + m[0].length) || inDay(m.index, m.index + m[0].length)) continue;
    const [all, c1, id1, n, c2, idB, idC] = m; let t;
    if (idC !== undefined) {   // 1a,1b,1c->  （矢印は最後に一度だけ）
      let p = m.index;
      const parts = idC.split(new RegExp(`(${SEP0})`));
      const ids = []; for (let i = 0; i < parts.length; i += 2) ids.push([parts[i], parts[i + 1] || '']);
      ids.forEach(([id, sep], i) => {
        const last = i === ids.length - 1, to = p + id.length + (last ? arrowLen(p + id.length) : 0);
        const tk = { k: 'ref', id, dir: 'from', from: p, to: last ? to : p + id.length, text: text.slice(p, last ? to : p + id.length) };
        if (last) tk.arrow = [p + id.length, to];
        if (i > 0) tk.sep = [p - 1, p];
        out.push(tk); p += id.length + sep.length;
      });
      re.lastIndex = Math.max(re.lastIndex, m.index + all.length); continue;
    }
    if (n !== undefined) t = id1 ? { k: 'ref', id: id1, n } : { k: 'self', n, bare: !c1 && !c2 };
    else t = { k: 'ref', id: idB };
    t.from = m.index; t.to = m.index + all.length; t.text = all;
    if (t.k === 'ref') extend(t);
    const lead = c1 || (n === undefined ? A_OK : ''), trail = c2;
    if (lead) { t.arrow = [m.index, m.index + arrowLen(m.index)]; t.dir = 'to'; }
    else if (trail) { const al = all.endsWith('->') ? 2 : 1; t.arrow = [t.to - al, t.to]; t.dir = 'from'; }
    out.push(t); re.lastIndex = Math.max(re.lastIndex, t.to);
    if (idB && n === undefined && t.k === 'ref') { // ->1a,1b,1c のように、ひとつの -> で複数のID（それぞれに (p) (番号) もつけられる）
      const more = new RegExp(`^${SEP}(${ID})(?![0-9A-Za-z])`);
      for (let p = t.to, x; (x = text.slice(p).match(more)) && !hit(p, p + x[0].length);) {
        const t2 = extend({ k: 'ref', id: x[1], dir: 'to', from: p + 1, to: p + x[0].length, text: x[1], sep: [p, p + 1] }); out.push(t2); p = t2.to; re.lastIndex = p;
      }
    }
  }
  out.push(...days); out.sort((a, b) => a.from - b.from);
  return out;
}
// 昔の :ID / ID: / :(n) / (n): を、->ID / ID-> / ->(n) / (n)-> に直す（コードやリンクの中は変えない）
function colonToArrow(text) {
  const skip = [...text.matchAll(MDLINK)].map(m => [m.index, m.index + m[0].length]).concat(codeRanges(text));
  const hit = (a, b) => skip.some(([x, y]) => a < y && b > x);
  const re = new RegExp(OLD_RE, 'g'); let out = '', last = 0, m;
  while ((m = re.exec(text))) {
    if (hit(m.index, m.index + m[0].length)) continue;
    const [all, c1, , , c2, idB, idC] = m, lead = !!c1 || idB !== undefined, trail = !!c2 || idC !== undefined;
    let t = all; if (lead) t = '->' + t.slice(1); if (trail) t = t.slice(0, -1) + '->';
    out += text.slice(last, m.index) + t; last = m.index + all.length;
    if (idB !== undefined) {   // :1a,1b,1c のコンマ続きは、そのまま
      const more = new RegExp(`^(?:${SEP}(?:${ID}))*`); const x = text.slice(last).match(more); if (x && x[0]) { out += x[0]; last += x[0].length; re.lastIndex = last; }
    }
  }
  return out + text.slice(last);
}
// colonToArrow のうち、「- :ID」だけの行（昔の日記の「今日のノート」）は、そのままにする
function colonToArrowKeep(text) { return text.split('\n').map(line => /^\s*(-\s+)?:[0-9a-z]+\s*$/.test(line) ? line : null).every(x => x === null) ? colonToArrow(text) : colonToArrowLines(text); }
function colonToArrowLines(text) {   // 行ごとに直す。コードの囲みの中は、まとめて見るため、全体を先に直してから、除外行だけを元に戻す
  const keep = new Set(); const lines = text.split('\n'); lines.forEach((x, i) => { if (/^\s*(-\s+)?:[0-9a-z]+\s*$/.test(x)) keep.add(i); });
  return colonToArrow(text).split('\n').map((x, i) => keep.has(i) ? lines[i] : x).join('\n');
}
// ノートの中で (n) の位置（素の (n) を優先）
function anchorPos(text, n) {
  const s = tokens(text).filter(t => t.k === 'self' && t.n === String(n));
  const b = s.find(t => t.bare) || s[0];
  return b ? b.from : -1;
}
// 同じノートの (n) を押したときの行き先: 素の (n) ⇄ (n): / :(n)
function selfTarget(text, n, bare) {
  const t = tokens(text).find(t => t.k === 'self' && t.n === String(n) && t.bare !== bare);
  return t ? t.from : -1;
}

// 本文 → Markdown（ブラウザでもリンク・(1) へ飛べるように）
function bodyToMd(text, pathOf) {
  const toks = tokens(text), seenA = new Set(), seenB = new Set();
  const has = (n, bare) => toks.some(t => t.k === 'self' && t.n === n && t.bare === bare);
  let out = '', last = 0;
  for (const t of toks) {
    out += text.slice(last, t.from);
    let pre = '', href = null;
    if (t.k === 'ref') href = pathOf(t.id, t.sp) + (t.n ? '#c' + t.n : '');
    else if (t.bare) { // 素の (1) はリンクにせず、赤くして目印だけ
      if (!seenA.has(t.n)) { seenA.add(t.n); pre = `<a id="c${t.n}"></a>`; }
      out += pre + `<span style="color:#c0392b">${t.text}</span>`; last = t.to; continue;
    }
    else { if (!seenB.has(t.n)) { seenB.add(t.n); pre = `<a id="c${t.n}-"></a>`; } if (has(t.n, true)) href = `#c${t.n}`; }
    out += pre + (href ? `[${t.text}](${href})` : t.text);
    last = t.to;
  }
  out += text.slice(last);
  return out.split('\n').map(l => (l.trim() ? l + '  ' : l)).join('\n');
}
// Markdown → 本文（上の逆。自分で書いた普通のリンクは残す）
function mdToBody(md) {
  return md
    .replace(/<a id="c[^"]*"><\/a>/g, '')
    .replace(/<span style="color:#c0392b">([^<]*)<\/span>/g, '$1')
    .replace(/\[([^\]\n]+)\]\(([^)\s]*)\)/g, (all, t, href, at, whole) => {
      const k = tokens(t);
      if (k.length === 1 && k[0].from === 0 && k[0].to === t.length) return t;
      // ->1a,1b,1c や 1a,1b,1c-> の、矢印の付かない ID（コンマの前後）も、リンクの外へ戻す
      if (new RegExp('^' + ID + '(?:[(（](?:\\d+|[pdPD])[)）]){0,2}$').test(t) && /(?:\.md|#)(?:#c\d+)?$|^#/.test(href) && (/[,，、]$/.test(whole.slice(0, at)) || /^[,，、]/.test(whole.slice(at + all.length)))) return t;
      return all;
    })
    .split('\n').map(l => l.replace(/ {2}$/, '')).join('\n')
    .replace(/\n+$/, '');
}

// ===== エクスポート（複数のノートを1つの Markdown に）=====
// ids（同じ s の ID の並び）のうち、from 〜 to（番号順）の範囲
function fzRange(ids, from, to) {
  let a = from, b = to; if (cmpId(a, b) > 0) [a, b] = [b, a];
  return ids.filter(i => cmpId(i, a) >= 0 && cmpId(i, b) <= 0);
}
// root とその子孫（1a → 1a, 1a1, 1a2b …）
function fzSubtree(ids, root) {
  const r = tok(root);
  return ids.filter(i => { const t = tok(i); return t.length >= r.length && r.every((x, k) => t[k] === x); });
}
// ===== ID を変えたとき、子や孫も一緒に（子は、子のまま、新しい ID の下へ） =====
const numToLet = n => { let s = '', k = +n; while (k > 0) { k--; s = String.fromCharCode(97 + k % 26) + s; k = Math.floor(k / 26); } return s; };
const letToNum = s => [...s].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 96), 0);
// ids: そのノート群の、IDつきのIDすべて。from の部分木（from 自身・子・孫…）を、to の下へ移す対応表（旧→新）。
// from と to の終わりが、数字と文字で違うときは、子の段の数字⇄文字も、入れ替える（1a → 5 なら、1a1 → 5a、1a1a → 5a1）
function remapSubtree(ids, from, to) {
  const map = new Map(), ft = tok(from), tt = tok(to);
  if (!ft.length || !tt.length) return map;
  const flip = /\d/.test(ft[ft.length - 1]) !== /\d/.test(tt[tt.length - 1]);
  for (const id of fzSubtree(ids, from)) {
    const suffix = tok(id).slice(ft.length);
    map.set(id, to + suffix.map(t => !flip ? t : /\d/.test(t) ? numToLet(t) : String(letToNum(t))).join(''));
  }
  return map;
}
// 本文の中の ->ID（own: 本文があるノートの側）を、対応表で書き換える。s: 対応表の側（'d' か 'p'）
function remapRefs(text, own, s, map) {
  let out = '', last = 0;
  for (const t of tokens(text || '')) {
    if (t.k !== 'ref' || (t.sp || own) !== s || !map.has(t.id) || map.get(t.id) === t.id) continue;
    const seg = String(text).slice(t.from, t.to), i = seg.indexOf(t.id); if (i < 0) continue;
    out += String(text).slice(last, t.from) + seg.slice(0, i) + map.get(t.id) + seg.slice(i + t.id.length); last = t.to;
  }
  return out + String(text || '').slice(last);
}
// 索引の本文の、IDの部分を、対応表で書き換える（紙とデジタルの側の印を見て、s の側のIDだけ）
function remapTopicText(text, map, s, def) {
  return String(text || '').split('\n').map(line => {
    const r = topicLine(line), edits = [];
    for (const x of r.ids || []) if ((x.sp || def) === s && map.has(x.id)) edits.push([x.from, x.id, map.get(x.id)]);
    if (r.ref && (r.ref.sp || def) === s && map.has(r.ref.id)) edits.push([r.ref.from, r.ref.id, map.get(r.ref.id)]);
    let out = line;
    for (const [at, oldId, newId] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, at) + newId + out.slice(at + oldId.length);
    return out;
  }).join('\n');
}
// items: [{s,id,title,body,noid,created}]（出す順）。選んだノートの中を指すリンクだけ生かし、外へのリンクは普通の文字にする
function exportMd(items) {
  const has = new Set(items.filter(n => !n.noid).map(n => n.s + ':' + n.id));
  const plain = (body, s) => {
    const toks = tokens(body).filter(t => t.k === 'ref' && !has.has(s + ':' + t.id)).sort((a, b) => b.from - a.from);
    let out = body; for (const t of toks) out = out.slice(0, t.from) + t.text.replace(/->|→/g, '') + out.slice(t.to);
    return out;
  };
  return items.map(n => {
    const label = n.noid ? '（IDなし）' : (n.s === 'p' ? '紙 ' : '') + n.id;
    return `## ${label}${n.title ? ' ' + n.title : ''}\n\n${plain((n.body || '').trim(), n.s)}`;
  }).join('\n\n---\n\n') + '\n';
}

// ===== 索引 =====
// 1行 = 「キーワード ID ID …」。
//   ^キーワード ID は、上位トピック（↑）。|> 名前 ID（↳・昔の + ★ も同じ）は、独立したもの（独立させた別の索引）への案内。
//   _名前 ID は、下位トピック（↓）。<| 名前 ID（↰）は、独立前（独立する前の、元の索引）への案内。@まとめ は ◯（まとめ・進捗などの見出し。昔の *まとめ も同じ）。どれも行の先頭に書く
//   行の終わりの「0-1」「3-2」のような番号は、その番号の索引（グループIndex など）へのリンク。番号の前の * は、赤い点（その行の入口の目印）。例: PKM *1 1a
// 行の ID: 1a  1a(2)  1a(p)  1a(p)(2)  1a(2)(p)  — (p)（紙）(d)（デジタル）は、書かなければ、その索引 の親と同じ側
const IDTOK = new RegExp('^(' + ID + ')((?:[(（](?:\\d+|[pdPD])[)）]){0,2})$');
function parseIdTok(tok) {
  const m = tok.match(IDTOK); if (!m) return null;
  let sp, n; for (const g of m[2].matchAll(/[(（](\d+|[pdPD])[)）]/g)) { if (/^\d+$/.test(g[1])) { if (n === undefined) n = g[1]; } else if (sp === undefined) sp = g[1].toLowerCase(); }
  return { id: m[1], n, sp, raw: m[1] + (n ? `(${n})` : ''), tok };
}
const defOf = t => t && t.entry && t.entry.s === 'p' ? 'p' : 'd';   // 索引 の、印なしの側（親が紙なら紙）
// 索引の行頭の印（画面に出す絵文字。ファイルの中は ^ _ |> <| @ * のまま。絵文字を直接書いても同じ）
const TMARK = { up: '⬆️', down: '⬇️', ref: '↪️', before: '↩️', mark: '⭕', star: '⭐', dot: '🔴' };
function topicLine(line) {
  const at = line.match(/^(\s*(?:[@＠]|⭕\uFE0F?)\s*)(.+?)\s*$/);   // @まとめ → ◯ の見出し
  if (at) { const r = rowOf(at[2], at[1].length); return { mark: r.kw, ids: r.ids, tnos: r.tnos, from: at[1].length, to: at[1].length + at[2].length }; }   // @まとめ ID … のように、番号を続けてもよい（見出しの行になる）
  const b = line.match(/^(\s*(?:↰|<\||↖\uFE0F?|↩\uFE0F?)\s*)(.+?)\s*$/);   // <| 名前 ID（↰）→ 独立前（元の索引）
  if (b) { const r = rowOf(b[2], b[1].length); return { before: r.kw, ids: r.ids, tnos: r.tnos, from: b[1].length, to: b[1].length + b[2].length }; }
  const u = line.match(/^(\s*(?:[\^＾↑]|⬆\uFE0F?)\s*)(.+?)\s*$/);   // ^キーワード ID → 上位トピック（↑）
  if (u) { const r = rowOf(u[2], u[1].length); return { up: r.kw, ids: r.ids, tnos: r.tnos, from: u[1].length, to: u[1].length + u[2].length }; }
  const dn = line.match(/^(\s*(?:[_＿↓]|⬇\uFE0F?)\s*)(.+?)\s*$/);   // _名前 ID → 下位トピック（↓）
  if (dn) { const r = rowOf(dn[2], dn[1].length); return { down: r.kw, ids: r.ids, tnos: r.tnos, from: dn[1].length, to: dn[1].length + dn[2].length }; }   // ^キーワード ID …（IDは書かなくてもよい）
  const mk = line.match(/^(\s*[*＊]\s*)(.+?)\s*$/);   // 昔の *まとめ も ◯ の見出し（*1a のように、すぐあとが番号のときは、行の中の赤い点なので、ここでは読まない）
  if (mk && !parseIdTok(mk[2].split(/\s+/)[0])) return { mark: mk[2], from: mk[1].length, to: mk[1].length + mk[2].length, ids: [] };
  // |> ↪️ ↳（独立したもの）: 名前 ID → 独立した索引への案内
  const ind = line.match(/^(\s*(?:↳|\|>|↘\uFE0F?|↪\uFE0F?)\s*)(.*?)\s*$/);
  if (ind) {
    const ps = [...ind[2].matchAll(/\S+/g)], last = ps[ps.length - 1], pt = last && parseIdTok(last[0]);
    if (ps.length >= 2 && pt) {
      const at = ind[1].length + last.index;
      return { star: '', ref: { label: ind[2].slice(0, last.index).trim(), id: pt.id, sp: pt.sp, from: at, to: at + last[0].length }, from: ind[1].length, to: ind[1].length + ind[2].length, ids: [] };
    }
    return { star: ind[2], from: ind[1].length, to: ind[1].length + ind[2].length, ids: [] };
  }
  // ⭐ + ★ ☆ ＋（関連）: 名前だけなら、その索引への案内。名前 ID … なら、分類の外だが関連するキーワードの行
  const s = line.match(/^(\s*(?:[★☆+＋]|⭐\uFE0F?)\s*)(.*?)\s*$/);
  if (s) {
    const r = rowOf(s[2], s[1].length);
    if (r.kw && (r.ids.length || (r.tnos || []).length)) return { star: '', rel: { kw: r.kw }, ids: r.ids, tnos: r.tnos, from: s[1].length, to: s[1].length + s[2].length };
    return { star: s[2], from: s[1].length, to: s[1].length + s[2].length, ids: [] };
  }
  return rowOf(line, 0);
}
// 「キーワード ID ID …」の 1 行（base は、行の先頭からの位置）
function rowOf(line, base) {
  const parts = [...line.matchAll(/[^\s,、，]+/g)], ids = [], tnos = [];
  let i = parts.length - 1, pt;
  while (i >= 0) {
    const t = parts[i][0], from = base + parts[i].index;
    if (/^\d+[a-z0-9]*-\d+$/.test(t)) { tnos.unshift({ tno: t, from, to: from + t.length }); i--; continue; }   // 0-1 のような、索引の番号（その索引へのリンク）
    const dot = /^[*＊]./.test(t), bare = dot ? t.slice(1) : t;   // 番号の前の * は、赤い点（入口の目印）
    if (!(pt = parseIdTok(bare))) break;
    ids.unshift(dot ? { ...pt, tok: t, dot: true, dotAt: from, from: from + 1, to: from + t.length } : { ...pt, from, to: from + t.length }); i--;
  }
  const kw = i >= 0 ? line.slice(0, parts[i].index + parts[i][0].length).trim() : '';
  return { kw, ids, tnos };
}
// 昔の「デジタル欄・紙欄」の 2 つの文字を、1 つの文字に（印なしの側と違う ID に、(p) か (d) を付ける）
function legacyTopicText(t) {
  const def = defOf(t), out = [];
  for (const sp of ['d', 'p']) for (const line of (t[sp] || '').split('\n')) {
    const r = topicLine(line);
    if (r.rel && sp !== def) { out.push(line.slice(0, r.from) + r.rel.kw + ' ' + r.ids.map(x => x.raw + (x.sp ? '' : `(${sp})`)).join(' ')); continue; }
    if (r.ref && sp !== def && r.ref.sp === undefined) { out.push(line.slice(0, r.ref.to) + `(${sp})` + line.slice(r.ref.to)); continue; }   // 「+名前 ID」の星も、側を付ける
    if (r.star !== undefined || r.up !== undefined || r.before !== undefined || r.down !== undefined || r.mark !== undefined || (!r.ids.length && !(r.tnos || []).length)) { if (line.trim()) out.push(line); continue; }
    out.push(r.kw + ' ' + r.ids.map(x => x.raw + (sp !== def ? `(${sp})` : '')).join(' '));
  }
  return out.join('\n');
}
const topicText = t => t.text !== undefined ? t.text : legacyTopicText(t);
// 表示用に: [{kw, d:[ids], p:[ids]}], stars, refs。(p) (d) の印で、紙とデジタルに分ける
function mergeTopic(t) {
  const m = new Map(), stars = [], refs = [], chats = [], ups = [], downs = [], befores = [], marks = [], rels = [], order = [], def = defOf(t);   // order: 書いた順（行ごとの印も、ふつうの行も）
  for (const line of topicText(t).split('\n')) {
    const r = topicLine(line);
    // 紙のIndex と デジタルのIndex は、交わらない。別の側の ID は、⭐（関連）の行として、見せるだけ（⭐ の行そのものは、側をまたいでよい）
    if (!r.rel && !r.chat) {
      const cross = (r.ids || []).filter(x => (x.sp || def) !== def), crossRef = r.ref && (r.ref.sp || def) !== def;
      if (cross.length || crossRef) {
        const label = crossRef ? r.ref.label : (r.up !== undefined ? r.up : r.down !== undefined ? r.down : r.before !== undefined ? r.before : r.mark !== undefined ? r.mark : r.kw) || '';
        const o = { kw: label, ids: crossRef ? [{ s: r.ref.sp, id: r.ref.id, raw: r.ref.id }] : cross.map(i => ({ s: i.sp || def, id: i.id, raw: i.raw })), tnos: [], auto: true };
        rels.push(o); order.push({ k: 'rel', o });
        if (crossRef) continue;
        r.ids = r.ids.filter(x => (x.sp || def) === def);
        if (!r.ids.length && r.up === undefined && r.down === undefined && r.before === undefined && r.mark === undefined && !(r.tnos || []).length) continue;
      }
    }
    if (r.chat) { if (!chats.includes(r.chat)) chats.push(r.chat); continue; }
    if (r.rel) { const o = { kw: r.rel.kw, ids: r.ids.map(i => ({ s: i.sp || def, id: i.id, raw: i.raw })), tnos: (r.tnos || []).map(x => x.tno) }; rels.push(o); order.push({ k: 'rel', o }); continue; }
    if (r.ref) { const s = r.ref.sp || def; if (!refs.some(x => x.s === s && x.id === r.ref.id && x.label === r.ref.label)) { const o = { s, label: r.ref.label, id: r.ref.id }; refs.push(o); order.push({ k: 'ref', o }); } continue; }
    if (r.up !== undefined) { if (!ups.some(x => x.kw === r.up && x.ids.map(i => i.raw).join() === r.ids.map(i => i.raw).join())) { const o = { kw: r.up, ids: r.ids.map(i => ({ s: i.sp || def, id: i.id, raw: i.raw })), tnos: (r.tnos || []).map(x => x.tno) }; ups.push(o); order.push({ k: 'up', o }); } continue; }
    if (r.down !== undefined) { if (!downs.some(x => x.kw === r.down && x.ids.map(i => i.raw).join() === r.ids.map(i => i.raw).join())) { const o = { kw: r.down, ids: r.ids.map(i => ({ s: i.sp || def, id: i.id, raw: i.raw })), tnos: (r.tnos || []).map(x => x.tno) }; downs.push(o); order.push({ k: 'down', o }); } continue; }
    if (r.before !== undefined) { if (!befores.some(x => x.kw === r.before && x.ids.map(i => i.raw).join() === r.ids.map(i => i.raw).join())) { const o = { kw: r.before, ids: r.ids.map(i => ({ s: i.sp || def, id: i.id, raw: i.raw })), tnos: (r.tnos || []).map(x => x.tno) }; befores.push(o); order.push({ k: 'before', o }); } continue; }
    if (r.mark !== undefined && !r.ids.length && !(r.tnos || []).length) { marks.push(r.mark); order.push({ k: 'mark', o: r.mark }); continue; }
    if (r.star !== undefined) { if (r.star && !stars.includes(r.star)) { stars.push(r.star); order.push({ k: 'star', o: r.star }); } continue; }
    if (!r.kw && !r.ids.length && !(r.tnos || []).length) continue;
    const k = (r.mark !== undefined ? r.mark : r.kw) || '';
    if (!m.has(k)) { m.set(k, { kw: k, d: [], p: [], t: [] }); order.push({ k: 'row', o: m.get(k) }); }
    if (r.mark !== undefined) m.get(k).mark = true;
    for (const x of r.tnos || []) if (!m.get(k).t.includes(x.tno)) m.get(k).t.push(x.tno);
    for (const x of r.ids) { const s = x.sp || def; if (!m.get(k)[s].includes(x.raw)) m.get(k)[s].push(x.raw); if (x.dot && !m.get(k).dot) m.get(k).dot = { s, id: x.id }; }   // 並びには (番号) つきのまま入れる
  }
  for (let i = 0; i + 1 < order.length; i++) if (order[i].k === 'rel' && order[i].o.auto && !(order[i + 1].k === 'rel' && order[i + 1].o.auto)) { [order[i], order[i + 1]] = [order[i + 1], order[i]]; i++; }   // 別の側のIDの ⭐ は、その行の、すぐ後ろに
  return { rows: [...m.values()], stars, refs, chats, ups, downs, befores, marks, rels, order };
}

// 索引 の文字に「キーワード ID」を足す（同じキーワードの行があればその行の後ろに）。ID は 1a や 1a(p) のように、印つきで
function addToTopic(text, kw, tok) {
  const lines = text ? text.split('\n') : [];
  for (let i = 0; i < lines.length; i++) {
    const r = topicLine(lines[i]);
    if (r.star !== undefined || r.up !== undefined || r.before !== undefined || r.down !== undefined || r.mark !== undefined || r.kw !== kw) continue;
    if (!r.ids.some(x => x.tok === tok)) lines[i] = lines[i].replace(/\s+$/, '') + ' ' + tok;
    return lines.join('\n');
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  lines.push(kw + ' ' + tok);
  return lines.join('\n');
}

// 読み: カタカナ → ひらがな
const toHira = s => (s || '').replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
// 読みの頭が何行か（紙の索引の並び）。かな以外は「英数・他」
const ROWS = ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ'];
const ROW_OF = {}; 'あいうえおぁぃぅぇぉゔ|かきくけこ|さしすせそ|たちつてとっ|なにぬねの|はひふへほ|まみむめも|やゆよゃゅょ|らりるれろ|わをんゎ'.split('|').forEach((g, i) => { for (const c of g) ROW_OF[c] = ROWS[i]; });
function kanaRow(reading) {
  const c = toHira(reading).normalize('NFD').replace(/[\u3099\u309a]/g, '').charAt(0);
  return ROW_OF[c] || '英数・他';
}
const rowIdx = r => { const i = ROWS.indexOf(kanaRow(r)); return i < 0 ? 99 : i; }; // 英数・他は最後
const byReading = rd => (a, b) => { const x = rd(a) || a, y = rd(b) || b; return rowIdx(x) - rowIdx(y) || x.localeCompare(y, 'ja'); };

// 索引 の文字から ID を外す（ID が無くなった行は消す）。items: [{s, id}]（紙かデジタルかも見る）。def は、印なしの側
function removeFromTopic(text, items, def = 'd') {
  const gone = x => items.some(it => it.id === x.id && it.s === (x.sp || def));
  return (text || '').split('\n').flatMap(line => {
    const r = topicLine(line);
    if (r.star !== undefined || r.up !== undefined || r.before !== undefined || r.down !== undefined || r.mark !== undefined || !r.ids.some(gone)) return [line];
    const keep = r.ids.filter(x => !gone(x));
    return keep.length ? [r.kw + ' ' + keep.map(x => x.tok).join(' ')] : [];
  }).join('\n');
}

// ===== 日記 =====
// 日付が変わる時刻は朝5時（Gnosis と同じ）。夜中の3時のメモは前の日の日記に入る
let DAY_START = 5;   // 日付が変わる時刻（設定で変えられる）
const setDayStart = h => { DAY_START = Math.max(0, Math.min(12, Math.floor(+h) || 0)); };
const pad2 = x => String(x).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = (now = new Date()) => { const d = new Date(now); d.setHours(d.getHours() - DAY_START); return ymd(d); };
// 暦の今日（0 時になったら変わる）。Ctrl+D の今日の日記は、日付の区切り時刻の設定に関係なくこれを使う
const calendarToday = (now = new Date()) => ymd(new Date(now));
function dayOf(created) { // 'YYYY-MM-DD HH:MM' → 日記の日付
  const m = (created || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/); if (!m) return '';
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)); d.setHours(d.getHours() - DAY_START); return ymd(d);
}
const WD = ['日', '月', '火', '水', '木', '金', '土'];
const weekday = date => { const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? WD[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : ''; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
// 本文の「## 見出し」の節の最後に1行を足す。節が無ければ作る（「紙の日記」は必ず最後、ほかはその前）
const SS = require('./stamp'), tl = x => SS.stripLine(x).trim();   // 行末の時刻の目印を無視して比べる
function addToSection(body, heading, line) {
  const H = '## ' + heading, lines = body ? body.split('\n') : [];
  const norm = x => x.trim().replace(/^-\s+/, '');
  if (lines.some(l => norm(l) === norm(line))) return body;
  const i = lines.findIndex(l => tl(l) === H);
  if (i < 0) {
    // 並びは、本文、紙の日記、今日のノートの順。紙の日記は「今日のノート」の前に、それ以外は最後に
    const notes = lines.findIndex(l => tl(l) === '## 今日のノート');
    if (heading === '紙の日記' && notes >= 0) { lines.splice(notes, 0, H, '', line, ''); return lines.join('\n'); }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return (lines.length ? lines.join('\n') + '\n\n' : '') + H + '\n\n' + line;
  }
  let j = i + 1; while (j < lines.length && !/^##\s/.test(lines[j])) j++;
  let k = j; while (k > i + 1 && !lines[k - 1].trim()) k--;
  lines.splice(k, 0, line); return lines.join('\n');
}
// 日の本文の並び: 今日の記録、書いた文章、「## 紙の日記」、「## 今日のノート」。書いた文章は、いつも上
function normDay(body) {
  const lines = (body || '').split('\n');
  const pi = lines.findIndex(l => tl(l) === '## 紙の日記'), ni = lines.findIndex(l => tl(l) === '## 今日のノート');
  if (pi < 0 && ni < 0) return body;
  const range = (i, item) => { let j = i + 1; while (j < lines.length && (item ? (!lines[j].trim() || item.test(lines[j])) : !/^##\s/.test(lines[j]))) j++; return [i, j]; };
  const paper = pi >= 0 ? range(pi, null) : null;
  const notes = ni >= 0 ? range(ni, /^\s*(-\s+)?(\[[^\]]*\]\([^)]*\)|:[0-9a-z]+)\s*$/) : null;
  const inside = i => (paper && i >= paper[0] && i < paper[1]) || (notes && i >= notes[0] && i < notes[1]);
  const rest = lines.filter((_, i) => !inside(i)), take = r => r ? lines.slice(r[0], r[1]).join('\n').replace(/\s+$/, '') : '';
  return [rest.join('\n').replace(/\s+$/, ''), take(paper), take(notes)].filter(Boolean).join('\n\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
}
// 年・月・日の階層（Gnosis 同様: 月はいつも、年は2つ以上の年にまたがってから）
function diaryTree(dates) {
  const sorted = [...dates].sort().reverse(), years = new Set(sorted.map(d => d.slice(0, 4)));
  const months = new Map();
  for (const d of sorted) { const m = d.slice(0, 7); if (!months.has(m)) months.set(m, []); months.get(m).push(d); }
  if (years.size < 2) return [...months].map(([m, ds]) => ({ label: m, days: ds }));
  const out = new Map();
  for (const [m, ds] of months) { const y = m.slice(0, 4); if (!out.has(y)) out.set(y, []); out.get(y).push({ label: m, days: ds }); }
  return [...out].map(([y, ms]) => ({ label: y, months: ms }));
}

// ===== IDなしのノート（とりあえず書いて、あとで整理する）=====
// ファイル名は D_u20261107-143521.md のように日時。ID の形（数字で始まる）と区別できる
// 新しい名前は 20261108073511（YYYYMMDDHHmmss）。昔の u20261107-143521 も IDなしとして読む
const NOID = /^(?:\d{14}(?:-\d+)?|u\d{8}-\d{6}(?:-\d+)?)$/;
const isNoid = s => NOID.test(s);
const noidStem = (d = new Date()) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
const STEM = /^\d{14}(?:-\d+)?$/;   // ノートのファイル名（拡張子なし）
const isStem = s => STEM.test(s);

// ===== YAML（ファイルの先頭の --- で囲んだ部分）=====
// 値は JSON の形で書く（YAML としても正しい）。手で書いた plain な値と [a, b] も読む
function fmParse(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { meta: null, rest: text };
  const meta = {};
  for (const l of m[1].split(/\r?\n/)) {
    const i = l.indexOf(':'); if (i <= 0 || /^\s/.test(l)) continue;
    const k = l.slice(0, i).trim(), v = l.slice(i + 1).trim();
    let x; try { x = JSON.parse(v); } catch {
      x = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(/[,、]/).map(y => y.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : v.replace(/^["']|["']$/g, '');
    }
    meta[k] = x;
  }
  return { meta, rest: text.slice(m[0].length) };
}
const fmDump = o => '---\n' + Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n';

// ===== ノートの種類: text（文章）/ rp（なりきりチャット）/ canvas（キャンバス）=====
// なりきり・キャンバスはデータ（data）を持ち、本文はそこから作る（検索やMarkdownで文字が見えるように）
const KINDS = { text: '', rp: '🎭', canvas: '🗺', 'memo-group': '💬 ノート化' };
function deriveBody(kind, data) {
  data = data || {};
  if (kind === 'rp') {
    const cast = data.cast || [];
    return `# ${data.title || '会話'}\n\n` + (data.messages || []).map(m => {
      const r = cast.find(x => x.id === m.role) || { name: m.name || '?' };
      const q = m.quote ? `> 引用: ${m.quote.kind === 'note' ? `ノート ${m.quote.id}` : `会話「${m.quote.title}」`}\n` : '';
      return `**${r.name}**: ${q}${m.text || ''}`.trim();
    }).join('\n\n');
  }
  if (kind === 'canvas') {
    const ns = [...(data.nodes || [])].sort((a, b) => a.y - b.y || a.x - b.x);
    return `# ${data.title || 'キャンバス'}\n\n` + ns.map(n => n.type === 'text' ? (n.text || '') : n.type === 'note' && n.s === 'd' ? `:${n.nid}` : '').filter(Boolean).join('\n\n');
  }
  return '';
}

const kwAnchor = k => { let h = 5381; for (const c of k) h = (h * 33 + c.codePointAt(0)) >>> 0; return 'k-' + h.toString(36); };
const fileName = name => name.replace(/[\\/:*?"<>|#%]/g, '_');
const splitKw = s => (s || '').split(/[,、，]/).map(x => x.trim()).filter(Boolean);
const now = (d = new Date()) => {
  const p = x => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const parseTime = c => { const m = (c || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null; };

module.exports = { TMARK, colonToArrow, colonToArrowKeep,
  codeRanges, MDLINK, ID, isId, splitAnchor, tok, cmpId, sibling, child, parentIn, root,
  tokens, anchorPos, selfTarget, bodyToMd, mdToBody,
  fzRange, fzSubtree, remapSubtree, remapRefs, remapTopicText, exportMd, defOf, topicText, legacyTopicText, parseIdTok, isNoid, noidStem, isStem, STEM, fmParse, fmDump, parseTime, KINDS, deriveBody, setDayStart, todayStr, calendarToday, dayOf, weekday, isDate, addToSection, normDay, diaryTree, topicLine, mergeTopic, addToTopic, removeFromTopic, toHira, kanaRow, ROWS, byReading, kwAnchor, fileName, splitKw, now
};
