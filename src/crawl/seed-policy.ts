/**
 * Seed & Policy Layer — loads seed config, validates it, and provides
 * URL filtering/matching functions for the crawl orchestrator.
 */

import fs from 'node:fs';
import { SeedConfigSchema } from './schemas.js';
import type { SeedConfig } from './types.js';

/**
 * Load and validate a seed config from a JSON file.
 */
export function loadSeedConfig(filePath: string): SeedConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Seed config not found: ${filePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const result = SeedConfigSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid seed config: ${issues}`);
  }

  return result.data;
}

/**
 * Create a seed config programmatically with defaults.
 */
export function createSeedConfig(domain: string, overrides?: Partial<SeedConfig>): SeedConfig {
  const base: SeedConfig = {
    domain,
    start_urls: [`https://www.${domain}`, `https://${domain}`],
    follow_patterns: [`https://*.${domain}/*`, `https://${domain}/*`],
    ignore_patterns: ['*logout*', '*checkout*', '*cart*', '*payment*', '*delete*', '*remove*'],
    max_pages: 50,
    max_depth: 3,
    page_type_quota: 10,
    delay_ms: 1500,
    ...overrides,
  };
  return base;
}

/**
 * Check if a URL should be followed based on the seed policy.
 */
export function shouldFollow(url: string, config: SeedConfig): boolean {
  // Must match at least one follow pattern
  const matchesFollow = config.follow_patterns.some((p) => globMatch(url, p));
  if (!matchesFollow) return false;

  // Must not match any ignore pattern
  const matchesIgnore = config.ignore_patterns.some((p) => globMatch(url, p));
  if (matchesIgnore) return false;

  // Must be HTTP(S)
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;

  // Skip fragment-only links, javascript:, mailto:, etc.
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  } catch {
    return false;
  }

  return true;
}

/**
 * Normalize a URL for deduplication — strip fragment, trailing slash, sort params.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    // Sort search params for consistency
    u.searchParams.sort();
    // Remove trailing slash (unless root path)
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    u.pathname = path;
    return u.toString();
  } catch {
    return url;
  }
}

// ---- Glob matching (simple wildcard) ----

/**
 * Simple glob match supporting * (any chars) and ? (single char).
 */
function globMatch(str: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(str);
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}
