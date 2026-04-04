import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnoseChromeConnection } from './port-discovery.js';

test('diagnoseChromeConnection marks env port as not chrome when only TCP is reachable', async () => {
  process.env.CHROME_DEBUG_PORT = '3333';

  const diagnosis = await diagnoseChromeConnection({
    platform: 'linux',
    probePaths: [],
    checkPortOpen: async (port) => port === 3333,
    getChromeVersionInfo: async () => null,
  });

  assert.equal(diagnosis.envPort, 3333);
  assert.equal(diagnosis.envPortReachable, true);
  assert.equal(diagnosis.envPortHasChrome, false);
  assert.equal(diagnosis.issue, 'port-open-not-chrome');
  assert.equal(diagnosis.discovered, null);
});

test('diagnoseChromeConnection accepts env port when /json/version confirms chrome', async () => {
  process.env.CHROME_DEBUG_PORT = '3333';

  const diagnosis = await diagnoseChromeConnection({
    platform: 'linux',
    probePaths: [],
    checkPortOpen: async (port) => port === 3333,
    getChromeVersionInfo: async (port) => (
      port === 3333
        ? { Browser: 'Chrome/123.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:3333/devtools/browser/test' }
        : null
    ),
  });

  assert.equal(diagnosis.envPortHasChrome, true);
  assert.equal(diagnosis.issue, 'ok');
  assert.deepEqual(diagnosis.discovered, { port: 3333, wsPath: null });
});

test('diagnoseChromeConnection suggests a runnable macOS relaunch command', async () => {
  delete process.env.CHROME_DEBUG_PORT;

  const diagnosis = await diagnoseChromeConnection({
    platform: 'darwin',
    probePaths: [],
    checkPortOpen: async () => false,
    getChromeVersionInfo: async () => null,
  });

  assert.equal(diagnosis.issue, 'cdp-unavailable');
  assert.match(diagnosis.recommendedAction, /app launcher command below/i);
  assert.equal(
    diagnosis.suggestedCommands[0],
    'open -a "Google Chrome" --args --remote-debugging-port=9222',
  );
});

test('diagnoseChromeConnection keeps linux relaunch command unchanged', async () => {
  delete process.env.CHROME_DEBUG_PORT;

  const diagnosis = await diagnoseChromeConnection({
    platform: 'linux',
    probePaths: [],
    checkPortOpen: async () => false,
    getChromeVersionInfo: async () => null,
  });

  assert.equal(diagnosis.issue, 'cdp-unavailable');
  assert.equal(
    diagnosis.suggestedCommands[0],
    'google-chrome --remote-debugging-port=9222',
  );
});

test('diagnoseChromeConnection marks version endpoint reachable for probe-discovered non-default chrome port', async () => {
  delete process.env.CHROME_DEBUG_PORT;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-port-discovery-'));
  const probePath = path.join(tempDir, 'DevToolsActivePort');
  fs.writeFileSync(probePath, '4555\n/devtools/browser/test\n');

  try {
    const diagnosis = await diagnoseChromeConnection({
      platform: 'linux',
      probePaths: [probePath],
      checkPortOpen: async (port) => port === 4555,
      getChromeVersionInfo: async (port) => (
        port === 4555
          ? { Browser: 'Chrome/123.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:4555/devtools/browser/test' }
          : null
      ),
    });

    assert.equal(diagnosis.discovered?.port, 4555);
    assert.equal(diagnosis.discoveredPortHasChrome, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
