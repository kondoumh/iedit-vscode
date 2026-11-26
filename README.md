# iEdit Prototype for VS Code

iEdit の「ツリー + ネットワーク + テキスト」連携を VS Code 拡張として試すためのプロトタイプです。

## MVP で実装していること

- ノードの階層管理（ツリー表示）
- 左ペインアウトラインの開閉（▶ / ▼）
- VS Code サイドバーの `iEdit Outline` ツリー表示（Webview と選択同期）
- `iEdit Outline` のコンテキストメニューで Move Up / Move Down / Indent / Outdent
- ツールバーの ↑ / ↓ / → / ← で Move Up / Move Down / Indent / Outdent
- ツールバーはアイコン表示 + Tooltip（title）対応
- 同階層ノードのネットワーク表示（ノード移動、リンク追加）
- 同一ノードペア間の複数リンクを曲線で自動分離表示
- Link Mode（2クリック）で直感的なリンク作成
- Link Mode で始点ノードをネットワーク上にハイライト表示
- 芋づるモード（macOS: ⌘ + ドラッグ / Windows・Linux: Ctrl + ドラッグ）でリンク接続ノードがバネ追従
- vis-network 標準のマルチセレクト/マルチドラッグ
- ネットワーク空白部分のコンテキストメニューから Add Sibling
- Node Color ボタンでカラーピッカーを開き、Apply で選択ノードに色適用
- ネットワークで選択したエッジを対象に Link Label / Unlink を編集
- リンク編集（ラベル変更、削除）
- 選択ノードの Markdown テキスト編集（シンタックスハイライト）
- VS Code テーマ変数に寄せた Markdown ハイライト調整
- 3ビューの選択同期
- ペイン境界のドラッグ調整（左右 / 上下）
- VS Code 標準の保存/ダーティ管理/Undo・Redo（Custom Editor 経由）
- テキスト編集中は autosave 反映を遅延（入力体験を優先）
- ワークスペース直下の `.iedit.json` への保存
- 旧 iEdit JSON（`ieditDoc.nodes` / `ieditDoc.links`）の読み込み互換

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

旧 iEdit 形式（`{ "ieditDoc": { "nodes": [...], "links": [...] } }`）を開いた場合も読み込みできます。  
ただし URL 参照用の外部リンク（`path` を持つリンク）は現行フォーマットに対応項目がないため、読み込み時にスキップされます。

## VSIX 配布（Marketplace 未公開）

### ローカルで VSIX を作る

```bash
npm install
npm run build
npm run package:vsix
```

`.vsix` ファイルが生成されるので、VS Code の「Extensions: Install from VSIX...」で試せます。

### GitHub Releases で配布する

このリポジトリには、タグ push 時に VSIX を Release に添付するワークフローを用意しています。

1. バージョンを更新（例: `0.1.1-beta.1`）
2. タグ作成・push

```bash
git tag v0.1.1-beta.1
git push origin v0.1.1-beta.1
```

3. Actions の `Release VSIX` が実行され、Release ページに `iedit-vscode-<version>.vsix` が添付されます。
