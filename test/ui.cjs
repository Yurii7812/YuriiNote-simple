// npm install --no-save playwright && npx playwright install chromium
// PLAYWRIGHT_CHROMIUM_EXECUTABLE can select an installed Chromium.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
let browser;
before(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
});
after(async () => { await browser?.close(); });

const seed = {
  version: 1, settings: { allowMultipleTopics: false },
  notes: [
    { uid: 'one', id: '1', title: '読書', body: '大切な考え (1)', keywords: ['本'] },
    { uid: 'two', id: '1a', title: '考察', body: '冬の散歩と習慣', keywords: ['生活'] },
    { uid: 'three', id: '2', title: '', body: 'まだタイトルは決めない' },
    { uid: 'draft', body: 'IDはあとで決める' }
  ], topics: []
};
async function setup(t, initial = seed, failLoad = false) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 780 } });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(({ initial, failLoad }) => {
    window.__saves = [];
    window.__failSave = false;
    window.__closeReady = null;
    window.prompt = () => { throw Error('window.prompt is unsupported by Electron'); };
    window.bridge = {
      load: async () => { if (failLoad) throw Error('load failed'); return JSON.parse(localStorage.getItem('test-data') || JSON.stringify(initial)); },
      save: async data => { if (window.__failSave) throw Error('disk full'); window.__saves.push(data); localStorage.setItem('test-data', JSON.stringify(data)); },
      openFolder: async () => '',
      onCloseRequest: callback => { window.__requestClose = callback; },
      closeReady: success => { window.__closeReady = success; }
    };
  }, { initial, failLoad });
  await page.goto(pathToFileURL(path.join(__dirname, '../index.html')).href);
  await page.waitForFunction(() => ['保存済み', '読み込みエラー'].includes(document.getElementById('saveStatus').textContent));
  return page;
}
async function persist(page) {
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.getElementById('saveStatus').textContent === '保存済み');
  return page.evaluate(() => JSON.parse(localStorage.getItem('test-data')));
}
async function index(page, kind = 'global', query = '') {
  await page.locator('[data-view="index"]').click();
  await page.locator('#indexKind').selectOption(kind);
  await page.locator('#search').fill(query);
}
async function submitDialog(page, value) {
  await page.locator('#dialogInput').fill(value);
  await page.locator('#entryForm').evaluate(form => form.requestSubmit());
  await page.waitForFunction(() => !document.getElementById('entryDialog').open);
}

test('write first, switch screens immediately, find drafts and reload without losing text', async t => {
  const page = await setup(t);
  assert.equal(await page.locator('nav button').count(), 2);
  assert.equal(await page.locator('.sidebar').count(), 0);
  await page.locator('#newNote').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'noteBody');
  await page.locator('#noteBody').fill('書きかけの文章');
  await index(page);
  await page.getByRole('button', { name: /書きかけの文章/ }).click();
  assert.equal(await page.locator('#noteBody').inputValue(), '書きかけの文章');
  const saved = await persist(page);
  assert.equal(saved.notes.at(-1).id, '');
  await page.reload();
  await page.getByRole('button', { name: /書きかけの文章/ }).click();
  assert.equal(await page.locator('#noteBody').inputValue(), '書きかけの文章');
});

test('search filters the visible index, including body text; unlabelled numbered notes remain reachable', async t => {
  const page = await setup(t);
  await page.locator('#search').fill('冬の散歩');
  assert.equal(await page.locator('.entry-row').count(), 2); // title and keyword of 1a
  assert.equal(await page.getByRole('button', { name: '1', exact: true }).count(), 0);
  await index(page, 'global');
  await page.getByRole('button', { name: /まだタイトルは決めない/ }).click();
  assert.equal(await page.locator('#noteBody').inputValue(), 'まだタイトルは決めない');
  await index(page, 'all', '存在しない言葉');
  assert.match(await page.locator('#content').innerText(), /一致する項目はありません/);
});

test('ID dialog, branch and sibling creation, keywords, and native text undo', async t => {
  const page = await setup(t, { notes: [], topics: [] });
  await page.locator('#newNote').click();
  await page.getByRole('button', { name: 'IDを付ける', exact: true }).click();
  await submitDialog(page, '1');
  await page.getByRole('button', { name: '分岐 1a', exact: true }).click();
  await page.locator('#noteBody').pressSequentially('abc');
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#noteBody').inputValue(), '');
  await page.keyboard.press('Control+Shift+z');
  assert.equal(await page.locator('#noteBody').inputValue(), 'abc');
  await page.locator('#noteBody').fill('分岐の本文');
  await page.getByText('キーワード・その他', { exact: true }).click();
  await page.locator('#noteKeywords').fill('読書、考える');
  await page.getByRole('button', { name: '並列 1b', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'IDを変更 1b', exact: true }).count(), 1);
  const saved = await persist(page);
  assert.deepEqual(saved.notes.map(n => n.id), ['1', '1a', '1b']);
  assert.deepEqual(saved.notes[1].keywords, ['読書', '考える']);
});

test('Topic Index default single mode, multiple toggle, pages, 0 Index and page references', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: '1', exact: true }).first().click();
  await page.getByRole('button', { name: '＋ Topic Index', exact: true }).click();
  await submitDialog(page, '読書の索引');
  await page.locator('#topicBody').fill('考察 1a\n↑1a-1\n●まとめ 1');
  await page.getByRole('button', { name: '＋ ページ', exact: true }).click();
  await page.locator('#topicBody').fill('2ページ目のまとめ');
  await page.getByRole('button', { name: '元ノート 1', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: '＋ Topic Index', exact: true }).count(), 0);
  assert.equal(await page.locator('.has-topic').count(), 1);
  await index(page);
  await page.getByText('設定・使い方', { exact: true }).click();
  await page.locator('#allowMultipleTopics').check();
  await page.locator('#search').fill('1-1(2)');
  await page.locator('#search').press('Enter');
  assert.equal(await page.locator('#topicBody').inputValue(), '2ページ目のまとめ');
  await page.getByRole('button', { name: '元ノート 1', exact: true }).click();
  await page.getByRole('button', { name: '＋ Topic Index', exact: true }).click();
  await submitDialog(page, '別の入口');
  assert.equal(await page.locator('.note-heading .code-id').innerText(), '1-2');
  await index(page);
  await page.locator('#allowMultipleTopics').uncheck();
  await page.locator('#search').fill('0');
  await page.locator('#search').press('Enter');
  assert.equal(await page.locator('#search').inputValue(), '');
  assert.equal(await page.locator('.note-row').count(), 2);
  await page.locator('.note-row').filter({ hasText: '読書の索引' }).click();
  await page.getByRole('button', { name: '元ノート 1', exact: true }).click();
  await page.locator('#noteBody').fill('索引を見る 1-1(2)');
  await page.getByRole('button', { name: '1-1(2)', exact: true }).click();
  assert.equal(await page.locator('#topicBody').inputValue(), '2ページ目のまとめ');
  const saved = await persist(page);
  assert.equal(saved.settings.allowMultipleTopics, false);
  assert.deepEqual(saved.topics.map(t => t.id), ['1-1', '1-2']);
});

test('cancelling dialogs, failed saves, retry and close handshake preserve the editor', async t => {
  const page = await setup(t);
  await page.getByRole('button', { name: '1', exact: true }).first().click();
  await page.getByRole('button', { name: 'IDを変更 1', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('entryDialog').open);
  assert.equal(await page.getByRole('button', { name: 'IDを変更 1', exact: true }).count(), 1);
  await page.evaluate(() => { window.__failSave = true; });
  await page.locator('#noteBody').fill('保存エラーでも本文は残す');
  await page.evaluate(() => window.__requestClose());
  assert.equal(await page.evaluate(() => window.__closeReady), false);
  assert.equal(await page.locator('#saveStatus').innerText(), '保存エラー');
  assert.equal(await page.locator('#noteBody').inputValue(), '保存エラーでも本文は残す');
  await page.evaluate(() => { window.__failSave = false; });
  const saved = await persist(page);
  assert.equal(saved.notes[0].body, '保存エラーでも本文は残す');
  await page.evaluate(() => window.__requestClose());
  assert.equal(await page.evaluate(() => window.__closeReady), true);
});

test('load failure blocks edits and saves, but still permits closing', async t => {
  const page = await setup(t, seed, true);
  assert.equal(await page.locator('#newNote').isDisabled(), true);
  await page.keyboard.press('Control+n');
  assert.equal(await page.locator('#noteBody').count(), 0);
  await page.evaluate(() => window.__requestClose());
  assert.equal(await page.evaluate(() => window.__closeReady), true);
  assert.equal(await page.evaluate(() => window.__saves.length), 0);
});

test('two-screen layout fits the minimum desktop window without horizontal overflow', async t => {
  const page = await setup(t);
  if (process.env.UI_SCREENSHOT_DIR) {
    require('node:fs').mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'index.png'), fullPage: true });
  }
  await page.setViewportSize({ width: 760, height: 560 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(await overflow(), false);
  await page.getByRole('button', { name: '1', exact: true }).first().click();
  assert.equal(await page.locator('#indexTools').isVisible(), false);
  assert.equal(await page.locator('#settings').isVisible(), false);
  assert.equal(await overflow(), false);
  if (process.env.UI_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, 'note.png'), fullPage: true });
});
