/**
 * API pattern aggregator — clusters captured requests by URL pattern,
 * analyzes response structure, and generates draft api_profiles.
 */

import type { CapturedRequest, DiscoveredApiPattern, DraftApiProfile } from './types.js';
import { businessScore } from './classifier.js';

/**
 * Aggregate captured business API requests into URL patterns.
 * Normalizes dynamic path segments (IDs, hashes) into placeholders.
 */
export function aggregatePatterns(requests: CapturedRequest[]): DiscoveredApiPattern[] {
  // Filter to business APIs only
  const bizRequests = requests.filter((r) => r.isBusinessApi && r.status >= 200 && r.status < 400);
  if (bizRequests.length === 0) return [];

  // Group by normalized URL pattern + method
  const groups = new Map<string, CapturedRequest[]>();
  for (const req of bizRequests) {
    const pattern = normalizeUrl(req.url);
    const key = `${req.method} ${pattern}`;
    const group = groups.get(key) || [];
    group.push(req);
    groups.set(key, group);
  }

  // Build patterns
  const patterns: DiscoveredApiPattern[] = [];
  for (const [key, reqs] of groups) {
    const [method, ...patternParts] = key.split(' ');
    const urlPattern = patternParts.join(' ');

    const avgBodySize = Math.round(
      reqs.reduce((sum, r) => sum + r.bodySize, 0) / reqs.length,
    );

    // Analyze response structure from the largest response
    const bestReq = reqs.sort((a, b) => b.bodySize - a.bodySize)[0];
    const sampleKeys = bestReq.responseBody
      ? extractTopLevelKeys(bestReq.responseBody)
      : [];

    const pattern: DiscoveredApiPattern = {
      urlPattern,
      method,
      count: reqs.length,
      sampleResponseKeys: sampleKeys,
      avgBodySize,
    };

    // Generate draft profile if we have enough info
    const draft = generateDraftProfile(pattern, bestReq);
    if (draft) {
      pattern.draftProfile = draft;
    }

    patterns.push(pattern);
  }

  // Sort by relevance (business score of best request in group)
  patterns.sort((a, b) => {
    const scoreA = businessScore({ url: a.urlPattern, method: a.method, bodySize: a.avgBodySize, status: 200 });
    const scoreB = businessScore({ url: b.urlPattern, method: b.method, bodySize: b.avgBodySize, status: 200 });
    return scoreB - scoreA;
  });

  return patterns;
}

// ---- URL normalization ----

/**
 * Normalize a URL by replacing dynamic segments with placeholders.
 * Examples:
 *   /api/products/12345 → /api/products/{id}
 *   /api/v2/items?page=3&size=20 → /api/v2/items
 *   /user/abc123def456 → /user/{id}
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Normalize path segments
    const segments = u.pathname.split('/').map((seg) => {
      if (!seg) return seg;
      // Pure numeric → {id}
      if (/^\d+$/.test(seg)) return '{id}';
      // Long hex/alphanum string (hash, UUID, token) → {id}
      if (/^[0-9a-f]{8,}$/i.test(seg)) return '{id}';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return '{id}'; // UUID
      // Mixed alphanum longer than 16 chars → likely an ID
      if (seg.length > 16 && /^[a-zA-Z0-9_-]+$/.test(seg)) return '{id}';
      return seg;
    });

    return `${u.origin}${segments.join('/')}`;
  } catch {
    return url;
  }
}

// ---- Response structure analysis ----

/**
 * Extract top-level keys from a JSON response body.
 */
function extractTopLevelKeys(body: string): string[] {
  try {
    const data = JSON.parse(body);
    if (typeof data !== 'object' || data === null) return [];
    return Object.keys(data).slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Attempt to find the data array path in a JSON response.
 * Common patterns: data.items, data.list, result.data, data.records, etc.
 */
function findDataArrayPath(body: string): { path: string; fields: string[] } | null {
  try {
    const data = JSON.parse(body);
    if (!data || typeof data !== 'object') return null;

    // Common wrapper paths to check
    const candidates = [
      { path: 'data', value: data.data },
      { path: 'result', value: data.result },
      { path: 'results', value: data.results },
      { path: 'items', value: data.items },
      { path: 'list', value: data.list },
      { path: 'records', value: data.records },
      { path: 'rows', value: data.rows },
      { path: 'content', value: data.content },
    ];

    for (const c of candidates) {
      if (Array.isArray(c.value) && c.value.length > 0) {
        const item = c.value[0];
        if (typeof item === 'object' && item !== null) {
          return { path: c.path, fields: Object.keys(item).slice(0, 15) };
        }
      }
      // Nested: data.items, data.list, etc.
      if (c.value && typeof c.value === 'object' && !Array.isArray(c.value)) {
        for (const subKey of ['items', 'list', 'records', 'rows', 'data', 'content', 'result']) {
          const nested = (c.value as Record<string, unknown>)[subKey];
          if (Array.isArray(nested) && nested.length > 0) {
            const item = nested[0];
            if (typeof item === 'object' && item !== null) {
              return { path: `${c.path}.${subKey}`, fields: Object.keys(item).slice(0, 15) };
            }
          }
        }
      }
    }

    // Top-level array
    if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object') {
      return { path: '', fields: Object.keys(data[0]).slice(0, 15) };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Detect pagination parameters from URL and response.
 */
function detectPagination(url: string, body: string): DraftApiProfile['response'] extends { pagination: infer P } ? P : undefined {
  try {
    const u = new URL(url);
    const params = u.searchParams;

    // Page-based: page=N
    if (params.has('page') || params.has('pageNum') || params.has('pageNo')) {
      return { type: 'page', param: params.has('page') ? 'page' : params.has('pageNum') ? 'pageNum' : 'pageNo' } as any;
    }

    // Offset-based: offset=N
    if (params.has('offset') || params.has('start')) {
      return { type: 'offset', param: params.has('offset') ? 'offset' : 'start' } as any;
    }

    // Cursor-based: cursor=xxx, after=xxx
    if (params.has('cursor') || params.has('after') || params.has('nextToken')) {
      return { type: 'cursor', param: params.has('cursor') ? 'cursor' : params.has('after') ? 'after' : 'nextToken' } as any;
    }

    // Check POST body for pagination params
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object') {
      const data = parsed as Record<string, unknown>;
      if (typeof data.page === 'number' || typeof data.pageNum === 'number') {
        return { type: 'page', param: 'page' in data ? 'page' : 'pageNum' } as any;
      }
    }
  } catch { /* not parseable */ }
  return undefined;
}

// ---- Draft profile generation ----

function generateDraftProfile(
  pattern: DiscoveredApiPattern,
  sampleReq: CapturedRequest,
): DraftApiProfile | null {
  if (!sampleReq.responseBody) return null;

  const dataInfo = findDataArrayPath(sampleReq.responseBody);
  if (!dataInfo && pattern.avgBodySize < 200) return null; // Too small, probably not data API

  // Extract meaningful name from URL path
  const pathSegments = pattern.urlPattern.replace(/https?:\/\/[^/]+/, '').split('/').filter(Boolean);
  const lastSegment = pathSegments[pathSegments.length - 1] || 'api';
  const name = lastSegment.replace(/\{id\}/, '').replace(/[^a-zA-Z0-9]/g, '_') || 'api_endpoint';

  const pagination = detectPagination(sampleReq.url, sampleReq.responseBody);

  const draft: DraftApiProfile = {
    name,
    purpose: `API discovered at ${pattern.urlPattern}`,
    url_pattern: pattern.urlPattern,
    method: pattern.method,
    trigger: `Triggered during page interaction (observed ${pattern.count} time${pattern.count > 1 ? 's' : ''})`,
    auth: sampleReq.url.includes('token') || sampleReq.url.includes('sign') ? 'token' : 'cookie',
    confidence: pattern.count >= 3 ? 'high' : pattern.count >= 2 ? 'medium' : 'low',
  };

  if (dataInfo) {
    draft.response = {
      data_path: dataInfo.path,
      item_fields: dataInfo.fields,
    };
    if (pagination) {
      draft.response.pagination = pagination;
    }
  }

  return draft;
}
