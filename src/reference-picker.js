import { EditorView, keymap } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import Ref from '../reference-search.js';
import L from '../lib.js';
import { ctx, esc } from './shared.js';
let popup=null, controller=null;
// 「:(」で、このノートの (n)（番号の目印）を、周りの文章つきで選ぶ。前置は :(n) 、後置は (n):
const insText=(x,post,space)=>x.kind==='anchor'?(post?`(${x.n}):`:`:(${x.n})`):Ref.insertion(x,post,space);
export function anchorChoices(doc,after){
  const q=(after.match(/^\((\d*)/)||[])[1]||'',seen=new Set(),out=[];
  for(const t of L.tokens(doc)){
    if(t.k!=='self'||!t.bare||seen.has(t.n)||(q&&!String(t.n).startsWith(q)))continue;seen.add(t.n);
    const ls=doc.lastIndexOf('\n',t.from-1)+1,e0=doc.indexOf('\n',t.to),le=e0<0?doc.length:e0;
    const ctxText=doc.slice(ls,le).replace(/\s+/g,' ').trim();
    out.push({kind:'anchor',n:t.n,id:t.text,title:ctxText,text:ctxText});
  }
  return out.sort((a,b)=>a.n-b.n);
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
export function extension(space='d') {
  const session=new Ref.Session();let view;
  const cancel=()=>{session.close();close();};
  const update=u=>{
    view=u.view;if(!u.docChanged&&!u.selectionSet)return;
    let inserted='';u.changes.iterChanges((_a,_b,_c,_d,text)=>{inserted+=text.toString();});
    const state=session.update(u.state.doc.toString(),u.state.selection.main.head,inserted);
    if(!state){if(controller&&controller.owner===view)close();return;}
    const doc=u.state.doc.toString(),after=doc.slice(state.colon+1,state.to),choices=after.startsWith('(')?anchorChoices(doc,after):(ctx.searchReferences?.(state.query)||[]);
    if(!choices.length){close();return;}
    show(state,choices,()=>view.coordsAtPos(view.state.selection.main.head), (item,post)=>{
      const start=item.kind==='anchor'?state.colon:state.from,end=state.to;session.close();const text=insText(item,post,space)+' ';
      view.dispatch({changes:{from:start,to:end,insert:text},selection:{anchor:start+text.length}});view.focus();
    },cancel,space);controller.owner=view;
  };
  const handle=(v,post,key)=>{if(controller?.owner!==v)return false;return controller.key({key,shiftKey:post});};
  return [EditorView.updateListener.of(update),Prec.highest(keymap.of([{key:'Enter',run:v=>handle(v,false,'Enter')},{key:'Shift-Enter',run:v=>handle(v,true,'Enter')},{key:'ArrowDown',run:v=>handle(v,false,'ArrowDown')},{key:'ArrowUp',run:v=>handle(v,false,'ArrowUp')},{key:'Escape',run:v=>handle(v,false,'Escape')}])),EditorView.domEventHandlers({blur(){cancel();}})];
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
