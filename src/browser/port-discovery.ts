/**
 * Chrome debugging port auto-discovery.
 * Migrated from v1 cdp-proxy.mjs discoverChromePort() / checkPort() / checkChromePort().
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';

export interface DiscoveryResult {
  port: number;
  wsPath: string | null;
  webSocketDebuggerUrl?: string;
}

export interface ChromeVersionInfo {
  Browser?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

/**
 * Auto-discover Chrome debugging port.
 * Strategy: DevToolsActivePort file → env variable → default port 9222.
 */
export async function discoverChromePort(): Promise<DiscoveryResult | null> {
  // 1. Try DevToolsActivePort file
  const devtoolsPaths = getDevToolsActivePortPaths();
  for (const p of devtoolsPaths) {
    try {
      const content = fs.readFileSync(p, 'utf-8').trim();
      const lines = content.split('\n');
      const port = parseInt(lines[0]);
      if (port > 0 && port < 65536 && await checkPortOpen(port)) {
        const wsPath = lines[1] || null;
        console.log(`[port-discovery] Found port from DevToolsActivePort: ${port}${wsPath ? ' (with wsPath)' : ''}`);
        return { port, wsPath };
      }
    } catch { /* file doesn't exist, continue */ }
  }

  // 2. Environment variable
  const envPort = parseInt(process.env.CHROME_DEBUG_PORT || '0');
  if (envPort > 0 && envPort < 65536 && await checkPortOpen(envPort)) {
    console.log(`[port-discovery] Found port from CHROME_DEBUG_PORT: ${envPort}`);
    return { port: envPort, wsPath: null };
  }

  // 3. Default port 9222
  if (await checkPortOpen(9222)) {
    const info = await getChromeVersionInfo(9222);
    if (info) {
      console.log(`[port-discovery] Using default port: 9222`);
      return { port: 9222, wsPath: null, webSocketDebuggerUrl: info.webSocketDebuggerUrl };
    }
  }

  return null;
}

/**
 * Build the CDP endpoint URL for Playwright connectOverCDP().
 */
export async function getCdpEndpoint(port: number, wsPath: string | null): Promise<string> {
  if (wsPath) return `ws://127.0.0.1:${port}${wsPath}`;

  // Try /json/version to get the full WebSocket URL
  const info = await getChromeVersionInfo(port);
  if (info?.webSocketDebuggerUrl) {
    return info.webSocketDebuggerUrl;
  }

  // Fallback: construct HTTP endpoint for Playwright
  return `http://127.0.0.1:${port}`;
}

/**
 * TCP probe — check if a port is listening.
 * Uses plain TCP to avoid triggering Chrome's CDP authorization dialog.
 */
export function checkPortOpen(port: number, host = '127.0.0.1', timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeout);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

/**
 * HTTP check — verify port is a Chrome debugging port via /json/version.
 */
export function getChromeVersionInfo(port: number): Promise<ChromeVersionInfo | null> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          if (info.Browser || info.webSocketDebuggerUrl) {
            resolve(info);
          } else {
            resolve(null);
          }
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ---- Internal helpers ----

function getDevToolsActivePortPaths(): string[] {
  const paths: string[] = [];
  const platform = os.platform();
  const home = os.homedir();

  if (platform === 'darwin') {
    paths.push(
      path.join(home, 'Library/Application Support/Google/Chrome/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Google/Chrome Canary/DevToolsActivePort'),
      path.join(home, 'Library/Application Support/Chromium/DevToolsActivePort'),
    );
  } else if (platform === 'linux') {
    paths.push(
      path.join(home, '.config/google-chrome/DevToolsActivePort'),
      path.join(home, '.config/chromium/DevToolsActivePort'),
    );
  } else if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    paths.push(
      path.join(localAppData, 'Google/Chrome/User Data/DevToolsActivePort'),
      path.join(localAppData, 'Chromium/User Data/DevToolsActivePort'),
    );
  }

  return paths;
}
