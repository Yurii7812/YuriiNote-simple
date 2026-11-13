const test = require('node:test');
const assert = require('node:assert');
const S = require('../stamp');

test('行ごとの目印: 付ける・読む・外す', () => {
  const at = '2026-11-13 13:05';
  const t = S.add('# 題\n- 箇条書き\n\n本文', at);
  assert.strictEqual(t, '# 題 <!--2026-11-13 13:05-->\n- 箇条書き <!--2026-11-13 13:05-->\n\n本文 <!--2026-11-13 13:05-->');
  assert.strictEqual(S.stampOf('本文 <!--2026-11-13 13:05-->'), at);
  assert.strictEqual(S.stampOf('本文'), '');
  assert.strictEqual(S.strip(t), '# 題\n- 箇条書き\n\n本文');
  assert.strictEqual(S.add(t, '2030-01-01 00:00'), t);   // 付いている行は、変えない
});
test('行ごとの目印: コード・ボード・表・区切り線には付けない／行番号で絞れる', () => {
  const src = '前\n```board\n{"h":320}\n```\n| a | b |\n| - | - |\n---\n後';
  assert.strictEqual(S.add(src, '2026-11-13 13:05'), '前 <!--2026-11-13 13:05-->\n```board\n{"h":320}\n```\n| a | b |\n| - | - |\n---\n後 <!--2026-11-13 13:05-->');
  assert.strictEqual(S.add('一\n二\n三', '2026-11-13 13:05', new Set([1])), '一\n二 <!--2026-11-13 13:05-->\n三');
});
test('行ごとの目印: 画面に出す形', () => {
  assert.strictEqual(S.show('2026-11-13 13:05', '2026-11-13'), '13:05');
  assert.strictEqual(S.show('2026-11-12 23:50', '2026-11-13'), '2026-11-12 23:50');
  assert.strictEqual(S.show('', '2026-11-13'), '');
  assert.match(S.nowStamp(new Date(2026, 10, 3, 4, 5)), /^2026-11-03 04:05$/);
});
