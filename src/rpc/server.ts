/**
 * JSON-RPC 2.0 server — Daemon side, listens on local TCP.
 * Also serves HTTP requests for v1 backward compatibility.
 */

import net from 'node:net';
import http from 'node:http';
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  createErrorResponse,
  createSuccessResponse,
  serialize,
  RpcErrorCode,
  DAEMON_HOST,
  DAEMON_PORT,
} from './protocol.js';

export type RpcHandler = (params: Record<string, unknown>) => Promise<unknown>;

export class RpcServer {
  private handlers = new Map<string, RpcHandler>();
  private tcpServer: net.Server | null = null;
  private httpServer: http.Server | null = null;

  /** Register a method handler. */
  method(name: string, handler: RpcHandler): void {
    this.handlers.set(name, handler);
  }

  /** Dispatch a JSON-RPC request to the registered handler. */
  async dispatch(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const handler = this.handlers.get(req.method);
    if (!handler) {
      return createErrorResponse(req.id, RpcErrorCode.METHOD_NOT_FOUND, `Unknown method: ${req.method}`);
    }
    try {
      const result = await handler(req.params ?? {});
      return createSuccessResponse(req.id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Map known error types to specific codes
      const code = this.classifyError(err);
      return createErrorResponse(req.id, code, message);
    }
  }

  /**
   * Start listening.
   * The server distinguishes JSON-RPC (starts with '{') from HTTP (starts with GET/POST/etc).
   * Uses line-delimited framing to correctly handle TCP packet boundaries.
   */
  async start(port: number = DAEMON_PORT, host: string = DAEMON_HOST): Promise<void> {
    return new Promise((resolve, reject) => {
      this.tcpServer = net.createServer((socket) => {
        let buffer = '';
        let protocol: 'unknown' | 'jsonrpc' | 'http' = 'unknown';

        socket.on('data', (chunk) => {
          buffer += chunk.toString();

          // Detect protocol on first meaningful data
          if (protocol === 'unknown') {
            const trimmed = buffer.trimStart();
            if (trimmed.startsWith('{')) {
              protocol = 'jsonrpc';
            } else if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS) /.test(trimmed)) {
              protocol = 'http';
              this.handleHttpUpgrade(buffer, socket);
              buffer = '';
              return;
            }
          }

          if (protocol === 'jsonrpc') {
            // Line-delimited JSON: process all complete lines (handles packet merging)
            let idx: number;
            while ((idx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, idx).trim();
              buffer = buffer.slice(idx + 1);
              if (line.length > 0) {
                this.handleJsonRpc(line, socket);
              }
            }
          }
        });

        socket.on('end', () => {
          // Handle remaining data without trailing newline (graceful fallback)
          const remaining = buffer.trim();
          if (remaining.startsWith('{')) {
            this.handleJsonRpc(remaining, socket);
          }
          buffer = '';
        });

        socket.on('error', () => { /* connection reset, ignore */ });
      });

      this.tcpServer.on('error', reject);
      this.tcpServer.listen(port, host, () => {
        console.log(`[super-browser] Daemon listening on ${host}:${port}`);
        resolve();
      });
    });
  }

  stop(): void {
    this.tcpServer?.close();
    this.httpServer?.close();
  }

  /** Set the HTTP server for v1 backward compatibility. */
  setHttpServer(server: http.Server): void {
    this.httpServer = server;
  }

  // ---- Internal ----

  private async handleJsonRpc(raw: string, socket: net.Socket): Promise<void> {
    try {
      const req = JSON.parse(raw.trim()) as JsonRpcRequest;
      if (req.jsonrpc !== '2.0' || !req.method) {
        const resp = createErrorResponse(
          req.id ?? null,
          RpcErrorCode.INVALID_REQUEST,
          'Invalid JSON-RPC 2.0 request',
        );
        socket.end(serialize(resp));
        return;
      }
      const resp = await this.dispatch(req);
      socket.end(serialize(resp));
    } catch {
      const resp = createErrorResponse(null, RpcErrorCode.PARSE_ERROR, 'Failed to parse JSON-RPC request');
      socket.end(serialize(resp));
    }
  }

  private handleHttpUpgrade(raw: string, socket: net.Socket): void {
    if (!this.httpServer) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\nNo HTTP handler\n');
      return;
    }
    // Re-emit the data so http.Server can parse it
    this.httpServer.emit('connection', socket);
    socket.unshift(Buffer.from(raw));
  }

  private classifyError(err: unknown): number {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      if (msg.includes('page not found') || msg.includes('no such page'))
        return RpcErrorCode.PAGE_NOT_FOUND;
      if (msg.includes('disconnected') || msg.includes('browser has been closed'))
        return RpcErrorCode.BROWSER_DISCONNECTED;
      if (msg.includes('timeout') || msg.includes('timed out'))
        return RpcErrorCode.PAGE_TIMEOUT;
      if (msg.includes('navigation') || msg.includes('net::err'))
        return RpcErrorCode.NAVIGATION_FAILED;
      if (msg.includes('evaluation failed') || msg.includes('execution context'))
        return RpcErrorCode.EVAL_ERROR;
    }
    return -32000; // generic server error
  }
}
