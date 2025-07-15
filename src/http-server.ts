#!/usr/bin/env node
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
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
app.use(express.json());

const server = new Server(
  {
    name: 'filesystem-mcp-http-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

async function handleToolCall(toolName: string, args: any) {
  try {
    switch (toolName) {
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
          path: dirPath,
          files: result
        };
        return { success: true, data: response };
      }

      case 'read_file': {
        const filePath = getSafePath(args.path as string);
        const content = await fs.readFile(filePath, 'utf-8');
        return { success: true, data: content };
      }

      case 'write_file': {
        const filePath = getSafePath(args.path as string);
        const content = args.content as string;
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true, message: `File written successfully to ${filePath}` };
      }

      case 'create_directory': {
        const dirPath = getSafePath(args.path as string);
        await fs.mkdir(dirPath, { recursive: true });
        return { success: true, message: `Directory created successfully at ${dirPath}` };
      }

      case 'delete_file': {
        const targetPath = getSafePath(args.path as string);
        const stats = await fs.stat(targetPath);
        if (stats.isDirectory()) {
          await fs.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.unlink(targetPath);
        }
        return { success: true, message: `Successfully deleted ${targetPath}` };
      }

      case 'pwd': {
        return { success: true, data: allowedDirectory };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

app.get('/tools', async (req, res) => {
  res.json({
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
        name: 'pwd',
        description: 'Get the current allowed directory path',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    ],
  });
});

app.post('/tools/:toolName', async (req, res) => {
  const { toolName } = req.params;
  const args = req.body;
  
  const result = await handleToolCall(toolName, args);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(400).json(result);
  }
});

app.get('/stream/watch', async (req, res) => {
  const { path: watchPath } = req.query;
  
  if (!watchPath || typeof watchPath !== 'string') {
    return res.status(400).json({ error: 'Path parameter is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const safePath = getSafePath(watchPath);
    const stats = await fs.stat(safePath);
    sendEvent({
      type: 'initial',
      path: safePath,
      exists: true,
      isDirectory: stats.isDirectory(),
      size: stats.size,
      modified: stats.mtime.toISOString(),
    });

    const watcher = fs.watch(safePath, { recursive: true });
    
    for await (const event of watcher) {
      sendEvent({
        type: 'change',
        eventType: event.eventType,
        filename: event.filename,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    sendEvent({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    res.end();
  }

  req.on('close', () => {
    res.end();
  });
});

app.get('/stream/tail', async (req, res) => {
  const { path: filePath } = req.query;
  
  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Path parameter is required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const safePath = getSafePath(filePath);
    const stats = await fs.stat(safePath);
    if (stats.isDirectory()) {
      throw new Error('Cannot tail a directory');
    }

    const content = await fs.readFile(safePath, 'utf-8');
    const lines = content.split('\n');
    const last10Lines = lines.slice(-10);
    
    sendEvent({
      type: 'initial',
      lines: last10Lines,
      totalLines: lines.length,
    });

    let lastSize = stats.size;
    const watcher = fs.watch(safePath);
    
    for await (const event of watcher) {
      if (event.eventType === 'change') {
        const newStats = await fs.stat(safePath);
        if (newStats.size > lastSize) {
          const buffer = Buffer.alloc(newStats.size - lastSize);
          const fd = await fs.open(safePath, 'r');
          await fd.read(buffer, 0, buffer.length, lastSize);
          await fd.close();
          
          const newContent = buffer.toString('utf-8');
          const newLines = newContent.split('\n').filter(line => line.length > 0);
          
          sendEvent({
            type: 'append',
            lines: newLines,
            timestamp: new Date().toISOString(),
          });
          
          lastSize = newStats.size;
        }
      }
    }
  } catch (error) {
    sendEvent({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    res.end();
  }

  req.on('close', () => {
    res.end();
  });
});

const PORT = parseInt(process.env.PORT || '8766', 10);
const HOST = process.env.HOST || 'localhost';

// 初期化してからサーバーを起動
initialize().then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Filesystem MCP HTTP server running on ${HOST}:${PORT}`);
    console.log(`Tools endpoint: http://${HOST}:${PORT}/tools`);
    console.log(`SSE watch endpoint: http://${HOST}:${PORT}/stream/watch?path=/path/to/watch`);
    console.log(`SSE tail endpoint: http://${HOST}:${PORT}/stream/tail?path=/path/to/file.log`);
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