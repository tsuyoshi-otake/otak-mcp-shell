#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn, exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// 設定
interface Config {
  allowedDirectory?: string;
}

// デフォルトディレクトリ
const DEFAULT_DIR = path.join(os.homedir(), 'Desktop', 'Otak');

// 許可されたディレクトリ
let allowedDirectory: string = DEFAULT_DIR;

// 危険なコマンドのリスト
const DANGEROUS_COMMANDS = [
  'rm -rf /',
  'format',
  'fdisk',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'init 0',
  'init 6',
  'sudo',
  'su',
  'chmod 777',
  'chown',
  'passwd',
  'userdel',
  'useradd',
  'usermod',
  'groupadd',
  'groupdel',
  'crontab -r',
  'history -c',
  '> /etc/',
  '> /var/',
  '> /usr/',
  '> /bin/',
  '> /sbin/',
  'systemctl',
  'service',
  'net ',
  'netsh',
  'reg delete',
  'reg add',
  'regsvr32',
  'taskkill /f',
  'wmic',
  'powershell',
  'cmd.exe',
  'diskpart'
];

// 許可されたコマンドのパターン
const ALLOWED_COMMAND_PATTERNS = [
  // ファイル・ディレクトリ操作
  /^ls\b/,
  /^dir\b/,
  /^pwd$/,
  /^cd\b/,
  /^mkdir\b/,
  /^rmdir\b/,
  /^touch\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^less\b/,
  /^more\b/,
  /^cp\b/,
  /^mv\b/,
  /^rm\b(?!.*-rf.*\/)/,  // rm コマンドだが -rf / は除外
  
  // テキスト処理
  /^grep\b/,
  /^sed\b/,
  /^awk\b/,
  /^sort\b/,
  /^uniq\b/,
  /^wc\b/,
  /^find\b/,
  /^echo\b/,
  
  // システム情報
  /^whoami$/,
  /^date$/,
  /^uname\b/,
  /^ps\b/,
  /^top$/,
  /^df\b/,
  /^du\b/,
  /^free\b/,
  /^uptime$/,
  /^which\b/,
  /^whereis\b/,
  /^type\b/,
  
  // ネットワーク（安全なもの）
  /^ping\b/,
  /^curl\b/,
  /^wget\b/,
  /^nslookup\b/,
  /^dig\b/,
  
  // 開発関連
  /^git\b/,
  /^npm\b/,
  /^node\b/,
  /^python\b/,
  /^pip\b/,
  /^java\b/,
  /^javac\b/,
  /^gcc\b/,
  /^make\b/,
  /^cmake\b/,
  
  // エディタ
  /^nano\b/,
  /^vim\b/,
  /^vi\b/,
  /^emacs\b/,
  
  // アーカイブ
  /^tar\b/,
  /^zip\b/,
  /^unzip\b/,
  /^gzip\b/,
  /^gunzip\b/
];

// チルダ展開を処理する関数
function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/') || filepath === '~') {
    return filepath.replace('~', os.homedir());
  }
  return filepath;
}

// パスが許可されたディレクトリ内にあるかチェック
function isPathAllowed(targetPath: string): boolean {
  const resolvedPath = path.resolve(targetPath);
  const resolvedAllowed = path.resolve(allowedDirectory);
  return resolvedPath.startsWith(resolvedAllowed);
}

// コマンドが安全かチェック
function isCommandSafe(command: string): boolean {
  const lowerCommand = command.toLowerCase().trim();
  
  // 危険なコマンドをチェック
  for (const dangerous of DANGEROUS_COMMANDS) {
    if (lowerCommand.includes(dangerous.toLowerCase())) {
      return false;
    }
  }
  
  // 許可されたコマンドパターンをチェック
  for (const pattern of ALLOWED_COMMAND_PATTERNS) {
    if (pattern.test(lowerCommand)) {
      return true;
    }
  }
  
  return false;
}

// コマンド実行結果の型
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  duration: number;
}

// コマンドを実行する関数
function executeCommand(command: string, workingDir: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const isWindows = process.platform === 'win32';
    
    // WindowsとUnix系でシェルを分ける
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellArgs = isWindows ? ['/c', command] : ['-c', command];
    
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
    
    // 30秒でタイムアウト
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
  // コマンドライン引数から設定を取得
  const args = process.argv.slice(2);
  if (args.length > 0) {
    try {
      const config: Config = JSON.parse(args[0]);
      if (config.allowedDirectory) {
        allowedDirectory = path.resolve(expandTilde(config.allowedDirectory));
      }
    } catch (error) {
      console.error('Invalid configuration:', error);
    }
  }
  
  // デフォルトディレクトリが存在しない場合は作成
  try {
    await fs.mkdir(allowedDirectory, { recursive: true });
    console.error(`Working directory: ${allowedDirectory}`);
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

const server = new Server(
  {
    name: 'shell-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'Execute',
        description: 'Execute a shell command in the allowed directory with security restrictions',
        inputSchema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to execute',
            },
            workingDir: {
              type: 'string',
              description: 'The working directory for command execution (optional, defaults to allowed directory)',
            },
          },
          required: ['command'],
        },
      },
      {
        name: 'ListCommands',
        description: 'Get a list of common safe commands that can be executed',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              description: 'Filter commands by category (file, text, system, network, dev)',
            },
          },
          required: [],
        },
      },
      {
        name: 'PWD',
        description: 'Get the current working directory path',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'CD',
        description: 'Change the current working directory (updates the allowed directory)',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The directory path to change to',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'WhichShell',
        description: 'Get information about the current shell and platform',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'Execute': {
        const command = args?.command as string;
        const workingDir = args?.workingDir ? 
          path.resolve(allowedDirectory, args.workingDir as string) : 
          allowedDirectory;

        if (!command) {
          throw new Error('Command is required');
        }

        // セキュリティチェック
        if (!isCommandSafe(command)) {
          throw new Error(`Command not allowed for security reasons: ${command}`);
        }

        // 作業ディレクトリのチェック
        if (!isPathAllowed(workingDir)) {
          throw new Error(`Working directory outside allowed area: ${workingDir}`);
        }

        // コマンド実行
        const result = await executeCommand(command, workingDir);
        
        const response = {
          command: result.command,
          workingDirectory: workingDir.replace(/\\/g, '/'),
          exitCode: result.exitCode,
          duration: `${result.duration}ms`,
          stdout: result.stdout || '(no output)',
          stderr: result.stderr || '(no errors)',
          success: result.exitCode === 0
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      }

      case 'ListCommands': {
        const category = args?.category as string;
        
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

        const result = category && commands[category as keyof typeof commands] 
          ? { [category]: commands[category as keyof typeof commands] }
          : commands;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                description: 'Common safe commands by category',
                note: 'These are examples of allowed commands. Dangerous operations are blocked.',
                commands: result
              }, null, 2),
            },
          ],
        };
      }

      case 'PWD': {
        return {
          content: [
            {
              type: 'text',
              text: allowedDirectory.replace(/\\/g, '/'),
            },
          ],
        };
      }

      case 'CD': {
        const targetPath = args?.path as string;
        if (!targetPath) {
          throw new Error('Path is required');
        }

        const newPath = path.resolve(allowedDirectory, targetPath);
        
        // パスが許可されたディレクトリ内にあるかチェック
        if (!isPathAllowed(newPath)) {
          throw new Error(`Path outside allowed directory: ${newPath}`);
        }

        // ディレクトリが存在するかチェック
        try {
          const stats = await fs.stat(newPath);
          if (!stats.isDirectory()) {
            throw new Error(`Not a directory: ${newPath}`);
          }
        } catch (error) {
          throw new Error(`Directory does not exist: ${newPath}`);
        }

        // 許可されたディレクトリを更新
        allowedDirectory = newPath;

        return {
          content: [
            {
              type: 'text',
              text: `Changed working directory to: ${allowedDirectory.replace(/\\/g, '/')}`,
            },
          ],
        };
      }

      case 'WhichShell': {
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'cmd.exe' : '/bin/bash';
        
        const info = {
          platform: process.platform,
          architecture: process.arch,
          nodeVersion: process.version,
          shell: shell,
          isWindows: isWindows,
          workingDirectory: allowedDirectory.replace(/\\/g, '/'),
          environment: {
            HOME: process.env.HOME || process.env.USERPROFILE,
            PATH: process.env.PATH?.split(path.delimiter).slice(0, 5) // First 5 PATH entries
          }
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(info, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  await initialize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Shell MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});