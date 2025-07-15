# Filesystem MCP Server

ファイルシステム操作をサポートするMCP (Model Context Protocol) サーバーの実装です。SSEとHTTP Streamingに対応しています。

## セキュリティ機能

- **ディレクトリアクセス制限**: 指定されたディレクトリ内のみでファイル操作が可能
- **デフォルト制限**: 引数なしの場合は `~/Desktop/SmileCHAT` ディレクトリのみアクセス可能
- **パストラバーサル防止**: `../` などを使った親ディレクトリへのアクセスを防止

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

デフォルト設定（Desktop/SmileCHATのみアクセス可能）:
```bash
npm run dev
```

カスタムディレクトリを指定:
```bash
npm run dev -- '{"allowedDirectory": "/path/to/allowed/directory"}'
```

### Claude Desktop設定例

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "@tsuyoshi-otake/mcp-filesystem",
        "{\"allowedDirectory\": \"C:/Users/username/Documents/MyProject\"}"
      ]
    }
  }
}
```

引数なしの場合は自動的に `~/Desktop/SmileCHAT` ディレクトリが作成され、そこのみアクセス可能になります。

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