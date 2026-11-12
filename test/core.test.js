const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../core');

test('Original Folgezettel branching and ordering are preserved', () => {
  assert.equal(P.child('1'), '1a');
  assert.equal(P.child('1a'), '1a1');
  assert.equal(P.child('1a1'), '1a1a');
  assert.equal(P.sibling('1a'), '1b');
  assert.equal(P.sibling('1a1'), '1a2');
  assert.equal(P.sibling('1'), '2');
  assert.equal(P.unusedChild('1', ['1', '1a', '1b']), '1c');
  assert.equal(P.unusedSibling('1a', ['1a','1b']), '1c');
  assert.deepEqual(['2', '1b', '1a1', '1', '1a', '1a2'].sort(P.compareNotes),
    ['1', '1a', '1a1', '1a2', '1b', '2']);
});

test('Paper-style Topic Index IDs and page references', () => {
  assert.equal(P.topicId('1'), '1-1');
  assert.equal(P.topicId('1a'), '1a-1');
  assert.equal(P.ownerOf('1a-1'), '1a');
  assert.deepEqual(P.parseRef('1-1(2)'), { kind: 'topic', id: '1-1', page: 2 });
  assert.deepEqual(P.parseRef('1a(2)'), { kind: 'note', id: '1a', anchor: 2 });
  assert.deepEqual(P.parseRef('0'), { kind: 'zero', id: '0', page: 1 });
  assert.equal(P.parseRef('2026-11-12'), null);
  assert.equal(P.parseRef('1a-2'), null);
});

test('References in note and Topic Index text can be identified', () => {
  const refs = P.findRefs('★ 1a-1 を見て、1-1(2)と :2a と 2a(1) を比較。日付は2026-11-12。');
  assert.deepEqual(refs.map(x => x.label), ['1a-1', '1-1(2)', '2a', '2a(1)']);
});

test('One topic per note ID and optional indexes', () => {
  const d = P.normalize({ notes: [{ id: '1', title: '思考' }, { id: '1a', body: '続き' }],
    topics: [{ id: '1-1', pages: ['first','second'] }, { id: '1-1', pages: ['duplicate'] },
      { id: '2-1', pages: ['orphan'] }, { id: '1a-1', title: '続きの索引' }] });
  assert.deepEqual(d.topics.map(t => t.id), ['1-1', '1a-1']);
  assert.equal(d.topics[0].pages[1], 'second');
  assert.equal(P.globalEntries(d).find(x => x.keyword === '続きの索引').items[0].id, '1a-1');
});
