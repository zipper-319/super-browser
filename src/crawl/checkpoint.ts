/**
 * Crawl checkpoint — serializes/deserializes CrawlState for resume support.
 * Uses JSON files (no SQLite dependency in first version).
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CrawlState, CrawlPage, PageType } from './types.js';

const CHECKPOINT_FILE = 'crawl-checkpoint.json';

/** Serializable form of CrawlState (Map → Record) */
interface SerializedCrawlState {
  domain: string;
  startedAt: string;
  pages: Record<string, CrawlPage>;
  queue: string[];
  typeCounters: Record<string, number>;
  totalVisited: number;
  totalSkipped: number;
  totalFailed: number;
}

/**
 * Save a checkpoint of the current crawl state.
 */
export function saveCheckpoint(state: CrawlState, outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, CHECKPOINT_FILE);

  const serialized: SerializedCrawlState = {
    domain: state.domain,
    startedAt: state.startedAt,
    pages: Object.fromEntries(state.pages),
    queue: state.queue,
    typeCounters: Object.fromEntries(state.typeCounters),
    totalVisited: state.totalVisited,
    totalSkipped: state.totalSkipped,
    totalFailed: state.totalFailed,
  };

  fs.writeFileSync(filePath, JSON.stringify(serialized, null, 2) + '\n', 'utf-8');
}

/**
 * Load a checkpoint and restore CrawlState.
 * Returns null if no checkpoint exists.
 */
export function loadCheckpoint(outputDir: string): CrawlState | null {
  const filePath = path.join(outputDir, CHECKPOINT_FILE);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw: SerializedCrawlState = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  const state: CrawlState = {
    domain: raw.domain,
    startedAt: raw.startedAt,
    pages: new Map(Object.entries(raw.pages)),
    queue: raw.queue,
    typeCounters: new Map(Object.entries(raw.typeCounters)) as Map<PageType, number>,
    totalVisited: raw.totalVisited,
    totalSkipped: raw.totalSkipped,
    totalFailed: raw.totalFailed,
  };

  // Re-queue any pages that were 'visiting' when checkpoint was saved (interrupted)
  for (const [url, page] of state.pages) {
    if (page.status === 'visiting') {
      page.status = 'pending';
      if (!state.queue.includes(url)) {
        state.queue.unshift(url); // priority re-queue
      }
    }
  }

  return state;
}

/**
 * Check if a checkpoint exists for the given output directory.
 */
export function hasCheckpoint(outputDir: string): boolean {
  return fs.existsSync(path.join(outputDir, CHECKPOINT_FILE));
}

/**
 * Remove checkpoint file after successful completion.
 */
export function clearCheckpoint(outputDir: string): void {
  const filePath = path.join(outputDir, CHECKPOINT_FILE);
  try {
    fs.unlinkSync(filePath);
  } catch { /* file may not exist */ }
}
