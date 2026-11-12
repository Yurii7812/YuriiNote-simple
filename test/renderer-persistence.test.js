const test = require('node:test');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');
const { openVault } = require('../store');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const bundled = require('esbuild').buildSync({ entryPoints: [path.join(__dirname, '../src/app.js')], bundle: true, write: false, format: 'iife', logLevel: 'silent' }).outputFiles[0].text;
const tick = () => new Promise(r => setTimeout(r, 30));

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yn-ui-')), store = openVault(dir);
  store.saveNote({ s: 'd', id: '1', title: 'A', body: '最初の文章' });
  store.saveNote({ s: 'd', id: '2', title: 'B', body: '別のノート' });
  store.saveDoc('K_settings', { lang: 'ja' });
  return { dir, store, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
async function client(store, initialStorage = {}) {
  const errors = [], callbacks = {}, flags = { fail: false }, vc = new VirtualConsole();
  vc.on('jsdomError', e => { if (!String(e).includes('Not implemented')) errors.push(String(e)); });
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.Range.prototype.getClientRects = () => [];
  w.Range.prototype.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 });
  w.confirm = () => true; w.alert = x => { errors.push('alert: ' + x); };
  flags.clipboard = [];
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async text => { flags.clipboard.push(text); } } });
  for (const [key, value] of Object.entries(initialStorage)) w.localStorage.setItem(key, value);
  w.api = new Proxy({}, { get(_, key) {
    if (String(key).startsWith('on')) return cb => { callbacks[key] = cb; };
    if (key === 'load' || key === 'state') return async () => structuredClone(store.state());
    if (key === 'urlTitle') return () => new Promise(resolve => { flags.resolveTitle = resolve; });
    if (key === 'saveNote') return async n => { if (flags.fail) throw Error('disk full'); return structuredClone(store.saveNote(n)); };
    if (typeof store[key] === 'function') return async (...args) => structuredClone(store[key](...structuredClone(args)));
    if (key === 'appInfo') return async () => ({ version: 'test' });
    return async () => null;
  } });
  w.eval(bundled); await tick();
  const click = selector => { const el = w.document.querySelector(selector); assert.ok(el, selector); el.click(); };
  return {
    w, callbacks, flags, errors, click,
    open: id => click(`#list [data-id="${id}"][data-s="d"]`),
    edit: text => { const v = w.__pkm.view; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }); },
    text: () => w.__pkm.view.state.doc.toString(), close: () => dom.window.close(),
    storage: () => Object.fromEntries(Array.from({ length: w.localStorage.length }, (_, i) => { const k = w.localStorage.key(i); return [k, w.localStorage.getItem(k)]; }))
  };
}

test('renderer: rapid switching, mounted editor refresh, save failure/retry and adjacent plus/name/create flow', async () => {
  const f = fixture(), c = await client(f.store);
  try {
    c.open('1'); assert.equal(c.text(), '最初の文章');
    c.edit('書いてすぐ移動しても残る'); c.open('2'); c.open('1');
    assert.equal(c.text(), '書いてすぐ移動しても残る'); await c.callbacks.onFlush();
    await c.callbacks.onPhoneAuto({ ok: true, state: f.store.state() });
    c.edit('再読み込み後の追記'); c.open('2'); c.open('1');
    assert.equal(c.text(), '再読み込み後の追記'); await c.callbacks.onFlush();
    assert.equal(f.store.state().notes.find(n => n.id === '1').body, '再読み込み後の追記');
    c.flags.fail = true; c.edit('失敗しても保持する'); await assert.rejects(c.callbacks.onFlush());
    c.open('2'); c.open('1'); assert.equal(c.text(), '失敗しても保持する');
    assert.match(c.w.document.querySelector('#save-status').textContent, /保存エラー/);
    c.flags.fail = false; await c.callbacks.onFlush();
    assert.equal(f.store.state().notes.find(n => n.id === '1').body, '失敗しても保持する');
    c.click('[data-act="tadd"]');
    const $ = s => c.w.document.querySelector(s);
    assert.equal($('#ta-create').hidden, true);
    assert.equal($('#ta-q').parentElement, $('#ta-new').parentElement); assert.ok(!$('.da-sep'));
    c.click('#ta-new'); assert.equal(c.w.document.activeElement.id, 'ta-name');
    c.click('#ta-create-ok'); assert.match($('#ta-create-error').textContent, /名前を入力/);
    $('#ta-name').value = '自分の索引'; c.click('#ta-create-ok'); await tick();
    assert.ok(f.store.state().topics.some(t => t.name === '自分の索引' && t.entry.id === '1'));
    await c.callbacks.onFlush(); assert.deepEqual(c.errors, []);
  } finally { c.close(); f.cleanup(); }
});

test('renderer: restart replays unsaved recovery copies before rendering the note', async () => {
  const f = fixture(); let c = await client(f.store);
  try {
    c.open('1'); c.flags.fail = true; c.edit('再起動しても日本語の下書きを保持');
    await assert.rejects(c.callbacks.onFlush());
    const savedStorage = c.storage(); c.close();
    assert.equal(openVault(f.dir).state().notes.find(n => n.id === '1').body, '最初の文章');
    c = await client(openVault(f.dir), savedStorage);
    assert.equal(c.text(), '再起動しても日本語の下書きを保持'); await c.callbacks.onFlush();
    assert.equal(openVault(f.dir).state().notes.find(n => n.id === '1').body, '再起動しても日本語の下書きを保持');
    assert.ok(!Object.keys(c.storage()).some(k => k.startsWith('pkm-recovery:')));
    assert.deepEqual(c.errors, []);
  } finally { c.close(); f.cleanup(); }
});

test('renderer: delayed pasted URL title cannot overwrite a reopened and edited note', async () => {
  const f = fixture(), c = await client(f.store);
  try {
    c.open('1');
    const paste = new c.w.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'https://example.com/article', files: [] } });
    c.w.__pkm.view.contentDOM.dispatchEvent(paste); assert.equal(typeof c.flags.resolveTitle, 'function');
    c.open('2'); c.open('1'); c.edit('URL取得待ちの間に書いた新しい文章');
    c.flags.resolveTitle('記事の題'); await tick(); await c.callbacks.onFlush();
    assert.equal(c.text(), 'URL取得待ちの間に書いた新しい文章');
    assert.equal(openVault(f.dir).state().notes.find(n => n.id === '1').body, c.text());
    assert.deepEqual(c.errors, []);
  } finally { c.close(); f.cleanup(); }
});

test('renderer: ID copies on click; changing and clearing require the note menu and explicit actions', async () => {
  const f = fixture(), c = await client(f.store);
  const $ = selector => c.w.document.querySelector(selector);
  const settings = () => {
    c.click('[data-act="nmenu"]');
    [...c.w.document.querySelectorAll('.popmenu>div')].find(b => b.textContent.includes('IDを変更・解除')).click();
  };
  try {
    c.open('1');
    assert.equal($('#f-id').tagName, 'BUTTON');
    assert.equal($('#f-id').textContent, '1');
    assert.equal($('.idline input'), null); assert.equal($('.cpid'), null);
    assert.equal($('.idline [data-act="clearid"]'), null);
    assert.equal($('.idline [data-act="giveid"]'), null);
    c.click('#f-id'); await tick(); assert.deepEqual(c.flags.clipboard, ['1']);
    assert.equal(f.store.state().notes.find(n => n.id === '1').body, '最初の文章');
    settings(); $('#id-next').value = ''; c.click('#id-apply');
    assert.match($('#id-error').textContent, /空欄ではIDは外れません/);
    assert.ok(f.store.state().notes.some(n => n.id === '1'));
    $('#id-next').value = '2'; c.click('#id-apply'); await tick();
    assert.match($('#id-error').textContent, /そのIDは使えません/);
    $('#id-next').value = '3'; c.click('#id-apply'); await tick();
    assert.equal($('#modal').style.display, 'none'); assert.equal($('#f-id').textContent, '3');
    settings(); c.w.confirm = () => false; c.click('#id-clear'); await tick();
    assert.ok(f.store.state().notes.some(n => n.id === '3')); assert.equal($('#modal').style.display, 'flex');
    c.w.confirm = () => true; c.click('#id-clear'); await tick();
    assert.equal($('#f-id').textContent, 'IDなし'); assert.ok($('.idline [data-act="giveid"]'));
    assert.equal(f.store.state().notes.find(n => n.noid).body, '最初の文章');
    assert.deepEqual(c.errors, []);
  } finally { c.close(); f.cleanup(); }
});

test('renderer: bulk selection buttons copy, cancel, wrap and exclude topic rows; Esc exits without clearing search', async () => {
  const f = fixture(); f.store.saveTopic({ name: '索引', entry: { s: 'd', id: '1' }, text: '項目 1 2' });
  const c = await client(f.store), $ = selector => c.w.document.querySelector(selector);
  const startSel = () => { const row = $('#list .note[data-id]'); row.dispatchEvent(new c.w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })); [...c.w.document.querySelectorAll('.popmenu div')].find(d => d.textContent.includes('複数選択')).click(); };   // 複数選択は、ノートの右クリックで始める
  const escape = target => target.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  try {
    c.open('1'); startSel();
    assert.match($('.sel-head').textContent, /1件/);
    c.click('#list .topicrow'); assert.match($('.sel-head').textContent, /1件/);   // 索引の行は選べない
    c.click('#sel-all'); assert.equal(c.w.document.querySelectorAll('#list .ck:checked').length, 2);
    assert.match($('.sel-head').textContent, /2件/);
    assert.equal(c.w.getComputedStyle($('.sel-actions')).flexWrap, 'wrap');
    assert.equal(c.w.getComputedStyle($('#selbar')).flexDirection, 'column');
    c.click('#sel-copy'); await tick();
    assert.match(c.flags.clipboard.at(-1), /最初の文章/); assert.match(c.flags.clipboard.at(-1), /別のノート/);
    c.click('#sel-end small'); assert.equal($('#selbar').style.display, 'none'); assert.equal($('#list .ck'), null);
    startSel(); c.click('#sel-all'); c.click('#sel-exp');
    assert.equal($('#modal').style.display, 'flex');
    escape($('#modal')); assert.equal($('#modal').style.display, 'none'); assert.ok($('#sel-end'));
    $('#q').value = '残す検索語'; escape($('#q'));
    assert.equal($('#selbar').style.display, 'none'); assert.equal($('#q').value, '残す検索語');
    $('#q').value = ''; $('#q').dispatchEvent(new c.w.Event('input', { bubbles: true }));
    startSel(); c.open('1');
    c.w.document.body.dispatchEvent(new c.w.KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }));
    assert.ok($('#sel-end')); escape(c.w.document.body); assert.equal($('#selbar').style.display, 'none');
    await c.callbacks.onFlush(); assert.deepEqual(c.errors, []);
  } finally { c.close(); f.cleanup(); }
});

test('renderer: multi-target link creates an ordinary editable note with live prose expansion and persistent display settings', async () => {
  const f=fixture();let c=await client(f.store);const menu=label=>{c.click('[data-act="nmenu"]');[...c.w.document.querySelectorAll('.popmenu>div')].find(x=>x.textContent.includes(label)).click();};
  try{
    c.open('1');menu('リンクを作成');
    c.w.document.querySelector('#ln-title').value='集めた知識';
    c.w.document.querySelector('#ln-query').value='別のノート';c.w.document.querySelector('#ln-query').dispatchEvent(new c.w.Event('input',{bubbles:true}));
    c.click('[data-ln-add="0"]');assert.match(c.w.document.querySelector('#ln-count').textContent,/2件/);
    assert.ok(!f.store.state().docs.K_links);
    c.click('#ln-save');await tick();
    const bundle=f.store.state().docs.K_links.items[0];assert.equal(bundle.title,'集めた知識');assert.equal(bundle.targets.length,2);assert.equal(bundle.manual,undefined);
    c.click('#ln-note');await tick();const created=f.store.state().notes.find(n=>n.title==='集めた知識');assert.equal(created.kind,'text');assert.match(created.body,/!\[集めた知識\]\(link:/);
    assert.match(c.w.document.querySelector('#pane .linked-prose').textContent,/最初の文章/);assert.match(c.w.document.querySelector('#pane .linked-prose').textContent,/別のノート/);
    assert.equal(c.w.document.querySelector('#pane .linked-expansion .bub'),null);
    c.click('#pane .linked-fold');await c.callbacks.onFlush();assert.equal(c.w.document.querySelector('#pane .linked-prose').hidden,true,JSON.stringify({display:f.store.state().docs.K_display,errors:c.errors,html:c.w.document.querySelector('#pane .linked-expansion').outerHTML.slice(0,1000)}));
    const saved=c.storage();c.close();c=await client(openVault(f.dir),saved);
    assert.equal(c.w.document.querySelector('#pane .linked-prose').hidden,true);c.click('#pane .linked-fold');await c.callbacks.onFlush();
    c.click('#tabs [data-tab="d"]');c.open('1');c.edit('原文を編集した最新の内容');await c.callbacks.onFlush();
    c.click('#tabs [data-tab="u"]');c.open(created.id);
    assert.match(c.w.document.querySelector('#pane .linked-prose').textContent,/最新の内容/);assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});

test('renderer: circular expansion stops',async()=>{
  const f=fixture();f.store.saveNote({s:'d',id:'1',body:'![循環](link:loop)'});const one=f.store.state().notes.find(n=>n.id==='1');
  f.store.saveDoc('K_links',{items:[{id:'loop',title:'循環',targets:[{kind:'note',s:'d',stem:one.stem,id:'1'},{kind:'memo',id:'m1'}],order:'newest'}]});
  f.store.saveNote({s:'d',id:'2',body:'![参照](link:loop)'});const c=await client(f.store);
  try{
    c.open('2');await tick();assert.match(c.w.document.querySelector('#pane .linked-prose').textContent,/循環参照/);assert.ok(c.w.document.querySelectorAll('#pane .linked-expansion').length<6);
    await c.callbacks.onFlush();assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});

test('renderer: standalone URL previews hydrate controls, keep inline URLs as text and preserve Markdown when hidden',async()=>{
  const f=fixture(),url='https://example.com/article';f.store.saveDoc('K_urlCache',{items:{[url]:{title:'取得した題',description:'説明',domain:'example.com'}}});
  const c=await client(f.store);
  try{
    c.open('1');c.edit(url);await tick();const original=c.text();assert.match(c.w.document.querySelector('#pane .url-preview').textContent,/取得した題/);
    c.click('#pane .url-menu');[...c.w.document.querySelectorAll('.popmenu>div')].find(x=>x.textContent.includes('非表示')).click();
    assert.equal(c.text(),original);assert.ok(c.w.document.querySelector('#pane .url-preview-off'));await c.callbacks.onFlush();
    c.edit('文章中の '+url+' はテキスト');await tick();assert.equal(c.w.document.querySelector('#pane .url-preview'),null);
    await c.callbacks.onFlush();assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});

test('renderer: range adjustment and explicit manual order preserve the immutable link ID and existing display modes',async()=>{
  const f=fixture(),all=f.store.state().notes;
  f.store.saveDoc('K_links',{items:[{id:'bundle',title:'順序と範囲',targets:all.map(n=>({kind:'note',stem:n.stem,id:n.id,s:n.s})),order:'newest'}]});
  f.store.saveNote({s:'d',id:'3',body:'![順序と範囲](link:bundle)'});const c=await client(f.store),$=s=>c.w.document.querySelector(s);
  try{
    c.open('3');c.click('#pane .linked-title');c.click('#ln-edit');
    const order=$('#ln-order');order.value='manual';order.dispatchEvent(new c.w.Event('change',{bubbles:true}));assert.equal(f.store.state().docs.K_links.items[0].manual,undefined);
    c.click('[data-ln-move="0"][data-delta="1"]');c.click('[data-ln-range="0"]');
    const input=$('#ln-range-text');input.setSelectionRange(0,2);c.click('#ln-range-ok');
    $('#ln-title').value='名前を変更';c.click('#ln-save');await tick();
    const link=f.store.state().docs.K_links.items[0];assert.equal(link.id,'bundle');assert.equal(link.manual.length,2);assert.equal(link.order,'manual');assert.ok(link.targets.some(t=>t.range?.quote.length===2));
    c.click('#ln-close');c.open('3');const picker=$('#pane .linked-order');picker.value='oldest';picker.dispatchEvent(new c.w.Event('change',{bubbles:true}));await c.callbacks.onFlush();
    assert.equal(f.store.state().docs.K_links.items[0].order,'manual');assert.deepEqual(f.store.state().docs.K_links.items[0].manual,link.manual);
    c.click('#pane .linked-title');c.click('#ln-uses .link-backlink');assert.equal($('#modal').style.display,'none');assert.ok(c.w.__pkm.view.state.selection.main.to>0);
    assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});

test('renderer: URL preview controls are isolated per occurrence and survive restart',async()=>{
  const f=fixture(),url='https://example.com/article';f.store.saveNote({s:'d',id:'1',body:url+'\n\n'+url});f.store.saveDoc('K_urlCache',{items:{[url]:{title:'既存URLの題'}}});let c=await client(f.store);
  try{
    c.open('1');assert.equal(c.w.document.querySelectorAll('#pane .url-preview').length,2);c.click('#pane .url-menu');[...c.w.document.querySelectorAll('.popmenu>div')].find(b=>b.textContent.includes('非表示')).click();await c.callbacks.onFlush();await tick();
    assert.equal(c.w.document.querySelectorAll('#pane .url-preview-off').length,1);const storage=c.storage();c.close();c=await client(openVault(f.dir),storage);
    assert.equal(c.w.document.querySelectorAll('#pane .url-preview-off').length,1);assert.equal(c.text(),url+'\n\n'+url);assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});

test('renderer: prose can surround internal embeds; inline code and ordinary images do not become source expansions',async()=>{
  const f=fixture(),one=f.store.state().notes.find(n=>n.id==='1');
  f.store.saveDoc('K_links',{items:[{id:'inline',title:'文章中の参照',targets:[{kind:'note',s:'d',id:'1',stem:one.stem}],order:'newest'}]});
  f.store.saveNote({s:'d',id:'2',body:'前の文章 ![参照](link:inline) 後の文章\n`![コード](link:inline)`\n![画像](photo.jpg)'});
  const c=await client(f.store);
  try{
    c.open('2');await tick();assert.equal(c.w.document.querySelectorAll('#pane .linked-expansion').length,1);
    assert.match(c.w.document.querySelector('#pane .linked-prose').textContent,/最初の文章/);
    assert.match(c.text(),/前の文章.*後の文章/);await c.callbacks.onFlush();assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});


test('renderer: 旧なりきり・キャンバス・メモのノートは、落ちずに読み取り専用で開く',async()=>{
  const f=fixture();
  for(const [kind,id] of [['rp','7a'],['canvas','7b'],['memo-group','7c']]) f.store.createNote({kind,id,title:'旧'+kind,created:'2026-01-01 00:00',data:{title:'旧'+kind,memoIds:[]}});
  const c=await client(f.store);
  try{
    for(const id of ['7a','7b','7c']){c.open(id);await tick();assert.ok(c.w.document.querySelector('#pane .legacy-body'),id);}
    await c.callbacks.onFlush();assert.deepEqual(c.errors,[]);
  }finally{c.close();f.cleanup();}
});
