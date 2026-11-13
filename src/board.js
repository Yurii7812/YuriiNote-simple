// ブレストボード: ノートの中に、紙のように文字と線を書ける場所を置く
// 書き方（ノートの中身）:  ```board の次の行に JSON を1行。  {"h":高さ,"t":[[x,y,"文字"]],"s":[[x1,y1,x2,y2,…]]}
// 操作: 空きをクリック→そのまま文字 / どこからでもドラッグ→ペン / 文字をクリック→直す / Ctrl+ドラッグ→文字の移動 / 右クリック→消す
import { EditorView, Decoration, WidgetType } from '@codemirror/view';
import { StateField } from '@codemirror/state';
import { undo, redo, isolateHistory } from '@codemirror/commands';
import { popMenu } from './shared.js';
import L from '../lib.js';
import { attachEditable, refKey, plainDoc } from './reference-picker.js';

const NS = 'http://www.w3.org/2000/svg';
const MIN_H = 220, DEF_H = 320;

export const boardTemplate = '```board\n{"h":' + DEF_H + ',"t":[],"s":[]}\n```\n';

const parse = src => {
  let d; try { d = JSON.parse(src); } catch { d = null; }
  if (!d || typeof d !== 'object') d = {};
  const t = Array.isArray(d.t) ? d.t.filter(a => Array.isArray(a) && typeof a[2] === 'string').map(a => [+a[0] || 0, +a[1] || 0, a[2]]) : [];
  const s = Array.isArray(d.s) ? d.s.filter(a => Array.isArray(a) && a.length >= 4).map(a => a.map(n => +n || 0)) : [];
  return { h: Math.max(MIN_H, +d.h || DEF_H), t, s };
};
const dump = d => JSON.stringify({ h: Math.round(d.h), t: d.t, s: d.s });
const fence = d => '```board\n' + dump(d) + '\n```';
const smooth = f => {   // f は [x,y,x,y,…]
  const p = []; for (let i = 0; i + 1 < f.length; i += 2) p.push([f[i], f[i + 1]]);
  if (p.length < 3) return 'M' + p.map(q => q.join(' ')).join(' L');
  let d = `M${p[0][0]} ${p[0][1]}`;
  for (let i = 1; i < p.length - 1; i++) { const m = [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2]; d += ` Q${p[i][0]} ${p[i][1]} ${m[0]} ${m[1]}`; }
  const l = p[p.length - 1]; return d + ` L${l[0]} ${l[1]}`;
};
const thin = pts => {   // 近すぎる点を減らして、整数にする
  const out = []; let last = null;
  pts.forEach((q, i) => { const r = [Math.round(q[0]), Math.round(q[1])]; if (!last || i === pts.length - 1 || Math.hypot(r[0] - last[0], r[1] - last[1]) >= 3) { out.push(r); last = r; } });
  return out.flat();
};
const distSeg = (ax, ay, bx, by, px, py) => {
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1; let k = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2; k = Math.max(0, Math.min(1, k));
  return Math.hypot(px - (ax + k * (bx - ax)), py - (ay + k * (by - ay)));
};

class BoardWidget extends WidgetType {
  constructor(src, from, to) { super(); this.src = src; this.from = from; this.to = to; }
  eq(o) { return o.src === this.src && o.from === this.from && o.to === this.to; }
  toDOM(view) {
    const wrap = document.createElement('div'); wrap.className = 'bd';
    wrap._ctx = { from: this.from, to: this.to };
    wrap._st = parse(this.src);
    mount(wrap, view); return wrap;
  }
  updateDOM(dom) {   // 自分で書いた変更のあとは、DOM をそのまま使う。元に戻す（Ctrl+Z）などのときだけ描き直す
    if (!dom.classList || !dom.classList.contains('bd') || !dom._render) return false;
    dom._ctx.from = this.from; dom._ctx.to = this.to;
    const n = parse(this.src);
    if (dump(n) !== dump(dom._st)) { dom._st = n; dom._render(); }
    return true;
  }
  ignoreEvent() { return true; }
}

function mount(wrap, view) {
  const stage = document.createElement('div'); stage.className = 'bd-stage'; stage.tabIndex = -1;
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'bd-svg');
  const gS = document.createElementNS(NS, 'g'), gL = document.createElementNS(NS, 'g'); svg.append(gS, gL); stage.append(svg); wrap.append(stage);
  let editing = null, drag = null;
  const S = () => wrap._st;
  wrap.style.height = S().h + 'px';

  const save = () => {
    const ctx = wrap._ctx, md = fence(S());
    if (md === view.state.doc.sliceString(ctx.from, ctx.to)) return;
    view.dispatch({ changes: { from: ctx.from, to: ctx.to, insert: md }, annotations: isolateHistory.of('full') }); ctx.to = ctx.from + md.length;
  };
  const pos = e => { const r = stage.getBoundingClientRect(); return [Math.max(0, Math.min(r.width, e.clientX - r.left)), Math.max(0, e.clientY - r.top)]; };
  const textAt = e => { const t = document.elementFromPoint(e.clientX, e.clientY); return t && t.closest ? t.closest('.bd-t') : null; };
  // 左右には広がらない（幅は、ノートの幅のまま）。下には、書いた分だけ広がる。書いた所より上へは縮められない
  const fit = () => {
    const W = wrap.clientWidth; let my = 0;
    stage.querySelectorAll('.bd-t').forEach(el => { const t = S().t[+el.dataset.i]; if (t) el.style.maxWidth = Math.max(60, W - t[0] - 8) + 'px'; my = Math.max(my, el.offsetTop + el.offsetHeight); });
    S().s.forEach(f => { for (let i = 1; i < f.length; i += 2) my = Math.max(my, f[i]); });
    const need = Math.max(MIN_H, my ? my + 40 : 0);
    wrap.style.minHeight = need + 'px';
    if (wrap.offsetHeight < need) { wrap.style.height = need + 'px'; S().h = need; }
  };
  const drawStrokes = () => {
    gS.replaceChildren();
    S().s.forEach((f, i) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', smooth(f)); p.setAttribute('class', 'bd-stroke'); p.dataset.i = i; gS.append(p); });
  };
  const render = wrap._render = () => {
    stage.querySelectorAll('.bd-t').forEach(e => e.remove());
    S().t.forEach((t, i) => { const el = document.createElement('div'); el.className = 'bd-t'; el.dataset.i = i; el.textContent = t[2]; el.style.left = t[0] + 'px'; el.style.top = t[1] + 'px'; stage.append(el); });
    drawStrokes(); fit();
  };

  // ---- 文字
  const commit = () => {
    if (!editing) return false;
    const { i } = editing, el = stage.querySelector(`.bd-t[data-i="${i}"]`), t = S().t[i]; editing = null;
    const text = ((el && el.textContent) || '').replace(/\s+$/, '');
    if (!text) { S().t.splice(i, 1); render(); save(); return false; }
    t[2] = text; render(); save(); return true;
  };
  const startEdit = i => {
    const el = stage.querySelector(`.bd-t[data-i="${i}"]`); if (!el) return;
    el.classList.add('edit'); el.contentEditable = 'plaintext-only'; el.spellcheck = false; el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    editing = { i };
    if (!el._ref) { el._ref = true; attachEditable(el, () => plainDoc(view.state.doc.toString())); }
    el.onkeydown = ev => {
      ev.stopPropagation();
      if (ev.isComposing || ev.keyCode === 229) return;
      if (refKey(el, ev)) { ev.preventDefault(); return; }   // 「:」の候補が出ているとき
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyM') { ev.preventDefault(); nextAnchor(el); return; }   // ノート全体で、次の (n)
      const t = S().t[i];
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); const x = t[0], y = t[1] + el.offsetHeight + 2; if (commit()) newText(x + 4, y + 14); }   // 確定して、すぐ下に次の文字
      else if (ev.key === 'Tab') { ev.preventDefault(); const x = Math.min(t[0] + el.offsetWidth + 36, wrap.clientWidth - 80), y = t[1]; if (commit()) newText(x + 4, y + 14); }   // 確定して、右に次の文字
      else if (ev.key === 'Escape') { ev.preventDefault(); commit(); stage.focus(); }
    };
    el.onblur = () => { if (editing && editing.i === i) { commit(); } };
  };
  // Ctrl+M: ノート全体（文章とボードのすべて）でいちばん大きい番号の、次の (n) を入れる
  const nextAnchor = el => {
    const all = plainDoc(view.state.doc.toString()) + '\n' + el.textContent;
    const nums = L.tokens(all).filter(t => t.k === 'self' && t.bare).map(t => +t.n);
    const text = `(${(nums.length ? Math.max(...nums) : 0) + 1})`, sel = getSelection(), v = el.textContent;
    let at = v.length; if (sel.rangeCount && el.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(el); r.setEnd(sel.anchorNode, sel.anchorOffset); at = r.toString().length; }
    el.textContent = v.slice(0, at) + text + v.slice(at);
    const tn = el.firstChild, r2 = document.createRange(); r2.setStart(tn, at + text.length); r2.collapse(true); sel.removeAllRanges(); sel.addRange(r2);
  };
  const newText = (x, y) => {
    S().t.push([Math.max(2, Math.round(x - 4)), Math.max(2, Math.round(y - 14)), '']);
    render(); startEdit(S().t.length - 1); editing.isNew = true;
  };

  // ---- ペン・移動
  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (editing) { const t = textAt(e); if (t && +t.dataset.i === editing.i) return; commit(); }
    const t = textAt(e), p = pos(e); stage.setPointerCapture(e.pointerId); e.preventDefault(); stage.focus({ preventScroll: true });
    if (t && (e.ctrlKey || e.metaKey)) { const i = +t.dataset.i; drag = { mode: 'move', i, sx: p[0], sy: p[1], ox: S().t[i][0], oy: S().t[i][1], moved: false }; t.classList.add('move'); }
    else drag = { mode: 'pen', textI: t ? +t.dataset.i : -1, pts: [p], sx: p[0], sy: p[1], moved: false };
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return; const p = pos(e);
    if (Math.hypot(p[0] - drag.sx, p[1] - drag.sy) > 4) drag.moved = true; if (!drag.moved) return;
    if (drag.mode === 'pen') {
      drag.pts.push(p); if (p[1] + 40 > wrap.offsetHeight) wrap.style.height = Math.round(p[1] + 40) + 'px'; let live = gL.querySelector('path'); if (!live) { live = document.createElementNS(NS, 'path'); live.setAttribute('class', 'bd-stroke'); gL.append(live); }
      live.setAttribute('d', smooth(drag.pts.flat()));
    } else {
      const t = S().t[drag.i]; t[0] = Math.max(0, Math.round(drag.ox + p[0] - drag.sx)); t[1] = Math.max(0, Math.round(drag.oy + p[1] - drag.sy));
      const el = stage.querySelector(`.bd-t[data-i="${drag.i}"]`); if (el) { el.style.left = t[0] + 'px'; el.style.top = t[1] + 'px'; }
    }
  });
  const finish = e => {
    if (!drag) return; const d = drag; drag = null; gL.replaceChildren(); stage.querySelectorAll('.bd-t.move').forEach(x => x.classList.remove('move'));
    const p = pos(e);
    if (d.mode === 'pen') {
      if (!d.moved) { if (d.textI >= 0) startEdit(d.textI); else newText(p[0], p[1]); return; }
      const f = thin(d.pts); if (f.length >= 4) { S().s.push(f); render(); save(); }
    } else if (d.moved) { render(); save(); }
    else startEdit(d.i);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', () => { drag = null; gL.replaceChildren(); });

  // ---- キー・右クリック
  stage.addEventListener('keydown', e => {
    if (editing) return; e.stopPropagation();
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); (e.shiftKey ? redo : undo)(view); }
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') { e.preventDefault(); redo(view); }
    else if (e.key === 'Escape') { e.preventDefault(); const to = Math.min(view.state.doc.length, wrap._ctx.to + 1); view.dispatch({ selection: { anchor: to } }); view.focus(); }
  });
  stage.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation(); if (editing) commit();
    const t = textAt(e), p = pos(e), items = [];
    if (t) { const i = +t.dataset.i; items.push(['🗑️ この文字を消す', () => { S().t.splice(i, 1); render(); save(); }, true]); }
    else {
      let best = -1, bd = 12;
      S().s.forEach((f, k) => { for (let j = 2; j + 1 < f.length; j += 2) { const d = distSeg(f[j - 2], f[j - 1], f[j], f[j + 1], p[0], p[1]); if (d < bd) { bd = d; best = k; } } });
      if (best >= 0) items.push(['🗑️ この線を消す', () => { S().s.splice(best, 1); render(); save(); }, true]);
      items.push(['↶ 戻す', () => undo(view)], ['🗑️ ボードごと消す', () => { const { from, to } = wrap._ctx, doc = view.state.doc; view.dispatch({ changes: { from, to: Math.min(doc.length, to + 1), insert: '' } }); view.focus(); }, true]);
    }
    popMenu(e, items);
  });

  // 高さ: 右下の角をひっぱったときだけ覚える（箱そのものを押したときだけ。中を押したときは対象外）
  let resizing = false;
  wrap.addEventListener('pointerdown', e => { const r = wrap.getBoundingClientRect(); if (e.target === wrap && e.clientX > r.right - 22 && e.clientY > r.bottom - 22) resizing = true; });
  addEventListener('pointerup', () => {
    if (!resizing) return; resizing = false;
    const h = Math.round(wrap.getBoundingClientRect().height);
    if (h >= MIN_H && Math.abs(h - S().h) > 3 && wrap.isConnected) { S().h = h; save(); }
  });
  new ResizeObserver(fit).observe(wrap);
  render();
}

// ボードの場所を見つけて、その場に置き換える
function boardBlocks(state) {
  const deco = []; let open = null;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (!open) { const m = line.text.match(/^\s*(`{3,}|~{3,})board\s*$/i); if (m) open = { line, ch: m[1][0], n: m[1].length, code: [] }; continue; }
    const tr = line.text.trim();
    if (tr.length >= open.n && [...tr].every(c => c === open.ch)) {
      deco.push(Decoration.replace({ widget: new BoardWidget(open.code.join('\n'), open.line.from, line.to), block: true }).range(open.line.from, line.to));
      open = null;
    } else open.code.push(line.text);
  }
  return Decoration.set(deco, true);
}
export const boardField = StateField.define({
  create: boardBlocks,
  update: (v, tr) => tr.docChanged ? boardBlocks(tr.state) : v,
  provide: f => [EditorView.decorations.from(f), EditorView.atomicRanges.of(view => view.state.field(f))]
});

// 入れた直後に、最初の文字を書ける状態へ
export function focusBoardAt(view, pos, tries = 8) {
  const w = [...view.dom.querySelectorAll('.bd')].find(x => x._ctx && x._ctx.from === pos);
  if (w) { const st = w.querySelector('.bd-stage'); if (st) { st.focus({ preventScroll: false }); return; } }
  if (tries > 0) setTimeout(() => focusBoardAt(view, pos, tries - 1), 40);
}
