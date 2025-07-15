#!/usr/bin/env node
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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

// パスが許可されたディレクトリ内にあるかチェック
function isPathAllowed(targetPath: string): boolean {
  const resolvedPath = path.resolve(targetPath);
  const resolvedAllowed = path.resolve(allowedDirectory);
  return resolvedPath.startsWith(resolvedAllowed);
}

// 安全なパスに変換
function getSafePath(requestedPath: string): string {
  // 絶対パスの場合
  if (path.isAbsolute(requestedPath)) {
    if (!isPathAllowed(requestedPath)) {
      throw new Error(`Access denied: Path outside allowed directory (${allowedDirectory})`);
    }
    return requestedPath;
  }
  
  // 相対パスの場合は許可されたディレクトリからの相対パスとして解釈
  const fullPath = path.join(allowedDirectory, requestedPath);
  if (!isPathAllowed(fullPath)) {
    throw new Error(`Access denied: Path outside allowed directory (${allowedDirectory})`);
  }
  return fullPath;
}

// 日付を簡略化（区切り文字なし）
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}${month}${day} ${hours}${minutes}`;
}

// 初期化処理
async function initialize() {
  // デフォルトディレクトリが存在しない場合は作成
  try {
    await fs.mkdir(allowedDirectory, { recursive: true });
    console.log(`Allowed directory: ${allowedDirectory}`);
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

const app = express();

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

app.use(express.json());

// MCPサーバーの作成
const mcpServer = new Server(
  {
    name: 'filesystem-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ツール一覧の定義
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_directory',
        description: 'List files and directories in a given path (defaults to allowed directory)',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The directory path to list (optional, defaults to allowed directory)',
            },
          },
          required: [],
        },
      },
      {
        name: 'read_file',
        description: 'Read the contents of a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to read',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'write_file',
        description: 'Write content to a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to write to',
            },
            content: {
              type: 'string',
              description: 'The content to write',
            },
          },
          required: ['path', 'content'],
        },
      },
      {
        name: 'create_directory',
        description: 'Create a new directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The directory path to create',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file or directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file or directory path to delete',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'rename_file',
        description: 'Rename or move a file or directory',
        inputSchema: {
          type: 'object',
          properties: {
            oldPath: {
              type: 'string',
              description: 'The current file or directory path',
            },
            newPath: {
              type: 'string',
              description: 'The new file or directory path',
            },
          },
          required: ['oldPath', 'newPath'],
        },
      },
      {
        name: 'search_files',
        description: 'Search for files and directories by name pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'The search pattern (supports wildcards: * and ?)',
            },
            path: {
              type: 'string',
              description: 'The directory path to search in (optional, defaults to allowed directory)',
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to search recursively in subdirectories (default: true)',
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'pwd',
        description: 'Get the current allowed directory path',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// ツール実行ハンドラ
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'list_directory': {
        const requestedPath = args?.path as string;
        const dirPath = requestedPath ? getSafePath(requestedPath) : allowedDirectory;
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const result = await Promise.all(
          entries.map(async (entry) => {
            const fullPath = path.join(dirPath, entry.name);
            const stats = await fs.stat(fullPath);
            return {
              name: entry.name,
              type: entry.isDirectory() ? 'directory' : 'file',
              size: stats.size,
              modified: formatDate(stats.mtime),
            };
          })
        );
        const response = {
          path: dirPath.replace(/\\/g, '/'),
          files: result
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

      case 'read_file': {
        const filePath = getSafePath(args?.path as string);
        const content = await fs.readFile(filePath, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: content,
            },
          ],
        };
      }

      case 'write_file': {
        const filePath = getSafePath(args?.path as string);
        const content = args?.content as string;
        await fs.writeFile(filePath, content, 'utf-8');
        return {
          content: [
            {
              type: 'text',
              text: `File written successfully to ${filePath.replace(/\\/g, '/')}`,
            },
          ],
        };
      }

      case 'create_directory': {
        const dirPath = getSafePath(args?.path as string);
        await fs.mkdir(dirPath, { recursive: true });
        return {
          content: [
            {
              type: 'text',
              text: `Directory created successfully at ${dirPath.replace(/\\/g, '/')}`,
            },
          ],
        };
      }

      case 'delete_file': {
        const targetPath = getSafePath(args?.path as string);
        const stats = await fs.stat(targetPath);
        if (stats.isDirectory()) {
          await fs.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.unlink(targetPath);
        }
        return {
          content: [
            {
              type: 'text',
              text: `Successfully deleted ${targetPath.replace(/\\/g, '/')}`,
            },
          ],
        };
      }

      case 'rename_file': {
        const oldPath = getSafePath(args?.oldPath as string);
        const newPath = getSafePath(args?.newPath as string);
        
        await fs.rename(oldPath, newPath);
        
        return {
          content: [
            {
              type: 'text',
              text: `Successfully renamed ${oldPath.replace(/\\/g, '/')} to ${newPath.replace(/\\/g, '/')}.`,
            },
          ],
        };
      }
      
      case 'search_files': {
        const pattern = args?.pattern as string;
        const searchPath = args?.path ? getSafePath(args.path as string) : allowedDirectory;
        const recursive = args?.recursive !== false; // default to true
        
        const results: Array<{name: string, path: string, type: string}> = [];
        
        async function searchInDirectory(dirPath: string, currentDepth: number = 0) {
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
              const fullPath = path.join(dirPath, entry.name);
              const relativePath = path.relative(allowedDirectory, fullPath);
              
              // Simple wildcard matching
              const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
              
              if (regex.test(entry.name)) {
                results.push({
                  name: entry.name,
                  path: fullPath.replace(/\\/g, '/'),
                  type: entry.isDirectory() ? 'directory' : 'file'
                });
              }
              
              if (recursive && entry.isDirectory() && currentDepth < 10) { // Prevent infinite recursion
                await searchInDirectory(fullPath, currentDepth + 1);
              }
            }
          } catch (error) {
            // Skip directories that can't be read
          }
        }
        
        await searchInDirectory(searchPath);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                pattern,
                searchPath: searchPath.replace(/\\/g, '/'),
                results: results.slice(0, 100) // Limit to 100 results
              }, null, 2),
            },
          ],
        };
      }
      
      case 'pwd': {
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

// MCPエンドポイント - GET (情報表示)
app.get('/mcp', (req, res) => {
  res.json({
    message: 'MCP Server is running',
    version: '1.0.0',
    endpoints: {
      post: '/mcp - JSON-RPC requests',
      sse: '/sse - Server-Sent Events stream',
      health: '/health - Health check'
    }
  });
});

// MCPエンドポイント - SSE接続
app.get('/sse', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const transport = new SSEServerTransport('/message', res);
  await mcpServer.connect(transport);
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
            name: 'filesystem-mcp-server',
            version: '1.0.0',
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
              name: 'list_directory',
              description: 'List files and directories in a given path (defaults to allowed directory)',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The directory path to list (optional, defaults to allowed directory)',
                  },
                },
                required: [],
              },
            },
            {
              name: 'read_file',
              description: 'Read the contents of a file',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The file path to read',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'write_file',
              description: 'Write content to a file',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The file path to write to',
                  },
                  content: {
                    type: 'string',
                    description: 'The content to write',
                  },
                },
                required: ['path', 'content'],
              },
            },
            {
              name: 'create_directory',
              description: 'Create a new directory',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The directory path to create',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'delete_file',
              description: 'Delete a file or directory',
              inputSchema: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'The file or directory path to delete',
                  },
                },
                required: ['path'],
              },
            },
            {
              name: 'rename_file',
              description: 'Rename or move a file or directory',
              inputSchema: {
                type: 'object',
                properties: {
                  oldPath: {
                    type: 'string',
                    description: 'The current file or directory path',
                  },
                  newPath: {
                    type: 'string',
                    description: 'The new file or directory path',
                  },
                },
                required: ['oldPath', 'newPath'],
              },
            },
            {
              name: 'search_files',
              description: 'Search for files and directories by name pattern',
              inputSchema: {
                type: 'object',
                properties: {
                  pattern: {
                    type: 'string',
                    description: 'The search pattern (supports wildcards: * and ?)',
                  },
                  path: {
                    type: 'string',
                    description: 'The directory path to search in (optional, defaults to allowed directory)',
                  },
                  recursive: {
                    type: 'boolean',
                    description: 'Whether to search recursively in subdirectories (default: true)',
                  },
                },
                required: ['pattern'],
              },
            },
            {
              name: 'pwd',
              description: 'Get the current allowed directory path',
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
          case 'list_directory': {
            const requestedPath = args?.path as string;
            const dirPath = requestedPath ? getSafePath(requestedPath) : allowedDirectory;
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const fileList = await Promise.all(
              entries.map(async (entry) => {
                const fullPath = path.join(dirPath, entry.name);
                const stats = await fs.stat(fullPath);
                return {
                  name: entry.name,
                  type: entry.isDirectory() ? 'directory' : 'file',
                  size: stats.size,
                  modified: formatDate(stats.mtime),
                };
              })
            );
            const response = {
              path: dirPath.replace(/\\/g, '/'),
              files: fileList
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

          case 'read_file': {
            const filePath = getSafePath(args.path as string);
            const content = await fs.readFile(filePath, 'utf-8');
            result = {
              content: [
                {
                  type: 'text',
                  text: content,
                },
              ],
            };
            break;
          }

          case 'write_file': {
            const filePath = getSafePath(args.path as string);
            const content = args.content as string;
            await fs.writeFile(filePath, content, 'utf-8');
            result = {
              content: [
                {
                  type: 'text',
                  text: `File written successfully to ${filePath.replace(/\\/g, '/')}`,
                },
              ],
            };
            break;
          }

          case 'create_directory': {
            const dirPath = getSafePath(args.path as string);
            await fs.mkdir(dirPath, { recursive: true });
            result = {
              content: [
                {
                  type: 'text',
                  text: `Directory created successfully at ${dirPath.replace(/\\/g, '/')}`,
                },
              ],
            };
            break;
          }

          case 'delete_file': {
            const targetPath = getSafePath(args.path as string);
            const stats = await fs.stat(targetPath);
            if (stats.isDirectory()) {
              await fs.rm(targetPath, { recursive: true, force: true });
            } else {
              await fs.unlink(targetPath);
            }
            result = {
              content: [
                {
                  type: 'text',
                  text: `Successfully deleted ${targetPath.replace(/\\/g, '/')}`,
                },
              ],
            };
            break;
          }

          case 'rename_file': {
            const oldPath = getSafePath(args?.oldPath as string);
            const newPath = getSafePath(args?.newPath as string);
            
            await fs.rename(oldPath, newPath);
            
            result = {
              content: [
                {
                  type: 'text',
                  text: `Successfully renamed ${oldPath.replace(/\\/g, '/')} to ${newPath.replace(/\\/g, '/')}.`,
                },
              ],
            };
            break;
          }
          
          case 'search_files': {
            const pattern = args?.pattern as string;
            const searchPath = args?.path ? getSafePath(args.path as string) : allowedDirectory;
            const recursive = args?.recursive !== false; // default to true
            
            const results: Array<{name: string, path: string, type: string}> = [];
            
            async function searchInDirectory(dirPath: string, currentDepth: number = 0) {
              try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });
                
                for (const entry of entries) {
                  const fullPath = path.join(dirPath, entry.name);
                  const relativePath = path.relative(allowedDirectory, fullPath);
                  
                  // Simple wildcard matching
                  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
                  
                  if (regex.test(entry.name)) {
                    results.push({
                      name: entry.name,
                      path: fullPath.replace(/\\/g, '/'),
                      type: entry.isDirectory() ? 'directory' : 'file'
                    });
                  }
                  
                  if (recursive && entry.isDirectory() && currentDepth < 10) { // Prevent infinite recursion
                    await searchInDirectory(fullPath, currentDepth + 1);
                  }
                }
              } catch (error) {
                // Skip directories that can't be read
              }
            }
            
            await searchInDirectory(searchPath);
            
            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    pattern,
                    searchPath: searchPath.replace(/\\/g, '/'),
                    results: results.slice(0, 100) // Limit to 100 results
                  }, null, 2),
                },
              ],
            };
            break;
          }
          
          case 'pwd': {
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
                text: `Error: ${error instanceof Error ? error.message : String(error)}`,
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

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', name: 'filesystem-mcp-server', version: '1.0.0' });
});

const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = process.env.HOST || 'localhost';

// 初期化してからサーバーを起動
initialize().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Filesystem MCP HTTP/SSE server running on ${HOST}:${PORT}`);
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
});