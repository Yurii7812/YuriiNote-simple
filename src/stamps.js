// 行ごとの「年月日＋時刻」（行末の <!--2026-11-13 13:05--> ）を、画面では隠し、オンなら行の先頭に小さく出す。
// 行を書いたら、自動で目印が付く（書き始めた時刻）。表示のオン・オフは、PC でも スマホでも 1 つの設定
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { StateField, StateEffect, Prec, Transaction } from '@codemirror/state';
import Stamp from '../stamp.js';

const KEY = 'pkm-stamp-show';
let show = (() => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } })();
const views = new Set();
const refresh = StateEffect.define();
export const stampsShown = () => show;
export function setStampsShown(on) {
  show = !!on; try { localStorage.setItem(KEY, show ? '1' : '0'); } catch { }
  for (const v of views) { try { v.dispatch({ effects: refresh.of(null) }); } catch { } }
}
const todayStr = () => Stamp.nowStamp().slice(0, 10);

class StampWidget extends WidgetType {
  constructor(at) { super(); this.at = at; }
  eq(o) { return o.at === this.at; }
  toDOM() { const s = document.createElement('span'); s.className = 'stamp'; s.textContent = Stamp.show(this.at, todayStr()); s.title = this.at; return s; }
  ignoreEvent() { return true; }
}
const hideMark = Decoration.replace({});
function build(view) {
  const ranges = []; const seen = new Set();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const ln = view.state.doc.lineAt(pos); pos = ln.to + 1; if (seen.has(ln.number)) continue; seen.add(ln.number);
      const m = ln.text.match(Stamp.RE); if (!m) continue;
      ranges.push(hideMark.range(ln.from + m.index, ln.to));
      if (show) ranges.push(Decoration.widget({ widget: new StampWidget(m[1]), side: -1 }).range(ln.from));
    }
  }
  return Decoration.set(ranges, true);
}
const display = ViewPlugin.fromClass(class {
  constructor(view) { this.v = view; this.d = build(view); views.add(view); }
  update(u) { if (u.docChanged || u.viewportChanged || u.transactions.some(t => t.effects.some(e => e.is(refresh)))) this.d = build(u.view); }
  destroy() { views.delete(this.v); }
}, { decorations: p => p.d, provide: p => EditorView.atomicRanges.of(v => v.plugin(p)?.d || Decoration.none) });

// ---- まだ目印が無い（書いている）行を覚える。位置は、変更に合わせてずらす
const setDirty = StateEffect.define();
const dirty = StateField.define({
  create: () => [],
  update(v, tr) {
    let out = v.map(d => ({ pos: tr.changes.mapPos(d.pos, -1), at: d.at }));
    for (const e of tr.effects) if (e.is(setDirty)) out = e.value.map(d => ({ pos: tr.changes.mapPos(d.pos, -1), at: d.at }));
    if (tr.docChanged && !tr.isUserEvent('stamp')) {
      const at = Stamp.nowStamp(), doc = tr.state.doc;
      tr.changes.iterChangedRanges((_fa, _fb, ta, tb) => {
        for (let n = doc.lineAt(ta).number, e = doc.lineAt(tb).number; n <= e; n++) { const p = doc.line(n).from; if (!out.some(d => d.pos === p)) out.push({ pos: p, at }); }
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
    for (const i of set) {
      if (res[i] === orig[i]) continue;
      const ln = doc.line(i + 1), base = orig[i].replace(/[ \t]+$/, '');
      changes.push({ from: ln.from + base.length, to: ln.to, insert: res[i].slice(base.length) });
    }
  }
  view.dispatch({ changes, effects: setDirty.of(left), annotations: annos });
}
// 行の途中に目印が残ったとき（行をつなげた・目印のあとに書いた）は、途中のものを外す
const ALL = /<!--\d{4}-\d{2}-\d{2} \d{2}:\d{2}-->/g;
function normalize(view) {
  if (view.composing || view.state.readOnly || !view.dom.isConnected) return;
  const doc = view.state.doc, changes = [];
  for (let n = 1; n <= doc.lines; n++) {
    const ln = doc.line(n); if (!ln.text.includes('<!--')) continue;
    const ms = [...ln.text.matchAll(ALL)]; if (!ms.length) continue;
    const endOk = m => ln.text.slice(m.index + m[0].length).trim() === '';
    ms.forEach((m, k) => {
      const keep = endOk(m) && k === ms.length - 1;
      if (!keep) { let a = m.index; while (a > 0 && /[ \t]/.test(ln.text[a - 1])) a--; changes.push({ from: ln.from + a, to: ln.from + m.index + m[0].length, insert: '' }); }
    });
  }
  if (changes.length) view.dispatch({ changes, annotations: [Transaction.userEvent.of('stamp-norm'), Transaction.addToHistory.of(false)] });
}
const auto = ViewPlugin.fromClass(class {
  constructor(view) { this.v = view; this.t = null; this.n = null; }
  update(u) {
    if (u.transactions.some(t => t.isUserEvent('stamp') || t.isUserEvent('stamp-norm'))) return;
    if (u.docChanged) { clearTimeout(this.n); this.n = setTimeout(() => normalize(this.v), 0); }
    if (u.docChanged || u.selectionSet) {
      clearTimeout(this.t); const v = this.v;
      setTimeout(() => flush(v, true), 0);   // 別の行へ移ったら、前の行にすぐ付く
      this.t = setTimeout(() => flush(v, false), 1500);   // 書く手が止まったら、いまの行にも付く
    }
  }
  destroy() { clearTimeout(this.t); clearTimeout(this.n); }
}, { eventHandlers: {
  blur() { const v = this.v; setTimeout(() => flush(v, false), 0); },
  compositionend() { const v = this.v; setTimeout(() => { normalize(v); flush(v, true); }, 0); }
} });

// 目印の手前（本文の終わり）で Enter / Delete を押したときは、目印を越えてから行う（目印が次の行に行かないように）
const keys = Prec.highest(keymap.of([
  { key: 'Enter', run: v => { const s = v.state.selection.main; if (!s.empty) return false; const ln = v.state.doc.lineAt(s.head), m = ln.text.match(Stamp.RE); if (m && s.head >= ln.from + m.index) v.dispatch({ selection: { anchor: ln.to } }); return false; } },
  { key: 'Delete', run: v => { const s = v.state.selection.main; if (!s.empty) return false; const doc = v.state.doc, ln = doc.lineAt(s.head), m = ln.text.match(Stamp.RE); if (!m || s.head < ln.from + m.index || ln.number >= doc.lines) return false; v.dispatch({ changes: { from: ln.to, to: ln.to + 1 }, selection: { anchor: ln.from + m.index }, userEvent: 'delete.forward' }); return true; } }
]));
export const stampExtensions = [keys, dirty, display, auto];
