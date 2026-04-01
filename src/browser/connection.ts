/**
 * Playwright browser connection management.
 * Replaces v1's ~140 lines of manual WebSocket management with connectOverCDP().
 */

import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { discoverChromePort, getCdpEndpoint, type DiscoveryResult } from './port-discovery.js';

export interface ConnectionState {
  browser: Browser;
  context: BrowserContext;
  chromePort: number;
  status: 'connected' | 'disconnected' | 'reconnecting';
}

let state: ConnectionState | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Connect to user's local Chrome via CDP.
 * Reuses existing connection if available and healthy.
 */
export async function connect(): Promise<ConnectionState> {
  if (state?.status === 'connected') {
    return state;
  }

  // Discover Chrome port
  const discovery = await discoverChromePort();
  if (!discovery) {
    throw new Error(
      'Chrome debugging port not found. Ensure Chrome is running with remote debugging enabled:\n' +
      '  1. Open chrome://inspect/#remote-debugging\n' +
      '  2. Check "Allow remote debugging for this browser instance"\n' +
      '  Or set CHROME_DEBUG_PORT environment variable.',
    );
  }

  return connectWithDiscovery(discovery);
}

/**
 * Connect with a specific port (e.g., user-provided).
 */
export async function connectToPort(port: number): Promise<ConnectionState> {
  return connectWithDiscovery({ port, wsPath: null });
}

/**
 * Get current connection state.
 */
export function getConnection(): ConnectionState | null {
  return state;
}

/**
 * Disconnect and cleanup.
 */
export async function disconnect(): Promise<void> {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (state?.browser) {
    try {
      await state.browser.close();
    } catch { /* already closed */ }
  }
  state = null;
}

// ---- Internal ----

async function connectWithDiscovery(discovery: DiscoveryResult): Promise<ConnectionState> {
  const endpoint = await getCdpEndpoint(discovery.port, discovery.wsPath);

  console.log(`[connection] Connecting to Chrome via CDP at port ${discovery.port}...`);
  const browser = await chromium.connectOverCDP(endpoint);
  const contexts = browser.contexts();
  // Use the first existing context (user's browsing session) or create one
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();

  state = {
    browser,
    context,
    chromePort: discovery.port,
    status: 'connected',
  };

  // Listen for disconnection
  browser.on('disconnected', () => {
    console.log('[connection] Browser disconnected');
    if (state) {
      state.status = 'disconnected';
    }
  });

  console.log(`[connection] Connected to Chrome (port ${discovery.port})`);
  return state;
}

/**
 * Attempt to reconnect to Chrome.
 * Called when a request comes in while disconnected.
 */
export async function ensureConnected(): Promise<ConnectionState> {
  if (state?.status === 'connected') {
    // Verify connection is actually alive
    try {
      await state.browser.version();
      return state;
    } catch {
      state.status = 'disconnected';
    }
  }

  // Try reconnecting
  console.log('[connection] Attempting reconnection...');
  state = null;
  return connect();
}
