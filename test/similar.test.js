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
  const P = S.prepare(notes);
  const rows = S.rank(P, notes, [notes[0]], { bases: { ...S.DEFAULT_ON }, multi: 'avg' });
  assert.strictEqual(rows[0].note.id, '2');
  const why = rows[0].reasons.find(r => r.b === 'words').t;
  assert.match(why, /^同じ言葉: /); assert.match(why, /カント|認識論|純粋/);
  assert.ok(!/[ぁ-ん]{2}・/.test(why.replace('同じ言葉: ', '')) || /カント|認識論/.test(why));
  assert.ok(!rows.some(r => r.note.id === '3' && r.total > rows[0].total));
});

test('類似検索: 番号・リンク・キーワードの見方（索引は使わない）', async () => {
  const S = await import('../src/similar.js');
  const mk = (id, body, kw = [], created = '2026-11-01 10:00') => ({ s: 'd', id, title: '', body, keywords: kw, created });
  const notes = [mk('1', 'はじめの話。->2 へ続く。'), mk('1a', '枝の話。', ['読書']), mk('1b', '別の枝の話。->1a'), mk('2', '続きの話。'), mk('3', '全然ちがうこと。', [], '2026-12-30 10:00'), mk('4', '読書のやり方を考えた。', [], '2026-12-30 10:00'), mk('5', '空。'), mk('6', '空。')];
  const P = S.prepare(notes);
  const only = (k, base) => S.rank(P, notes, [notes[base]], { bases: { [k]: true }, multi: 'avg' });
  assert.deepStrictEqual(only('tree', 1).map(r => r.note.id).slice(0, 2).sort(), ['1', '1b']);   // 1a から見て、親（1）と兄弟（1b）が近い
  assert.strictEqual(only('link', 0)[0].note.id, '2');                                      // ->2 でつながっている
  assert.ok(only('link', 1).some(r => r.note.id === '1b'));                                  // 1b から 1a へのリンク
  assert.match(only('kw', 1).find(r => r.note.id === '4').reasons[0].t, /キーワードが本文に出てくる: 読書/);
  assert.ok(!Object.keys(S.BASES).includes('topic'));
});
