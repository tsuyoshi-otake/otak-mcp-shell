# Filesystem MCP Server

ファイルシステム操作をサポートするMCP (Model Context Protocol) サーバーの実装です。SSEとHTTP Streamingに対応しています。

## 機能

### 基本的なファイルシステム操作
- ディレクトリの一覧表示
- ファイルの読み取り
- ファイルの書き込み
- ディレクトリの作成
- ファイル/ディレクトリの削除

### SSE (Server-Sent Events) エンドポイント
- ファイル/ディレクトリの変更監視
- ログファイルのリアルタイムtail機能

## インストール

```bash
npm install
```

## 使用方法

### MCP標準サーバー (stdio)
```bash
npm run dev
```

### HTTPサーバー（カスタムAPI）
```bash
npm run dev:http  # ポート 3456
```

### MCP HTTP/SSEサーバー（Claude連携用）
```bash
npm run dev:mcp  # ポート 3000
```


### ポート設定

環境変数またはenvファイルでポートを変更できます：

```bash
# 環境変数で指定
PORT=8080 npm run dev:http

# または.envファイル
cp .env.example .env
# .envを編集してPORTを設定
```

## APIエンドポイント

### ツール一覧の取得
```
GET /tools
```

### ツールの実行
```
POST /tools/:toolName
Content-Type: application/json

{
  "path": "/path/to/directory",
  "content": "file content (write_file only)"
}
```

### ファイル監視 (SSE)
```
GET /stream/watch?path=/path/to/watch
```

ファイルやディレクトリの変更をリアルタイムで監視します。

### ログファイルのtail (SSE)
```
GET /stream/tail?path=/path/to/file.log
```

ファイルの末尾10行を表示し、新しい内容が追加されたらリアルタイムで通知します。

## 利用可能なツール

### list_directory
指定されたディレクトリ内のファイルとサブディレクトリを一覧表示します。

### read_file
指定されたファイルの内容を読み取ります。

### write_file
指定されたファイルに内容を書き込みます。

### create_directory
新しいディレクトリを作成します（再帰的に作成可能）。

### delete_file
ファイルまたはディレクトリを削除します。

## ビルド

```bash
npm run build
```

## プロダクション実行

```bash
npm start        # stdio版
npm start:http   # HTTP版
```