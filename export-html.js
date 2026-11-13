'use strict';
// 選んだノートを、1 つの HTML にまとめる。ネットがなくても、ブラウザで開ける（外のファイルは使わない）。
// 範囲に入っているノートへのリンクは、この HTML の中で、そのノートへ移る。範囲の外は、リンクにしない。
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const jsStr = s => JSON.stringify(String(s == null ? '' : s)).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const anchorOf = (s, id) => 'n-' + (s || 'd') + '-' + String(id).replace(/[^0-9A-Za-z_-]/g, '_');

// notes: [{ s, id, title, html, noid }]。html は、ノートの本文を、HTML にしたもの（リンクは、href="#n-…" か、リンクなし）
function buildHtml({ title = 'YuriiNote', notes = [], generated = '' } = {}) {
  const nav = notes.map(n => `<a href="#${anchorOf(n.s, n.id)}" data-k="${anchorOf(n.s, n.id)}"><b>${n.noid ? '' : esc((n.s === 'p' ? '紙 ' : '') + n.id)}</b> ${esc(n.title || '（題なし）')}</a>`).join('\n');
  const body = notes.map(n => `<section id="${anchorOf(n.s, n.id)}" class="note" hidden>
<header><span class="nid">${n.noid ? 'IDなし' : esc((n.s === 'p' ? '紙 ' : '') + n.id)}</span><h1>${esc(n.title || '（題なし）')}</h1></header>
<div class="md">${n.html || ''}</div>
</section>`).join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fbfaf7;--fg:#24262b;--sub:#6b7080;--line:#e2e1db;--acc:#2f5fd0;--side:#f2f1ec;--red:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#1d1f24;--fg:#e4e5e8;--sub:#9aa0ad;--line:#33363e;--acc:#7da2ff;--side:#23262c;--red:#ff7b6b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.85 system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;display:flex;min-height:100vh}
nav{width:280px;flex:none;background:var(--side);border-right:1px solid var(--line);padding:14px 10px;overflow:auto;position:sticky;top:0;height:100vh}
nav h2{font-size:13px;color:var(--sub);margin:0 6px 8px;font-weight:600}
nav input{width:100%;font:inherit;font-size:14px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);margin-bottom:8px}
nav a{display:block;padding:5px 8px;border-radius:8px;color:var(--fg);text-decoration:none;font-size:14px;line-height:1.5}
nav a b{color:var(--sub);font-weight:600;margin-right:4px}
nav a:hover{background:var(--line)}nav a.on{background:var(--acc);color:#fff}nav a.on b{color:#fff}
main{flex:1;min-width:0;max-width:820px;padding:28px max(20px,env(safe-area-inset-right)) 80px 32px}
.nid{color:var(--sub);font-size:14px}
h1{margin:4px 0 18px;font-size:28px;line-height:1.35}
.md img{max-width:100%}
.md a{color:var(--acc)}
.md a.out{color:var(--sub);text-decoration:none;border-bottom:1px dotted var(--sub)}
.md pre{background:var(--side);padding:10px 12px;border-radius:8px;overflow:auto}
.md code{background:var(--side);padding:1px 5px;border-radius:4px}
.md table{border-collapse:collapse}.md td,.md th{border:1px solid var(--line);padding:4px 10px}
.md blockquote{margin:0;padding-left:14px;border-left:3px solid var(--line);color:var(--sub)}
.foot{margin-top:40px;color:var(--sub);font-size:12px}
@media (max-width:760px){body{display:block}nav{width:auto;height:auto;position:static;max-height:38vh;border-right:0;border-bottom:1px solid var(--line)}main{padding:18px 16px 60px}}
</style>
</head>
<body>
<nav><h2>${esc(title)}（${notes.length}件）</h2><input id="f" type="search" placeholder="絞り込み">
${nav}
</nav>
<main>
${body || '<p>ノートがありません</p>'}
<div class="foot">${esc(generated)}</div>
</main>
<script>
(function(){
var secs=[].slice.call(document.querySelectorAll('section.note')),links=[].slice.call(document.querySelectorAll('nav a'));
function show(){
  var h=decodeURIComponent((location.hash||'').slice(1)),hit=null;
  secs.forEach(function(s){if(s.id===h)hit=s});
  if(!hit&&secs.length)hit=secs[0];
  secs.forEach(function(s){s.hidden=s!==hit});
  links.forEach(function(a){a.classList.toggle('on',!!hit&&a.getAttribute('data-k')===hit.id)});
  if(hit){var on=document.querySelector('nav a.on');if(on&&on.scrollIntoView)on.scrollIntoView({block:'nearest'});window.scrollTo(0,0);document.title=hit.querySelector('h1').textContent+' - '+${jsStr(title)}}
}
window.addEventListener('hashchange',show);show();
document.getElementById('f').addEventListener('input',function(e){
  var q=e.target.value.trim().toLowerCase();
  links.forEach(function(a){a.style.display=!q||a.textContent.toLowerCase().indexOf(q)>=0?'':'none'});
});
})();
</script>
</body>
</html>
`;
}

module.exports = { buildHtml, anchorOf };
