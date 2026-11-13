import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder } from '@codemirror/view';
import { EditorState, RangeSetBuilder, StateField, Prec } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import L from '../lib.js';
import Stamp from '../stamp.js';
import LinkCore from '../link-core.js';
import TopicRanking from '../topic-ranking.js';
import * as LC from './linked-content.js';
import * as ReferencePicker from './reference-picker.js';
import { plainDoc } from './reference-picker.js';
import { mdExtensions, tableTemplate, searchExt, setSearch, focusTableAt } from './md.js';
import { boardTemplate, focusBoardAt } from './board.js';
import * as Q from './query.js';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { stampsShown, clipText, setStampsShown, stampPresets, useStampPreset, saveStampPreset, deleteStampPreset } from './stamps.js';
import { ctx } from './shared.js';
import X from '../id-explorer-core.js';
import * as SM from './similar.js';
import * as PI from './pindex.js';
import { dialog, popMenu, toast, renderMd } from './shared.js';
import ExportHtml from './export-html-bridge.js';
import { installMermaidObserver } from './mermaid.js';
import UrlLinks from '../url-links.js';
import Persistence from '../persistence.js';
import { setLang } from './i18n.js';
let pendingLang = null;

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SP = { d: 'デジタル', p: '紙' };

let notes = [], topics = [], readings = {}, tab = 'd', cur = null, vault = '';
// 開いているタブ（Obsidian 風）。cur は今のタブ
let tabs = [], active = -1, newTab = false, bgOpen = false;
let mode = 'notes', diaries = [], records = [{ name: '日記', parent: '' }], lastNote = null, curKind = (() => { try { return localStorage.getItem('pkm-kind') || '日記'; } catch { return '日記'; } })(); // 左の列で選んでいる種類（ノート・日記…）
let selMode = false, picked = new Set(), lastPick = null; // 一括選択
let searchQ = ''; // いま検索している語（一覧と、開いたノートの中の印に使う）
const get = (s, id) => notes.find(n => n.s === s && n.id === id);
const free = (s, id) => { while (get(s, id)) id = L.sibling(id); return id; };
const topicOf = (s, id) => topicsOf(s, id)[0];
const topicsOf = (s, id) => topics.filter(t => t.entry && t.entry.s === s && t.entry.id === id).sort((a, b) => (a.num || 1) - (b.num || 1));   // 同じ番号に複数（1-1, 1-2）
const topicsWith = n => topics.map(t => ({ t, kws: L.mergeTopic(t).rows.filter(r => r[n.s].some(x => L.splitAnchor(x).id === n.id)).map(r => r.kw) })).filter(x => x.kws.length);
const allKeywords = () => [...new Set(notes.flatMap(n => n.keywords))].sort(L.byReading(k => readings[k]));
const readingOf = k => readings[k] || (PI.pendingEntries().find(e => e.kw === k) || {}).reading || '';   // 取り込み前の紙のキーワードの読みも
const yomi = k => readingOf(k) && readingOf(k) !== k ? `<small class="yomi">${esc(readingOf(k))}</small>` : '';
const kwTopic = k => topics.find(t => t.keyword === k);
// そのキーワードの索引 があれば赤い点（押すと開く）。IDが2つ以上でまだ無ければ「作る」
// 左の一覧の並べ替えと表示。ノート（デジタル・紙・未整理）と日記は、並び順をそれぞれ別に覚える
const prefs = (() => { try { return JSON.parse(localStorage.getItem('pkm-list-prefs') || '{}'); } catch { return {}; } })();
let paperOnly = !!prefs.paperOnly;   // 全体を紙だけにする（ノート・Index・トピックIndex）
const isVisS = sp => !paperOnly || sp === 'p';
let sortBy = prefs.by || 'fz', sortDir = prefs.dir || 'asc';
let diarySortDir = prefs.diaryDir || 'asc';   // 日記の並び（ノートの並びとは別。日記は日付順なので、向きだけ）
const savePrefs = () => { try { localStorage.setItem('pkm-list-prefs', JSON.stringify({ by: sortBy, dir: sortDir, diaryDir: diarySortDir, paperOnly })); } catch { } };
// 「キーワード ID ID(p) …」の 1 行。親の側と違う ID には、(p) か (d) を付ける
const idsText = (k, v, def) => { const toks = [...v.d.map(x => def === 'd' ? x : x + '(d)'), ...v.p.map(x => def === 'p' ? x : x + '(p)')]; return toks.length ? k + ' ' + toks.join(' ') : ''; };
const ixRow = ([k, v]) => {
  const on = cur && cur.k === 'topic' && (() => { const o = topics.find(x => x.name === cur.name); return o && ((o.keyword && o.keyword === k) || (o.entry && v[o.entry.s].includes(o.entry.id) && !o.keyword && false)); })();
  return `<div class="ix${on ? ' on' : ''}" data-ixk="${esc(k)}"><b>${esc(k)}</b>${yomi(k)} ${chips(v, k)}</div>`;
};
// 親のノートに、そのキーワードを付ける（Index の ID の並びに入る）
async function ensureKeyword(sp, id, kw) {
  const n = get(sp, id);
  if (!kw || !n || n.keywords.includes(kw)) return;
  n.keywords.push(kw); await api.saveNote(pubNote(n));
}

// ===== 保存（少し待ってまとめて）=====
let recovery = null, recoveryError = false;
const noteKey = n => 'n' + n.s + n.id;
const diaryKey = d => 'dy' + (d.kind || '日記') + d.date;
function saveStatus(q) {
  const el = $('#save-status'); if (!el) return;
  const failed = recoveryError || [...q.jobs.values()].some(j => j.error);
  el.hidden = !failed;   // ふだんは出さない。保存に失敗したときだけ ⚠️ を出す
  el.textContent = '⚠️';
  el.title = failed ? '保存エラー・クリックして再試行（入力内容は保持しています。保存先の空き容量やアクセス権を確認してください）' : q.jobs.size ? '保存中…' : '保存済み';
}
const saves = new Persistence.SaveQueue({ onChange: saveStatus, onError: () => saveStatus(saves) });
const later = (k, f) => saves.later(k, f);
$('#save-status').onclick = () => flush().catch(() => {});
const pubNote = n => ({ s: n.s, id: n.id, created: n.created, keywords: n.keywords, body: n.body, kind: n.kind, data: n.data, title: n.title, parentStem: n.parentStem, pinned: n.pinned, color: n.color, archived: n.archived });
function durableSave(key, kind, payload, write, done = () => {}) {
  // Freeze each edit. A detached editor or a refreshed object cannot change
  // the payload after it has been queued.
  const snapshot = JSON.parse(JSON.stringify(payload)), journal = recovery;
  let token;
  try { token = journal?.record(key, kind, snapshot); recoveryError = false; }
  catch { recoveryError = true; }
  later(key, async () => {
    const result = await write(snapshot);
    if (!result || result.ok === false) throw new Error('保存できませんでした');
    if (token) { try { journal.acknowledge(key, token); } catch { recoveryError = true; } }
    await done(result, snapshot, () => !saves.changedSince(key, revision)); return result;
  });
  const revision = saves.revision;
}
const saveNote = n => { durableSave(noteKey(n), 'note', pubNote(n), x => api.saveNote(x), r => { if (r.updated) n.updated = r.updated; }); setTimeout(() => LC.refresh(), 0); };
const saveTopic = t => durableSave('t' + t.name, 'topic', t, x => api.saveTopic(x));
const saveDiary = d => durableSave(diaryKey(d), 'diary', { date: d.date, kind: d.kind || '日記', title: d.title, body: d.body }, x => api.saveDiary(x), (_r, x) => { renderTabs(); });
const saveDocument = (key, name, doc, done) => durableSave(key, 'doc', { name, doc }, x => api.saveDoc(x.name, x.doc), done);
async function flush() { await saves.flush(); }
window.addEventListener('beforeunload', e => {
  if (!saves.jobs.size) return;
  // Reload/navigation cannot await IPC; keep the window until writes finish.
  e.preventDefault(); e.returnValue = ''; flush().catch(() => {});
});
document.addEventListener('visibilitychange', () => { if (document.hidden) flush().catch(() => {}); });
if (window.api.onFlush) window.api.onFlush(() => flush());
if (window.api.onFileDup) window.api.onFileDup(dups => toast(dups.length === 1 ? `「${dups[0].orig}」は既にあります（${dups[0].existing}）` : `${dups.length} 件のファイルは、既にあります`));   // 同じ中身のファイルは、二重に取り込まない
installMermaidObserver();
ReferencePicker.attachTextareas();
LC.install();

// ===== エディタ（:1 や (1) をその場でリンクに）=====
function links(mode, space) {
  const build = view => {
    const b = new RangeSetBuilder(), text = view.state.doc.toString(), selM = view.hasFocus ? view.state.selection.main : { from: -9, to: -9 };   // 編集していない（フォーカスなし）ときは、書き方を隠して、見た目のまま。開いた直後に、先頭のリンクが生の書き方で出ないように
    const add = (from, to, data, ok, extra) => b.add(from, to, Decoration.mark({ class: 'lk' + (data && data.t === 'ref' ? ' ref' : '') + (ok ? '' : ' miss') + (extra ? ' ' + extra : ''), attributes: { 'data-l': JSON.stringify(data) } }));
    if (mode === 'note') {
      const items = [], syms = [];
      for (const t of L.tokens(text)) {
        if (t.k === 'ref') items.push([t.from, t.to, { t: 'ref', s: t.sp || space, id: t.id, n: t.n }, !!get(t.sp || space, t.id)]);   // (p) 紙・(d) デジタル。書かなければ、いまのノートと同じ側
        else if (t.bare) items.push([t.from, t.to, 'mk']); // 素の (1) は赤いだけ
        else items.push([t.from, t.to, { t: 'self', n: t.n, bare: t.bare }, L.selfTarget(text, t.n, t.bare) >= 0]);
        if (t.arrow) syms.push([t.arrow, 'arrow', t]);   // -> は、見た目では → に。コンマも赤
        if (t.sep) syms.push([t.sep, 'sep', t]);
      }
      const markdownLinks = [...text.matchAll(new RegExp(L.MDLINK.source, 'g'))]
        .map(m => ({from: m.index, to: m.index + m[0].length, rel: m[0].slice(m[0].lastIndexOf('](') + 2, -1)}))
        .filter(x => !UrlLinks.fencedRanges(text).some(([a,b]) => x.from < b && a < x.to));
      for (const m of markdownLinks)
        items.push([m.from, m.to, {t:'file',rel:m.rel},true,'file']);
      // https://... や www.... のような裸のURLも本文から直接ブラウザで開く。
      // Markdownリンクやコードブロック内は二重リンク化しない。
      const bare = UrlLinks.bareUrls(text,markdownLinks.map(m=>[m.from,m.to]));
      const spans = [...markdownLinks.map(m=>[m.from,m.to]),...bare.map(m=>[m.from,m.to])];
      for (let i=items.length-1;i>=0;i--) {
        const [from,to,item] = items[i];
        if (item?.t !== 'file' && spans.some(([a,b])=>from<b && a<to)) items.splice(i,1);
      }
      for (const link of bare) items.push([link.from,link.to,{t:'file',rel:link.url},true,'url']);
      // カーソルが外にあるとき、リンクは名前だけを見せる（![ や ](パス) を隠す）。カーソルを置くと元の記述が出る
      const sel = selM, rs = [];
      for (const [f, t, d, ok, cls] of items) {
        if (d === 'mk') { rs.push(Decoration.mark({ class: 'mk' }).range(f, t)); continue; }
        if (d && d.t === 'ref' && !d.n && ok && !(sel.from <= t && sel.to >= f)) {   // 「- :ID」だけの行（今日のノートなど）は、ID のかわりにノートの題を見せる
          const ls = text.lastIndexOf('\n', f - 1) + 1, le = text.indexOf('\n', f), line = text.slice(ls, le < 0 ? text.length : le);
          const nt = /^\s*(-\s+)?:[0-9a-z]+\s*$/.test(line) && get(d.s, d.id);
          if (nt) { rs.push(Decoration.replace({ widget: new TitleWidget(titleOf(nt), d) }).range(f, t)); continue; }
        }
        rs.push(Decoration.mark({ class: 'lk' + (cls ? ' ' + cls : '') + (d && d.t === 'ref' ? ' ref' : '') + (d && d.t === 'self' ? ' selfref' : '') + (ok ? '' : ' miss'), attributes: { 'data-l': JSON.stringify(d) } }).range(f, t));
        if (cls === 'file' && !(sel.from <= t && sel.to >= f)) {
          const open = text[f] === '!' ? 2 : 1, close = text.lastIndexOf('](', t);
          if (close === f + open) { // ![](ファイル名): 説明文が空なので、ファイル名は見せない（カーソルが乗ったときだけ、書いたとおりに出る）
            rs.push(Decoration.replace({}).range(f, t));
          } else rs.push(Decoration.replace({}).range(f, f + open), Decoration.replace({}).range(close, t));
        }
      }
      for (const [[f, t], kind, tk] of syms) {   // カーソルが近くにあるとき（編集中）は、書いたとおりの -> を赤で。外にあるときは、赤い → にする
        const near = sel.from <= tk.to && sel.to >= tk.from;
        if (kind === 'arrow' && !near && text.startsWith('->', f)) rs.push(Decoration.replace({ widget: new ArrowWidget(tk) }).range(f, t));
        else rs.push(Decoration.mark({ class: 'lksym' }).range(f, t));
      }
      return Decoration.set(rs, true);
    } else {
      let off = 0;
      for (const line of text.split('\n')) {
        const r = L.topicLine(line);
        const lead = /^(\s*)(\^|＾|↑|⬆\uFE0F?|_|＿|↓|⬇\uFE0F?|↰|↖\uFE0F?|↩\uFE0F?|<\||@|＠|⭕\uFE0F?|(?:\*|＊)(?![0-9])|★|☆|⭐\uFE0F?|\+|＋|↳|↘\uFE0F?|↪\uFE0F?|\|>)/.exec(line);
        if (lead) {   // 行頭の印は赤。カーソルが外にあるとき、<| ↰ ^ は ↰、|> ↳ + ★ は ↳、* は ◯ の見た目に（ファイルの中は、書いたまま）
          const f = off + lead[1].length, tt = f + lead[2].length, on = selM.from <= off + line.length && selM.to >= off;
          const g = /^(\^|＾|↑|⬆\uFE0F?)$/.test(lead[2]) ? L.TMARK.up : /^(_|＿|↓|⬇\uFE0F?)$/.test(lead[2]) ? L.TMARK.down : /^(↰|<\||↖\uFE0F?|↩\uFE0F?)$/.test(lead[2]) ? L.TMARK.before : /^(@|＠|\*|＊|⭕\uFE0F?)$/.test(lead[2]) ? L.TMARK.mark : L.TMARK.ref;
          if (!on) b.add(f, tt, Decoration.replace({ widget: new TopicMarkWidget(g) })); else b.add(f, tt, Decoration.mark({ class: 'tmk' }));
        }
        if (r.star !== undefined) { if (r.star) add(off + r.from, off + r.to, { t: 'topic', name: r.star }, !!topics.find(x => x.name === r.star)); else if (r.ref) add(off + r.ref.from, off + r.ref.to, { t: 'ref', s: r.ref.sp || space, id: r.ref.id }, !!get(r.ref.sp || space, r.ref.id)); }
        else { for (const x of r.ids) {
            if (x.dot) { const on2 = selM.from <= off + x.to && selM.to >= off + x.dotAt; b.add(off + x.dotAt, off + x.dotAt + 1, on2 ? Decoration.mark({ class: 'tmk' }) : Decoration.replace({})); }   // 赤点は、IDの上に（紙と同じ）。書いた * は、見た目では隠す   // 番号の前の * は、赤い点
            add(off + x.from, off + x.to, { t: 'ref', s: x.sp || space, id: x.id, n: x.n }, !!get(x.sp || space, x.id), x.dot ? 'dotid' : ''); }
          for (const x of r.tnos || []) { const tt = topics.find(y => topicNo(y) === x.tno); add(off + x.from, off + x.to, { t: 'topic', name: tt ? tt.name : x.tno }, !!tt); } }   // 0-1 のような番号は、その索引へのリンク
        off += line.length + 1;
      }
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = build(v); this.pending = false; }
    update(u) {
      if (u.view.composing) { if (u.docChanged) this.decorations = this.decorations.map(u.changes); this.pending = true; return; }   // 日本語の変換中は、作り直さない
      if (u.docChanged || u.selectionSet || u.focusChanged || this.pending) { this.decorations = build(u.view); this.pending = false; }
    }
  }, {
    decorations: v => v.decorations,
    eventHandlers: {
      compositionend(_e, view) { setTimeout(() => view.dispatch({}), 0); },
      mousedown(e, view) {
        const el = e.target.closest('[data-l]');
        if (!el || (e.button !== 0 && e.button !== 1)) return false;
        e.preventDefault();
        if (e.button === 1) { // 中クリック: 新しいタブ（背景）。今のページは動かない
          const l = JSON.parse(el.dataset.l);
          if (l.t === 'self') return true;
          bgOpen = true; try { follow(l, view); } finally { setTimeout(() => { bgOpen = false; renderTabs(); }, 0); }
          return true;
        }
        follow(JSON.parse(el.dataset.l), view); return true;
      }
    }
  });
}
// ![名前](パス) の行の下に、画像をそのまま表示する（見るだけ。押しても開かない）
const vaultUrl = () => 'file://' + vault.split('/').map(encodeURIComponent).join('/') + '/';
class TitleWidget extends WidgetType {
  constructor(title, d) { super(); this.title = title; this.d = d; }
  eq(o) { return o.title === this.title && o.d.s === this.d.s && o.d.id === this.d.id; }
  toDOM() { const e = document.createElement('span'); e.className = 'lk ref-title'; e.setAttribute('data-l', JSON.stringify(this.d)); e.textContent = this.title; return e; }
  ignoreEvent() { return false; }
}
class TopicMarkWidget extends WidgetType {   // 索引の行頭の印（↰ ↳ ◯）。赤
  constructor(g) { super(); this.g = g; }
  eq(o) { return o.g === this.g; }
  toDOM() { const e = document.createElement('span'); e.className = 'tmk'; e.textContent = this.g; return e; }
  ignoreEvent() { return false; }
}
class ArrowWidget extends WidgetType {   // ->  を、見た目だけ → にする（ファイルの中は -> のまま）
  constructor(t) { super(); this.t = t; }
  eq(o) { return o.t.id === this.t.id && o.t.from === this.t.from; }
  toDOM() { const e = document.createElement('span'); e.className = 'lksym'; e.textContent = '→'; return e; }
  ignoreEvent() { return false; }
}
class NameWidget extends WidgetType {
  constructor(name) { super(); this.name = name; }
  eq(o) { return o.name === this.name; }
  toDOM() { const e = document.createElement('span'); e.className = 'imgname'; e.textContent = this.name; return e; }
}
class ImgWidget extends WidgetType {
  constructor(rel) { super(); this.rel = rel; }
  eq(o) { return o.rel === this.rel; }
  toDOM() {
    const d = document.createElement('div'); d.className = 'cm-img';
    const i = new Image();
    try { i.src = /^https?:|^data:/.test(this.rel) ? this.rel : new URL(this.rel, vaultUrl()).href; } catch { }
    d.append(i); return d;
  }
  ignoreEvent() { return true; }
}
const images = space => {
  const build = state => {
    const b = new RangeSetBuilder();
    for (const m of state.doc.toString().matchAll(/!\[[^\]\n]*\]\(([^)\s]*)\)/g)) {
      if (/^(link|memo|note):/.test(m[1]) || /^\d{14}(?:-\d+)?\.md$/.test(m[1])) continue;
      b.add(state.doc.lineAt(m.index + m[0].length).to, state.doc.lineAt(m.index + m[0].length).to, Decoration.widget({ widget: new ImgWidget(m[1]), block: true, side: 1 }));
    }
    return b.finish();
  };
  return StateField.define({ create: build, update: (v, tr) => tr.docChanged ? build(tr.state) : v, provide: f => EditorView.decorations.from(f) });
};
// 開いているノートの本文に、検索した語の印を付ける（md.js の searchHighlight が読む）
function searchMark() { if (lastView && lastView.dom.isConnected) lastView.dispatch({ effects: setSearch.of(searchQ ? qTerms(searchQ) : '') }); }
let lastView = null;
// URL を貼ったら、ページの題を取ってきて [題](URL) にする（取れるまでは URL のまま。選んでいた文字があれば、その文字が表示名）
let plainPaste = false;   // Ctrl+Shift+V（書式なしで貼る）: 題をつけず、URL をそのまま（裸で）入れる
const urlPasteTitle = EditorView.domEventHandlers({
  keydown(e) { if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key || '').toLowerCase() === 'v') { plainPaste = true; setTimeout(() => { plainPaste = false; }, 600); } return false; },
  paste(e, view) {
    if (plainPaste) { plainPaste = false; return false; }
    const t = (e.clipboardData && e.clipboardData.getData('text/plain') || '').trim();
    if (!/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
    const url = UrlLinks.externalUri(t); if (!url) return false;
    const { from, to } = view.state.selection.main, picked = view.state.sliceDoc(from, to);
    if (UrlLinks.fencedRanges(view.state.doc.toString()).some(([x, y]) => from >= x && from < y)) return false;   // コードの中は、そのまま
    e.preventDefault();
    const href = url.replace(/\(/g, '%28').replace(/\)/g, '%29');
    if (picked && !/\n/.test(picked)) { view.dispatch({ changes: { from, to, insert: `[${picked}](${href})` }, selection: { anchor: from + picked.length + href.length + 4 } }); return true; }
    view.dispatch({ changes: { from, to, insert: t }, selection: { anchor: from + t.length } });
    api.urlTitle(url).then(title => {
      if (!title || !view.dom.isConnected) return;
      // 貼ったその URL（貼った文字そのまま）を、いまの本文から探す。すぐ後ろに文字が続いていても、貼った分だけを置き換える
      const text = view.state.doc.toString(), hits = []; let at = -1;
      while ((at = text.indexOf(t, at + 1)) >= 0) if (text.slice(Math.max(0, at - 2), at) !== '](' && text[at - 1] !== '[') hits.push(at);
      if (!hits.length) return;
      const h = hits.reduce((x, y) => Math.abs(y - from) < Math.abs(x - from) ? y : x);
      view.dispatch({ changes: { from: h, to: h + t.length, insert: `[${title}](${href})` } });
    }).catch(() => { });
    return true;
  }
});
const editorBindings = new Map();
function syncEditors() {
  for (const [view, binding] of editorBindings) {
    if (!view.dom.isConnected) { view.destroy(); editorBindings.delete(view); continue; }
    const text = binding.read();
    if (text !== view.state.doc.toString()) {
      binding.syncing = true;
      try { view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }); }
      finally { binding.syncing = false; }
    }
  }
}
// ===== 時刻（行ごとの年月日＋時刻）=====
// 全部の行に、書いた時刻が目印として付く（src/stamps.js）。ここでは、画面に出すかどうかを切り替えるだけ。ショートカットは Ctrl+R
function freeArea(doc, pos) {   // 自動で入る欄（今日の記録・紙の日記・今日のノート）の外か
  const lines = doc.split('\n'); let off = 0, at = lines.length - 1;
  for (let i = 0; i < lines.length; i++) { if (pos <= off + lines[i].length) { at = i; break; } off += lines[i].length + 1; }
  const item = /^\s*(-\s+)?(\[[^\]]*\]\([^)]*\)|:[0-9a-z]+)\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '## 今日の記録' || t === '## 今日のノート') { let j = i + 1; while (j < lines.length && (!lines[j].trim() || item.test(lines[j]))) j++; if (at >= i && at < j) return false; i = j - 1; }
    else if (t === '## 紙の日記') { let j = i + 1; while (j < lines.length && !/^##\s/.test(lines[j])) j++; if (at >= i && at < j) return false; i = j - 1; }
  }
  return true;
}
function syncStampToggle() {
  const b = $('#stamp-toggle'); if (!b) return;
  const on = stampsShown();
  b.classList.toggle('on', on);
  b.setAttribute('aria-pressed', String(on));
  b.title = '行ごとの時刻を' + (on ? '表示中' : '非表示中') + '（Ctrl+R）';
}
function toggleStamp(view) {
  const on = !stampsShown(); setStampsShown(on);
  syncStampToggle();
  toast(on ? '⏱️ 行ごとの時刻を表示' : '⏱️ 行ごとの時刻を隠す（保存はされています）');
  if (view && view.dom.isConnected) view.focus(); return true;
}
// Ctrl+M（Mark）: そのノートで、いちばん大きい番号の次の (n) を、カーソルの位置に入れる
function insertNextAnchor(view) {
  if (!view) return false;
  const nums = L.tokens(plainDoc(view.state.doc.toString())).filter(t => t.k === 'self' && t.bare).map(t => +t.n);
  const text = `(${(nums.length ? Math.max(...nums) : 0) + 1})`, at = view.state.selection.main.head;
  view.dispatch({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } }); view.focus(); return true;
}
// ページ内検索（Ctrl+F: 今開いているページの中を、次へ・前へ・置換）。パネルの文言
const SEARCH_JA = { 'Find': '検索', 'Replace': '置換', 'next': '次へ', 'previous': '前へ', 'all': 'すべて選択', 'match case': '大文字小文字を区別', 'regexp': '正規表現（a|b で、どちらか）', 'by word': '単語単位', 'replace': '置換', 'replace all': 'すべて置換', 'close': '閉じる', 'current match': '今の一致', 'on line': '行', 'replaced $ matches': '$ 件を置換しました', 'replaced match on line $': '$ 行目を置換しました', 'Go to line': '行へ移動', 'go': '移動' };
function editor(parent, doc, mode, space, onChange, ph, read, isDiary = false) {
  const binding = { read, syncing: false };
  const view = lastView = new EditorView({
    parent, state: EditorState.create({
      doc, extensions: [history(), ...(mode === 'note' ? ReferencePicker.extension(space) : []), Prec.high(EditorView.domEventHandlers({   // Ctrl+M（新しい (n)）、Ctrl+R（時刻のオン・オフ）。キーの位置で見るので、日本語入力がオンでも効く
        keydown(e, v) {
          const ctl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
          if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); $('#q').focus(); $('#q').select(); return true; }   // Ctrl+F: 左の検索
          if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyE') { e.preventDefault(); openSearchPanel(v); return true; }   // Ctrl+E: 今のページの中の検索・置換
          if (ctl && e.code === 'KeyG') { e.preventDefault(); insertBoard(); return true; }
          if (ctl && e.code === 'KeyM') { e.preventDefault(); insertNextAnchor(v); return true; }
          if (ctl && e.code === 'KeyR') { e.preventDefault(); toggleStamp(v); return true; }
          return false;
        },
      })), search({ top: true }), keymap.of(searchKeymap.filter(k => !['Mod-g', 'Shift-Mod-g', 'Mod-d', 'Mod-Alt-g'].includes(k.key))), EditorState.phrases.of(SEARCH_JA), keymap.of([...defaultKeymap, ...historyKeymap]), EditorView.lineWrapping, ...(mode === 'note' ? [urlPasteTitle] : []),
        placeholder(ph), ...(mode === 'note' ? [...mdExtensions, searchExt] : []), links(mode, space), ...(mode === 'note' ? [images(space), LC.decorations(cur?.k === 'note' ? 'note:' + get(cur.s, cur.id)?.stem : cur?.k === 'diary' ? 'day:' + cur.kind + ':' + cur.date : 'embedded', space)] : []), EditorView.updateListener.of(u => { if (u.docChanged && !binding.syncing) onChange(u.state.doc.toString()); })]
    })
  });
  if (read) editorBindings.set(view, binding);
  LC.registerView(view);
  return view;
}
function jump(view, pos) {
  view.dispatch({ selection: { anchor: pos, head: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}
// 本文のリンクの行き先。アプリの中のもの（日記）は中で開き、それ以外は既定のアプリで開く
function openLink(rel) {
  if (/^(link|memo|reply|note):/.test(rel)) return LC.openUri(rel);
  if (UrlLinks.externalUri(rel)) return api.openPath(UrlLinks.externalUri(rel)); // #フラグメントとクエリを保持
  let path = rel, hash = '';
  const i = rel.indexOf('#'); if (i >= 0) { path = rel.slice(0, i); hash = rel.slice(i + 1); }
  try { path = decodeURIComponent(path); } catch { }
  let m;
  if ((m = path.match(/^(\d{14}(?:-\d+)?)\.md$/)) && (m = notes.find(x => x.stem === m[1]))) return openNote(m.s, m.id, null, false, hash); // ノート（紙・IDなし・なりきり・キャンバスも）
  if ((m = path.match(/^(\d{14}(?:-\d+)?)\.md$/)) && (m = diaries.find(x => x.stem === m[1]))) return openDiary(m.date, false, m.kind);   // 記録（日記・夢…）の、その日のノート
  return api.openPath(rel);
}
async function follow(l, view) {
  if (l.t === 'self') { const p = L.selfTarget(view.state.doc.toString(), l.n, l.bare); if (p >= 0) jump(view, p); return; }
  if (l.t === 'file') return openLink(l.rel);
  if (l.t === 'topic') { if (topics.find(t => t.name === l.name)) openTopic(l.name); return; }
  if (get(l.s, l.id)) return openNote(l.s, l.id, l.n);
  if (confirm(`${SP[l.s]} ${l.id} はまだありません。作りますか？`)) create(l.s, l.id);
}

// ===== 左の一覧 =====
function globalIndex() {
  const m = new Map();
  for (const n of notes) for (const k of n.keywords) {
    if (!m.has(k)) m.set(k, { d: [], p: [] });
    m.get(k)[n.s].push(n.id);
  }
  for (const e of PI.pendingEntries()) {   // まだ取り込んでいない紙のID
    if (!m.has(e.kw)) m.set(e.kw, { d: [], p: [] });
    for (const id of e.ids) if (!m.get(e.kw).p.includes(id)) m.get(e.kw).p.push(id);
  }
  if (paperOnly) for (const [k, v] of m) { v.d = []; if (!v.p.length) m.delete(k); }   // 紙だけ: 紙のIDがあるキーワードだけ
  for (const v of m.values()) { v.d.sort(L.cmpId); v.p.sort(L.cmpId); }
  return [...m].sort((a, b) => L.byReading(readingOf)(a[0], b[0]));
}
// id は 1a のほか 1a(1) も（(番号) は、ノートの中のその場所へ）
const chip = (s, raw, dot) => {
  const { id, n } = L.splitAnchor(raw);
  return `<span class="chip ${s}${get(s, id) ? '' : ' miss'}${dot ? ' dot' : ''}" data-s="${s}" data-id="${esc(id)}"${n ? ` data-n="${n}"` : ''}>${s === 'p' ? '紙' : ''}${esc(raw)}</span>`;
};
const rowChips = r => [['d', r.d], ['p', r.p]].filter(([s]) => isVisS(s)).map(([s, l]) => l.map(x => chip(s, x, !!(r.dot && r.dot.s === s && L.splitAnchor(x).id === r.dot.id))).join('')).join('') + (r.t || []).map(tnoChip).join('');
// 行の終わりに書いた 0-1 のような番号: その番号の索引へのリンク（グループIndex など）
const tnoChip = no => { const t = topics.find(x => topicNo(x) === no); return t ? `<span class="chip t" data-topic="${esc(t.name)}" title="${esc(t.name)}">${esc(no)} ${esc(stripId(t.name))}</span>` : `<span class="chip miss" title="その番号の索引はありません">${esc(no)}</span>`; };
const paperRows = rows => paperOnly ? rows.filter(r => r.p.length || (r.t || []).length) : rows;   // 紙だけのとき、紙のIDがない行は出さない
const topicVisible = t => !paperOnly || !t.entry || t.entry.s === 'p';
// グローバルIndex の赤点: キーワードごとに「メインの ID」を 1 つ。vault の K_mainDots.json に（別の PC に写しても、同じ）
let mainDots = {};
const dotOf = k => mainDots[k] || null;
const saveDots = () => saveDocument('doc:mainDots', 'K_mainDots', { dots: mainDots });
function toggleMainDot(k, s, id) {
  const cur0 = dotOf(k), same = cur0 && cur0.s === s && cur0.id === id;
  if (same) delete mainDots[k]; else mainDots[k] = { s, id };
  saveDots(); renderList();
}
const chips = (v, k) => [['d', v.d], ['p', v.p]].filter(([s]) => isVisS(s)).map(([s, l]) => l.map(x => chip(s, x, !!(k && (d => d && d.s === s && d.id === L.splitAnchor(x).id)(dotOf(k))))).join('')).join('');
const stripId = name => name.replace(/^[0-9][0-9a-z]*-/, '') || name;
const topicNo = t => t.entry ? `${t.entry.id}-${t.num || 1}` : '';   // 1-1, 1-2, … グループIndexは 0-1, 0-2
const topicLabel = t => (topicNo(t) ? topicNo(t) + ' ' : '') + stripId(t.name);
const tchip = name => `<span class="chip t" data-topic="${esc(name)}">${esc(stripId(name))}</span>`;
const firstLine = n => (Stamp.strip(n.body).split('\n').find(x => x.trim()) || '').replace(/^#+\s*/, '').trim().slice(0, 40);
const titleOf = n => (n.title || '').trim() || (firstLine(n) || '（無題）');
// 検索: 一致した所を mark で囲む（大文字小文字は区別しない）
const escRe = q => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 検索語の強調・本文の抜き出し: 検索の書き方（演算子）の、含めたいふつうの言葉だけを使う
const qTermsCache = new Map(), qTerms = q => { let t = qTermsCache.get(q); if (!t) { t = Q.terms(q).sort((x, y) => y.length - x.length); if (qTermsCache.size > 50) qTermsCache.clear(); qTermsCache.set(q, t); } return t; };
const mk = (text, q) => { const ts = q ? qTerms(q) : []; return !ts.length ? esc(text) : String(text).split(new RegExp('(' + ts.map(escRe).join('|') + ')', 'ig')).map((p, i) => i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join(''); };
// 本文の中の、最初に一致した所の周辺（前後を省略して）。一致が無ければ ''
function snippet(body, q) {
  const low = body.toLowerCase(); let i = -1, len = 0;
  for (const t of qTerms(q)) { const k = low.indexOf(t.toLowerCase()); if (k >= 0 && (i < 0 || k < i)) { i = k; len = t.length; } }
  if (i < 0) return '';
  const a = Math.max(0, i - 24), b = Math.min(body.length, i + len + 56);
  return (a > 0 ? '…' : '') + mk(body.slice(a, b).replace(/\s*\n\s*/g, ' '), q) + (b < body.length ? '…' : '');
}
const icon = n => L.KINDS[n.kind || 'text'] || '';
const shortTime = c => (c || '').slice(5, 16).replace('-', '/');
const kwTags = n => n.keywords.length ? `<span class="tag">${n.keywords.map(esc).join('・')}</span>` : '';
const firstLineOf = b => (b.split('\n').find(x => x.trim() && !/^##\s/.test(x)) || '').trim().slice(0, 40);
// 左の一覧の行: タイトル（無ければ本文の最初の行）と、その下に小さく ID（IDなしは日時）とキーワード
// ===== 左の一覧の折りたたみ（Folgezettel の親子）。親のノートの ▾ を押すと、子孫が隠れる。Ctrl+J で全部たたむ／ひらく =====
let foldIds = new Set((() => { try { return JSON.parse(localStorage.getItem('ysimple.fold') || '[]'); } catch { return []; } })());
const saveFold = () => { try { localStorage.setItem('ysimple.fold', JSON.stringify([...foldIds])); } catch { } };
const fzKids = n => { const has = x => !!get(n.s, x); return notes.some(m => m.s === n.s && !m.noid && m.id !== n.id && L.parentIn(m.id, has) === n.id); };
const fzHidden = n => {   // 先祖のどれかがたたまれていれば、隠す
  const has = x => !!get(n.s, x); let p = L.parentIn(n.id, has), guard = 0;
  while (p && guard++ < 64) { if (foldIds.has(n.s + ':' + p)) return true; p = L.parentIn(p, has); }
  return false;
};
// 開いているノートの先祖（そのノートまでの道）
const fzAncestors = n => { const has = x => !!get(n.s, x), out = new Set(); let p = L.parentIn(n.id, has), guard = 0; while (p && guard++ < 64) { out.add(n.s + ':' + p); p = L.parentIn(p, has); } return out; };
// たたんでいるとき、開いたノートが隠れていたら、先祖だけをひらく（ほかは、そのまま）
function autoFold(n) {
  if (!foldIds.size || !n || n.noid) return;
  const anc = fzAncestors(n); let changed = false;
  for (const k of anc) if (foldIds.delete(k)) changed = true;
  if (changed) saveFold();
}
function toggleFoldAll() {   // Ctrl+J: 最初だけ、開いているノートまでを残して、全部たたむ。もう一度で、全部ひらく。そのあとは、ふつう（▾ ▸ で手で）
  if (foldIds.size) { foldIds.clear(); toast('折りたたみを、全部ひらきました'); }
  else {
    const n = cur && cur.k === 'note' ? get(cur.s, cur.id) : null, keep = n && !n.noid ? fzAncestors(n) : new Set();
    for (const m of notes) if (!m.noid && fzKids(m) && !keep.has(m.s + ':' + m.id)) foldIds.add(m.s + ':' + m.id);
    toast('折りたたみました（開いているノートまでは、ひらいたまま。Ctrl+J で全部ひらく）');
  }
  saveFold(); renderList();
}
const noteRow = (n, label = false, q = '') =>
  `<div class="item note${cur && cur.k === 'note' && cur.s === n.s && cur.id === n.id ? ' on' : ''}${isDecided(n.s, n.id) ? ' decided' : ''}" draggable="true" data-s="${n.s}" data-id="${esc(n.id)}">` +
  `${selMode ? `<input type="checkbox" class="ck" ${picked.has(n.s + ':' + n.id) ? 'checked' : ''}>` : ''}<div class="nrow">` +
  `<div class="nt">${!n.noid && sortBy === 'fz' && fzKids(n) ? `<i class="fzf" data-fold="${n.s}:${esc(n.id)}" title="子孫を、たたむ・ひらく">${foldIds.has(n.s + ':' + n.id) ? '▸' : '▾'}</i>` : ''}${label && n.s === 'p' ? `<span class="sp ${n.s}">${SP[n.s]}</span>` : ''}${icon(n) ? icon(n) + ' ' : ''}${n.image ? '📷 ' : ''}${mk(titleOf(n), q)}</div>` +
  `<div class="ns">${n.noid ? `IDなし · ${shortTime(n.created)}` : `${n.s === 'p' ? '紙 ' : ''}${mk(n.id, q)}`}${n.keywords.length ? ` · ${n.keywords.map(k => mk(k, q)).join('・')}` : ''}</div>${q && snippet(Stamp.strip(n.body), q) ? `<div class="sn">${snippet(Stamp.strip(n.body), q)}</div>` : ''}</div></div>`;
// 索引 の行（その親のノートの手前に出す）
const topicRow = (t, zero = false) => `<div class="item topicrow${cur && cur.k === 'topic' && cur.name === t.name ? ' on' : ''}${decided && decided.k === 'topic' && decided.name === t.name ? ' decided' : ''}" data-topic="${esc(t.name)}"><div class="nrow"><div class="nt">${esc(topicLabel(t))}</div><div class="ns">${zero ? `${SP[t.entry.s]} ${esc(t.entry.id)}` : '索引'}</div></div></div>`;

// ===== 取り込んだファイル（画像・html・csv など）。タイトルと説明を付けて、探せるようにする =====
let filesCache = [], fileFilter = 'all', filesBusy = false;
const refreshFiles = async () => { if (filesBusy) return; filesBusy = true; try { const x = await api.filesInfo(); if (JSON.stringify(x) !== JSON.stringify(filesCache)) { filesCache = x; if (tab === 'f' && !$('#q').value) renderList(); } } finally { filesBusy = false; } };
const fileIcon = e => /^\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(e) ? '🖼' : /^\.html?$/.test(e) ? '🌐' : /^\.(csv|tsv|xlsx?)$/.test(e) ? '📊' : /^\.pdf$/.test(e) ? '📕' : '📄';
// ファイルが使われている、ノート・日記（本文のリンク `](ファイル名` で探す）
const fileUsage = name => {
  const e = encRel(name), has = t => !!t && (t.includes('](' + e) || t.includes('](' + name));
  return { notes: notes.filter(n => has(n.body)), diaries: diaries.filter(d => has(d.body)), memos: [] };
};
const fileUsedCount = name => { const u = fileUsage(name); return u.notes.length + u.diaries.length + u.memos.length; };
const fileRow = (f, q = '') => `<div class="item note frow" data-file="${esc(f.name)}"><div class="nrow"><div class="nt">${fileIcon(f.ext)} ${f.title ? mk(f.title, q) : `<span class="sub">（タイトルなし）</span> ${mk(f.orig, q)}`}</div><div class="ns">${esc(f.name)}${f.title && f.orig !== f.name ? ' · ' + mk(f.orig, q) : ''}${f.desc ? ' · ' + mk(f.desc.slice(0, 40), q) : ''}${(() => { const n = fileUsedCount(f.name); return n ? ` · 🔗 ${n} 件で使用` : ' · 使われていません'; })()}</div></div></div>`;
function fileDialog(name) {
  const f = filesCache.find(x => x.name === name); if (!f) return;
  const isImg = /^\.(png|jpe?g|gif|webp|svg|bmp|avif)$/.test(f.ext);
  // 案A: 上に題（そのまま直せる・自動で保存）／左に中身／右に「使われているところ」と説明／下に操作
  $('#modal .box').innerHTML = `<div class="fidlg">
    <div class="fi-hd"><span class="fi-ic">${fileIcon(f.ext)}</span><input id="fi-t" value="${esc(f.title)}" placeholder="題（取り込んだ名前が入ります）"><button id="fi-x" class="fi-x" title="閉じる (Esc)">✕</button></div>
    <div class="fi-meta">${esc(name)} ・ ${f.size < 1024 ? f.size + ' B' : Math.round(f.size / 1024) + ' KB'} ・ ${esc(f.added)}${f.orig !== name ? ` ・ 取り込んだ名前: ${esc(f.orig)}` : ''}</div>
    <div class="fi-body">
      <div class="fi-pvbox"><div class="fi-lab">中身</div><div id="fi-pv">${isImg ? `<img class="fi-img" src="file://${esc(vault + '/' + name)}">` : `<div class="fi-none">${fileIcon(f.ext)}<br>読み込んでいます…</div>`}</div></div>
      <div class="fi-side"><div id="fi-use"></div><div class="fi-lab">説明（探すときに使います）</div><textarea id="fi-d" rows="3" placeholder="例: 本の表紙の画像">${esc(f.desc)}</textarea></div>
    </div>
    <div class="fi-bar"><button id="fi-open" class="p" title="パソコンの標準のアプリで開く">📂 開く</button><button id="fi-ins" title="いま開いているノートのカーソルに、リンクを書き込む">📌 貼る</button><span class="grow"></span><button id="fi-del" class="danger" title="ごみ箱（.trash）へ移す">🗑️ 削除</button></div>
  </div>`;
  if (!isImg) api.filePreview(name).then(p => {   // 文字のファイルは、アプリの中で中身を見られる
    const box = $('#fi-pv'); if (!box) return;
    if (p && p.kind === 'text') box.innerHTML = `<pre class="fi-pre">${esc(p.text)}</pre>${p.cut ? `<div class="sub">先頭の 60KB だけ表示（全体は ${Math.round(p.size / 1024)} KB。「開く」で全部）</div>` : ''}`;
    else box.innerHTML = `<div class="fi-none">${fileIcon(f.ext)}<br>この形式は、アプリの中では見られません。<br>「📂 開く」で見られます</div>`;
  });
  $('#modal').style.display = 'flex'; $('#fi-t').focus();
  // 題と説明は、書いたそばから自動で保存（保存ボタンはない）。閉じるときに、残りも保存して一覧を直す
  const saveInfo = () => api.setFileInfo(name, { title: $('#fi-t') ? $('#fi-t').value : f.title, desc: $('#fi-d') ? $('#fi-d').value : f.desc });
  $('#fi-t').oninput = $('#fi-d').oninput = () => later('fi' + name, saveInfo);
  const close = () => {
    $('#modal').style.display = 'none'; $('#modal').onclick = null;
    flush().then(async () => { filesCache = await api.filesInfo(); if (tab === 'f' && !$('#q').value) renderList(); });
  };
  $('#fi-x').onclick = close; $('#modal').onkeydown = e => { if (e.key === 'Escape') close(); };
  $('#modal').onclick = e => { if (e.target.id === 'modal') close(); };
  $('#fi-open').onclick = () => api.openPath(encRel(name));
  {   // このファイルが使われているところ（押すとそこへ）
    const u = fileUsage(name), total = u.notes.length + u.diaries.length + u.memos.length;
    $('#fi-use').innerHTML = `<div class="fi-lab">🔗 使われているところ${total ? `（${total} 件）` : ''}</div>` + (total ? `<div class="fi-uselist">`
      + u.notes.map(n => `<div class="fi-u" data-un="${esc(n.s)}|${esc(n.id)}">📝 <span>${n.noid ? '' : esc(n.id) + ' '}${esc(titleOf(n) || '（無題）')}</span><small>ノート</small></div>`).join('')
      + u.diaries.map(d => `<div class="fi-u" data-ud="${esc(d.date)}|${esc(d.kind || '日記')}">📔 <span>${esc(d.date)} ${esc(d.kind || '日記')}</span><small>日記</small></div>`).join('')
      + u.memos.map(m => `<div class="fi-u" data-um="${esc(m.id)}">💬 <span>${esc((m.text || '').split('\n')[0].replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 40) || '（メモ）')}</span><small>${esc(L.dayOf(L.now(new Date(m.t))).slice(5))}</small></div>`).join('')
      + `</div>` : '<div class="fi-sub">どのノート・日記・メモからも、使われていません</div>');
    $('#fi-use').onclick = e => {
      const n = e.target.closest('[data-un]'), d = e.target.closest('[data-ud]'), m = e.target.closest('[data-um]');
      if (n) { const [s, id] = n.dataset.un.split('|'); close(); openNote(s, id); }
      else if (d) { const [date, kind] = d.dataset.ud.split('|'); close(); openDiary(date, false, kind); }
    };
  }
  $('#fi-del').onclick = async () => {
    const used = fileUsedCount(name);
    if (!confirm(`「${f.orig}」を削除しますか？\n（ごみ箱の .trash に移ります。${used ? `⚠️ ${used} 件のノート・日記・メモで使われていて、そのリンクは見つからなくなります` : 'どこからも使われていません'}）`)) return;
    const ok = await api.deleteFile(name); close();
    toast(ok ? `「${f.orig}」を削除しました（.trash に移しました）` : '削除できませんでした');
  };
  $('#fi-ins').onclick = () => {
    const view = lastView; if (!view || !view.dom.isConnected || !cur || !['note', 'diary'].includes(cur.k)) return toast('先にノートを開いてください');
    const h = view.state.selection.main.head, t = ($('#fi-t').value || f.orig).replace(/[\[\]]/g, ''), md = PIC.test(name) ? `![${t}](${encRel(name)})` : `[${t}](${encRel(name)})`;
    close(); view.dispatch({ changes: { from: h, insert: md }, selection: { anchor: h + md.length } }); view.focus();
  };
}
const sortBar = (diary) => `<div class="sortbar">${diary ? '<span class="sub">日付順</span>' : `<select id="sb-by" title="並べ替え"><option value="fz"${sortBy === 'fz' ? ' selected' : ''}>番号順</option><option value="created"${sortBy === 'created' ? ' selected' : ''}>作成順</option><option value="updated"${sortBy === 'updated' ? ' selected' : ''}>更新順</option></select>`}<button id="sb-dir" class="mini" data-diary="${diary ? 1 : ''}" title="${(diary ? diarySortDir : sortDir) === 'asc' ? '昇順（押すと降順）' : '降順（押すと昇順）'}">${(diary ? diarySortDir : sortDir) === 'asc' ? '↑' : '↓'}</button>${diary ? '' : '<button id="sb-loc" class="mini" title="いま開いているノートへ飛ぶ (o)">◎</button>'}</div>`;
// 並べ替え。IDなし（未整理）は folgezettel が無いので、作成日順
function sortNotes(list, tab) {
  const by = tab === 'u' && sortBy === 'fz' ? 'created' : sortBy, sg = sortDir === 'asc' ? 1 : -1;
  const key = n => by === 'fz' ? null : by === 'updated' ? (n.updated || n.created || '') : (n.created || '');
  return list.slice().sort((a, b) => sg * (by === 'fz' ? L.cmpId(a.id, b.id) : key(a).localeCompare(key(b)) || L.cmpId(a.id, b.id)));
}
const SORT_ICON = { fz: '🔢', created: '🕒', updated: '✏️' }, SORT_NAME = { fz: '番号順', created: '作成順', updated: '更新順' };
function drawSortBtns() {   // 検索欄の右: 並び順（押すと 番号→作成→更新）と、昇順・降順。日記・メモ帳・時系列記録の並びと、ふつうのノートの並びは、別々に覚える
  const k = $('#sort-key'), d = $('#sort-dir'); if (!k || !d) return;
  const dm = mode === 'diary', dir = dm ? diarySortDir : sortDir;
  k.textContent = dm ? '📅' : (SORT_ICON[sortBy] || '🔢'); k.title = dm ? '日記・メモ帳・時系列記録は、日付順です' : `並び順: ${SORT_NAME[sortBy] || ''}（押すと切り替え）`; k.classList.toggle('dim', dm);
  d.textContent = dir === 'asc' ? '⬆️' : '⬇️'; d.title = (dm ? '日記・メモ帳・時系列記録の並び: ' : 'ノートの並び: ') + (dir === 'asc' ? '昇順（押すと降順）' : '降順（押すと昇順）');
}
$('#sort-key').onclick = () => { if (mode === 'diary') return; const o = ['fz', 'created', 'updated']; sortBy = o[(o.indexOf(sortBy) + 1) % o.length]; savePrefs(); renderList(); };
$('#sort-dir').onclick = () => { if (mode === 'diary') diarySortDir = diarySortDir === 'asc' ? 'desc' : 'asc'; else sortDir = sortDir === 'asc' ? 'desc' : 'asc'; savePrefs(); renderList(); };
function renderList() {
  drawSortBtns();
  if (paperOnly && (tab === 'd' || tab === 'u')) tab = 'p';
  document.querySelectorAll('#tabs button').forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.style.display = paperOnly && (b.dataset.tab === 'd' || b.dataset.tab === 'u') ? 'none' : ''; });
  document.querySelectorAll('#rail button').forEach(b => b.classList.toggle('on', !!b.dataset.mode && b.dataset.mode === mode));
  $('#paperonly').classList.toggle('on', paperOnly);
  const q = $('#q').value.trim().toLowerCase(), out = []; searchQ = $('#q').value.trim();   // 演算子の OR / NOT は大文字で書くので、検索語は、小文字にする前の形で渡す
  const qm = q ? Q.matcher(searchQ) : null;   // 検索の書き方（演算子）も使える
  const nf = n => ({ id: n.id, s: n.s, noid: n.noid, title: n.title || '', body: Stamp.strip(n.body || ''), kw: n.keywords || [], readings: (n.keywords || []).map(k => readings[k] || '').join(' '), created: n.created, updated: n.updated });
  $('#tabs').style.display = mode === 'notes' || q ? '' : 'none';
  if (!q && mode === 'diary') { $('#list').innerHTML = diaryList(); renderSelbar(); return; }
  if (q) {
    // 1. Index  2. 索引  3. ノート
    const rank = k => (k.toLowerCase() === q ? 0 : k.toLowerCase().startsWith(q) ? 1 : 2);
    const hq = L.toHira(q), rk = k => Math.min(rank(k), readings[k] ? rank(readings[k]) : 9);
    const kwf = k => ({ id: '', s: 'd', noid: true, title: k, body: '', kw: [k], readings: readings[k] || '', created: '' });
    const gi = globalIndex().filter(([k]) => qm(kwf(k)) || (!/\s|[()|"]/.test(q) && (readings[k] || '').includes(hq))).sort((a, b) => rk(a[0]) - rk(b[0]));
    if (gi.length) out.push('<h4>Index</h4>', ...gi.map(ixRow));
    const ti = [];
    for (const t of topics.filter(topicVisible)) {
      if (qm({ id: '', s: 'd', noid: true, title: t.name, body: '', kw: [], readings: '', created: '' })) ti.push([-1, `<div class="ix">${tchip(t.name)}</div>`]);
      for (const r of paperRows(L.mergeTopic(t).rows)) if (qm(kwf(r.kw))) ti.push([rank(r.kw), `<div class="ix"><b>${esc(r.kw)}</b> ${chips(r)} <small>← ${tchip(t.name)}</small></div>`]);
    }
    if (ti.length) out.push('<h4>索引</h4>', ...ti.sort((a, b) => a[0] - b[0]).map(x => x[1]));
    const hit = sortNotes(notes.filter(n => isVisS(n.s) && qm(nf(n))), 'd');   // 並べ替え（番号・作成・更新 × 昇降）は、ノートの部分だけ
    if (hit.length) out.push('<h4>ノート</h4>', ...hit.map(n => noteRow(n, true, searchQ)));
    const fh = filesCache.filter(f => qm({ id: '', s: 'd', noid: true, title: f.title || '', body: [f.desc, f.orig, f.name].join('\n'), kw: [], readings: '', created: '' }));
    if (fh.length) out.push('<h4>ファイル</h4>', ...fh.map(f => fileRow(f, searchQ)));
    const dh = diaries.filter(d => qm({ id: '', s: 'd', noid: true, title: [d.date, d.title].join(' '), body: Stamp.strip(d.body), kw: [], readings: '', created: d.date, updated: d.date })).sort((a, b) => b.date.localeCompare(a.date));
    if (dh.length) out.push('<h4>日記</h4>', ...dh.map(d => `<div class="item note" data-diary="${d.date}" data-kind="${esc(d.kind || '日記')}"><div class="nrow"><div class="nt">${mk(d.title || d.date, searchQ)}</div><div class="ns">${esc(d.kind || '日記')} · ${d.date}</div>${snippet(d.body, searchQ) ? `<div class="sn">${snippet(d.body, searchQ)}</div>` : ''}</div></div>`));
    if (!out.length) out.push('<div class="none">見つかりません</div>');
  } else if (tab === 'f') {
    refreshFiles();
    const fl = filesCache.filter(f => fileFilter === 'all' || !f.title);
    out.push(`<div class="sortbar"><select id="ff-sel"><option value="all"${fileFilter === 'all' ? ' selected' : ''}>すべて（${filesCache.length}）</option><option value="untitled"${fileFilter === 'untitled' ? ' selected' : ''}>タイトルなし（${filesCache.filter(f => !f.title).length}）</option></select><span class="grow"></span><button class="mini" id="ff-add" title="ファイルを取り込む">＋ 取り込む</button></div>`);
    out.push(...fl.map(f => fileRow(f)));   // map にそのまま渡すと、行の番号が検索語の欄に入って落ちる
    if (!fl.length) out.push(`<div class="none">${fileFilter === 'untitled' ? 'タイトルのないファイルはありません' : '取り込んだ画像・html・csv などが、ここに並びます。ノートにドラッグしても取り込めます'}</div>`);
  } else if (tab === 'i') {
    // Index: グローバルIndex（キーワードの一覧）
    out.push(`<div class="grpbar"><button id="ix-add" class="tbtn" title="${paperOnly ? '新しい紙のキーワードを作る' : '新しいデジタルのキーワードを作る'}">＋</button></div>`);
    {
      let row = null;
      for (const e of globalIndex()) {
        const r = L.kanaRow(readingOf(e[0]));
        if (r !== row) { out.push(`<h4>${r}</h4>`); row = r; }
        out.push(ixRow(e));
      }
      if (out.length === 1) out.push(`<div class="none">${paperOnly ? '紙のキーワードはまだありません。右上の＋で作ります' : 'ノートにキーワードを書くと、ここに並びます。右上の＋でも作れます'}</div>`);
    }
  } else {
    const list = sortNotes((tab === 'u' ? notes.filter(n => n.noid) : notes.filter(n => n.s === tab && !n.noid)), tab);
    const byFz = sortBy === 'fz' && tab !== 'u';
    if (byFz && (tab === 'd' || tab === 'p')) for (const t of topics.filter(x => (!x.entry || !get(x.entry.s, x.entry.id)) && (x.entry ? x.entry.s : 'd') === tab).sort((a, b) => a.name.localeCompare(b.name, 'ja'))) out.push(topicRow(t)); // 親のノートがまだないもの（取り込み前の紙の番号など）は、その側の先頭
    for (const n of list) {
      if (byFz && foldIds.size && fzHidden(n)) continue;   // たたまれた親の下は、出さない
      if (byFz) for (const t of topicsOf(n.s, n.id).filter(topicVisible)) out.push(topicRow(t)); // 「1-1」「1-2」は、ノート 1 の手前
      out.push(noteRow(n));
    }
    if (!list.length) out.push(`<div class="none">${tab === 'p' ? '「📷 スキャン取り込み」で紙を入れます' : tab === 'u' ? 'IDなしで書いたノートが、ここに並びます。あとでIDを付けて整理します' : '「＋ 新規」で書き始めます'}</div>`);
  }
  const keep = tab === 'i' && $('#pi') ? ['pi-kw', 'pi-rd', 'pi-ids'].map(i => [i, $('#' + i).value, document.activeElement && document.activeElement.id === i]) : [];
  $('#list').innerHTML = out.join('');
  for (const [i, v, f] of keep) { const el = $('#' + i); if (el) { el.value = v; if (v) el.dataset.touched = i === 'pi-rd' ? '1' : ''; if (f) el.focus(); } }
  renderSelbar();
}
// Ctrl+クリック・中クリックは新しいタブで開く
// 中クリックは、貼り付けも自動スクロールもしない（Linux の中クリック貼り付けをやめる）。リンクは背景の新しいタブで開く
document.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); } newTab = e.ctrlKey || e.metaKey; }, true);
document.addEventListener('mouseup', e => { if (e.button === 1) e.preventDefault(); }, true);
document.addEventListener('paste', e => { if (e.__mid) e.preventDefault(); }, true);
// 戻る・進む: ボタン、Ctrl+, / Ctrl+.、マウスの戻る/進むボタン
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === ',' || e.key === '.') && $('#modal').style.display !== 'flex') { e.preventDefault(); go(e.key === ',' ? -1 : 1); } });
document.addEventListener('mouseup', e => { if (e.button === 3) { e.preventDefault(); go(-1); } if (e.button === 4) { e.preventDefault(); go(1); } });
function onOpenClick(e) {
  if (e.target.closest('#modal') || e.target.closest('#selbar')) return;
  const dd = e.target.closest('[data-diary]'); if (dd && !e.target.closest('.cm-editor')) return openDiary(dd.dataset.diary, undefined, dd.dataset.kind || '日記');
  const row = e.target.closest('#list .item');
  if (selMode && row) { if (row.matches('.note[data-s][data-id]')) togglePick(row, e.shiftKey); return; }
  if (e.target.closest('#ix-add')) return newIndexDialog();
  const t = e.target.closest('[data-topic]'); if (t) return openTopic(t.dataset.topic, 'view', false, cur && cur.k === 'note' ? { s: cur.s, id: cur.id } : null);
  const n = e.target.closest('[data-id][data-s]');
  if (n && !e.target.closest('.cm-editor')) {
    // IDを押すと、そのIDの索引へ。1つなら、そこへ。複数なら、一覧の画面へ（索引が無いIDは、ノートへ）
    const ts = (n.classList.contains('chip') || n.dataset.chipish) && !n.dataset.n && !n.dataset.note ? topicsOf(n.dataset.s, n.dataset.id) : [];
    if (ts.length === 1 && !(cur && cur.k === 'topic' && cur.name === ts[0].name)) return openTopic(ts[0].name);
    if (ts.length > 1) return openTopicList(n.dataset.s, n.dataset.id);
    if (get(n.dataset.s, n.dataset.id)) openNote(n.dataset.s, n.dataset.id, n.dataset.n || undefined);
    else if (confirm(`${SP[n.dataset.s]} ${n.dataset.id} はまだありません。作りますか？`)) create(n.dataset.s, n.dataset.id);
  }
}
document.addEventListener('click', e => {
  const f = e.target.closest('.fzf'); if (!f) return;
  e.preventDefault(); e.stopPropagation();
  const k = f.dataset.fold; if (foldIds.has(k)) foldIds.delete(k); else foldIds.add(k);
  saveFold(); renderList();
}, true);
document.addEventListener('click', onOpenClick);
$('#paperonly').onclick = () => { paperOnly = !paperOnly; savePrefs(); toast(paperOnly ? '紙だけ表示' : 'すべて表示'); if (cur && cur.k === 'topic') openTopic(cur.name, cur.mode, true); else renderList(); };
// 🗒️ メモ帳: 日記と同じ、1日ごとの記録。ボタンを押すと、今日のメモ帳がすぐ開く
// 📔: 今日の日記をすぐ開く
async function openTodayDiary() {
  setKind('日記'); mode = 'diary'; $('#q').value = ''; renderList(); await openDiary(L.todayStr(), false, '日記');
  setTimeout(() => { if (lastView && lastView.dom.isConnected) lastView.focus(); }, 60);
}
async function openMemoPad() {
  const NAME = 'メモ帳';   // いつもある時系列記録
  setKind(NAME); mode = 'diary'; $('#q').value = ''; renderList(); await openDiary(L.todayStr(), false, NAME);
  setTimeout(() => { if (lastView && lastView.dom.isConnected) lastView.focus(); }, 60);
}
$('#rail').onclick = e => { const b = e.target.closest('button'); if (b && b.id === 'settings-btn') return settingsDialog(); if (b && b.id === 'memopad') return openMemoPad(); if (b && b.dataset.mode === 'diary') return openTodayDiary(); if (b) { mode = b.dataset.mode; $('#q').value = ''; renderList(); } };
document.addEventListener('auxclick', e => { if (e.button === 1 && !e.target.closest('#tabbar')) { bgOpen = true; try { onOpenClick(e); } finally { setTimeout(() => { bgOpen = false; renderTabs(); }, 0); } } });
// 一覧から索引の欄へドラッグすると ID が入る
$('#list').addEventListener('click', e => {
  const fr = e.target.closest('[data-file]'); if (fr) return fileDialog(fr.dataset.file);
  if (e.target.closest('#ff-add')) return pick(true, f => attach(null, f), '*');
  if (e.target.closest('#sb-loc')) return locateCur();
  { const sd = e.target.closest('#sb-dir'); if (sd) { if (sd.dataset.diary) diarySortDir = diarySortDir === 'asc' ? 'desc' : 'asc'; else sortDir = sortDir === 'asc' ? 'desc' : 'asc'; savePrefs(); return renderList(); } }
});
$('#list').addEventListener('dragstart', e => { const n = e.target.closest('[data-id]'); if (n) e.dataTransfer.setData('text/plain', n.dataset.id); });
$('#list').addEventListener('change', e => { if (e.target.id === 'ff-sel') { fileFilter = e.target.value; renderList(); } });
$('#list').addEventListener('change', e => { if (e.target.id === 'sb-by') { sortBy = e.target.value; savePrefs(); renderList(); } });
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) { tab = b.dataset.tab; $('#q').value = ''; renderList(); } };
$('#q').oninput = renderList;
$('#q').onkeydown = e => { if (e.key === 'Escape') { $('#q').value = ''; $('#q').blur(); renderList(); if (lastView && cur && cur.k === 'note') lastView.focus(); searchMark(); } };
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || $('#modal').style.display === 'flex' || $('#scan').style.display === 'flex') return;
  if ((e.key === 'f' || e.key === 'F') && !e.defaultPrevented) { e.preventDefault(); $('#q').focus(); $('#q').select(); }   // Ctrl+F: 左の検索
  if ((e.key === 'e' || e.key === 'E') && !e.shiftKey && !e.defaultPrevented) { e.preventDefault(); if (lastView && lastView.dom.isConnected) openSearchPanel(lastView); }   // Ctrl+E: 今のページの中の検索・置換
  if ((e.key === 'j' || e.key === 'J') && !e.shiftKey && !e.altKey) { e.preventDefault(); toggleFoldAll(); return; }   // Ctrl+J: 左の一覧の Folgezettel の折りたたみを、全部たたむ／全部ひらく
  if (e.key === 'w') { e.preventDefault(); closeTab(active); }
  if (e.key === 't') { e.preventDefault(); tabs.push({ k: 'empty' }); show(tabs.length - 1); }
  if (e.key === 'Tab' && tabs.length) { e.preventDefault(); show((active + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length); }
});
// Ctrl+D（Diary）: どこからでも、今日の日記を開く。キーの位置で見るので、日本語入力がオンでも効く
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.code !== 'KeyD') return;
  if ($('#modal').style.display === 'flex' || $('#scan').style.display === 'flex') return;
  e.preventDefault(); e.stopImmediatePropagation(); openTodayDiary();
}, true);
// ===== 左の一覧のキー操作（文字を入力していないとき）=====
// ↓/j ↑/k: 次・前のノート  ←/h: 親  →/l: 子  [ ]: 前・次の兄弟  Enter: そのノートに決める（書き始める）  o: 探し始めたノートに戻る  Esc: 一覧の操作をやめる
// 動かすと右のノートも切り替わる（プレビュー。履歴は増えない）
// 今のタブを、履歴を増やさずに別のノート・トピックに差し替える（プレビュー）
let inPreview = false;
function swapTab(t) { const o = tabs[active]; if (o) tabs[active] = { ...t, back: o.back, fwd: o.fwd }; }
function kbMove(to) {
  if (!to) return;
  if (!decided && cur && (cur.k === 'note' || cur.k === 'topic')) decided = cur.k === 'note' ? { k: 'note', s: cur.s, id: cur.id } : { k: 'topic', name: cur.name };
  inPreview = true;
  try {
    if (to.dataset.topic && !to.dataset.id) { swapTab({ k: 'topic', name: to.dataset.topic, mode: 'view' }); openTopic(to.dataset.topic, 'view', true); }
    else { swapTab({ k: 'note', s: to.dataset.s, id: to.dataset.id }); openNote(to.dataset.s, to.dataset.id, null, true); }
  } finally { inPreview = false; }
  centerOn();
}
// 左の一覧を、いま開いているノート（索引 なら、その行）へ飛ばす
function locateCur() {
  if (!cur) return;
  if (cur.k === 'note') { const n = get(cur.s, cur.id); if (n) tab = n.noid ? 'u' : n.s; }
  else if (cur.k === 'topic') { const t = topics.find(x => x.name === cur.name); if (t && t.entry && get(t.entry.s, t.entry.id)) tab = t.entry.s; }
  else return;
  mode = 'notes'; $('#q').value = ''; renderList(); centerOn();
}
// 見ているノートを、一覧の真ん中に
function centerOn(sel = '#list .item.on') { const on = document.querySelector(sel) || document.querySelector('#list .item.on'); if (on) on.scrollIntoView({ block: 'nearest' }); }   // 見えているなら動かさない。隠れているときだけ、見える所まで
// 決めたノート（Enter で決めた・クリックして開いた）。o で、ここへ戻る。一覧では黄色の背景で示す
let decided = null;
const isDecided = (s_, id) => decided && decided.k === 'note' && decided.s === s_ && decided.id === id;
// 一覧の行（ノートと索引）の並びと、それぞれの親（番号）。索引 は親のノートと同じ階層（その手前）
function listRows() {
  return [...document.querySelectorAll('#list .item.note[data-id][data-s], #list .item.topicrow')].filter(x => !x.classList.contains('chip')).map(el => {
    if (el.dataset.topic && !el.dataset.id) { const t = topics.find(x => x.name === el.dataset.topic), e = t && t.entry; return { el, topic: t, par: e ? L.parentIn(e.id, x => !!get(e.s, x)) : null, s: e ? e.s : 'd' }; }
    const n = get(el.dataset.s, el.dataset.id); return { el, note: n, par: n && !n.noid ? L.parentIn(n.id, x => !!get(n.s, x)) : null, s: el.dataset.s };
  });
}
// ↑ ↓: 索引 も含めて、見えている順に　← : ノート→その索引→親　→ : 索引→ノート→子　[ ]: 同じ親の下の行（索引 も含む）　u: 上位のIndex
function kbNav(k) {
  const rows = listRows(), here = cur && cur.k === 'note' ? rows.findIndex(r => r.note && r.note.s === cur.s && r.note.id === cur.id) : cur && cur.k === 'topic' ? rows.findIndex(r => r.topic && r.topic.name === cur.name) : -1;
  const go = r => r && kbMove(r.el);
  const goNote = n => n && kbMove({ dataset: { s: n.s, id: n.id } });
  const goTopic = t => t && kbMove({ dataset: { topic: t.name } });
  if (k === 'ArrowDown' || k === 'j') return go(rows[Math.min(rows.length - 1, here + 1)]);
  if (k === 'ArrowUp' || k === 'k') return go(rows[Math.max(0, here < 0 ? 0 : here - 1)]);
  const r = rows[here]; if (!r) return;
  const base = r.note || (r.topic && r.topic.entry && get(r.topic.entry.s, r.topic.entry.id));
  if (!base || base.noid) return;
  const has = x => !!get(base.s, x), all = notes.filter(n => n.s === base.s && !n.noid).map(n => n.id).sort(L.cmpId), byId = id => id && get(base.s, id);
  if (k === 'ArrowLeft' || k === 'h') { if (r.topic) return goNote(byId(L.parentIn(base.id, has))); const t = topicOf(base.s, base.id); return t ? goTopic(t) : goNote(byId(L.parentIn(base.id, has))); }
  if (k === 'ArrowRight' || k === 'l') return r.topic ? goNote(base) : goNote(byId(all.find(x => L.parentIn(x, has) === base.id)));
  if (k === '[' || k === ']') { const sib = rows.filter(x => x.s === r.s && x.par === r.par && (x.note ? !x.note.noid : true)), at = sib.indexOf(r); return go(sib[at + (k === ']' ? 1 : -1)]); }
  if (k === 'u') { // 自分の番号の祖先をたどって、いちばん近い「親になっている索引」へ（自分が親なら自分の Index。索引 からは、さらに上位へ）
    let id = r.topic ? L.parentIn(base.id, has) : base.id;
    for (; id; id = L.parentIn(id, has)) { const t = topicOf(base.s, id); if (t && !(r.topic && t === r.topic)) return goTopic(t); }
    toast('上位のIndexはありません');
  }
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || $('#modal').style.display === 'flex' || $('#idpop')) return;
  const ae = document.activeElement, editing = ae && (/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) || ae.isContentEditable);
  if (editing) { if (e.key === 'Escape' && ae.closest && ae.closest('.cm-editor')) { ae.blur(); e.preventDefault(); } return; }   // Esc で書く状態から抜けると、キー操作が使える
  const k = e.key;
  if (k === 'Backspace' && !$('#q').value) { e.preventDefault(); go(-1); const off = () => { const a = document.activeElement; if (a && a !== document.body && (a.closest('.cm-editor') || /^(INPUT|TEXTAREA)$/.test(a.tagName))) a.blur(); }; off(); setTimeout(off, 0); setTimeout(off, 80); return; }   // 戻っても入力状態にならない（続けて Backspace で戻れる）   // 前に開いていたものへ（戻るボタンと同じ）
  if (k === 'o' && !decided && cur && ['note', 'topic'].includes(cur.k)) { e.preventDefault(); return locateCur(); }   // 黄色（決めたもの）が無いときは、いま開いているものを一覧の真ん中に
  if (k === 'i' && cur && cur.k === 'note') { e.preventDefault(); const t = $('#c-in'); return t ? t.focus() : lastView && lastView.dom.isConnected && lastView.focus(); }   // ふつうのノートの本文に入る
  if (mode !== 'notes') return;
  if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'j', 'k', 'h', 'l', '[', ']', 'Enter', 'o', 'u', 'Escape'].includes(k)) return;
  const cn = cur && cur.k === 'note' ? get(cur.s, cur.id) : null;
  if (k === 'Escape') return;
  if (k === 'o') { // 決めたノート（Enter で決めた・開いたもの）へ戻る。一覧の真ん中に
    if (!decided) return; e.preventDefault(); const d = decided;
    if (d.k === 'note' && get(d.s, d.id)) kbMove({ dataset: { s: d.s, id: d.id } }); else if (d.k === 'topic' && topics.find(t => t.name === d.name)) kbMove({ dataset: { topic: d.name } });
    return;
  }
  if (k === 'Enter') { // いま見ているものを「決める」（黄色の印。o で戻る先になる）
    if (!cur || !['note', 'topic'].includes(cur.k)) return; e.preventDefault();
    decided = cur.k === 'note' ? { k: 'note', s: cur.s, id: cur.id } : { k: 'topic', name: cur.name }; renderList(); centerOn();
    if (cn && lastView && lastView.dom.isConnected) lastView.focus(); return;
  }
  if (!cur || !['note', 'topic'].includes(cur.k)) return;   // カードなどを見ているときは、動かさない
  e.preventDefault(); kbNav(k);
});

// ===== 書きながらノートを作る: Ctrl+n（IDなし）/ Ctrl+h（並列）/ Ctrl+b（分岐）/ Ctrl+i（カーソルに :ID を書く）=====
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || $('#modal').style.display === 'flex' || $('#idpop') || $('#scan').style.display === 'flex') return;
  const k = e.key.toLowerCase(); if (!'nhbip'.includes(k) || k.length !== 1) return;
  if (k === 'p') { // Ctrl+P: カーソルに (p)（紙）を書く。:1a のあとで押せば、紙の 1a
    const v = lastView; if (!v || !v.dom.isConnected || !v.hasFocus) return; e.preventDefault(); v.dispatch(v.state.replaceSelection('(p)')); return;
  }
  const ae = document.activeElement, inField = /^(INPUT|TEXTAREA|SELECT)$/.test(ae && ae.tagName) && !(ae.closest && ae.closest('#pane'));   // 作った直後のタイトル欄からも続けて使える
  if (k === 'n') { e.preventDefault(); return createNoid('text'); }
  if (inField || !cur || cur.k !== 'note') return;
  const n = get(cur.s, cur.id); if (!n) return;
  e.preventDefault();
  if (n.noid) return toast('IDなしのノートです。先にIDを付けると、並列・分岐が使えます');
  if (k === 'h') return create(n.s, free(n.s, L.sibling(n.id)));
  if (k === 'b') return create(n.s, free(n.s, L.child(n.id)));
  if (k === 'i') return idPopup(n);
}, true);
// カーソルのところに小さなポップを出し、矢印キー（か b / h）で分岐・並列を選ぶ。選ぶと、その場に :ID を書く（ノートはリンクを押したとき作る）
function idPopup(n) {
  const v = lastView; if (!v || !v.dom.isConnected) return;
  const text = v.state.doc.toString(), used = new Set(L.tokens(text).filter(t => t.k === 'ref').map(t => t.id));
  const freeIn = id => { while (get(n.s, id) || used.has(id)) id = L.sibling(id); return id; };
  const opts = [{ k: 'b', name: '分岐', id: freeIn(L.child(n.id)) }, { k: 'h', name: '並列', id: freeIn(L.sibling(n.id)) }];
  const head = v.state.selection.main.head, c = v.coordsAtPos(head) || v.dom.getBoundingClientRect();
  const pop = document.createElement('div'); pop.id = 'idpop'; let sel = 0;
  const draw = () => { pop.innerHTML = opts.map((o, i) => `<div class="${i === sel ? 'on' : ''}" data-i="${i}"><kbd>${o.k}</kbd> ${o.name} <b>->${esc(o.id)}</b></div>`).join(''); };
  const close = () => { pop.remove(); document.removeEventListener('keydown', key, true); document.removeEventListener('mousedown', out, true); v.focus(); };
  const pick = i => { const o = opts[i], at = v.state.selection.main.head, ins = '->' + o.id; close(); v.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + ins.length } }); };
  const key = ev => {
    ev.preventDefault(); ev.stopPropagation();
    if (ev.key === 'Escape') return close();
    if (ev.key === 'Enter') return pick(sel);
    if (['ArrowDown', 'ArrowRight'].includes(ev.key)) { sel = (sel + 1) % opts.length; return draw(); }
    if (['ArrowUp', 'ArrowLeft'].includes(ev.key)) { sel = (sel + opts.length - 1) % opts.length; return draw(); }
    const i = opts.findIndex(o => o.k === ev.key.toLowerCase()); if (i >= 0) return pick(i);
  };
  const out = ev => { if (!pop.contains(ev.target)) close(); };
  pop.onmousedown = ev => { const d = ev.target.closest('[data-i]'); if (d) { ev.preventDefault(); pick(+d.dataset.i); } };
  draw(); document.body.append(pop);
  pop.style.left = Math.min(c.left, innerWidth - 190) + 'px'; pop.style.top = Math.min((c.bottom || 0) + 4, innerHeight - 90) + 'px';
  document.addEventListener('keydown', key, true); document.addEventListener('mousedown', out, true);
}

// ===== タブ =====
function rememberPos() {
  flush().catch(() => {});
  const t = tabs[active];
  if (t && t.k === 'note' && lastView && lastView.dom.isConnected) t.pos = lastView.state.selection.main.head;
}
// 今のタブに開く（Ctrl+クリックなら新しいタブ）。keep なら今のタブを描き直すだけ
// 履歴: タブごとに「戻る」「進む」を持つ。同じタブで別のページへ移るとき、前のページを積む
const desc = t => { const { back, fwd, pos, ...d } = t; return d; };
function place(t, keep) {
  if (keep && tabs[active]) return tabs[active];
  rememberPos();
  if (bgOpen) { tabs.push(t); newTab = false; return t; }                        // 背景で新しいタブ: 今のページは動かない
  if (newTab || active < 0 || !tabs[active]) { tabs.push(t); active = tabs.length - 1; }
  else {
    const old = tabs[active];
    if (!sameTab(old, t)) { t.back = [...(old.back || []), desc(old)].slice(-60); t.fwd = []; } else { t.back = old.back; t.fwd = old.fwd; }
    tabs[active] = t;
  }
  newTab = false;
  return t;
}
const sameTab = (a, b) => a && b && a.k === b.k && a.s === b.s && a.id === b.id && a.date === b.date && a.topic === b.topic && a.name === b.name;
// 戻る・進む
function go(dir) {
  const t = tabs[active]; if (!t) return;
  const from = dir < 0 ? (t.back || []) : (t.fwd || []); if (!from.length) return;
  rememberPos();
  const target = { ...from[from.length - 1] }, rest = from.slice(0, -1);
  const mine = desc(t);
  target.back = dir < 0 ? rest : [...(t.back || []), mine];
  target.fwd = dir < 0 ? [...(t.fwd || []), mine] : rest;
  tabs[active] = target; show(active);
}
$('#nav-back').onclick = () => go(-1);
$('#nav-fwd').onclick = () => go(1);
function renderNav() {
  const t = tabs[active], b = $('#nav-back'), f = $('#nav-fwd'); if (!b) return;
  b.disabled = !(t && (t.back || []).length); f.disabled = !(t && (t.fwd || []).length);
}
function show(i) {
  rememberPos();
  active = Math.max(-1, Math.min(i, tabs.length - 1));
  const t = tabs[active];
  if (!t || t.k === 'empty') { cur = t || null; $('#pane').innerHTML = '<div class="none">左から選ぶか、「＋ 新規」で書き始めます。<br>Ctrl+クリックで新しいタブに開きます。</div>'; renderTabs(); return renderList(); }
  if (t.k === 'note') openNote(t.s, t.id, null, true); else if (t.k === 'diary') openDiary(t.date, true, t.kind); else if (t.k === 'export') openExport(t, true); else if (t.k === 'similar') openSimilar(t.base, true); else if (t.k === 'tlist') openTopicList(t.s, t.id, true); else openTopic(t.name, t.mode, true);
}
function closeTab(i) {
  if (i < 0 || i >= tabs.length) return;
  if (i === active) rememberPos();
  tabs.splice(i, 1);
  if (active > i || active >= tabs.length) active--;
  show(active < 0 && tabs.length ? 0 : active);
}
const tabLabel = t => t.k === 'note' ? (n => `${n && icon(n) ? icon(n) + ' ' : ''}${n ? esc(titleOf(n).slice(0, 16)) : esc(t.id)}<small>${n && n.noid ? 'IDなし' : (t.s === 'p' ? '紙 ' : '') + esc(t.id)}</small>`)(get(t.s, t.id))
  : t.k === 'topic' ? `📑 ${esc(t.name)}` : t.k === 'diary' ? `📔 ${esc(t.date.slice(5))}${t.kind && t.kind !== '日記' ? ' <small>' + esc(t.kind) + '</small>' : ''}` : t.k === 'similar' ? '🔍 類似' : t.k === 'tlist' ? `📑 ${esc(t.id)}` : t.k === 'export' ? '📤 エクスポート' : '新しいタブ';
function renderTabs() {
  drawIdBar();
  $('#tabbar').innerHTML = tabs.map((t, i) => `<div class="tab${i === active ? ' on' : ''}" data-ti="${i}"><span>${tabLabel(t)}</span><b class="x" data-close="${i}" title="閉じる (Ctrl+W)">×</b></div>`).join('')
    + '<button class="tab-new" title="新しいタブ (Ctrl+T)">＋</button>';
  renderNav();
  syncStampToggle();
  try { localStorage.setItem('pkm-tabs:' + vault, JSON.stringify({ tabs: tabs.map(t => ({ ...desc(t), pos: t.pos })), active })); } catch { }
}
$('#tabbar').addEventListener('click', e => {
  const x = e.target.closest('[data-close]'); if (x) return closeTab(+x.dataset.close);
  if (e.target.closest('.tab-new')) { tabs.push({ k: 'empty' }); return show(tabs.length - 1); }
  const t = e.target.closest('[data-ti]'); if (t) show(+t.dataset.ti);
});
// タブの上でホイールを回すと、前後のタブに切り替わる
let wheelAt = 0;
$('#tabbar').addEventListener('wheel', e => {
  if (tabs.length < 2) return; e.preventDefault();
  const now = Date.now(); if (now - wheelAt < 120) return; wheelAt = now;
  const d = (e.deltaY || e.deltaX) > 0 ? 1 : -1, n = Math.max(0, Math.min(tabs.length - 1, active + d));
  if (n !== active) show(n);
}, { passive: false });
// 戻る・進むを、ホイールクリック（中クリック）すると、そのページを新しいタブで開く（今のタブは動かない）
function goNewTab(dir) {
  const t = tabs[active]; if (!t) return;
  const from = dir < 0 ? (t.back || []) : (t.fwd || []); if (!from.length) return;
  const target = { ...from[from.length - 1], back: [], fwd: [] };
  rememberPos(); tabs.push(target); show(tabs.length - 1);
}
for (const [id, dir] of [['#nav-back', -1], ['#nav-fwd', 1]]) {
  $(id).addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  $(id).addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); e.stopPropagation(); goNewTab(dir); } });
}
$('#tabbar').addEventListener('auxclick', e => { const t = e.target.closest('[data-ti]'); if (t && e.button === 1) closeTab(+t.dataset.ti); });

// ===== ノート =====
function openNote(s, id, n, keep, mid) {
  const note = get(s, id); if (!note) return;
  if (bgOpen) { place({ k: 'note', s, id }, false); return; }
  cur = place({ k: 'note', s, id }, keep); mode = 'notes'; lastNote = { s, id };
  if (!inPreview) decided = { k: 'note', s, id };
  if (!$('#q').value) tab = note.noid ? 'u' : s;
  const kind = note.kind || 'text', noid = !!note.noid, text = kind === 'text';
  $('#pane').innerHTML = `
    <div class="stage"><div class="col${s === 'p' || !text ? ' wide' : ''}">
      <div class="idline">
        ${noid ? '<span class="idin" id="f-id">IDなし</span>' : `<button class="idin" id="f-id" data-act="copyid" data-user title="IDをコピー" aria-label="ID ${esc(id)} をコピー">${esc(id)}</button>`}
        ${s === 'd' && noid ? '<button class="gid" data-act="giveid" title="IDをつける" aria-label="IDをつける">🆔</button>' : ''}
        ${s === 'p' ? '<span class="dt">紙</span>' : ''}${L.KINDS[kind] ? `<span class="dt">${L.KINDS[kind]}</span>` : ''}
        ${s === 'd' ? `<span class="dt">${esc(note.created)}</span>` : ''}
        ${'<span class="grow"></span>'}${noid ? (s === 'd' && text ? '<button class="nb" data-act="sib" title="IDなしのまま、並列のノートを作る（親にIDが付くと、IDも決まる）" aria-label="並列">↔️</button><button class="nb" data-act="chi" title="IDなしのまま、分岐のノートを作る（このノートにIDが付くと、IDも決まる）" aria-label="分岐">🌱</button>' : '') : `<button class="nb" data-act="sib" title="並列のノートを作る（同じ階層の次: ${esc(free(s, L.sibling(id)))}）" aria-label="並列">↔️ <small>${esc(free(s, L.sibling(id)))}</small></button><button class="nb" data-act="chi" title="分岐のノートを作る（一つ下: ${esc(free(s, L.child(id)))}）" aria-label="分岐">🌱 <small>${esc(free(s, L.child(id)))}</small></button>`}<button class="ic nm" data-act="mgn" title="右の欄を隠す・出す (Ctrl+\\)"><svg class="ico" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg></button><button class="ic nm" data-act="nmenu" title="このノートのメニュー">${'<svg class="ico" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>'}</button>
      </div>
      <textarea class="ntitle" id="f-title" rows="1" placeholder="タイトル" spellcheck="false">${esc(note.title || '')}</textarea>
      ${!text ? '<div id="nbody"></div>' : s === 'p' ? `<div class="paper"><div class="pic">${note.image ? `<img src="${note.image}">` : '<button data-act="img">画像を入れる</button>'}</div><div class="ed" id="ed"></div></div>` : '<div class="ed" id="ed"></div>'}
    </div><aside class="mgn" id="margin"></aside></div>`;
  applyMgn();
  renderMeta(note);
  const titleField = $('#f-title');
  const growTitle = () => { titleField.style.height = 'auto'; titleField.style.height = Math.max(1, titleField.scrollHeight) + 'px'; };
  growTitle();
  titleField.oninput = e => { // 長いタイトルは折り返し、全文が見える高さに自動調整
    growTitle();
    note.title = e.target.value; if (note.data) note.data.title = note.title || note.data.title;
    if (!text) note.body = L.deriveBody(kind, note.data);
    saveNote(note); renderList(); renderTabs();
  };
  titleField.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) { e.preventDefault(); if (lastView && lastView.dom.isConnected) { lastView.focus(); lastView.dispatch({ selection: { anchor: 0 } }); } } };
  autoFold(note);
  renderTabs(); renderList(); if (!$('#q').value) centerOn();   // タブの移動・リンクで開いたときも、見ているノートが一覧の真ん中に（同じタブにあるとき。検索中は動かさない）
  if (!text) { // 今は扱わない種類（旧なりきり・キャンバス・メモのノート）: 書いてある文字だけを読み取り専用で見せる
    $('#nbody').innerHTML = '<div class="sub">この種類のノートは、いまは編集できません。</div><pre class="legacy-body"></pre>';
    $('#nbody').querySelector('pre').textContent = note.body || '';
    return;
  }
  const view = editor($('#ed'), note.body, 'note', s, v => { note.body = v; saveNote(note); renderList(); },
    s === 'p' ? '紙の内容を文字で（テキスト化）' : '本文。続き ->1a1　元 1a->　位置 (1)　別ノートの位置 ->1a(1)', () => note.body);
  searchMark();
  const hitAt = searchQ ? (m => Number.isFinite(m) ? m : -1)(Math.min(...qTerms(searchQ).map(t => note.body.toLowerCase().indexOf(t.toLowerCase())).filter(i => i >= 0), Infinity)) : -1;
  if (n) { const p = L.anchorPos(note.body, n); if (p >= 0) jump(view, p); }
  else if (hitAt >= 0) view.dispatch({ effects: EditorView.scrollIntoView(hitAt, { y: 'center' }) }); // 検索から開いたら、最初の一致の所へ
  else if (keep && cur.pos != null) jump(view, Math.min(cur.pos, view.state.doc.length));
  else if (focusNewBody && s === 'd' && !note.body) view.focus(); // 作ったばかりのノートだけ、本文にカーソルを置く（移動で開いた、空のノートでは、勝手に入らない）
  focusNewBody = false;
}
// ノートにIDを付ける・変える（ファイル名が変わり、日記のリンクなども直る）
async function changeId(note, v) {
  if (!L.isId(v) || get(note.s, v)) return false;
  await flush(); await api.saveNote(pubNote(note));
  const old = note.id, r = await api.rename(note.s, old, v);
  if (!r) return false;
  Object.assign(note, r, { body: r.body });
  for (const t of topics) if (t.entry && t.entry.s === note.s && t.entry.id === old) t.entry.id = v;
  for (const t of tabs) if (t.k === 'note' && t.s === note.s && t.id === old) t.id = v;
  if (L.isNoid(old) && notes.some(x => x.parentStem === note.stem)) {   // IDなしだった親に ID が付いて、分岐していた子にも ID が付いた
    const st = await api.state(); applyState(st);
    for (const t of tabs) if (t.k === 'note' && t.s === 'd' && L.isNoid(t.id)) { const nn = notes.find(x => x.stem === t.id); if (nn) t.id = nn.id; }
  }
  await refreshDiaries(); openNote(note.s, v, null, true); return true;
}
// ===== 類似検索（右クリック → 類似検索 ／ 複数選択 → 🔍）=====
// 選んだノート（1つ以上）に似たノートを、本文の言葉・キーワード・リンク・索引から探して、度数の高い順に並べる
let simP = null, simSig = '';
function simRows(st, base) {
  const sig = notes.length + ':' + notes.reduce((m, n) => n.updated > m ? n.updated : m, '') + ':' + (aiEmb ? aiEmb.size : 0);
  if (!simP || simSig !== sig) { simP = SM.prepare(notes, { emb: aiEmb }); simSig = sig; }
  const rows = SM.rank(simP, notes.filter(n => isVisS(n.s) || n.noid && !paperOnly), base, { bases: st.bases, multi: st.multi });
  return rows.sort((a, b) => b.total - a.total);
}
function openSimilar(baseKeys, keep) {
  cur = place({ k: 'similar', base: baseKeys }, keep); mode = 'notes';
  cur.st = cur.st || { bases: { ...SM.DEFAULT_ON }, multi: 'avg' };
  drawSimilar(); aiRefresh();
}
// ----- 意味の見方（AI）: 入れる・ノートのベクトルを作る（変わったものだけ）。モデルは main 側（ai-embed.js）
let aiEmb = null;
const aiInfo = { installed: false, busy: '', pct: 0, done: 0, total: 0, err: '' };
const unpackVec = b64 => { const bin = atob(b64), v = new Float32Array(bin.length); let n = 0; for (let i = 0; i < bin.length; i++) { const x = bin.charCodeAt(i); v[i] = (x > 127 ? x - 256 : x) / 127; n += v[i] * v[i]; } n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n; return v; };
function drawAiState() {
  const e = $('#sm-ai'); if (!e) return;
  e.textContent = aiInfo.busy === 'download' ? `🤖 ダウンロード中 ${aiInfo.pct}%` : aiInfo.busy === 'embed' ? `🤖 ノートを読み込み中 ${aiInfo.done}/${aiInfo.total}` : aiInfo.err ? `🤖 ${aiInfo.err}` : '';
}
api.onAiMsg(m => {
  if (m.kind === 'download') aiInfo.pct = m.total ? Math.min(99, Math.round(m.got * 100 / m.total)) : 0;
  else if (m.kind === 'embed') { aiInfo.done = m.done; aiInfo.total = m.total; }
  drawAiState();
});
async function aiRefresh() {
  if (aiInfo.busy) return;
  try { aiInfo.installed = (await api.aiStatus()).installed; } catch { aiInfo.installed = false; }
  if (cur && cur.k === 'similar') drawSimilar();
  if (!aiInfo.installed) return;
  aiInfo.busy = 'embed'; aiInfo.err = ''; aiInfo.done = 0; aiInfo.total = 0; drawAiState();
  const list = notes.map(n => ({ key: n.s + ':' + n.id, text: ((n.title ? n.title + '。' : '') + Stamp.strip(n.body || '')) })).filter(x => x.text.trim());
  let r; try { r = await api.aiVectors(list); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
  aiInfo.busy = '';
  if (!r.ok) { aiInfo.err = r.message || 'AI を動かせませんでした'; drawAiState(); return; }
  aiEmb = new Map(Object.entries(r.vectors).map(([k, b]) => [k, unpackVec(b)]));
  simP = null; if (cur && cur.k === 'similar') drawSimilar();
}
async function aiInstallFlow() {
  if (aiInfo.busy) return;
  if (!confirm('意味の見方（AI）を入れます。\n\n・最初に一度だけ、約 120MB をダウンロードします\n・そのあとは、すべて手元だけで動きます（ノートは外へ出ません）\n・ノートの数によって、最初は 1〜数分かかります（裏で動くので、そのまま使えます）\n\n入れますか？')) return;
  aiInfo.busy = 'download'; aiInfo.pct = 0; aiInfo.err = ''; drawAiState();
  let r; try { r = await api.aiInstall(); } catch (e) { r = { ok: false, message: String(e.message || e) }; }
  aiInfo.busy = '';
  if (!r.ok) { aiInfo.err = r.message || 'ダウンロードできませんでした'; drawAiState(); return; }
  toast('🤖 入れました。ノートを読み込みます'); aiRefresh();
}
const SIM_MULTI = { avg: ['平均', '選んだノートの全体に似ている'], any: ['どれか', 'どれか1つにでも似ている'], all: ['全部', '全部に似ている'] };
function drawSimilar() {
  const st = cur.st, base = cur.base.map(b => get(b.s, b.id)).filter(Boolean);
  if (!base.length) { $('#pane').innerHTML = '<div class="none">基準のノートが見つかりません</div>'; renderTabs(); return; }
  const rows = simRows(st, base);
  const chip = n => `<span class="chip ${n.s}" data-s="${n.s}" data-id="${esc(n.id)}">${esc(n.noid ? 'IDなし' : (n.s === 'p' ? '紙' : '') + n.id)} ${esc(limit(titleOf(n), 14))}</span>`;
  const list = rows.slice(0, 200).map(r => { const n = r.note;
    return `<div class="sm-row item note" data-s="${n.s}" data-id="${esc(n.id)}"><div class="sm-top"><b>${n.noid ? '📥' : (n.s === 'p' ? '📜 ' : '') + esc(n.id)}</b><span class="sm-t">${esc(titleOf(n))}</span><span class="sm-p">${Math.round(r.total * 100)}%</span></div>`
      + `<div class="sm-meter"><i style="width:${Math.round(r.total * 100)}%"></i></div>`
      + `<div class="sm-re">${r.reasons.slice(0, 3).map(x => `<span>${(SM.BASES[x.b] || {}).icon || ''} ${esc(x.t)}</span>`).join('')}</div></div>`; }).join('');
  $('#pane').innerHTML = `<div class="similar"><div class="sm-head"><h2>🔍 類似ノート <small class="sub">${rows.length}件</small></h2>`
    + `<span class="grow"></span><span class="sub" id="sm-ai"></span>${Object.keys(SM.BASES).map(k => `<button class="sm-b${st.bases[k] && (k !== 'ai' || aiInfo.installed) ? ' on' : ''}" data-smb="${k}" title="${SM.BASES[k].name}: ${SM.BASES[k].tip}（${k === 'ai' && !aiInfo.installed ? '入っていません。押すと入れます' : st.bases[k] ? 'オン' : 'オフ'}）">${SM.BASES[k].icon}</button>`).join('')}`
    + (base.length > 1 ? `<button class="sm-b wide" data-smmulti title="${SIM_MULTI[st.multi][1]}（押すと切り替え）">${SIM_MULTI[st.multi][0]}</button>` : '')
    + `</div><div class="sm-base">基準　${base.map(chip).join('')}</div><div class="sm-list">${list || '<div class="none">似たノートは見つかりません</div>'}</div></div>`;
  renderTabs(); renderList();
}
$('#pane').addEventListener('click', e => {
  if (!cur || cur.k !== 'similar') return;
  const b = e.target.closest('[data-smb]'), m = e.target.closest('[data-smmulti]');
  if (b && b.dataset.smb === 'ai' && !aiInfo.installed) { e.stopPropagation(); aiInstallFlow(); }
  else if (b) { cur.st.bases[b.dataset.smb] = !cur.st.bases[b.dataset.smb]; e.stopPropagation(); drawSimilar(); }
  else if (m) { const o = ['avg', 'any', 'all']; cur.st.multi = o[(o.indexOf(cur.st.multi) + 1) % 3]; e.stopPropagation(); drawSimilar(); }
  else if (e.target.closest('.sm-row')) newTab = true;   // 結果を押したら、新しいタブで開く（結果は残す）
}, true);

// ===== IDをつける =====
// 特別な画面は使わず、ふつうの画面でノートを探して、「このノートの子／次」と決める。
// 上に帯が出る: 🆕 新しい番号 ／ 基準にするノートを開くと 🌱 子 ・ ↔️ 次（押したら決定）／ ✖️ やめる
let idPick = null;   // { stem }（付けるノート）
const idSubject = () => idPick && notes.find(n => n.stem === idPick.stem && n.noid) || null;
function giveIdDialog(note) {
  if (!note || note.s !== 'd') return;
  idPick = { stem: note.stem }; drawIdBar();
}
function endIdPick() { idPick = null; drawIdBar(); }
function drawIdBar() {
  const bar = $('#idbar'); if (!bar) return;
  const subject = idSubject();
  if (idPick && !subject) idPick = null;
  if (!idPick) { bar.hidden = true; bar.innerHTML = ''; return; }
  const base = cur && cur.k === 'note' ? get(cur.s, cur.id) : null;
  const ok = base && base.s === 'd' && !base.noid && base !== subject;
  const child = ok ? X.suggest(notes, base, 'child') : '', sib = ok ? X.suggest(notes, base, 'sibling') : '';
  bar.hidden = false;
  bar.innerHTML = `<span class="idb-t" title="${esc(titleOf(subject) || '（無題）')}">🆔 <span class="idb-title">${esc(titleOf(subject) || '（無題）')}</span></span>`
    + `<button class="idb" data-idpick="${esc(X.nextRoot(notes))}" title="新規（次の空き番号）">🆕 <b>${esc(X.nextRoot(notes))}</b></button>`
    + (ok ? `<span class="idb-base" title="${esc(titleOf(base))}">${esc(base.id)}</span>`
      + `<button class="idb on" data-idpick="${esc(child)}" title="${esc(base.id)} に分岐">🌱 <b>${esc(child)}</b></button>`
      + `<button class="idb on" data-idpick="${esc(sib)}" title="${esc(base.id)} と並列">↔️ <b>${esc(sib)}</b></button>` : '')
    + '<span class="grow"></span><button class="idb" data-idcancel title="やめる（Esc）">✖️</button>';
}
const limit = (t, n) => String(t || '').length > n ? String(t).slice(0, n) + '…' : String(t || '');
document.addEventListener('click', async e => {
  if (e.target.closest('[data-idcancel]')) return endIdPick();
  const b = e.target.closest('[data-idpick]'); if (!b || !idPick) return;
  const subject = idSubject(); if (!subject) return endIdPick();
  const id = b.dataset.idpick, ok = await changeId(subject, id);
  if (ok === false) return toast('そのIDは使えませんでした');
  idPick = null; drawIdBar(); toast(`ID ${id} を付けました`);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !idPick || e.isComposing || $('#modal').style.display === 'flex') return;
  if (e.target && e.target.closest && e.target.closest('input, textarea, .cm-editor')) return;
  endIdPick();
});
// キーワードと索引（ボタンで足す）
const refContexts = (body, id, own = 'd', target = own) => { // id（target の側）を指している所の、周辺の文章（ハイライトなし）。own は、この本文のある側。リンクだけの行は出さない
  const out = [];
  for (const t of L.tokens(body)) {
    if (t.k !== 'ref' || t.id !== id || (t.sp || own) !== target) continue;
    const ls = body.lastIndexOf('\n', t.from - 1) + 1, e0 = body.indexOf('\n', t.to), le = e0 < 0 ? body.length : e0;
    const a = Math.max(ls, t.from - 28), b = Math.min(le, t.to + 40);
    const before = body.slice(a, t.from).replace(/^[-*]\s+/, ''), after = body.slice(t.to, b);
    if (!(before + after).trim()) continue;
    out.push(`${a > ls ? '…' : ''}${esc(before)}${esc(t.text)}${esc(after)}${b < le ? '…' : ''}`);
  }
  return out;
};
function backlinks(note) { // このノートを指しているノート・日記
  const out = [];
  if (note.noid) return out;
  for (const m of notes) if (m !== note && !m.noid) { const c = refContexts(m.body, note.id, m.s, note.s); if (c.length) out.push({ m, c: c[0], more: c.length - 1 }); }   // 紙とデジタルの、どちらからのリンクも
  for (const d of diaries) { const c = refContexts(d.body, note.id, 'd', note.s); if (c.length) out.push({ d, c: c[0], more: 0 }); }
  return out;
}
const ownTopic = n => !n.noid && topicOf(n.s, n.id);   // このノートが親の索引
// 直下の子ノートの一覧（題だけ。IDは出さない）。IDなしの分岐も入る
const childNotes = note => {
  const has = x => !!get(note.s, x);
  return notes.filter(n => n.s === note.s && n !== note && ((!note.noid && !n.noid && L.parentIn(n.id, has) === note.id) || (n.parentStem && n.parentStem === note.stem))).sort((a, b) => note.noid || (a.noid && b.noid) ? (a.created || '').localeCompare(b.created || '') : (a.noid ? 1 : b.noid ? -1 : L.cmpId(a.id, b.id)));
};
// 右パネルの見出し: 絵文字・名前・件数・（あれば）右端の「＋」
const metaLabel = (emoji, label, count = '', act = '', actTitle = '') => `<h3 class="mh" title="${label}"><span class="me" role="img" aria-label="${label}">${emoji}</span>${count ? `<small class="mc">${count}</small>` : ''}${act ? `<button class="mplus" data-act="${act}" title="${actTitle}">＋</button>` : ''}</h3>`;
const childrenHtml = note => { const cs = childNotes(note); return cs.length ? `<div class="sec">${metaLabel('🌱', '子', cs.length)}${cs.map(c => `<div class="mt ch" data-s="${c.s}" data-id="${esc(c.id)}"><a class="tl" style="margin-left:0">${esc(titleOf(c) || '（無題）')}</a></div>`).join('')}</div>` : ''; };
// 右パネルの親ノート（子と同じ書式）。IDなしは親のIDなし（parentStem）をたどる
const parentNote = note => {
  if (note.noid) return note.parentStem ? notes.find(x => x.stem === note.parentStem) || null : null;
  const pid = L.parentIn(note.id, x => !!get(note.s, x));
  return pid ? get(note.s, pid) || null : null;
};
const parentHtml = note => { const p = parentNote(note); return p ? `<div class="sec">${metaLabel('🌳', '親')}<div class="mt ch" data-s="${p.s}" data-id="${esc(p.id)}"><a class="tl" style="margin-left:0">${esc(titleOf(p) || '（無題）')}</a></div></div>` : ''; };
// 右パネルの順番: 🏷️ キーワード → 📑 自トピック → 🗂️ トピック → 🌳 親 → 🌱 子 → 🔗 バックリンク → 💬 チャットメモ
function renderMeta(note) {
  const el = $('#margin'); if (!el) return;
  const bundles = LC.allLinks().filter(l => l.targets.some(t => t.kind === 'note' && t.stem === note.stem && t.s === note.s));
  if (note.noid) { el.innerHTML = parentHtml(note) + childrenHtml(note) + (bundles.length ? `<div class="sec">${metaLabel('🔗', 'バックリンク', bundles.length)}${bundles.map(l => `<div class="mt"><a class="tl" data-link-object="${esc(l.id)}">${esc(l.title)}</a></div>`).join('')}</div>` : '') + '<div class="hint">🆔 IDなしのノートです。<br>「IDを付ける」と、キーワードや索引、バックリンクが使えます。</div>'; return; }
  const tops = topics.map(t => ({ t, kws: L.mergeTopic(t).rows.filter(r => r[note.s].some(x => L.splitAnchor(x).id === note.id)).map(r => r.kw) })).filter(x => x.kws.length); // 自分のキーワードがあるものだけ
  const bl = backlinks(note);
  el.innerHTML =
    `<div class="sec">${metaLabel('🏷️', 'キーワード', note.keywords.length || '', 'kwadd', 'キーワードを足す')}${note.keywords.length ? `<div class="kwlist">${note.keywords.map(k => `<div class="kwrow" data-kw="${esc(k)}" title="${esc(readings[k] || '')}">${esc(k)}</div>`).join('')}</div>` : '<div class="msub">まだありません</div>'}</div>` +
    (topicsOf(note.s, note.id).length ? `<div class="sec">${metaLabel('📑', '自トピック')}${topicsOf(note.s, note.id).map(o => `<div class="mt topic-index-entry" data-town="${esc(o.name)}"><a class="tl" data-topic="${esc(o.name)}">${esc(stripId(o.name))}</a></div>`).join('')}</div>` : '') +
    `<div class="sec">${metaLabel('🗂️', 'トピック', tops.length || '', 'tadd', '索引に入れる・作る')}${tops.length ? tops.map(x => `<div class="mt topic-index-entry" data-tin="${esc(x.t.name)}"><a class="tl" data-topic="${esc(x.t.name)}">${esc(stripId(x.t.name))}</a><div class="topic-index-keys">${x.kws.map(kw => `<span>${esc(kw)}</span>`).join('、')}</div></div>`).join('') : '<div class="msub">どの索引にも入っていません</div>'}</div>` +
    parentHtml(note) +
    childrenHtml(note) +
    (bl.length || bundles.length ? `<div class="sec">${metaLabel('🔗', 'バックリンク', bl.length + bundles.length)}${bl.map(x => x.m
      ? `<div class="bl" data-s="${x.m.s}" data-id="${esc(x.m.id)}"><div class="bh"><b>${esc(titleOf(x.m) || '（無題）')}</b></div><p>${x.c}</p></div>`
      : `<div class="bl" data-diary="${x.d.date}"><div class="bh"><b>${x.d.date.slice(5)}（${L.weekday(x.d.date)}）</b><em>日記</em></div><p>${x.c}</p></div>`).join('')}${bundles.map(l => `<div class="mt"><a class="tl" data-link-object="${esc(l.id)}">${esc(l.title)}</a></div>`).join('')}</div>` : '') +
    '';
}
// 🏷️ キーワードを足す窓: 入力・今までのキーワードの候補・読み（自動で入る。違っていれば直す）
function keywordDialog(note) {
  $('#modal .box').innerHTML = `<div class="dlg-a">
    <h3>🏷️ キーワードを足す</h3>
    <input id="kw-in" placeholder="キーワード" autocomplete="off">
    <div class="da-lab">候補（押すと入ります）</div><div id="kw-cands" class="da-chips"></div>
    <div class="da-lab">読み（ふりがな）</div><input id="kw-yomi" placeholder="自動で入ります">
    <div class="da-bar"><span class="grow"></span><button id="kw-no">やめる</button><button id="kw-ok" class="p">🏷️ 足す</button></div></div>`;
  $('#modal').style.display = 'flex';
  const kw = $('#kw-in'), rd = $('#kw-yomi'); kw.focus();
  const close = () => { $('#modal').style.display = 'none'; };
  let touched = false, timer = null;
  const cands = () => {
    const q = kw.value.trim().toLowerCase(), hq = L.toHira(q), all = allKeywords();
    const hit = all.filter(k => !note.keywords.includes(k) && (!q || k.toLowerCase().includes(q) || (readings[k] || '').includes(hq))).slice(0, 14);
    $('#kw-cands').innerHTML = hit.map(k => `<span class="chip k" data-k="${esc(k)}">${esc(k)}</span>`).join('')
      + (q && !all.includes(kw.value.trim()) ? `<span class="chip dashed">＋「${esc(kw.value.trim())}」を新しく</span>` : '') || '<span class="sub">候補はありません</span>';
  };
  rd.oninput = () => { touched = true; };
  kw.oninput = () => {
    cands(); clearTimeout(timer);
    timer = setTimeout(async () => { if (touched) return; const k = kw.value.trim(); rd.value = !k ? '' : readings[k] || await api.suggest(k); }, 200);
  };
  $('#kw-cands').onclick = e => { const c = e.target.closest('[data-k]'); if (!c) return; kw.value = c.dataset.k; touched = false; rd.value = readings[c.dataset.k] || ''; cands(); kw.focus(); };
  const ok = async () => {
    const k = kw.value.trim(); if (!k) return; clearTimeout(timer);
    const r = L.toHira(rd.value.trim()) || readings[k] || await api.suggest(k);
    if (r !== readings[k]) { readings[k] = r; await api.setReading(k, r); }
    if (!note.keywords.includes(k)) note.keywords.push(k);
    saveNote(note); renderList(); close(); renderMeta(note);
  };
  kw.onkeydown = rd.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } };
  $('#kw-ok').onclick = ok; $('#kw-no').onclick = close; $('#modal').onkeydown = e => { if (e.key === 'Escape') close(); };
  cands();
}
let focusNewBody = false;   // 「作る」で開いたときだけ、本文にカーソルを置く
async function create(s, id) {
  const n = await api.saveNote({ s, id, created: L.now(), keywords: [], body: '' });
  notes.push(n); if (s === 'd') await refreshDiaries();
  focusNewBody = true; openNote(s, id);
}
// ノートを作ると作った日の日記が（無ければ）できて、リンクが入る。その日記を取り込み直す
async function refreshDiaries() {
  const since = saves.revision;
  for (const r of await api.diaryState()) upsertDiary(r, since);
  syncEditors();
}
$('#pane').addEventListener('click', async e => {
  const objectLink = e.target.closest('[data-link-object]'); if (objectLink) return LC.detail(objectLink.dataset.linkObject);
  const a = e.target.closest('[data-act]'); if (!a || !cur) return;
  const act = a.dataset.act;
  if (cur.k === 'topic') return topicAct(act);
  if (cur.k === 'diary') return diaryAct(act);
  const { s, id } = cur, note = get(s, id);
  if (note && note.noid && (act === 'sib' || act === 'chi')) return createNoidRel(note, act);
  if (act === 'sib') create(s, free(s, L.sibling(id)));
  if (act === 'chi') create(s, free(s, L.child(id)));
  if (act === 'giveid') return giveIdDialog(note);
  if (act === 'copyid') return copyNoteId(note);
  if (act === 'mgn') return toggleMgn();
  if (act === 'nmenu') return noteMenu(a, note);
  if (act === 'kwadd') keywordDialog(note);
  if (act === 'ndel') deleteNotes([{ s, id }]);
  if (act === 'attach') pick(true, f => attach(note, f), '*');
  if (act === 'table' && lastView) {
    const v = lastView, h = v.state.selection.main.head, at = v.state.doc.lineAt(h);
    const ins = (h === at.from ? '' : '\n') + tableTemplate;
    v.dispatch({ changes: { from: h, insert: ins }, selection: { anchor: h + ins.length } }); focusTableAt(v, h + (h === at.from ? 0 : 1));
  }
  if (act === 'tadd') topicAddDialog(note);
  if (act === 'img') pick(false, async f => { const r = await api.saveImage(s, id, await shrink(f[0])); Object.assign(get(s, id), r); openNote(s, id); });
});
// 右の欄（キーワード・索引・バックリンク）を隠す・出す。覚えておく
let mgnHidden = (() => { try { return localStorage.getItem('pkm-mgn-hidden') === '1'; } catch { return false; } })();
const applyMgn = () => { const st = document.querySelector('#pane .stage'); if (st) { st.classList.toggle('nomgn', mgnHidden); st.style.setProperty('--ph', $('#pane').clientHeight + 'px'); } };
window.addEventListener('resize', applyMgn);
function toggleMgn() { mgnHidden = !mgnHidden; try { localStorage.setItem('pkm-mgn-hidden', mgnHidden ? '1' : '0'); } catch { } applyMgn(); }
document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === '\\' && !e.shiftKey) { e.preventDefault(); toggleMgn(); } });
// ノートのメニュー（⋯）: 並列・分岐・表・添付・ID・削除
function noteMenu(btn, note) {
  const r = btn.getBoundingClientRect(), { s, id } = note, text = (note.kind || 'text') === 'text';
  popMenu({ clientX: r.right - 190, clientY: r.bottom + 4 }, [
    ...(text ? [['▦ 表を入れる', () => insertTable()], ['🖍️ ボードを入れる（文字と線）', () => insertBoard()], ['📎 ファイルを添付', () => pick(true, f => attach(note, f), '*')]] : []),
    ['🆔 IDを変更・解除…', () => idSettingsDialog(note)],
    ['🗑️ 削除', () => deleteNotes([{ s, id }]), true]
  ]);
}
async function copyNoteId(note) {
  if (!note || note.noid) return;
  try { await navigator.clipboard.writeText(note.id); toast(`IDをコピーしました: ${note.id}`); }
  catch { toast('IDをコピーできませんでした'); }
}
function highlightMemoRange(id, range) {
  const bubble = [...document.querySelectorAll('[data-m]')].find(e => e.dataset.m === id), body = bubble?.querySelector('.b-body');
  if (!body) return;
  bubble.scrollIntoView({ block: 'center' }); bubble.classList.add('flash');
  const text = body.textContent, from = text.indexOf(range.quote);
  if (from < 0 || text.lastIndexOf(range.quote) !== from) return;
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT), nodes = []; let node, offset = 0;
  while ((node = walker.nextNode())) { nodes.push({node,from:offset,to:offset+node.textContent.length}); offset += node.textContent.length; }
  const a = nodes.find(n => from >= n.from && from < n.to), end = from + range.quote.length, b = nodes.find(n => end > n.from && end <= n.to);
  if (a && b) { const selected = document.createRange(); selected.setStart(a.node, from - a.from); selected.setEnd(b.node, end - b.from); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(selected); }
}
function idSettingsDialog(note) {
  dialog(`<h3>🆔</h3>
    <div class="row"><input id="id-next" value="${note.noid ? '' : esc(note.id)}" placeholder="ID" autocomplete="off" spellcheck="false" aria-label="ID" style="flex:1"><button class="p" id="id-apply" title="変更する（Enter）">✅</button></div>
    <div id="id-error" role="alert"></div>
    <div class="row"><button id="id-cancel" title="やめる">✖️</button>${note.s === 'd' ? '<button id="id-find" title="ノートを探して、分岐・並列で決める">🔎</button>' : ''}${note.s === 'd' && !note.noid ? '<button class="danger" id="id-clear" title="IDを外す（IDなしにする）">🗑️</button>' : ''}</div>`, close => {
    const input = $('#id-next'), error = $('#id-error'), apply = $('#id-apply');
    $('#id-cancel').onclick = close;
    if ($('#id-find')) $('#id-find').onclick = () => { close(); giveIdDialog(note); };
    apply.onclick = async () => {
      const id = input.value.trim().toLowerCase();
      if (!id) { error.textContent = 'IDを入れてください'; return input.focus(); }
      if (id === note.id) return close();
      apply.disabled = true; error.textContent = '';
      try {
        if (await changeId(note, id)) close();
        else error.textContent = 'このIDは使えません';
      } catch { error.textContent = '保存できませんでした'; }
      finally { apply.disabled = false; }
    };
    if ($('#id-clear')) $('#id-clear').onclick = async () => {
      try { if (await clearIdFlow(note)) close(); }
      catch { error.textContent = 'IDを外せませんでした'; }
    };
    input.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); apply.click(); } };
    input.focus(); input.select();
  });
}
// IDを消す: このノートを指すリンクは、自動でファイルへのリンクに直る
async function clearIdFlow(note) {
  const n = backlinks(note).length;
  if (!confirm(`「${titleOf(note)}」のIDを消して、IDなしにしますか？\n${n ? `このノートを指している ${n} 件のリンクは、自動で直ります。\n` : ''}子のノートのIDは、そのままです。`)) return;
  await flush(); await api.saveNote(pubNote(note));
  const old = note.id, st = await api.clearId(note.s, old); if (!st) return alert('IDを消せませんでした');
  ({ notes, topics } = st); diaries = st.diaries; records = st.records || records; readings = st.readings || readings;
  const stem = notes.find(x => x.noid && x.stem === note.stem);
  for (const t of tabs) if (t.k === 'note' && t.s === note.s && t.id === old && stem) t.id = stem.id;
  if (stem) openNote('d', stem.id, null, true); else show(Math.max(0, active));
  toast('IDを消しました'); return true;
}
// IDなしのノートを作る。あとでIDを付けて整理する
// IDなしのノートから、IDなしのまま分岐・並列を作る。親にIDが付いた時に、子のIDも決まる
async function createNoidRel(note, act) {
  // IDなしの分岐・並列。IDがあるノートからも作れる（分岐=そのノートの下、並列=同じ親の下）
  const has = x => !!get(note.s, x), par = note.noid ? null : get(note.s, L.parentIn(note.id, has) || '');
  const parentStem = act === 'chi' ? note.stem : (note.noid ? (note.parentStem || '') : (par ? par.stem : ''));
  const n = await api.createNote({ kind: 'text', created: L.now(), parentStem });
  notes.push(n); await refreshDiaries(); openNote('d', n.id);
  setTimeout(() => { if (cur && cur.k === 'note' && cur.id === n.id && lastView && lastView.dom.isConnected) lastView.focus(); }, 30);
}
async function createNoid(kind) {
  const n = await api.createNote({ kind, data: null, created: L.now() });
  notes.push(n); await refreshDiaries(); openNote('d', n.id);
  if (kind === 'text') setTimeout(() => { if (cur && cur.k === 'note' && cur.id === n.id && lastView && lastView.dom.isConnected) lastView.focus(); }, 30);
  else setTimeout(() => { const t = $('#f-title'); if (t) t.focus(); }, 30);
}
// Index タブの＋: グローバルなら新しいキーワード（📜 のときは紙、ふだんはデジタル）、グループなら新しいグループIndex
function newIndexDialog() {
  const paper = paperOnly;
  dialog(`<div class="dlg-a"><h3>➕ ${paper ? '紙の' : 'デジタルの'}キーワードを作る</h3>
    <div class="da-lab">🏷️ キーワード</div><input id="ni-kw" autocomplete="off">
    <div class="da-lab">🔤 よみ（自動）</div><input id="ni-rd" autocomplete="off">
    <div class="da-lab">ID（空白で区切る。例: 12 12a）${paper ? '。まだ取り込んでいない紙のIDでもよい' : '。今あるデジタルのノートのID'}</div><input id="ni-ids" autocomplete="off">
    <div class="da-bar"><span class="grow"></span><button id="ni-no">やめる</button><button class="p" id="ni-ok">➕ 作る</button></div></div>`, close => {
    let touched = false, timer = null;
    $('#ni-kw').focus(); $('#ni-no').onclick = close;
    $('#ni-rd').oninput = () => { touched = !!$('#ni-rd').value; };
    $('#ni-kw').oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { if (touched) return; const k = $('#ni-kw').value.trim(); $('#ni-rd').value = k ? await api.suggest(k) : ''; }, 220); };
    const ok = async () => {
      const kw = $('#ni-kw').value.trim(), ids = $('#ni-ids').value.split(/[\s,、，]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      if (!kw) return $('#ni-kw').focus();
      if (!ids.length) return $('#ni-ids').focus();
      const bad = ids.filter(i => !L.isId(L.splitAnchor(i).id)); if (bad.length) return alert(`IDの形が違います: ${bad.join(' ')}\n（例: 12 や 3a）`);
      if (paper) {
        const rd = L.toHira($('#ni-rd').value.trim()) || await api.suggest(kw);
        if (!(await PI.addPaper(kw, rd, ids))) return;
      } else {
        const miss = ids.filter(i => !get('d', L.splitAnchor(i).id)); if (miss.length) return alert(`デジタルのノートがありません: ${miss.join(' ')}`);
        for (const i of ids) { const n = get('d', L.splitAnchor(i).id); if (!n.keywords.includes(kw)) { n.keywords.push(kw); await api.saveNote(pubNote(n)); } }
        const rd = L.toHira($('#ni-rd').value.trim()); if (rd) { try { await api.setReading?.(kw, rd); } catch { } }
        renderList();
      }
      close();
    };
    $('#ni-ok').onclick = ok;
    for (const id of ['ni-kw', 'ni-rd', 'ni-ids']) $('#' + id).onkeydown = ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ok(); } };
  });
}
$('#new').onclick = e => {
  if (mode === 'diary') return openDiary(L.todayStr());
  if (mode === 'notes' && tab === 'i') return newIndexDialog();
  const r = $('#new').getBoundingClientRect();
  popMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
    ['📝 ノート', () => createNoid('text')],
    ['📷 スキャンを取り込む（紙）', () => $('#imp').click()]
  ]);
};

// ===== 索引 =====
// 「近いもの」: 同じキーワードの行・番号の近さ・リンクでつながるノート・最近使ったもの。理由も添える
const recentTopics = () => { try { return JSON.parse(localStorage.getItem('pkm-topic-recent') || '[]'); } catch { return []; } };
const rememberTopic = name => { try { localStorage.setItem('pkm-topic-recent', JSON.stringify([name, ...recentTopics().filter(x => x !== name)].slice(0, 12))); } catch { } };
function topicRank(note, query = '') { return TopicRanking.rank(note, topics, notes, recentTopics(), query); }
// このノートを索引に追加（検索して選び、キーワードを入れる）。新しく作ることもできる
function topicAddDialog(note) {
  const entry = topicOf(note.s, note.id), name = `${note.s === 'p' ? '紙 ' : ''}${note.id}`;
  let sel = null;
  $('#modal .box').innerHTML = `<div class="dlg-a">
    <h3>🗂️ ${esc(name)} を索引に入れる</h3>
    <div class="da-bar"><input id="ta-q" placeholder="🔎 索引を探す" style="flex:1;min-width:0"><button id="ta-new" title="トピックインデックスを追加（何個でも作れます）" aria-label="トピックインデックスを追加" aria-expanded="false">＋</button></div>
    <div id="ta-create" hidden><div class="da-lab">新しいトピックインデックスの名前</div><div class="da-bar"><input id="ta-name" placeholder="名前（例: GUI）" style="flex:1;min-width:0"><button id="ta-create-cancel">やめる</button><button id="ta-create-ok" class="p">追加</button></div><div id="ta-create-error" role="alert"></div></div>
    <div id="ta-list" class="ta-list"></div>
    <div class="da-lab">🏷️ キーワード（索引の中の行の名前）</div>
    <input id="ta-kw" list="ta-kws" placeholder="例: 英雄伝"><datalist id="ta-kws"></datalist>
    <div class="da-bar"><span class="grow"></span><button id="ta-cancel">やめる</button><button id="ta-ok" class="p">🗂️ 入れる</button></div></div>`;
  $('#modal').style.display = 'flex';
  const close = () => { $('#modal').style.display = 'none'; };
  let rank = topicRank(note);
  const draw = () => {
    const q = $('#ta-q').value.trim().toLowerCase();
    const hit = t => !q || t.name.toLowerCase().includes(q) || L.mergeTopic(t).rows.some(r => r.kw.toLowerCase().includes(q));
    rank = topicRank(note, q);
    const sc = t => rank.get(t.name)?.near ? 1 : 0;
    const list = topics.filter(hit).sort((a, b) => TopicRanking.compare(rank, a, b));
    if (sel && !list.includes(sel)) sel = null;
    if (!sel && list.length) choose(list[0], false);
    const row = t => { const r = rank.get(t.name); return `<div class="ta-row${t === sel ? ' on' : ''}" data-name="${esc(t.name)}">${esc(stripId(t.name))}${t.entry ? `<small> ${t.entry.s === 'p' ? '紙' : ''}${esc(t.entry.id)}</small>` : ''}${r ? r.why.map(w => `<em>${esc(w)}</em>`).join('') : ''}</div>`; };
    const near = list.filter(t => sc(t) > 0), rest = list.filter(t => sc(t) <= 0);
    $('#ta-list').innerHTML = (near.length ? `<div class="ta-h">近いもの</div>${near.map(row).join('')}` : '') + (rest.length ? `${near.length ? '<div class="ta-h">そのほか</div>' : ''}${rest.map(row).join('')}` : '')
      || '<div class="sub" style="padding:6px">ありません</div>';
    const on = $('#ta-list .on'); if (on) on.scrollIntoView({ block: 'nearest' });
  };
  function choose(t, redraw = true) {
    sel = t;
    const rows = L.mergeTopic(t).rows.map(r => r.kw), mine = note.keywords.filter(k => rows.includes(k));
    $('#ta-kws').innerHTML = [...mine, ...rows.filter(k => !mine.includes(k)), ...note.keywords.filter(k => !rows.includes(k))].map(k => `<option value="${esc(k)}">`).join('');
    if (mine.length && !$('#ta-kw').dataset.touched) $('#ta-kw').value = mine[0];   // 同じキーワードの行があれば、それを入れておく
    if (redraw) draw();
  }
  $('#ta-list').onclick = e => { const r = e.target.closest('[data-name]'); if (r) { choose(topics.find(t => t.name === r.dataset.name)); $('#ta-kw').focus(); } };
  $('#ta-q').oninput = draw;
  $('#ta-kw').oninput = () => { $('#ta-kw').dataset.touched = '1'; };
  $('#ta-q').onkeydown = e => {
    if (e.key === 'Enter') return $('#ta-kw').focus();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {   // 矢印で候補を選ぶ
      e.preventDefault(); const rows = [...$('#ta-list').querySelectorAll('[data-name]')], i = rows.findIndex(r => r.dataset.name === (sel && sel.name));
      const nx = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (nx) choose(topics.find(t => t.name === nx.dataset.name));
    }
  };
  $('#ta-kw').onkeydown = e => { if (e.key === 'Enter') $('#ta-ok').click(); };
  $('#ta-ok').onclick = async () => {
    const kw = $('#ta-kw').value.trim();
    if (!sel) return alert('索引を選んでください');
    if (!kw) return $('#ta-kw').focus();
    await flush();
    sel.text = L.addToTopic(L.topicText(sel), kw, note.s === L.defOf(sel) ? note.id : `${note.id}(${note.s})`);
    rememberTopic(sel.name);
    await api.saveTopic(sel); close(); renderMeta(note);
  };
  $('#ta-cancel').onclick = close;
  if ($('#ta-new')) {
    const hideCreate = () => { $('#ta-create').hidden = true; $('#ta-new').setAttribute('aria-expanded', 'false'); $('#ta-q').focus(); };
    $('#ta-new').onclick = () => { $('#ta-create').hidden = false; $('#ta-new').setAttribute('aria-expanded', 'true'); $('#ta-name').focus(); };
    $('#ta-create-cancel').onclick = hideCreate;
    $('#ta-name').onkeydown = e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#ta-create-ok').click(); }
      if (e.key === 'Escape') { e.stopPropagation(); hideCreate(); }
    };
    $('#ta-create-ok').onclick = async () => {
      const nm = $('#ta-name').value.trim(), error = $('#ta-create-error'), button = $('#ta-create-ok');
      if (!nm) { error.textContent = '名前を入力してください'; return $('#ta-name').focus(); }
      if (/[\\/:*?"<>|]/.test(nm) || nm === '.' || nm === '..') { error.textContent = 'ファイル名に使えない文字が含まれています'; return; }
      if (topics.some(t => t.name === nm)) { error.textContent = 'その名前は既にあります'; return; }
      button.disabled = true; error.textContent = '';
      try {
        await flush();
        const t = { name: nm, entry: { s: note.s, id: note.id }, keyword: '', text: '' };
        const saved = await api.saveTopic(t); if (!saved) throw new Error('保存できませんでした');
        if (typeof saved === 'number') t.num = saved;   // 同じノートの2つ目以降は 1-2, 1-3 …
        topics.push(t); rememberTopic(nm); close(); renderMeta(note);
        newTab = true; openTopic(nm, 'edit');
      } catch (e) { error.textContent = e.message; button.disabled = false; }
    };
  }
  $('#modal').onkeydown = e => { if (e.key === 'Escape') close(); };
  draw(); $('#ta-q').focus();
}
// 索引を単独で作る。親は新しいノート（新しいID）か、既存のノート
// キーワードを指定すると、そのキーワードのIDが最初から入り、Index に赤い点が付く（IDが2つ以上のときだけ）
function topicNewDialog(kw = '') {
  const rootFree = sp => { const r = notes.filter(n => n.s === sp && /^\d+$/.test(n.id)).map(n => +n.id); return free(sp, String((r.length ? Math.max(...r) : 0) + 1)); };
  const idsOf = k => { const v = globalIndex().find(x => x[0] === k); return v ? v[1] : { d: [], p: [] }; };
  $('#modal .box').innerHTML = `<div class="dlg-a">
    <h3>➕ 索引を作る</h3>
    <div class="da-lab">🏷️ キーワード（任意）。同じキーワードのIDが2つ以上あるとき、それらをまとめます</div>
    <input id="tn-kw" list="tn-kws" value="${esc(kw)}" placeholder="例: GUI"><datalist id="tn-kws">${globalIndex().filter(([, v]) => v.d.length + v.p.length >= 2).map(([k]) => `<option value="${esc(k)}">`).join('')}</datalist>
    <div class="da-lab">🌳 親のノート。無いIDなら、新しいノートを作ります</div>
    <div class="row"><select id="tn-s"><option value="d">デジタル</option><option value="p">紙</option></select><input id="tn-id" style="width:100px"><span id="tn-note" class="sub"></span></div>
    <label class="rad" id="tn-laterw" style="display:none"><input type="checkbox" id="tn-later" checked> 紙のノートは、まだ作らない（取り込む前の番号。取り込んだら、つながります）</label>
    <div class="da-lab">📝 名前</div>
    <input id="tn-name">
    <div id="tn-pre" class="sub"></div>
    <div class="da-bar"><span class="grow"></span><button id="tn-cancel">やめる</button><button id="tn-ok" class="p">➕ 作る</button></div></div>`;
  $('#modal').style.display = 'flex';
  const close = () => { $('#modal').style.display = 'none'; };
  let nameTouched = false;
  const refresh = () => {
    const k = $('#tn-kw').value.trim(), sp = $('#tn-s').value, id = $('#tn-id').value.trim().toLowerCase();
    const exists = !!get(sp, id);
    $('#tn-laterw').style.display = sp === 'p' && id && !exists ? 'flex' : 'none';
    $('#tn-note').textContent = !id ? '' : exists ? `既存のノート ${id} を親にします` : sp === 'p' && $('#tn-later').checked ? `紙 ${id} はまだ取り込んでいません（ノートが無くても作れます）` : `新しいノート ${id} を作ります`;
    if (!nameTouched) $('#tn-name').value = k || '';
    const v = k ? idsOf(k) : null;
    $('#tn-pre').textContent = v ? (v.d.length + v.p.length >= 2 ? `${k} ${[...v.d, ...v.p.map(x => '紙' + x)].join(' ')}` + (exists && !(sp === 'd' ? v.d : v.p).includes(id) || !exists ? ` ${sp === 'p' ? '紙' : ''}${id}` : '') + `　→ ${sp === 'p' ? '紙' : ''}${id} の上に赤い点が付きます` : 'このキーワードのIDは2つ未満です') : '';
  };
  $('#tn-s').value = 'd'; $('#tn-id').value = rootFree('d');
  $('#tn-s').onchange = () => { $('#tn-id').value = rootFree($('#tn-s').value); refresh(); };
  $('#tn-kw').oninput = refresh; $('#tn-id').oninput = refresh; $('#tn-later').onchange = refresh;
  $('#tn-name').oninput = () => { nameTouched = true; };
  $('#tn-ok').onclick = async () => {
    const k = $('#tn-kw').value.trim(), sp = $('#tn-s').value, id = $('#tn-id').value.trim().toLowerCase(), name = $('#tn-name').value.trim();
    if (!L.isId(id)) return alert('IDの形が違います（例: 12 や 3a）');
    if (!name) return alert('名前を入れてください');
    if (topics.find(t => t.name === name)) return alert('その名前は既にあります');
    let v = null;
    if (k) {
      v = idsOf(k);
      if (v.d.length + v.p.length < 2) return alert('キーワードは、IDが2つ以上あるものだけです');
    }
    if (!get(sp, id) && !(sp === 'p' && $('#tn-later').checked)) notes.push(await api.saveNote({ s: sp, id, created: L.now(), keywords: k ? [k] : [], body: '' }));
    else if (get(sp, id)) await ensureKeyword(sp, id, k);
    const t = { name, entry: { s: sp, id }, keyword: k, text: v ? idsText(k, v, sp) : '' };
    const sv = await api.saveTopic(t); if (!sv) return alert('保存できませんでした');
    t.num = sv === true ? 0 : sv; topics.push(t); close(); renderList(); newTab = true; openTopic(name, 'edit');
  };
  $('#tn-cancel').onclick = close;
  $('#modal').onkeydown = e => { if (e.key === 'Escape') close(); };
  refresh(); $('#tn-kw').focus();
}
// mode: view（まとめて表示）| edit（デジタル欄・紙欄に書く）| conf（親・名前を変える）
// ===== エクスポート（仮の出力。ファイルは作らない）=====
// 選んだノート（＋関連・番号の範囲）を、1つの Markdown にまとめる。プレビューで確認 → 一時タブで確認 → コピー
function exportDialog(start) {
  const keyOf = n => n.s + ':' + n.id, sel = new Set(start.filter(k => get(k[0], k.slice(2))));
  const gk = k => get(k[0], k.slice(2)), ordered = () => [...sel].map(gk).filter(Boolean).sort((a, b) => a.s.localeCompare(b.s) || (a.noid ? 1 : 0) - (b.noid ? 1 : 0) || L.cmpId(a.id, b.id));
  const idsOf = sp => notes.filter(n => n.s === sp && !n.noid).map(n => n.id).sort(L.cmpId);
  const related = (kinds) => {
    const add = new Set();
    for (const n of ordered()) {
      if (n.noid) continue;
      if (kinds.includes('out')) for (const t of L.tokens(n.body || '')) if (t.k === 'ref' && get(t.sp || n.s, t.id)) add.add((t.sp || n.s) + ':' + t.id);
      if (kinds.includes('in')) for (const m of notes) if (!m.noid && refContexts(m.body || '', n.id, m.s, n.s).length) add.add(keyOf(m));
      if (kinds.includes('kw')) for (const m of notes) if (!m.noid && m.keywords.some(k => n.keywords.includes(k))) add.add(keyOf(m));
      if (kinds.includes('topic')) for (const t of topics) { const rows = L.mergeTopic(t).rows; if (rows.some(r => r[n.s].some(x => L.splitAnchor(x).id === n.id))) for (const r of rows) for (const sp of ['d', 'p']) for (const raw of r[sp]) { const id = L.splitAnchor(raw).id; if (get(sp, id)) add.add(sp + ':' + id); } }
    }
    return add;
  };
  const draw = () => {
    const list = ordered();
    $('#ex-list').innerHTML = list.map(n => `<div class="exrow"><b>${n.noid ? 'IDなし' : (n.s === 'p' ? '紙 ' : '') + esc(n.id)}</b> ${esc(titleOf(n).slice(0, 40))}<span class="grow"></span><i data-rm="${esc(keyOf(n))}" title="外す">×</i></div>`).join('') || '<div class="sub">まだ選んでいません</div>';
    $('#ex-n').textContent = `${list.length}件`; $('#ex-open').disabled = $('#ex-copy').disabled = $('#ex-html').disabled = !list.length;
  };
  dialog(`<h3>エクスポート <small class="sub">（保存はしません。確認してコピー）</small></h3>
    <div class="exsec"><b>関連を足す</b>
      <label><input type="checkbox" class="ex-k" value="out" checked>リンク先</label><label><input type="checkbox" class="ex-k" value="in">リンク元</label>
      <label><input type="checkbox" class="ex-k" value="kw">同じキーワード</label><label><input type="checkbox" class="ex-k" value="topic">同じ索引</label>
      <button id="ex-rel">足す</button></div>
    <div class="exsec"><b>番号の範囲（デジタル）</b> <input id="ex-from" placeholder="1a" size="5"> 〜 <input id="ex-to" placeholder="1a5" size="5"> <button id="ex-range">範囲を足す</button>
      <input id="ex-root" placeholder="1a" size="5" style="margin-left:14px"> <button id="ex-tree">その枝（子孫すべて）を足す</button></div>
    <div class="exsec"><b id="ex-n"></b> <span class="sub">番号順に出します。リンクは、この中を指すものだけ生かします</span></div>
    <div id="ex-list" class="exlist"></div>
    <div class="row"><button class="p" id="ex-open">一時タブで確認</button><button id="ex-copy">コピー</button><button id="ex-html">HTMLで保存</button><button id="ex-no">閉じる</button></div>`, close => {
    $('#ex-no').onclick = close;
    $('#ex-list').onclick = e => { const r = e.target.closest('[data-rm]'); if (r) { sel.delete(r.dataset.rm); draw(); } };
    $('#ex-rel').onclick = () => { for (const k of related([...document.querySelectorAll('.ex-k:checked')].map(c => c.value))) sel.add(k); draw(); };
    $('#ex-range').onclick = () => { const f = $('#ex-from').value.trim().toLowerCase(), t = $('#ex-to').value.trim().toLowerCase(); if (!f || !t) return; for (const id of L.fzRange(idsOf('d'), f, t)) sel.add('d:' + id); draw(); };
    $('#ex-tree').onclick = () => { const r = $('#ex-root').value.trim().toLowerCase(); if (!r) return; for (const id of L.fzSubtree(idsOf('d'), r)) sel.add('d:' + id); draw(); };
    const text = () => clipText(L.exportMd(ordered().map(n => ({ s: n.s, id: n.id, title: n.title || '', body: n.body || '', noid: n.noid }))));
    $('#ex-copy').onclick = async () => { await navigator.clipboard.writeText(text()); toast(`${sel.size}件をコピーしました`); };
    $('#ex-html').onclick = async () => {   // 選んだ範囲を、1 つのHTMLに。範囲の中のリンクは、そのまま辿れる
      const list = ordered(); if (!list.length) return;
      $('#ex-html').disabled = true; toast('HTMLを作っています…');
      try {
        const html = await ExportHtml.build(list, { renderMd, clipText, get, titleOf });
        const p = await api.saveHtml('YuriiNote-' + L.now().slice(0, 10), html);
        toast(p ? `HTMLに保存しました（${list.length}件）: ${p}` : '保存をやめました');
      } catch (err) { toast('HTMLを作れませんでした: ' + (err && err.message || err)); }
      $('#ex-html').disabled = false;
    };
    $('#ex-open').onclick = () => { const t = text(), c = sel.size; close(); newTab = true; openExport({ k: 'export', text: t, count: c }); };
    draw();
  });
}
function openExport(t, keep) {
  cur = place({ k: 'export', text: t.text, count: t.count }, keep); mode = 'notes';
  $('#pane').innerHTML = `<div class="row"><h2>📤 エクスポート</h2><span class="sub">${cur.count}件・保存はされません（このタブを閉じると消えます）</span><span class="grow"></span><button class="p" id="ex-copy2">コピー</button></div>
    <textarea id="ex-text" class="extext" readonly></textarea>`;
  $('#ex-text').value = cur.text;
  $('#ex-copy2').onclick = async () => { await navigator.clipboard.writeText(clipText(cur.text)); toast('コピーしました'); };
  renderTabs(); renderList();
}

function openTopic(name, tmode = 'view', keep, focus) {   // focus: ノートから飛んできたとき、そのノート { s, id }（その行を示す）
  const t = topics.find(x => x.name === name); if (!t) return;
  if (bgOpen) { place({ k: 'topic', name, mode: tmode }, false); return; }   // ホイールクリック: 背景の新しいタブで開く。いまのタブは動かない
  cur = place({ k: 'topic', name, mode: tmode }, keep); cur.mode = tmode; mode = 'notes';
  if (!inPreview) decided = { k: 'topic', name };
  if (!inPreview && !$('#q').value && t.entry && t.entry.id !== '0') tab = t.entry.s === 'p' ? 'p' : 'd';   // 一覧を、その索引 のあるタブに
  const { rows, stars, refs, ups, downs, befores, marks, order } = L.mergeTopic(t), e = t.entry;
  const hit = r => !!focus && [...(r.d || []).map(x => ['d', x]), ...(r.p || []).map(x => ['p', x])].some(([s, x]) => s === focus.s && L.splitAnchor(x).id === focus.id);
  const upChip = u => {   // 名前だけ出す。押すと、そのIDのトピックIndex（無ければキーワードのトピックIndex、それも無ければ、IDのノート）を開く
    const o = ((u.tnos || []).map(no => topics.find(x => topicNo(x) === no)).find(Boolean)) || (u.ids.map(x => topicOf(x.s, x.id)).find(Boolean)) || (u.kw && kwTopic(u.kw)), x0 = u.ids[0];
    const name = esc(u.kw || u.ids.map(x => x.raw).join(' '));
    if (o) return `<span class="chip t" data-topic="${esc(o.name)}">${name}</span>`;
    if (!x0 && (u.tnos || []).length) return `<span class="chip miss" title="その番号の索引はありません">${name}</span>`;
    return x0 ? `<span class="chip ${x0.s}" data-s="${x0.s}" data-id="${esc(x0.id)}">${name}</span>` : `<span class="chip miss">${name}</span>`;
  };
  let body;
  if (tmode === 'edit') body = `<div class="tedit-hint">✏️ キーワード ID ID … ・ 1a(p) は紙 ・ ^ ⬆️ ・ _ ⬇️ ・ |&gt; ↪️ ・ &lt;| ↩️ ・ @ ⭕ ・ + ⭐ ・ *ID 🔴（右クリックでも） ・ 行の終わりの 0-1 は索引へのリンク</div>
      <div class="ed" id="ed-t"></div>`;
  else if (tmode === 'conf') body = `<div class="tconf">
      <div class="tc-row"><span class="tc-l">📝 名前</span><input id="t-name" value="${esc(t.name)}"></div>
      <div class="tc-row"><span class="tc-l">🌳 親</span><select id="t-s"><option value="d"${e && e.s === 'd' ? ' selected' : ''}>デジタル</option><option value="p"${e && e.s === 'p' ? ' selected' : ''}>紙</option></select>
        <input id="t-id" value="${e ? esc(e.id) : ''}" style="width:110px" placeholder="番号"><span class="sub">この索引の親になるノートの番号</span></div>
      <div class="tc-bar"><button class="tbtn p" data-act="tsave">✅ 決定</button><button class="tbtn" data-act="tcancel">やめる</button>
        <span class="grow"></span><button class="tbtn danger" data-act="tdel">🗑️ この索引を削除</button></div></div>`;
  else {
    // 書いた順に、そのまま並べる（印の行も、ふつうの行も）
    const tr = {
      row: r => `<tr data-kw="${esc(r.kw)}"${hit(r) ? ' class="tfocus"' : ''}><td${r.dot ? ` class="dotkw" data-chipish="1" data-s="${r.dot.s}" data-id="${esc(r.dot.id)}" title="赤い点の番号（入口）へ"` : ''}>${r.mark ? `<span class="tmk">${L.TMARK.mark}</span> ` : ''}${esc(r.kw)}</td><td>${rowChips(r)}</td></tr>`,
      mark: x => `<tr class="tmark"><td colspan="2"><span class="tmk">${L.TMARK.mark}</span> ${esc(x)}</td></tr>`,
      star: x => `<tr><td>${L.TMARK.star} ${esc(stripId(x))}</td><td>${tchip(x)}</td></tr>`,
      up: u => `<tr class="trel"><td><span class="tmk">${L.TMARK.up}</span> ${esc(u.kw)}</td><td>${upChip(u)}</td></tr>`,
      down: u => `<tr class="trel"><td><span class="tmk">${L.TMARK.down}</span> ${esc(u.kw)}</td><td>${upChip(u)}</td></tr>`,
      before: u => `<tr class="trel"><td><span class="tmk">${L.TMARK.before}</span> ${esc(u.kw)}</td><td>${upChip(u)}</td></tr>`,
      ref: x => `<tr class="trel${focus && focus.s === x.s && focus.id === x.id ? ' tfocus' : ''}"><td><span class="tmk">${L.TMARK.ref}</span> ${esc(x.label)}</td><td>${upChip({ kw: x.label, ids: [{ s: x.s, id: x.id, raw: x.id }] })}</td></tr>`,
    };
    const paperOk = it => it.k !== 'row' || !paperOnly || it.o.p.length || (it.o.t || []).length;
    body = `<table class="ti">${order.filter(paperOk).map(it => tr[it.k](it.o)).join('') || '<tr><td class="none">まだ空です。「編集」で書きます</td></tr>'}</table>`;
  }
  // 上位トピック（^）・独立前（<|）・独立したもの（|>）: そのキーワードのトピック Index があれば、押して開ける
  // 索引の画面は、右パネルなし。全部、上に: 題 → 🌳 親・↑ 上位トピック → 索引の中身
  $('#pane').innerHTML = `
    <div class="row thead">
      <span class="ti-ic">📑</span><h2>${esc(topicLabel(t))}</h2>
      <span class="grow"></span>
      ${tmode === 'conf' ? '' : `<button class="tbtn" data-act="tconf" title="名前・親・点のキーワードを変える">⚙️ 名前・親</button>
      ${tmode === 'conf' ? '' : '<button class="tbtn" data-act="tup" title="この索引の、上位トピックを、新しく作る">⬆️ 上位を作る</button>'}
      <button class="tbtn ${tmode === 'edit' ? 'p' : ''}" data-act="tedit">${tmode === 'edit' ? '✅ 完了' : '✏️ 編集'}</button>`}
    </div>
    <div class="row tmeta">
      <span class="tm"><span class="sub" title="親">🌳</span>${e ? chip(e.s, e.id) : '<span class="sub">なし</span>'}</span>
      ${ups.length ? `<span class="tm"><span class="tmk">${L.TMARK.up}</span>${ups.map(upChip).join('')}</span>` : ''}
      ${downs.length ? `<span class="tm"><span class="tmk">${L.TMARK.down}</span>${downs.map(upChip).join('')}</span>` : ''}
      ${befores.length ? `<span class="tm"><span class="tmk">${L.TMARK.before}</span>${befores.map(upChip).join('')}</span>` : ''}
      ${refs.length ? `<span class="tm"><span class="tmk">${L.TMARK.ref}</span>${refs.map(x => upChip({ kw: x.label, ids: [{ s: x.s, id: x.id, raw: x.id }] })).join('')}</span>` : ''}
    </div>${body}`;
  const fr = $('#pane .tfocus'); if (fr) { fr.scrollIntoView({ block: 'center' }); }   // ノートから飛んできたら、そのノートの行を示す
  if (tmode === 'edit') { // 1 つの欄。紙は ID(p)、デジタルは ID（親が紙の索引 なら、紙が ID、デジタルが ID(d)）
    const def = L.defOf(t), v = editor($('#ed-t'), L.topicText(t), 'topic', def, x => { t.text = x; saveTopic(t); }, `PKM 1a 3(p)`, () => L.topicText(t));
    v.focus();
  }
  if (tmode === 'conf') $('#t-id').focus();
  renderTabs(); renderList(); if (!$('#q').value) centerOn();   // 開いた索引 の行が、一覧の真ん中に（青い枠）
}
async function deleteTopicNamed(name) {
  const t = topics.find(x => x.name === name); if (!t) return;
  if (!confirm(`索引「${t.name}」を削除しますか？（ファイルは .trash に移ります）`)) return;
  await flush(); await api.deleteTopic(t.name);
  topics = topics.filter(x => x !== t);
  for (let i = tabs.length - 1; i >= 0; i--) if (tabs[i].k === 'topic' && tabs[i].name === t.name) { tabs.splice(i, 1); if (active >= i) active--; }
  show(Math.max(0, active));
}
// 索引の中の番号を右クリック: 赤い点（入口の目印。番号の前の *）を付ける・外す。1 つの行に付けられるのは 1 つ
function toggleDot(t, s, id) {
  const def = L.defOf(t), lines = L.topicText(t).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const r = L.topicLine(lines[i]);
    if (r.star !== undefined || r.up !== undefined || r.before !== undefined || r.mark !== undefined || !r.ids.length) continue;
    const hit = r.ids.find(x => (x.sp || def) === s && x.id === id); if (!hit) continue;
    let line = lines[i];
    const cut = r.ids.filter(x => x.dot).sort((p, q) => q.dotAt - p.dotAt);   // いまの点を外す（右の方から）
    for (const x of cut) line = line.slice(0, x.dotAt) + line.slice(x.dotAt + 1);
    if (!hit.dot) { const shift = cut.filter(x => x.dotAt < hit.from).length; line = line.slice(0, hit.from - shift) + '*' + line.slice(hit.from - shift); }
    lines[i] = line; t.text = lines.join('\n'); saveTopic(t); return !hit.dot;
  }
  return null;
}
document.addEventListener('contextmenu', e => {   // 左のグローバルIndex: ID を右クリックして、赤点（メインのトピック）を付ける・外す
  const c = e.target.closest('#list .ix .chip[data-id][data-s]'), row = c && c.closest('.ix');
  if (!c || !row) return;
  e.preventDefault(); const k = row.dataset.ixk, s = c.dataset.s, id = c.dataset.id, on = c.classList.contains('dot');
  popMenu(e, [[on ? '⚪ 赤点を外す' : '🔴 赤点を付ける（メインのトピック）', () => toggleMainDot(k, s, id)]]);
});
document.addEventListener('contextmenu', e => {
  if (!cur || cur.k !== 'topic') return;
  const c = e.target.closest('.ti .chip[data-id][data-s]'); if (!c) return;
  const t = topics.find(x => x.name === cur.name); if (!t) return;
  e.preventDefault(); const s = c.dataset.s, id = c.dataset.id, on = c.classList.contains('dot');
  popMenu(e, [[on ? '⚪ 赤い点を外す' : '🔴 赤い点を付ける（この行の入口）', () => { toggleDot(t, s, id); openTopic(t.name, 'view', true); }]]);
});
// 右パネルの右クリック: キーワード（このノートから外す）・トピック（このノートを外す／トピックを削除）
document.addEventListener('contextmenu', e => {
  if (!cur || cur.k !== 'note') return;
  const note = get(cur.s, cur.id); if (!note) return;
  const kw = e.target.closest('.kwrow'), tin = e.target.closest('[data-tin]'), town = e.target.closest('[data-town]');
  if (kw) {
    e.preventDefault(); const k = kw.dataset.kw;
    return popMenu(e, [
      ['🔎 このキーワードで検索', () => { $('#q').value = k; $('#q').dispatchEvent(new Event('input', { bubbles: true })); }],
      ['🗑 このノートから外す', () => { note.keywords = note.keywords.filter(x => x !== k); saveNote(note); renderMeta(note); renderList(); }, true]
    ]);
  }
  if (tin) {
    e.preventDefault(); const t = topics.find(x => x.name === tin.dataset.tin); if (!t) return;
    return popMenu(e, [
      ['📑 開く', () => openTopic(t.name)],
      ['🗑 このトピックから外す', () => { t.text = L.removeFromTopic(L.topicText(t), [{ s: note.s, id: note.id }], L.defOf(t)); saveTopic(t); renderMeta(note); renderList(); }, true]
    ]);
  }
  if (town) {
    e.preventDefault(); const t = topics.find(x => x.name === town.dataset.town); if (!t) return;
    return popMenu(e, [['📑 開く', () => openTopic(t.name)], ['🗑 このトピックを削除', () => deleteTopicNamed(t.name), true]]);
  }
});
// 1つのIDに索引が複数あるとき: ふつうの索引と同じ画面で、一覧を出す。押すと、その索引へ
function openTopicList(s, id, keep) {
  cur = place({ k: 'tlist', s, id }, keep); mode = 'notes';
  const ts = topicsOf(s, id), note = get(s, id);
  const rowOf = t => `<tr><td><span class="chip t" data-topic="${esc(t.name)}">${esc(topicNo(t))} ${esc(stripId(t.name))}</span></td><td class="sub">${esc(L.mergeTopic(t).rows.map(r => r.kw).filter(Boolean).slice(0, 8).join('　'))}</td></tr>`;
  $('#pane').innerHTML = `<div class="row thead"><span class="ti-ic">📑</span><h2>${esc(SP[s] || '')} ${esc(id)}${note ? ' ' + esc(titleOf(note)) : ''}</h2><span class="grow"></span></div>
    <div class="row tmeta">${note ? `<span class="tm"><span class="sub" title="ノート">🌳</span><span class="chip ${s}" data-s="${s}" data-id="${esc(id)}" data-note="1">${s === 'p' ? '紙' : ''}${esc(id)}</span></span>` : ''}</div>
    <table class="ti">${ts.map(rowOf).join('') || '<tr><td class="none">索引はありません</td></tr>'}</table>`;
  renderTabs(); renderList();
}
// ⬆️ 上位を作る: 新しいトピック Index（この索引と同じ親ノートの、次の番号。1-1 の次は 1-2）を作り、この索引に「^名前 番号」、新しい方に「_この名前 番号」を書く
function topicUpDialog(t) {
  if (!t.entry) return alert('親のノートがない索引には、上位を作れません（⚙️ で親を決めてください）');
  $('#modal .box').innerHTML = `<div class="dlg-a"><h3>⬆️ 上位トピックを作る</h3>
    <div class="da-lab">「${esc(topicLabel(t))}」の、上位になる索引の名前</div>
    <input id="tu-name" placeholder="例: 数学">
    <div class="da-bar"><span class="grow"></span><button id="tu-cancel">やめる</button><button id="tu-ok" class="p">⬆️ 作る</button></div></div>`;
  $('#modal').style.display = 'flex'; $('#tu-name').focus();
  const close = () => { $('#modal').style.display = 'none'; };
  $('#tu-cancel').onclick = close;
  $('#tu-ok').onclick = async () => {
    const name = $('#tu-name').value.trim();
    if (!name) return alert('名前を入れてください');
    if (topics.find(x => x.name === name)) return alert('その名前は既にあります');
    const g = { name, entry: t.entry ? { ...t.entry } : null, keyword: '', text: `_${t.name} ${topicNo(t)}` }, sv = await api.saveTopic(g);
    if (!sv) return alert('保存できませんでした');
    g.num = sv === true ? 0 : sv; topics.push(g);
    t.text = L.topicText(t).replace(/\s*$/, '') + `\n^${name} ${topicNo(g)}\n`; saveTopic(t);
    close(); renderList(); openTopic(name, 'view');
  };
  $('#tu-name').onkeydown = e => { if (e.key === 'Enter') $('#tu-ok').click(); };
}
async function topicAct(act) {
  const t = topics.find(x => x.name === cur.name); if (!t) return;
  if (act === 'tedit') return openTopic(t.name, cur.mode === 'edit' ? 'view' : 'edit', true);
  if (act === 'tconf') return openTopic(t.name, 'conf', true);
  if (act === 'tup') return topicUpDialog(t);
  if (act === 'tcancel') return openTopic(t.name, 'view', true);
  if (act === 'tdel') return deleteTopicNamed(t.name);
  if (act === 'tsave') {
    const name = $('#t-name').value.trim(), s = $('#t-s').value, id = $('#t-id').value.trim().toLowerCase();
    if (!name) return alert('名前を入れてください');
    if (name !== t.name && topics.find(x => x.name === name)) return alert('その名前は既にあります');
    if (!get(s, id)) return alert(`${SP[s]} ${id} というノートはありません`);
    const kw = t.keyword || '';   // 点のキーワードは、この画面では変えない（赤い点は、右クリックや ID の前の * で付ける）
    await flush();
    t.keyword = kw;
    await ensureKeyword(s, id, kw);
    const old = t.name; t.name = name; t.entry = { s, id };
    { const sv = await api.saveTopic(t, old); if (sv && sv !== true) t.num = sv; }
    for (const x of tabs) if (x.k === 'topic' && x.name === old) x.name = name;
    openTopic(name, 'view', true);
  }
}

// ===== 日記 =====
// 名前は D_2026-11-07-タイトル。日付が変わるのは朝5時。その日に作ったノートのリンクと、紙の日記の画像は、本文に書き込まれる
const getDiary = (date, kind = '日記') => diaries.find(d => d.date === date && (d.kind || '日記') === kind);
const upsertDiary = (r, since = saves.revision) => {
  const d = getDiary(r.date, r.kind);
  if (d) { if (!saves.has(diaryKey(r)) && !saves.changedSince(diaryKey(r), since)) Object.assign(d, r); return d; }
  diaries.push(r); return r;
};
const setKind = k => { curKind = k; try { localStorage.setItem('pkm-kind', k); } catch { } };
const kindIcon = n => n === '日記' ? '📔' : n === 'メモ帳' ? '🗒️' : '📓';
function diaryList() {
  if (!records.some(r => r.name === curKind)) setKind('日記');
  const kind = curKind, mine = diaries.filter(d => (d.kind || '日記') === kind);
  const dayRow = d => `<div class="day${cur && cur.k === 'diary' && cur.date === d.date && (cur.kind || '日記') === kind ? ' on' : ''}" data-diary="${d.date}" data-kind="${esc(kind)}"><span>${d.date.slice(8)}（${L.weekday(d.date)}）</span><small>${esc(d.title)}${d.pages.length ? ' 📷' : ''}</small></div>`;
  const tree = L.diaryTree(mine.map(d => d.date));
  if (diarySortDir === 'asc') { tree.reverse(); for (const g of tree) { if (g.months) { g.months.reverse(); for (const m of g.months) m.days.reverse(); } else g.days.reverse(); } }   // 昇順: 古い日から
  const grp = (label, inner, open) => `<details${open ? ' open' : ''}><summary>${label}</summary>${inner}</details>`;
  const days = ds => ds.map(x => dayRow(getDiary(x, kind))).join('');
  let first = true;
  const html = tree.map(g => {
    const open = first; first = false;
    return grp(g.label, g.months ? g.months.map((m, i) => grp(m.label, days(m.days), open && i === 0)).join('') : days(g.days), open);
  }).join('');
  const top = `<div class="kp"><button class="kp-sel" data-kindopen title="時系列記録を選ぶ・探す・直す"><span>${kindIcon(kind)} ${esc(kind)}</span><i aria-hidden="true">▾</i></button></div>`;
  return `<div id="dlist">${top}<div class="dtop"><button class="p" id="d-today" title="今日の${esc(kind)}を開く（無ければ作る）">📅 今日</button><input type="date" id="d-pick" value="${L.todayStr()}" title="日付を選ぶと、その日の${esc(kind)}を開きます（無ければ作る）"></div>${html || `<div class="none">${esc(kind)}はまだありません</div>`}</div>`;
}
document.addEventListener('click', e => { if (e.target.closest('[data-kindopen]')) recordsDialog(); });
$('#list').addEventListener('change', e => { if (e.target.id === 'd-pick' && L.isDate(e.target.value)) openDiary(e.target.value); });
$('#list').addEventListener('click', e => {
  if (e.target.id === 'd-today') openDiary(L.todayStr());
});
// 上位の選び方: 印を押して、入れる・外す（いくつでも）
// 記録の種類（日記・夢・ビジネス…）を管理する: 足す・上位・名前を変える・まとめる・消す
// 時系列記録の一覧（選ぶ・探す・直す）。日記とメモ帳は、いつもある。新しく書いたものが上。名前で絞れて、題・本文でも探せる
function recordsDialog() {
  let q = '', at = 0, items = [], edit = null;   // edit: { kind, mode: 'rename' | 'merge' }
  const last = n => diaries.filter(d => (d.kind || '日記') === n).map(d => d.date).sort().pop() || '', count = n => diaries.filter(d => (d.kind || '日記') === n).length;
  const FIXED = ['日記', 'メモ帳'];
  const apply = async (op, ...a) => { await flush(); const r = await api.recordOp(op, ...a); if (r === false) { alert('できませんでした（名前が使えない・すでにある・輪になる、など）'); return false; } const st = await api.state(); applyState(st); records = st.records; return true; };
  const plain = d => Stamp.strip(d.body || '').replace(/^##.*$/gm, '').replace(/\[[^\]]*\]\([^)]*\)/g, '').replace(/^\s*:\S+\s*$/gm, '').trim();
  dialog(`<div class="rd"><input id="rd-q" placeholder="🔎" autocomplete="off" aria-label="時系列記録を探す"><div id="rd-list"></div><div class="rd-add"><input id="rd-new" placeholder="＋ 新しい種類（例: 夢）" autocomplete="off"><button class="p" id="rd-addb" title="足す" aria-label="足す">＋</button></div></div>`, close => {
    const box = $('#rd-list');
    const rank = n => FIXED.indexOf(n) < 0 ? 9 : FIXED.indexOf(n);
    const build = () => {
      const s = q.trim().toLowerCase(), names = records.map(r => r.name);
      const kinds = names.filter(n => !s || n.toLowerCase().includes(s)).map(n => ({ t: 'kind', kind: n, last: last(n) }))
        .sort((a, b) => rank(a.kind) - rank(b.kind) || b.last.localeCompare(a.last) || a.kind.localeCompare(b.kind, 'ja'));
      const days = s ? diaries.filter(d => [d.date, d.title, plain(d), d.kind].join('\n').toLowerCase().includes(s)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(d => ({ t: 'day', kind: d.kind || '日記', date: d.date, title: d.title, text: snippet(plain(d), s).replace(/<[^>]+>/g, '').slice(0, 60) })) : [];
      items = [...kinds, ...days]; if (at >= items.length) at = Math.max(0, items.length - 1);
    };
    const row = (x, i) => {
      if (x.t === 'day') return `<div class="rd-row day${i === at ? ' on' : ''}" data-i="${i}"><span class="rd-ic">${kindIcon(x.kind)}</span><b>${esc(x.kind)}　${esc(x.date)}${x.title ? '　' + esc(x.title) : ''}</b><small>${esc(x.text)}</small></div>`;
      const n = x.kind, r = records.find(y => y.name === n) || {}, ups = FIXED.includes(n) ? [] : (r.parents && r.parents.length ? r.parents : ['日記']);
      if (edit && edit.kind === n) {
        const others = records.map(y => y.name).filter(y => y !== n);
        return `<div class="rd-row edit" data-i="${i}"><span class="rd-ic">${kindIcon(n)}</span>${edit.mode === 'rename' ? `<input id="rd-edit" value="${esc(n)}" autocomplete="off" aria-label="新しい名前">` : `<select id="rd-edit" aria-label="まとめる先">${others.map(y => `<option>${esc(y)}</option>`).join('')}</select>`}<span class="rd-acts on"><button data-act="ok" title="決める">✅</button><button data-act="no" title="やめる">✖️</button></span></div>`;
      }
      const fixed = FIXED.includes(n);
      return `<div class="rd-row${i === at ? ' on' : ''}${n === curKind ? ' cur' : ''}" data-i="${i}"><span class="rd-ic">${kindIcon(n)}</span><b>${esc(n)}</b><small>${ups.length ? '↑ ' + esc(ups.join('・')) + '　' : ''}${count(n)}日${x.last ? '　' + x.last.slice(5) : ''}</small><span class="rd-acts">${FIXED.includes(n) ? '' : `<button data-act="up" title="上位を決める">🔼</button>`}${fixed ? '' : `<button data-act="rename" title="名前を変える">✏️</button><button data-act="merge" title="ほかの記録にまとめる">🔀</button><button data-act="del" title="消す">🗑️</button>`}</span></div>`;
    };
    const draw = () => { build(); box.innerHTML = items.map(row).join('') || '<div class="none">見つかりません</div>'; const on = box.querySelector('.rd-row.on'); if (on) on.scrollIntoView({ block: 'nearest' }); const ed = $('#rd-edit'); if (ed) { ed.focus(); if (ed.select) ed.select(); } };
    const go = i => {
      const x = items[i]; if (!x) return; close();
      setKind(x.kind); mode = 'diary'; $('#q').value = ''; renderList();
      openDiary(x.t === 'day' ? x.date : L.todayStr(), false, x.kind);
    };
    const act = async (n, a) => {
      if (a === 'rename' || a === 'merge') { edit = { kind: n, mode: a }; return draw(); }
      if (a === 'no') { edit = null; return draw(); }
      if (a === 'ok' && edit) {
        const v = ($('#rd-edit').value || '').trim(), e = edit;
        if (!v) return;
        const done = e.mode === 'rename' ? (v !== e.kind && await apply('renameRecord', e.kind, v)) : await apply('mergeRecords', e.kind, v);
        if (done) { if (curKind === e.kind) setKind(v); edit = null; } return draw();
      }
      if (a === 'del') { const c = count(n); if (confirm(`「${n}」を消しますか？\n${c} 日分のノートも、ごみ箱（.trash）に移ります。`) && await apply('deleteRecord', n)) { if (curKind === n) setKind('日記'); } return draw(); }
      if (a === 'up') return parentPickDialog(n, null, () => recordsDialog());
    };
    $('#rd-q').oninput = e => { q = e.target.value; at = 0; edit = null; draw(); };
    $('#rd-q').onkeydown = e => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(items.length - 1, at + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(at); }
    };
    box.onclick = e => { const b = e.target.closest('[data-act]'), r = e.target.closest('[data-i]'); if (b && r) return act(items[+r.dataset.i].kind, b.dataset.act); if (r && !e.target.closest('input,select')) go(+r.dataset.i); };
    box.onkeydown = e => { if (e.target.id !== 'rd-edit') return; if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); act(items[+e.target.closest('[data-i]').dataset.i].kind, 'ok'); } else if (e.key === 'Escape') { e.stopPropagation(); edit = null; draw(); } };
    const add = async () => { const n = $('#rd-new').value.trim(); if (n && await apply('addRecord', n)) { $('#rd-new').value = ''; q = ''; $('#rd-q').value = ''; draw(); } };
    $('#rd-addb').onclick = add; $('#rd-new').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } };
    draw(); $('#rd-q').focus();
  });
}
// 上位を選ぶ窓: 名前で絞って、押すと付け外し（いくつでも）。何も選ばなければ日記。date が無ければ、その種類の初期値
function parentPickDialog(kind, date, onDone) {
  const cur0 = () => date ? ((getDiary(date, kind) || {}).parents || []) : ((records.find(r => r.name === kind) || {}).parents || []);
  let sel = [...cur0()];
  dialog(`<div class="dlg-a"><input id="pp-q" placeholder="🔎" autocomplete="off" aria-label="上位にする記録を探す"><div id="pp-list" class="rs-list"></div><div class="da-bar"><span class="grow"></span><button class="p" id="pp-ok" title="決める">✅</button></div></div>`, close => {
    const q = $('#pp-q'), box = $('#pp-list');
    const finish = () => { close(); if (onDone) onDone(); };
    const draw = () => {
      const s = q.value.trim().toLowerCase(), names = records.map(r => r.name).filter(n => n !== kind && (!s || n.toLowerCase().includes(s)));
      box.innerHTML = names.map(n => `<div class="rs-row${sel.includes(n) ? ' on' : ''}" data-p="${esc(n)}"><b>${sel.includes(n) ? '✅' : '⬜'} ${esc(n)}</b></div>`).join('') || '<div class="none">見つかりません</div>';
    };
    box.onclick = async e => {
      const r = e.target.closest('[data-p]'); if (!r) return;
      const u = r.dataset.p, next = sel.includes(u) ? sel.filter(x => x !== u) : [...sel, u];
      await flush();
      if (date) { const res = await api.recordOp('setDayParent', kind, date, next); if (!res) return alert('その上位にはできません（輪になります）'); upsertDiary(res); applyState(await api.state()); }
      else { const res = await api.recordOp('setRecordParent', kind, next); if (res === false) return alert('その上位にはできません（輪になります）'); const st = await api.state(); applyState(st); records = st.records; }
      sel = [...cur0()]; draw(); if (date) openDiary(date, true, kind);
    };
    $('#pp-ok').onclick = finish; $('#modal').onkeydown = e => { if (e.key === 'Escape') finish(); };
    q.oninput = draw; draw(); q.focus();
  });
}
async function openDiary(date, keep, kind) {
  kind = kind || (cur && cur.k === 'diary' && keep ? cur.kind : curKind) || '日記';
  if (bgOpen) { place({ k: 'diary', date, kind }, false); return; }
  let d = getDiary(date, kind);
  if (!d || !keep) { // 開くとき、その日に作ったノートで足りないリンクを足す。無い日は作る
    await flush();
    const since = saves.revision, r = await api.openDiary(date, kind); if (!r) return;
    d = upsertDiary(r, since);
  }
  setKind(kind);
  cur = place({ k: 'diary', date, kind }, keep); mode = 'diary';
  const mine = diaries.filter(x => (x.kind || '日記') === kind).map(x => x.date).sort(), idx = mine.indexOf(date);
  const lower = (d.lower || []).map(k => `<span class="chip t" data-dkind="${esc(k)}">${esc(k)}</span>`).join('');
  $('#pane').innerHTML = `
    <div class="row">
      <button class="dh-kind" data-kindopen title="時系列記録を選ぶ・探す・直す">${kindIcon(kind)} ${esc(kind)}</button>
      <h2 style="margin:0">${date}（${L.weekday(date)}）</h2>
      <input class="kw" id="d-title" style="flex:1;min-width:140px;margin:0" value="${esc(d.title)}" placeholder="タイトル">
      <button data-act="dprev" class="ic dj" title="前の${esc(kind)}" aria-label="前">⬅️</button><button data-act="dnext" class="ic dj" title="次の${esc(kind)}" aria-label="次">➡️</button>
      <button data-act="table" class="ic dj" title="表を入れる" aria-label="表">📊</button><button data-act="board" class="ic dj" title="ボードを入れる（Ctrl+G）文字と線を、紙のように書ける" aria-label="ボード">🖍️</button>
      <button data-act="attach" class="ic dj" title="ファイルを添付（ドラッグや貼り付けでも）" aria-label="添付">📎</button>
      <button data-act="ddel" class="ic dj" title="この日の記録を削除" aria-label="削除">🗑️</button>
    </div>
    ${kind !== '日記' && kind !== 'メモ帳' ? `<div class="row sub" title="上位の時系列記録（選ぶと変えられる）"><span class="dh-upl" aria-hidden="true">↑</span>${(d.parents && d.parents.length ? d.parents : ['日記']).map(r => `<span class="rchip on" data-dparpick>${esc(r)}</span>`).join('')}<button class="dh-pen" data-dparpick title="上位を選ぶ" aria-label="上位を選ぶ">✏️</button></div>` : ''}
    <div class="ed" id="ed"></div>`;
  const view = editor($('#ed'), d.body, 'note', 'd', v => { d.body = v; saveDiary(d); },
    kind === '日記' ? '今日のこと。書いたノートのリンクは、下の「今日のノート」に自動で入ります' : `今日の${kind}`, () => d.body, true);
  $('#d-title').oninput = e => { d.title = e.target.value; saveDiary(d); renderList(); };
  document.querySelectorAll('[data-dparpick]').forEach(c => c.onclick = () => parentPickDialog(kind, date));
  renderTabs(); renderList();
  // 自由に書く部分（最初の「## 」より前）にカーソル。節で始まる日記は、その前に空行を足して書く場所を作る
  let text = view.state.doc.toString(), base = 0;
  const ls = text.split('\n');
  if (ls[0].trim() === '## 今日の記録') { let j = 1; while (j < ls.length && (!ls[j].trim() || /^\s*(-\s+)?\[[^\]]*\]\([^)]*\)\s*$/.test(ls[j]))) j++; base = ls.slice(0, j).join('\n').length + (j < ls.length ? 1 : 0); }   // 一番上の「今日の記録」の下が、書く場所
  if (/^## /.test(text.slice(base))) { view.dispatch({ changes: { from: base, insert: base > 0 ? '\n\n' : '\n\n\n' } }); text = view.state.doc.toString(); }   // 本文は onChange で d.body に入る（上下に空行）
  const h2 = text.slice(base).search(/^## /m), at = h2 > 0 ? base + h2 - 2 : text.length; // 見出しの前の、真ん中の空行
  if (cur.pos != null && keep) view.dispatch({ selection: { anchor: Math.min(cur.pos, view.state.doc.length) } });
  else { view.dispatch({ selection: { anchor: at } }); view.focus(); }
}
$('#pane').addEventListener('click', e => { const k = e.target.closest('[data-dkind]'); if (k && cur && cur.k === 'diary') openDiary(cur.date, false, k.dataset.dkind); });
async function diaryAct(act) {
  const kind = cur.kind || '日記', d = getDiary(cur.date, kind), dates = diaries.filter(x => (x.kind || '日記') === kind).map(x => x.date).sort(), i = dates.indexOf(cur.date);
  if (act === 'dprev' && i > 0) openDiary(dates[i - 1], false, kind);
  if (act === 'dnext' && i < dates.length - 1) openDiary(dates[i + 1], false, kind);
  if (act === 'ddel') {
    if (!confirm(`${cur.date} の${kind}を削除しますか？（ファイルは .trash に移ります。紙の日記の画像は残ります）`)) return;
    await flush(); await api.deleteDiary(cur.date, kind);
    diaries = diaries.filter(x => x !== d);
    for (let k = tabs.length - 1; k >= 0; k--) if (tabs[k].k === 'diary' && tabs[k].date === cur.date && (tabs[k].kind || '日記') === kind) { tabs.splice(k, 1); if (active >= k) active--; }
    return show(Math.max(0, active));
  }
  if (act === 'attach') pick(true, f => attach(d, f), '*');
  if (act === 'table') insertTable();
  if (act === 'board') insertBoard();
  if (act === 'stampmode') toggleStamp(lastView);
}
function insertBoard() {
  if (!lastView) return;
  const v = lastView, h = v.state.selection.main.head, at = v.state.doc.lineAt(h), pre = h === at.from ? '' : '\n', ins = pre + boardTemplate;
  v.dispatch({ changes: { from: h, insert: ins }, selection: { anchor: h + ins.length } }); focusBoardAt(v, h + pre.length);
}
function insertTable() {
  if (!lastView) return;
  const v = lastView, h = v.state.selection.main.head, at = v.state.doc.lineAt(h), ins = (h === at.from ? '' : '\n') + tableTemplate;
  v.dispatch({ changes: { from: h, insert: ins }, selection: { anchor: h + ins.length } }); focusTableAt(v, h + (h === at.from ? 0 : 1));
}

// ===== スキャン取り込み（紙）=====
function pick(multi, cb, accept = 'image/*') {
  const f = document.createElement('input'); f.type = 'file'; f.accept = accept; f.multiple = multi;
  f.onchange = () => f.files.length && cb([...f.files]); f.click();
}
function shrink(file, max = 2000) {
  return new Promise(ok => {
    const u = URL.createObjectURL(file), im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k;
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      c.toBlob(async b => { URL.revokeObjectURL(u); ok(await b.arrayBuffer()); }, 'image/jpeg', .85);
    };
    im.src = u;
  });
}
// 取り込み画面: 左に画像と、並んだ全部の小さな画像（✅=済み ⏭️=飛ばした 📔=日記）。右に ID・キーワード。キーだけで、どんどん進める
//   Enter 保存して次へ ／ Ctrl+H 次(↔️) ／ Ctrl+B 子(🌱) ／ Ctrl+U 親の次(⤴️) ／ Ctrl+K 前と同じキーワード ／ Ctrl+S 飛ばす ／ Ctrl+D 日記へ ／ Ctrl+E 拡大 ／ PageUp/PageDown 画像を移る ／ Esc 閉じる
let queue = [], qi = 0, lastId = '', lastKws = '', lastDiary = '';
let scanSt = [], scanThumbs = [], scanBusy = false, scanBatch = '', scanTimer = null;
const startScan = fs => {
  queue = [...fs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  scanThumbs.forEach(u => URL.revokeObjectURL(u)); scanThumbs = queue.map(f => URL.createObjectURL(f));
  scanSt = queue.map(() => ''); qi = 0; scanBatch = ''; lastKws = ''; lastDiary = ''; $('#sc-date').value = '';
  $('#scan').style.display = 'flex'; $('#scan').classList.remove('zoomed'); showScan();
};
$('#imp').onclick = () => pick(true, startScan);
// スマホで撮った紙のカード: 📷 を押すと、取り込み画面で、番号を付けられる
async function refreshPhonePapers() {
  const n = await api.phonePapersCount().catch(() => 0), b = $('#phone-papers'); if (!b) return;
  b.hidden = !n; b.textContent = '📷' + (n ? ` ${n}` : ''); b.title = `スマホで撮った紙のカード ${n} 枚（押すと、取り込み画面）`;
}
$('#phone-papers').onclick = async () => {
  const list = await api.phonePapers(); if (!list.length) return refreshPhonePapers();
  startScan(list.map(p => { const f = new File([p.bytes], p.name, { type: /png$/i.test(p.name) ? 'image/png' : 'image/jpeg' }); f._phone = true; return f; }));
};
refreshPhonePapers();
const scanNext = from => { for (let i = Math.max(0, from); i < queue.length; i++) if (!scanSt[i]) return i; return -1; };
const scanPrevious = from => { for (let i = from; i >= 0; i--) if (!scanSt[i]) return i; return -1; };
const scanSuggest = {
  sib: () => free('p', lastId ? L.sibling(lastId) : '1'),
  chi: () => lastId ? free('p', L.child(lastId)) : '1',
  up: () => { if (!lastId) return '1'; const p = L.parentIn(lastId, () => true); return free('p', L.sibling(p || lastId)); }
};
function scanFlash(text) { const m = $('#sc-msg'); m.textContent = text; m.className = 'ok'; clearTimeout(scanTimer); scanTimer = setTimeout(() => { m.textContent = ''; }, 2500); }
function scanCheck() {   // ID が使えるか。✅ / ❌ と、枠の色で見せる
  const id = $('#sc-id').value.trim().toLowerCase(), box = $('#sc-id');
  const bad = !id ? '' : !L.isId(id) ? 'IDの形が違います（例: 2a1）' : get('p', id) ? `紙 ${id} は、もうあります` : '';
  const ok = !!id && !bad;
  $('#sc-mark').textContent = !id ? '' : ok ? '✅' : '❌';
  box.classList.toggle('good', ok); box.classList.toggle('bad', !!id && !ok);
  $('#sc-hint').textContent = bad || (lastId ? `直前 紙 ${lastId}` : '最初の1枚');
  $('#sc-hint').classList.toggle('bad', !!bad);
  return ok;
}
function scanStrip() {
  $('#sc-strip').innerHTML = queue.map((f, i) => `<button class="sc-th${i === qi ? ' on' : ''}${scanSt[i] === 'done' || scanSt[i] === 'diary' ? ' done' : ''}" data-sc-i="${i}" title="${esc(f.name)}" tabindex="-1"><img src="${scanThumbs[i]}" alt="">${scanSt[i] === 'done' ? '<i>✅</i>' : scanSt[i] === 'diary' ? '<i>📔</i>' : scanSt[i] === 'skip' ? '<i>⏭️</i>' : ''}</button>`).join('');
  const on = $('#sc-strip .on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
}
function showScan() {
  if (qi < 0 || qi >= queue.length || scanSt[qi]) qi = scanNext(qi + 1) >= 0 ? scanNext(qi + 1) : scanNext(0);
  if (qi < 0) return closeScan();
  const finished = scanSt.filter(Boolean).length;
  $('#sc-n').textContent = `${finished + 1} / ${queue.length}`;
  $('#sc-bar-i').style.width = Math.round(finished / queue.length * 100) + '%';
  $('#sc-img').src = scanThumbs[qi]; $('#scan').classList.remove('zoomed');
  $('#sc-id').value = scanSuggest.sib(); $('#sc-kw').value = '';
  $('#q-sib').textContent = scanSuggest.sib(); $('#q-chi').textContent = scanSuggest.chi(); $('#q-up').textContent = scanSuggest.up();
  if (!$('#sc-date').value && lastDiary) $('#sc-date').value = lastDiary;   // 同じ日の紙の日記が続くときだけ、前の日付が残る。今日には、勝手にしない
  const recent = [...new Set([...L.splitKw(lastKws), ...allKeywords().slice(0, 40)])].slice(0, 12);
  $('#sc-kwchips').innerHTML = recent.map(k => `<span class="sc-kc" data-sc-kw="${esc(k)}" tabindex="-1">${esc(k)}</span>`).join('');
  scanStrip(); scanCheck();
  $('#sc-id').focus(); $('#sc-id').select();
}
async function scanOk() {
  if (scanBusy) return;
  if (!scanCheck()) { $('#sc-id').focus(); return; }
  scanBusy = true;
  try {
    const id = $('#sc-id').value.trim().toLowerCase(), srcFile = queue[qi];
    await api.saveImage('p', id, await shrink(queue[qi]));
    const kws = L.splitKw($('#sc-kw').value);
    for (const k of kws) if (!readings[k]) { readings[k] = await api.suggest(k); await api.setReading(k, readings[k]); }
    const n = await api.saveNote({ s: 'p', id, keywords: kws, body: '' });
    notes.push(n); lastId = id; lastKws = kws.join('、'); scanSt[qi] = 'done'; scanBatch = 'note'; if (srcFile._phone) api.phonePaperDone(srcFile.name);   // スマホの写真は、ノートにしたら、PC の置き場から外す
    scanFlash(`✅ 紙 ${id} を保存しました`); renderList();
    qi = scanNext(qi + 1) >= 0 ? scanNext(qi + 1) : scanNext(0); showScan();
  } finally { scanBusy = false; }
}
async function diaryScanOk() { // 紙の日記: ID は付けず、日付の日記の最後に入れる
  if (scanBusy) return;
  const date = $('#sc-date').value;
  if (!L.isDate(date)) { scanFlash('日付を入れてください'); $('#sc-msg').className = 'bad'; return $('#sc-date').focus(); }
  scanBusy = true;
  try {
    const srcFile = queue[qi];
    upsertDiary(await api.addDiaryScan(date, await shrink(queue[qi])));
    if (srcFile._phone) api.phonePaperDone(srcFile.name);
    lastDiary = date; scanSt[qi] = 'diary'; scanBatch = 'diary'; scanFlash(`📔 ${date} の日記に入れました`); renderList();
    qi = scanNext(qi + 1) >= 0 ? scanNext(qi + 1) : scanNext(0); showScan();
  } finally { scanBusy = false; }
}
function scanSkip() { scanSt[qi] = 'skip'; qi = scanNext(qi + 1) >= 0 ? scanNext(qi + 1) : scanNext(0); showScan(); }
function scanGo(dir) {
  const to = dir > 0 ? scanNext(qi + 1) : scanPrevious(qi - 1);
  if (to < 0) return; qi = to; showScan();
}
function closeScan() {
  refreshPhonePapers();
  clearTimeout(scanTimer); $('#scan').style.display = 'none';
  scanThumbs.forEach(u => URL.revokeObjectURL(u)); scanThumbs = [];
  if (scanBatch === 'diary' && lastDiary) { renderList(); return openDiary(lastDiary); }
  if (scanBatch === 'note') { tab = 'p'; mode = 'notes'; renderList(); if (lastId && get('p', lastId)) openNote('p', lastId); return; }
  renderList();
}
$('#sc-save').onclick = scanOk;
$('#sc-diary').onclick = () => { if (!L.isDate($('#sc-date').value)) { $('#sc-date').focus(); return scanFlash('日記の日付を入れて、Enter'); } diaryScanOk(); };
$('#sc-skip').onclick = scanSkip;
$('#sc-close').onclick = closeScan;
$('#sc-id').addEventListener('input', scanCheck);
$('#scan').addEventListener('click', e => {
  const q = e.target.closest('[data-sc-q]'); if (q) { $('#sc-id').value = scanSuggest[q.dataset.scQ](); scanCheck(); $('#sc-id').focus(); return; }
  const kc = e.target.closest('[data-sc-kw]'); if (kc) { const cur = L.splitKw($('#sc-kw').value); if (!cur.includes(kc.dataset.scKw)) cur.push(kc.dataset.scKw); $('#sc-kw').value = cur.join('、'); $('#sc-kw').focus(); return; }
  const th = e.target.closest('[data-sc-i]'); if (th) { const i = +th.dataset.scI; if (scanSt[i] === 'done' || scanSt[i] === 'diary') return; if (scanSt[i] === 'skip') scanSt[i] = ''; qi = i; showScan(); return; }
  if (e.target.closest('#sc-img')) { $('#scan').classList.toggle('zoomed'); $('#sc-id').focus(); }
});
$('#scan').onkeydown = e => {
  const ctl = e.ctrlKey || e.metaKey;
  if ((e.isComposing || e.keyCode === 229) && !ctl) return;   // 日本語入力の変換中でも、Ctrl つきのキーは効かせる
  const alt = ctl && !e.altKey && !e.shiftKey, k = /^Key[A-Z]$/.test(e.code || '') ? e.code.slice(3).toLowerCase() : e.key.toLowerCase(), stop = () => { e.preventDefault(); e.stopPropagation(); };   // 文字は、キーの位置（KeyD など）で見る。日本語入力がオンでも同じ
  if (e.key === 'Enter') { stop(); if (e.target.id === 'sc-date') diaryScanOk(); else scanOk(); }   // 日付の欄で Enter なら、紙の日記に入れる
  else if (e.key === 'Escape') { stop(); if (e.target.id === 'sc-date') { $('#sc-id').focus(); } else closeScan(); }
  else if (alt && k === 'h') { stop(); $('#sc-id').value = scanSuggest.sib(); scanCheck(); $('#sc-id').focus(); }
  else if (alt && k === 'b') { stop(); $('#sc-id').value = scanSuggest.chi(); scanCheck(); $('#sc-id').focus(); }
  else if (alt && k === 'u') { stop(); $('#sc-id').value = scanSuggest.up(); scanCheck(); $('#sc-id').focus(); }
  else if (alt && k === 'k') { stop(); $('#sc-kw').value = lastKws; }
  else if (alt && k === 's') { stop(); scanSkip(); }
  else if (alt && k === 'd') { stop(); $('#sc-date').focus(); scanFlash('日記の日付を入れて、Enter（Esc で戻る）'); }   // 勝手に今日にしない。日付を決めてから Enter
  else if (alt && k === 'e') { stop(); $('#scan').classList.toggle('zoomed'); }
  else if (e.key === 'PageDown') { stop(); scanGo(1); }
  else if (e.key === 'PageUp') { stop(); scanGo(-1); }
};

// ===== 保存フォルダ =====
// 初めて起動したとき: 保存先（vault）を選ぶ。既存のフォルダを開く／新しく作る
function firstRun(st) {
  dialog(`<h3>ようこそ。YuriiNote の保存先を選びます</h3>
    <div class="sub">ノートは、普通のフォルダ（vault）に、md ファイルとして入ります。あとで、右上の 📁 からも変えられます。フォルダごと別の PC にコピーしても、全部そのまま使えます。</div>
    ${st.found.length ? `<div class="sub">見つかった vault（押すと、これを開きます）</div>${st.found.map(p => `<div class="row"><button data-vp="${esc(p)}" style="flex:1;text-align:left">📁 ${esc(p)}</button></div>`).join('')}` : ''}
    <div class="row"><span>言語 / Language</span><select id="fr-lang"><option value="en">English</option><option value="ja">日本語</option></select></div>
    <div class="row"><button class="p" data-vp="${esc(st.suggest)}" style="flex:1">✨ 新しく作る（${esc(st.suggest)}）</button></div>
    <div class="row"><button id="vp-pick" style="flex:1">📂 フォルダを選ぶ（既存の vault を開く・新しい場所に作る）</button></div>`, close => {
    $('#modal').onkeydown = null;
    $('#fr-lang').onchange = e => { pendingLang = e.target.value; setLang(pendingLang); };
    $('#modal .box').onclick = async e => { const b = e.target.closest('[data-vp]'); if (!b) return; const r = await api.useVault(b.dataset.vp); if (r) { close(); loaded(r); } };
    $('#vp-pick').onclick = async () => { const r = await api.chooseVault(); if (r) { close(); loaded(r); } };
  });
}
function loaded(st) {
  if (st && st.firstRun) return firstRun(st);
  if (st && st.warnings && st.warnings.length) setTimeout(() => alert(st.warnings.join('\n\n')), 300);   // 壊れたファイルを控えから戻したときなど
  loadSettings(st);
  if (pendingLang) { settings.lang = pendingLang; pendingLang = null; saveSettings(); }
  vault = st.vault; recovery = new Persistence.RecoveryJournal(localStorage, vault); restoreRecovery(st);
  LC.init(st.docs || {});
  ({ notes, topics, vault } = st); readings = st.readings || {}; diaries = st.diaries || []; records = st.records || records; PI.init(st.docs || {}); cur = null; tabs = []; active = -1; refreshFiles();
  $('#vault').textContent = '📁 ' + vault.split('/').pop(); $('#vault').title = vault + '\n（Brave では Index.md を開くと全部たどれます）';
  try {
    const saved = JSON.parse(localStorage.getItem('pkm-tabs:' + vault) || 'null');
    if (saved) {
      tabs = saved.tabs.filter(t => t.k === 'empty' || (t.k === 'note' && get(t.s, t.id)) || (t.k === 'topic' && topics.find(x => x.name === t.name)) || (t.k === 'diary' && getDiary(t.date, t.kind)));
      tabs.forEach(t => { if (t.k === 'topic') t.mode = 'view'; });
      active = Math.min(saved.active, tabs.length - 1);
    }
  } catch { tabs = []; active = -1; }
  show(active);
}
// 左下のメニュー: USB取り込みと設定。
$('#more').onclick = () => {
  const r = $('#more').getBoundingClientRect();
  popMenu({ clientX: r.right + 8, clientY: r.top - 80 }, [
    ['📱 スマホ取り込み', phoneImport],
    ['⚙️ 設定…', settingsDialog]
  ]);
};
$('#stamp-toggle').onclick = () => toggleStamp(lastView);
// ⏱️ を右クリック: 時刻の見せ方（全部、または、名前をつけて保存したカスタム）。保存は、いつも秒まで
$('#stamp-toggle').oncontextmenu = e => {
  e.preventDefault(); const P = stampPresets(), r = $('#stamp-toggle').getBoundingClientRect(), mark = on => on ? '✔ ' : '　 ', sample = '2026-11-13 12:54:30';
  popMenu({ clientX: Math.max(8, r.right - 260), clientY: r.bottom + 4 }, [
    [mark(stampsShown()) + '行ごとの時刻を表示', () => toggleStamp(lastView)],
    [mark(P.current === 'all') + '全部（' + sample + '）', () => useStampPreset('all')],
    ...P.list.map(x => [mark(P.current === x.name) + x.name + '（' + Stamp.format(sample, x) + '）', () => useStampPreset(x.name)]),
    ['＋ カスタムを作る…', () => stampPresetDialog(null)],
    ...(P.current !== 'all' ? [[`✏️ 「${P.current}」を直す…`, () => stampPresetDialog(P.current)], [`🗑️ 「${P.current}」を消す`, () => deleteStampPreset(P.current), true]] : [])
  ]);
};
// カスタムの見せ方を作る・直す（名前をつけて保存。選んだものは、PC のどのノートでも使われる）
function stampPresetDialog(name) {
  const P = stampPresets(), old = name ? P.list.find(x => x.name === name) : null, f0 = Stamp.normFmt(old || { y: true, mo: true, d: true, h: true, mi: true, s: false });
  const sample = '2026-11-13 12:54:30', cb = (id, label, on) => `<label class="rad"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${label}</label>`;
  $('#modal .box').innerHTML = `<div class="dlg-a">
    <h3>⏱️ 時刻のカスタム</h3>
    <div class="da-lab">名前</div><input id="sp-name" value="${esc(old ? old.name : '')}" placeholder="例: 時分だけ" autocomplete="off">
    <div class="da-lab">出す部分</div>
    <div class="da-bar" style="flex-wrap:wrap;gap:10px">${cb('sp-y', '年', f0.y)}${cb('sp-mo', '月', f0.mo)}${cb('sp-d', '日', f0.d)}${cb('sp-h', '時', f0.h)}${cb('sp-mi', '分', f0.mi)}${cb('sp-s', '秒', f0.s)}</div>
    ${cb('sp-ja', '「2026年11月13日 12時54分30秒」の書き方にする', f0.ja)}
    <div class="da-bar"><span class="sub">日付の区切り</span><input id="sp-dsep" value="${esc(f0.dsep)}" style="width:3.5em"><span class="sub">時刻の区切り</span><input id="sp-tsep" value="${esc(f0.tsep)}" style="width:3.5em"></div>
    ${cb('sp-short', '今日の行は、日付を省く', f0.short)}
    <div class="da-lab">見え方</div><div id="sp-prev" style="font-size:15px;padding:6px 2px"></div>
    <div class="da-bar"><span class="grow"></span><button id="sp-no">やめる</button><button id="sp-ok" class="p">保存</button></div></div>`;
  $('#modal').style.display = 'flex';
  const close = () => { $('#modal').style.display = 'none'; };
  const read = () => ({ name: $('#sp-name').value.trim(), y: $('#sp-y').checked, mo: $('#sp-mo').checked, d: $('#sp-d').checked, h: $('#sp-h').checked, mi: $('#sp-mi').checked, s: $('#sp-s').checked, ja: $('#sp-ja').checked, dsep: $('#sp-dsep').value, tsep: $('#sp-tsep').value, short: $('#sp-short').checked });
  const prev = () => { const f = read(); $('#sp-prev').innerHTML = esc(Stamp.format(sample, f) || '（何も出ません）') + ' <span class="sub">／昨日の行: ' + esc(Stamp.format('2026-11-12 09:05:07', f)) + '</span>'; };
  $('#modal .box').oninput = prev; $('#modal .box').onchange = prev; prev();
  $('#sp-no').onclick = close; $('#modal').onkeydown = ev => { if (ev.key === 'Escape') close(); };
  $('#sp-ok').onclick = () => { const f = read(); if (!f.name || f.name === 'all' || f.name === '全部') return toast('名前を入れてください（「全部」は使えません）'); saveStampPreset(f); close(); toast(`⏱️ 「${f.name}」を保存して、使います`); };
  $('#sp-name').focus();
}

// ===== 設定（vault の中の K_settings.json に。vault を別の PC に写しても、同じ見た目・同じ設定）=====
const DEFAULT_SETTINGS = { autoPhone: true, lang: 'en', theme: 'light', accent: '#3b5bdb', scale: 100, bodySize: 16, uiFont: '', bodyFont: 'default', bodyFontCustom: '', dayStart: 5 };
let settings = { ...DEFAULT_SETTINGS };
const ACCENTS = ['#3b5bdb', '#0b7285', '#2f9e44', '#e67700', '#c0392b', '#a61e4d', '#7048e8', '#495057'];
const BODY_FONTS = { default: '', serif: '"Noto Serif JP","Hiragino Mincho ProN","Yu Mincho",serif', mono: 'ui-monospace,"SFMono-Regular",Menlo,Consolas,monospace' };
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
function applySettings() {
  const r = document.documentElement, s = settings;
  r.style.setProperty('--acc', s.accent);
  document.body.style.zoom = String((s.scale || 100) / 100);
  r.style.setProperty('--bodysize', (s.bodySize || 16) + 'px');
  if (s.uiFont) r.style.setProperty('--uifont', s.uiFont); else r.style.removeProperty('--uifont');
  const bf = s.bodyFont === 'custom' ? s.bodyFontCustom : BODY_FONTS[s.bodyFont] || '';
  if (bf) r.style.setProperty('--bodyfont', bf); else r.style.removeProperty('--bodyfont');
  r.classList.toggle('dark', s.theme === 'dark' || (s.theme === 'auto' && darkMq.matches));
  if (applyLang) applyLang(s.lang);
}
darkMq.addEventListener('change', () => { if (settings.theme === 'auto') applySettings(); });
const applyLang = setLang;   // 言語の切り替え（src/i18n.js）
setLang('en');
const saveSettings = () => { applySettings(); api.saveDoc('K_settings', settings); };
function loadSettings(st) {
  mainDots = ((st.docs || {})['K_mainDots'] || {}).dots || {}; settings = { ...DEFAULT_SETTINGS, ...((st.docs || {})['K_settings'] || {}) }; applySettings(); }
function settingsDialog() {
  const sw = settings;
  dialog(`<div class="sdlg"><h3>⚙️ 設定</h3>
    <div class="sec"><b>言語・保存先</b>
      <div class="srow"><span>言語</span><select id="s-lang"><option value="en"${sw.lang === 'en' ? ' selected' : ''}>English</option><option value="ja"${sw.lang === 'ja' ? ' selected' : ''}>日本語</option></select></div>
      <div class="srow"><span>保存先（vault）</span><code style="flex:1;word-break:break-all">${esc(vault)}</code><button id="s-vault">変える…</button></div>
      <div class="srow"><span>日付が変わる時刻</span><input type="number" id="s-day" min="0" max="12" value="${sw.dayStart}" style="width:60px"> 時</div></div>
    <div class="sec"><b>見た目</b>
      <div class="srow"><span>テーマ</span>${[['light', '明るい'], ['dark', '暗い'], ['auto', 'OS に合わせる']].map(([k, l]) => `<label><input type="radio" name="s-theme" value="${k}"${sw.theme === k ? ' checked' : ''}> ${l}</label>`).join('')}</div>
      <div class="srow"><span>アクセントの色</span>${ACCENTS.map(c => `<i class="sw${sw.accent.toLowerCase() === c ? ' on' : ''}" data-sw="${c}" style="background:${c}"></i>`).join('')}<input type="color" id="s-acc" value="${esc(sw.accent)}" title="好きな色"></div>
      <div class="srow"><span>画面全体の大きさ</span><input type="range" id="s-scale" min="80" max="150" step="5" value="${sw.scale}"><output id="s-scale-o">${sw.scale}%</output></div>
      <div class="srow"><span>本文の文字の大きさ</span><input type="range" id="s-body" min="12" max="28" step="1" value="${sw.bodySize}"><output id="s-body-o">${sw.bodySize}px</output></div>
      <div class="srow"><span>画面の文字（フォント）</span><input type="text" id="s-uifont" placeholder="空なら OS の標準。例: Noto Sans JP" value="${esc(sw.uiFont)}" style="flex:1"></div>
      <div class="srow"><span>本文のフォント</span><select id="s-bf"><option value="default"${sw.bodyFont === 'default' ? ' selected' : ''}>画面と同じ</option><option value="serif"${sw.bodyFont === 'serif' ? ' selected' : ''}>明朝</option><option value="mono"${sw.bodyFont === 'mono' ? ' selected' : ''}>等幅</option><option value="custom"${sw.bodyFont === 'custom' ? ' selected' : ''}>好きな名前</option></select><input type="text" id="s-bfc" placeholder="フォント名" value="${esc(sw.bodyFontCustom)}" style="flex:1"></div></div>
    <div class="sec"><b>URLプレビュー</b><div class="srow"><button id="s-url-refresh">URLプレビュー情報を再取得</button><span id="s-url-progress" role="status"></span></div></div>
    <div class="sec"><b>スマホ</b><div class="srow"><span>つないだら、自動で取り込む・アプリを更新する</span><label class="nm-sw"><input type="checkbox" id="s-autophone" ${sw.autoPhone !== false ? 'checked' : ''}><i></i></label></div><div class="srow"><button id="s-phone">スマホにアプリを入れる…（USB）</button></div></div>
    <div class="sec"><b>アプリ</b><div class="srow"><span id="s-ver" class="sub"></span><button id="s-upd">更新を確認</button><button id="s-short">ショートカットを作る</button><button id="s-gh">GitHub を開く</button></div></div>
    <div class="row"><span class="grow"></span><button class="p" id="s-close">閉じる</button></div></div>`, close => {
    const set = (k, v) => { settings[k] = v; saveSettings(); };
    api.appInfo().then(i => { $('#s-ver').textContent = 'YuriiNote ' + i.version; $('#s-upd').onclick = () => checkUpdate(i); $('#s-short').style.display = i.platform === 'win32' ? 'none' : ''; });
    $('#s-url-refresh').onclick = async () => { $('#s-url-progress').textContent = '取得中…'; try { const p = await api.urlRefresh(); $('#s-url-progress').textContent = `${p.done}/${p.total}件・失敗${p.failed}件`; } catch { $('#s-url-progress').textContent = '取得できませんでした'; } };
    api.urlStatus?.().then(p => { if (p && $('#s-url-progress')) $('#s-url-progress').textContent = `${p.done}/${p.total}件・失敗${p.failed}件`; });
    $('#s-close').onclick = close; $('#modal').onkeydown = e => { if (e.key === 'Escape') close(); };
    $('#s-lang').onchange = e => { set('lang', e.target.value); close(); settingsDialog(); };
    $('#s-vault').onclick = async () => { await flush(); const st = await api.chooseVault(); if (st) { close(); loaded(st); } };
    $('#s-day').onchange = e => set('dayStart', Math.max(0, Math.min(12, +e.target.value || 0)));
    document.querySelectorAll('input[name=s-theme]').forEach(r => r.onchange = () => set('theme', r.value));
    document.querySelectorAll('[data-sw]').forEach(i => i.onclick = () => { set('accent', i.dataset.sw); document.querySelectorAll('[data-sw]').forEach(x => x.classList.toggle('on', x === i)); $('#s-acc').value = i.dataset.sw; });
    $('#s-acc').oninput = e => { set('accent', e.target.value); document.querySelectorAll('[data-sw]').forEach(x => x.classList.remove('on')); };
    $('#s-scale').oninput = e => { $('#s-scale-o').textContent = e.target.value + '%'; set('scale', +e.target.value); };
    $('#s-body').oninput = e => { $('#s-body-o').textContent = e.target.value + 'px'; set('bodySize', +e.target.value); };
    $('#s-uifont').onchange = e => set('uiFont', e.target.value.trim());
    $('#s-bf').onchange = e => set('bodyFont', e.target.value); $('#s-bfc').onchange = e => { settings.bodyFont = 'custom'; $('#s-bf').value = 'custom'; set('bodyFontCustom', e.target.value.trim()); };
    $('#s-autophone').onchange = e => set('autoPhone', e.target.checked);
    $('#s-phone').onclick = phoneInstall; $('#s-gh').onclick = () => api.openUrl('https://github.com/Yurii7812/YuriiNote');
    $('#s-short').onclick = async () => toast(await api.installShortcuts());
  });
}
// スマホにアプリを入れる（USB でつないだスマホに、adb で）
api.onPhoneMsg(m => toast(m));
api.onUrlProgress?.(p => { const el = $('#s-url-progress'); if (el) el.textContent = `${p.done}/${p.total}件・失敗${p.failed}件`; });
async function phoneInstall() {
  if (!confirm('スマホを USB ケーブルでつないで、「USBデバッグ」をオンにしてから、OK を押してください。\nスマホに YuriiNote のメモのアプリを入れます。')) return;
  toast('入れています…');
  const r = await api.phoneInstall();
  alert(r.message);
}
// スマホのメモを取り込む（USB）。メモは「未整理」へ。日記・記録のトピックは、その日のノートへ。番号つきのスキャンは、紙のノートへ
api.onPhoneAuto(async m => {   // スマホがつながったら、自動で取り込み・更新（main.js の phoneTick）
  if (m.say) return toast(m.say);
  if (m.ok && m.state) {
    try {
      const since = saves.revision; await flush(); const st = await api.state();
      applyState(st, since); refreshFiles(); refreshPhonePapers();
    } catch { toast('保存が完了していないため、取り込み結果の表示を保留しています'); }
  }
  if (m.message && !m.quiet) toast(m.message);
});
async function phoneImport() {
  await flush();
  toast('スマホのメモを読んでいます…');
  const r = await api.phoneImport();
  if (r.ok) {
    const since = saves.revision; await flush(); const st = await api.state();
    applyState(st, since); refreshFiles(); refreshPhonePapers();
  }
  alert(r.message);
}
async function checkUpdate(info) {
  toast('更新を確認しています…');
  const c = await api.checkUpdate();
  if (!c.ok) return alert('確認できませんでした: ' + c.error);
  if (c.none) return alert('まだ公開されたバージョンがありません。');
  if (!c.newer) return alert(`最新です（${c.current}）`);
  const what = info.mode === 'git' ? `新しい変更があります（${c.latest}）` : `新しいバージョンがあります: ${c.current} → ${c.latest}`;
  const how = info.selfUpdate ? '今すぐ更新しますか？（更新したら、アプリを開き直してください）' : '最新のインストーラーのページを開きますか？（ダウンロードして実行すると更新されます）';
  if (!confirm(`${what}\n\n${how}`)) return;
  toast(info.selfUpdate ? '更新しています…（少し待ってください）' : 'ページを開きます…');
  await flush(); const r = await api.doUpdate();
  alert(r.ok ? r.message : '更新できませんでした: ' + r.error);
}
$('#vault').onclick = async () => { await flush(); const st = await api.chooseVault(); if (st) loaded(st); };
api.load().then(loaded);
window.__pkm = { get tabs() { return tabs; }, scan: startScan, get diaries() { return diaries; }, get mode() { return mode; }, get cur() { return cur; }, get notes() { return notes; }, get topics() { return topics; }, get view() { return lastView; } };

// ===== 削除・一括削除 =====
const keyOf = n => n.s + ':' + n.id;
function visibleRows() { return [...document.querySelectorAll('#list .item.note[data-s][data-id]')]; }
function togglePick(row, range) {
  const k = row.dataset.s + ':' + row.dataset.id;
  if (range && lastPick) {
    const rows = visibleRows(), a = rows.findIndex(r => r.dataset.s + ':' + r.dataset.id === lastPick), b = rows.indexOf(row);
    if (a >= 0) for (const r of rows.slice(Math.min(a, b), Math.max(a, b) + 1)) picked.add(r.dataset.s + ':' + r.dataset.id);
  } else { picked.has(k) ? picked.delete(k) : picked.add(k); lastPick = k; }
  renderList();
}
function renderSelbar() {
  const bar = $('#selbar');
  bar.classList.toggle('selecting', selMode);
  bar.innerHTML = selMode
    ? `<button id="sel-end" title="複数選択をやめる（Esc）">✖️</button><b class="sel-n" title="選んだ件数">${picked.size}</b><span class="sel-sp"></span>
      <button id="sel-all" title="見えているノートを全部選ぶ">☑️</button><button id="sel-sim" ${picked.size ? '' : 'disabled'} title="選んだノートから類似検索">🔍</button><button id="sel-copy" ${picked.size ? '' : 'disabled'} title="選んだノートのタイトルと本文をコピー">📋</button><button id="sel-exp" ${picked.size ? '' : 'disabled'} title="選んだノートを、1つの Markdown にまとめる（保存はしない。確認してコピー）">📤</button><button id="sel-del" class="danger" ${picked.size ? '' : 'disabled'} title="選んだノートを削除">🗑️</button>`
    : '';   // 複数選択は、ノートを右クリックして始める
  bar.style.display = selMode ? 'flex' : 'none';
}
function endSelection() { selMode = false; picked.clear(); lastPick = null; renderList(); }
async function copySelection() { return copyNotes([...picked].map(k => get(k[0], k.slice(2))).filter(Boolean)); }
async function copyNotes(selected) {
  if (!selected.length) return;
  selected.sort((a, b) => a.s.localeCompare(b.s) || L.cmpId(a.id, b.id));
  const text = clipText(L.exportMd(selected.map(n => ({ s: n.s, id: n.id, title: n.title || '', body: n.body || '', noid: n.noid }))));
  try { await navigator.clipboard.writeText(text); toast(`${selected.length}件をコピーしました`); }
  catch { toast('コピーできませんでした'); }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !selMode || e.isComposing || e.keyCode === 229) return;
  if ($('#modal').style.display === 'flex' || document.querySelector('.idex-cover, #idpop, .reference-picker')) return;
  e.preventDefault(); e.stopImmediatePropagation(); endSelection();
}, true);
$('#selbar').addEventListener('click', e => {
  const button = e.target.closest('button'); if (!button || button.disabled) return;
  const id = button.id;
  if (id === 'sel-end') endSelection();
  if (id === 'sel-all') { visibleRows().forEach(r => picked.add(r.dataset.s + ':' + r.dataset.id)); renderList(); }
  if (id === 'sel-sim') { const base = [...picked].map(k => ({ s: k[0], id: k.slice(2) })); endSelection(); openSimilar(base); }
  if (id === 'sel-copy') copySelection();
  if (id === 'sel-exp') exportDialog([...picked]);
  if (id === 'sel-del') deleteNotes([...picked].map(k => ({ s: k[0], id: k.slice(2) })));
});
// ノートを右クリック: 開く・コピー・削除・複数選択（選択中は、選んだノートまとめて）
document.addEventListener('contextmenu', e => {
  const row = e.target.closest('#list .note[data-s][data-id]'); if (!row) return;
  e.preventDefault();
  const key = row.dataset.s + ':' + row.dataset.id, n = get(row.dataset.s, row.dataset.id); if (!n) return;
  if (selMode) {
    if (!picked.has(key)) { picked.add(key); lastPick = key; renderList(); }
    const sel = [...picked].map(k => get(k[0], k.slice(2))).filter(Boolean), c = sel.length;
    return popMenu(e, [
      [`🗑️ ${c}件を削除`, () => deleteNotes(sel.map(x => ({ s: x.s, id: x.id }))), true],
      [`🔍 ${c}件から類似検索`, () => openSimilar(sel.map(x => ({ s: x.s, id: x.id })))],
      [`📋 ${c}件をコピー`, () => copyNotes(sel)],
      [`📤 ${c}件をエクスポート`, () => exportDialog([...picked])],
      ['✖️ 複数選択をやめる', () => endSelection()]
    ]);
  }
  popMenu(e, [
    ['📂 開く', () => openNote(n.s, n.id)],
    ['🔍 類似検索', () => openSimilar([{ s: n.s, id: n.id }])],
    ['☑️ 複数選択（ここから）', () => { selMode = true; picked.clear(); picked.add(key); lastPick = key; renderList(); }],
    ['📋 コピー', () => copyNotes([n])],
    ['🗑️ 削除', () => deleteNotes([{ s: n.s, id: n.id }]), true]
  ]);
});
async function deleteNotes(items) {
  items = items.filter(x => get(x.s, x.id));
  if (!items.length) return;
  const label = items.length === 1 ? `${SP[items[0].s]} ${items[0].id}` : `${items.length}件のノート`;
  if (!confirm(`${label} を削除しますか？\n（ファイルは .trash に移ります。索引の行からもIDを外します）`)) return;
  await flush();
  const st = await api.deleteNotes(items);
  ({ notes, topics } = st);
  readings = st.readings || readings;
  const gone = new Set(items.map(keyOf));
  const cp = cur;
  tabs = tabs.filter(t => !(t.k === 'note' && gone.has(keyOf(t))));
  active = cp ? tabs.indexOf(cp) : -1;
  if (active < 0) active = Math.min(Math.max(active, 0), tabs.length - 1);
  selMode = false; picked.clear();
  show(active);
}

// ===== 添付（ファイルは保存フォルダにそのままコピーし、本文のカーソル位置にリンクを入れる）=====
// 画像は ![名前](パス)（本文の中に表示される）、ほかは [名前](パス)（押すと既定のアプリで開く）
const PIC = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
// ファイル名はリンクを壊す文字（空白 ( ) < > % # ?）だけ置き換え、日本語などはそのまま書く
const encRel = n => n.replace(/[\s()<>%#?\\]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
async function attach(note, files) {
  const list = [];
  for (const f of files) list.push({ name: f.name || 'image.png', bytes: await f.arrayBuffer() });
  if (!list.length) return;
  const names = await api.addFiles(list);
  filesCache = await api.filesInfo(); if (tab === 'f' && !$('#q').value) renderList();
  if (!note) toast(`${names.length} 件を取り込みました。タイトルを付けておくと探しやすくなります`);
  const view = lastView;
  if (!view || !view.dom.isConnected || !cur || !['note', 'diary'].includes(cur.k)) return;
  const head = view.state.selection.main.head, at = view.state.doc.lineAt(head);
  const md = (head === at.from ? '' : '\n') + names.map((n, i) => PIC.test(n) ? `![](${encRel(n)})` : `[${(list[i].name || n).replace(/[\[\]]/g, '')}](${encRel(n)})`).join('\n') + '\n';
  view.dispatch({ changes: { from: head, insert: md }, selection: { anchor: head + md.length } }); view.focus();
}
const curNote = () => cur && cur.k === 'note' ? get(cur.s, cur.id) : cur && cur.k === 'diary' ? getDiary(cur.date, cur.kind) : null;
$('#pane').addEventListener('dragover', e => { if (curNote() && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); $('#pane').classList.add('drop'); } });
$('#pane').addEventListener('dragleave', e => { if (!e.relatedTarget || !$('#pane').contains(e.relatedTarget)) $('#pane').classList.remove('drop'); });
$('#pane').addEventListener('drop', e => {
  $('#pane').classList.remove('drop');
  const n = curNote(); if (!n || !e.dataTransfer.files.length) return;
  e.preventDefault(); attach(n, [...e.dataTransfer.files]);
});
// 貼り付け（スクリーンショットなど）
document.addEventListener('paste', e => {
  const n = curNote(), fs = [...(e.clipboardData ? e.clipboardData.files : [])];
  if (n && fs.length) { e.preventDefault(); attach(n, fs); }
});

// 保存側の状態（ノート・日記・読み・紙のIndex）を、画面に反映する
function applyState(st, since = saves.revision) {
  const protect = key => saves.has(key) || saves.changedSince(key, since);
  notes = Persistence.reconcile(notes, st.notes, noteKey, protect);
  topics = Persistence.reconcile(topics, st.topics, t => 't' + t.name, protect);
  if (st.diaries) diaries = Persistence.reconcile(diaries, st.diaries, diaryKey, protect);
  syncEditors();
  const title = $('#f-title'), note = cur?.k === 'note' && get(cur.s, cur.id);
  if (title && note) title.value = note.title || '';
  const dayTitle = $('#d-title'), day = cur?.k === 'diary' && getDiary(cur.date, cur.kind);
  if (dayTitle && day) dayTitle.value = day.title || '';
  records = st.records || records; readings = st.readings || readings; PI.apply(st); renderList();
}
function restoreRecovery(st) {
  let entries;
  try { entries = recovery.entries(); } catch { recoveryError = true; saveStatus(saves); return; }
  for (const { key, kind, payload } of entries) {
    if (kind === 'note') {
      let n = st.notes.find(n => noteKey(n) === key);
      if (!n) { n = { ...payload }; st.notes.push(n); } else Object.assign(n, payload);
      saveNote(n);
    } else if (kind === 'diary') {
      let d = st.diaries.find(d => diaryKey(d) === key);
      if (!d) { d = { pages: [], ...payload }; st.diaries.push(d); } else Object.assign(d, payload);
      saveDiary(d);
    } else if (kind === 'topic') {
      let t = st.topics.find(t => 't' + t.name === key);
      if (!t) { t = payload; st.topics.push(t); } else Object.assign(t, payload);
      saveTopic(t);
    } else if (kind === 'doc') {
      st.docs ||= {}; st.docs[payload.name] = payload.doc;
      saveDocument(key, payload.name, payload.doc);
    }
  }
  if (entries.length) toast('前回の未保存の入力内容を復元しました');
}
// 本文のリンク・参照などの部品に、アプリの機能を渡す
Object.assign(ctx, {
  api, later, flush, place,
  renderMemoGroupPlain: LC.legacyGroup,
  memoReferenceBacklinks: LC.memoBacklinks,
  highlightMemo: (id, range) => { setTimeout(() => highlightMemoRange(id, range), 30); },
  enhanceRendered: LC.enhance, searchReferences: LC.search, memos: () => [], diaries: () => diaries, gotoMemo: () => {},
  selectRange: (from, to) => { if (lastView?.dom.isConnected) { lastView.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) }); lastView.focus(); } },
  targetMemo: LC.targetMemo, addNote: n => notes.push(n),
  renderChanged: () => LC.refresh(), renderTabs, openLink, applyState, readings: () => readings, lastNote: () => lastNote,
 renderList, pick, get, free, refreshDiaries, records: () => records, openNote, openDiary, getDiary,
  setCur: c => { cur = c; }, setMode: m => { mode = m; }, cur: () => cur, notes: () => notes, vault: () => vault,
  touchNote: n => saveNote(n),
  touchDiary: saveDiary, saveDocument, hasPending: key => saves.has(key),
  openDiaryData: async date => { await flush(); const r = await api.openDiary(date, '日記'); if (r) upsertDiary(r); }
});
