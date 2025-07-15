#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
    console.error(`Allowed directory: ${allowedDirectory}`);
  } catch (error) {
    console.error('Failed to create directory:', error);
  }
}

const server = new Server(
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

server.setRequestHandler(ListToolsRequestSchema, async () => {
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

server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

async function main() {
  await initialize();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Filesystem MCP server running on stdio');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});