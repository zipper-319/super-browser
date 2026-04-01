/**
 * Draft Builder Layer - aggregates page artifacts into site-level experience drafts.
 * Outputs: SiteDraft, PageType summaries, API drafts, CrawlSummary.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  PageArtifact,
  PageType,
  PageTypeSummary,
  SiteDraft,
  ApiProfileDraft,
  CrawlSummary,
  CrawlState,
  ApiRequestSummary,
} from './types.js';

export interface DraftOutput {
  summary: CrawlSummary;
  siteDraft: SiteDraft;
  pageTypes: PageTypeSummary[];
  apiDrafts: ApiProfileDraft[];
}

/**
 * Build all draft outputs from crawl artifacts.
 */
export function buildDrafts(state: CrawlState, artifacts: PageArtifact[]): DraftOutput {
  const pageTypes = buildPageTypeSummaries(artifacts);
  const apiDrafts = buildApiDrafts(artifacts);
  const siteDraft = buildSiteDraft(state.domain, artifacts, apiDrafts);

  const summary: CrawlSummary = {
    domain: state.domain,
    startedAt: state.startedAt,
    completedAt: new Date().toISOString(),
    totalPages: state.pages.size,
    totalVisited: state.totalVisited,
    totalSkipped: state.totalSkipped,
    totalFailed: state.totalFailed,
    pageTypes: Object.fromEntries(state.typeCounters) as Record<PageType, number>,
    apiEndpoints: apiDrafts.length,
    outputDir: '',
  };

  return { summary, siteDraft, pageTypes, apiDrafts };
}

/**
 * Write all drafts to the output directory.
 */
export function writeDrafts(output: DraftOutput, outputDir: string): void {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.join(outputDir, 'pages'), { recursive: true });

  output.summary.outputDir = outputDir;
  writeJson(path.join(outputDir, 'crawl-summary.json'), output.summary);
  writeJson(path.join(outputDir, 'site-draft.json'), output.siteDraft);
  writeJson(path.join(outputDir, 'page-types.json'), output.pageTypes);
  writeJson(path.join(outputDir, 'api-draft.json'), output.apiDrafts);
}

/**
 * Persist the full page artifact so resume mode can rebuild drafts deterministically.
 */
export function writePageArtifact(artifact: PageArtifact, outputDir: string, index: number): void {
  const pagesDir = path.join(outputDir, 'pages');
  fs.mkdirSync(pagesDir, { recursive: true });
  const filename = `page-${String(index).padStart(3, '0')}.json`;
  writeJson(path.join(pagesDir, filename), artifact);
}

/**
 * Load stored page artifacts from a previous run.
 */
export function loadPageArtifacts(outputDir: string): PageArtifact[] {
  const pagesDir = path.join(outputDir, 'pages');
  if (!fs.existsSync(pagesDir)) {
    return [];
  }

  return fs.readdirSync(pagesDir)
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((name) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(pagesDir, name), 'utf-8')) as unknown;
        const artifact = normalizeStoredPageArtifact(raw);
        return artifact ? [artifact] : [];
      } catch {
        return [];
      }
    });
}

function buildPageTypeSummaries(artifacts: PageArtifact[]): PageTypeSummary[] {
  const byType = new Map<PageType, PageArtifact[]>();

  for (const artifact of artifacts) {
    const list = byType.get(artifact.pageType) || [];
    list.push(artifact);
    byType.set(artifact.pageType, list);
  }

  const summaries: PageTypeSummary[] = [];

  for (const [type, pages] of byType) {
    const typicalUrls = pages.slice(0, 5).map((page) => page.url);

    const elementFrequency = new Map<string, number>();
    for (const page of pages) {
      for (const element of page.pageState.interactive_elements) {
        const key = `${element.role}:${element.text.slice(0, 30)}`;
        elementFrequency.set(key, (elementFrequency.get(key) || 0) + 1);
      }
    }
    const commonElements = [...elementFrequency.entries()]
      .filter(([, count]) => count >= Math.max(2, pages.length * 0.5))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key);

    const contextFrequency = new Map<string, number>();
    for (const page of pages) {
      for (const block of page.pageState.context_blocks) {
        const key = `${block.type}:${block.text.slice(0, 40)}`;
        contextFrequency.set(key, (contextFrequency.get(key) || 0) + 1);
      }
    }
    const commonContextBlocks = [...contextFrequency.entries()]
      .filter(([, count]) => count >= Math.max(2, pages.length * 0.3))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key);

    const apiFrequency = new Map<string, number>();
    for (const page of pages) {
      for (const api of page.apiRequests) {
        const key = `${normalizeApiUrl(api.url)}:${api.method}`;
        apiFrequency.set(key, (apiFrequency.get(key) || 0) + 1);
      }
    }
    const commonApis = [...apiFrequency.entries()]
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key);

    summaries.push({
      type,
      count: pages.length,
      typicalUrls,
      commonElements,
      commonContextBlocks,
      commonApis,
    });
  }

  return summaries;
}

function buildApiDrafts(artifacts: PageArtifact[]): ApiProfileDraft[] {
  const apiMap = new Map<string, { requests: ApiRequestSummary[]; pageTypes: Set<PageType> }>();

  for (const artifact of artifacts) {
    for (const api of artifact.apiRequests) {
      const pattern = normalizeApiUrl(api.url);
      const key = `${api.method}:${pattern}`;
      if (!apiMap.has(key)) {
        apiMap.set(key, { requests: [], pageTypes: new Set() });
      }
      const entry = apiMap.get(key)!;
      entry.requests.push(api);
      entry.pageTypes.add(artifact.pageType);
    }
  }

  const drafts: ApiProfileDraft[] = [];

  for (const [key, { requests, pageTypes }] of apiMap) {
    const [method, pattern] = key.split(':', 2);
    const sample = requests[0];

    let dataPath: string | undefined;
    let itemFields: string[] | undefined;
    if (sample.isList && sample.responsePreview) {
      try {
        const parsed = JSON.parse(sample.responsePreview);
        const result = findDataArray(parsed);
        if (result) {
          dataPath = result.path;
          itemFields = result.fields;
        }
      } catch {
        // Ignore malformed previews.
      }
    }

    let paginationType: 'offset' | 'cursor' | 'page' | undefined;
    try {
      const url = new URL(sample.url);
      if (url.searchParams.has('page') || url.searchParams.has('pageNum')) paginationType = 'page';
      else if (url.searchParams.has('offset') || url.searchParams.has('start')) paginationType = 'offset';
      else if (url.searchParams.has('cursor') || url.searchParams.has('after')) paginationType = 'cursor';
    } catch {
      // Ignore invalid URLs.
    }

    drafts.push({
      name: inferApiName(pattern, method),
      purpose: inferApiPurpose(pattern, pageTypes, sample),
      url_pattern: pattern,
      method,
      trigger: `Found on ${[...pageTypes].join(', ')} pages`,
      data_path: dataPath,
      item_fields: itemFields,
      pagination_type: paginationType,
      confidence: requests.length >= 3 ? 'high' : requests.length >= 2 ? 'medium' : 'low',
    });
  }

  drafts.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.confidence] - order[b.confidence];
  });

  return drafts;
}

function buildSiteDraft(domain: string, artifacts: PageArtifact[], apiDrafts: ApiProfileDraft[]): SiteDraft {
  const selectorMap = new Map<string, { selector: string; purpose: string; count: number }>();

  for (const artifact of artifacts) {
    for (const selector of artifact.candidateSelectors) {
      const existing = selectorMap.get(selector.name);
      if (existing) {
        existing.count++;
      } else {
        selectorMap.set(selector.name, {
          selector: selector.selector,
          purpose: selector.purpose,
          count: 1,
        });
      }
    }
  }

  const candidateSelectors: SiteDraft['candidate_selectors'] = {};
  for (const [name, entry] of selectorMap) {
    candidateSelectors[name] = {
      selector: entry.selector,
      purpose: entry.purpose,
      confidence: entry.count >= 3 ? 'high' : entry.count >= 2 ? 'medium' : 'low',
      occurrences: entry.count,
    };
  }

  const hasLoginPage = artifacts.some((artifact) => artifact.pageType === 'login');
  const hasLoginPrompt = artifacts.some((artifact) =>
    artifact.pageState.context_blocks.some((block) => block.type === 'login-prompt'),
  );

  const urlTemplates: SiteDraft['url_templates'] = {};
  for (const artifact of artifacts) {
    if (artifact.pageType !== 'search') continue;
    const template = extractSearchTemplate(artifact.url);
    if (template) {
      urlTemplates.search = template;
    }
  }

  const highConfidenceApis = apiDrafts.filter((draft) => draft.confidence !== 'low').length;
  const preferred_strategy = highConfidenceApis >= 3
    ? 'api-first'
    : highConfidenceApis >= 1
      ? 'hybrid'
      : 'dom-first';

  const waitHints: SiteDraft['candidate_wait_hints'] = [];
  for (const artifact of artifacts) {
    if (artifact.pageType === 'list' || artifact.pageType === 'search') {
      waitHints.push({
        trigger: `${artifact.pageType}页面加载`,
        condition: '等待列表元素出现',
        timeout: 5000,
      });
      break;
    }
  }

  const traps: SiteDraft['candidate_traps'] = [];
  if (hasLoginPrompt) {
    traps.push({
      description: '部分页面需要登录才能查看完整内容',
      trigger: '访问需要登录的页面',
      workaround: '确保浏览器已经登录',
    });
  }

  return {
    domain,
    crawledAt: new Date().toISOString(),
    requires_login: hasLoginPage || hasLoginPrompt,
    preferred_strategy,
    url_templates: urlTemplates,
    candidate_selectors: candidateSelectors,
    candidate_api_profiles: apiDrafts,
    candidate_wait_hints: waitHints,
    candidate_traps: traps,
  };
}

function normalizeApiUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/\d+/g, '/{id}');
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return url;
  }
}

function inferApiPurpose(pattern: string, pageTypes: Set<PageType>, sample: ApiRequestSummary): string {
  const lower = pattern.toLowerCase();

  if (/search|query/i.test(lower)) return '搜索接口';
  if (/list|items|products|goods/i.test(lower) && sample.isList) return '列表数据接口';
  if (/detail|info|product\/\{id\}/i.test(lower)) return '详情数据接口';
  if (/login|auth|token/i.test(lower)) return '认证接口';
  if (/upload|file/i.test(lower)) return '文件上传接口';
  if (/comment|review/i.test(lower)) return '评论接口';
  if (/cart|order/i.test(lower)) return '交易相关接口';

  if (pageTypes.has('search')) return '搜索页面关联接口';
  if (pageTypes.has('list')) return '列表页面关联接口';
  if (pageTypes.has('detail')) return '详情页面关联接口';

  return '业务接口';
}

function inferApiName(pattern: string, method: string): string {
  try {
    const parsed = new URL(pattern);
    const segments = parsed.pathname.split('/').filter((segment) => segment && segment !== '{id}');
    const name = segments.slice(-2).join('_') || 'api';
    return `${method.toLowerCase()}_${name}`;
  } catch {
    return `${method.toLowerCase()}_api`;
  }
}

function findDataArray(value: Record<string, unknown>): { path: string; fields: string[] } | null {
  const paths = ['data', 'items', 'list', 'results', 'result', 'records', 'rows'];

  for (const key of paths) {
    if (Array.isArray(value[key]) && value[key].length > 0) {
      const item = value[key][0];
      if (typeof item === 'object' && item !== null) {
        return { path: key, fields: Object.keys(item as Record<string, unknown>).slice(0, 20) };
      }
    }

    if (typeof value[key] === 'object' && value[key] !== null && !Array.isArray(value[key])) {
      const nested = value[key] as Record<string, unknown>;
      for (const nestedKey of paths) {
        if (Array.isArray(nested[nestedKey]) && nested[nestedKey].length > 0) {
          const item = nested[nestedKey][0];
          if (typeof item === 'object' && item !== null) {
            return {
              path: `${key}.${nestedKey}`,
              fields: Object.keys(item as Record<string, unknown>).slice(0, 20),
            };
          }
        }
      }
    }
  }

  return null;
}

function extractSearchTemplate(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const searchParams = ['q', 'query', 'keyword', 'search', 'kw', 'key', 'wd'];
    for (const param of searchParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '{query}');
        return parsed.toString();
      }
    }
  } catch {
    // Ignore invalid URLs.
  }
  return undefined;
}

function writeJson(filePath: string, data: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function normalizeStoredPageArtifact(raw: unknown): PageArtifact | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Partial<PageArtifact> & {
    contextBlocks?: PageArtifact['pageState']['context_blocks'];
  };

  if (candidate.pageState?.page_meta && Array.isArray(candidate.pageState.interactive_elements)) {
    return candidate as PageArtifact;
  }

  if (!Array.isArray(candidate.contextBlocks)) {
    return null;
  }

  return {
    url: String(candidate.url ?? ''),
    pageType: (candidate.pageType ?? 'other') as PageType,
    depth: Number(candidate.depth ?? 0),
    title: String(candidate.title ?? ''),
    pageState: {
      page_meta: {
        pageId: 'restored-artifact',
        url: String(candidate.url ?? ''),
        title: String(candidate.title ?? ''),
        readyState: 'complete',
        viewport: { width: 0, height: 0 },
        scrollPosition: { x: 0, y: 0 },
        scrollHeight: 0,
      },
      interactive_elements: [],
      context_blocks: candidate.contextBlocks,
    },
    apiRequests: Array.isArray(candidate.apiRequests) ? candidate.apiRequests : [],
    linkCandidates: Array.isArray(candidate.linkCandidates) ? candidate.linkCandidates : [],
    candidateSelectors: Array.isArray(candidate.candidateSelectors) ? candidate.candidateSelectors : [],
    collectedAt: String(candidate.collectedAt ?? new Date().toISOString()),
  };
}
