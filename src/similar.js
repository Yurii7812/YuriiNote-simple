// 似たノートを探す: 本文の言葉・キーワード・リンク・同じ索引。それぞれの度数（0〜1）を出し、並べ替え・絞り込みに使う
import L from '../lib.js';
import Stamp from '../stamp.js';

export const BASES = { text: '本文の言葉', kw: 'キーワード', link: 'リンク', topic: '索引' };

// 言葉: 日本語は単語に区切って（Intl.Segmenter）、意味のある言葉（漢字・カタカナの語、英数字の語、長めのひらがなの語）だけを使う。
// 記法（リンク・矢印・(n)・日時・URL・コード）や、「の」「です」のような助詞・語尾は除く
const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
const HAN = /[㐀-鿿豈-﫿]/, KATA = /[゠-ヿ]/, HIRA = /^[぀-ゟー]+$/, LATIN = /^[a-z0-9][a-z0-9_.'-]*$/;
const STOP = new Set(['こと', 'もの', 'ため', 'これ', 'それ', 'あれ', 'ここ', 'そこ', 'よう', 'ところ', 'という', 'として', 'について', 'による', 'です', 'ます', 'する', 'した', 'して', 'いる', 'ある', 'なる', 'できる', 'the', 'and', 'for', 'are', 'was', 'with', 'that', 'this', 'from', 'have', 'not']);
const clean = t => Stamp.strip(t || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/`[^`\n]*`/g, ' ')
  .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/(?:->|→)?\s*[0-9]+[a-z0-9]*(?:[(（](?:\d+|[pdPD])[)）]){0,2}(?:->|→)?/g, m => /[(（\d]/.test(m) && /->|→/.test(m) ? ' ' : m)   // ->1b や 1a-> は言葉ではない
  .replace(/[(（]\d+[)）]/g, ' ').replace(/\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/g, ' ').toLowerCase();
const keepWord = w => {
  if (!w || STOP.has(w)) return false;
  if (HAN.test(w) || KATA.test(w)) return w.length >= 2 || (HAN.test(w) && w.length === 1 && false);
  if (LATIN.test(w)) return w.length >= 2 && !/^\d+$/.test(w);
  if (HIRA.test(w)) return w.length >= 4;
  return false;
};
export function words(text) {
  const t = clean(text), out = [];
  if (seg) for (const x of seg.segment(t)) { if (x.isWordLike && keepWord(x.segment)) out.push(x.segment); }
  else for (const w of t.match(/[a-z0-9]{2,}|[぀-鿿]{2,}/g) || []) if (keepWord(w)) out.push(w);
  return out;
}
// 言葉 → 出てきた回数（標題とキーワードは重みを大きく）
export function tokens(text, title = '', keywords = []) {
  const out = new Map(), add = (w, c = 1) => out.set(w, (out.get(w) || 0) + c);
  for (const w of words(text)) add(w);
  for (const w of words(title)) add(w, 2);
  for (const k of keywords || []) { const kw = String(k).toLowerCase().trim(); if (kw) { add(kw, 3); for (const w of words(kw)) add(w, 1); } }
  for (const [w, c] of out) out.set(w, 1 + Math.log(c));   // 同じ言葉の繰り返しは、効きすぎないように
  return out;
}
const key = n => n.s + ':' + n.id;

// 全ノートの準備（言葉の重み・リンク・トピック）。notes は noid を含む。topics と mergeTopic は app から
export function prepare(notes, topics, mergeTopic) {
  const vec = new Map(), df = new Map(), real = notes.filter(n => !(n.kind && n.kind !== 'text') || true);
  for (const n of real) { const tf = tokens(n.body || '', n.title || '', n.keywords || []); vec.set(key(n), tf); for (const w of tf.keys()) df.set(w, (df.get(w) || 0) + 1); }
  const N = Math.max(1, real.length), idf = w => Math.log(1 + N / (1 + (df.get(w) || 0)));
  const norm = new Map(); for (const [k, tf] of vec) { let s = 0; for (const [w, c] of tf) s += (c * idf(w)) ** 2; norm.set(k, Math.sqrt(s) || 1); }
  const links = new Map(), has = new Set(real.map(key));
  for (const n of real) { const set = new Set(); if (!n.noid) for (const t of L.tokens(n.body || '')) { const k = (t.sp || n.s) + ':' + t.id; if (t.k === 'ref' && has.has(k) && k !== key(n)) set.add(k); } links.set(key(n), set); }
  const tp = new Map();   // ノート → 載っている索引 の名前
  for (const t of topics || []) {
    const m = mergeTopic(t), ids = new Set(); if (t.entry) ids.add(t.entry.s + ':' + t.entry.id);
    for (const r of m.rows) for (const s of ['d', 'p']) for (const raw of r[s]) ids.add(s + ':' + L.splitAnchor(raw).id);
    for (const k of ids) { if (!tp.has(k)) tp.set(k, new Set()); tp.get(k).add(t.name); }
  }
  return { vec, idf, norm, links, tp };
}

// a と b の、基準ごとの度数と理由
export function pair(P, a, b) {
  const ka = key(a), kb = key(b), reasons = [], score = {};
  const va = P.vec.get(ka), vb = P.vec.get(kb); let dot = 0; const shared = [];
  if (va && vb) for (const [w, c] of va) if (vb.has(w)) { const x = c * vb.get(w) * P.idf(w) ** 2; dot += x; shared.push([w, x]); }
  score.text = Math.min(1, dot / (P.norm.get(ka) * P.norm.get(kb)));
  if (score.text > .03 && shared.length) {
    const top = shared.sort((x, y) => y[1] - x[1]).map(x => x[0]).filter((w, i, all) => !all.some(o => o !== w && o.includes(w))).slice(0, 4);   // 長い言葉に含まれる短い言葉は、重ねて出さない
    reasons.push({ b: 'text', t: '同じ言葉: ' + top.join('・') });
  }
  const ka_ = new Set(a.keywords || []), kk = (b.keywords || []).filter(k => ka_.has(k)), un = new Set([...ka_, ...(b.keywords || [])]);
  score.kw = un.size ? kk.length / un.size : 0; if (kk.length) reasons.push({ b: 'kw', t: '同じキーワード: ' + kk.join('・') });
  const la = P.links.get(ka) || new Set(), lb = P.links.get(kb) || new Set();
  score.link = la.has(kb) || lb.has(ka) ? 1 : [...la].some(x => lb.has(x)) ? .5 : 0;
  if (score.link === 1) reasons.push({ b: 'link', t: 'リンクでつながっている' }); else if (score.link) reasons.push({ b: 'link', t: '同じノートへリンク' });
  const ta = P.tp.get(ka), tb = P.tp.get(kb), both = ta && tb ? [...ta].filter(x => tb.has(x)) : [];
  score.topic = both.length ? 1 : 0; if (both.length) reasons.push({ b: 'topic', t: '同じ索引: ' + both.slice(0, 2).join('・') });
  return { score, reasons };
}

// base（ノートの配列）に似たものを、全ノートから。opts: { bases:{text,kw,link,topic}, multi:'avg'|'any'|'all' }
export function rank(P, notes, base, opts) {
  const on = Object.keys(BASES).filter(k => opts.bases[k]), bk = new Set(base.map(key)), out = [];
  if (!on.length) return out;
  for (const c of notes) {
    if (bk.has(key(c))) continue;
    const per = base.map(b => pair(P, b, c)), agg = k => { const v = per.map(p => p.score[k]); return opts.multi === 'any' ? Math.max(...v) : opts.multi === 'all' ? Math.min(...v) : v.reduce((x, y) => x + y, 0) / v.length; };
    const score = {}; for (const k of Object.keys(BASES)) score[k] = agg(k);
    const total = on.reduce((x, k) => x + score[k], 0) / on.length;
    const reasons = []; for (const p of per) for (const r of p.reasons) if (opts.bases[r.b] && !reasons.some(x => x.t === r.t)) reasons.push(r);
    if (total > 0.001 || reasons.length) out.push({ note: c, score, total, reasons });
  }
  return out;
}
