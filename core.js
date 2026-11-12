// A small independent implementation of the Folgezettel ID helpers used in YuriiNote.
// ID order, 'child' and 'sibling' behavior follow the original YuriiNote's lib.js.
// No UI framework or external library is required.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PKM = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NOTE = /^[1-9]\d*[a-z0-9]*$/;
  const TOPIC = /^([1-9]\d*[a-z0-9]*)-1$/;

  function validNote(id) {
    return NOTE.test(String(id || ''));
  }
  function validTopic(id) {
    return TOPIC.test(String(id || ''));
  }
  function topicId(noteId) {
    if (!validNote(noteId)) throw Error('ノートIDが正しくありません');
    return noteId + '-1';
  }
  function ownerOf(topic) {
    const m = String(topic || '').match(TOPIC);
    return m ? m[1] : null;
  }
  function parts(id) {
    return String(id).match(/\d+|[a-z]+/g) || [];
  }
  function compareNotes(a, b) {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      const aNum = /^\d+$/.test(x[i]), bNum = /^\d+$/.test(y[i]);
      if (aNum !== bNum) return aNum ? -1 : 1;
      if (aNum && Number(x[i]) !== Number(y[i])) return Number(x[i]) - Number(y[i]);
      if (!aNum && x[i] !== y[i]) return x[i].length - y[i].length || (x[i] < y[i] ? -1 : 1);
    }
    return x.length - y.length;
  }
  function nextLetters(value) {
    let a = value.split(''), i = a.length - 1;
    while (i >= 0) {
      if (a[i] === 'z') { a[i] = 'a'; i--; }
      else { a[i] = String.fromCharCode(a[i].charCodeAt(0) + 1); return a.join(''); }
    }
    return 'a' + a.join('');
  }
  function sibling(id) {
    if (!validNote(id)) throw Error('ノートIDが正しくありません');
    const a = parts(id), last = a.pop();
    a.push(/^\d+$/.test(last) ? String(Number(last) + 1) : nextLetters(last));
    return a.join('');
  }
  function child(id) {
    if (!validNote(id)) throw Error('ノートIDが正しくありません');
    const a = parts(id), last = a[a.length - 1];
    return id + (/^\d+$/.test(last) ? 'a' : '1');
  }
  function rootId(id) {
    return (String(id || '').match(/^\d+/) || [])[0] || null;
  }
  function depth(id) {
    return Math.max(0, parts(id).length - 1);
  }
  function nextRoot(ids) {
    let max = 0;
    for (const id of ids) if (validNote(id)) max = Math.max(max, Number(rootId(id)));
    return String(max + 1);
  }
  function unusedChild(parent, used) {
    const taken = new Set(used);
    let proposed = child(parent);
    while (taken.has(proposed)) proposed = sibling(proposed);
    return proposed;
  }
  function unusedSibling(from, used) {
    const taken = new Set(used);
    let proposed = sibling(from);
    while (taken.has(proposed)) proposed = sibling(proposed);
    return proposed;
  }
  function parseRef(input) {
    const raw = String(input || '').trim().replace(/^[★↑＝=\s]+/, '').replace(/^:/, '').replace(/:$/, '').trim();
    if (raw === '0') return { kind: 'zero', id: '0', page: 1 };
    const topic = raw.match(/^([1-9]\d*[a-z0-9]*-1)(?:\((\d+)\))?$/);
    if (topic) return { kind: 'topic', id: topic[1], page: topic[2] ? Number(topic[2]) : 1 };
    const note = raw.match(/^([1-9]\d*[a-z0-9]*)(?:\((\d+)\))?$/);
    if (note) return { kind: 'note', id: note[1], anchor: note[2] ? Number(note[2]) : null };
    return null;
  }
  function findRefs(body) {
    const re = /(?<![\w-])(?::)?([1-9]\d*[a-z0-9]*-1(?:\(\d+\))?|[1-9]\d*[a-z0-9]*(?:\(\d+\))?)(?::)?(?![\w-])/g;
    const seen = new Set(), out = [];
    for (const match of String(body || '').matchAll(re)) {
      const ref = parseRef(match[1]);
      if (!ref || seen.has(match[1]) || (match.index > 0 && body[match.index - 1] === '(' && body[match.index + match[0].length] === ')')) continue;
      seen.add(match[1]);
      out.push({ ...ref, label: match[1] });
    }
    return out;
  }
  function keywordList(input) {
    return [...new Set(String(input || '').split(/[,，、\n]/).map(x => x.trim()).filter(Boolean))];
  }
  function normalize(data) {
    const d = data && typeof data === 'object' ? data : {};
    const notes = (Array.isArray(d.notes) ? d.notes : []).filter(n => n && (validNote(n.id) || !n.id)).map((n, i) => ({
      uid: String(n.uid || ('legacy-' + String(n.id || i))),
      id: validNote(n.id) ? String(n.id) : '',
      title: String(n.title || ''), body: String(n.body || ''),
      keywords: keywordList(Array.isArray(n.keywords) ? n.keywords.join(',') : n.keywords || ''),
      createdAt: String(n.createdAt || ''), updatedAt: String(n.updatedAt || '')
    }));
    const seen = new Set(), seenUids = new Set();
    const uniqueNotes = notes.filter(n => {
      if (seenUids.has(n.uid) || (n.id && seen.has(n.id))) return false;
      seenUids.add(n.uid); if (n.id) seen.add(n.id);
      return true;
    });
    const indexed = new Set();
    const topics = (Array.isArray(d.topics) ? d.topics : []).filter(t => t && validTopic(t.id) && seen.has(ownerOf(t.id))).map(t => ({
      id: String(t.id), ownerId: ownerOf(t.id), title: String(t.title || ''),
      pages: (Array.isArray(t.pages) && t.pages.length ? t.pages : ['']).map(p => String(p))
    })).filter(t => { if (indexed.has(t.id)) return false; indexed.add(t.id); return true; });
    return { version: 1, notes: uniqueNotes, topics };
  }
  function globalEntries(data) {
    const map = new Map();
    function add(keyword, target) {
      const word = String(keyword || '').trim();
      if (!word) return;
      if (!map.has(word)) map.set(word, new Map());
      map.get(word).set(target.kind + ':' + target.id, target);
    }
    for (const n of data.notes) {
      if (!n.id) continue;
      add(n.title, { kind: 'note', id: n.id });
      for (const kw of n.keywords) add(kw, { kind: 'note', id: n.id });
    }
    for (const t of data.topics) add(t.title, { kind: 'topic', id: t.id });
    const collator = new Intl.Collator('ja', { sensitivity: 'base' });
    return Array.from(map.entries()).sort((a, b) => collator.compare(a[0], b[0])).map(([keyword, items]) => ({ keyword, items: [...items.values()] }));
  }
  return { validNote, validTopic, topicId, ownerOf, compareNotes, sibling, child, rootId, depth,
    nextRoot, unusedChild, unusedSibling, parseRef, findRefs, keywordList, normalize, globalEntries };
});
