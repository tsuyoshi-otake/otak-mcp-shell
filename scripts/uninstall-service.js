#!/usr/bin/env node

const path = require('path');
const os = require('os');

// Windows プラットフォームチェック
if (os.platform() !== 'win32') {
  console.error('❌ Windows service uninstallation is only supported on Windows platform.');
  console.error('Current platform:', os.platform());
  process.exit(1);
}

const Service = require('node-windows').Service;

function main() {
  const args = process.argv.slice(2);
  let serviceName = 'OtakMCPFilesystem';

  if (args.length > 0) {
    try {
      const config = JSON.parse(args[0]);
      serviceName = config.serviceName || serviceName;
    } catch (error) {
      console.error('Invalid configuration JSON:', error.message);
      process.exit(1);
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