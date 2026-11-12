# YuriiNote Simple

紙のPKMと同じルールで使う、最小限のデスクトップアプリです。既存の [YuriiNote](https://github.com/Yurii7812/YuriiNote) の Folgezettel ID操作を参考にした独立版で、既存アプリのデータや設定には触れません。

## 画面は2つだけ

**ノート**：書く、IDを付ける、分岐・並列ノートを作る。  
**Index**：Global Index・Topic Index・0 Indexを同じ画面で見る。

チャットメモ、グラフ、キャンバス、日記管理、複雑なトピック分類画面は含めません。

## 紙のPKMと同じルール

| 項目 | 例・ルール |
| --- | --- |
| 普通のノート | `1` → `1a`、`1b`、`1a1`… |
| Topic Index | ノート `1` に対応する索引は `1-1` |
| 細かいTopic Index | ノート `1a` に対応する索引は `1a-1` |
| 複数Topic Index | **初期設定はオフ**。Index画面の「設定」でオンにすると `1-2`、`1-3`…を追加可能 |
| Topic Indexの続き | 2ページ目は右上に `2` と書く |
| ページ指定引用 | `1-1(2)` で `1-1` の2ページ目に移動 |
| 本文中の引用 | `1a(1)` はノート `1a` の `(1)` を示す |
| 0 Index | `1-1`、`2-1`、`3-1` など、親IDのTopic Indexへの入口 |
| Global Index | ノートのタイトル・キーワードとTopic Indexの名前から検索 |

ノートのIDと索引は**必要になってから**作れます。最初はID未設定のまま文章を書いて構いません。Topic Indexの名前は「思考の出発点」を示すもので、内容を拘束する分類ではありません。

本Aの読書ノートを `1` 系列で続け、本Bは `2` 系列で始める、といった使い方ができます。途中の寄り道やまとめが古くなることは問題にしません。

## Linuxに1行でインストール（Debian / Ubuntu / XFCEなど）

ターミナルで次の1行を実行します。**sudoは不要**です。Node.js 22がない場合はユーザーのホームディレクトリに自動で準備します。

```sh
curl -fsSL https://raw.githubusercontent.com/Yurii7812/YuriiNote-simple/main/install/linux.sh | sh
```

アプリ一覧に **YuriiNote Simple** が登録され、デスクトップフォルダがあればショートカットも作成されます。元のYuriiNoteとは別の場所にインストールします。

**起動**

```sh
~/.local/bin/YuriiNote-simple
```

**更新**

```sh
~/.local/bin/YuriiNote-simple --update
```

`~/.local/bin` がPATHに入っている場合は、`YuriiNote-simple` と `YuriiNote-simple --update` でも動きます。同じインストールコマンドをもう一度実行しても更新できます。アプリを終了してから更新してください。保存データは更新対象外です。

Linux版のインストールには、`curl`、`tar`、`sha256sum` とインターネット接続が必要です。依存するGUIライブラリはLinux側に必要ですが、一般的なDebian/XFCE環境なら通常備わっています。

## 開発者向けの起動

Node.js 22以上が必要です。

```bash
npm install
npm start
```

テストは `npm test`、ソースの構文確認は `node --check renderer.js` など。インストーラー作成は `npm run dist:linux`、`npm run dist:win`、`npm run dist:mac`（対応するOSのビルド環境が必要）です。

## 操作

1. **＋ ノート**から文章を書く。
2. 必要なときに**IDを付ける**を押して `1` などを指定する。
3. **分岐**を押すと `1a`、**並列**を押すと `2` などを作る。
4. ノートが増えてから**＋ Topic Index**で `1-1` を作る。
5. Index画面でキーワードや索引を探す。0 Indexは親IDに対応する索引だけをまとめる。
6. さらに同じIDに索引が必要なら、Index画面下部の「設定」を開いて複数作成をオンにする。初期状態では2個目を作れません。

入力内容は自動保存されます。Ctrl+Sで明示的に保存、Ctrl+Nでノート作成。画面右上のID欄から `1a`、`1-1`、`1-1(2)` に直接移動できます。本文やTopic Indexに書いた参照先は、編集欄の下にクリック可能なリンクとして表示されます。

## 保存と既存YuriiNoteとの関係

データはElectronの**YuriiNote Simple専用**ユーザーデータフォルダに `data.json` で保存し、直前の内容のバックアップを `data.backup.json` に置きます。「保存先を開く」から実際の場所を開けます。定期的にフォルダごとバックアップしてください。

この版は小さく保つため、従来YuriiNoteの保存データの自動取り込み、紙のスキャン取り込み、Android連携は**未実装**です。

ソースコード内の基本的なFolgezettel IDロジックは、既存YuriiNoteの方法を基にしています。
