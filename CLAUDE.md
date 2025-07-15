# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a filesystem MCP (Model Context Protocol) server implementation that provides secure file system operations with SSE/HTTP streaming support. The server implements directory access restrictions to ensure operations stay within allowed directories.

## Architecture

The project consists of three main server implementations:

1. **Standard MCP Server (src/index.ts)**: Communicates via stdio, implements security restrictions with configurable allowed directory
2. **HTTP Server (src/http-server.ts)**: Provides REST API endpoints and SSE streaming for file watching/tailing
3. **MCP HTTP/SSE Server (src/mcp-http-server.ts)**: Hybrid server supporting both HTTP POST and SSE for MCP protocol

Key architectural decisions:
- Security-first design with path traversal protection and directory access restrictions
- Default restriction to `~/Desktop/Otak` when no directory specified
- All file operations validate paths against the allowed directory
- Support for both stdio and HTTP/SSE transports for flexibility

## Development Commands

```bash
# Install dependencies
npm install

# Development with hot reload
npm run dev        # Run stdio MCP server (default port: stdio)
npm run dev:http   # Run HTTP server (default port: 8766)  
npm run dev:mcp    # Run MCP HTTP/SSE server (default port: 8765)

# Build TypeScript
npm run build

# Production
npm start          # Run built stdio server
npm start:http     # Run built HTTP server
npm start:mcp      # Run built MCP HTTP/SSE server

# Windows Service Management
npm run service:install          # Install as Windows service (stdio)
npm run service:install:http     # Install HTTP server as Windows service
npm run service:install:mcp      # Install MCP HTTP/SSE server as Windows service
npm run service:uninstall        # Uninstall Windows service
```

## Configuration

The stdio server accepts a JSON configuration argument:
```bash
npm run dev -- '{"allowedDirectory": "/path/to/allowed/directory"}'
```

HTTP servers use environment variables:
```bash
PORT=8080 npm run dev:http
HOST=0.0.0.0 npm run dev:mcp
```

## Available Tools

All servers implement these filesystem tools:

- `LS`: List files/directories with metadata
  - Example: `{"path": "src"}` - List contents of src directory
- `Read`: Read file contents with optional offset and limit for partial reading
  - Example: `{"path": "package.json"}` - Read entire file
  - Example: `{"path": "large-file.txt", "offset": 100, "limit": 50}` - Read 50 lines starting from line 100
- `Write`: Write content to files
  - Example: `{"path": "test.txt", "content": "Hello World"}` - Create/overwrite file
- `Create`: Create directories (recursive)
  - Example: `{"path": "src/components"}` - Create nested directories
- `Delete`: Delete files or directories
  - Example: `{"path": "old-file.txt"}` - Delete specific file
- `Rename`: Rename or move files and directories
  - Example: `{"oldPath": "old.txt", "newPath": "new.txt"}` - Rename file
- `Copy`: Copy files or directories to another location with recursive support
  - Example: `{"source": "src/", "destination": "backup/src/"}` - Copy directory
- `Stat`: Get detailed file information including size, timestamps, and permissions
  - Example: `{"path": "package.json"}` - Get file metadata
- `Tail`: Get the last N lines of a file (useful for log files)
  - Example: `{"path": "app.log", "lines": 20}` - Get last 20 lines
- `Edit`: Partially update files using find-and-replace operations
  - Example: `{"path": "config.js", "old_text": "port: 3000", "new_text": "port: 8080"}` - Replace text
- `MultiEdit`: Perform multiple find-and-replace operations on a single file atomically
  - Example: `{"path": "config.js", "edits": [{"old_text": "port: 3000", "new_text": "port: 8080"}, {"old_text": "dev", "new_text": "production"}]}` - Multiple edits
- `Search`: Fast file pattern matching with glob patterns, sorted by modification time
  - Example: `{"pattern": "**/*.js"}` - Find all JS files, `{"pattern": "src/**/*.ts"}` - Find TypeScript files in src
- `Glob`: High-performance file search with wildcard patterns (*, ?) and parallel directory traversal
  - Example: `{"pattern": "*.js", "recursive": true}` - Find all JavaScript files
- `Grep`: High-performance text search within files with regex support, parallel file processing, case sensitivity options, and file filtering
  - Example: `{"pattern": "function.*Error", "filePattern": "*.js"}` - Find error functions in JS files
- `PWD`: Get the current allowed directory path
  - Example: `{}` - Returns the current allowed directory path

The HTTP server additionally provides SSE endpoints:
- `/stream/watch`: Watch for file/directory changes
- `/stream/tail`: Tail log files with real-time updates

## Code Architecture

The codebase is structured around three main server implementations that share common filesystem tools:

### Core Components

1. **Path Security System**: All servers implement path validation with `isPathAllowed()` and `getSafePath()` functions to prevent directory traversal attacks
2. **Common Tool Set**: Five filesystem tools are implemented identically across all servers:
   - `LS`: Returns file/directory metadata with normalized paths
   - `Read`: Reads file contents with security validation
   - `Write`: Writes content with automatic directory creation
   - `Create`: Creates directories recursively
   - `Delete`: Deletes files or directories with validation

3. **Shared Security Logic**: 
   - Path normalization (backslash to forward slash conversion)
   - Tilde expansion (`~/` to home directory)
   - Allowed directory validation
   - Default directory creation (`~/Desktop/Otak`)

### Server Implementations

- **stdio server** (`src/index.ts`): Uses MCP SDK's StdioServerTransport
- **HTTP server** (`src/http-server.ts`): Express-based REST API with SSE streaming
- **MCP HTTP/SSE server** (`src/mcp-http-server.ts`): Hybrid using SSEServerTransport

### Windows Service Support

The `scripts/` directory contains Windows service management utilities using the `node-windows` package for production deployment scenarios.

## Release Process

The project uses GitHub Actions for automated NPM publishing:

- **Automated releases**: Push tags matching `v*` pattern (e.g., `git tag v1.0.1 && git push origin v1.0.1`)
- **Manual releases**: Use GitHub Actions "Publish to NPM" workflow with version bump options (patch/minor/major)
- **Build validation**: All releases automatically run `npm ci`, `npm run build` before publishing
- **GitHub releases**: Automatically created with installation and usage instructions