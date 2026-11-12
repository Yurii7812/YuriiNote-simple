// Folgezettel ID operations adapted from the original YuriiNote's lib.js.
// Paper-style indexes: 1-1, optionally 1-2; extra pages: 1-1(2).
(function (host, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else host.PKM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NOTE = /^[1-9]\d*[a-z0-9]*$/;
  const TOPIC = /^([1-9]\d*[a-z0-9]*)-([1-9]\d*)$/;

  function validNote(id) { return NOTE.test(String(id || '')); }
  function validTopic(id) {
    const match = String(id || '').match(TOPIC);
    return !!match && validNote(match[1]);
  }
  function ownerOf(id) { const m = String(id || '').match(TOPIC); return m ? m[1] : null; }
  function topicId(noteId, number = 1) {
    if (!validNote(noteId) || !Number.isSafeInteger(number) || number < 1) throw Error('索引番号が正しくありません');
    return noteId + '-' + number;
  }
  function nextTopicId(noteId, allTopicIds, allowMultiple = false) {
    if (!validNote(noteId)) throw Error('ノートIDが正しくありません');
    const mine = (allTopicIds || []).filter(id => ownerOf(id) === noteId);
    if (mine.length && !allowMultiple) throw Error('このノートIDにはすでにTopic Indexがあります。複数作成は設定から有効にできます。');
    let number = 1;
    while (mine.includes(topicId(noteId, number))) number++;
    return topicId(noteId, number);
  }
  function parts(id) { return String(id).match(/\d+|[a-z]+/g) || []; }
  function compareNotes(a, b) {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const xn = /^\d+$/.test(x[i]), yn = /^\d+$/.test(y[i]);
      if (xn !== yn) return xn ? -1 : 1;
      if (xn && Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
      if (!xn && x[i] !== y[i]) return x[i].length - y[i].length || (x[i] < y[i] ? -1 : 1);
    }
    return x.length - y.length;
  }
  function nextLetters(source) {
    const chars = source.split(''); let index = chars.length - 1;
    while (index >= 0) {
      if (chars[index] === 'z') { chars[index] = 'a'; index--; }
      else { chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1); return chars.join(''); }
    }
    return 'a' + chars.join('');
  }
  function sibling(id) {
    if (!validNote(id)) throw Error('ノートIDが正しくありません');
    const items = parts(id), last = items.pop();
    items.push(/^\d+$/.test(last) ? String(Number(last) + 1) : nextLetters(last));
    return items.join('');
  }
  function child(id) {
    if (!validNote(id)) throw Error('ノートIDが正しくありません');
    const items = parts(id);
    return id + (/^\d+$/.test(items.at(-1)) ? 'a' : '1');
  }
  function rootId(id) { return (String(id || '').match(/^\d+/) || [])[0] || null; }
  function depth(id) { return Math.max(0, parts(id).length - 1); }
  function nextRoot(ids) {
    let max = 0;
    for (const id of ids) if (validNote(id)) max = Math.max(max, Number(rootId(id)));
    return String(max + 1);
  }
  function unusedChild(id, existing) {
    const ids = new Set(existing);
    let candidate = child(id);
    while (ids.has(candidate)) candidate = sibling(candidate);
    return candidate;
  }
  function unusedSibling(id, existing) {
    const ids = new Set(existing);
    let candidate = sibling(id);
    while (ids.has(candidate)) candidate = sibling(candidate);
    return candidate;
  }
  function parseRef(input) {
    const raw = String(input || '').trim().replace(/^[★↑＝= ]+/, '').replace(/^:/, '').replace(/:$/, '').trim();
    if (raw === '0') return { kind: 'zero', id: '0', page: 1 };
    const topic = raw.match(/^([1-9]\d*[a-z0-9]*-\d+)(?:\((\d+)\))?$/);
    if (topic && validTopic(topic[1])) return { kind: 'topic', id: topic[1], page: topic[2] ? Number(topic[2]) : 1 };
    const note = raw.match(/^([1-9]\d*[a-z0-9]*)(?:\((\d+)\))?$/);
    if (note && validNote(note[1])) return { kind: 'note', id: note[1], anchor: note[2] ? Number(note[2]) : null };
    return null;
  }
  function findRefs(body) {
    const text = String(body || '');
    const re = /(?<![\w(-])(?::)?([1-9]\d*[a-z0-9]*-\d+(?:\(\d+\))?|[1-9]\d*[a-z0-9]*(?:\(\d+\))?)(?::)?(?!(?:-\d)|[\w)-])/g;
    const seen = new Set(), refs = [];
    for (const match of text.matchAll(re)) {
      const ref = parseRef(match[1]);
      if (!ref || seen.has(match[1])) continue;
      // A date such as 2026-11-12 and an ordinary (1) are not references.
      seen.add(match[1]); refs.push({ ...ref, label: match[1] });
    }
    return refs;
  }
  function keywordList(input) {
    return [...new Set(String(input || '').split(/[,，、\n]/).map(x => x.trim()).filter(Boolean))];
  }
  function normalize(raw) {
    const d = raw && typeof raw === 'object' ? raw : {};
    const notes = (Array.isArray(d.notes) ? d.notes : []).filter(n => n && (!n.id || validNote(n.id))).map((n, i) => ({
      uid: String(n.uid || ('old-' + String(n.id || i))),
      id: validNote(n.id) ? String(n.id) : '',
      title: String(n.title || ''), body: String(n.body || ''),
      keywords: keywordList(Array.isArray(n.keywords) ? n.keywords.join(',') : n.keywords || ''),
      createdAt: String(n.createdAt || ''), updatedAt: String(n.updatedAt || '')
    }));
    const seenId = new Set(), seenUid = new Set();
    const uniqueNotes = notes.filter(n => {
      if (seenUid.has(n.uid) || (n.id && seenId.has(n.id))) return false;
      seenUid.add(n.uid); if (n.id) seenId.add(n.id);
      return true;
    });
    const seenIndex = new Set();
    const topics = (Array.isArray(d.topics) ? d.topics : [])
      .filter(t => t && validTopic(t.id) && seenId.has(ownerOf(t.id)))
      .map(t => ({
        id: String(t.id), ownerId: ownerOf(t.id), title: String(t.title || ''),
        pages: (Array.isArray(t.pages) && t.pages.length ? t.pages : ['']).map(p => String(p))
      }))
      .filter(t => { if (seenIndex.has(t.id)) return false; seenIndex.add(t.id); return true; });
    const settings = { allowMultipleTopics: !!(d.settings && d.settings.allowMultipleTopics) };
    return { version: 1, notes: uniqueNotes, topics, settings };
  }
  function globalEntries(data) {
    const index = new Map();
    const add = (word, item) => {
      const keyword = String(word || '').trim();
      if (!keyword) return;
      if (!index.has(keyword)) index.set(keyword, new Map());
      index.get(keyword).set(item.kind + ':' + item.id, item);
    };
    for (const n of data.notes) {
      if (!n.id) continue;
      add(n.title, { kind: 'note', id: n.id });
      for (const word of n.keywords) add(word, { kind: 'note', id: n.id });
    }
    for (const t of data.topics) add(t.title, { kind: 'topic', id: t.id });
    const collator = new Intl.Collator('ja', { sensitivity: 'base' });
    return [...index.entries()].sort((a, b) => collator.compare(a[0], b[0]))
      .map(([keyword, items]) => ({ keyword, items: [...items.values()] }));
  }
  return { validNote, validTopic, topicId, nextTopicId, ownerOf, compareNotes,
    sibling, child, rootId, depth, nextRoot, unusedChild, unusedSibling,
    parseRef, findRefs, keywordList, normalize, globalEntries };
});
