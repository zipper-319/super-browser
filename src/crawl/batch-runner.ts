/**
 * Batch crawl runner — sequential multi-site crawl with shared browser connection.
 */

import type { CrawlSummary } from './types.js';
import { runSiteCrawl, type RunOptions } from './runner.js';

export interface BatchConfig {
  /** List of domains to crawl */
  domains?: string[];
  /** List of seed config paths */
  seedPaths?: string[];
  /** Shared output directory */
  outputDir: string;
  /** Max pages per site */
  maxPages?: number;
  /** Max depth per site */
  maxDepth?: number;
  /** Enable LLM analysis */
  withLlm?: boolean;
  /** Progress callback */
  onLog?: (message: string) => void;
}

export interface BatchResult {
  results: Array<{
    domain: string;
    success: boolean;
    summary?: CrawlSummary;
    error?: string;
  }>;
  totalDomains: number;
  successful: number;
  failed: number;
}

/**
 * Run crawl on multiple sites sequentially.
 * Shares the browser connection across all sites.
 */
export async function runBatchCrawl(config: BatchConfig): Promise<BatchResult> {
  const log = config.onLog || console.log;

  // Build job list from domains + seed paths
  const jobs: Array<{ domain?: string; seedPath?: string }> = [];

  if (config.domains) {
    for (const domain of config.domains) {
      jobs.push({ domain });
    }
  }
  if (config.seedPaths) {
    for (const seedPath of config.seedPaths) {
      jobs.push({ seedPath });
    }
  }

  if (jobs.length === 0) {
    throw new Error('No domains or seed paths provided');
  }

  log(`[batch] Starting batch crawl: ${jobs.length} sites`);

  const results: BatchResult['results'] = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const label = job.domain || job.seedPath || `job-${i}`;
    log(`\n[batch] ── Site ${i + 1}/${jobs.length}: ${label} ──`);

    try {
      const runOpts: RunOptions = {
        domain: job.domain,
        seedPath: job.seedPath,
        outputDir: config.outputDir,
        maxPages: config.maxPages,
        maxDepth: config.maxDepth,
        withLlm: config.withLlm,
        onLog: log,
      };

      const result = await runSiteCrawl(runOpts);

      results.push({
        domain: result.summary.domain,
        success: true,
        summary: result.summary,
      });

      log(`[batch] ✓ ${label}: ${result.summary.totalVisited} pages, ${result.summary.apiEndpoints} APIs`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({
        domain: label,
        success: false,
        error,
      });
      log(`[batch] ✗ ${label}: ${error}`);
    }
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  log(`\n[batch] Complete: ${successful} succeeded, ${failed} failed out of ${jobs.length} sites`);

  return {
    results,
    totalDomains: jobs.length,
    successful,
    failed,
  };
}
