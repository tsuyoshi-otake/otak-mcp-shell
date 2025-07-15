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