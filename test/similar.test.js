const test = require('node:test');
const assert = require('node:assert');

test('類似検索: 言葉は、意味のある単語（助詞・記法・日時・数字は除く）', async () => {
  const S = await import('../src/similar.js');
  const w = S.words('2026-11-13 12:54 認識論について、カントの純粋理性批判を読む。->1b と 1a-> と (2) https://example.com `code` です');
  assert.ok(w.includes('認識論') && w.includes('カント') && w.includes('純粋理性批判') || (w.includes('純粋') && w.includes('理性')));
  for (const bad of ['について', 'です', '2026', '12', '1b', '1a', 'example', 'code', 'を', 'の']) assert.ok(!w.includes(bad), bad);
  assert.ok(w.every(x => x.length >= 2));
});

test('類似検索: 同じ言葉の理由が、意味のある言葉で出る（2文字の切れ端ではない）', async () => {
  const S = await import('../src/similar.js');
  const mk = (id, body, kw = []) => ({ s: 'd', id, title: '', body, keywords: kw });
  const notes = [mk('1', '認識論とカントの純粋理性批判について考えた。経験と理性の関係。', ['認識論']), mk('2', 'カントは純粋理性批判で認識論を転回した。'), mk('3', '今日の夕飯はカレーライスにした。玉ねぎを炒める。'), mk('4', '台所の掃除をした。')];
  const P = S.prepare(notes, [], () => ({ rows: [] }));
  const rows = S.rank(P, notes, [notes[0]], { bases: { text: true, kw: true, link: true, topic: true }, multi: 'avg' }).sort((a, b) => b.total - a.total);
  assert.strictEqual(rows[0].note.id, '2');
  const why = rows[0].reasons.find(r => r.b === 'text').t;
  assert.match(why, /^同じ言葉: /); assert.match(why, /カント|認識論|純粋/);
  assert.ok(!/[ぁ-ん]{2}・/.test(why.replace('同じ言葉: ', '')) || /カント|認識論/.test(why));
  assert.ok(!rows.some(r => r.note.id === '3' && r.total > rows[0].total));
});
