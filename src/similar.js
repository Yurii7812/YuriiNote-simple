// 似たノートを探す: いろいろな見方（言葉・字面・意味・キーワード・つながり・番号・時期）のそれぞれで度数（0〜1）を出し、
// それぞれを「いちばん似ているものを 1」にそろえて重みをつけて混ぜる。理由は、見方ごとに出す。
// 索引（トピック）に載っているかは、似ているかどうかの目安にならないので使わない。
import L from '../lib.js';
import Stamp from '../stamp.js';

export const BASES = {
  words: { icon: '📝', name: '言葉', tip: '同じ言葉が出てくる（BM25）', w: 1 },
  chars: { icon: '🔤', name: '字面', tip: '文字のつながりが似ている（言い換え・活用・合成語にも強い）', w: .6 },
  ai: { icon: '🤖', name: '意味（AI）', tip: 'AI のモデル（multilingual-e5-small）で、話題や言い回しの近さを見る。最初に一度だけ約120MBをダウンロード', w: .8 },
  sense: { icon: '🧠', name: '意味', tip: '同じ言葉がなくても、同じ話題の中で使われる言葉が近い（潜在意味解析）', w: .5 },
  kw: { icon: '🏷️', name: 'キーワード', tip: '同じキーワード、またはキーワードが本文に出てくる', w: 1 },
  link: { icon: '🔗', name: 'つながり', tip: 'リンクでつながっている・同じノートとつながっている', w: 1 },
  tree: { icon: '🌳', name: '番号', tip: 'Folgezettel の番号が近い（親・子・兄弟・同じ流れ）', w: .6 },
  time: { icon: '🕐', name: '時期', tip: '書いた時期が近い', w: .25 }
};
export const DEFAULT_ON = { words: true, chars: true, sense: true, ai: true, kw: true, link: true, tree: true, time: false };

// ---------- 言葉 ----------
// 日本語は単語に区切って（Intl.Segmenter）、意味のある言葉（漢字・カタカナの語、英数字の語、長めのひらがなの語）だけを使う。
// 記法（リンク・矢印・(n)・日時・URL・コード）や、「の」「です」のような助詞・語尾は除く
const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('ja', { granularity: 'word' }) : null;
const HAN = /[㐀-鿿豈-﫿]/, KATA = /[゠-ヿ]/, HIRA = /^[぀-ゟー]+$/, LATIN = /^[a-z0-9][a-z0-9_.'-]*$/;
const STOP = new Set(['自分', '思う', '思い', '感じ', '感じる', '実際', '多い', '少ない', '違う', '今日', '昨日', '明日', '最近', '結構', '本当', '全然', '意味', '普通', '特に', '一番', '結局', 'やっぱり', 'ちゃんと', 'なんか', 'たぶん', 'おそらく', 'っていう', 'ていう', 'ていうか', 'だけど', 'けれど', 'ような', 'ように', 'ですが', 'ました', 'ません', 'でした', 'ている', 'ていた', 'ており', 'しかし', 'それで', 'だから', 'または', 'あるいは', 'ところが', 'さらに', 'たとえば', 'もしも', 'ちなみに', 'どうして', 'どうやって', 'こういう', 'そういう', 'ああいう', 'こんな', 'そんな', 'どんな', 'いろいろ', 'ちょっと', 'こと', 'もの', 'ため', 'これ', 'それ', 'あれ', 'ここ', 'そこ', 'よう', 'ところ', 'という', 'として', 'について', 'による', 'です', 'ます', 'する', 'した', 'して', 'いる', 'ある', 'なる', 'できる', 'the', 'and', 'for', 'are', 'was', 'with', 'that', 'this', 'from', 'have', 'not']);
const clean = t => Stamp.strip(t || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/`[^`\n]*`/g, ' ')
  .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').replace(/https?:\/\/\S+/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/(?:->|→)\s*[0-9]+[a-z0-9]*(?:[(（](?:\d+|[pdPD])[)）]){0,2}|[0-9]+[a-z0-9]*(?:[(（](?:\d+|[pdPD])[)）]){0,2}(?:->|→)/g, ' ')   // ->1b や 1a-> は言葉ではない
  .replace(/[(（]\d+[)）]/g, ' ').replace(/\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?/g, ' ').toLowerCase();
const keepWord = w => {
  if (!w || STOP.has(w)) return false;
  if (HAN.test(w) || KATA.test(w)) return w.length >= 2;
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
// 言葉 → 出てきた回数（題とキーワードは重く）
export function tokens(text, title = '', keywords = []) {
  const out = new Map(), add = (w, c = 1) => out.set(w, (out.get(w) || 0) + c);
  for (const w of words(text)) add(w);
  for (const w of words(title)) add(w, 2);
  for (const k of keywords || []) { const kw = String(k).toLowerCase().trim(); if (kw) { add(kw, 3); for (const w of words(kw)) add(w, 1); } }
  return out;
}
// 文字の 3 つ組（漢字・カタカナ・英数字のまとまりの中だけ。ひらがなだけの組は助詞が多いので除く）
function grams(text, keywords = []) {
  const out = new Map(), t = clean(text) + ' ' + (keywords || []).join(' ').toLowerCase();
  for (const run of t.match(/[a-z0-9぀-ヿ㐀-鿿豈-﫿ー]+/g) || []) {
    for (const n of CFG.gram) for (let i = 0; i + n <= run.length; i++) {
      const g = run.slice(i, i + n); if (CFG.skipHira && /^[぀-ゟー]+$/.test(g)) continue;
      out.set(g, (out.get(g) || 0) + 1);
    }
  }
  return out;
}

export const CFG = { gram: [2, 3], skipHira: false, k1: 1.5, b: .8, k: 32, lsaMax: 1000 };   // 調整用
const key = n => n.s + ':' + n.id;
const stemOf = n => n.stem || '';
const time = n => { const m = String(n.created || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 3600000 : null; };   // 時間

// ---------- 準備（全ノートの下ごしらえ） ----------
export function prepare(notes, opts = {}) {
  const keys = notes.map(key), idx = new Map(keys.map((k, i) => [k, i])), N = notes.length;
  const P = { notes, keys, idx, N };
  P.vec = notes.map(n => (opts.emb && opts.emb.get(key(n))) || null);   // AI のベクトル（長さ 1）。無いノートは null
  // 言葉の BM25
  let tf = notes.map(n => tokens(n.body || '', n.title || '', n.keywords || [])), df = new Map();
  for (const m of tf) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  if (N >= 15) {   // ほとんどのノートに出てくる言葉は、似ているかどうかの手がかりにならないので除く（キーワードは残す）
    const kws = new Set(notes.flatMap(n => (n.keywords || []).map(k => String(k).toLowerCase())));
    tf = tf.map(m => new Map([...m].filter(([w]) => kws.has(w) || df.get(w) / N <= .3)));
    df = new Map(); for (const m of tf) for (const w of m.keys()) df.set(w, (df.get(w) || 0) + 1);
  }
  const len = tf.map(m => { let s = 0; for (const c of m.values()) s += c; return s; }), avg = (len.reduce((a, b) => a + b, 0) / Math.max(1, N)) || 1;
  const idf = w => Math.log(1 + (N - (df.get(w) || 0) + .5) / ((df.get(w) || 0) + .5));
  Object.assign(P, { tf, len, avg, idf, df });
  P.self = tf.map((m, i) => bm25(P, i, i));
  // 字面
  const g = notes.map(n => grams(n.body || '', n.keywords || [])), gdf = new Map();
  for (const m of g) for (const x of m.keys()) gdf.set(x, (gdf.get(x) || 0) + 1);
  const gidf = x => Math.log(1 + N / (1 + (gdf.get(x) || 0)));
  P.gvec = g.map(m => unit(m, gidf)); P.gidf = gidf;
  // 意味（潜在意味解析）
  P.sense = lsa(tf, idf, N);
  // キーワード
  const kdf = new Map(); for (const n of notes) for (const k of new Set(n.keywords || [])) kdf.set(k, (kdf.get(k) || 0) + 1);
  P.kidf = k => Math.log(1 + N / (kdf.get(k) || 1));
  P.text = notes.map(n => clean((n.title || '') + '\n' + (n.body || '')));
  // つながり
  const has = new Set(keys), byStem = new Map(notes.filter(stemOf).map(n => [n.stem, key(n)]));
  const adj = notes.map(() => new Map());
  const edge = (a, b) => { if (a === b || a == null || b == null) return; adj[a].set(b, 1); adj[b].set(a, 1); };
  notes.forEach((n, i) => {
    if (n.noid) { /* 番号の無いノートも、書いたリンクは数える */ }
    for (const t of L.tokens(n.body || '')) { if (t.k !== 'ref') continue; const k = (t.sp || n.s) + ':' + t.id; if (has.has(k)) edge(i, idx.get(k)); }
    for (const m of (n.body || '').matchAll(/\]\((\d{14}(?:-\d+)?)\.md/g)) { const k = byStem.get(m[1]); if (k && has.has(k)) edge(i, idx.get(k)); }
  });
  P.adj = adj;
  P.time = notes.map(time);
  P.tok = notes.map(n => n.noid ? null : L.tok(n.id));
  return P;
}
function unit(m, idf) {
  const v = new Map(); let s = 0;
  for (const [w, c] of m) { const x = (1 + Math.log(c)) * idf(w); v.set(w, x); s += x * x; }
  s = Math.sqrt(s) || 1; for (const [w, x] of v) v.set(w, x / s);
  return v;
}
// base ノート（のなかの言葉）を問い合わせにして、cand ノートに点をつける（BM25）
function bm25(P, bi, ci) {
  const q = P.tf[bi], d = P.tf[ci], k1 = CFG.k1, b = CFG.b; let s = 0;
  for (const [w, qc] of q) { const f = d.get(w); if (!f) continue; s += P.idf(w) * (1 + Math.log(qc)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * P.len[ci] / P.avg)); }
  return s;
}
// 潜在意味解析: 言葉の重み行列 A（ノート × 言葉）から、A·Aᵀ の上位 k 個の固有ベクトルを部分空間反復で求め、ノートごとの短いベクトルにする
function lsa(tf, idf, N) {
  if (N < 6 || N > CFG.lsaMax) return null;   // ノートが多すぎると重いので、意味の見方は使わない
  const rows = tf.map(m => unit(m, idf));
  const inv = new Map(); rows.forEach((r, i) => { for (const [w, x] of r) { if (!inv.has(w)) inv.set(w, []); inv.get(w).push([i, x]); } });
  const K = new Float32Array(N * N);
  for (const list of inv.values()) { if (list.length > 400) continue; for (const [i, x] of list) for (const [j, y] of list) K[i * N + j] += x * y; }
  const k = Math.min(CFG.k, Math.floor(N / 2)); let Q = Array.from({ length: k }, (_, c) => Float64Array.from({ length: N }, (_, i) => Math.sin((i + 1) * (c + 1) * 12.9898) * 43758.5453 % 1));
  const orth = Q => { for (let a = 0; a < Q.length; a++) { for (let b = 0; b < a; b++) { let d = 0; for (let i = 0; i < N; i++) d += Q[a][i] * Q[b][i]; for (let i = 0; i < N; i++) Q[a][i] -= d * Q[b][i]; } let s = 0; for (let i = 0; i < N; i++) s += Q[a][i] ** 2; s = Math.sqrt(s) || 1; for (let i = 0; i < N; i++) Q[a][i] /= s; } };
  orth(Q);
  for (let it = 0; it < 20; it++) { Q = Q.map(v => { const z = new Float64Array(N); for (let i = 0; i < N; i++) { let s = 0; const o = i * N; for (let j = 0; j < N; j++) s += K[o + j] * v[j]; z[i] = s; } return z; }); orth(Q); }
  const lam = Q.map(v => { let s = 0; for (let i = 0; i < N; i++) { let z = 0; const o = i * N; for (let j = 0; j < N; j++) z += K[o + j] * v[j]; s += z * v[i]; } return Math.max(0, s); });
  return Array.from({ length: N }, (_, i) => { const e = Q.map((v, c) => v[i] * Math.sqrt(lam[c])); const s = Math.sqrt(e.reduce((a, x) => a + x * x, 0)) || 1; return e.map(x => x / s); });
}
// 自分から歩き始めて、つながりをたどって、各ノートに着く確率（つながりの近さ）。戻りは 0.5
function walk(P, start) {
  const N = P.N, alpha = .5; let p = new Float64Array(N); p[start] = 1; const r = new Float64Array(N); r[start] = alpha;
  for (let it = 0; it < 25; it++) {
    const q = new Float64Array(N);
    for (let i = 0; i < N; i++) { if (!p[i]) continue; const nb = P.adj[i]; if (!nb.size) { q[start] += p[i] * (1 - alpha); continue; } const share = p[i] * (1 - alpha) / nb.size; for (const j of nb.keys()) q[j] += share; }
    for (let i = 0; i < N; i++) q[i] += r[i]; p = q;
  }
  return p;
}
// Folgezettel の番号の近さ（0〜1）
function treeScore(a, b) {
  if (!a || !b) return 0;
  let cp = 0; while (cp < a.length && cp < b.length && a[cp] === b[cp]) cp++;
  if (!cp) return 0;
  const da = a.length - cp, db = b.length - cp;
  return (1 / (1 + da + db)) * (.5 + .5 * cp / Math.max(a.length, b.length));
}

// ---------- 見方ごとの度数（base の 1 つのノートから、全ノートへ）----------
export function scoresFrom(P, bi) {
  const N = P.N, out = {};
  const sym = new Float64Array(N);
  for (let c = 0; c < N; c++) { if (c === bi) continue; const f = bm25(P, bi, c) / (P.self[bi] || 1), r = bm25(P, c, bi) / (P.self[c] || 1); sym[c] = Math.min(1, (f + r) / 2); }
  out.words = sym;
  const gv = P.gvec[bi], gs = new Float64Array(N);
  for (let c = 0; c < N; c++) { if (c === bi) continue; const o = P.gvec[c]; let d = 0; const [s, l] = gv.size < o.size ? [gv, o] : [o, gv]; for (const [w, x] of s) { const y = l.get(w); if (y) d += x * y; } gs[c] = d; }
  out.chars = gs;
  const ss = new Float64Array(N);
  if (P.sense) { const a = P.sense[bi]; for (let c = 0; c < N; c++) { if (c === bi) continue; const b = P.sense[c]; let d = 0; for (let k = 0; k < a.length; k++) d += a[k] * b[k]; ss[c] = Math.max(0, d); } }
  out.sense = ss;
  // AI: 内積は 0.8〜0.95 に偏り、長いノートはだれとも似て見えるので、基準のノートごとに「ほかのノートの平均より何シグマ上か」で見る。
  // 1 シグマ以下は 0、3 シグマ以上は 1
  const as = new Float64Array(N), av = P.vec[bi];
  if (av) {
    const dots = new Float64Array(N).fill(NaN); let sum = 0, cnt = 0;
    for (let c = 0; c < N; c++) { const bv = P.vec[c]; if (c === bi || !bv) continue; let d = 0; for (let k = 0; k < av.length; k++) d += av[k] * bv[k]; dots[c] = d; sum += d; cnt++; }
    if (cnt >= 4) { const mean = sum / cnt; let v = 0; for (let c = 0; c < N; c++) if (!Number.isNaN(dots[c])) v += (dots[c] - mean) ** 2; const sd = Math.sqrt(v / cnt) || 1e-6; for (let c = 0; c < N; c++) if (!Number.isNaN(dots[c])) as[c] = Math.max(0, Math.min(1, ((dots[c] - mean) / sd - 1) / 2)); }
  }
  out.ai = as;
  const ks = new Float64Array(N), bk = new Set(P.notes[bi].keywords || []);
  if (bk.size) {
    const tot = k => P.kidf(k);
    for (let c = 0; c < N; c++) {
      if (c === bi) continue; const ck = new Set(P.notes[c].keywords || []); let inter = 0, uni = 0, men = 0, menAll = 0;
      for (const k of bk) { menAll += tot(k); if (ck.has(k)) inter += tot(k); else if (P.text[c].includes(String(k).toLowerCase())) men += tot(k); }
      for (const k of new Set([...bk, ...ck])) uni += tot(k);
      ks[c] = Math.max(uni ? inter / uni : 0, menAll ? .7 * (inter + men) / menAll * (inter + men > 0 ? 1 : 0) : 0);
    }
  }
  out.kw = ks;
  const w = walk(P, bi), ls = new Float64Array(N); let mx = 0; for (let c = 0; c < N; c++) if (c !== bi && w[c] > mx) mx = w[c];
  for (let c = 0; c < N; c++) if (c !== bi) ls[c] = P.adj[bi].has(c) ? 1 : mx ? Math.min(.9, w[c] / mx * .9) : 0;
  out.link = ls;
  const ts = new Float64Array(N); for (let c = 0; c < N; c++) if (c !== bi) ts[c] = treeScore(P.tok[bi], P.tok[c]);
  out.tree = ts;
  const tm = new Float64Array(N), t0 = P.time[bi]; if (t0 != null) for (let c = 0; c < N; c++) { const t1 = P.time[c]; if (c !== bi && t1 != null) tm[c] = Math.exp(-Math.abs(t1 - t0) / 72); }   // 3 日で 1/e
  out.time = tm;
  return out;
}

// ---------- 理由 ----------
function reasonsOf(P, bi, ci, sc) {
  const out = [], a = P.notes[bi], b = P.notes[ci];
  if (sc.words > .06) {
    const shared = []; for (const [w, qc] of P.tf[bi]) { const f = P.tf[ci].get(w); if (f) shared.push([w, P.idf(w) * Math.min(qc, f)]); }
    const top = shared.sort((x, y) => y[1] - x[1]).map(x => x[0]).filter((w, i, all) => !all.some(o => o !== w && o.includes(w))).slice(0, 4);
    if (top.length) out.push({ b: 'words', t: '同じ言葉: ' + top.join('・') });
  }
  if (sc.kw > .02) {
    const ak = new Set(a.keywords || []), same = (b.keywords || []).filter(k => ak.has(k));
    if (same.length) out.push({ b: 'kw', t: '同じキーワード: ' + same.join('・') });
    else { const men = [...ak].filter(k => P.text[ci].includes(String(k).toLowerCase())); if (men.length) out.push({ b: 'kw', t: 'キーワードが本文に出てくる: ' + men.join('・') }); }
  }
  if (sc.link > .02) {
    if (P.adj[bi].has(ci)) out.push({ b: 'link', t: 'リンクでつながっている' });
    else { const common = [...P.adj[bi].keys()].filter(x => P.adj[ci].has(x)); out.push({ b: 'link', t: common.length ? '同じノートとつながっている: ' + common.slice(0, 2).map(x => P.notes[x].noid ? 'IDなし' : P.notes[x].id).join('・') : 'つながりが近い' }); }
  }
  if (sc.tree > .1) {
    const ta = P.tok[bi], tb = P.tok[ci]; if (ta && tb) {
      let cp = 0; while (cp < ta.length && cp < tb.length && ta[cp] === tb[cp]) cp++;
      out.push({ b: 'tree', t: cp === ta.length ? `${a.id} の続き（子孫）` : cp === tb.length ? `${b.id} が元（親・祖先）` : cp === ta.length - 1 && cp === tb.length - 1 ? '同じ親の兄弟' : '同じ流れの中' });
    }
  }
  if (sc.ai > .3) out.push({ b: 'ai', t: sc.words < .06 ? '同じ言葉は少ないが、話題が近い（AI）' : '話題が近い（AI）' });
  if (sc.sense > .6 && sc.words < .06 && !(sc.ai > .3)) out.push({ b: 'sense', t: '同じ言葉は少ないが、話題が近い' });
  if (sc.chars > .35 && !out.some(r => r.b === 'words')) out.push({ b: 'chars', t: '文字のつながりが似ている' });
  if (sc.time > .6) out.push({ b: 'time', t: '書いた時期が近い' });
  return out;
}

// ---------- ランキング ----------
// base: ノートの配列。opts: { bases:{words,chars,…}, multi:'avg'|'any'|'all', weights?:{…} }
export function rank(P, notes, base, opts) {
  const on = Object.keys(BASES).filter(k => opts.bases[k]);
  if (!on.length) return [];
  const bis = base.map(b => P.idx.get(key(b))).filter(i => i != null), bset = new Set(bis);
  if (!bis.length) return [];
  const per = bis.map(i => scoresFrom(P, i)), N = P.N, agg = {};
  const f = opts.multi === 'any' ? (v => Math.max(...v)) : opts.multi === 'all' ? (v => Math.min(...v)) : (v => v.reduce((x, y) => x + y, 0) / v.length);
  for (const k of Object.keys(BASES)) { const a = new Float64Array(N); for (let c = 0; c < N; c++) a[c] = f(per.map(p => p[k][c])); agg[k] = a; }
  const cand = notes.map(n => P.idx.get(key(n))).filter(i => i != null && !bset.has(i));
  const mx = {}; for (const k of on) { let m = 0; for (const c of cand) if (agg[k][c] > m) m = agg[k][c]; mx[k] = m; }
  const W = k => (opts.weights && opts.weights[k] != null ? opts.weights[k] : BASES[k].w), rows = [];
  for (const c of cand) {
    let num = 0, den = 0; const score = {};
    for (const k of on) { score[k] = agg[k][c]; if (mx[k] > 0) { const norm = Math.min(1, agg[k][c] / mx[k]), raw = Math.min(1, agg[k][c]); num += W(k) * (.5 * norm + .5 * raw); den += W(k); } }
    const total = den ? num / den : 0;
    const reasons = []; for (const bi of bis) for (const r of reasonsOf(P, bi, c, Object.fromEntries(Object.keys(BASES).map(k => [k, per[bis.indexOf(bi)][k][c]])))) if (opts.bases[r.b] && !reasons.some(x => x.t === r.t)) reasons.push(r);
    if (total > .05 && reasons.length) rows.push({ note: P.notes[c], score, total, reasons });
  }
  return rows.sort((a, b) => b.total - a.total);
}
