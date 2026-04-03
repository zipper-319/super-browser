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

export interface DevToolsActivePortProbe {
  path: string;
  exists: boolean;
  port: number | null;
  wsPath: string | null;
  reachable: boolean;
  parseError?: string;
}

export type ChromeConnectionIssue =
  | 'ok'
  | 'cdp-unavailable'
  | 'port-open-not-chrome'
  | 'stale-devtools-port-file';

export interface ChromeConnectionDiagnosis {
  platform: NodeJS.Platform;
  envPort: number | null;
  envPortReachable: boolean;
  defaultPortReachable: boolean;
  defaultPortHasChrome: boolean;
  suggestedPort: number;
  devtoolsActivePort: DevToolsActivePortProbe[];
  discovered: DiscoveryResult | null;
  issue: ChromeConnectionIssue;
  recommendedAction: string;
  suggestedCommands: string[];
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

export async function diagnoseChromeConnection(): Promise<ChromeConnectionDiagnosis> {
  const platform = os.platform();
  const probes = await Promise.all(getDevToolsActivePortPaths().map(probeDevToolsActivePortPath));

  let discovered: DiscoveryResult | null = null;
  const fromProbe = probes.find((probe) => probe.port && probe.reachable);
  if (fromProbe?.port) {
    discovered = { port: fromProbe.port, wsPath: fromProbe.wsPath };
  }

  const envPort = parseCandidatePort(process.env.CHROME_DEBUG_PORT);
  const envPortReachable = envPort != null ? await checkPortOpen(envPort) : false;
  if (!discovered && envPort != null && envPortReachable) {
    discovered = { port: envPort, wsPath: null };
  }

  const defaultPortReachable = await checkPortOpen(9222);
  const defaultPortHasChrome = defaultPortReachable ? !!(await getChromeVersionInfo(9222)) : false;
  if (!discovered && defaultPortHasChrome) {
    discovered = { port: 9222, wsPath: null };
  }

  const hasStaleProbe = probes.some((probe) => probe.exists && probe.port != null && !probe.reachable);
  const reachableCandidatePort = envPortReachable || defaultPortReachable || probes.some((probe) => probe.reachable);

  let issue: ChromeConnectionIssue;
  if (discovered) {
    issue = 'ok';
  } else if (hasStaleProbe) {
    issue = 'stale-devtools-port-file';
  } else if (reachableCandidatePort) {
    issue = 'port-open-not-chrome';
  } else {
    issue = 'cdp-unavailable';
  }

  return {
    platform,
    envPort,
    envPortReachable,
    defaultPortReachable,
    defaultPortHasChrome,
    suggestedPort: envPort ?? 9222,
    devtoolsActivePort: probes,
    discovered,
    issue,
    recommendedAction: recommendedActionForIssue(issue, platform, envPort ?? 9222),
    suggestedCommands: suggestedCommandsForIssue(issue, platform, envPort ?? 9222),
  };
}

export function formatChromeConnectionError(diagnosis: ChromeConnectionDiagnosis): string {
  const commands = diagnosis.suggestedCommands.length > 0
    ? `\nSuggested commands:\n  ${diagnosis.suggestedCommands.join('\n  ')}`
    : '';

  switch (diagnosis.issue) {
    case 'ok':
      return 'Chrome is already reachable via CDP.';
    case 'stale-devtools-port-file':
      return `Chrome debugging port was not reachable from the cached DevToolsActivePort file. ${diagnosis.recommendedAction}${commands}`;
    case 'port-open-not-chrome':
      return `A candidate debugging port is reachable, but it does not look like a Chrome DevTools endpoint. ${diagnosis.recommendedAction}${commands}`;
    case 'cdp-unavailable':
    default:
      return `Chrome debugging port not found. ${diagnosis.recommendedAction}${commands}`;
  }
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

async function probeDevToolsActivePortPath(pathname: string): Promise<DevToolsActivePortProbe> {
  try {
    const content = fs.readFileSync(pathname, 'utf-8').trim();
    const lines = content.split('\n');
    const port = parseCandidatePort(lines[0]);
    const wsPath = lines[1] || null;
    const reachable = port != null ? await checkPortOpen(port) : false;

    return {
      path: pathname,
      exists: true,
      port,
      wsPath,
      reachable,
      ...(port == null ? { parseError: 'Invalid port value' } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path: pathname,
        exists: false,
        port: null,
        wsPath: null,
        reachable: false,
      };
    }

    return {
      path: pathname,
      exists: true,
      port: null,
      wsPath: null,
      reachable: false,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseCandidatePort(value: string | undefined): number | null {
  const port = parseInt(value || '0', 10);
  return port > 0 && port < 65536 ? port : null;
}

function recommendedActionForIssue(
  issue: ChromeConnectionIssue,
  platform: NodeJS.Platform,
  port: number,
): string {
  const isWindows = platform === 'win32';

  switch (issue) {
    case 'ok':
      return 'No action needed.';
    case 'stale-devtools-port-file':
      return isWindows
        ? `Close Chrome fully, relaunch it with --remote-debugging-port=${port}, then retry the command.`
        : `Relaunch Chrome with --remote-debugging-port=${port}, then retry the command.`;
    case 'port-open-not-chrome':
      return `Verify that port ${port} is serving Chrome DevTools by checking http://127.0.0.1:${port}/json/version.`;
    case 'cdp-unavailable':
    default:
      return isWindows
        ? `Start Chrome with --remote-debugging-port=${port}. If Chrome is already open, fully close it first so the flag is applied.`
        : `Start Chrome with --remote-debugging-port=${port}, then retry the command.`;
  }
}

function suggestedCommandsForIssue(
  issue: ChromeConnectionIssue,
  platform: NodeJS.Platform,
  port: number,
): string[] {
  const isWindows = platform === 'win32';

  if (issue === 'ok') return [];

  if (isWindows) {
    const commands = [
      `Start-Process chrome.exe -ArgumentList '--remote-debugging-port=${port}'`,
      `Invoke-WebRequest http://127.0.0.1:${port}/json/version | Select-Object -Expand Content`,
      'super-browser daemon status',
    ];

    if (issue === 'stale-devtools-port-file' || issue === 'cdp-unavailable') {
      commands.unshift('taskkill /IM chrome.exe /F');
    }

    return commands;
  }

  return [
    `google-chrome --remote-debugging-port=${port}`,
    `curl http://127.0.0.1:${port}/json/version`,
    'super-browser daemon status',
  ];
}
