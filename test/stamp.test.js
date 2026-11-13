const test = require('node:test');
const assert = require('node:assert');
const S = require('../stamp');

test('行ごとの日時: 先頭に付ける・読む・外す（記号は行頭に残す）', () => {
  const at = '2026-11-13 13:05';
  const t = S.add('# 題\n- 箇条書き\n- [ ] やること\n> 引用\n1. 番号\n\n本文', at);
  assert.strictEqual(t, '# 2026-11-13 13:05 題\n- 2026-11-13 13:05 箇条書き\n- [ ] 2026-11-13 13:05 やること\n> 2026-11-13 13:05 引用\n1. 2026-11-13 13:05 番号\n\n2026-11-13 13:05 本文');
  assert.strictEqual(S.stampOf('- 2026-11-13 13:05 買い物'), at);
  assert.strictEqual(S.stampOf('本文'), '');
  assert.strictEqual(S.strip(t), '# 題\n- 箇条書き\n- [ ] やること\n> 引用\n1. 番号\n\n本文');
  assert.strictEqual(S.add(t, '2030-01-01 00:00'), t);   // 付いている行は、変えない
  assert.deepStrictEqual(S.parse('- 2026-11-13 13:05 買い物'), { p: 2, at, end: 19 });
});
test('行ごとの日時: コード・ボード・表・区切り線・自動で入る行には付けない／行番号で絞れる', () => {
  const src = '前\n```board\n{"h":320}\n```\n| a | b |\n| - | - |\n---\n## 今日のノート\n[題](20261113130500.md)\n-\n後';
  assert.strictEqual(S.add(src, '2026-11-13 13:05'), '2026-11-13 13:05 前\n```board\n{"h":320}\n```\n| a | b |\n| - | - |\n---\n## 今日のノート\n[題](20261113130500.md)\n-\n2026-11-13 13:05 後');
  assert.strictEqual(S.add('一\n二\n三', '2026-11-13 13:05', new Set([1])), '一\n2026-11-13 13:05 二\n三');
});
test('行ごとの日時: 昔の形（行末）も読め、先頭の形に直せる', () => {
  const old = '## 題 <!--2026-11-13 13:05-->\n- 本文 <!--2026-11-13 13:06-->\nそのまま';
  assert.strictEqual(S.stampOf('本文 <!--2026-11-13 13:05-->'), '2026-11-13 13:05');
  assert.strictEqual(S.strip(old), '## 題\n- 本文\nそのまま');
  assert.strictEqual(S.migrate(old), '## 2026-11-13 13:05 題\n- 2026-11-13 13:06 本文\nそのまま');
  assert.strictEqual(S.add('本文 <!--2026-11-13 13:05-->', '2030-01-01 00:00'), '本文 <!--2026-11-13 13:05-->');   // 昔の形が付いている行にも、重ねて付けない
});
test('行ごとの日時: 画面に出す形', () => {
  assert.strictEqual(S.show('2026-11-13 13:05', '2026-11-13'), '13:05');
  assert.strictEqual(S.show('2026-11-12 23:50', '2026-11-13'), '2026-11-12 23:50');
  assert.match(S.nowStamp(new Date(2026, 10, 3, 4, 5, 6)), /^2026-11-03 04:05:06$/);
  assert.strictEqual(S.format('2026-11-13 12:54:30', { sec: true }), '2026-11-13 12:54:30'); assert.strictEqual(S.format('2026-11-13 12:54:30', { sec: false }), '2026-11-13 12:54');
  assert.strictEqual(S.format('2026-11-13 12:54:30', { sec: false, short: true }, '2026-11-13'), '12:54'); assert.strictEqual(S.format('2026-11-12 12:54:30', { sec: true, short: true }, '2026-11-13'), '2026-11-12 12:54:30');
  assert.strictEqual(S.format('2026-11-13 12:54', { sec: true }), '2026-11-13 12:54');   // 昔の分までのものは、そのまま
});
test('行ごとの日時: 昔の「13:05 本文」は、その日の年月日つきにする', () => {
  assert.strictEqual(S.adoptTimes('10:35 abc\n- 11:00 箇条書き\n```\n10:35 コード\n```\n12:99 時刻ではない', '2026-11-13'), '2026-11-13 10:35 abc\n- 2026-11-13 11:00 箇条書き\n```\n10:35 コード\n```\n12:99 時刻ではない');
});

test('行ごとの日時: 秒までの日時も、先頭で読める', () => {
  assert.strictEqual(S.stampOf('- 2026-11-13 12:54:30 買い物'), '2026-11-13 12:54:30');
  assert.deepStrictEqual(S.parse('2026-11-13 12:54:30 本文'), { p: 0, at: '2026-11-13 12:54:30', end: 20 });
  assert.strictEqual(S.strip('# 2026-11-13 12:54:30 題\n2026-11-13 12:54 分まで'), '# 題\n分まで');
  assert.strictEqual(S.add('本文', '2026-11-13 12:54:30'), '2026-11-13 12:54:30 本文');
});
