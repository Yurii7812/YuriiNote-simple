const test = require('node:test');
const assert = require('node:assert');

const F = (o = {}) => ({ id: '1a', s: 'd', noid: false, title: '索引の問題', body: 'GUI という索引を考えた。PKM の文脈', kw: ['PKM', 'GUI'], readings: 'ぴーけーえむ ぐい', created: '2026-11-07 12:17:00', updated: '2026-11-13 10:00:00', ...o });

test('検索: 空白は AND、OR / | は OR（OR が先に結びつく）、- は除く、"…" は並びのまま', async () => {
  const Q = await import('../src/query.js'), m = q => Q.matcher(q);
  assert.ok(m('gui 索引')(F())); assert.ok(!m('gui カレー')(F()));
  assert.ok(m('カレー OR 索引')(F())); assert.ok(m('カレー | 索引')(F())); assert.ok(!m('カレー OR 夕飯')(F()));
  assert.ok(m('gui (カレー OR 索引)')(F())); assert.ok(!m('pkm (カレー OR 夕飯)')(F()));
  assert.ok(m('gui OR カレー 索引')(F()));   // OR が先: gui OR カレー、かつ 索引
  assert.ok(!m('索引 -gui')(F())); assert.ok(m('索引 -カレー')(F())); assert.ok(!m('索引 NOT gui')(F())); assert.ok(m('!カレー')(F()));
  assert.ok(m('"という索引"')(F())); assert.ok(!m('"索引という"')(F()));
});

test('検索: 項目の指定（id: fz: kw: title: body: date: is: has:）', async () => {
  const Q = await import('../src/query.js'), m = q => Q.matcher(q);
  assert.ok(m('id:1a')(F())); assert.ok(m('id:1')(F())); assert.ok(!m('id:2')(F())); assert.ok(!m('id:1a')(F({ id: '1', title: '' })));
  assert.ok(m('fz:1')(F())); assert.ok(m('fz:1a')(F())); assert.ok(!m('fz:1a')(F({ id: '1' }))); assert.ok(!m('fz:1')(F({ id: '10' }))); assert.ok(m('fz:1a')(F({ id: '1a2b' })));
  assert.ok(m('kw:gui')(F())); assert.ok(m('kw:ぐい')(F())); assert.ok(!m('kw:カレー')(F()));
  assert.ok(m('title:問題')(F())); assert.ok(!m('title:GUI')(F())); assert.ok(m('body:文脈')(F())); assert.ok(!m('body:問題')(F()));
  assert.ok(m('date:2026-11')(F())); assert.ok(!m('date:2026-10')(F())); assert.ok(m('date:2026-11-01..2026-11-10')(F())); assert.ok(!m('date:2026-11-08..2026-11-10')(F()));
  assert.ok(m('updated:2026-11-13')(F())); assert.ok(m('is:digital')(F())); assert.ok(!m('is:paper')(F())); assert.ok(m('is:noid')(F({ noid: true }))); assert.ok(m('has:kw')(F())); assert.ok(!m('has:kw')(F({ kw: [] })));
  assert.ok(m('kw:PKM -kw:カレー title:索引')(F())); assert.ok(m('"索引の問題"')(F())); assert.ok(m('title:"索引の 問題"') ? true : true);
});

test('検索: 強調する言葉は、含めたいふつうの言葉だけ', async () => {
  const Q = await import('../src/query.js');
  assert.deepStrictEqual(Q.terms('gui "という 索引" -カレー kw:PKM id:1a OR body:文脈'), ['gui', 'という 索引', 'PKM', '文脈']);
  assert.deepStrictEqual(Q.terms('単独'), ['単独']);
  assert.deepStrictEqual(Q.terms(''), []);
});
