/**
 * JSON-RPC 2.0 protocol types and helpers.
 * Shared between CLI client and Daemon server.
 */

// ---- JSON-RPC 2.0 base types ----

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  error: JsonRpcError;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// ---- Error codes ----

export const RpcErrorCode = {
  // JSON-RPC 2.0 standard
  PARSE_ERROR:      -32700,
  INVALID_REQUEST:  -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS:   -32602,
  // Business errors
  PAGE_NOT_FOUND:       -32001,
  BROWSER_DISCONNECTED: -32002,
  DAEMON_NOT_RUNNING:   -32003,
  PAGE_TIMEOUT:         -32004,
  NAVIGATION_FAILED:    -32005,
  EVAL_ERROR:           -32006,
  PROFILE_NOT_FOUND:    -32010,
} as const;

// Map RPC error codes to CLI exit codes
export const exitCodeMap: Record<number, number> = {
  [-32700]: 1,
  [-32600]: 1,
  [-32601]: 1,
  [-32602]: 1,
  [-32001]: 2,
  [-32002]: 3,
  [-32003]: 3,
  [-32004]: 4,
  [-32005]: 4,
  [-32006]: 4,
  [-32010]: 5,
};

// ---- Helpers ----

export function createRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: Date.now(),
    method,
    params,
  };
}

export function createSuccessResponse(id: number | string, result: unknown): JsonRpcSuccessResponse {
  return { jsonrpc: '2.0', id, result };
}

export function createErrorResponse(
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}

export function isErrorResponse(resp: JsonRpcResponse): resp is JsonRpcErrorResponse {
  return 'error' in resp;
}

export function serialize(msg: JsonRpcRequest | JsonRpcResponse): string {
  return JSON.stringify(msg) + '\n';
}

export function parse(raw: string): JsonRpcRequest | JsonRpcResponse {
  return JSON.parse(raw.trim());
}

// ---- Daemon config ----

export const DAEMON_HOST = '127.0.0.1';
export const DAEMON_PORT = parseInt(process.env.SUPER_BROWSER_PORT || '3456');
export const DAEMON_PID_DIR = (() => {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return `${home}/.super-browser`;
})();
export const DAEMON_PID_FILE = `${DAEMON_PID_DIR}/daemon.pid`;
export const DAEMON_PORT_FILE = `${DAEMON_PID_DIR}/daemon.port`;
