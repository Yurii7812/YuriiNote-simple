'use strict';

(() => {
  const P = window.PKM;
  const api = window.bridge;
  const $ = id => document.getElementById(id);
  const text = (tag, className, value) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (value !== undefined) el.textContent = value;
    return el;
  };
  const button = (label, className, fn) => {
    const el = text('button', className, label);
    el.type = 'button';
    el.addEventListener('click', fn);
    return el;
  };
  let data = { version: 1, notes: [], topics: [], settings: { allowMultipleTopics: false } };
  let view = 'notes';
  let selectedUid = null;
  let selectedIndex = 'global';
  let activePage = 1;
  let query = '';
  let timer = null;
  let queue = Promise.resolve();
  let loadFailed = false;

  function ids() { return data.notes.map(n => n.id).filter(Boolean); }
  function noteByUid(uid) { return data.notes.find(n => n.uid === uid); }
  function noteById(id) { return data.notes.find(n => n.id === id); }
  function topicById(id) { return data.topics.find(t => t.id === id); }
  function currentNote() { return noteByUid(selectedUid); }
  function shortTitle(n) { return n.title.trim() || n.body.trim().split('\n')[0]?.slice(0, 46) || '無題のノート'; }
  function ownerTitle(t) { return noteById(t.ownerId)?.title || ''; }
  function uid() { return 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  function now() { return new Date().toISOString(); }
  function status(message, error = false) {
    $('saveStatus').textContent = message;
    $('saveStatus').style.color = error ? '#ad4c45' : '';
  }
  async function save() {
    if (loadFailed) return false;
    if (timer) { clearTimeout(timer); timer = null; }
    status('保存中…');
    const snapshot = JSON.parse(JSON.stringify(data));
    queue = queue.catch(() => {}).then(() => api.save(snapshot));
    try { await queue; status('保存済み'); return true; }
    catch (err) { status('保存エラー', true); console.error('Save failed', err); return false; }
  }
  function dirty() {
    if (loadFailed) return;
    status('未保存');
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 350);
  }
  function activate(which) {
    view = which;
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === which));
    $('workspaceLabel').textContent = which === 'notes' ? 'ノート' : 'Index';
    render();
  }
  function openNote(uidValue) {
    if (!noteByUid(uidValue)) return;
    selectedUid = uidValue;
    activate('notes');
  }
  function openIndex(id = 'global', page = 1) {
    selectedIndex = id; activePage = page;
    activate('index');
  }
  function go(raw) {
    const item = typeof raw === 'string' ? P.parseRef(raw) : raw;
    if (!item) return false;
    if (item.kind === 'zero') { openIndex('zero'); return true; }
    if (item.kind === 'topic') {
      const t = topicById(item.id);
      if (!t || item.page < 1 || item.page > t.pages.length) return false;
      openIndex(t.id, item.page);
      return true;
    }
    const n = noteById(item.id);
    if (!n) return false;
    openNote(n.uid);
    if (item.anchor) {
      const editor = $('noteBody');
      if (editor) {
        const where = editor.value.indexOf('(' + item.anchor + ')');
        if (where >= 0) {
          editor.focus();
          editor.setSelectionRange(where, where + String(item.anchor).length + 2);
        }
      }
    }
    return true;
  }
  function jump() {
    const raw = $('jumpInput').value.trim();
    if (!raw) return;
    if (raw.toLowerCase() === 'index') { openIndex('global'); return; }
    if (!go(raw)) alert('参照先が見つかりません: ' + raw);
    else $('jumpInput').value = '';
  }
  function newNote(id = '') {
    const t = now();
    const n = { uid: uid(), id, title: '', body: '', keywords: [], createdAt: t, updatedAt: t };
    data.notes.push(n);
    selectedUid = n.uid;
    dirty();
    activate('notes');
    const editor = $('noteTitle');
    if (editor) editor.focus();
  }
  function setId(n) {
    const proposed = window.prompt('ノートのID', n.id || P.nextRoot(ids()));
    if (proposed === null) return;
    const id = proposed.trim();
    if (!P.validNote(id)) { alert('IDの形式を確認してください（例 1、1a、1a1）。'); return; }
    if (noteById(id) && noteById(id).uid !== n.uid) { alert('そのIDは使用されています。'); return; }
    if (n.id && n.id !== id && data.topics.some(t => t.ownerId === n.id)) {
      alert('Topic IndexがあるIDは変更できません。先に対応するTopic Indexを削除してください。');
      return;
    }
    if (n.id && n.id !== id && !window.confirm('IDを変更すると、以前の参照は自動的には書き換えられません。続けますか？')) return;
    n.id = id; n.updatedAt = now();
    dirty(); render();
  }
  function childNote(n, sibling = false) {
    if (!n.id) { alert('分岐・並列の前にIDを付けてください。'); return; }
    const id = sibling ? P.unusedSibling(n.id, ids()) : P.unusedChild(n.id, ids());
    newNote(id);
  }
  function deleteNote(n) {
    if (!window.confirm('このノートを削除しますか？')) return;
    data.notes = data.notes.filter(x => x.uid !== n.uid);
    data.topics = data.topics.filter(t => t.ownerId !== n.id);
    selectedUid = data.notes[0]?.uid || null;
    dirty(); render();
  }
  function createTopic(n) {
    if (!n.id) { alert('まずノートにIDを付けてください。'); return; }
    let id;
    try { id = P.nextTopicId(n.id, data.topics.map(t => t.id), data.settings.allowMultipleTopics); }
    catch (error) {
      const existing = data.topics.find(t => t.ownerId === n.id);
      if (existing) openIndex(existing.id);
      return;
    }
    const title = window.prompt('Topic Indexの名前（思考の出発点）', n.title || '');
    if (title === null) return;
    data.topics.push({ id, ownerId: n.id, title: title.trim(), pages: [''] });
    dirty(); openIndex(id);
  }
  function deleteTopic(t) {
    if (!window.confirm(t.id + ' を削除しますか？ ノート本文は削除されません。')) return;
    data.topics = data.topics.filter(x => x.id !== t.id);
    selectedIndex = 'global';
    dirty(); openIndex('global');
  }
  function referenced(body) {
    const seen = new Set(), refs = [];
    for (const r of P.findRefs(body)) {
      const exists = r.kind === 'note' ? !!noteById(r.id) :
        r.kind === 'topic' ? !!topicById(r.id) && r.page >= 1 && r.page <= topicById(r.id).pages.length : false;
      if (!exists || seen.has(r.label)) continue;
      seen.add(r.label); refs.push(r);
    }
    return refs;
  }
  function refsInto(target, content) {
    target.replaceChildren();
    const refs = referenced(content);
    if (!refs.length) return;
    const title = text('div', 'soft-label', '本文中の参照（クリックして開く）');
    const row = text('div', 'reference-list');
    for (const r of refs) row.append(button(r.label, 'ref-chip', () => go(r)));
    target.append(title, row);
  }
  function sidebarEntry(label, hint, selected, click, id = '') {
    const entry = button('', 'list-item' + (selected ? ' selected' : ''), click);
    const top = text('span', 'list-title');
    if (id) top.append(text('span', 'list-id', id + '  '));
    top.append(document.createTextNode(label));
    entry.append(top);
    if (hint) entry.append(text('span', 'list-meta', hint));
    return entry;
  }
  function renderSidebar() {
    const list = $('sidebarList');
    list.replaceChildren();
    const q = query.trim().toLocaleLowerCase();
    if (view === 'notes') {
      const notes = data.notes.filter(n => !q ||
        (n.id + ' ' + n.title + ' ' + n.body + ' ' + n.keywords.join(' ')).toLocaleLowerCase().includes(q))
        .sort((a, b) => !a.id && b.id ? -1 : a.id && !b.id ? 1 : P.compareNotes(a.id || '1', b.id || '1'));
      list.append(text('div', 'list-heading', q ? '検索結果 ' + notes.length : 'ノート ' + notes.length));
      for (const n of notes) {
        const entry = sidebarEntry(shortTitle(n), n.id ? '' : 'ID未設定',
          n.uid === selectedUid, () => openNote(n.uid), n.id);
        entry.style.paddingLeft = (13 + Math.min(6, P.depth(n.id)) * 9) + 'px';
        list.append(entry);
      }
      if (!notes.length) list.append(text('p', 'small-note sidebar-empty', q ? '一致するノートはありません。' : 'まだノートはありません。'));
      return;
    }
    list.append(text('div', 'list-heading', 'Index'));
    const special = [
      ['global', 'Global Index', 'キーワードで探す'],
      ['zero', '0 Index', '親IDのTopic Indexを見る']
    ];
    for (const [key, name, subtitle] of special) {
      if (q && !(name + subtitle).toLocaleLowerCase().includes(q)) continue;
      list.append(sidebarEntry(name, subtitle, selectedIndex === key, () => openIndex(key)));
    }
    list.append(text('div', 'list-heading', 'Topic Index'));
    for (const t of [...data.topics].sort((a, b) => P.compareNotes(a.ownerId, b.ownerId) || Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)))) {
      if (q && !(t.id + ' ' + t.title + ' ' + t.pages.join(' ')).toLocaleLowerCase().includes(q)) continue;
      list.append(sidebarEntry(t.title || ownerTitle(t) || '無題の索引',
        t.pages.length > 1 ? t.pages.length + 'ページ' : '',
        selectedIndex === t.id, () => openIndex(t.id), t.id));
    }
  }
  function newHeading(title, hint = '') {
    const block = text('div', 'eyebrow');
    block.append(text('span', 'code-id', title));
    if (hint) block.append(text('span', '', hint));
    return block;
  }
  function renderNote() {
    const target = $('content'); target.replaceChildren();
    const n = currentNote();
    if (!n) {
      const empty = text('div', 'empty-state');
      empty.append(text('h2', '', 'まず、書く。'),
        text('p', '', '何について書くか、どんな索引に分類するかは、最初から決めなくて構いません。ノートが増えてから必要な索引を作れます。'),
        button('＋ 最初のノートを書く', 'primary', () => newNote()));
      target.append(empty); return;
    }
    target.append(newHeading(n.id ? 'NOTE   ' + n.id : 'NOTE   ID未設定', ''));
    const title = text('input', 'title-input');
    title.id = 'noteTitle'; title.placeholder = 'タイトル（任意）';
    title.value = n.title; title.autocomplete = 'off';
    title.addEventListener('input', () => { n.title = title.value; n.updatedAt = now(); dirty(); renderSidebar(); });
    target.append(title);
    const meta = text('div', 'meta-line', n.id ?
      '書きながら考えを広げる。必要ならあとから索引を作る。' :
      'IDはあとから付けられます。');
    target.append(meta);
    const editor = text('textarea', 'body-editor note-body');
    editor.id = 'noteBody'; editor.spellcheck = false;
    editor.placeholder = 'ここから考えを書き始める…';
    editor.value = n.body;
    const refBox = text('div', 'references');
    editor.addEventListener('input', () => { n.body = editor.value; n.updatedAt = now(); dirty(); refsInto(refBox, n.body); renderSidebar(); });
    target.append(editor, refBox);
    refsInto(refBox, n.body);
    const kwLabel = text('label', 'soft-label', 'キーワード（Global Index用・任意）');
    kwLabel.htmlFor = 'noteKeywords';
    const keywords = text('input', 'note-keywords'); keywords.id = 'noteKeywords';
    keywords.placeholder = '例：仏教、読書、無我（カンマで区切る）';
    keywords.value = n.keywords.join('、');
    keywords.addEventListener('input', () => { n.keywords = P.keywordList(keywords.value); n.updatedAt = now(); dirty(); renderSidebar(); });
    target.append(kwLabel, keywords);
    const tools = text('div', 'toolbar');
    tools.append(
      button(n.id ? 'IDを変更' : 'IDを付ける', 'quiet', () => setId(n)),
      button('分岐', 'quiet', () => childNote(n, false)),
      button('並列', 'quiet', () => childNote(n, true))
    );
    const myTopics = data.topics.filter(t => t.ownerId === n.id);
    if (myTopics.length) {
      for (const t of myTopics) tools.append(button('索引 ' + t.id, 'quiet', () => openIndex(t.id)));
    }
    if (!myTopics.length || data.settings.allowMultipleTopics) {
      tools.append(button('＋ Topic Index', 'quiet', () => createTopic(n)));
    }
    tools.append(text('span', 'space'));
    tools.append(button('削除', 'quiet danger', () => deleteNote(n)));
    target.append(tools);
    const hint = text('p', 'small-note', '本Aの読書ノートと本Bの読書ノートは、別の親IDから始めても構いません。分岐やまとめが途中で途切れても問題ありません。');
    target.append(hint);
  }
  function addSettings(target) {
    const details = text('details', 'simple-settings');
    const summary = text('summary', '', '設定');
    const line = text('label', 'setting-line');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
    checkbox.checked = !!data.settings.allowMultipleTopics;
    checkbox.addEventListener('change', () => {
      data.settings.allowMultipleTopics = checkbox.checked;
      dirty();
      renderSidebar();
    });
    line.append(checkbox, document.createTextNode('同じIDに複数のTopic Indexを作れるようにする'));
    details.append(summary, line, text('p', 'small-note', '初期設定はオフです。オフに戻しても、すでに作成した索引は削除されません。オンにすると 1-1 に加えて 1-2、1-3…を追加できます。'));
    target.append(details);
  }
  function renderGlobal() {
    const target = $('content');
    target.replaceChildren(newHeading('GLOBAL INDEX'));
    target.append(text('h1', 'section-heading', 'Global Index'),
      text('p', 'small-note', 'キーワードからノートやTopic Indexへ。ノートのタイトルとキーワードを自動的に集めます。'));
    const entries = P.globalEntries(data);
    const list = text('div', 'global-list');
    for (const entry of entries) {
      const row = text('div', 'entry-row'), links = text('div', 'entry-links');
      row.append(text('strong', '', entry.keyword));
      for (const item of entry.items) links.append(button(item.id, '', () => go(item)));
      row.append(links);
      list.append(row);
    }
    if (!entries.length) list.append(text('p', 'small-note', 'ノートにタイトルやキーワードを書くと、ここから探せます。'));
    target.append(list); addSettings(target);
  }
  function renderZero() {
    const target = $('content');
    target.replaceChildren(newHeading('0 INDEX'));
    target.append(text('h1', 'section-heading', '0 Index'),
      text('p', 'small-note', '親IDごとに作られたTopic Indexへの入口です。必要な索引を作った後で、ここに自動的に現れます。'));
    const group = [...data.topics].filter(t => /^\d+$/.test(t.ownerId))
      .sort((a, b) => P.compareNotes(a.ownerId, b.ownerId) || Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)));
    const list = text('div', 'zero-list');
    for (const t of group) {
      const row = text('div', 'entry-row');
      const heading = text('div'); heading.append(text('strong', '', t.title || ownerTitle(t) || '無題の索引'));
      heading.append(text('div', 'hint', '出発点  ' + t.ownerId));
      row.append(heading, button(t.id, '', () => openIndex(t.id)));
      list.append(row);
    }
    if (!group.length) list.append(text('p', 'small-note', '親ID（1、2…）のTopic Indexができたときに表示されます。'));
    target.append(list); addSettings(target);
  }
  function renderTopic(t) {
    const target = $('content');
    target.replaceChildren();
    activePage = Math.min(Math.max(activePage, 1), t.pages.length);
    const top = newHeading(t.id, activePage > 1 ? String(activePage) : '');
    target.append(top);
    const title = text('input', 'title-input');
    title.placeholder = '出発点の名前（任意）'; title.value = t.title;
    title.addEventListener('input', () => { t.title = title.value; dirty(); renderSidebar(); });
    target.append(title, text('p', 'small-note', '名前は分類の境界ではなく、思考の出発点。キーワードと参照IDを自由に並べます。'));
    const pageNav = text('div', 'page-switch');
    for (let i = 1; i <= t.pages.length; i++) {
      pageNav.append(button(String(i), 'page-number' + (i === activePage ? ' active' : ''), () => openIndex(t.id, i)));
    }
    pageNav.append(button('＋ ページ', 'quiet', () => {
      t.pages.push('');
      dirty(); openIndex(t.id, t.pages.length);
    }));
    target.append(pageNav);
    const label = text('label', 'soft-label', 'ページ ' + activePage + (activePage === 1 ? '' : '  —  引用: ' + t.id + '(' + activePage + ')'));
    label.htmlFor = 'topicBody'; target.append(label);
    const editor = text('textarea', 'body-editor note-body');
    editor.id = 'topicBody'; editor.value = t.pages[activePage - 1];
    editor.spellcheck = false;
    editor.placeholder = '例：\n価値観 1a\n現状のまとめ 1f\n★関連する索引 1a-1';
    const references = text('div', 'references');
    editor.addEventListener('input', () => {
      t.pages[activePage - 1] = editor.value; dirty(); refsInto(references, editor.value); renderSidebar();
    });
    target.append(editor, references);
    refsInto(references, editor.value);
    const tools = text('div', 'toolbar');
    tools.append(button('元ノート ' + t.ownerId, 'quiet', () => go(t.ownerId)));
    if (t.pages.length > 1) tools.append(button('このページを削除', 'quiet danger', () => {
      if (!window.confirm('このページを削除しますか？')) return;
      t.pages.splice(activePage - 1, 1); activePage = Math.max(1, activePage - 1);
      dirty(); render();
    }));
    tools.append(text('span', 'space'));
    tools.append(button('索引を削除', 'quiet danger', () => deleteTopic(t)));
    target.append(tools, text('p', 'small-note', '2ページ目の表記は、左上に「' + t.id + ' ' + (t.title || 'タイトル') + '」、右上に「2」。ページを参照するときは ' + t.id + '(2)。'));
    addSettings(target);
  }
  function renderIndex() {
    if (selectedIndex === 'global') renderGlobal();
    else if (selectedIndex === 'zero') renderZero();
    else {
      const topic = topicById(selectedIndex);
      if (topic) renderTopic(topic);
      else { selectedIndex = 'global'; renderGlobal(); }
    }
  }
  function render() {
    renderSidebar();
    if (view === 'notes') renderNote();
    else renderIndex();
  }
  async function initialize() {
    $('newNote').addEventListener('click', () => newNote());
    $('search').addEventListener('input', event => { query = event.target.value; renderSidebar(); });
    $('jumpButton').addEventListener('click', jump);
    $('jumpInput').addEventListener('keydown', event => { if (event.key === 'Enter') jump(); });
    $('openFolder').addEventListener('click', async () => {
      const error = await api.openFolder();
      if (error) alert('保存先を開けませんでした: ' + error);
    });
    document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => activate(el.dataset.view)));
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); newNote();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void save();
      }
    });
    api.onCloseRequest(async () => api.closeReady(await save()));
    try {
      data = P.normalize(await api.load());
      selectedUid = data.notes[0]?.uid || null;
      render(); status('保存済み');
    } catch (error) {
      loadFailed = true;
      status('読み込みエラー', true);
      const target = $('content'); target.replaceChildren();
      const box = text('div', 'empty-state');
      box.append(text('h2', '', '保存データを読み込めませんでした'),
        text('p', '', '既存データを保護するため、保存を停止しています。「保存先を開く」でデータファイルを確認してください。'));
      target.append(box);
      console.error(error);
    }
  }
  void initialize();
})();
