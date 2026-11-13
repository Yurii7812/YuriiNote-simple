// 画面側: 選んだノートを HTML にして、書き出し用の部品（export-html.js）に渡す
import EH from '../export-html.js';

const blobToDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

// notes: ordered note objects。範囲の中のノートへのリンクだけ、リンクとして生かす
async function build(notes, { renderMd, clipText, get, titleOf }) {
  const keys = new Set(notes.map(n => n.s + ':' + n.id));
  const out = [];
  for (const n of notes) {
    const box = document.createElement('div');
    box.innerHTML = renderMd(clipText(n.body || ''));
    for (const a of [...box.querySelectorAll('a')]) {
      const ref = a.dataset.ref, file = a.dataset.file || a.getAttribute('href') || '';
      if (ref) {
        const [sp, ...r] = ref.split(':'), id = r.join(':');
        if (keys.has(sp + ':' + id)) { a.setAttribute('href', '#' + EH.anchorOf(sp, id)); a.removeAttribute('data-ref'); a.removeAttribute('data-file'); a.textContent = a.textContent.replace(/->/g, '→'); }
        else { const s = document.createElement('span'); s.className = 'out'; s.title = '書き出した範囲の外'; s.textContent = a.textContent.replace(/->/g, '→'); a.replaceWith(s); }   // 範囲の外は、リンクにしない
      } else if (/^https?:/i.test(file)) { a.setAttribute('href', file); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.removeAttribute('data-file'); }
      else { const s = document.createElement('span'); s.className = 'out'; s.textContent = a.textContent; a.replaceWith(s); }   // vault の中のファイルは、辿れない
    }
    for (const img of [...box.querySelectorAll('img')]) {   // 画像は、HTML の中に埋め込む（1 ファイルで持ち運べるように）
      const src = img.getAttribute('src') || '';
      if (!src || /^data:/.test(src)) continue;
      try { const r = await fetch(src); if (!r.ok) throw 0; img.setAttribute('src', await blobToDataUrl(await r.blob())); }
      catch { if (!/^https?:/i.test(src)) { const alt = document.createElement('span'); alt.className = 'out'; alt.textContent = '[画像: ' + (img.alt || src.split('/').pop()) + ']'; img.replaceWith(alt); } }
    }
    for (const el of [...box.querySelectorAll('[data-ref],[data-file],[data-ln]')]) { el.removeAttribute('data-ref'); el.removeAttribute('data-file'); }
    out.push({ s: n.s, id: n.id, noid: !!n.noid, title: titleOf(n), html: box.innerHTML });
  }
  return EH.buildHtml({ title: 'YuriiNote', notes: out, generated: '書き出し: ' + new Date().toLocaleString('ja-JP') });
}
export default { build };
