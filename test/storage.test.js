const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuriinote-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const mockElectron = { app: { setName() {}, getPath: () => dir, whenReady: () => ({ then() {} }), on() {} } };
  const context = { require: name => name === 'electron' ? mockElectron : require(name), __dirname: path.resolve(__dirname, '..') };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8') + '\nthis.store = { loadData, saveData };', context);
  return { dir, ...context.store };
}

test('an unreadable store with no backup fails instead of silently returning empty notes', t => {
  const s = store(t);
  const file = path.join(s.dir, 'data.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => s.loadData(), /読み取れません/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('backup recovery, atomic saves, and retaining the previous note data', t => {
  const s = store(t);
  const initial = { version: 1, notes: [{ uid: 'one', id: '1', body: '本文' }], topics: [] };
  s.saveData(initial);
  assert.deepEqual(JSON.parse(JSON.stringify(s.loadData())), initial);
  const next = { ...initial, notes: [...initial.notes, { uid: 'two', body: '未採番' }] };
  s.saveData(next);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dir, 'data.backup.json'), 'utf8')), initial);
  assert.equal(fs.existsSync(path.join(s.dir, 'data.json.tmp')), false);
  fs.writeFileSync(path.join(s.dir, 'data.json'), '{broken');
  assert.deepEqual(JSON.parse(JSON.stringify(s.loadData())), initial);
});
