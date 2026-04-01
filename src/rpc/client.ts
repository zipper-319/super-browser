/**
 * JSON-RPC 2.0 client — CLI thin client connecting to Daemon over TCP.
 */

import net from 'node:net';
import {
  type JsonRpcResponse,
  createRequest,
  isErrorResponse,
  serialize,
  DAEMON_HOST,
  DAEMON_PORT,
  RpcErrorCode,
  createErrorResponse,
} from './protocol.js';

export interface RpcCallOptions {
  timeout?: number;
}

/**
 * Send a JSON-RPC 2.0 request to the daemon and return the response.
 * Single connection per request (connect → send → read → close).
 */
export async function rpcCall(
  method: string,
  params?: Record<string, unknown>,
  opts?: RpcCallOptions,
): Promise<JsonRpcResponse> {
  const timeout = opts?.timeout ?? 30_000;
  const req = createRequest(method, params);

  return new Promise<JsonRpcResponse>((resolve) => {
    const socket = net.createConnection({ host: DAEMON_HOST, port: DAEMON_PORT });
    let data = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        resolve(createErrorResponse(req.id, RpcErrorCode.PAGE_TIMEOUT, 'RPC call timed out'));
      }
    }, timeout);

    socket.on('connect', () => {
      socket.write(serialize(req));
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
    });

    socket.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        const resp = JSON.parse(data.trim()) as JsonRpcResponse;
        resolve(resp);
      } catch {
        resolve(createErrorResponse(req.id, RpcErrorCode.PARSE_ERROR, 'Invalid response from daemon'));
      }
    });

    socket.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === 'ECONNREFUSED') {
        resolve(createErrorResponse(req.id, RpcErrorCode.DAEMON_NOT_RUNNING, 'Daemon is not running'));
      } else {
        resolve(createErrorResponse(req.id, RpcErrorCode.BROWSER_DISCONNECTED, err.message));
      }
    });
  });
}

/**
 * Check if daemon is reachable.
 */
export async function isDaemonRunning(): Promise<boolean> {
  const resp = await rpcCall('daemon.status', undefined, { timeout: 3000 });
  return !isErrorResponse(resp);
}
