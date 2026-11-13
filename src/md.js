// Obsidian 風の整形（書いたその場で）。見出し・太字・斜体・コード・チェックボックス・箇条書き・アウトライン・表
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap } from '@codemirror/view';
import { Prec, RangeSetBuilder, StateField, StateEffect } from '@codemirror/state';
import { foldService, foldGutter, foldKeymap, codeFolding, foldEffect, unfoldEffect, foldedRanges } from '@codemirror/language';
import { indentLess } from '@codemirror/commands';
import { mermaidPlaceholder } from './mermaid.js';
import { popMenu } from './shared.js';
import { boardField } from './board.js';
import { stampExtensions } from './stamps.js';

const INDENT = '  ';
const BULLET = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/;
const indentOf = s => (s.match(/^[\t ]*/)[0].replace(/\t/g, INDENT)).length;

// ===== 行ごとの整形（見出し・箇条書き・チェックボックス・引用・太字など）=====
class CheckWidget extends WidgetType {
  constructor(on, from) { super(); this.on = on; this.from = from; }
  eq(o) { return o.on === this.on && o.from === this.from; }
  toDOM(view) {
    const b = document.createElement('input'); b.type = 'checkbox'; b.checked = this.on; b.className = 'cm-check';
    b.onmousedown = e => e.preventDefault();
    b.onclick = e => { // [ ] ⇄ [x]
      e.preventDefault();
      const pos = view.posAtDOM(b), line = view.state.doc.lineAt(pos), m = line.text.match(BULLET);
      if (!m || !m[4]) return;
      const at = line.from + m[1].length + m[2].length + m[3].length + 1;
      view.dispatch({ changes: { from: at, to: at + 1, insert: this.on ? ' ' : 'x' } });
    };
    return b;
  }
  ignoreEvent() { return true; }
}
class HrWidget extends WidgetType {
  eq() { return true; }
  toDOM() { const e = document.createElement('span'); e.className = 'md-hr-w'; return e; }
}
class BulletWidget extends WidgetType {
  constructor(text) { super(); this.text = text; }
  eq(o) { return o.text === this.text; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = this.text; return s; }
}

function lines(view) {
  const b = [], sel = view.state.selection.main, doc = view.state.doc;
  const push = (f, t, d) => b.push(d.range(f, t));
  let inCode = false;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = doc.lineAt(pos); pos = line.to + 1;
      const text = line.text, onLine = sel.from <= line.to && sel.to >= line.from;
      if (/^\s*(```|~~~)/.test(text)) { // ``` の行: カーソルが外にあるときは記号を隠す（コードの枠だけ見せる）
        inCode = !inCode; push(line.from, line.from, Decoration.line({ class: 'md-code-line md-fence' + (inCode ? ' md-fence-top' : ' md-fence-end') }));
        if (!onLine && line.to > line.from) push(line.from, line.to, Decoration.replace({}));
        continue;
      }
      if (inCode) { push(line.from, line.from, Decoration.line({ class: 'md-code-line' })); continue; }
      let m;
      if ((m = text.match(/^(#{1,6})\s+/))) {
        push(line.from, line.from, Decoration.line({ class: 'md-h md-h' + m[1].length }));
        if (!onLine) push(line.from, line.from + m[0].length, Decoration.replace({}));
        else push(line.from, line.from + m[0].length, Decoration.mark({ class: 'md-dim' }));
      } else if ((m = text.match(BULLET))) {
        const ind = indentOf(m[1]);
        push(line.from, line.from, Decoration.line({ class: 'md-li', attributes: { style: `padding-left:${8 + ind * 9}px;text-indent:-14px` } }));
        const s = line.from + m[1].length, e = s + m[2].length;
        if (m[4]) { // チェックボックス: 印の部分を置き換える
          const cf = line.from + m[1].length + m[2].length + m[3].length;
          push(s, cf + m[4].length, Decoration.replace({ widget: new CheckWidget(/[xX]/.test(m[4]), cf) }));
          if (/[xX]/.test(m[4])) push(cf + m[4].length, line.to, Decoration.mark({ class: 'md-done' }));
        } else if (/[-*+]/.test(m[2])) push(s, e, Decoration.replace({ widget: new BulletWidget(ind >= 4 ? '◦' : '•') }));
        else push(s, e, Decoration.mark({ class: 'md-num' }));
      } else if ((m = text.match(/^(?:>[ \t]?)+/))) { // 引用: カーソルが外にあるとき > を隠す
        push(line.from, line.from, Decoration.line({ class: 'md-quote' }));
        if (!onLine) push(line.from, line.from + m[0].length, Decoration.replace({}));
        else push(line.from, line.from + m[0].length, Decoration.mark({ class: 'md-dim' }));
      } else if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(text)) {
        if (!onLine && line.to > line.from) { push(line.from, line.from, Decoration.line({ class: 'md-hr-line' })); push(line.from, line.to, Decoration.replace({ widget: new HrWidget() })); } // 記述は隠して、線だけ（行の高さのまま、真ん中に線）
        else push(line.from, line.from, Decoration.line({ class: 'md-dim' }));
      }
      // 行の中: **太字** *斜体* `コード` ~~取り消し~~
      for (const r of text.matchAll(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(?<![*\w])\*(?=\S)([^*]+?)(?<=\S)\*(?![*\w])|(`{2}|`)(?=[^`\n])([^\n]+?)\4|~~(?=\S)(.+?)(?<=\S)~~/g)) {
        const f = line.from + r.index, t = f + r[0].length;
        const cls = r[1] ? 'md-b' : r[3] !== undefined ? 'md-i' : r[4] !== undefined ? 'md-c' : 'md-s';
        const k = r[1] ? 2 : r[3] !== undefined ? 1 : r[4] !== undefined ? r[4].length : 2;
        const near = sel.from <= t && sel.to >= f;
        push(f, t, Decoration.mark({ class: cls }));
        if (!near) { push(f, f + k, Decoration.replace({})); push(t - k, t, Decoration.replace({})); }
      }
    }
  }
  return Decoration.set(b, true);
}
// 日本語の入力（変換中）のあいだは、飾りを作り直さない（作り直すと、変換中の文字や画面の位置が揺れる）。確定したら作り直す
const linePlugin = ViewPlugin.fromClass(class {
  constructor(v) { this.decorations = lines(v); this.pending = false; }
  update(u) {
    if (u.view.composing) { if (u.docChanged) this.decorations = this.decorations.map(u.changes); this.pending = true; return; }
    if (u.docChanged || u.viewportChanged || u.selectionSet || this.pending) { this.decorations = lines(u.view); this.pending = false; }
  }
}, { decorations: v => v.decorations, eventHandlers: { compositionend(_e, view) { setTimeout(() => view.dispatch({}), 0); } } });

// ===== 表（そのままの画面で編集。下にも右にも広げられる）=====
// マス（セル）を押して、そのまま書く。Tab / Enter / 矢印で動く。最後のマスで Tab / Enter を押すと、行が増える。
// 右端の「＋」で列、下の「＋」で行を足す。マスを右クリックで、行・列の足し引き。見出しの行は、特別にしない（ふつうの行）
const splitRow = l => {   // 区切りの | で分ける。\| は、文字の |
  const s = l.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, ''), out = []; let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { out.push(cur.trim()); cur = ''; }
    else cur += s[i];
  }
  out.push(cur.trim()); return out;
};
const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const escCell = c => String(c).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
const rowMd = r => '| ' + r.map(escCell).join(' | ') + ' |';
const sepMd = align => '| ' + align.map(a => a === 'center' ? ':---:' : a === 'right' ? '---:' : '---').join(' | ') + ' |';
const tableMd = (rows, align) => [rowMd(rows[0]), sepMd(align), ...rows.slice(1).map(rowMd)].join('\n');
const readRows = dom => [...dom.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\n/g, ' ')));
const norm = rows => JSON.stringify(rows.map(r => r.map(c => c.trim())));
function makeCell(text, tag = 'td') { const td = document.createElement(tag); td.contentEditable = 'plaintext-only'; td.spellcheck = false; td.textContent = text; return td; }
function makeRow(cells, tag = 'td') { const tr = document.createElement('tr'); for (const c of cells) tr.append(makeCell(c, tag)); return tr; }
// 1行目は見出し（th）、ほかはふつうのマス（td）にそろえる（行を足した・消したあとも）
function fixHead(table) {
  [...table.rows].forEach((tr, i) => [...tr.children].forEach(c => {
    const want = i ? 'TD' : 'TH'; if (c.tagName === want) return;
    const n = makeCell(c.textContent, want.toLowerCase()); c.replaceWith(n);
  }));
}
class TableWidget extends WidgetType {
  constructor(rows, align, from, to) { super(); this.rows = rows; this.align = align; this.from = from; this.to = to; }
  eq(o) { return norm(o.rows) === norm(this.rows) && o.from === this.from && o.to === this.to; }
  toDOM(view) {
    const wrap = document.createElement('div'); wrap.className = 'md-tw'; wrap._ctx = { from: this.from, to: this.to, align: [...this.align] };
    const table = document.createElement('table'); table.className = 'md-table';
    this.rows.forEach((r, i) => table.append(makeRow(r, i ? 'td' : 'th')));
    const col = document.createElement('button'), row = document.createElement('button');
    col.className = 'md-tadd-col'; col.textContent = '＋'; col.title = '列を足す'; col.tabIndex = -1; col.contentEditable = 'false';
    row.className = 'md-tadd-row'; row.textContent = '＋'; row.title = '行を足す'; row.tabIndex = -1; row.contentEditable = 'false';
    wrap.append(table, col, row);
    wireTable(wrap, view); return wrap;
  }
  updateDOM(dom) {   // 自分で書いた変更のあとは、DOM をそのまま使う（入力中のカーソルが動かない）
    if (!dom.classList || !dom.classList.contains('md-tw') || norm(readRows(dom)) !== norm(this.rows)) return false;
    dom._ctx.from = this.from; dom._ctx.to = this.to; dom._ctx.align = [...this.align]; return true;
  }
  ignoreEvent() { return true; }
}
function wireTable(wrap, view) {
  const table = wrap.querySelector('table'), cols = () => Math.max(...[...table.rows].map(r => r.children.length));
  const cell = (r, c) => table.rows[r] && table.rows[r].children[c];
  const focusCell = (r, c, where = 'end') => {
    const td = cell(r, c); if (!td) return; td.focus();
    const sel = getSelection(), range = document.createRange(); range.selectNodeContents(td); range.collapse(where === 'start'); sel.removeAllRanges(); sel.addRange(range);
  };
  const commit = () => {
    const ctx = wrap._ctx, rows = readRows(wrap), n = Math.max(...rows.map(r => r.length));
    rows.forEach(r => { while (r.length < n) r.push(''); });
    const align = Array.from({ length: n }, (_, j) => ctx.align[j] || ''); ctx.align = align;
    const md = tableMd(rows, align);
    if (md === view.state.doc.sliceString(ctx.from, ctx.to)) return;
    view.dispatch({ changes: { from: ctx.from, to: ctx.to, insert: md } }); ctx.to = ctx.from + md.length;
  };
  const addRow = (at) => { const n = cols(), tr = makeRow(Array(n).fill('')); const ref = table.rows[at]; if (ref) ref.before(tr); else table.append(tr); fixHead(table); commit(); return [...table.rows].indexOf(tr); };
  const addCol = (at) => { for (const tr of table.rows) { const td = makeCell(''); const ref = tr.children[at]; if (ref) ref.before(td); else tr.append(td); } fixHead(table); commit(); };
  const removeTable = () => { const { from, to } = wrap._ctx, doc = view.state.doc; view.dispatch({ changes: { from, to: Math.min(doc.length, to + 1), insert: '' } }); view.focus(); };
  const exit = up => {   // 表の外へ（上は、表の前の行。下は、表の次の行）
    const { from, to } = wrap._ctx;
    if (up) { if (from === 0) { view.dispatch({ changes: { from: 0, insert: '\n' }, selection: { anchor: 0 } }); } else view.dispatch({ selection: { anchor: from - 1 } }); }
    else { const len = view.state.doc.length; if (to >= len) { view.dispatch({ changes: { from: len, insert: '\n' }, selection: { anchor: len + 1 } }); } else view.dispatch({ selection: { anchor: to + 1 } }); }
    view.focus();
  };
  wrap.addEventListener('input', e => { if (!e.isComposing) commit(); });
  wrap.addEventListener('compositionend', commit);
  wrap.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData.getData('text/plain') || '').replace(/\r?\n/g, ' '); document.execCommand('insertText', false, t); });
  wrap.addEventListener('keydown', e => {
    const td = e.target.closest && e.target.closest('td,th'); if (!td || e.isComposing || e.keyCode === 229) return;
    e.stopPropagation();
    const tr = td.parentElement, r = [...table.rows].indexOf(tr), c = [...tr.children].indexOf(td), nr = table.rows.length, nc = tr.children.length;
    const sel = getSelection(), off = sel.rangeCount ? sel.getRangeAt(0).startOffset : 0, len = td.textContent.length, ctl = e.ctrlKey || e.metaKey || e.altKey;
    const down = () => { if (r + 1 < nr) focusCell(r + 1, c, 'start'); else { const i = addRow(nr); focusCell(i, c, 'start'); } };
    if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) { if (c > 0) focusCell(r, c - 1); else if (r > 0) focusCell(r - 1, cols() - 1); } else if (c + 1 < nc) focusCell(r, c + 1, 'start'); else if (r + 1 < nr) focusCell(r + 1, 0, 'start'); else { const i = addRow(nr); focusCell(i, 0, 'start'); } }
    else if (e.key === 'Enter' && !ctl) { e.preventDefault(); down(); }
    else if (e.key === 'ArrowDown' && !ctl) { e.preventDefault(); if (r + 1 < nr) focusCell(r + 1, c, 'start'); else exit(false); }
    else if (e.key === 'ArrowUp' && !ctl) { e.preventDefault(); if (r > 0) focusCell(r - 1, c, 'start'); else exit(true); }
    else if (e.key === 'ArrowRight' && !ctl && off >= len && !e.shiftKey) { if (c + 1 < nc) { e.preventDefault(); focusCell(r, c + 1, 'start'); } }
    else if (e.key === 'ArrowLeft' && !ctl && off === 0 && !e.shiftKey) { if (c > 0) { e.preventDefault(); focusCell(r, c - 1); } }
    else if (e.key === 'Escape') { e.preventDefault(); exit(false); }
  });
  wrap.addEventListener('click', e => {
    if (e.target.closest('.md-tadd-row')) { const i = addRow(table.rows.length); focusCell(i, 0, 'start'); }
    else if (e.target.closest('.md-tadd-col')) { addCol(cols()); focusCell(0, cols() - 1, 'start'); }
  });
  wrap.addEventListener('contextmenu', e => {
    const td = e.target.closest && e.target.closest('td,th'); if (!td) return;
    e.preventDefault(); e.stopPropagation();
    const tr = td.parentElement, r = [...table.rows].indexOf(tr), c = [...tr.children].indexOf(td);
    popMenu(e, [
      ['⬆️ 上に行を足す', () => { const i = addRow(r); focusCell(i, c, 'start'); }],
      ['⬇️ 下に行を足す', () => { const i = addRow(r + 1); focusCell(i, c, 'start'); }],
      ['⬅️ 左に列を足す', () => { addCol(c); focusCell(r, c, 'start'); }],
      ['➡️ 右に列を足す', () => { addCol(c + 1); focusCell(r, c + 1, 'start'); }],
      ['🗑️ この行を消す', () => { if (table.rows.length <= 1) return removeTable(); tr.remove(); fixHead(table); commit(); focusCell(Math.min(r, table.rows.length - 1), c, 'start'); }, true],
      ['🗑️ この列を消す', () => { if (cols() <= 1) return removeTable(); for (const row of table.rows) row.children[c] && row.children[c].remove(); commit(); focusCell(r, Math.min(c, cols() - 1), 'start'); }, true],
      ['🗑️ 表を消す', removeTable, true]
    ]);
  });
}
// 表を入れた直後に、最初のマスへ
export function focusTableAt(view, pos, tries = 8) {
  const ws = [...view.dom.querySelectorAll('.md-tw')], w = ws.find(x => x._ctx && x._ctx.from === pos);
  if (w) { const td = w.querySelector('th,td'); if (td) { td.focus(); return; } }
  if (tries > 0) setTimeout(() => focusTableAt(view, pos, tries - 1), 40);
}
function tables(state) {
  const b = new RangeSetBuilder(), doc = state.doc, sel = state.selection.main;
  for (let n = 1; n < doc.lines;) {
    const h = doc.line(n), s = doc.line(n + 1);
    if (h.text.includes('|') && isSep(s.text) && splitRow(h.text).length === splitRow(s.text).length) {
      let end = n + 1;
      while (end + 1 <= doc.lines && doc.line(end + 1).text.includes('|') && doc.line(end + 1).text.trim()) end++;
      const from = h.from, to = doc.line(end).to;
      if (!(sel.from <= to && sel.to >= from)) {   // カーソルが表の中（元の記述）にあるときだけ、元の記述を出す
        const cols = splitRow(h.text).length, rows = [splitRow(h.text)]; for (let k = n + 2; k <= end; k++) rows.push(splitRow(doc.line(k).text));
        rows.forEach(r => { while (r.length < cols) r.push(''); r.length = cols; });
        const align = splitRow(s.text).map(c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '');
        b.add(from, to, Decoration.replace({ widget: new TableWidget(rows, align, from, to), block: true }));
      }
      n = end + 1;
    } else n++;
  }
  return b.finish();
}
const tableField = StateField.define({
  create: tables, update: (v, tr) => (tr.docChanged || tr.selection) ? tables(tr.state) : v,
  provide: f => EditorView.decorations.from(f)
});

// ===== アウトライン（箇条書き・見出しの折りたたみ）=====
const outlineFold = foldService.of((state, from) => {
  const line = state.doc.lineAt(from), text = line.text;
  let level, isHead = false;
  const h = text.match(/^(#{1,6})\s/);
  if (h) { level = h[1].length; isHead = true; }
  else if (BULLET.test(text)) level = indentOf(text);
  else return null;
  let end = line.number;
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const t = state.doc.line(n).text;
    if (!t.trim()) { end = n; continue; }
    if (isHead) { const hm = t.match(/^(#{1,6})\s/); if (hm && hm[1].length <= level) break; }
    else if (indentOf(t) <= level) break;
    end = n;
  }
  while (end > line.number && !state.doc.line(end).text.trim()) end--;
  return end > line.number ? { from: line.to, to: state.doc.line(end).to } : null;
});

// ===== キー操作（Enter で箇条書きを続ける・Tab で字下げ）=====
function continueList(view) {
  const { state } = view, sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head), m = line.text.match(BULLET);
  if (!m || sel.head < line.from + m[0].length) return false;
  if (line.text.slice(m[0].length).trim() === '') { // 空の項目で Enter → 箇条書きを終える（ひとつ上の階層へ）
    const ind = m[1].length;
    if (ind >= INDENT.length) { view.dispatch({ changes: { from: line.from, to: line.from + INDENT.length, insert: '' } }); return true; }
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } }); return true;
  }
  let mark = m[2];
  const num = mark.match(/^(\d+)([.)])$/); if (num) mark = (+num[1] + 1) + num[2];
  const ins = '\n' + m[1] + mark + m[3] + (m[4] ? '[ ] ' : '');
  view.dispatch({ changes: { from: sel.head, insert: ins }, selection: { anchor: sel.head + ins.length } });
  return true;
}
function shift(view, dir) {
  const { state } = view, ch = [];
  const seen = new Set();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue; seen.add(n);
      const line = state.doc.line(n);
      if (dir > 0) { if (BULLET.test(line.text) || state.selection.ranges.length || r.from !== r.to) ch.push({ from: line.from, insert: INDENT }); }
      else { const sp = line.text.match(/^( {1,2}|\t)/); if (sp) ch.push({ from: line.from, to: line.from + sp[0].length, insert: '' }); }
    }
  }
  if (!ch.length) return dir > 0 ? false : true;
  view.dispatch({ changes: ch }); return true;
}
const listKeys = Prec.high(keymap.of([
  { key: 'Enter', run: continueList },
  { key: 'Tab', run: v => { // 箇条書きの行と複数行の選択は字下げ。ふつうの行は Tab 文字そのものを入れる
    const sel = v.state.selection.main, l = v.state.doc.lineAt(sel.head);
    const multi = v.state.doc.lineAt(sel.from).number !== v.state.doc.lineAt(sel.to).number;
    if (BULLET.test(l.text) || multi) return shift(v, 1);
    v.dispatch(v.state.replaceSelection('\t'), { scrollIntoView: true, userEvent: 'input' }); return true;
  } },
  { key: 'Shift-Tab', run: v => shift(v, -1) },
  { key: 'Mod-Enter', run: v => { // チェックボックスの切り替え
    const l = v.state.doc.lineAt(v.state.selection.main.head), m = l.text.match(BULLET);
    if (!m) return false;
    if (!m[4]) { const at = l.from + m[1].length + m[2].length + m[3].length; v.dispatch({ changes: { from: at, insert: '[ ] ' } }); return true; }
    const at = l.from + m[1].length + m[2].length + m[3].length + 1;
    v.dispatch({ changes: { from: at, to: at + 1, insert: /[xX]/.test(m[4]) ? ' ' : 'x' } }); return true;
  } },
  { key: 'Mod-ArrowUp', run: v => moveLines(v, -1) },
  { key: 'Mod-ArrowDown', run: v => moveLines(v, 1) }
]));
// 箇条書きの行を、子ごと上下に動かす（アウトラインの並べ替え）
function moveLines(view, dir) {
  const { state } = view, doc = state.doc, n = doc.lineAt(state.selection.main.head).number, line = doc.line(n);
  if (!BULLET.test(line.text)) return false;
  const level = indentOf(line.text), block = (k) => { // k 行目の項目と、その子の最後の行
    let e = k; for (let i = k + 1; i <= doc.lines; i++) { const t = doc.line(i).text; if (t.trim() && indentOf(t) <= indentOf(doc.line(k).text)) break; if (t.trim()) e = i; }
    return e;
  };
  const end = block(n);
  if (dir < 0) {
    let p = n - 1; while (p >= 1 && !(BULLET.test(doc.line(p).text) && indentOf(doc.line(p).text) === level)) { if (p < n - 1 && indentOf(doc.line(p).text) < level && doc.line(p).text.trim()) return true; p--; }
    if (p < 1) return true;
    const a = doc.line(p).from, mid = line.from, to = doc.line(end).to;
    view.dispatch({ changes: { from: a, to, insert: doc.sliceString(mid, to) + '\n' + doc.sliceString(a, mid - 1) }, selection: { anchor: a + (state.selection.main.head - line.from) } });
  } else {
    const nx = end + 1; if (nx > doc.lines || !BULLET.test(doc.line(nx).text) || indentOf(doc.line(nx).text) !== level) return true;
    const ne = block(nx), a = line.from, to = doc.line(ne).to, mid = doc.line(nx).from;
    view.dispatch({ changes: { from: a, to, insert: doc.sliceString(mid, to) + '\n' + doc.sliceString(a, mid - 1) }, selection: { anchor: a + (mid - a) + (state.selection.main.head - line.from) } });
  }
  return true;
}

// ===== 最後の行より下をクリックしたら、最後の行の最後にカーソル（Obsidian 同様）=====
const clickBelow = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || view.contentDOM.contains(e.target) || e.target.closest('.cm-gutters')) return false;
    if (!view.scrollDOM.contains(e.target)) return false;
    const end = view.state.doc.length, bottom = view.contentDOM.getBoundingClientRect().bottom;
    const pos = e.clientY > bottom ? end : (view.posAtCoords({ x: e.clientX, y: e.clientY }, false) ?? end);
    e.preventDefault();
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true }); view.focus();
    return true;
  }
});

// カーソルが画面の端に着く前にスクロールする（端に張り付かない）
const margins = EditorView.scrollMargins.of(() => ({ top: 90, bottom: 190 }));
// 行の頭で \`\`\` を書いたら、下にも同じもの（閉じ）を入れる。カーソルは、1 行目の最後（言語名を書ける）。もう囲みの中にいるときは、入れない
const fenceClose = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '`' || from !== to) return false;
  const line = view.state.doc.lineAt(from), before = line.text.slice(0, from - line.from);
  if (!/^\s*``$/.test(before) || line.text.slice(from - line.from).trim() !== '') return false;
  let open = 0; for (let n = 1; n < line.number; n++) if (/^\s*(```|~~~)/.test(view.state.doc.line(n).text)) open++;
  if (open % 2 === 1) return false;
  const indent = before.match(/^\s*/)[0];
  view.dispatch({ changes: { from, insert: '`\n' + indent + '\n' + indent + '```' }, selection: { anchor: from + 1 }, userEvent: 'input' });
  return true;
});
const noMiddlePaste = EditorView.domEventHandlers({
  mousedown(e) { if (e.button === 1) { e.preventDefault(); return true; } },
  auxclick(e) { if (e.button === 1) { e.preventDefault(); return true; } },
  paste(e) { return false; }
});
// Mermaid: カーソル（選択）が図の外にあるときは描いた図だけを出し、図の中に入ると Markdown のソースを出す。
class MermaidWidget extends WidgetType {
  constructor(source, from) { super(); this.source = source; this.from = from; }
  eq(other) { return other.source === this.source && other.from === this.from; }
  toDOM(view) {
    const holder = document.createElement('div');
    holder.innerHTML = mermaidPlaceholder(this.source);
    const el = holder.firstElementChild;
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() { return true; }
}
function mermaidBlocks(state) {
  const decorations = [], ranges = state.selection.ranges;
  let open = null;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    if (!open) {
      const start = line.text.match(/^\s*(`{3,}|~{3,})mermaid\s*$/i);
      if (start) open = { line, marker: start[1][0], markerLength: start[1].length, code: [] };
      continue;
    }
    const trimmed = line.text.trim();
    if (trimmed.length >= open.markerLength && [...trimmed].every(ch => ch === open.marker)) {
      const from = open.line.from, to = line.to;
      const editing = ranges.some(r => r.from <= to && r.to >= from);
      if (!editing) {
        decorations.push(Decoration.replace({
          widget: new MermaidWidget(open.code.join('\n'), from),
          block: true
        }).range(from, to));
      }
      open = null;
    } else open.code.push(line.text);
  }
  return Decoration.set(decorations, true);
}
const mermaidField = StateField.define({
  create: state => mermaidBlocks(state),
  update(value, tr) { return tr.docChanged || tr.selection ? mermaidBlocks(tr.state) : value; },
  provide: field => EditorView.decorations.from(field)
});

export const mdExtensions = [...stampExtensions, noMiddlePaste, margins, 
  linePlugin, tableField, boardField, mermaidField, codeFolding(),
  foldGutter({ markerDOM: open => { const s = document.createElement('span'); s.className = 'cm-fold-mark'; s.textContent = open ? '▾' : '▸'; return s; } }),
  outlineFold, listKeys, clickBelow, fenceClose, keymap.of(foldKeymap)
];
// 表のひな形
export const tableTemplate = '|  |  |  |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n';   // 見出しの行は無し（ふつうの行）

// ===== 検索した語の印（開いたノートの本文の中）=====
export const setSearch = StateEffect.define();
export const searchExt = StateField.define({
  create: () => ({ q: '', deco: Decoration.none }),
  update(v, tr) {
    let q = v.q, changed = tr.docChanged;
    for (const e of tr.effects) if (e.is(setSearch)) { q = e.value; changed = true; }
    if (!changed) return v;
    if (!q || ![].concat(q).some(Boolean)) return { q, deco: Decoration.none };
    const text = tr.state.doc.toString().toLowerCase(), r = [];
    for (const needle of [].concat(q).map(x => String(x).toLowerCase()).filter(Boolean))   // q は、1 つの語か、語の並び
      for (let i = text.indexOf(needle); i >= 0 && r.length < 800; i = text.indexOf(needle, i + needle.length)) r.push(Decoration.mark({ class: 'hl' }).range(i, i + needle.length));
    return { q, deco: Decoration.set(r, true) };
  },
  provide: f => EditorView.decorations.from(f, v => v.deco)
});
