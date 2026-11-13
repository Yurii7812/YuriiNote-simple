// 検索の書き方（演算子）。ふつうの検索（左上の検索欄）でも使える。
//   a b            両方を含む（空白は AND）          a OR b / a | b   どちらかを含む（OR は AND より先に結びつく）
//   "a b"          その並びのまま                    -a / !a / NOT a   含まない          ( ) でグループ
//   id:1a          ID が 1a で始まる                  fz:1a            1a と、その子孫（1a1, 1a2b …）
//   kw:GUI         キーワードに GUI               title:題 / body:本文   題・本文だけ
//   date:2026-11 / date:2026-11-01..2026-11-13   作った日    updated:…   更新した日
//   is:paper / is:digital / is:noid               紙・デジタル・IDなし        has:kw / has:link / has:title
// 検索語は、大文字小文字を区別しない。値には "…" を付けると、空白も含められる
import L from '../lib.js';

const FIELDS = { id: 'id', fz: 'fz', folgezettel: 'fz', kw: 'kw', keyword: 'kw', 'キーワード': 'kw', title: 'title', '題': 'title', 'タイトル': 'title', body: 'body', '本文': 'body', date: 'date', created: 'date', '日付': 'date', updated: 'updated', '更新': 'updated', is: 'is', has: 'has' };

function lex(q) {
  const out = []; let i = 0; const s = String(q || '');
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    if (c === '|') { out.push({ t: 'OR' }); i++; continue; }
    // 先頭の - ! （含まない）
    let neg = false; if ((c === '-' || c === '!') && i + 1 < s.length && !/\s/.test(s[i + 1])) { neg = true; i++; }
    // field:  （名前の部分）
    let field = null; const m = /^([A-Za-z぀-ヿ一-鿿]+):/.exec(s.slice(i));
    if (m && FIELDS[m[1].toLowerCase()] && s[i + m[0].length] !== undefined && !/\s/.test(s[i + m[0].length])) { field = FIELDS[m[1].toLowerCase()]; i += m[0].length; }
    let val = '';
    if (s[i] === '"') { const j = s.indexOf('"', i + 1); val = s.slice(i + 1, j < 0 ? s.length : j); i = j < 0 ? s.length : j + 1; }
    else { let j = i; while (j < s.length && !/[\s()|]/.test(s[j])) j++; val = s.slice(i, j); i = j; if (!field && !neg && val === 'OR') { out.push({ t: 'OR' }); continue; } if (!field && !neg && val === 'NOT') { out.push({ t: 'NOT' }); continue; } if (!field && !neg && val === 'AND') continue; }
    if (val === '' && !field) continue;
    out.push({ t: 'term', val, field, neg, phrase: false });
  }
  return out;
}
// 文法: or := and ('OR' and)* ／ and := unary+ ／ unary := ('NOT')? primary ／ primary := term | '(' or ')'
// （ふつうの検索（Google など）と同じく、OR は空白の AND より先に結びつく）
export function parse(q) {
  const toks = lex(q); let p = 0;
  const peek = () => toks[p];
  function orExpr() { const items = [andExpr()]; while (peek() && peek().t === 'OR') { p++; items.push(andExpr()); } return items.length > 1 ? { op: 'or', items } : items[0]; }
  function andExpr() { const items = []; while (peek() && peek().t !== ')' && peek().t !== 'OR') items.push(unary()); return items.length === 1 ? items[0] : { op: 'and', items }; }
  function unary() { let neg = false; while (peek() && peek().t === 'NOT') { neg = !neg; p++; } const x = primary(); return neg ? { op: 'not', item: x } : x; }
  function primary() {
    const t = peek(); if (!t) return { op: 'and', items: [] };
    if (t.t === '(') { p++; const e = orExpr(); if (peek() && peek().t === ')') p++; return e; }
    p++; const leaf = { op: 'term', field: t.field, val: t.val, low: t.val.toLowerCase() }; return t.neg ? { op: 'not', item: leaf } : leaf;
  }
  const items = []; while (p < toks.length) { if (peek().t === ')') { p++; continue; } items.push(orExpr()); }
  return items.length === 1 ? items[0] : { op: 'and', items };
}
// 検索語の強調に使う、含めたい（- でない）ふつうの言葉
export function terms(q) {
  const out = [];
  (function walk(n, neg) { if (!n) return; if (n.op === 'term') { if (!neg && (!n.field || n.field === 'title' || n.field === 'body' || n.field === 'kw') && n.low) out.push(n.val); } else if (n.op === 'not') walk(n.item, !neg); else for (const x of n.items || []) walk(x, neg); })(parse(q), false);
  return [...new Set(out)];
}

// ノートの 1 つの値（fields）が、検索に合うか。fields: { id, s, noid, title, body, kw: [..], readings: '…', created, updated }
const inRange = (v, spec) => { v = String(v || ''); const m = /^(.*?)\.\.(.*)$/.exec(spec); if (!m) return v.startsWith(spec); return (!m[1] || v.slice(0, m[1].length) >= m[1]) && (!m[2] || v.slice(0, m[2].length) <= m[2]); };
function leaf(n, f, all) {
  const v = n.low;
  switch (n.field) {
    case 'id': return !f.noid && String(f.id || '').toLowerCase().startsWith(v);
    case 'fz': { if (f.noid || !f.id) return false; const a = L.tok(f.id), b = L.tok(v); return !!b.length && b.length <= a.length && b.every((x, i) => a[i] === x); }
    case 'kw': return (f.kw || []).some(k => String(k).toLowerCase().includes(v)) || String(f.readings || '').includes(L.toHira(v));
    case 'title': return String(f.title || '').toLowerCase().includes(v);
    case 'body': return String(f.body || '').toLowerCase().includes(v);
    case 'date': return inRange(f.created, v);
    case 'updated': return inRange(f.updated || f.created, v);
    case 'is': return v === 'paper' || v === '紙' ? f.s === 'p' : v === 'digital' || v === 'デジタル' ? f.s === 'd' : v === 'noid' || v === 'idなし' ? !!f.noid : false;
    case 'has': return v === 'kw' || v === 'keyword' ? (f.kw || []).length > 0 : v === 'title' ? !!(f.title || '').trim() : v === 'link' ? /->|→|\]\(/.test(f.body || '') : false;
    default: return all.includes(v);
  }
}
const evalNode = (n, f, all) => !n ? true : n.op === 'term' ? leaf(n, f, all) : n.op === 'not' ? !evalNode(n.item, f, all) : n.op === 'or' ? n.items.some(x => evalNode(x, f, all)) : n.items.every(x => evalNode(x, f, all));
// 使い方: const m = matcher(q); m(fields)
export function matcher(q) {
  const ast = parse(q);
  return f => evalNode(ast, f, [f.id, f.title, f.body, (f.kw || []).join(' '), f.readings].join('\n').toLowerCase());
}
