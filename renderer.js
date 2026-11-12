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
  let data = P.normalize({});
  let view = 'index';
  let selectedUid = null;
  let selectedTopic = null;
  let activePage = 1;
  let query = '';
  let timer = null;
  let queue = Promise.resolve();
  let revision = 0;
  let loadFailed = false;

  const ids = () => data.notes.map(n => n.id).filter(Boolean);
  const noteByUid = uid => data.notes.find(n => n.uid === uid);
  const noteById = id => data.notes.find(n => n.id === id);
  const topicById = id => data.topics.find(t => t.id === id);
  const topicsFor = id => id ? data.topics.filter(t => t.ownerId === id) : [];
  const shortTitle = n => n.title.trim() || n.body.trim().split('\n')[0]?.slice(0, 60) || '無題のノート';
  const now = () => new Date().toISOString();
  const matches = value => !query.trim() || String(value).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const noteMatches = n => matches([n.id, n.title, n.body, ...n.keywords].join(' '));
  const topicMatches = t => matches([t.id, t.title, ...t.pages].join(' '));
  const sortedNotes = () => [...data.notes].sort((a, b) => !a.id && b.id ? -1 : a.id && !b.id ? 1 : P.compareNotes(a.id, b.id));
  const sortedTopics = () => [...data.topics].sort((a, b) => P.compareNotes(a.ownerId, b.ownerId) || Number(a.id.split('-').at(-1)) - Number(b.id.split('-').at(-1)));

  function status(message, error = false) {
    $('saveStatus').textContent = message;
    $('saveStatus').style.color = error ? '#a84439' : '';
  }
  async function save() {
    if (loadFailed) return false;
    clearTimeout(timer); timer = null;
    const savingRevision = revision;
    status('保存中…');
    const snapshot = JSON.parse(JSON.stringify(data));
    const pending = queue.catch(() => {}).then(() => api.save(snapshot));
    queue = pending;
    try {
      await pending;
      if (revision === savingRevision && queue === pending) status('保存済み');
      return true;
    } catch (err) {
      status('保存エラー', true); console.error('Save failed', err); return false;
    }
  }
  function dirty() {
    if (loadFailed) return;
    revision++;
    status('未保存');
    clearTimeout(timer);
    timer = setTimeout(() => { void save(); }, 350);
  }
  // Electron does not support window.prompt. A small native HTML dialog works in both environments.
  function ask(title, { value = '', label = '', message = '', confirm = false, submit = '決定' } = {}) {
    return new Promise(resolve => {
      const dialog = $('entryDialog'), input = $('dialogInput');
      $('dialogTitle').textContent = title;
      $('dialogMessage').textContent = message;
      $('dialogMessage').hidden = !message;
      $('dialogLabel').textContent = label || title;
      $('dialogLabel').hidden = confirm;
      input.hidden = confirm; input.value = value;
      $('dialogSubmit').textContent = submit;
      dialog.setAttribute('aria-labelledby', 'dialogTitle');
      let result = null;
      const onSubmit = event => { event.preventDefault(); result = confirm ? true : input.value; dialog.close(); };
      const onCancel = () => dialog.close();
      $('entryForm').addEventListener('submit', onSubmit);
      $('dialogCancel').addEventListener('click', onCancel);
      dialog.addEventListener('close', () => {
        $('entryForm').removeEventListener('submit', onSubmit);
        $('dialogCancel').removeEventListener('click', onCancel);
        resolve(result);
      }, { once: true });
      dialog.showModal();
      if (!confirm) { input.focus(); input.select(); }
      else $('dialogCancel').focus();
    });
  }
  const inform = message => ask('確認', { confirm: true, message, submit: '閉じる' });
  function activate(which) { view = which; render(); }
  function openNote(uid) {
    if (!noteByUid(uid)) return;
    selectedUid = uid; selectedTopic = null; activate('notes');
    window.scrollTo(0, 0);
  }
  function openTopic(id, page = 1) {
    if (!topicById(id)) return;
    selectedTopic = id; activePage = page; activate('notes');
    window.scrollTo(0, 0);
  }
  function go(raw) {
    const item = typeof raw === 'string' ? P.parseRef(raw) : raw;
    if (!item) return false;
    if (item.kind === 'zero') { query = ''; $('search').value = ''; $('indexKind').value = 'zero'; activate('index'); return true; }
    if (item.kind === 'topic') {
      const t = topicById(item.id);
      if (!t || item.page < 1 || item.page > t.pages.length) return false;
      openTopic(t.id, item.page); return true;
    }
    const n = noteById(item.id);
    if (!n) return false;
    openNote(n.uid);
    if (item.anchor) {
      const editor = $('noteBody');
      const where = editor.value.indexOf('(' + item.anchor + ')');
      if (where >= 0) { editor.focus(); editor.setSelectionRange(where, where + String(item.anchor).length + 2); }
    }
    return true;
  }
  function newNote(id = '') {
    if (loadFailed) return;
    const t = now();
    const n = { uid: crypto.randomUUID(), id, title: '', body: '', keywords: [], createdAt: t, updatedAt: t };
    data.notes.push(n); dirty(); openNote(n.uid); $('noteBody').focus();
  }
  async function setId(n) {
    const proposed = await ask('ノートのID', { value: n.id || P.nextRoot(ids()), label: '例：1、1a、1a1' });
    if (proposed === null) return;
    const id = proposed.trim();
    if (!P.validNote(id)) { await inform('IDの形式を確認してください（例：1、1a、1a1）。'); return; }
    if (noteById(id) && noteById(id).uid !== n.uid) { await inform('そのIDは使用されています。'); return; }
    if (n.id === id) return;
    if (topicsFor(n.id).length) { await inform('Topic IndexがあるIDは変更できません。先に対応するTopic Indexを削除してください。'); return; }
    if (n.id && !await ask('IDを変更', { confirm: true, message: '以前のIDへの参照は自動的には書き換えられません。変更しますか？', submit: '変更' })) return;
    n.id = id; n.updatedAt = now(); dirty(); render();
  }
  async function deleteNote(n) {
    const count = topicsFor(n.id).length;
    const message = count ? 'このノートと、対応するTopic Index ' + count + '件を削除します。ほかのノートは残ります。' : 'このノートを削除します。';
    if (!await ask('ノートを削除', { confirm: true, message, submit: '削除' })) return;
    data.notes = data.notes.filter(x => x.uid !== n.uid);
    data.topics = data.topics.filter(t => t.ownerId !== n.id);
    selectedUid = null; dirty(); activate('index');
  }
  async function createTopic(n) {
    let id;
    try { id = P.nextTopicId(n.id, data.topics.map(t => t.id), data.settings.allowMultipleTopics); }
    catch (error) { await inform(error.message); return; }
    const title = await ask('Topic Indexを作成', { label: id + ' の名前（任意）', value: n.title });
    if (title === null) return;
    data.topics.push({ id, ownerId: n.id, title: title.trim(), pages: [''] });
    dirty(); openTopic(id); $('topicBody').focus();
  }
  async function deleteTopic(t) {
    if (!await ask('Topic Indexを削除', { confirm: true, message: t.id + ' の全ページを削除します。ノート本文は残ります。', submit: '削除' })) return;
    data.topics = data.topics.filter(x => x.id !== t.id);
    selectedTopic = null; dirty(); activate('index');
  }
  function idLabel(id, className = 'list-id') {
    const label = text('span', className, id || '未設定');
    if (topicsFor(id).length) { label.classList.add('has-topic'); label.title = 'Topic Indexあり'; }
    return label;
  }
  function refsInto(target, body) {
    target.replaceChildren();
    const refs = P.findRefs(body).filter(r => r.kind === 'note' ? noteById(r.id) : r.kind === 'topic' && topicById(r.id)?.pages[r.page - 1] !== undefined);
    if (!refs.length) return;
    const row = text('div', 'reference-list');
    for (const ref of refs) row.append(button(ref.label, '', () => go(ref)));
    target.append(text('div', 'soft-label', '参照'), row);
  }
  function renderIndex() {
    const target = $('content'); target.replaceChildren();
    const kind = $('indexKind').value;
    if (kind === 'global') {
      const entries = P.globalEntries(data).filter(entry => matches(entry.keyword) || entry.items.some(item =>
        item.kind === 'note' ? noteMatches(noteById(item.id)) : topicMatches(topicById(item.id))));
      for (const entry of entries) {
        const row = text('div', 'entry-row'), links = text('div', 'entry-links');
        row.append(text('strong', '', entry.keyword));
        for (const item of entry.items) {
          const link = button('', '', () => go(item));
          link.append(idLabel(item.id)); links.append(link);
        }
        row.append(links); target.append(row);
      }
      // Unnumbered drafts must stay reachable even before they have a keyword or title.
      const drafts = sortedNotes().filter(n => !n.id && noteMatches(n));
      if (drafts.length) { target.append(text('h2', 'subheading', 'ID未設定')); appendNotes(target, drafts); }
      const unlisted = sortedNotes().filter(n => n.id && !n.title.trim() && !n.keywords.length && noteMatches(n));
      if (unlisted.length) { target.append(text('h2', 'subheading', 'キーワード未設定')); appendNotes(target, unlisted); }
    } else if (kind === 'all') {
      appendNotes(target, sortedNotes().filter(noteMatches));
    } else {
      const topics = sortedTopics().filter(t => (kind !== 'zero' || /^\d+$/.test(t.ownerId)) && topicMatches(t));
      for (const t of topics) {
        const row = button('', 'note-row', () => openTopic(t.id));
        row.append(text('span', 'list-id', t.id), text('span', 'row-title', t.title || noteById(t.ownerId)?.title || '無題の索引'));
        target.append(row);
      }
    }
    if (!target.childElementCount) {
      const messages = { global: 'ノートのタイトル・キーワードが、ここに並びます。', all: 'まだノートはありません。', topics: 'ノートにIDを付けると、Topic Indexを作れます。', zero: '親ID（1、2…）のTopic Indexが、ここに並びます。' };
      target.append(text('p', 'empty-state', query.trim() ? '一致する項目はありません。' : messages[kind]));
    }
  }
  function appendNotes(target, notes) {
    for (const n of notes) {
      const row = button('', 'note-row', () => openNote(n.uid));
      row.append(idLabel(n.id), text('span', 'row-title', shortTitle(n))); target.append(row);
    }
  }
  function options(label = 'その他') {
    const details = text('details', 'note-options'); details.append(text('summary', '', label));
    const body = text('div', 'options-body'); details.append(body);
    return { details, body };
  }
  function renderNote(n) {
    const target = $('content'); target.replaceChildren();
    const heading = text('div', 'note-heading');
    const id = button('', 'id-button', () => setId(n)); id.append(idLabel(n.id || '', 'code-id'));
    id.setAttribute('aria-label', n.id ? 'IDを変更 ' + n.id : 'IDを付ける');
    const links = text('div', 'heading-links');
    for (const t of topicsFor(n.id)) links.append(button(t.id, '', () => openTopic(t.id)));
    if (n.id && (!topicsFor(n.id).length || data.settings.allowMultipleTopics)) links.append(button('＋ Topic Index', '', () => createTopic(n)));
    heading.append(id, links); target.append(heading);
    const title = text('input', 'title-input'); title.id = 'noteTitle'; title.placeholder = 'タイトル（任意）'; title.setAttribute('aria-label', 'ノートのタイトル'); title.value = n.title;
    title.addEventListener('input', () => { n.title = title.value; n.updatedAt = now(); dirty(); });
    const editor = text('textarea', 'body-editor'); editor.id = 'noteBody'; editor.spellcheck = false; editor.placeholder = 'ここから書く…'; editor.setAttribute('aria-label', 'ノート本文'); editor.value = n.body;
    const refs = text('div', 'references');
    editor.addEventListener('input', () => { n.body = editor.value; n.updatedAt = now(); dirty(); refsInto(refs, n.body); });
    target.append(title, editor, refs); refsInto(refs, n.body);
    const footer = text('div', 'editor-footer');
    if (n.id) {
      const branch = P.unusedChild(n.id, ids()), sibling = P.unusedSibling(n.id, ids());
      const tools = text('div', 'branch-tools');
      tools.append(button('分岐 ' + branch, 'quiet', () => newNote(branch)), button('並列 ' + sibling, 'quiet', () => newNote(sibling)));
      footer.append(tools);
    }
    const menu = options('キーワード・その他');
    const label = text('label', '', 'キーワード（Global Index用）'); label.htmlFor = 'noteKeywords';
    const keywords = text('input', 'note-keywords'); keywords.id = 'noteKeywords'; keywords.value = n.keywords.join('、'); keywords.placeholder = 'カンマで区切る';
    keywords.addEventListener('input', () => { n.keywords = P.keywordList(keywords.value); n.updatedAt = now(); dirty(); });
    menu.body.append(label, keywords, button('ノートを削除', 'quiet danger', () => deleteNote(n)));
    footer.append(menu.details); target.append(footer);
  }
  function renderTopic(t) {
    const target = $('content'); target.replaceChildren();
    activePage = Math.min(Math.max(activePage, 1), t.pages.length);
    const heading = text('div', 'note-heading');
    const links = text('div', 'heading-links'); links.append(button('元ノート ' + t.ownerId, '', () => go(t.ownerId)));
    heading.append(text('span', 'code-id', t.id), links, text('span', 'page-marker', String(activePage))); target.append(heading);
    const title = text('input', 'title-input'); title.placeholder = '索引の名前（任意）'; title.setAttribute('aria-label', '索引の名前'); title.value = t.title;
    title.addEventListener('input', () => { t.title = title.value; dirty(); });
    target.append(title);
    if (t.pages.length > 1) {
      const pages = text('div', 'page-switch');
      for (let i = 1; i <= t.pages.length; i++) {
        const page = button(String(i), 'page-number' + (i === activePage ? ' active' : ''), () => openTopic(t.id, i));
        page.setAttribute('aria-label', 'ページ ' + i);
        if (i === activePage) page.setAttribute('aria-current', 'page');
        pages.append(page);
      }
      target.append(pages);
    }
    const editor = text('textarea', 'body-editor'); editor.id = 'topicBody'; editor.spellcheck = false; editor.value = t.pages[activePage - 1]; editor.placeholder = 'キーワードと参照IDを書く…'; editor.setAttribute('aria-label', 'Topic Index ページ ' + activePage);
    const refs = text('div', 'references');
    editor.addEventListener('input', () => { t.pages[activePage - 1] = editor.value; dirty(); refsInto(refs, editor.value); });
    target.append(editor, refs); refsInto(refs, editor.value);
    const footer = text('div', 'editor-footer');
    footer.append(button('＋ ページ', 'quiet', () => { t.pages.push(''); dirty(); openTopic(t.id, t.pages.length); $('topicBody').focus(); }));
    const menu = options();
    if (t.pages.length > 1) menu.body.append(button('このページを削除', 'quiet danger', async () => {
      if (!await ask('ページを削除', { confirm: true, message: t.id + '(' + activePage + ') を削除します。以降のページ番号は繰り上がります。', submit: '削除' })) return;
      t.pages.splice(activePage - 1, 1); activePage = Math.max(1, activePage - 1); dirty(); render();
    }));
    menu.body.append(button('索引を削除', 'quiet danger', () => deleteTopic(t)));
    footer.append(menu.details); target.append(footer);
  }
  function render() {
    document.querySelectorAll('[data-view]').forEach(b => {
      const active = b.dataset.view === view;
      b.classList.toggle('active', active);
      if (active) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('indexTools').hidden = view !== 'index'; $('settings').hidden = view !== 'index';
    if (view === 'index') renderIndex();
    else if (selectedTopic && topicById(selectedTopic)) renderTopic(topicById(selectedTopic));
    else if (noteByUid(selectedUid)) renderNote(noteByUid(selectedUid));
    else $('content').replaceChildren(text('p', 'empty-state', 'Indexからノートを開くか、＋ ノートで書き始めます。'));
  }
  async function initialize() {
    $('newNote').disabled = true;
    $('newNote').addEventListener('click', () => newNote());
    $('search').addEventListener('input', event => { query = event.target.value; renderIndex(); });
    $('search').addEventListener('keydown', event => {
      if (event.key === 'Enter' && P.parseRef(query)) {
        event.preventDefault(); if (!go(query)) void inform('参照先が見つかりません: ' + query);
      }
    });
    $('indexKind').addEventListener('change', renderIndex);
    $('allowMultipleTopics').addEventListener('change', event => { data.settings.allowMultipleTopics = event.target.checked; dirty(); });
    $('openFolder').addEventListener('click', async () => { const error = await api.openFolder(); if (error) await inform('保存先を開けませんでした: ' + error); });
    document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => { if (!loadFailed) activate(el.dataset.view); }));
    document.addEventListener('keydown', event => {
      if ($('entryDialog').open || loadFailed || $('newNote').disabled) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') { event.preventDefault(); newNote(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
    });
    api.onCloseRequest(async () => api.closeReady(loadFailed || await save()));
    try {
      data = P.normalize(await api.load());
      $('allowMultipleTopics').checked = data.settings.allowMultipleTopics;
      $('newNote').disabled = false;
      selectedUid = data.notes[0]?.uid || null;
      render(); status('保存済み');
    } catch (error) {
      loadFailed = true; status('読み込みエラー', true);
      $('indexTools').hidden = true;
      $('allowMultipleTopics').disabled = true;
      $('content').replaceChildren(text('p', 'empty-state', '保存データを読み込めませんでした。保存を停止しています。「保存先を開く」でデータファイルを確認してください。'));
      console.error(error);
    }
  }
  void initialize();
})();
