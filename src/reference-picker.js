import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import Ref from '../reference-search.js';
import L from '../lib.js';
import { ctx, esc } from './shared.js';
let popup=null, controller=null;
// 「:」で候補を出し、選ぶと ->ID（Shift+Enter なら ID->）が入る。「:(」で、このノートの (n)（番号の目印）を選ぶと ->(n) / (n)->
const insText=(x,post,space)=>x.kind==='anchor'?(x.noteId?(post?`${x.noteId}(${x.n})->`:`->${x.noteId}(${x.n})`):(post?`(${x.n})->`:`->(${x.n})`)):Ref.insertion(x,post,space);
export function anchorChoices(doc,after,noteId=''){
  const q=(after.match(/^\((\d*)/)||[])[1]||'',seen=new Set(),out=[];
  for(const t of L.tokens(doc)){
    if(t.k!=='self'||!t.bare||seen.has(t.n)||(q&&!String(t.n).startsWith(q)))continue;seen.add(t.n);
    const ls=doc.lastIndexOf('\n',t.from-1)+1,e0=doc.indexOf('\n',t.to),le=e0<0?doc.length:e0;
    const ctxText=doc.slice(ls,le).replace(/\s+/g,' ').trim();
    out.push({kind:'anchor',n:t.n,id:t.text,title:ctxText,text:ctxText,noteId});
  }
  return out.sort((a,b)=>a.n-b.n);
}
// ボード（```board の JSON）の文字を、ふつうの行にして返す。(n) の番号や :( の候補を、ノート全体で数えるため
export function plainDoc(doc){
  return String(doc).replace(/^(`{3,})board[ \t]*\n([^\n]*)\n\1`*[ \t]*$/gm,(_m,_f,json)=>{try{return (JSON.parse(json).t||[]).map(a=>String(a[2])).join('\n');}catch{return '';}});
}
function close(){popup?.remove();popup=null;controller=null;}
function show(session,items,anchor,choose,onCancel,space='d') {
  close();popup=document.createElement('div');popup.className='reference-picker';popup.dataset.user='';let at=0;
  const draw=()=>{popup.innerHTML='<div class="reference-help">Enter：前置　Shift+Enter：後置　Esc：やめる</div>'+items.slice(0,60).map((x,i)=>`<div class="reference-candidate${at===i?' on':''}"><button data-ref="${i}">${x.kind==='anchor'?'🔖':x.kind==='memo'?'💬':x.s==='p'?'📜':'📝'} ${esc((x.title||x.text||x.body||x.id).slice(0,x.kind==='anchor'?90:65))}<small>${esc(insText(x,false,space))}　／　${esc(insText(x,true,space))}</small></button><button data-ref="${i}" data-post="1" title="後置で挿入">後置</button></div>`).join('');};
  const pick=(i,post=false)=>{const item=items[i];if(!item)return;close();choose(item,post);};
  controller={key:e=>{if(e.isComposing||e.keyCode===229)return false;if(e.key==='Escape'){close();onCancel();return true;}if(e.key==='ArrowDown'||e.key==='ArrowUp'){at=Math.max(0,Math.min(Math.min(60,items.length)-1,at+(e.key==='ArrowDown'?1:-1)));draw();return true;}if(e.key==='Enter'){pick(at,e.shiftKey);return true;}return false;}};
  popup.onmousedown=e=>{const b=e.target.closest('[data-ref]');if(b){e.preventDefault();pick(+b.dataset.ref,!!b.dataset.post);}};
  const rect=anchor()||{left:100,bottom:100};popup.style.left=Math.max(8,Math.min(rect.left,innerWidth-460))+'px';popup.style.top=Math.min(rect.bottom+4,innerHeight-240)+'px';document.body.append(popup);draw();
}
// 「:1b 」「1a: 」と打って空白を押したら、->1b / 1a-> に直す（-> を打つより、: のほうが楽なので）
const IDRE='[0-9]+[a-z0-9]*',IDS=`${IDRE}(?:[,，、]${IDRE})*`;
const toArrowTyped=(before)=>{
  let m=before.match(new RegExp(`(^|[\\s、。（(])[:：](${IDS})$`));if(m)return {from:before.length-m[0].length+m[1].length,text:'->'+m[2]};
  m=before.match(new RegExp(`(^|[\\s、。（(])(${IDS})[:：]$`));if(m)return {from:before.length-m[0].length+m[1].length,text:m[2]+'->'};
  return null;
};
export const arrowInput=EditorView.inputHandler.of((view,from,to,text)=>{
  if(text!==' '&&text!=='　')return false;
  const ln=view.state.doc.lineAt(from),before=ln.text.slice(0,from-ln.from),r=toArrowTyped(before);if(!r)return false;
  const start=ln.from+r.from;
  view.dispatch({changes:{from:start,to,insert:r.text+text},selection:{anchor:start+r.text.length+text.length},userEvent:'input.type'});return true;
});
export function extension(space='d') {
  const session=new Ref.Session();let view;
  const cancel=()=>{session.close();close();};
  const update=u=>{
    view=u.view;if(!u.docChanged&&!u.selectionSet)return;
    let inserted='';u.changes.iterChanges((_a,_b,_c,_d,text)=>{inserted+=text.toString();});
    const state=session.update(u.state.doc.toString(),u.state.selection.main.head,inserted);
    if(!state){if(controller&&controller.owner===view)close();return;}
    const doc=plainDoc(u.state.doc.toString()),after=doc.slice(state.colon+state.len,state.to),other=after.match(/^([0-9][0-9a-z]*)\((\d*)$/);
    const choices=after.startsWith('(')?anchorChoices(doc,after):other?anchorChoices(ctx.get?.('d',other[1])?.body||'','('+other[2],other[1]):(ctx.searchReferences?.(state.query)||[]);
    if(!choices.length){close();return;}
    show(state,choices,()=>view.coordsAtPos(view.state.selection.main.head), (item,post)=>{
      const start=item.kind==='anchor'?state.colon:state.from,end=state.to;session.close();const text=insText(item,post,space)+' ';
      view.dispatch({changes:{from:start,to:end,insert:text},selection:{anchor:start+text.length}});view.focus();
    },cancel,space);controller.owner=view;
  };
  const handle=(v,post,key)=>{if(controller?.owner!==v)return false;return controller.key({key,shiftKey:post});};
  return [arrowInput,EditorView.updateListener.of(update),Prec.highest(keymap.of([{key:'Enter',run:v=>handle(v,false,'Enter')},{key:'Shift-Enter',run:v=>handle(v,true,'Enter')},{key:'ArrowDown',run:v=>handle(v,false,'ArrowDown')},{key:'ArrowUp',run:v=>handle(v,false,'ArrowUp')},{key:'Escape',run:v=>handle(v,false,'Escape')}])),EditorView.domEventHandlers({blur(){cancel();}})];
}
const fields=new WeakMap();
export function attachTextareas() {
  document.addEventListener('input',e=>{
    const input=e.target;if(!(input instanceof HTMLTextAreaElement)||input.closest('.rp'))return;
    if(!input.matches('#c-in,.b-edit textarea'))return;
    let session=fields.get(input);if(!session){session=new Ref.Session();fields.set(input,session);}
    const state=session.update(input.value,input.selectionStart,e.data||'');
    if(!state){if(controller?.owner===input)close();return;}
    const items=ctx.searchReferences?.(state.query)||[];if(!items.length){close();return;}
    show(state,items,()=>input.getBoundingClientRect(),(item,post)=>{const text=Ref.insertion(item,post)+' ';session.close();input.setRangeText(text,state.from,state.to,'end');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();},()=>session.close());controller.owner=input;
  });
  document.addEventListener('keydown',e=>{if(controller?.owner!==e.target)return;if(controller.key(e)){e.preventDefault();e.stopImmediatePropagation();}},true);
  document.addEventListener('click',e=>{if(popup&&!popup.contains(e.target)&&controller?.owner!==e.target)close();});
}

// 文字だけの欄（ボードの文字など、contenteditable）で、「:」の候補と「:(」を使えるようにする。getDoc: ノート全体の文章（plainDoc済み）
export function attachEditable(el,getDoc,space='d'){
  const session=new Ref.Session();
  const caret=()=>{const s=getSelection();if(!s.rangeCount||!el.contains(s.anchorNode))return el.textContent.length;const r=document.createRange();r.selectNodeContents(el);r.setEnd(s.anchorNode,s.anchorOffset);return r.toString().length;};
  const setCaret=pos=>{const t=el.firstChild;if(!t){el.focus();return;}const r=document.createRange(),n=Math.min(pos,t.textContent.length);r.setStart(t,n);r.collapse(true);const s=getSelection();s.removeAllRanges();s.addRange(r);};
  const cancel=()=>{session.close();close();};
  el.addEventListener('input',e=>{
    if(e.isComposing)return;
    const value=el.textContent,state=session.update(value,caret(),e.data||'');
    if(!state){if(controller?.owner===el)close();return;}
    const doc=getDoc(),after=value.slice(state.colon+state.len,state.to),other=after.match(/^([0-9][0-9a-z]*)\((\d*)$/);
    const choices=after.startsWith('(')?anchorChoices(doc,after):other?anchorChoices(ctx.get?.('d',other[1])?.body||'','('+other[2],other[1]):(ctx.searchReferences?.(state.query)||[]);
    if(!choices.length){close();return;}
    show(state,choices,()=>{const s=getSelection();const r=s.rangeCount?s.getRangeAt(0).getBoundingClientRect():null;return r&&(r.width||r.height)?r:el.getBoundingClientRect();},(item,post)=>{
      const start=item.kind==='anchor'?state.colon:state.from,end=state.to;session.close();const text=insText(item,post,space)+' ';
      el.textContent=value.slice(0,start)+text+value.slice(end);setCaret(start+text.length);el.focus();
    },cancel,space);controller.owner=el;
  });
}
// 文字だけの欄で、候補が出ているときのキー（Enter・矢印・Esc）。使ったら true
export function refKey(el,ev){return controller?.owner===el&&!!controller.key(ev);}
