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
- `list_directory`: List files/directories with metadata
- `read_file`: Read file contents
- `write_file`: Write content to files
- `create_directory`: Create directories (recursive)
- `delete_file`: Delete files or directories

The HTTP server additionally provides SSE endpoints:
- `/stream/watch`: Watch for file/directory changes
- `/stream/tail`: Tail log files with real-time updates

## Code Architecture

The codebase is structured around three main server implementations that share common filesystem tools:

### Core Components

1. **Path Security System**: All servers implement path validation with `isPathAllowed()` and `getSafePath()` functions to prevent directory traversal attacks
2. **Common Tool Set**: Five filesystem tools are implemented identically across all servers:
   - `list_directory`: Returns file/directory metadata with normalized paths
   - `read_file`: Reads file contents with security validation
   - `write_file`: Writes content with automatic directory creation
   - `create_directory`: Creates directories recursively
   - `delete_file`: Deletes files or directories with validation

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