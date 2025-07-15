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

// 保護されたディレクトリへの操作をチェック
function isProtectedPath(targetPath: string): boolean {
  const normalizedPath = path.resolve(targetPath).toLowerCase();
  
  for (const protectedDir of PROTECTED_DIRECTORIES) {
    const normalizedProtected = path.resolve(expandTilde(protectedDir)).toLowerCase();
    if (normalizedPath === normalizedProtected || normalizedPath.startsWith(normalizedProtected + path.sep)) {
      return true;
    }
  }
  
  return false;
}

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
    name: 'windows-shell-mcp-server',
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
        description: 'Execute a PowerShell command in the allowed directory with Windows system protection',
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
        description: 'Get a list of common PowerShell commands that can be executed',
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
        description: 'Get information about the current PowerShell and Windows platform',
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
          throw new Error(`Command blocked - attempting to access protected Windows directories: ${command}`);
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
            'Get-ChildItem', 'Get-Location', 'Set-Location C:\\path',
            'New-Item -ItemType Directory -Name dirname', 'Remove-Item dirname', 'New-Item -ItemType File -Name filename',
            'Get-Content filename', 'Get-Content filename -Head 10', 'Get-Content filename -Tail 10',
            'Copy-Item source dest', 'Move-Item source dest', 'Remove-Item filename'
          ],
          text: [
            'Select-String "pattern" filename', 'Get-Content file | ForEach-Object { $_ -replace "old", "new" }',
            'Get-Content file | ForEach-Object { $_.Split()[0] }', 'Get-Content file | Sort-Object', 'Get-Content file | Select-Object -Unique',
            'Get-Content file | Measure-Object -Line', 'Write-Output "text"', 'Get-ChildItem -Recurse -Name "*pattern*"'
          ],
          system: [
            'whoami', 'Get-Date', 'Get-ComputerInfo',
            'Get-Process', 'Get-Process | Sort-Object CPU -Descending',
            'Get-Volume', 'Get-ChildItem -Recurse | Measure-Object -Property Length -Sum'
          ],
          network: [
            'Test-Connection hostname', 'Invoke-WebRequest url',
            'Resolve-DnsName hostname', 'nslookup hostname'
          ],
          dev: [
            'git status', 'git log --oneline', 'npm list',
            'node --version', 'python --version',
            'java -version', 'Get-Command git'
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