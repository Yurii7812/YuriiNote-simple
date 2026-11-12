// 紙のIndex の追加・直す・削除。上の Index タブ（🔖）の中で使う
//  ・キーワード・よみ・ID を書いて足す。ID はまだ取り込んでいない紙のものでもよい（取り込まれたら本 Index に自動でマージ）
import { ctx, $, esc, dialog, popMenu } from './shared.js';
import L from '../lib.js';

let pend = [];            // まだ紙のノートが無いもの [{ kw, reading, ids }]
let sugTimer = null;

export function init(docs) { pend = (docs['K_paperindex'] && docs['K_paperindex'].entries) || []; }
export const pendingEntries = () => pend.map(e => ({ kw: e.kw, reading: e.reading || '', ids: [...(e.ids || [])] }));
export const apply = st => { pend = (st.docs && st.docs['K_paperindex'] && st.docs['K_paperindex'].entries) || []; };
export const isPending = kw => pend.some(e => e.kw === kw);

// Index タブの上に出す、追加の欄とフィルター
export function form() {
  return `<div id="pi"><div class="pi-form">
      <input id="pi-kw" placeholder="紙のキーワード" autocomplete="off"><input id="pi-rd" placeholder="よみ（自動）" autocomplete="off">
      <input id="pi-ids" placeholder="ID　例: 12 12a" autocomplete="off"><button class="p" id="pi-add">追加</button>
    </div>
  </div>`;
}
async function add() {
  const kw = $('#pi-kw').value.trim(), ids = $('#pi-ids').value.split(/[\s,、，]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!kw) return $('#pi-kw').focus();
  const bad = ids.filter(i => !L.isId(L.splitAnchor(i).id)); if (bad.length) return alert(`IDの形が違います: ${bad.join(' ')}\n（例: 12 や 3a や 3a(1)）`);
  let rd = L.toHira($('#pi-rd').value.trim()); if (!rd) rd = await ctx.api.suggest(kw);
  await ctx.flush();
  const st = await ctx.api.addPaperIndex({ kw, reading: rd, ids });
  if (!st) return;
  ctx.applyState(st);   // 一覧を描き直す
  const f = $('#pi-kw'); if (f) f.focus();
}

document.addEventListener('input', e => {
  if (e.target.id === 'pi-kw') { // よみの候補を、自動で入れる（直していなければ）
    clearTimeout(sugTimer);
    sugTimer = setTimeout(async () => { const rd = $('#pi-rd'); if (!rd || rd.dataset.touched) return; const k = e.target.value.trim(); rd.value = k ? await ctx.api.suggest(k) : ''; }, 220);
  }
  if (e.target.id === 'pi-rd') e.target.dataset.touched = e.target.value ? '1' : '';
});
document.addEventListener('keydown', e => {
  if (['pi-kw', 'pi-rd', 'pi-ids'].includes(e.target.id) && e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); }
  if (['pi-kw', 'pi-rd', 'pi-ids'].includes(e.target.id) && e.key === 'Escape') { e.target.blur(); }
});
document.addEventListener('click', e => { if (e.target.id === 'pi-add') add(); });

// 右クリック: 取り込み前の紙のキーワードの行を、直す・削除
document.addEventListener('contextmenu', e => {
  const row = e.target.closest('#list .ix[data-ixk]'); if (!row || !isPending(row.dataset.ixk)) return;
  e.preventDefault();
  const kw = row.dataset.ixk;
  popMenu(e, [['✏️ 紙のキーワードを直す', () => editEntry(kw)], ['🗑 この紙のキーワードを削除', () => delEntry(kw), true]]);
});
const entryIds = kw => pend.filter(e => e.kw === kw).flatMap(e => e.ids || []);
function editEntry(kw) {
  const e0 = pend.find(e => e.kw === kw); if (!e0) return;
  const all = entryIds(kw);
  dialog(`<div class="dlg-a"><h3>✏️ 紙のIndex を直す</h3>
    <div class="da-lab">🏷 キーワード</div><input id="pe-kw" value="${esc(kw)}" autocomplete="off">
    <div class="da-lab">🔤 よみ（ふりがな）</div><input id="pe-rd" value="${esc(e0.reading || '')}" autocomplete="off">
    <div class="da-lab">🔢 番号（空白で区切る）</div><input id="pe-ids" value="${esc(all.join(' '))}" autocomplete="off">
    <div class="da-bar"><span class="grow"></span><button id="pe-no">やめる</button><button class="p" id="pe-ok">✅ 決定</button></div></div>`, close => {
    $('#pe-kw').focus(); $('#pe-no').onclick = close;
    const ok = async () => {
      const nk = $('#pe-kw').value.trim(), ids = $('#pe-ids').value.split(/[\s,、，]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
      if (!nk) return $('#pe-kw').focus();
      const bad = ids.filter(i => !L.isId(L.splitAnchor(i).id)); if (bad.length) return alert(`IDの形が違います: ${bad.join(' ')}\n（例: 12 や 3a や 3a(1)）`);
      const rd = L.toHira($('#pe-rd').value.trim()) || e0.reading || await ctx.api.suggest(nk);
      await ctx.flush();
      let st = null;
      for (const id of all) if (nk !== kw || !ids.includes(id)) st = (await ctx.api.removePaperIndex({ kw, id })) || st;   // 外れた番号・名前を変えたときの古い行
      if (ids.length) st = (await ctx.api.addPaperIndex({ kw: nk, reading: rd, ids })) || st;
      close(); if (st) ctx.applyState(st);
    };
    $('#pe-ok').onclick = ok;
    for (const id of ['pe-kw', 'pe-rd', 'pe-ids']) $('#' + id).onkeydown = ev => { if (ev.key === 'Enter' && !ev.isComposing) { ev.preventDefault(); ok(); } };
  });
}
async function delEntry(kw) {
  const all = entryIds(kw); if (!all.length) return;
  if (!confirm(`紙のIndex から「${kw}」を削除しますか？\n（番号 ${all.join(' ')} も、このキーワードから外れます）`)) return;
  await ctx.flush();
  let st = null; for (const id of all) st = (await ctx.api.removePaperIndex({ kw, id })) || st;
  if (st) ctx.applyState(st);
}
