/**
 * Daemon application layer.
 * Owns protocol registration, lifecycle wiring, and compatibility adapters.
 */

import fs from 'node:fs';
import { RpcServer } from '../rpc/server.js';
import {
  DAEMON_PORT,
  DAEMON_PID_DIR,
  DAEMON_PID_FILE,
  DAEMON_PORT_FILE,
} from '../rpc/protocol.js';
import { connect } from '../browser/connection.js';
import { createHttpServer } from '../server/router.js';
import { initRuntime } from './runtime.js';
import * as handlers from '../server/handlers.js';

export function registerDaemonMethods(rpc: RpcServer): void {
  rpc.method('daemon.status', handlers.handleDaemonStatus);
  rpc.method('daemon.stop', async () => {
    const result = await handlers.handleDaemonStop();
    setTimeout(() => {
      cleanupPidFiles();
      process.exit(0);
    }, 200);
    return result;
  });

  rpc.method('new', handlers.handleNew);
  rpc.method('close', handlers.handleClose);
  rpc.method('navigate', handlers.handleNavigate);
  rpc.method('back', handlers.handleBack);
  rpc.method('eval', handlers.handleEval);
  rpc.method('click', handlers.handleClick);
  rpc.method('click-real', handlers.handleClickReal);
  rpc.method('scroll', handlers.handleScroll);
  rpc.method('screenshot', handlers.handleScreenshot);
  rpc.method('upload', handlers.handleUpload);
  rpc.method('fill', handlers.handleFill);
  rpc.method('press', handlers.handlePress);
  rpc.method('select', handlers.handleSelect);
  rpc.method('info', handlers.handleInfo);
  rpc.method('pages', handlers.handlePages);

  rpc.method('page-state', handlers.handlePageState);
  rpc.method('site-profile', handlers.handleSiteProfile);
  rpc.method('site-profiles', handlers.handleSiteProfiles);

  rpc.method('network.start', handlers.handleNetworkStart);
  rpc.method('network.requests', handlers.handleNetworkRequests);
  rpc.method('network.stop', handlers.handleNetworkStop);
  rpc.method('network.patterns', handlers.handleNetworkPatterns);

  rpc.method('decision.candidates', handlers.handleDecisionCandidates);
  rpc.method('decision.propose', handlers.handleDecisionPropose);
  rpc.method('decision.context', handlers.handleDecisionContext);
  rpc.method('decision.render', handlers.handleDecisionRender);
  rpc.method('decision.execute', handlers.handleDecisionExecute);
  rpc.method('decision.verify', handlers.handleDecisionVerify);

  rpc.method('crawl', handlers.handleCrawl);
  rpc.method('crawl.batch', handlers.handleBatchCrawl);

  rpc.method('state-diff', handlers.handleStateDiff);

  rpc.method('experience.start', handlers.handleExperienceStart);
  rpc.method('experience.record', handlers.handleExperienceRecord);
  rpc.method('experience.complete', handlers.handleExperienceComplete);
  rpc.method('experience.flush', handlers.handleExperienceFlush);
  rpc.method('experience.status', handlers.handleExperienceStatus);
}

export async function runDaemon(): Promise<void> {
  initRuntime();

  const rpc = new RpcServer();
  registerDaemonMethods(rpc);

  const httpServer = createHttpServer();
  rpc.setHttpServer(httpServer);

  try {
    await connect();
    console.log('[daemon] Browser connection established');
  } catch (error) {
    console.error(`[daemon] Warning: could not connect to Chrome at startup: ${error instanceof Error ? error.message : error}`);
    console.error('[daemon] Will attempt reconnection on first request');
  }

  writePidFiles(DAEMON_PORT);
  await rpc.start(DAEMON_PORT);
  console.log(`[daemon] Ready (pid=${process.pid}, port=${DAEMON_PORT})`);

  const shutdown = async () => {
    console.log('\n[daemon] Shutting down...');
    try {
      await handlers.handleDaemonStop();
    } catch {
      // Best effort during shutdown.
    }
    rpc.stop();
    cleanupPidFiles();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function writePidFiles(port: number): void {
  try {
    fs.mkdirSync(DAEMON_PID_DIR, { recursive: true });
    fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));
    fs.writeFileSync(DAEMON_PORT_FILE, String(port));
  } catch (error) {
    console.warn(`[daemon] Could not write PID file: ${error}`);
  }
}

function cleanupPidFiles(): void {
  try {
    fs.unlinkSync(DAEMON_PID_FILE);
    fs.unlinkSync(DAEMON_PORT_FILE);
  } catch {
    // Files may already be gone.
  }
}
