const test=require('node:test');
const assert=require('node:assert/strict');
const {externalUri,bareUrls}=require('../url-links');
test('external URLs open unchanged, including query and hash fragments',()=>{
  assert.equal(externalUri('https://example.com/a?key=1#section-2'),'https://example.com/a?key=1#section-2');
  assert.equal(externalUri('www.example.org/foo'),'https://www.example.org/foo');
  assert.equal(externalUri('mailto:help@example.org'),'mailto:help@example.org');
  for(const bad of ['javascript:alert(1)','data:text/html,hi','file:///home/a','ftp://example.org',''])assert.equal(externalUri(bad),null);
});
test('bare links in notes exclude Markdown links, inline code, and Mermaid fences',()=>{
  const fence=String.fromCharCode(96).repeat(3);
  const source=[
    'Read https://example.com/a?x=1#top.',
    '[label](https://other.example/a)',
    String.fromCharCode(96)+'https://inline.example'+String.fromCharCode(96),
    fence+'mermaid',
    'A["https://diagram.example"]-->B',
    fence,
    'www.example.org'
  ].join('\n');
  const a=source.indexOf('[label]'),b=a+'[label](https://other.example/a)'.length;
  const results=bareUrls(source,[[a,b]]);
  assert.deepEqual(results.map(x=>x.url),['https://example.com/a?x=1#top','https://www.example.org']);
});

test('URLの札: 取り直しに失敗しても、前に取れた題・説明・サムネは残る。取れなかったものは、1時間たったら、また取りに行く', async () => {
  const P = require('../url-preview');
  const docs = {}; const store = { state: () => ({ docs, notes: [], diaries: [] }), saveDoc: (n, d) => { docs[n] = d; } };
  let mode = 'ok', calls = 0;
  const svc = P.createService(store, { fetcher: async () => { calls++; if (mode === 'ok') return { title: '題', description: '説明', thumbnail: 'data:image/png;base64,AAAA' }; throw Error('HTTP 404'); } });
  const a = await svc.get('https://example.com/a'); assert.strictEqual(a.title, '題');
  mode = 'fail';
  const b = await svc.get('https://example.com/a', true);   // 取り直し: 失敗
  assert.ok(b.error); assert.deepStrictEqual([b.title, b.description, b.thumbnail], ['題', '説明', 'data:image/png;base64,AAAA']);   // 前のものが、残る
  assert.strictEqual(docs.K_urlCache.items['https://example.com/a'].title, '題');                                                   // 保存にも、残る
  // 最初から取れなかったもの: すぐには、取りに行かない。1 時間後には、取りに行く
  const c = await svc.get('https://example.com/dead'); assert.ok(c.error); const before = calls;
  await svc.get('https://example.com/dead'); assert.strictEqual(calls, before);
  docs.K_urlCache.items['https://example.com/dead'].fetchedAt = Date.now() - 2 * 3600000; mode = 'ok';
  const d = await svc.get('https://example.com/dead'); assert.strictEqual(d.title, '題'); assert.ok(!d.error);
});
