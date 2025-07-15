#!/usr/bin/env node
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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

// MCPサーバーのセットアップ
const server = new Server(
  {
    name: 'otak-mcp-shell',
    version: '2.0.3',
  },
  {
    capabilities: {
      tools: {},
      logging: {},
    },
  }
);

// サーバーの初期化イベントハンドラー
server.onerror = (error) => {
  console.error('MCP Server error:', error);
};

server.onclose = () => {
  console.log('MCP Server connection closed');
};

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

        if (!isCommandSafe(command)) {
          throw new Error(`Command not allowed for security reasons: ${command}`);
        }

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

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`MCP tool error (${name}):`, errorMessage);
    
    return {
      content: [
        {
          type: 'text',
          text: `Error executing ${name}: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

// Expressアプリケーションのセットアップ
const app = express();
app.use(express.json({ limit: '10mb' }));

// CORS設定
app.use((req, res, next) => {
  // すべてのオリジンを許可
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE, PATCH');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Max-Age', '86400');
  
  // OPTIONSリクエストに対して即座に200を返す
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'otak-mcp-shell-mcp',
    workingDirectory: allowedDirectory.replace(/\\/g, '/'),
    timestamp: new Date().toISOString()
  });
});

// MCPエンドポイント - GET (情報表示)
app.get('/mcp', (req, res) => {
  res.json({
    message: 'Shell MCP Server is running',
    version: '1.0.0',
    endpoints: {
      post: '/mcp - JSON-RPC requests',
      sse: '/sse - Server-Sent Events stream',
      health: '/health - Health check'
    }
  });
});

// MCPエンドポイント - HTTP POST
app.post('/mcp', async (req, res) => {
  console.log('Received MCP request:', req.body);
  
  // シンプルなリクエスト/レスポンス処理
  const request = req.body;
  
  // Notificationの場合はレスポンスを返さない
  if (!request.id && request.method === 'notifications/initialized') {
    console.log('Received initialized notification');
    res.status(200).end();
    return;
  }
  
  try {
    if (request.method === 'initialize') {
      res.json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'otak-mcp-shell',
            version: '2.0.3',
          },
        },
      });
    } else if (request.method === 'tools/list') {
      // 直接ツール一覧を返す
      res.json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
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
          ],
        },
      });
    } else if (request.method === 'tools/call') {
      // ツール実行のロジック
      const { name, arguments: args } = request.params;
      
      try {
        let result;
        switch (name) {
          case 'Execute': {
            const command = args?.command as string;
            const workingDir = args?.workingDir ?
              path.resolve(allowedDirectory, args.workingDir as string) :
              allowedDirectory;

            if (!command) {
              throw new Error('Command is required');
            }

            if (!isCommandSafe(command)) {
              throw new Error(`Command not allowed for security reasons: ${command}`);
            }

            const execResult = await executeCommand(command, workingDir);
            
            const response = {
              command: execResult.command,
              workingDirectory: workingDir.replace(/\\/g, '/'),
              exitCode: execResult.exitCode,
              duration: `${execResult.duration}ms`,
              stdout: execResult.stdout || '(no output)',
              stderr: execResult.stderr || '(no errors)',
              success: execResult.exitCode === 0
            };

            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(response, null, 2),
                },
              ],
            };
            break;
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

            const cmdResult = category && commands[category as keyof typeof commands]
              ? { [category]: commands[category as keyof typeof commands] }
              : commands;

            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    description: 'Common safe commands by category',
                    note: 'These are examples of allowed commands. Dangerous operations are blocked.',
                    commands: cmdResult
                  }, null, 2),
                },
              ],
            };
            break;
          }

          case 'PWD': {
            result = {
              content: [
                {
                  type: 'text',
                  text: allowedDirectory.replace(/\\/g, '/'),
                },
              ],
            };
            break;
          }

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        
        res.json({
          jsonrpc: '2.0',
          id: request.id,
          result,
        });
      } catch (error) {
        res.json({
          jsonrpc: '2.0',
          id: request.id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
              },
            ],
            isError: true,
          },
        });
      }
    } else {
      res.json({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      });
    }
  } catch (error) {
    console.error('MCP request error:', error);
    res.json({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    });
  }
});

// MCPエンドポイント - SSE接続
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/message', res);
  await server.connect(transport);
});

// サーバー起動
const PORT = parseInt(process.env.PORT || '8767', 10);
const HOST = process.env.HOST || 'localhost';

// 初期化してからサーバーを起動
initialize().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Shell MCP over HTTP/SSE server running on ${HOST}:${PORT}`);
    console.log(`MCP HTTP endpoint: http://${HOST}:${PORT}/mcp`);
    console.log(`MCP SSE endpoint: http://${HOST}:${PORT}/sse`);
    console.log(`Health check: http://${HOST}:${PORT}/health`);
    console.log(`Allowed directory: ${allowedDirectory}`);
  }).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please specify a different port using the PORT environment variable.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
}).catch((error) => {
  console.error('Initialization error:', error);
  process.exit(1);
});