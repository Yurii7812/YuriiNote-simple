const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib');

const kinds = s => L.tokens(s).map(t => t.k === 'ref' ? `ref:${t.id}${t.n ? '(' + t.n + ')' : ''}` : `self:${t.n}${t.bare ? '' : '>'}`);

test('リンクの読み取り', () => {
  assert.deepStrictEqual(kinds('続き ->1a1 へ'), ['ref:1a1']);
  assert.deepStrictEqual(kinds('7a-> を見る'), ['ref:7a']);
  assert.deepStrictEqual(kinds('引用(1) あとで (1)->説明 ->(2)'), ['self:1', 'self:1>', 'self:2>']);
  assert.deepStrictEqual(kinds('1(1)-> と ->1(1) と 7a(3)'), ['ref:1(1)', 'ref:1(1)', 'ref:7a(3)']);
  assert.deepStrictEqual(kinds('全角 →2b と（3）'), ['ref:2b', 'self:3']);
  assert.deepStrictEqual(kinds('時刻 11:12 や f(1) や abc1-> や :1a はリンクにしない'), []);
});

test('(1) の行き先', () => {
  const s = 'あいう(1)。\n(1)->説明';
  assert.strictEqual(L.selfTarget(s, '1', true), s.indexOf('(1)->'));
  assert.strictEqual(L.selfTarget(s, '1', false), s.indexOf('(1)'));
  assert.strictEqual(L.anchorPos(s, '1'), s.indexOf('(1)'));
});

test('Markdown との行き来', () => {
  const body = '最初(1)。->1a へ\n(1)->説明 7a(2) と 3->\n普通の [リンク](http://x) は残す';
  const md = L.bodyToMd(body, id => id + '.md');
  assert.match(md, /<a id="c1"><\/a><span style="color:#c0392b">\(1\)<\/span>/);
  assert.match(md, /<a id="c1-"><\/a>\[\(1\)->\]\(#c1\)/);
  assert.match(md, /\[->1a\]\(1a\.md\)/);
  assert.match(md, /\[7a\(2\)\]\(7a\.md#c2\)/);
  assert.match(md, /\[3->\]\(3\.md\)/);
  assert.strictEqual(L.mdToBody(md), body);
});

test('ID', () => {
  assert.deepStrictEqual(['2', '1a1', '1b', '10', '1a', '1'].sort(L.cmpId), ['1', '1a', '1a1', '1b', '2', '10']);
  assert.strictEqual(L.sibling('1a'), '1b'); assert.strictEqual(L.sibling('1z'), '1aa');
  assert.strictEqual(L.child('1'), '1a'); assert.strictEqual(L.child('1a'), '1a1');
  const has = x => ['1', '1a'].includes(x);
  assert.strictEqual(L.parentIn('1a1b', has), '1a'); assert.strictEqual(L.parentIn('1', has), null);
});

test('トピックIndex の行', () => {
  assert.deepStrictEqual(L.topicLine('キーワード 1').ids.map(x => x.id), ['1']);
  assert.strictEqual(L.topicLine('タイトル検索 7b1, 7b2').kw, 'タイトル検索');
  assert.strictEqual(L.topicLine('★ 7b-デジタルPKM').star, '7b-デジタルPKM');
  const m = L.mergeTopic({ d: 'PKM 1a 3\n★ 9-x', p: 'PKM 2\n紙だけ 5' });   // 古い形（d 欄・p 欄）。デジタルのIndex では、紙の欄は、⭐ の行になる
  assert.deepStrictEqual(m.rows, [{ kw: 'PKM', d: ['1a', '3'], p: [], t: [] }]);
  assert.deepStrictEqual(m.rels.map(x => [x.kw, x.ids.map(i => i.s + i.id)]), [['PKM', ['p2']], ['紙だけ', ['p5']]]);
  assert.deepStrictEqual(m.stars, ['9-x']);
});

test('トピックIndex に足す', () => {
  assert.strictEqual(L.addToTopic('', '英雄伝', '1a'), '英雄伝 1a');
  assert.strictEqual(L.addToTopic('英雄伝 1a\n漢字 1', '英雄伝', '2'), '英雄伝 1a 2\n漢字 1');
  assert.strictEqual(L.addToTopic('英雄伝 1a', '英雄伝', '1a'), '英雄伝 1a');
  assert.strictEqual(L.addToTopic('英雄伝 1a\n\n', '新しい', '3'), '英雄伝 1a\n新しい 3');
});

test('読み', () => {
  assert.strictEqual(L.toHira('カンジ'), 'かんじ');
  assert.strictEqual(L.kanaRow('がっこう'), 'か');
  assert.strictEqual(L.kanaRow('ぷるたるこす'), 'は');
  assert.strictEqual(L.kanaRow('PKM'), '英数・他');
  const rd = { 漢字: 'かんじ', 英雄伝: 'えいゆうでん' };
  assert.deepStrictEqual(['PKM', '漢字', '英雄伝'].sort(L.byReading(k => rd[k])), ['英雄伝', '漢字', 'PKM']);
});

test('トピックIndex から ID を外す', () => {
  assert.strictEqual(L.removeFromTopic('英雄伝 1 2\n漢字 1\n★ 3-x', [{ s: 'd', id: '1' }]), '英雄伝 2\n★ 3-x');
});

test('日記の日付・節・階層', () => {
  assert.strictEqual(L.dayOf('2026-11-07 14:20'), '2026-11-07');
  assert.strictEqual(L.dayOf('2026-11-07 03:30'), '2026-11-06'); // 5時までは前の日
  assert.strictEqual(L.todayStr(new Date(2026, 10, 7, 4, 59)), '2026-11-06');
  assert.strictEqual(L.todayStr(new Date(2026, 10, 7, 5, 0)), '2026-11-07');
  assert.strictEqual(L.weekday('2026-11-07'), '土');
  let b = '朝の話';
  b = L.addToSection(b, '今日のノート', ':1');
  b = L.addToSection(b, '今日のノート', ':2');
  b = L.addToSection(b, '紙の日記', '![](P_2026-11-07.jpg)');
  b = L.addToSection(b, '今日のノート', ':3');
  b = L.addToSection(b, '紙の日記', '![](P_2026-11-07_2.jpg)');
  assert.strictEqual(L.addToSection(b, '今日のノート', ':1'), b); // 二重に入れない
  assert.strictEqual(b, '朝の話\n\n## 紙の日記\n\n![](P_2026-11-07.jpg)\n![](P_2026-11-07_2.jpg)\n\n## 今日のノート\n\n:1\n:2\n:3');   // 並び: 本文、紙の日記、今日のノート
  assert.deepStrictEqual(L.diaryTree(['2026-11-07', '2026-11-05', '2026-10-30']), [{ label: '2026-11', days: ['2026-11-07', '2026-11-05'] }, { label: '2026-10', days: ['2026-10-30'] }]);
  assert.deepStrictEqual(L.diaryTree(['2027-01-02', '2026-12-31']).map(y => y.label), ['2027', '2026']);
});

test('IDなしのノート・種類ごとの本文', () => {
  assert.ok(L.isNoid('u20261107-143521') && L.isNoid('u20261107-143521-2'));
  assert.ok(!L.isNoid('1a') && !L.isNoid('2026') && !L.isId('u20261107-143521')); // ID の形と取り違えない
  assert.strictEqual(L.noidStem(new Date(2026, 10, 7, 14, 35, 21)), '20261107143521');
  assert.ok(L.isNoid('20261107143521') && L.isStem('20261107143521') && !L.isStem('1a'));
  const rp = { title: '論語', cast: [{ id: 'a', name: '孔子' }, { id: 'b', name: '私' }], messages: [{ role: 'a', text: '学ぶとは' }, { role: 'b', text: '復習', quote: { kind: 'note', id: '1' } }] };
  assert.strictEqual(L.deriveBody('rp', rp), '# 論語\n\n**孔子**: 学ぶとは\n\n**私**: > 引用: ノート 1\n復習');
  const cv = { title: '案', nodes: [{ type: 'text', x: 5, y: 9, text: '下' }, { type: 'text', x: 0, y: 0, text: '上' }, { type: 'note', s: 'd', nid: '1a', x: 0, y: 5 }, { type: 'image', file: 'a.png', x: 0, y: 1 }] };
  assert.strictEqual(L.deriveBody('canvas', cv), '# 案\n\n上\n\n:1a\n\n下');
  assert.strictEqual(L.deriveBody('text', null), '');
});

test('エクスポート: 番号の範囲・枝、リンクは選んだ中だけ生かす', () => {
  const L = require('../lib');
  const ids = ['1', '1a', '1a1', '1a2', '1b', '2'].sort(L.cmpId);
  assert.deepStrictEqual(L.fzRange(ids, '1a', '1a2'), ['1a', '1a1', '1a2']);
  assert.deepStrictEqual(L.fzSubtree(ids, '1a'), ['1a', '1a1', '1a2']);
  assert.deepStrictEqual(L.fzSubtree(ids, '1'), ['1', '1a', '1a1', '1a2', '1b']);
  const md = L.exportMd([{ s: 'd', id: '1', title: 'あ', body: '続き ->1a と ->2' }, { s: 'd', id: '1a', title: 'い', body: '本文' }]);
  assert.match(md, /## 1 あ/); assert.match(md, /->1a と 2/); assert.match(md, /## 1a い/);
});

test('YAML（---）: 書いて読む。手で書いた形も読める', () => {
  const y = L.fmDump({ folgezettel: '1a', source: 'digital', created: '2026-11-08 07:35:11', keywords: ['a', 'b'], title: '' });
  assert.strictEqual(y, '---\nfolgezettel: "1a"\nsource: "digital"\ncreated: "2026-11-08 07:35:11"\nkeywords: ["a","b"]\n---\n');
  const r = L.fmParse(y + '本文');
  assert.deepStrictEqual(r.meta, { folgezettel: '1a', source: 'digital', created: '2026-11-08 07:35:11', keywords: ['a', 'b'] }); assert.strictEqual(r.rest, '本文');
  assert.deepStrictEqual(L.fmParse('---\nfolgezettel: 1a\nkeywords: [x, y]\n---\n').meta, { folgezettel: '1a', keywords: ['x', 'y'] });
  assert.strictEqual(L.fmParse('本文だけ').meta, null);
  assert.strictEqual(L.now(new Date(2026, 10, 8, 7, 35, 11)), '2026-11-08 07:35:11');
});

test('リンク: ->1a,1b で複数。-> 1a（空白）や コードの中はリンクにしない', () => {
  const ids = t => L.tokens(t).filter(x => x.k === 'ref').map(x => x.id);
  assert.deepStrictEqual(ids('->1a,1b、2 と ->3'), ['1a', '1b', '2', '3']);
  assert.deepStrictEqual(ids('これは -> 1a で、リンクではない'), []);
  assert.deepStrictEqual(ids('`->3` と ``->4`` と ->5'), ['5']);
  assert.deepStrictEqual(ids('前 ->1\n```\n->4 ->5\n```\n後 ->6'), ['1', '6']);
  assert.deepStrictEqual(ids('~~~\n->7\n~~~'), []);
  assert.ok(!L.bodyToMd('`->3`', x => x + '.md').includes('](')); // Markdown にしてもリンクにならない
});
test('トピックIndex: ⭐（+ ★）は関連。名前 ID は関連するキーワードの行、名前だけなら索引への案内。|> は独立', () => {
  const r = L.topicLine('+hoge 1');
  assert.strictEqual(r.star, ''); assert.strictEqual(r.rel.kw, 'hoge'); assert.deepStrictEqual(r.ids.map(x => x.id), ['1']);
  const m = L.mergeTopic({ d: '+hoge 1\n+GUI\nPKM 1\n|> 独立 3', p: '★ 紙 2a' });
  assert.deepStrictEqual(m.rels.map(x => [x.kw, x.ids.map(i => i.s + i.id)]), [['hoge', ['d1']], ['紙', ['p2a']]]);
  assert.deepStrictEqual(m.refs, [{ s: 'd', label: '独立', id: '3' }]);
  assert.deepStrictEqual(m.stars, ['GUI']); assert.strictEqual(m.rows.length, 1);
});

test('紙とデジタルの書き分け: ->ID(p)・(d)・(番号) の順は自由。印なしは、いまの側', () => {
  const t = x => L.tokens(x).filter(y => y.k === 'ref').map(y => [y.id, y.sp, y.n]);
  assert.deepStrictEqual(t('->1a(p)(2) と ->1a(2)(p) と ->3 と ->4(d)'), [['1a', 'p', '2'], ['1a', 'p', '2'], ['3', undefined, undefined], ['4', 'd', undefined]]);
  assert.deepStrictEqual(t('->1a,2(p),3'), [['1a', undefined, undefined], ['2', 'p', undefined], ['3', undefined, undefined]]);
  assert.strictEqual(L.mdToBody(L.bodyToMd('->1a(p)(2)', (id, sp) => `${sp || 'd'}_${id}.md`)), '->1a(p)(2)');   // md にして、戻しても同じ
  assert.ok(L.bodyToMd('->1a(p)', (id, sp) => `${sp || 'd'}_${id}.md`).includes('(p_1a.md)'));
});
test('トピックIndex: 1 つの文字に、印つきで。入口が紙なら、印なしは紙', () => {
  const m = L.mergeTopic({ entry: { s: 'd', id: '1' }, text: 'デジタルと紙の書き分け 1g(1) 2(p) 3(2)(p)\n+hoge 5(p)' });
  assert.deepStrictEqual([m.rows[0].d, m.rows[0].p], [['1g(1)'], []]); assert.deepStrictEqual(m.rels.map(x => [x.kw, x.ids.map(i => i.s + i.raw)]), [['デジタルと紙の書き分け', ['p2', 'p3(2)']], ['hoge', ['p5']]]);   // 紙のIDは、⭐ の行に
  const p = L.mergeTopic({ entry: { s: 'p', id: '9' }, text: 'x 1 2(d)' });   // 紙のトピックIndex
  assert.deepStrictEqual([p.rows[0].p, p.rows[0].d, p.rels.map(r => r.ids.map(i => i.s + i.id))], [['1'], [], [['d2']]]);
  assert.strictEqual(L.removeFromTopic('x 1 2(p)', [{ s: 'p', id: '2' }], 'd'), 'x 1'); assert.strictEqual(L.addToTopic('x 1', 'x', '2(p)'), 'x 1 2(p)');
  assert.strictEqual(L.legacyTopicText({ entry: { s: 'd', id: '1' }, d: 'PKM 1', p: 'PKM 2' }), 'PKM 1\nPKM 2(p)');
});

test('日のノート: 書いた文章は「今日のノート」（リンクの並び）の上に', () => {
  const L = require('../lib');
  assert.strictEqual(L.normDay('## 今日のノート\n\n:1e\n:1c6\n\n06:38 腹下し\n\n15:11 なんか'), '06:38 腹下し\n\n15:11 なんか\n\n## 今日のノート\n\n:1e\n:1c6');
  assert.strictEqual(L.normDay('text\n\n## 今日のノート\n\n:1\n\n## 紙の日記\n\n![](a.jpg)'), 'text\n\n## 紙の日記\n\n![](a.jpg)\n\n## 今日のノート\n\n:1');   // 紙の日記が、今日のノートの上
});

test('リンク: ID-> と複数の元・矢印と、コンマの場所・昔の : から直す', () => {
  const t = x => L.tokens(x).map(y => [y.k, y.id || y.n, y.dir || '', y.arrow ? x.slice(...y.arrow) : '', y.sep ? x.slice(...y.sep) : '']);
  assert.deepStrictEqual(t('1a,1b,1c-> と ->2,3'), [['ref', '1a', 'from', '', ''], ['ref', '1b', 'from', '', ','], ['ref', '1c', 'from', '->', ','], ['ref', '2', 'to', '->', ''], ['ref', '3', 'to', '', ',']]);
  assert.deepStrictEqual(t('→1b と 1b→'), [['ref', '1b', 'to', '→', ''], ['ref', '1b', 'from', '→', '']]);
  assert.deepStrictEqual(t('step1->x と 5->3 と a->1'), []);   // 文字や数字にくっついた矢印は、リンクにしない
  assert.strictEqual(L.colonToArrow(':1a と 1a: と :1a,1b,1c と :(1) (1): :1a(2) 1a(2): 12:30 と a:b と `:1a`'), '->1a と 1a-> と ->1a,1b,1c と ->(1) (1)-> ->1a(2) 1a(2)-> 12:30 と a:b と `:1a`');
});
test('Markdown との行き来: コンマ続きのID（->1a,1b,1c と 1a,1b->）も、元に戻る', () => {
  for (const body of ['->1a,1b,1c と 1a,1b,1c-> と ->2(p),3(2)']) {
    const md = L.bodyToMd(body, (id, sp) => `${sp || 'd'}_${id}.md`);
    assert.strictEqual(L.mdToBody(md), body);
  }
  assert.strictEqual(L.mdToBody('[1a](http://x), [題](a.md)'), '[1a](http://x), [題](a.md)');   // ふつうのリンクは、そのまま
});

test('トピックIndex: 上位（^）・独立（|> ↳ + ★）・独立前（<| ↰）は、別々。行の終わりの 0-1 は索引へのリンク', () => {
  const T = L.topicLine;
  for (const l of ['↳楔形文字で粘土板に英語を書く 2', '|> 楔形文字で粘土板に英語を書く 2', '↪️ 楔形文字で粘土板に英語を書く 2']) {
    const r = T(l); assert.strictEqual(r.star, '', l); assert.deepStrictEqual([r.ref.label, r.ref.id], ['楔形文字で粘土板に英語を書く', '2'], l);
  }
  for (const l of ['↰楔形文字で粘土板に英語を書く 1b', '<| 楔形文字で粘土板に英語を書く 1b']) {
    const r = T(l); assert.strictEqual(r.before, '楔形文字で粘土板に英語を書く', l); assert.strictEqual(r.up, undefined, l); assert.deepStrictEqual(r.ids.map(x => x.id), ['1b'], l);
  }
  for (const l of ['^上位の索引 1b', '＾上位の索引 1b', '↑ 上位の索引 1b']) { const r = T(l); assert.strictEqual(r.up, '上位の索引', l); assert.strictEqual(r.before, undefined, l); }
  const m = L.mergeTopic({ text: 'その他の粘土板の書き方 1b\n粘土板への記録 1b1\n↳ 楔形文字で粘土板に英語を書く 2\n<| 元の索引 1b\n^上位 1\nグループ 0-1 3-2' });
  assert.deepStrictEqual(m.rows.map(r => r.kw), ['その他の粘土板の書き方', '粘土板への記録', 'グループ']);
  assert.deepStrictEqual(m.rows[2].t, ['0-1', '3-2']);
  assert.deepStrictEqual(m.refs, [{ s: 'd', label: '楔形文字で粘土板に英語を書く', id: '2' }]);
  assert.deepStrictEqual(m.befores.map(u => u.kw), ['元の索引']); assert.deepStrictEqual(m.ups.map(u => u.kw), ['上位']);
});

test('トピックIndex: @まとめ は ◯ の見出し。番号の前の * は赤い点（昔の *まとめ も ◯）', () => {
  for (const l of ['@まとめ', '＠まとめ', '* まとめ', '＊まとめ']) assert.strictEqual(L.topicLine(l).mark, 'まとめ', l);
  const m = L.mergeTopic({ text: '@まとめ\nPKM *1 1a\n@進捗' });
  assert.deepStrictEqual(m.marks, ['まとめ', '進捗']); assert.deepStrictEqual(m.rows, [{ kw: 'PKM', d: ['1', '1a'], p: [], t: [], dot: { s: 'd', id: '1' } }]); assert.deepStrictEqual(m.chats, []);
  const r = L.topicLine('PKM *1 1a'); assert.deepStrictEqual(r.ids.map(x => [x.id, !!x.dot, x.from, x.dotAt]), [['1', true, 5, 4], ['1a', false, 7, undefined]]);
  assert.strictEqual(L.removeFromTopic('PKM *1 1a 2', [{ s: 'd', id: '1a' }]), 'PKM *1 2');   // 赤い点は、書き換えても残る
  assert.strictEqual(L.topicLine('*1 1a').mark, undefined);
});

test('全角の「：」と、1d-1 のような索引番号は、リンクにしない', () => {
  assert.strictEqual(L.colonToArrow('元：1d-1  ↳因数分解 2\n新：2-1'), '元：1d-1  ↳因数分解 2\n新：2-1');
  assert.deepStrictEqual(L.tokens('元：1d-1 と ->1d-1').filter(t => t.id).map(t => t.id), []);
});

test('トピックIndex: _名前 ID は下位トピック（↓）。^ や _ の行の終わりの 0-1 は、索引へのリンク', () => {
  for (const l of ['_数学 1b', '＿数学 1b', '↓ 数学 1b']) { const r = L.topicLine(l); assert.strictEqual(r.down, '数学', l); assert.strictEqual(r.up, undefined, l); }
  const m = L.mergeTopic({ text: '^理系 0-4\n_因数分解 2\n_分数 0-3\nキーワード 1a' });
  assert.deepStrictEqual(m.ups.map(u => [u.kw, u.tnos]), [['理系', ['0-4']]]);
  assert.deepStrictEqual(m.downs.map(u => [u.kw, u.ids.map(i => i.id), u.tnos]), [['因数分解', ['2'], []], ['分数', [], ['0-3']]]);
  assert.deepStrictEqual(m.rows.map(r => r.kw), ['キーワード']);
});

test('トピックIndex: 絵文字の印（⬆️ ⬇️ ↘️ ↖️ ⭕ ⭐）も、^ _ |> <| @ + と同じ意味', () => {
  const T = L.topicLine;
  assert.strictEqual(T('⬆️数学 0-1').up, '数学'); assert.strictEqual(T('⬇ 分数 2').down, '分数');
  assert.strictEqual(T('↪️ 因数分解 2').ref.label, '因数分解'); assert.strictEqual(T('↩ 元 1d').before, '元'); assert.strictEqual(T('↘️ 因数分解 2').ref.label, '因数分解'); assert.strictEqual(T('↖️ 元 1d').before, '元');
  assert.strictEqual(T('⭕まとめ').mark, 'まとめ'); assert.strictEqual(T('⭐GUI').star, 'GUI');
  assert.deepStrictEqual(Object.values(L.TMARK), ['⬆️', '⬇️', '↪️', '↩️', '⭕', '⭐', '🔴']);
});

test('トピックIndex: @まとめ ID のように、見出しに番号を続けてもよい', () => {
  const r = L.topicLine('@まとめ 1a 2');
  assert.strictEqual(r.mark, 'まとめ'); assert.deepStrictEqual(r.ids.map(x => x.id), ['1a', '2']);
  const m = L.mergeTopic({ text: '@進捗\n@まとめ 1a 2\nキーワード 3' });
  assert.deepStrictEqual(m.marks, ['進捗']);
  assert.deepStrictEqual(m.rows.map(x => [x.kw, !!x.mark, x.d]), [['まとめ', true, ['1a', '2']], ['キーワード', false, ['3']]]);
});

test('トピックIndex: 印の行もふつうの行も、書いた順に並ぶ（order）', () => {
  const m = L.mergeTopic({ text: 'a 1\n|> 独立 2\nb 3\n@まとめ\n^上位 0-1\n<| 前 1b\n_下位 3\n+GUI\na 4' });
  assert.deepStrictEqual(m.order.map(x => x.k), ['row', 'ref', 'row', 'mark', 'up', 'before', 'down', 'star']);
  assert.deepStrictEqual(m.order[0].o.d, ['1', '4']);   // 同じキーワードの行は、最初の位置にまとまる
});

test('HTMLの書き出し: ノートごとの節・目次・範囲の中のリンクだけ、ページ内で移る', () => {
  const { buildHtml, anchorOf } = require('../export-html');
  const h = buildHtml({ title: 'テスト"<>', notes: [{ s: 'd', id: '1', title: '一 <b>', html: '<p>→ <a href="#n-p-1a">1a</a></p>' }, { s: 'p', id: '1a', title: '二', html: '<p>y</p>' }, { s: 'd', id: 'x', noid: true, title: '', html: '' }], generated: '書き出し' });
  assert.strictEqual(anchorOf('d', '1a'), 'n-d-1a');
  assert.ok(h.includes('<section id="n-d-1" class="note" hidden>') && h.includes('<section id="n-p-1a"') && h.includes('<section id="n-d-x"'));
  assert.ok(h.includes('href="#n-p-1a"') && h.includes('data-k="n-p-1a"'));
  assert.ok(!h.includes('<b>') || h.includes('&lt;b&gt;'));   // 題の < は、そのまま出さない
  assert.ok(h.includes('（3件）') && h.includes('hashchange'));
  const m = h.match(/<script>([\s\S]*)<\/script>/)[1]; new Function(m);   // 中のスクリプトに、文法の誤りがない
});

test('紙のIndex と デジタルのIndex は交わらない: 別の側のIDは、⭐（関連）の行として見せるだけ', () => {
  const m = L.mergeTopic({ entry: { s: 'd', id: '1' }, text: 'キーワード 1a 2(p) 3\n^上位 4(p)\n|> 独立 5(p)\n⭐関連 6(p)\n@見出し 7(p)' });
  assert.deepStrictEqual(m.rows.map(r => [r.kw, r.d, r.p]), [['キーワード', ['1a', '3'], []]]);
  assert.deepStrictEqual(m.rels.map(x => [x.kw, x.ids.map(i => i.s + i.id)]), [['キーワード', ['p2']], ['上位', ['p4']], ['独立', ['p5']], ['関連', ['p6']], ['見出し', ['p7']]]);
  assert.deepStrictEqual([m.ups.length, m.refs.length], [1, 0]);   // 上位は名前だけ残り、独立（|>）は、⭐ に
  const p = L.mergeTopic({ entry: { s: 'p', id: '9' }, text: 'x 1 2(d)' });   // 紙のIndex
  assert.deepStrictEqual([p.rows[0].p, p.rows[0].d, p.rels.map(r => r.ids.map(i => i.s + i.id))], [['1'], [], [['d2']]]);
});
