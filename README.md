# iEdit Prototype for VS Code

iEdit の「ツリー + ネットワーク + テキスト」連携を VS Code 拡張として試すためのプロトタイプです。

## MVP で実装していること

- ノードの階層管理（ツリー表示）
- VS Code サイドバーの `iEdit Outline` ツリー表示（Webview と選択同期）
- `iEdit Outline` のコンテキストメニューで Move Up / Move Down / Indent / Outdent
- ツールバーの ↑ / ↓ / → / ← で Move Up / Move Down / Indent / Outdent
- 同階層ノードのネットワーク表示（ノード移動、リンク追加）
- Link Mode（2クリック）で直感的なリンク作成
- Link Mode で始点ノードをネットワーク上にハイライト表示
- 芋づるモード（macOS: ⌘ + ドラッグ / Windows・Linux: Ctrl + ドラッグ）でリンク接続ノードがバネ追従
- ネットワーク空白部分のコンテキストメニューから Add Sibling
- リンク編集（ラベル変更、削除）
- 選択ノードの Markdown テキスト編集（シンタックスハイライト）
- 3ビューの選択同期
- ペイン境界のドラッグ調整（左右 / 上下）
- VS Code 標準の保存/ダーティ管理/Undo・Redo（Custom Editor 経由）
- ワークスペース直下の `.iedit.json` への保存

## 使い方

1. 依存をインストール
   ```bash
   npm install
   ```
2. ビルド
   ```bash
   npm run build
   ```
3. VS Code でこのフォルダを開き、`F5` で Extension Development Host を起動
4. コマンドパレットから `iEdit: Open Prototype` を実行（`.iedit.json` を Custom Editor で開く）

## ドキュメント形式

`.iedit.json` は次の形です。

```json
{
  "version": 1,
  "selectedNodeId": "root",
  "nodes": [
    { "id": "root", "parentId": null, "label": "Root", "text": "" }
  ],
  "links": []
}
```
