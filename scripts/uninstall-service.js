#!/usr/bin/env node

const path = require('path');
const os = require('os');

// Windows プラットフォームチェック
if (os.platform() !== 'win32') {
  console.error('❌ Windows service uninstallation is only supported on Windows platform.');
  console.error('Current platform:', os.platform());
  process.exit(1);
}

// node-windowsの動的読み込み
let Service;
try {
  Service = require('node-windows').Service;
} catch (error) {
  console.error('❌ node-windows module is not available.');
  console.error('Please install it manually: npm install -g node-windows');
  console.error('Original error:', error.message);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  let serviceName = 'OtakMCPFilesystem';

  // 環境変数から設定を読み込み
  if (process.env.SERVICE_NAME) serviceName = process.env.SERVICE_NAME;

  // コマンドライン引数を解析
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    
    if (!value) continue;
    
    switch (key) {
      case '--name':
      case '-n':
        serviceName = value;
        break;
    }
  }

  console.log(`Uninstalling Otak MCP Filesystem Windows Service...`);
  console.log(`Service Name: ${serviceName}`);

  // サービス作成（アンインストール用）
  const svc = new Service({
    name: serviceName,
    script: path.join(__dirname, '..', 'dist', 'index.js') // ダミーパス
  });

  // サービスイベントハンドラー
  svc.on('uninstall', () => {
    console.log(`✅ Service "${serviceName}" uninstalled successfully!`);
  });

  svc.on('stop', () => {
    console.log(`🛑 Service "${serviceName}" stopped.`);
  });

  svc.on('doesnotexist', () => {
    console.log(`⚠️  Service "${serviceName}" does not exist.`);
  });

  svc.on('error', (err) => {
    console.error('❌ Service uninstallation failed:', err);
    process.exit(1);
  });

  // サービスアンインストール実行
  svc.uninstall();
}

if (require.main === module) {
  main();
}

module.exports = main;