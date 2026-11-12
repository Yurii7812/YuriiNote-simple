const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../core');

test('Folgezettel children, siblings, and ordering', () => {
  assert.equal(P.child('1'), '1a');
  assert.equal(P.child('1a'), '1a1');
  assert.equal(P.child('1a1'), '1a1a');
  assert.equal(P.sibling('1'), '2');
  assert.equal(P.sibling('1a'), '1b');
  assert.equal(P.sibling('1a1'), '1a2');
  assert.equal(P.unusedChild('1', ['1','1a','1b']), '1c');
  assert.equal(P.unusedSibling('1a', ['1a','1b']), '1c');
  assert.deepEqual(
    ['2', '1b', '1a1', '1', '1a', '1a2'].sort(P.compareNotes),
    ['1', '1a', '1a1', '1a2', '1b', '2']
  );
});

test('Topic Index IDs default to a single 1-1 and allow 1-2 only by setting', () => {
  assert.equal(P.topicId('1'), '1-1');
  assert.equal(P.topicId('1a'), '1a-1');
  assert.equal(P.topicId('1', 2), '1-2');
  assert.equal(P.ownerOf('1a-2'), '1a');
  assert.equal(P.nextTopicId('1', []), '1-1');
  assert.throws(() => P.nextTopicId('1', ['1-1']), /設定/);
  assert.equal(P.nextTopicId('1', ['1-1'], true), '1-2');
  assert.equal(P.nextTopicId('1', ['1-1','1-3'], true), '1-2');
  assert.equal(P.nextTopicId('1a', ['1-1','1-2']), '1a-1');
  assert.equal(P.validTopic('1a-2'), true);
  assert.equal(P.validTopic('0-1'), false);
});

test('Topic Index page references are distinct from note citation markers', () => {
  assert.deepEqual(P.parseRef('1-1(2)'), { kind: 'topic', id: '1-1', page: 2 });
  assert.deepEqual(P.parseRef('1-2(4)'), { kind: 'topic', id: '1-2', page: 4 });
  assert.deepEqual(P.parseRef('1a-1(2)'), { kind: 'topic', id: '1a-1', page: 2 });
  assert.deepEqual(P.parseRef(':1a(2)'), { kind: 'note', id: '1a', anchor: 2 });
  assert.deepEqual(P.parseRef('0'), { kind: 'zero', id: '0', page: 1 });
  assert.equal(P.parseRef('1a-0'), null);
  assert.equal(P.parseRef('2026-11-12'), null);
});

test('References do not mistake dates and bare passage markers for links', () => {
  const found = P.findRefs('★ 1a-1 と 1-1(2) と :2a と 2a(1)。2026-11-12、(1) は内部。');
  assert.deepEqual(found.map(x => x.label), ['1a-1', '1-1(2)', '2a', '2a(1)']);
});

test('Both settings modes retain existing indexes without deleting notes', () => {
  const input = {
    notes: [
      { uid: 'first', id: '1', title: '考察' },
      { uid: 'second', id: '1a', body: '続き' },
      { uid: 'draft', id: '', body: 'まだ決めない' }
    ],
    topics: [
      { id: '1-1', title: '出発点', pages: ['最初', '２ページ目'] },
      { id: '1-2', title: '別の視点', pages: [''] },
      { id: '1-1', title: '重複', pages: [''] },
      { id: '1a-1', title: '1a', pages: [''] },
      { id: '9-1', title: '存在しない親', pages: [''] }
    ]
  };
  const initial = P.normalize(input);
  assert.equal(initial.settings.allowMultipleTopics, false);
  assert.deepEqual(initial.topics.map(t => t.id), ['1-1','1-2','1a-1']);
  assert.equal(initial.topics[0].pages[1], '２ページ目');
  assert.equal(initial.notes[2].id, '');
  const enabled = P.normalize({ ...input, settings: { allowMultipleTopics: true } });
  assert.equal(enabled.settings.allowMultipleTopics, true);
  assert.equal(P.nextTopicId('1', enabled.topics.map(t => t.id), true), '1-3');
  assert.equal(P.globalEntries(enabled).find(e => e.keyword === '出発点').items[0].id, '1-1');
});

test('Topic Index notation accepts the agreed symbols and rejects invalid page numbers', () => {
  for (const prefix of ['↑', '★', '●', '^', '+', '=']) {
    assert.equal(P.parseRef(prefix + ' 1-1(2)').page, 2);
  }
  assert.equal(P.parseRef('1-1(0)'), null);
  assert.equal(P.parseRef('1-1(99999999999999999999)'), null);
});
