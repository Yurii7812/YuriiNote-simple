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
const ONEID='[0-9]+[a-z0-9]*(?:\\([pd0-9]*\\))*',COMMA_AFTER=new RegExp(`(?:->|→)${ONEID}(?:[,，、]${ONEID})*$`);
const markLen=(text,pos,inserted)=>{
  if(inserted.includes(':')&&text[pos-1]===':')return 1;
  if(inserted.includes('>')&&text.slice(pos-2,pos)==='->'&&!/[-<=]/.test(text[pos-3]||''))return 2;   // --> や <-> は、矢印の絵なので、候補を出さない
  if(inserted.includes('→')&&text[pos-1]==='→')return 1;
  if(/[,，、]/.test(inserted)&&/[,，、]/.test(text[pos-1]||'')&&COMMA_AFTER.test(text.slice(0,pos-1)))return 1;   // ->1a, のように、ID のあとにコンマを打ったとき（続けて、もう 1 つ ID を足す）
  return 0;
};
class Session {
  constructor(){this.active=null;}
  close(){this.active=null;}
  update(text,pos,inserted='') {
    // 「:」「->」を打つと、候補が出る。そのあとに打った文字は、記号の右（本文の中）に入り、その文字で候補を絞る。Esc で、その文字は、そのまま残る
    // ->1a, のように、ID のあとにコンマを打ったときも、候補が出る（選ぶと、コンマの右に ID が入る）
    if(this.active){const a=this.active,q=a.colon+a.len;
      if(a.comma&&/[,，、]/.test(text.slice(q,pos))){this.close();}   // 次のコンマ: 前の候補を閉じて、新しく出し直す
      else{if(pos<q||!text.startsWith(a.mark,a.colon)||/[\s\n:]/.test(text.slice(q,pos))||suppressed(text,q)){this.close();return null;}a.to=pos;a.query=text.slice(q,pos);return a;}
    }
    const len=markLen(text,pos,inserted);if(!len||suppressed(text,pos))return null;
    const start=pos-len,comma=/[,，、]/.test(text[start]||''),before=text.slice(0,start),word=before.match(/(?:^|[\s、。！？(])([^\s:：\[\]()`~{};=]+)$/u),last=word?.[1]||'';
    if(!comma&&last&&(L.isId(last)||/[/=;{}]$/.test(last)||/[-→>]$/.test(last)))return null; // Existing Folgezettel postfix/time/code.
    this.active={from:start,colon:start,len,mark:text.slice(start,pos),to:pos,query:'',before:'',comma};return this.active;
  }
}
function insertion(item,postfix,space='d'){return Core.reference(item,postfix,space);}
module.exports={Session,suppressed,insertion};
