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
      case 'LS': {
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
        return { success: true, data: response };
      }

      case 'Read': {
        const filePath = getSafePath(args.path as string);
        const offset = args.offset as number; // 1-based line number
        const limit = (args.limit as number) || 2000; // default to 2000 lines
        
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        
        let selectedLines: string[];
        let startLine = 1;
        
        if (offset && offset > 0) {
          // Convert to 0-based index
          const startIndex = offset - 1;
          selectedLines = lines.slice(startIndex, startIndex + limit);
          startLine = offset;
        } else {
          // Read from beginning
          selectedLines = lines.slice(0, limit);
        }
        
        // Format output with line numbers like cat -n
        const formattedLines = selectedLines.map((line, index) => {
          const lineNumber = startLine + index;
          return `${lineNumber.toString().padStart(6)}→${line}`;
        });
        
        return {
          success: true,
          data: {
            path: filePath.replace(/\\/g, '/'),
            totalLines: lines.length,
            startLine: startLine,
            endLine: startLine + selectedLines.length - 1,
            content: formattedLines.join('\n')
          }
        };
      }

      case 'Write': {
        const filePath = getSafePath(args.path as string);
        const content = args.content as string;
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true, message: `File written successfully to ${filePath.replace(/\\/g, '/')}` };
      }

      case 'Create': {
        const dirPath = getSafePath(args.path as string);
        await fs.mkdir(dirPath, { recursive: true });
        return { success: true, message: `Directory created successfully at ${dirPath.replace(/\\/g, '/')}` };
      }

      case 'Delete': {
        const targetPath = getSafePath(args.path as string);
        const stats = await fs.stat(targetPath);
        if (stats.isDirectory()) {
          await fs.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.unlink(targetPath);
        }
        return { success: true, message: `Successfully deleted ${targetPath.replace(/\\/g, '/')}` };
      }

      case 'Rename': {
        const oldPath = getSafePath(args.oldPath as string);
        const newPath = getSafePath(args.newPath as string);
        
        await fs.rename(oldPath, newPath);
        
        return { 
          success: true, 
          message: `Successfully renamed ${oldPath.replace(/\\/g, '/')} to ${newPath.replace(/\\/g, '/')}.` 
        };
      }
      
      case 'Glob': {
        const pattern = args.pattern as string;
        const searchPath = args.path ? getSafePath(args.path as string) : allowedDirectory;
        const recursive = args.recursive !== false; // default to true
        
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        
        async function searchInDirectory(dirPath: string, currentDepth: number = 0): Promise<Array<{name: string, path: string, type: string}>> {
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const localResults: Array<{name: string, path: string, type: string}> = [];
            const subdirPromises: Promise<Array<{name: string, path: string, type: string}>>[] = [];
            
            for (const entry of entries) {
              const fullPath = path.join(dirPath, entry.name);
              
              if (regex.test(entry.name)) {
                localResults.push({
                  name: entry.name,
                  path: fullPath.replace(/\\/g, '/'),
                  type: entry.isDirectory() ? 'directory' : 'file'
                });
              }
              
              if (recursive && entry.isDirectory() && currentDepth < 10) {
                subdirPromises.push(searchInDirectory(fullPath, currentDepth + 1));
              }
            }
            
            // Process subdirectories in parallel
            const subdirResults = await Promise.all(subdirPromises);
            const flatResults = subdirResults.flat();
            
            return [...localResults, ...flatResults];
          } catch (error) {
            // Skip directories that can't be read
            return [];
          }
        }
        
        const searchResults = await searchInDirectory(searchPath);
        
        return {
          success: true,
          data: {
            pattern,
            searchPath: searchPath.replace(/\\/g, '/'),
            results: searchResults.slice(0, 100) // Limit to 100 results
          }
        };
      }
      
      case 'Grep': {
        const searchPattern = args.pattern as string;
        const searchPath = args.path ? getSafePath(args.path as string) : allowedDirectory;
        const recursive = args.recursive !== false; // default to true
        const caseSensitive = args.caseSensitive === true; // default to false
        const filePattern = args.filePattern as string;
        
        // Create regex for content search
        const flags = caseSensitive ? 'g' : 'gi';
        const contentRegex = new RegExp(searchPattern, flags);
        
        // Create regex for file pattern filtering
        const fileRegex = filePattern ? 
          new RegExp('^' + filePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : 
          null;
        
        async function searchInFile(filePath: string): Promise<Array<{file: string, lineNumber: number, line: string, match: string}>> {
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            const fileResults: Array<{file: string, lineNumber: number, line: string, match: string}> = [];
            
            lines.forEach((line, index) => {
              const matches = line.match(contentRegex);
              if (matches) {
                matches.forEach(match => {
                  fileResults.push({
                    file: filePath.replace(/\\/g, '/'),
                    lineNumber: index + 1,
                    line: line.trim(),
                    match: match
                  });
                });
              }
            });
            
            return fileResults;
          } catch (error) {
            // Skip files that can't be read (binary files, permission issues, etc.)
            return [];
          }
        }
        
        async function searchInDirectory(dirPath: string, currentDepth: number = 0): Promise<Array<{file: string, lineNumber: number, line: string, match: string}>> {
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            const filePromises: Promise<Array<{file: string, lineNumber: number, line: string, match: string}>>[] = [];
            const subdirPromises: Promise<Array<{file: string, lineNumber: number, line: string, match: string}>>[] = [];
            
            for (const entry of entries) {
              const fullPath = path.join(dirPath, entry.name);
              
              if (entry.isFile()) {
                // Check if file matches the file pattern filter
                if (!fileRegex || fileRegex.test(entry.name)) {
                  filePromises.push(searchInFile(fullPath));
                }
              } else if (entry.isDirectory() && recursive && currentDepth < 10) {
                subdirPromises.push(searchInDirectory(fullPath, currentDepth + 1));
              }
            }
            
            // Process files and subdirectories in parallel
            const [fileResults, subdirResults] = await Promise.all([
              Promise.all(filePromises),
              Promise.all(subdirPromises)
            ]);
            
            const flatFileResults = fileResults.flat();
            const flatSubdirResults = subdirResults.flat();
            
            return [...flatFileResults, ...flatSubdirResults];
          } catch (error) {
            // Skip directories that can't be read
            return [];
          }
        }
        
        let results: Array<{file: string, lineNumber: number, line: string, match: string}> = [];
        
        // Check if searchPath is a file or directory
        const stats = await fs.stat(searchPath);
        if (stats.isFile()) {
          results = await searchInFile(searchPath);
        } else {
          results = await searchInDirectory(searchPath);
        }
        
        return {
          success: true,
          data: {
            pattern: searchPattern,
            searchPath: searchPath.replace(/\\/g, '/'),
            caseSensitive,
            filePattern: filePattern || 'all files',
            totalMatches: results.length,
            results: results.slice(0, 200) // Limit to 200 results
          }
        };
      }
      
      case 'Copy': {
        const source = getSafePath(args.source as string);
        const destination = getSafePath(args.destination as string);
        const recursive = args.recursive !== false; // default to true
        
        const sourceStats = await fs.stat(source);
        
        if (sourceStats.isDirectory()) {
          if (recursive) {
            await fs.cp(source, destination, { recursive: true });
          } else {
            throw new Error('Source is a directory but recursive is false');
          }
        } else {
          // Ensure destination directory exists
          const destDir = path.dirname(destination);
          await fs.mkdir(destDir, { recursive: true });
          await fs.copyFile(source, destination);
        }
        
        return {
          success: true,
          message: `Successfully copied ${source.replace(/\\/g, '/')} to ${destination.replace(/\\/g, '/')}.`
        };
      }
      
      case 'Stat': {
        const filePath = getSafePath(args.path as string);
        const stats = await fs.stat(filePath);
        
        const fileInfo = {
          path: filePath.replace(/\\/g, '/'),
          name: path.basename(filePath),
          type: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          accessed: stats.atime.toISOString(),
          permissions: {
            readable: (stats.mode & 0o444) !== 0,
            writable: (stats.mode & 0o222) !== 0,
            executable: (stats.mode & 0o111) !== 0,
          },
          mode: '0' + (stats.mode & parseInt('777', 8)).toString(8),
        };
        
        return {
          success: true,
          data: fileInfo
        };
      }
      
      case 'Tail': {
        const filePath = getSafePath(args.path as string);
        const lines = (args.lines as number) || 10;
        
        const content = await fs.readFile(filePath, 'utf-8');
        const allLines = content.split('\n');
        const tailLines = allLines.slice(-lines);
        
        return {
          success: true,
          data: {
            path: filePath.replace(/\\/g, '/'),
            totalLines: allLines.length,
            requestedLines: lines,
            lines: tailLines
          }
        };
      }
      
      case 'Edit': {
        const filePath = getSafePath(args.path as string);
        const oldText = args.old_text as string;
        const newText = args.new_text as string;
        const replaceAll = args.replace_all === true;
        
        // Read the current file content
        const currentContent = await fs.readFile(filePath, 'utf-8');
        
        // Check if old_text exists in the file
        if (!currentContent.includes(oldText)) {
          throw new Error(`Text not found in file: "${oldText}"`);
        }
        
        // Perform replacement
        let updatedContent: string;
        if (replaceAll) {
          // Replace all occurrences
          updatedContent = currentContent.split(oldText).join(newText);
        } else {
          // Replace only the first occurrence
          const index = currentContent.indexOf(oldText);
          updatedContent = currentContent.substring(0, index) + newText + currentContent.substring(index + oldText.length);
        }
        
        // Write the updated content back to the file
        await fs.writeFile(filePath, updatedContent, 'utf-8');
        
        // Count occurrences for reporting
        const oldOccurrences = (currentContent.match(new RegExp(oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        const replacedCount = replaceAll ? oldOccurrences : 1;
        
        return {
          success: true,
          message: `Successfully updated ${filePath.replace(/\\/g, '/')}. Replaced ${replacedCount} occurrence(s) of "${oldText}" with "${newText}".`
        };
      }
      
      case 'MultiEdit': {
        const filePath = getSafePath(args.path as string);
        const edits = args.edits as Array<{old_text: string, new_text: string, replace_all?: boolean}>;
        
        // Read the current file content
        let currentContent = await fs.readFile(filePath, 'utf-8');
        const originalContent = currentContent;
        
        // Validate all edits first (atomic operation)
        for (let i = 0; i < edits.length; i++) {
          const edit = edits[i];
          if (!currentContent.includes(edit.old_text)) {
            throw new Error(`Edit ${i + 1}: Text not found in file: "${edit.old_text}"`);
          }
        }
        
        // Apply all edits sequentially
        const appliedEdits: Array<{old_text: string, new_text: string, count: number}> = [];
        
        for (const edit of edits) {
          const replaceAll = edit.replace_all === true;
          const oldOccurrences = (currentContent.match(new RegExp(edit.old_text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          
          if (replaceAll) {
            currentContent = currentContent.split(edit.old_text).join(edit.new_text);
            appliedEdits.push({
              old_text: edit.old_text,
              new_text: edit.new_text,
              count: oldOccurrences
            });
          } else {
            const index = currentContent.indexOf(edit.old_text);
            currentContent = currentContent.substring(0, index) + edit.new_text + currentContent.substring(index + edit.old_text.length);
            appliedEdits.push({
              old_text: edit.old_text,
              new_text: edit.new_text,
              count: 1
            });
          }
        }
        
        // Write the updated content back to the file
        await fs.writeFile(filePath, currentContent, 'utf-8');
        
        const summary = appliedEdits.map((edit, index) => 
          `Edit ${index + 1}: Replaced ${edit.count} occurrence(s) of "${edit.old_text}" with "${edit.new_text}"`
        ).join('\n');
        
        return {
          success: true,
          message: `Successfully applied ${edits.length} edits to ${filePath.replace(/\\/g, '/')}:\n${summary}`
        };
      }
      
      case 'Search': {
        const pattern = args.pattern as string;
        const searchPath = args.path ? getSafePath(args.path as string) : allowedDirectory;
        const limit = (args.limit as number) || 100;
        
        // Convert glob pattern to regex
        const globToRegex = (glob: string) => {
          const regexPattern = glob
            .replace(/\*\*/g, '§DOUBLESTAR§')
            .replace(/\*/g, '[^/]*')
            .replace(/§DOUBLESTAR§/g, '.*')
            .replace(/\?/g, '[^/]')
            .replace(/\./g, '\\.')
            .replace(/\+/g, '\\+')
            .replace(/\^/g, '\\^')
            .replace(/\$/g, '\\$');
          return new RegExp('^' + regexPattern + '$');
        };
        
        const regex = globToRegex(pattern);
        const results: Array<{path: string, name: string, modified: Date}> = [];
        
        async function searchDirectory(dirPath: string, currentDepth: number = 0): Promise<void> {
          if (currentDepth > 10) return; // Prevent infinite recursion
          
          try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            
            for (const entry of entries) {
              const fullPath = path.join(dirPath, entry.name);
              const relativePath = path.relative(allowedDirectory, fullPath);
              
              if (entry.isFile()) {
                if (regex.test(relativePath)) {
                  const stats = await fs.stat(fullPath);
                  results.push({
                    path: fullPath.replace(/\\/g, '/'),
                    name: entry.name,
                    modified: stats.mtime
                  });
                }
              } else if (entry.isDirectory()) {
                await searchDirectory(fullPath, currentDepth + 1);
              }
            }
          } catch (error) {
            // Skip directories that can't be read
          }
        }
        
        await searchDirectory(searchPath);
        
        // Sort by modification time (newest first)
        results.sort((a, b) => b.modified.getTime() - a.modified.getTime());
        
        return {
          success: true,
          data: {
            pattern,
            searchPath: searchPath.replace(/\\/g, '/'),
            totalMatches: results.length,
            results: results.slice(0, limit).map(r => ({
              path: r.path,
              name: r.name,
              modified: r.modified.toISOString()
            }))
          }
        };
      }
      
      case 'PWD': {
        return { success: true, data: allowedDirectory.replace(/\\/g, '/') };
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
        name: 'LS',
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
        name: 'Read',
        description: 'Read the contents of a file with optional offset and limit',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to read',
            },
            offset: {
              type: 'number',
              description: 'The line number to start reading from (1-based, optional)',
            },
            limit: {
              type: 'number',
              description: 'The number of lines to read (optional, defaults to 2000)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'Write',
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
        name: 'Create',
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
        name: 'Delete',
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
        name: 'Rename',
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
        name: 'Glob',
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
        name: 'Grep',
        description: 'Search for text content within files',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'The text pattern to search for (supports basic regex)',
            },
            path: {
              type: 'string',
              description: 'The file or directory path to search in (optional, defaults to allowed directory)',
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to search recursively in subdirectories (default: true)',
            },
            caseSensitive: {
              type: 'boolean',
              description: 'Whether to perform case-sensitive search (default: false)',
            },
            filePattern: {
              type: 'string',
              description: 'Filter files by name pattern (supports wildcards: * and ?)',
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'Copy',
        description: 'Copy a file or directory to another location',
        inputSchema: {
          type: 'object',
          properties: {
            source: {
              type: 'string',
              description: 'The source file or directory path',
            },
            destination: {
              type: 'string',
              description: 'The destination path',
            },
            recursive: {
              type: 'boolean',
              description: 'Whether to copy directories recursively (default: true)',
            },
          },
          required: ['source', 'destination'],
        },
      },
      {
        name: 'Stat',
        description: 'Get detailed information about a file or directory',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file or directory path',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'Tail',
        description: 'Get the last N lines of a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path',
            },
            lines: {
              type: 'number',
              description: 'Number of lines to return (default: 10)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'Edit',
        description: 'Partially update a file by replacing specific text content',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to update',
            },
            old_text: {
              type: 'string',
              description: 'The exact text to find and replace',
            },
            new_text: {
              type: 'string',
              description: 'The new text to replace with',
            },
            replace_all: {
              type: 'boolean',
              description: 'Replace all occurrences (default: false, replaces only first occurrence)',
            },
          },
          required: ['path', 'old_text', 'new_text'],
        },
      },
      {
        name: 'MultiEdit',
        description: 'Perform multiple find-and-replace operations on a single file atomically',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'The file path to update',
            },
            edits: {
              type: 'array',
              description: 'Array of edit operations to perform sequentially',
              items: {
                type: 'object',
                properties: {
                  old_text: {
                    type: 'string',
                    description: 'The exact text to find and replace',
                  },
                  new_text: {
                    type: 'string',
                    description: 'The new text to replace with',
                  },
                  replace_all: {
                    type: 'boolean',
                    description: 'Replace all occurrences (default: false)',
                  },
                },
                required: ['old_text', 'new_text'],
              },
            },
          },
          required: ['path', 'edits'],
        },
      },
      {
        name: 'Search',
        description: 'Fast file pattern matching with glob patterns, sorted by modification time',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Glob pattern (e.g., **/*.js, src/**/*.ts, *.json)',
            },
            path: {
              type: 'string',
              description: 'Directory to search in (optional, defaults to allowed directory)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 100)',
            },
          },
          required: ['pattern'],
        },
      },
      {
        name: 'PWD',
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
      path: safePath.replace(/\\/g, '/'),
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