const L = require('./lib'), Core = require('./link-core');
function suppressed(text,pos) {
  if(L.codeRanges(text).some(([a,b])=>pos>a&&pos<=b))return true;
  const line=text.slice(text.lastIndexOf('\n',pos-1)+1,pos);
  if((line.match(/`+/g)||[]).length%2===1 || /(?:^|\s)(?:const|let|var|return|function)\b/.test(line) || /[{}]/.test(line) || /["'][^"']*["']\s*:$/.test(line))return true;
  if(/(?:https?|ftp|file|mailto|memo|link|note|reply):[^\s]*$/i.test(line)||/\d{1,2}:\d*$/.test(line))return true;
  if(/\]\([^)]*$/.test(line)||/\[[^\]]*$/.test(line)||/[)\]]\s*:$/.test(line)||/:[0-9]+[a-z0-9]*(?:\([pd]\))?:$/.test(line))return true;
  return false;
}
// 候補を出す合図: 「:」「->」「→」を打ったとき。選ぶと ->ID（Enter）か ID->（Shift+Enter）が入る
const markLen=(text,pos,inserted)=>{
  if(inserted.includes(':')&&text[pos-1]===':')return 1;
  if(inserted.includes('>')&&text.slice(pos-2,pos)==='->'&&!/[-<=]/.test(text[pos-3]||''))return 2;   // --> や <-> は、矢印の絵なので、候補を出さない
  if(inserted.includes('→')&&text[pos-1]==='→')return 1;
  return 0;
};
class Session {
  constructor(){this.active=null;}
  close(){this.active=null;}
  update(text,pos,inserted='') {
    if(this.active){const a=this.active,q=a.colon+a.len;if(pos<q||!text.startsWith(a.mark,a.colon)||/[\s\n:]/.test(text.slice(q,pos))||suppressed(text,q)){this.close();return null;}a.to=pos;a.query=a.before||text.slice(q,pos);return a;}
    const len=markLen(text,pos,inserted);if(!len||suppressed(text,pos))return null;
    const start=pos-len,before=text.slice(0,start),word=before.match(/(?:^|[\s、。！？(])([^\s:：\[\]()`~{};=]+)$/u),last=word?.[1]||'';
    if(last&&(L.isId(last)||/[/=;{}]$/.test(last)||/[-→>]$/.test(last)))return null; // Existing Folgezettel postfix/time/code.
    const from=last?start-last.length:start;
    this.active={from,colon:start,len,mark:text.slice(start,pos),to:pos,query:last,before:last};return this.active;
  }
}
function insertion(item,postfix,space='d'){return Core.reference(item,postfix,space);}
module.exports={Session,suppressed,insertion};
