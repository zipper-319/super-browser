/**
 * Crawl Orchestrator — URL frontier management, depth/quota control,
 * page visit state machine, and the main crawl loop.
 */

import type { Page } from 'playwright-core';
import type { SeedConfig, CrawlState, CrawlPage, PageType, PageArtifact } from './types.js';
import { shouldFollow, normalizeUrl } from './seed-policy.js';
import { analyzePage } from './page-analyzer.js';
import { ensureConnected } from '../browser/connection.js';
import { createTab, closeTab } from '../browser/tab-manager.js';
import { startMonitor, stopMonitor, getMonitorState } from '../network/monitor.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint.js';

export interface CrawlCallbacks {
  onPageStart?: (url: string, depth: number) => void;
  onPageDone?: (artifact: PageArtifact) => void;
  onPageSkipped?: (url: string, reason: string) => void;
  onPageFailed?: (url: string, error: string) => void;
  onProgress?: (state: CrawlState) => void;
}

export interface CrawlRunOptions {
  /** Resume from checkpoint if available */
  resume?: boolean;
  /** Output directory for checkpoints */
  outputDir?: string;
  /** Save checkpoint every N pages */
  checkpointInterval?: number;
}

/**
 * Initialize a new crawl state.
 */
export function initCrawlState(config: SeedConfig): CrawlState {
  const state: CrawlState = {
    domain: config.domain,
    startedAt: new Date().toISOString(),
    pages: new Map(),
    queue: [],
    typeCounters: new Map(),
    totalVisited: 0,
    totalSkipped: 0,
    totalFailed: 0,
  };

  // Seed initial URLs
  for (const url of config.start_urls) {
    const normalized = normalizeUrl(url);
    if (!state.pages.has(normalized)) {
      state.pages.set(normalized, {
        url: normalized,
        depth: 0,
        status: 'pending',
      });
      state.queue.push(normalized);
    }
  }

  return state;
}

/**
 * Run the crawl loop. Returns all collected page artifacts.
 */
export async function runCrawl(
  config: SeedConfig,
  callbacks?: CrawlCallbacks,
  runOpts?: CrawlRunOptions,
): Promise<{ state: CrawlState; artifacts: PageArtifact[] }> {
  // Try to resume from checkpoint
  let state: CrawlState;
  if (runOpts?.resume && runOpts?.outputDir) {
    const restored = loadCheckpoint(runOpts.outputDir);
    if (restored) {
      state = restored;
      callbacks?.onProgress?.(state);
    } else {
      state = initCrawlState(config);
    }
  } else {
    state = initCrawlState(config);
  }

  const artifacts: PageArtifact[] = [];
  const checkpointInterval = runOpts?.checkpointInterval ?? 5;
  let pagesSinceCheckpoint = 0;

  // Ensure browser connection
  const conn = await ensureConnected();

  while (state.queue.length > 0) {
    // Check global page limit
    if (state.totalVisited >= config.max_pages) {
      break;
    }

    const url = state.queue.shift()!;
    const entry = state.pages.get(url)!;

    // Skip if already processed (can happen with normalization)
    if (entry.status !== 'pending') continue;

    // Depth check
    if (entry.depth > config.max_depth) {
      entry.status = 'skipped';
      entry.error = 'max depth exceeded';
      state.totalSkipped++;
      callbacks?.onPageSkipped?.(url, 'max depth exceeded');
      continue;
    }

    // Visit the page
    entry.status = 'visiting';
    callbacks?.onPageStart?.(url, entry.depth);

    let managed;
    try {
      // Create a tab for this page
      managed = await createTab(conn.context, 'about:blank');
      const page = managed.page;

      // Start network monitoring
      startMonitor(managed.id, page);

      // Navigate
      await page.goto(url, { waitUntil: 'load', timeout: 30_000 });

      // Wait for dynamic content
      await page.waitForTimeout(config.delay_ms);

      // Analyze the page
      const artifact = await analyzePage(page, managed.id, url, entry.depth, config);

      // Check page type quota
      const typeCount = state.typeCounters.get(artifact.pageType) || 0;
      if (typeCount >= config.page_type_quota) {
        entry.status = 'skipped';
        entry.pageType = artifact.pageType;
        entry.error = `page type quota reached for ${artifact.pageType}`;
        state.totalSkipped++;
        callbacks?.onPageSkipped?.(url, entry.error);
      } else {
        entry.status = 'analyzed';
        entry.pageType = artifact.pageType;
        state.typeCounters.set(artifact.pageType, typeCount + 1);
        state.totalVisited++;
        artifacts.push(artifact);
        callbacks?.onPageDone?.(artifact);

        // Enqueue discovered links
        enqueueLinks(state, artifact, config);
      }

      // Stop network monitoring
      stopMonitor(managed.id);

    } catch (err) {
      entry.status = 'failed';
      entry.error = err instanceof Error ? err.message : String(err);
      state.totalFailed++;
      callbacks?.onPageFailed?.(url, entry.error);
    } finally {
      // Clean up tab
      if (managed) {
        try { await closeTab(managed.id); } catch { /* best effort */ }
      }
    }

    // Periodic checkpoint
    pagesSinceCheckpoint++;
    if (runOpts?.outputDir && pagesSinceCheckpoint >= checkpointInterval) {
      saveCheckpoint(state, runOpts.outputDir);
      pagesSinceCheckpoint = 0;
    }

    callbacks?.onProgress?.(state);
  }

  // Final checkpoint
  if (runOpts?.outputDir) {
    saveCheckpoint(state, runOpts.outputDir);
  }

  return { state, artifacts };
}

/**
 * Add discovered links to the crawl queue.
 */
function enqueueLinks(state: CrawlState, artifact: PageArtifact, config: SeedConfig): void {
  for (const link of artifact.linkCandidates) {
    const normalized = normalizeUrl(link.url);

    // Skip if already known
    if (state.pages.has(normalized)) continue;

    // Check policy
    if (!shouldFollow(normalized, config)) continue;

    const depth = artifact.depth + 1;
    if (depth > config.max_depth) continue;

    state.pages.set(normalized, {
      url: normalized,
      depth,
      status: 'pending',
      parentUrl: artifact.url,
      pageType: link.inferredType,
    });
    state.queue.push(normalized);
  }
}

/**
 * Get a snapshot of current crawl progress.
 */
export function getCrawlProgress(state: CrawlState): {
  total: number;
  visited: number;
  pending: number;
  skipped: number;
  failed: number;
  typeBreakdown: Record<string, number>;
} {
  return {
    total: state.pages.size,
    visited: state.totalVisited,
    pending: state.queue.length,
    skipped: state.totalSkipped,
    failed: state.totalFailed,
    typeBreakdown: Object.fromEntries(state.typeCounters),
  };
}
