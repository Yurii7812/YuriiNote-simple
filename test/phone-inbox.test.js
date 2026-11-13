const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { openVault } = require('../store');
const { importInbox, summary } = require('../phone-inbox');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pkm-'));
const J = (name, o) => ({ name, buf: Buffer.from(JSON.stringify(o)) });

test('スマホの受信箱: メモ帳・日記・ノート・紙を取り込み、取り込めたものを返す', () => {
  const v = openVault(tmp()), got = [];
  const files = [
    J('memo-1-a.json', { type: 'memo', at: '2026-11-13 08:12', text: '朝の考え', stamp: true }),
    J('memo-2-b.json', { type: 'memo', at: '2026-11-13 10:40', text: '二つ目\nの続き', stamp: true }),
    J('memo-3-c.json', { type: 'memo', at: '2026-11-13 11:00', text: '時刻なし', stamp: false }),
    J('diary-4-d.json', { type: 'diary', kind: '日記', date: '2026-11-13', text: '今日は読書をした。' }),
    J('note-5-e.json', { type: 'note', created: '2026-11-13 13:20', body: '読書メモの書き方を整理したい' }),
    J('paper-6-f.json', { type: 'paper', at: '2026-11-13 14:00', image: 'paper-6-f.jpg' }), { name: 'paper-6-f.jpg', buf: Buffer.from([0xff, 0xd8, 0xff]) },
    { name: 'broken.json', buf: Buffer.from('{') }, J('memo-7-g.json', { type: 'memo', at: '2026-11-13 12:00', text: '   ' })
  ];
  const r = importInbox(v, files, { papers: (name, buf) => got.push([name, buf.length]) });
  assert.deepStrictEqual(r.sum, { memos: 3, diaries: 1, notes: 1, papers: 1, skipped: 2, already: 0 });
  const memo = v.state().diaries.find(d => d.kind === 'メモ帳' && d.date === '2026-11-13').body;
  assert.strictEqual(memo, '2026-11-13 08:12 朝の考え\n2026-11-13 10:40 二つ目 の続き\n2026-11-13 11:00 時刻なし');   // 1件1行・改行は空白に・全部に年月日と時刻
  assert.match(v.state().diaries.find(d => d.kind === '日記' && d.date === '2026-11-13').body, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} 今日は読書をした。/);
  const note = v.state().notes.find(n => /読書メモの書き方/.test(n.body));
  assert.ok(note && note.s === 'd' && note.id === note.stem && /^\d{14}$/.test(note.id));   // ID なし（ファイル名が ID 代わり）＝未所属
  assert.deepStrictEqual(got, [['paper-6-f.jpg', 3]]);
  assert.deepStrictEqual(r.done.sort(), ['memo-1-a.json', 'memo-2-b.json', 'memo-3-c.json', 'diary-4-d.json', 'note-5-e.json', 'paper-6-f.json', 'paper-6-f.jpg'].sort());
  assert.deepStrictEqual(r.bad.sort(), ['broken.json', 'memo-7-g.json']);
  assert.strictEqual(summary(r.sum), 'メモ 3 件、日記 1 件、ノート 1 件、紙のカード 1 枚');
});

test('スマホの受信箱: 消さずに残してあるファイルは、二度取り込まない', () => {
  const v = openVault(tmp()), files = [J('memo-1.json', { type: 'memo', at: '2026-11-13 08:12', text: '一度だけ', stamp: true }), J('memo-2.json', { type: 'memo', at: '2026-11-13 09:00', text: '新しい', stamp: true })];
  const first = importInbox(v, files.slice(0, 1));
  const second = importInbox(v, files, { seen: new Set(first.done) });
  assert.strictEqual(second.sum.memos, 1); assert.strictEqual(second.sum.already, 1);
  assert.strictEqual(v.state().diaries.find(d => d.kind === 'メモ帳').body, '2026-11-13 08:12 一度だけ\n2026-11-13 09:00 新しい');
});
