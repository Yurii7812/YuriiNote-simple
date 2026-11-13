// 行ごとの「年月日＋時刻」（行の先頭の「2026-11-13 12:54 」）。オンなら薄く小さく見せ、オフなら隠す（ファイルには残る）。
// 行を書いたら、自動で付く（書き始めた時刻）。表示のオン・オフは、PC でも スマホでも 1 つの設定
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { StateField, StateEffect, EditorState, EditorSelection, Prec, Transaction } from '@codemirror/state';
import Stamp from '../stamp.js';

const KEY = 'pkm-stamp-show';
let show = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
// 見せ方: 「全部」か、名前をつけて保存した「カスタム」（Stamp.format）。保存は、いつも「年月日 時:分:秒」
const FMT_KEY = 'pkm-stamp-fmt', PRESETS_KEY = 'pkm-stamp-presets';
let presets = (() => { try { const d = JSON.parse(localStorage.getItem(PRESETS_KEY) || 'null'); if (d && Array.isArray(d.list)) return { current: d.current || 'all', list: d.list.map(x => Stamp.normFmt(x)).filter(x => x.name) }; } catch { }
  // 昔の「秒まで出す・今日は省く」の設定があれば、カスタムとして引き継ぐ
  try { const o = JSON.parse(localStorage.getItem(FMT_KEY) || 'null'); if (o && (o.sec === false || o.short)) return { current: '前の設定', list: [{ ...Stamp.normFmt(o), name: '前の設定' }] }; } catch { }
  return { current: 'all', list: [] }; })();
const curFmt = () => presets.current === 'all' ? Stamp.normFmt(null) : (presets.list.find(x => x.name === presets.current) || Stamp.normFmt(null));
const views = new Set();
const refresh = StateEffect.define();
export const stampsShown = () => show;
// コピーボタンなどで外へ出す文章: 行ごとの時刻を出していないときは、時刻なしのまま出す
export const clipText = text => show ? text : Stamp.strip(text);
const refreshAll = () => { try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch { } for (const v of views) { try { v.dispatch({ effects: refresh.of(null) }); } catch { } } };
export const stampPresets = () => ({ current: presets.current, list: presets.list.map(x => ({ ...x })) });
export const stampFormat = () => ({ ...curFmt() });
export function useStampPreset(name) { presets.current = name === 'all' || presets.list.some(x => x.name === name) ? name : 'all'; refreshAll(); }
export function saveStampPreset(p) {   // 同じ名前があれば、上書き
  const f = { ...Stamp.normFmt(p), name: String(p.name || '').trim() }; if (!f.name || f.name === 'all') return false;
  presets.list = [...presets.list.filter(x => x.name !== f.name), f]; presets.current = f.name; refreshAll(); return true;
}
export function deleteStampPreset(name) { presets.list = presets.list.filter(x => x.name !== name); if (presets.current === name) presets.current = 'all'; refreshAll(); }
export function setStampsShown(on) {
  show = !!on; try { localStorage.setItem(KEY, show ? '1' : '0'); } catch { }
  for (const v of views) { try { v.dispatch({ effects: refresh.of(null) }); } catch { } }
}

class StampWidget extends WidgetType {
  constructor(at, f) { super(); this.at = at; this.f = JSON.stringify(f); }
  eq(o) { return o.at === this.at && o.f === this.f; }
  toDOM() { const e = document.createElement('span'); e.className = 'stamp'; e.textContent = Stamp.format(this.at, JSON.parse(this.f)); e.title = this.at; return e; }
  ignoreEvent() { return true; }
}
const markHidden = Decoration.replace({});
// 見えている範囲の、日時の場所（見せる・隠す）。カーソルが入れないように、atomic にもする
function build(view) {
  const ranges = [], seen = new Set();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const ln = view.state.doc.lineAt(pos); pos = ln.to + 1; if (seen.has(ln.number)) continue; seen.add(ln.number);
      const s = Stamp.parse(ln.text); if (!s || s.end <= s.p) continue;
      ranges.push((show ? Decoration.replace({ widget: new StampWidget(s.at, curFmt()) }) : markHidden).range(ln.from + s.p, ln.from + s.end));
    }
  }
  return Decoration.set(ranges, true);
}
const display = ViewPlugin.fromClass(class {
  constructor(view) { this.v = view; this.d = build(view); views.add(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.transactions.some(t => t.effects.some(e => e.is(refresh)))) this.d = build(u.view); }
  destroy() { views.delete(this.v); }
}, { decorations: p => p.d, provide: p => EditorView.atomicRanges.of(v => v.plugin(p)?.d || Decoration.none) });

// カーソル（選択なし）が日時の中や手前に来たら、日時のあと（本文の頭）へ。範囲選択はそのまま（コピーに日時が入るように）
const snap = EditorState.transactionFilter.of(tr => {
  if (!tr.selection && !tr.docChanged) return tr;
  const doc = tr.newDoc, sel = tr.newSelection; let changed = false;
  const ranges = sel.ranges.map(r => {
    if (!r.empty) return r;
    const ln = doc.lineAt(r.head), s = Stamp.parse(ln.text); if (!s) return r;
    const a = ln.from + s.p, b = ln.from + s.end;
    if (r.head >= a && r.head < b) { changed = true; return EditorSelection.cursor(b); }
    return r;
  });
  return changed ? [tr, { selection: EditorSelection.create(ranges, sel.mainIndex) }] : tr;
});

// ---- まだ日時が無い（書いている）行を覚える。位置は、変更に合わせてずらす
const setDirty = StateEffect.define();
const dirty = StateField.define({
  create: () => [],
  update(v, tr) {
    let out = v.map(d => ({ pos: tr.changes.mapPos(d.pos, -1), at: d.at }));
    for (const e of tr.effects) if (e.is(setDirty)) out = e.value.map(d => ({ pos: tr.changes.mapPos(d.pos, -1), at: d.at }));
    if (tr.docChanged && !tr.isUserEvent('stamp')) {
      const at = Stamp.nowStamp(), doc = tr.state.doc;
      tr.changes.iterChangedRanges((_fa, _fb, ta, tb) => {
        for (let n = doc.lineAt(ta).number, e = doc.lineAt(tb).number; n <= e; n++) {
          const ln = doc.line(n);
          if (ta !== tb && Math.min(tb, ln.to) <= Math.max(ta, ln.from)) continue;   // 改行だけを入れたときの、前の行などは、書いたことにしない
          if (!out.some(d => d.pos === ln.from)) out.push({ pos: ln.from, at });
        }
      });
    }
    return out;
  }
});
const annos = [Transaction.userEvent.of('stamp'), Transaction.addToHistory.of(false)];
function flush(view, keepCurrent) {
  if (view.composing || view.state.readOnly || !view.dom.isConnected) return;
  const st = view.state, d = st.field(dirty, false); if (!d || !d.length) return;
  const doc = st.doc, curLine = doc.lineAt(st.selection.main.head).number, text = doc.toString(), orig = text.split('\n');
  const groups = new Map(), left = [];
  for (const e of d) {
    const ln = doc.lineAt(Math.min(e.pos, doc.length));
    if (keepCurrent && ln.number === curLine) { left.push(e); continue; }
    if (!groups.has(e.at)) groups.set(e.at, new Set()); groups.get(e.at).add(ln.number - 1);
  }
  const changes = [];
  for (const [at, set] of groups) {
    const res = Stamp.add(text, at, set).split('\n');
    for (const i of set) { if (res[i] === orig[i]) continue; changes.push({ from: doc.line(i + 1).from + Stamp.prefixLen(orig[i]), insert: at + ' ' }); }
  }
  view.dispatch({ changes, effects: setDirty.of(left), annotations: annos });
}
// 昔の形（行末の <!--…-->）を、先頭の形に直す
function normalize(view) {
  if (view.composing || view.state.readOnly || !view.dom.isConnected) return;
  const doc = view.state.doc, text = doc.toString();
  if (!text.includes('<!--')) return;
  const next = Stamp.migrate(text); if (next === text) return;
  const changes = [];
  for (let n = 1; n <= doc.lines; n++) {
    const ln = doc.line(n); if (!ln.text.includes('<!--')) continue;
    const fixed = Stamp.migrate(ln.text); if (fixed !== ln.text) changes.push({ from: ln.from, to: ln.to, insert: fixed });
  }
  if (changes.length) view.dispatch({ changes, annotations: [Transaction.userEvent.of('stamp'), Transaction.addToHistory.of(false)] });
}
const auto = ViewPlugin.fromClass(class {
  constructor(view) { this.v = view; this.t = null; setTimeout(() => normalize(view), 0); }
  update(u) {
    if (u.transactions.some(t => t.isUserEvent('stamp'))) return;
    if (u.docChanged || u.selectionSet) {
      clearTimeout(this.t); const v = this.v;
      setTimeout(() => flush(v, true), 0);   // 別の行へ移ったら、前の行にすぐ付く
      this.t = setTimeout(() => flush(v, false), 1500);   // 書く手が止まったら、いまの行にも付く
    }
  }
  destroy() { clearTimeout(this.t); }
}, { eventHandlers: {
  blur() { const v = this.v; setTimeout(() => flush(v, false), 0); },
  compositionend() { const v = this.v; setTimeout(() => flush(v, true), 0); }
} });

// 日時のすぐあと（本文の頭）での ← と Backspace: ← は前の行の終わりへ。Backspace は、記号のない行なら前の行につなぐ。記号（- など）のある行は、記号ごと外す
const keys = Prec.highest(keymap.of([
  { key: 'ArrowLeft', run: v => {
    const s = v.state.selection.main; if (!s.empty) return false;
    const ln = v.state.doc.lineAt(s.head), st = Stamp.parse(ln.text); if (!st || s.head !== ln.from + st.end || ln.number === 1) return false;
    v.dispatch({ selection: { anchor: ln.from - 1 }, scrollIntoView: true }); return true;
  } },
  { key: 'Backspace', run: v => {
    const s = v.state.selection.main; if (!s.empty) return false;
    const doc = v.state.doc, ln = doc.lineAt(s.head), st = Stamp.parse(ln.text); if (!st || s.head !== ln.from + st.end) return false;
    if (st.p === 0 && ln.number > 1) v.dispatch({ changes: { from: ln.from - 1, to: ln.from + st.end }, selection: { anchor: ln.from - 1 }, userEvent: 'delete.backward' });
    else v.dispatch({ changes: { from: ln.from, to: ln.from + st.end }, userEvent: 'delete.backward' });
    return true;
  } }
]));
// 時刻の表示がオフのときは、コピー・切り取りした文字にも、時刻を入れない
const clip = EditorView.domEventHandlers({
  copy(e, view) { return clipOut(e, view, false); },
  cut(e, view) { return clipOut(e, view, true); }
});
function clipOut(e, view, cut) {
  if (show || !e.clipboardData) return false;
  const st = view.state, rs = st.selection.ranges.filter(r => !r.empty); if (!rs.length) return false;
  const text = Stamp.strip(rs.map(r => st.sliceDoc(r.from, r.to)).join('\n'));
  e.clipboardData.setData('text/plain', text); e.preventDefault();
  if (cut && !st.readOnly) view.dispatch({ changes: rs.map(r => ({ from: r.from, to: r.to })), scrollIntoView: true, userEvent: 'delete.cut' });
  return true;
}
export const stampExtensions = [keys, snap, dirty, display, auto, clip];
