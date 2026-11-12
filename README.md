# YuriiNote（Simple 版）

紙のPKM（ツェッテルカステン）をデジタルでやるアプリ。ノート・日記・紙のIndexを、1つのフォルダに平らに保存します。
元の [YuriiNote](https://github.com/Yurii7812/YuriiNote) から、チャットメモ・なりきりチャット・グラフ・キャンバス・曼荼羅・類似ノートを外し、ここから少しずつシンプルにしていく作業用のコピーです。

## 入れる・更新する（Linux）
1行で入ります（git と Node.js が無ければ用意します）。

```sh
curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/bootstrap.sh | sh
```

入れたあとは、`YuriiNote-Simple` で起動、`YuriiNote-Simple --update` で最新に更新、`YuriiNote-Simple --version` でバージョン表示。メニューとデスクトップにも登録されます。更新が失敗したときは、前の状態のまま残ります。

## 含まれるもの
- ノート（Folgezettel ID）・日記・紙のノート／紙のIndex・トピックIndex（1-1, 1-2）・グループIndex（0-1, 0-2）
- 🆔 ID選択（ふつうの画面で、🆕新規／🌱分岐／↔️並列）・紙の取り込み画面（キーだけで進める）・類似検索（右クリック）
- リンクの展開・`:` からの参照検索・URLプレビュー・Mermaid
- 検索・ファイル管理・更新確認

## 含まれないもの（削除済み）
チャットメモ、なりきりチャット、グラフ、キャンバス、曼荼羅、カード表示、赤丸、リンクを作る機能。
旧データにこれらの種類のノートがあっても落ちず、書いてある文字を読み取り専用で見せます。ボールトの `C_チャット.json` などは消さず、そのまま残ります。

## スマホ連携について
`android/`・`phone.js`・`capture.js`・`downloads/YuriiNote-memo.apk` はあとで作り直すため、そのまま置いてあります。チャットメモの画面が無いので、今は取り込んだメモを見る画面がありません。

## 開発
`npm install`（初回のみ）→ `./yuriinote.sh`。試験は `npm test`、インストーラーは `npm run dist`。
バージョンは `package.json` が唯一の元で、`npm run version:patch` / `version:minor` で上げます（x: まとまった機能の追加、y: 修正・改善）。
詳しい記法は [リンクとプレビュー](docs/links-and-previews.md) を参照してください。
