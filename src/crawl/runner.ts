/**
 * Crawl runner - wires all crawl layers together and provides the main entry point.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SeedConfig, PageArtifact, CrawlSummary } from './types.js';
import { loadSeedConfig, createSeedConfig } from './seed-policy.js';
import { runCrawl } from './orchestrator.js';
import { buildDrafts, writeDrafts, writePageArtifact, loadPageArtifacts } from './draft-builder.js';
import { analyzeCrawlWithLlm, writeLlmInsights } from './llm-analyzer.js';
import { clearCheckpoint, hasCheckpoint } from './checkpoint.js';
import type { LlmAnalyzerConfig } from './llm-types.js';

export interface RunOptions {
  seedPath?: string;
  domain?: string;
  outputDir: string;
  maxPages?: number;
  maxDepth?: number;
  withLlm?: boolean;
  llmConfig?: Partial<LlmAnalyzerConfig>;
  resume?: boolean;
  onLog?: (message: string) => void;
}

export interface RunResult {
  summary: CrawlSummary;
  outputDir: string;
}

/**
 * Execute a full crawl run.
 */
export async function runSiteCrawl(options: RunOptions): Promise<RunResult> {
  const log = options.onLog || console.log;

  let config: SeedConfig;
  if (options.seedPath) {
    config = loadSeedConfig(options.seedPath);
    log(`[crawl] Loaded seed config: ${options.seedPath}`);
  } else if (options.domain) {
    config = createSeedConfig(options.domain, {
      max_pages: options.maxPages,
      max_depth: options.maxDepth,
    });
    log(`[crawl] Auto-generated seed config for: ${options.domain}`);
  } else {
    throw new Error('Either seedPath or domain must be provided');
  }

  if (options.maxPages) config.max_pages = options.maxPages;
  if (options.maxDepth) config.max_depth = options.maxDepth;

  const outputDir = resolveRunOutputDir(options.outputDir, config.domain, options.resume === true);
  const existingArtifacts = options.resume ? loadPageArtifacts(outputDir) : [];

  log(`[crawl] ${options.resume ? 'Starting/resuming' : 'Starting'} crawl of ${config.domain}`);
  log(`[crawl] Max pages: ${config.max_pages}, Max depth: ${config.max_depth}`);
  log(`[crawl] Output: ${outputDir}`);

  if (options.resume) {
    log(hasCheckpoint(outputDir)
      ? '[crawl] Resume checkpoint detected, restoring prior state'
      : '[crawl] No checkpoint found, starting a fresh run in the selected output directory');
    if (existingArtifacts.length > 0) {
      log(`[crawl] Restored ${existingArtifacts.length} previously written page artifacts`);
    }
  }

  let artifactIndex = existingArtifacts.length;
  const { state, artifacts: currentArtifacts } = await runCrawl(config, {
    onPageStart(url, depth) {
      log(`[crawl] Visiting (depth=${depth}): ${url}`);
    },
    onPageDone(artifact) {
      artifactIndex++;
      log(`[crawl] OK ${artifact.pageType}: ${artifact.title} (${artifact.apiRequests.length} APIs, ${artifact.linkCandidates.length} links)`);
      writePageArtifact(artifact, outputDir, artifactIndex);
    },
    onPageSkipped(url, reason) {
      log(`[crawl] Skipped: ${url} (${reason})`);
    },
    onPageFailed(url, error) {
      log(`[crawl] Failed: ${url} (${error})`);
    },
  }, {
    resume: options.resume,
    outputDir,
    checkpointInterval: 5,
  });

  const artifacts = mergeArtifacts(existingArtifacts, currentArtifacts);
  log(`[crawl] Building drafts from ${artifacts.length} page artifacts...`);
  const output = buildDrafts(state, artifacts);

  writeDrafts(output, outputDir);
  log(`[crawl] Drafts written to: ${outputDir}`);

  if (options.withLlm) {
    log('[crawl] Running LLM analysis...');
    try {
      const llmConfig: LlmAnalyzerConfig = {
        enabled: true,
        ...options.llmConfig,
      };
      const insights = await analyzeCrawlWithLlm(artifacts, output.apiDrafts, config.domain, llmConfig);
      if (insights) {
        writeLlmInsights(insights, outputDir);
        log(`[crawl] LLM insights written (${insights.api_insights.length} API insights, ${insights.open_questions.length} open questions)`);
      } else {
        log('[crawl] LLM analysis skipped (no API key, package, or feature disabled)');
      }
    } catch (error) {
      log(`[crawl] LLM analysis failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  log(`[crawl] Complete: ${state.totalVisited} visited, ${state.totalSkipped} skipped, ${state.totalFailed} failed`);
  log(`[crawl] API endpoints discovered: ${output.apiDrafts.length}`);
  log(`[crawl] Candidate selectors: ${Object.keys(output.siteDraft.candidate_selectors).length}`);

  clearCheckpoint(outputDir);
  output.summary.outputDir = outputDir;
  return { summary: output.summary, outputDir };
}

function resolveRunOutputDir(baseOutputDir: string, domain: string, resume: boolean): string {
  if (resume) {
    const directCandidates = [baseOutputDir, path.join(baseOutputDir, domain)];
    for (const candidate of directCandidates) {
      if (hasCheckpoint(candidate)) {
        return candidate;
      }
    }

    const latestCheckpointDir = findLatestCheckpointDir(path.join(baseOutputDir, domain));
    if (latestCheckpointDir) {
      return latestCheckpointDir;
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  return path.join(baseOutputDir, domain, timestamp);
}

function findLatestCheckpointDir(domainDir: string): string | null {
  if (!fs.existsSync(domainDir)) {
    return null;
  }

  const candidates = fs.readdirSync(domainDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(domainDir, entry.name))
    .filter((candidate) => hasCheckpoint(candidate))
    .map((candidate) => ({ dir: candidate, modifiedAt: fs.statSync(candidate).mtimeMs }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);

  return candidates[0]?.dir ?? null;
}

function mergeArtifacts(existingArtifacts: PageArtifact[], currentArtifacts: PageArtifact[]): PageArtifact[] {
  const merged = new Map<string, PageArtifact>();

  for (const artifact of existingArtifacts) {
    merged.set(artifact.url, artifact);
  }
  for (const artifact of currentArtifacts) {
    merged.set(artifact.url, artifact);
  }

  return [...merged.values()];
}
