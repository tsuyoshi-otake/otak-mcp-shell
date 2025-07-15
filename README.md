# Shell MCP Server

シェルコマンド実行をサポートするMCP (Model Context Protocol) サーバーの実装です。SSEとHTTP Streamingに対応しています。

## セキュリティ機能

- **コマンド実行制限**: 安全なコマンドのみ実行可能
- **作業ディレクトリ制限**: 指定されたディレクトリ内でのみコマンド実行
- **デフォルト制限**: 引数なしの場合は `~/Desktop/Otak` ディレクトリのみでコマンド実行可能
- **危険コマンドのブロック**: システムに影響を与える可能性のあるコマンドを防止

## ディレクトリアクセス仕様

### デフォルト動作
- 引数が指定されない場合、`~/Desktop/Otak` ディレクトリが自動的に作成されます
- すべてのコマンド実行はこのディレクトリ内に制限されます

### カスタムディレクトリの指定
JSON形式の引数で `allowedDirectory` を指定することで、コマンド実行可能なディレクトリを変更できます：

```json
{"allowedDirectory": "/path/to/your/directory"}
```

### セキュリティ制限
- 指定されたディレクトリの外でのコマンド実行は拒否されます
- 危険なコマンド（rm -rf, format, etc.）の実行は防止されます
- システムファイルへのアクセスを防止します

## 機能

### 基本的なシェルコマンド実行
- ディレクトリ操作（ls, cd, mkdir）
- ファイル操作（cat, echo, touch）
- テキスト処理（grep, sed, awk）
- プロセス管理（ps, kill）
- システム情報取得（whoami, pwd, date）

### SSE (Server-Sent Events) エンドポイント
- コマンド実行のリアルタイム出力ストリーミング
- 長時間実行コマンドの進捗監視

## インストール

### NPMパッケージとしてインストール（推奨）

```bash
# グローバルインストール
npm install -g otak-mcp-shell

# または一回だけ実行
npx otak-mcp-shell
```

### ソースコードからビルド

```bash
git clone https://github.com/tsuyoshi-otake/otak-mcp-shell.git
cd otak-mcp-shell
npm install
npm run build
```

## 使用方法

### 基本的な使用方法

```bash
# デフォルトディレクトリ（~/Desktop/Otak）で起動
otak-mcp-shell

# カスタムディレクトリを指定
otak-mcp-shell '{"allowedDirectory": "/path/to/your/directory"}'
```

### HTTP サーバーモード

```bash
# HTTP サーバーとして起動
otak-mcp-shell-http

# カスタムポート
PORT=8768 otak-mcp-shell-http
```

### MCP over HTTP モード

```bash
# MCP over HTTP として起動
otak-mcp-shell-mcp

# カスタムポート
PORT=8767 otak-mcp-shell-mcp
```

## 環境変数

- `ALLOWED_DIRECTORY`: 許可するディレクトリのパス
- `PORT`: HTTPサーバーのポート番号（MCP: 8767, HTTP: 8768）
- `NODE_ENV`: 環境設定（development/production）

## API エンドポイント

### HTTP モード

- `GET /health` - ヘルスチェック
- `POST /execute` - コマンド実行
- `GET /stream/:commandId` - コマンド実行結果のストリーミング

### 使用例

```bash
# コマンド実行 (HTTP サーバー)
curl -X POST http://localhost:8768/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "ls -la"}'

# ストリーミング出力の監視
curl http://localhost:8768/stream/command-id-123
```

## セキュリティ

このサーバーはセキュリティを重視して設計されています：

1. **コマンド実行制限**: 安全なコマンドのみ実行可能
2. **ディレクトリ制限**: 指定されたディレクトリ外へのアクセス防止
3. **危険コマンドのブロック**: システムに影響を与えるコマンドの実行を防止
4. **入力検証**: すべての入力に対する厳密な検証

## 対応コマンド例

### ファイル・ディレクトリ操作
- `ls`, `dir`, `pwd`, `cd`
- `mkdir`, `rmdir`, `touch`
- `cat`, `head`, `tail`, `less`
- `cp`, `mv`, `rm` (安全な使用のみ)

### テキスト処理
- `grep`, `sed`, `awk`
- `sort`, `uniq`, `wc`
- `find` (制限付き)

### システム情報
- `whoami`, `date`, `uname`
- `ps`, `top` (制限付き)
- `df`, `du` (制限付き)

## 開発

```bash
# 開発サーバー起動
npm run dev

# HTTP 開発サーバー
npm run dev:http

# MCP 開発サーバー
npm run dev:mcp

# ビルド
npm run build

# テスト
npm test
```

## Windows サービスとして実行

```bash
# HTTP サーバーをサービスとしてインストール
npm run service:install:http

# MCP サーバーをサービスとしてインストール
npm run service:install:mcp

# サービスのアンインストール
npm run service:uninstall
```

## ライセンス

MIT License

## 貢献

プルリクエストや課題報告を歓迎します。貢献する前に、セキュリティガイドラインを確認してください。

## 関連プロジェクト

- [otak-mcp-filesystem](https://github.com/tsuyoshi-otake/otak-mcp-filesystem) - ファイルシステム操作用MCPサーバー