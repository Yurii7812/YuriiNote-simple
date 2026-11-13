'use strict';
// 意味の見方（AI）: multilingual-e5-small（量子化版・約 120MB）で、ノートを 384 次元のベクトルにする。
// モデルは、使うと決めたとき一度だけダウンロードして、そのあとは、すべて手元で動く（ノートは外へ出ない）。
// ベクトルは、ノートの中身が変わったものだけ作り直し、アプリの設定フォルダ（vault の外）に保存する。
const fs = require('fs'), path = require('path'), os = require('os'), https = require('https'), crypto = require('crypto');

const BASE = 'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/';
const FILES = [   // [ネット上の場所, 手元の名前, 最低限これくらいの大きさ]
  ['onnx/model_quantized.onnx', 'model.onnx', 90e6],
  ['tokenizer.json', 'tokenizer.json', 5e6],
  ['tokenizer_config.json', 'tokenizer_config.json', 100]
];
const DIM = 384, CHUNK_CHARS = 400, MAX_CHUNKS = 3, MAX_TOKENS = 256, TAG = 'e5-small-q8-v1';

// ---- 文章の下ごしらえ（テストできる部分）
// 記法を軽くはずし、長いノートは 400 字ずつ最大 3 つに分ける（ベクトルは平均する）
const cleanText = t => String(t || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, '$1').replace(/<[^>]+>/g, ' ')
  .replace(/https?:\/\/\S+/g, ' ').replace(/(?:->|→)\s*[0-9]+[a-z0-9]*|[0-9]+[a-z0-9]*(?:->|→)/g, ' ').replace(/\s+/g, ' ').trim();
function chunks(text) {
  const t = cleanText(text), out = [];
  for (let i = 0; i < t.length && out.length < MAX_CHUNKS; i += CHUNK_CHARS) out.push(t.slice(i, i + CHUNK_CHARS));
  return out.length ? out : [''];
}
const hashOf = text => crypto.createHash('sha1').update(TAG + '\n' + String(text)).digest('hex').slice(0, 16);
// 384 個の小数（長さ 1）→ 1 バイトずつ（-127〜127）。base64 の文字列で持つ
const pack = v => Buffer.from(Int8Array.from(v, x => Math.max(-127, Math.min(127, Math.round(x * 127))))).toString('base64');
const unpack = s => { const b = Buffer.from(s, 'base64'), v = new Float32Array(b.length); let n = 0; for (let i = 0; i < b.length; i++) { v[i] = ((b[i] << 24) >> 24) / 127; n += v[i] * v[i]; } n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; };

// ---- ダウンロード
function download(url, dest, onBytes, redirects = 8) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'YuriiNote' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); if (!redirects) return reject(new Error('転送が多すぎます')); return resolve(download(new URL(res.headers.location, url).toString(), dest, onBytes, redirects - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('ダウンロードできませんでした（' + res.statusCode + '）')); }
      const part = dest + '.part', out = fs.createWriteStream(part); let got = 0;
      res.on('data', d => { got += d.length; onBytes(d.length, +res.headers['content-length'] || 0); });
      res.pipe(out); out.on('finish', () => out.close(() => { fs.renameSync(part, dest); resolve(got); }));
      out.on('error', reject); res.on('error', reject);
    }).on('error', reject);
  });
}

class Embedder {
  constructor(dir) { this.dir = dir; this.sess = null; this.tok = null; this.queue = Promise.resolve(); }
  path(name) { return path.join(this.dir, name); }
  installed() { return FILES.every(([, local, min]) => { try { return fs.statSync(this.path(local)).size >= min; } catch { return false; } }); }
  async install(onProgress = () => { }) {
    fs.mkdirSync(this.dir, { recursive: true });
    let total = 0, got = 0; const sizes = new Map();
    for (const [remote, local, min] of FILES) {
      if (fs.existsSync(this.path(local)) && fs.statSync(this.path(local)).size >= min) continue;
      await download(BASE + remote, this.path(local), (n, t) => { got += n; if (t && !sizes.has(local)) { sizes.set(local, t); total += t; } onProgress({ got, total }); });
    }
    if (!this.installed()) throw new Error('モデルのファイルがそろいませんでした');
    return true;
  }
  // 使わない OS 用・GPU 用の大きなファイルを消す（onnxruntime-node は、全部の OS 用が入っていて、500MB を超える）
  prune() {
    try {
      const root = path.dirname(require.resolve('onnxruntime-node/package.json')), bin = path.join(root, 'bin', 'napi-v6');
      for (const os_ of fs.readdirSync(bin)) {
        const p = path.join(bin, os_);
        if (os_ !== process.platform) { fs.rmSync(p, { recursive: true, force: true }); continue; }
        for (const arch of fs.readdirSync(p)) {
          const ap = path.join(p, arch);
          if (arch !== process.arch) { fs.rmSync(ap, { recursive: true, force: true }); continue; }
          for (const f of fs.readdirSync(ap)) if (/providers_(cuda|tensorrt)/.test(f)) fs.rmSync(path.join(ap, f), { force: true });
        }
      }
    } catch { }
  }
  async load() {
    if (this.sess) return;
    if (!this.installed()) throw new Error('モデルが入っていません');
    this.prune();
    const ort = require('onnxruntime-node'); this.ort = ort;
    const { Tokenizer } = await import('@huggingface/tokenizers');
    this.tok = new Tokenizer(JSON.parse(fs.readFileSync(this.path('tokenizer.json'), 'utf8')), JSON.parse(fs.readFileSync(this.path('tokenizer_config.json'), 'utf8')));
    this.sess = await ort.InferenceSession.create(this.path('model.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2))), graphOptimizationLevel: 'all' });
  }
  // texts → 長さ 1 の Float32Array の並び（'query: ' を付けて、8 件ずつ）
  embed(texts) {
    const run = async () => {
      await this.load();
      const out = [];
      for (let i = 0; i < texts.length; i += 8) out.push(...await this.batch(texts.slice(i, i + 8)));
      return out;
    };
    const p = this.queue.then(run, run); this.queue = p.catch(() => { }); return p;
  }
  async batch(texts) {
    const ort = this.ort, encs = texts.map(t => { const ids = this.tok.encode('query: ' + t).ids; return ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), ids[ids.length - 1]] : ids; });
    const T = Math.max(...encs.map(x => x.length)), B = encs.length, ids = new BigInt64Array(B * T), mask = new BigInt64Array(B * T);
    encs.forEach((x, b) => x.forEach((id, i) => { ids[b * T + i] = BigInt(id); mask[b * T + i] = 1n; }));
    const feeds = { input_ids: new ort.Tensor('int64', ids, [B, T]), attention_mask: new ort.Tensor('int64', mask, [B, T]) };
    if (this.sess.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(B * T), [B, T]);
    const res = await this.sess.run(feeds), t = res[this.sess.outputNames[0]], h = t.data, D = t.dims[2];
    return encs.map((x, b) => { const v = new Float32Array(D); for (let i = 0; i < x.length; i++) for (let d = 0; d < D; d++) v[d] += h[(b * T + i) * D + d]; let s = 0; for (let d = 0; d < D; d++) { v[d] /= x.length; s += v[d] * v[d]; } s = Math.sqrt(s) || 1; for (let d = 0; d < D; d++) v[d] /= s; return v; });
  }
}

// ---- ノートごとのベクトル（変わったものだけ作り直す）
class Index {
  constructor(file, embedder) { this.file = file; this.emb = embedder; this.items = {}; try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d.tag === TAG) this.items = d.items || {}; } catch { } }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file + '.tmp', JSON.stringify({ tag: TAG, items: this.items })); fs.renameSync(this.file + '.tmp', this.file); } catch { } }
  // notes: [{ key, text }]。足りないぶんだけ作る。返す: { key: base64 }（vault に無くなったノートのぶんは捨てる）
  async vectors(notes, onProgress = () => { }) {
    const need = []; const keep = {};
    for (const n of notes) { const h = hashOf(n.text), it = this.items[n.key]; if (it && it.h === h) keep[n.key] = it; else need.push({ ...n, h }); }
    let done = 0; onProgress({ done, total: need.length });
    for (let i = 0; i < need.length; i += 8) {
      const group = need.slice(i, i + 8), parts = group.map(n => chunks(n.text)), flat = parts.flat();
      const vs = await this.emb.embed(flat); let o = 0;
      group.forEach((n, gi) => {
        const cnt = parts[gi].length, v = new Float32Array(DIM); for (let c = 0; c < cnt; c++) { const x = vs[o + c]; for (let d = 0; d < DIM; d++) v[d] += x[d]; } o += cnt;
        let s = 0; for (let d = 0; d < DIM; d++) s += v[d] * v[d]; s = Math.sqrt(s) || 1; for (let d = 0; d < DIM; d++) v[d] /= s;
        keep[n.key] = { h: n.h, v: pack(v) };
      });
      done += group.length; onProgress({ done, total: need.length });
    }
    this.items = keep; this.save();
    return Object.fromEntries(Object.entries(keep).map(([k, it]) => [k, it.v]));
  }
}

module.exports = { Embedder, Index, chunks, cleanText, hashOf, pack, unpack, FILES, DIM, TAG };
