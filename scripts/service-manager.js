#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

function showHelp() {
  console.log(`
Otak MCP Shell Service Manager

Usage:
  otak-mcp-shell-service <command> [options]

Commands:
  install             Install Windows service
  uninstall           Uninstall Windows service
  help                Show this help message

Options:
  --type, -t          Server type: stdio, http, mcp (default: stdio)
  --dir, -d           Allowed directory path (default: ~/Desktop/Otak)
  --name, -n          Service name (default: OtakMCPShell)
  --display           Display name (default: Otak MCP Shell Server)

Install Examples:
  otak-mcp-shell-service install
  otak-mcp-shell-service install --type mcp
  otak-mcp-shell-service install -t http
  otak-mcp-shell-service install --dir C:\\Users\\username\\Documents\\MyProject
  otak-mcp-shell-service install -d ~/Desktop/SmileCHAT
  otak-mcp-shell-service install --type mcp --dir C:\\Projects\\MyApp

Uninstall Examples:
  otak-mcp-shell-service uninstall
  otak-mcp-shell-service uninstall --name OtakMCPShellHTTP
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
      console.log('📦 Installing Otak MCP Shell Windows Service...');
      runScript('install-service.js', options);
      break;
    
    case 'uninstall':
      console.log('🗑️  Uninstalling Otak MCP Shell Windows Service...');
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