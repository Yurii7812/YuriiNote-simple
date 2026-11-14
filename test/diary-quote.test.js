const test = require('node:test');
const assert = require('node:assert');
const Core = require('../link-core');
const L = require('../lib');

test('日記の引用は ->日付（時系列記録は ->日付-種類）', () => {
  const diary = { kind: 'diary', recordKind: '日記', date: '2026-10-11', stem: '20261011090000', title: '2026-10-11-日' };
  const dream = { kind: 'diary', recordKind: '夢', date: '2026-10-21', stem: '20261021070000', title: '2026-10-21-夢' };
  assert.strictEqual(Core.reference(diary), '->2026-10-11');
  assert.strictEqual(Core.reference(dream), '->2026-10-21-夢');
  assert.strictEqual(Core.reference(diary, true), '2026-10-11->');
  assert.strictEqual(Core.reference(dream, true), '2026-10-21-夢->');
});

test('ふつうのノートの引用は今まで通り ->ID', () => {
  assert.strictEqual(Core.reference({ kind: 'note', s: 'd', id: '1a', title: 'x' }), '->1a');
  assert.strictEqual(Core.reference({ kind: 'note', s: 'd', id: '1a', title: 'x' }, true), '1a->');
});

test('本文の ->日付 は日付トークンになり、ID のトークンにはならない', () => {
  const toks = L.tokens('a ->2026-10-21-夢 b ->2026-10-11。c 1a->');
  const days = toks.filter(t => t.k === 'day');
  assert.deepStrictEqual(days.map(t => [t.date, t.kind]), [['2026-10-21', '夢'], ['2026-10-11', '日記']]);
  assert.ok(!toks.some(t => t.k === 'ref' && /^2026/.test(t.id)));
  assert.ok(toks.some(t => t.k === 'ref' && t.id === '1a'));
});

test('後ろに付く 2026-10-11-> も日付トークンになる', () => {
  const toks = L.tokens('x 2026-10-21-夢-> 2026-10-11-> 2026-10-11 1a->');
  const days = toks.filter(t => t.k === 'day');
  assert.deepStrictEqual(days.map(t => [t.date, t.kind, t.post]), [['2026-10-21', '夢', true], ['2026-10-11', '日記', true]]);
  assert.ok(toks.some(t => t.k === 'ref' && t.id === '1a'));
});
