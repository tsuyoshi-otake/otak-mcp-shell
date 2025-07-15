#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function showHelp() {
  console.log(`
Otak MCP Filesystem Service Manager

Usage:
  otak-mcp-filesystem-service <command> [options]

Commands:
  install [config]    Install Windows service
  uninstall [config]  Uninstall Windows service
  help               Show this help message

Install Examples:
  otak-mcp-filesystem-service install
  otak-mcp-filesystem-service install '{"allowedDirectory": "C:\\\\Users\\\\username\\\\Documents\\\\MyProject"}'
  otak-mcp-filesystem-service install '{"serverType": "http"}'
  otak-mcp-filesystem-service install '{"serverType": "mcp"}'

Uninstall Examples:
  otak-mcp-filesystem-service uninstall
  otak-mcp-filesystem-service uninstall '{"serviceName": "OtakMCPFilesystem"}'

Configuration Options:
  allowedDirectory  - Directory to allow filesystem operations (default: ~/Desktop/Otak)
  serviceName      - Windows service name (default: OtakMCPFilesystem)
  displayName      - Service display name (default: Otak MCP Filesystem Server)
  description      - Service description
  serverType       - Server type: stdio, http, mcp (default: stdio)
`);
}

function runScript(scriptName, args) {
  const scriptPath = path.join(__dirname, scriptName);
  
  if (!fs.existsSync(scriptPath)) {
    console.error(`❌ Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    shell: true
  });

  child.on('close', (code) => {
    process.exit(code);
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to run script: ${error.message}`);
    process.exit(1);
  });
}

function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    process.exit(1);
  }

  const command = args[0].toLowerCase();
  const options = args.slice(1);

  switch (command) {
    case 'install':
      console.log('📦 Installing Otak MCP Filesystem Windows Service...');
      runScript('install-service.js', options);
      break;
    
    case 'uninstall':
      console.log('🗑️  Uninstalling Otak MCP Filesystem Windows Service...');
      runScript('uninstall-service.js', options);
      break;
    
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    
    default:
      console.error(`❌ Unknown command: ${command}`);
      showHelp();
      process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { showHelp, runScript, main };