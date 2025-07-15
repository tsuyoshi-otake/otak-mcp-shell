#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const os = require('os');

// Windows プラットフォームチェック
if (os.platform() !== 'win32') {
  console.error('❌ Windows service installation is only supported on Windows platform.');
  console.error('Current platform:', os.platform());
  process.exit(1);
}

const Service = require('node-windows').Service;

// 設定読み込み
function loadConfig() {
  const args = process.argv.slice(2);
  let config = {
    allowedDirectory: path.join(os.homedir(), 'Desktop', 'Otak'),
    serviceName: 'OtakMCPFilesystem',
    displayName: 'Otak MCP Filesystem Server',
    description: 'MCP server for secure filesystem operations',
    serverType: 'stdio' // stdio, http, mcp
  };

  if (args.length > 0) {
    try {
      const userConfig = JSON.parse(args[0]);
      config = { ...config, ...userConfig };
    } catch (error) {
      console.error('Invalid configuration JSON:', error.message);
      process.exit(1);
    }
  }

  return config;
}

// サービスのスクリプトファイルを選択
function getServiceScript(serverType) {
  const scripts = {
    stdio: path.join(__dirname, '..', 'dist', 'index.js'),
    http: path.join(__dirname, '..', 'dist', 'http-server.js'),
    mcp: path.join(__dirname, '..', 'dist', 'mcp-http-server.js')
  };

  if (!scripts[serverType]) {
    console.error(`Unknown server type: ${serverType}`);
    console.error('Available types: stdio, http, mcp');
    process.exit(1);
  }

  return scripts[serverType];
}

function main() {
  const config = loadConfig();
  
  console.log('Installing Otak MCP Filesystem Windows Service...');
  console.log('Configuration:', JSON.stringify(config, null, 2));

  const serviceScript = getServiceScript(config.serverType);
  
  // スクリプトファイルの存在確認
  if (!fs.existsSync(serviceScript)) {
    console.error(`Service script not found: ${serviceScript}`);
    console.error('Please run "npm run build" first.');
    process.exit(1);
  }

  // サービス作成
  const svc = new Service({
    name: config.serviceName,
    description: config.description,
    script: serviceScript,
    env: config.serverType !== 'stdio' ? [
      {
        name: 'NODE_ENV',
        value: 'production'
      }
    ] : undefined,
    scriptOptions: config.serverType === 'stdio' ? 
      [JSON.stringify({ allowedDirectory: config.allowedDirectory })] : 
      undefined,
    nodeOptions: [
      '--max-old-space-size=4096'
    ]
  });

  // サービスイベントハンドラー
  svc.on('install', () => {
    console.log(`✅ Service "${config.displayName}" installed successfully!`);
    console.log(`   Service Name: ${config.serviceName}`);
    console.log(`   Script: ${serviceScript}`);
    console.log(`   Allowed Directory: ${config.allowedDirectory}`);
    console.log('');
    console.log('Service management commands:');
    console.log(`   Start:   net start ${config.serviceName}`);
    console.log(`   Stop:    net stop ${config.serviceName}`);
    console.log(`   Remove:  node scripts/uninstall-service.js`);
    
    // サービスを開始
    svc.start();
  });

  svc.on('start', () => {
    console.log(`🚀 Service "${config.displayName}" started successfully!`);
  });

  svc.on('alreadyinstalled', () => {
    console.log(`⚠️  Service "${config.displayName}" is already installed.`);
    console.log('To reinstall, first run: node scripts/uninstall-service.js');
  });

  svc.on('error', (err) => {
    console.error('❌ Service installation failed:', err);
    process.exit(1);
  });

  // サービスインストール実行
  svc.install();
}

if (require.main === module) {
  main();
}

module.exports = { loadConfig, getServiceScript };