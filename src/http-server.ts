#!/usr/bin/env node
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

// 設定
interface Config {
  allowedDirectory?: string;
}

// デフォルトディレクトリ
const DEFAULT_DIR = path.join(os.homedir(), 'Desktop', 'Otak');

// 許可されたディレクトリ（環境変数またはデフォルト）
let allowedDirectory: string = process.env.ALLOWED_DIRECTORY ? 
  path.resolve(expandTilde(process.env.ALLOWED_DIRECTORY)) : 
  DEFAULT_DIR;

// チルダ展開を処理する関数
function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return filepath.replace('~', os.homedir());
  }
  return filepath;
}

// Windows専用 - 保護されたディレクトリ
const PROTECTED_DIRECTORIES = [
  'C:\\',
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\Users',
  '~',
  '~/Desktop',
  process.env.USERPROFILE || '',
  process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : '',
  process.env.SYSTEMROOT || 'C:\\Windows',
  process.env.PROGRAMFILES || 'C:\\Program Files',
  process.env.PROGRAMFILES_X86 || 'C:\\Program Files (x86)'
].filter(dir => dir); // 空文字列を除外

// コマンドが保護されたディレクトリに影響しないかチェック
function isCommandSafe(command: string): boolean {
  const lowerCommand = command.toLowerCase().trim();
  
  // 削除、移動、リネーム系のコマンドをチェック
  const destructivePatterns = [
    /(?:remove-item|rm|del|erase)\s+.*[c-z]:\\/i,  // ドライブルートの削除
    /(?:remove-item|rm|del|erase)\s+.*windows/i,   // Windowsディレクトリ
    /(?:remove-item|rm|del|erase)\s+.*program\s*files/i, // Program Files
    /(?:move-item|mv|move|ren|rename)\s+.*[c-z]:\\/i,    // ドライブルートの移動
    /(?:move-item|mv|move|ren|rename)\s+.*windows/i,     // Windowsディレクトリ
    /(?:move-item|mv|move|ren|rename)\s+.*program\s*files/i, // Program Files
  ];
  
  for (const pattern of destructivePatterns) {
    if (pattern.test(command)) {
      return false;
    }
  }
  
  // 基本的には全てのコマンドを許可（保護されたパスへの操作以外）
  return true;
}

// コマンド実行結果の型
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  duration: number;
}

// コマンドを実行する関数（Windows専用）
function executeCommand(command: string, workingDir: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    // Windows専用 - PowerShellを使用
    const shell = 'powershell.exe';
    const shellArgs = ['-Command', command];
    
    const child = spawn(shell, shellArgs, {
      cwd: workingDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env
    });
    
    let stdout = '';
    let stderr = '';
    
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
        command,
        duration
      });
    });
    
    child.on('error', (error) => {
      const duration = Date.now() - startTime;
      resolve({
        stdout: '',
        stderr: error.message,
        exitCode: 1,
        command,
        duration
      });
    });
    
    setTimeout(() => {
      child.kill('SIGTERM');
      const duration = Date.now() - startTime;
      resolve({
        stdout: stdout.trim(),
        stderr: 'Command timed out after 30 seconds',
        exitCode: 124,
        command,
        duration
      });
    }, 30000);
  });
}

// 初期化処理
async function initialize() {
  try {
    await fs.mkdir(allowedDirectory, { recursive: true });
    console.log(`Working directory: ${allowedDirectory}`);
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS設定
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'otak-mcp-shell-http',
    workingDirectory: allowedDirectory.replace(/\\/g, '/'),
    timestamp: new Date().toISOString()
  });
});

// コマンド実行エンドポイント
app.post('/execute', async (req, res) => {
  try {
    const { command, workingDir } = req.body;
    
    if (!command) {
      return res.status(400).json({ error: 'Command is required' });
    }

    if (!isCommandSafe(command)) {
      return res.status(403).json({ 
        error: 'Command not allowed for security reasons',
        command 
      });
    }

    const executeDir = workingDir ? 
      path.resolve(allowedDirectory, workingDir) : 
      allowedDirectory;

    const result = await executeCommand(command, executeDir);
    
    res.json({
      command: result.command,
      workingDirectory: executeDir.replace(/\\/g, '/'),
      exitCode: result.exitCode,
      duration: `${result.duration}ms`,
      stdout: result.stdout || '(no output)',
      stderr: result.stderr || '(no errors)',
      success: result.exitCode === 0,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
});

// 作業ディレクトリ情報
app.get('/pwd', (req, res) => {
  res.json({
    workingDirectory: allowedDirectory.replace(/\\/g, '/'),
    platform: process.platform,
    architecture: process.arch
  });
});

// 許可されたコマンドリスト
app.get('/commands', (req, res) => {
  const commands = {
    file: [
      'ls -la', 'dir', 'pwd', 'cd dirname',
      'mkdir dirname', 'rmdir dirname', 'touch filename',
      'cat filename', 'head filename', 'tail filename',
      'cp source dest', 'mv source dest', 'rm filename'
    ],
    text: [
      'grep pattern file', 'sed s/old/new/ file',
      'awk {print $1} file', 'sort file', 'uniq file',
      'wc file', 'echo text', 'find . -name pattern'
    ],
    system: [
      'whoami', 'date', 'uname -a', 'ps aux',
      'top', 'df -h', 'du -sh', 'free -h',
      'uptime', 'which command'
    ],
    network: [
      'ping hostname', 'curl url', 'wget url',
      'nslookup hostname', 'dig hostname'
    ],
    dev: [
      'git status', 'git log --oneline', 'npm list',
      'node --version', 'python --version',
      'java -version', 'gcc --version'
    ]
  };

  res.json({
    description: 'Common safe commands by category',
    note: 'These are examples of allowed commands. Dangerous operations are blocked.',
    commands
  });
});

// サーバー起動
const PORT = process.env.PORT || 8768;

async function main() {
  await initialize();
  
  app.listen(PORT, () => {
    console.log(`Shell MCP HTTP server running on port ${PORT}`);
    console.log(`Working directory: ${allowedDirectory}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Command execution: POST http://localhost:${PORT}/execute`);
  });
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});