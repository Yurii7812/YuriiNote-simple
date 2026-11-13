'use strict';
// スマホ（WebView版）から届く「受信箱」を取り込む。スマホは、既存のファイルを書き換えず、新しいファイルだけを書く:
//   memo-*.json   {"type":"memo","at":"2026-11-13 13:05","text":"…"}      → メモ帳（その日）へ1行追記。行の先頭に「年月日 時刻 」が付く（表示するかは、画面の設定）
//   diary-*.json  {"type":"diary","kind":"日記","date":"2026-11-13","text":"…"}        → その日の日記／時系列記録の本文へ追記
//   note-*.json   {"type":"note","created":"2026-11-13 13:20","body":"…"}              → IDなしのノート（未所属）を新しく作る
//   paper-*.json  {"type":"paper","at":"…","image":"paper-….jpg"} と画像              → 紙のカードの写真。PC の紙の取り込み画面で番号を付ける
// 取り込めたファイルの名前を返す。呼び出し側は、その名前のファイルをスマホから消す（取り込んだら消える）
const L = require('./lib'), Stamp = require('./stamp');

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const dateOf = at => String(at || '').slice(0, 10);
const stampAt = at => { const m = String(at || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/); return m ? m[1] + ' ' + m[2] : Stamp.nowStamp(); };
const oneLine = t => String(t).replace(/\r?\n+/g, ' ').trim();

// files: [{name, buf}]（buf は Buffer）。papers: 紙の写真の保存先を決める関数 (name, buf) => 保存した名前（省略時は保存しない）
function importInbox(v, files, { papers, seen } = {}) {   // seen: すでに取り込んだファイル名の集まり（消さずに残してあるものを、二度取り込まない）
  const sum = { memos: 0, diaries: 0, notes: 0, papers: 0, skipped: 0, already: 0 };
  const done = [], bad = [];
  const by = new Map(files.map(f => [f.name, f]));
  const sorted = files.filter(f => /\.json$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));   // 名前に時刻が入っているので、書いた順
  for (const f of sorted) {
    if (seen && seen.has(f.name)) { sum.already++; continue; }
    let d; try { d = JSON.parse(f.buf.toString('utf8')); } catch { bad.push(f.name); sum.skipped++; continue; }
    try {
      if (d.type === 'memo' && String(d.text || '').trim()) {
        const at = stampAt(d.at), date = at.slice(0, 10);
        v.appendToDay('メモ帳', date, `${at} ${oneLine(d.text)}`); sum.memos++; done.push(f.name);
      } else if (d.type === 'diary' && isDate(d.date) && String(d.text || '').trim()) {
        v.appendToDay(d.kind || '日記', d.date, Stamp.add(String(d.text).replace(/\s+$/, ''), stampAt(d.at))); sum.diaries++; done.push(f.name);
      } else if (d.type === 'note' && String(d.body || '').trim()) {
        v.createNote({ kind: 'text', id: undefined, created: d.created || undefined, body: String(d.body).replace(/\s+$/, '') }); sum.notes++; done.push(f.name);
      } else if (d.type === 'paper' && d.image && by.has(d.image)) {
        if (papers) papers(d.image, by.get(d.image).buf, d); sum.papers++; done.push(f.name, d.image);
      } else { bad.push(f.name); sum.skipped++; }
    } catch { bad.push(f.name); sum.skipped++; }
  }
  return { sum, done, bad };
}
const summary = s => [s.memos && `メモ ${s.memos} 件`, s.diaries && `日記 ${s.diaries} 件`, s.notes && `ノート ${s.notes} 件`, s.papers && `紙のカード ${s.papers} 枚`].filter(Boolean).join('、');

module.exports = { importInbox, summary };
