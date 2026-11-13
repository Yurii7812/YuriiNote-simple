const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const A = require('../ai-embed');

test('AI の下ごしらえ: 記法をはずし、400 字ずつ最大 3 つに分ける', () => {
  assert.strictEqual(A.cleanText('[題](a.md) と ->1b と 1a-> と https://example.com\n```\ncode\n```\n本文'), '題 と と と 本文');
  const c = A.chunks('あ'.repeat(1000)); assert.deepStrictEqual(c.map(x => x.length), [400, 400, 200]);
  assert.deepStrictEqual(A.chunks(''), ['']);
  assert.strictEqual(A.chunks('い'.repeat(5000)).length, 3);
});

test('AI のベクトル: 1 バイトずつに詰めて戻せる（近さはほぼ変わらない）', () => {
  const v = Float32Array.from({ length: A.DIM }, (_, i) => Math.sin(i * 1.7)), n = Math.hypot(...v), u = v.map(x => x / n);
  const back = A.unpack(A.pack(u)); let d = 0; for (let i = 0; i < u.length; i++) d += u[i] * back[i];
  assert.ok(d > .999, String(d));
  assert.ok(A.pack(u).length < 600);
});

test('AI のベクトル: 変わったノートだけ作り直す（偽のモデルで）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-')), calls = [];
  const fake = { async embed(texts) { calls.push(texts.length); return texts.map(t => { const v = new Float32Array(A.DIM); v[t.length % A.DIM] = 1; return v; }); } };
  const idx = new A.Index(path.join(dir, 'c.json'), fake), progress = [];
  let r = await idx.vectors([{ key: 'd:1', text: 'いち' }, { key: 'd:2', text: 'にーに' }], p => progress.push(p.done + '/' + p.total));
  assert.deepStrictEqual(Object.keys(r), ['d:1', 'd:2']); assert.deepStrictEqual(calls, [2]); assert.deepStrictEqual(progress, ['0/2', '2/2']);
  const idx2 = new A.Index(path.join(dir, 'c.json'), fake);   // 保存したものを読み直す
  r = await idx2.vectors([{ key: 'd:1', text: 'いち' }, { key: 'd:2', text: 'にーに！' }, { key: 'd:3', text: 'さん' }]);
  assert.deepStrictEqual(calls, [2, 2]);   // d:1 は作り直さない（d:2 と d:3 だけ）
  assert.deepStrictEqual(Object.keys(r), ['d:1', 'd:2', 'd:3']);
  const idx3 = new A.Index(path.join(dir, 'c.json'), fake); await idx3.vectors([{ key: 'd:3', text: 'さん' }]);
  assert.deepStrictEqual(Object.keys(idx3.items), ['d:3']);   // 無くなったノートは捨てる
});

test('AI のモデル: 入っていれば、実際に動く（入っていないときは飛ばす）', { skip: !process.env.AI_MODEL_DIR }, async () => {
  const e = new A.Embedder(process.env.AI_MODEL_DIR); assert.ok(e.installed());
  const [a, b, c] = await e.embed(['瞑想で不安が軽くなった', '座禅をしたら心が落ち着いた', '経費の精算は月末にする']);
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  assert.ok(dot(a, b) > dot(a, c));
});
