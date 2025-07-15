# Windows PowerShell MCP Server

Windows PowerShell専用のMCP (Model Context Protocol) サーバーの実装です。SSEとHTTP Streamingに対応しています。

**Windows専用設計** - PowerShellコマンドの実行に特化し、Windows系重要ディレクトリの保護機能を内蔵しています。

## 🆕 v2.0.4 の新機能

- **MCP over HTTP 完全対応**: `http://localhost:8767/mcp` エンドポイントでブラウザベースクライアントから直接接続可能
- **CORS設定改善**: すべてのオリジンからのアクセスに対応、ブラウザセキュリティ制限を解決
- **Zodスキーマ検証エラー修正**: MCP応答形式の完全準拠により、クライアント接続の安定性を向上
- **SSE接続最適化**: Server-Sent Eventsの安定性と互換性を改善

## セキュリティ機能

- **Windows系ディレクトリ保護**: C:\、Windows、Program Files等の重要ディレクトリを削除・移動から保護
- **作業ディレクトリ制限**: 指定されたディレクトリ内でのみコマンド実行
- **デフォルト制限**: 引数なしの場合は `~/Desktop/Otak` ディレクトリのみでコマンド実行可能
- **システム保護**: 重要なシステムファイルとディレクトリへの破壊的操作を防止

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
- 重要なWindowsディレクトリ（C:\、Windows、Program Files等）への削除・移動操作は防止されます
- システムファイルとディレクトリを保護します

## 機能

### 基本的なシェルコマンド実行
**PowerShell/Windows**
- ディレクトリ操作（Get-ChildItem, Set-Location, New-Item）
- ファイル操作（Get-Content, Write-Output, New-Item）
- テキスト処理（Select-String, ForEach-Object）
- プロセス管理（Get-Process, Stop-Process）
- システム情報取得（whoami, Get-Location, Get-Date）

**Unix/Linux**
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

```powershell
# デフォルトディレクトリ（~/Desktop/Otak）で起動
otak-mcp-shell

# カスタムディレクトリを指定
otak-mcp-shell '{"allowedDirectory": "C:\\path\\to\\your\\directory"}'
```

### HTTP サーバーモード

```powershell
# HTTP サーバーとして起動
otak-mcp-shell-http

# カスタムポート
$env:PORT=8768; otak-mcp-shell-http
```

### MCP over HTTP モード

```powershell
# MCP over HTTP として起動
otak-mcp-shell-mcp

# カスタムポート
$env:PORT=8767; otak-mcp-shell-mcp
```

### ブラウザベースクライアントからの接続

v2.0.4以降、ブラウザベースのMCPクライアントから直接接続できます：

- **エンドポイント**: `http://localhost:8767/mcp`
- **プロトコル**: MCP over HTTP (JSON-RPC 2.0)
- **CORS**: 完全対応（すべてのオリジンからアクセス可能）

#### 利用可能なツール
- `Execute`: セキュリティ制限付きPowerShellコマンド実行
- `ListCommands`: カテゴリ別の安全なコマンド一覧取得
- `PWD`: 現在の作業ディレクトリ取得

#### 接続例
```javascript
// ブラウザからの接続例
const response = await fetch('http://localhost:8767/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'PWD', arguments: {} },
    id: 1
  })
});
```

## 環境変数

- `ALLOWED_DIRECTORY`: 許可するディレクトリのパス
- `PORT`: HTTPサーバーのポート番号（MCP: 8767, HTTP: 8768）
- `NODE_ENV`: 環境設定（development/production）

## API エンドポイント

### HTTP モード (ポート 8768)

- `GET /health` - ヘルスチェック
- `POST /execute` - コマンド実行
- `GET /stream/:commandId` - コマンド実行結果のストリーミング

### MCP over HTTP モード (ポート 8767)

- `GET /health` - ヘルスチェック
- `POST /mcp` - MCP JSON-RPC 2.0 エンドポイント
- `GET /sse` - Server-Sent Events (SSE) ストリーミング
- `GET /mcp` - MCP エンドポイント情報

#### MCP プロトコル対応メソッド
- `initialize` - MCP接続初期化
- `tools/list` - 利用可能なツール一覧取得
- `tools/call` - ツール実行
- `notifications/initialized` - 初期化完了通知

### 使用例

#### HTTP サーバー (ポート 8768)

```powershell
# コマンド実行 (HTTP サーバー) - PowerShell
Invoke-RestMethod -Uri "http://localhost:8768/execute" `
  -Method POST `
  -ContentType "application/json" `
  -Body '{"command": "Get-ChildItem -Force"}'

# または curl を使用
curl -X POST http://localhost:8768/execute `
  -H "Content-Type: application/json" `
  -d '{"command": "Get-ChildItem -Force"}'
```

#### MCP over HTTP (ポート 8767)

```powershell
# MCP 初期化
curl -X POST http://localhost:8767/mcp `
  -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}'

# ツール一覧取得
curl -X POST http://localhost:8767/mcp `
  -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","method":"tools/list","params":{},"id":2}'

# コマンド実行
curl -X POST http://localhost:8767/mcp `
  -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"Execute","arguments":{"command":"Get-Location"}},"id":3}'

# PWD取得
curl -X POST http://localhost:8767/mcp `
  -H "Content-Type: application/json" `
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"PWD","arguments":{}},"id":4}'
```

## セキュリティ

このサーバーはWindows環境でのセキュリティを重視して設計されています：

1. **Windows系ディレクトリ保護**: 重要なシステムディレクトリを削除・移動から保護
2. **ディレクトリ制限**: 指定されたディレクトリ外へのアクセス防止
3. **システム保護**: Windows重要ファイルとディレクトリへの破壊的操作を防止
4. **入力検証**: すべてのPowerShellコマンドに対する厳密な検証

## 対応コマンド例

### ファイル・ディレクトリ操作 (PowerShell)
- `Get-ChildItem`, `Set-Location`, `Get-Location`
- `New-Item`, `Remove-Item`, `New-Item -ItemType File`
- `Get-Content`, `Select-Object -First`, `Select-Object -Last`
- `Copy-Item`, `Move-Item`, `Remove-Item` (安全な使用のみ)

### テキスト処理 (PowerShell)
- `Select-String`, `ForEach-Object`, `Where-Object`
- `Sort-Object`, `Select-Object -Unique`, `Measure-Object`
- `Get-ChildItem -Recurse` (制限付き)

### システム情報 (PowerShell)
- `whoami`, `Get-Date`, `Get-ComputerInfo`
- `Get-Process`, `Stop-Process` (制限付き)
- `Get-Volume`, `Get-ChildItem -Recurse | Measure-Object` (制限付き)

### Unix/Linux コマンド
- `ls`, `cd`, `pwd`, `mkdir`, `cat`, `grep` など (Unix系環境で利用可能)

## 開発

```powershell
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

## Windowsサービス化

Windows環境でMCPサーバーを常駐サービスとして動作させることができます。

### 前提条件
- Windows OS
- Node.js がインストールされている
- 管理者権限でコマンドプロンプトを実行

### サービスのインストール

```powershell
# パッケージをグローバルインストール
npm install -g otak-mcp-shell

# デフォルト設定でサービスインストール（stdio MCP server）
otak-mcp-shell-service install

# MCP HTTP/SSE サーバーとしてインストール
otak-mcp-shell-service install --type mcp

# HTTP サーバーとしてインストール
otak-mcp-shell-service install --type http

# カスタムディレクトリを指定してインストール
otak-mcp-shell-service install --dir C:\Users\username\Documents\MyProject

# 複数オプションの組み合わせ
otak-mcp-shell-service install --type mcp --dir C:\Users\username\Desktop\SmileCHAT
```

### サービスの管理

```powershell
# サービス開始
net start OtakMCPShell

# サービス停止
net stop OtakMCPShell

# サービスの状態確認
sc query OtakMCPShell

# サービスのアンインストール
otak-mcp-shell-service uninstall
```

### サービス設定オプション
```json
{
  "allowedDirectory": "C:\\Users\\username\\Documents\\MyProject",
  "serviceName": "OtakMCPShell",
  "displayName": "Otak MCP Shell Server",
  "description": "Windows PowerShell MCP server with system directory protection",
  "serverType": "stdio"
}
```

serverType オプション:
- `stdio`: 標準入出力でMCPプロトコル（デフォルト）
- `http`: HTTPサーバー（ポート8768）
- `mcp`: MCP HTTP/SSEサーバー（ポート8767）

### サービスログ
Windowsサービスのログは Windows Event Viewer で確認できます：

1. Windows Event Viewer を開く
2. Windows Logs > Application を選択
3. Source が `OtakMCPShell` のエントリを確認

### 開発者向けサービス管理

```powershell
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