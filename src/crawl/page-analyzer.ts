/**
 * Page Analysis Layer - page type detection, link extraction,
 * candidate selector discovery, and PageArtifact construction.
 */

import type { Page } from 'playwright-core';
import type { PageState } from '../page-state/types.js';
import type {
  PageType,
  PageArtifact,
  LinkCandidate,
  CandidateSelector,
  ApiRequestSummary,
  SeedConfig,
} from './types.js';
import { collectPageState } from '../page-state/collector.js';
import { getMonitorState } from '../network/monitor.js';

/**
 * Analyze a single page: collect state, detect type, extract links and candidates.
 */
export async function analyzePage(
  page: Page,
  pageId: string,
  url: string,
  depth: number,
  config: SeedConfig,
): Promise<PageArtifact> {
  const pageState = await collectPageState(page, pageId, {});
  const pageType = detectPageType(url, pageState);
  const linkCandidates = await extractLinksFromPage(page, depth);
  const apiRequests = captureApiSummaries(pageId);
  const candidateSelectors = discoverSelectors(pageState, pageType);

  return {
    url,
    pageType,
    depth,
    title: pageState.page_meta.title,
    pageState,
    apiRequests,
    linkCandidates,
    candidateSelectors,
    collectedAt: new Date().toISOString(),
  };
}

/**
 * Detect the page type from URL patterns and page content signals.
 */
export function detectPageType(url: string, pageState: PageState): PageType {
  const path = new URL(url).pathname.toLowerCase();
  const elements = pageState.interactive_elements;
  const blocks = pageState.context_blocks;

  const hasLoginPrompt = blocks.some((block) => block.type === 'login-prompt');
  if (hasLoginPrompt || /\/login|\/signin|\/auth/i.test(path)) {
    return 'login';
  }

  const hasFileInput = elements.some((element) =>
    element.tag === 'INPUT' && element.selector.includes('[type="file"]'),
  );
  if (hasFileInput || /\/upload/i.test(path)) {
    return 'upload';
  }

  if (/\/account|\/profile|\/settings|\/user\//i.test(path)) {
    return 'account';
  }

  if (/[?&](q|query|keyword|search|kw)=/i.test(url)) {
    return 'search';
  }

  const hasSearchInput = elements.some((element) =>
    element.role === 'input' && /search|query|keyword|搜索|查询|关键词/i.test(element.text + (element.name || '')),
  );
  const hasSearchResults = blocks.some((block) =>
    block.type === 'summary' && /结果|results|found|找到/i.test(block.text),
  );
  if (hasSearchInput && hasSearchResults) {
    return 'search';
  }

  const hasPagination = blocks.some((block) => block.type === 'pagination');
  const visibleLinks = elements.filter((element) => element.role === 'link' && element.visible).length;
  if (hasPagination || /\/list|\/category|\/catalog/i.test(path)) {
    return 'list';
  }
  if (visibleLinks > 20 && elements.filter((element) => element.role === 'link').length > 30) {
    return 'list';
  }

  if (/\/detail|\/item|\/product\/\d|\/p\/|\/goods/i.test(path)) {
    return 'detail';
  }

  if (path === '/' || path === '' || /^\/index/i.test(path)) {
    return 'home';
  }

  return 'other';
}

/**
 * Extract all navigable links from the page DOM.
 * Called separately because InteractiveElement doesn't store href.
 */
export async function extractLinksFromPage(page: Page, currentDepth: number): Promise<LinkCandidate[]> {
  const rawLinks = await page.evaluate(`
    Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({ url: a.href, text: (a.textContent || '').trim().slice(0, 100) }))
      .filter(link => link.url.startsWith('http'))
  `) as Array<{ url: string; text: string }>;

  const seen = new Set<string>();
  const candidates: LinkCandidate[] = [];

  for (const link of rawLinks) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    candidates.push({
      url: link.url,
      text: link.text,
      inferredType: inferLinkType(link.url),
      depth: currentDepth + 1,
    });
  }

  return candidates;
}

function inferLinkType(url: string): PageType | undefined {
  const path = new URL(url).pathname.toLowerCase();
  if (/\/detail|\/item|\/product\/|\/p\/|\/goods/i.test(path)) return 'detail';
  if (/\/list|\/category|\/catalog/i.test(path)) return 'list';
  if (/\/search/i.test(path) || /[?&](q|query|keyword)=/i.test(url)) return 'search';
  if (/\/login|\/signin/i.test(path)) return 'login';
  return undefined;
}

function captureApiSummaries(pageId: string): ApiRequestSummary[] {
  const monitorState = getMonitorState(pageId);
  if (!monitorState) return [];

  return monitorState.requests
    .filter((request) => request.isBusinessApi)
    .map((request) => {
      let jsonKeys: string[] | undefined;
      let isList = false;

      if (request.responseBody) {
        try {
          const parsed = JSON.parse(request.responseBody);
          if (typeof parsed === 'object' && parsed !== null) {
            jsonKeys = Object.keys(parsed).slice(0, 20);
            isList = containsDataArray(parsed);
          }
        } catch {
          // Ignore non-JSON responses.
        }
      }

      return {
        url: request.url,
        method: request.method,
        status: request.status,
        contentType: request.contentType,
        responsePreview: request.responseBody?.slice(0, 500),
        jsonKeys,
        isList,
      };
    });
}

function containsDataArray(value: Record<string, unknown>): boolean {
  const candidatePaths = ['data', 'items', 'list', 'results', 'result', 'records', 'rows'];
  for (const key of candidatePaths) {
    if (Array.isArray(value[key])) return true;
    if (typeof value[key] === 'object' && value[key] !== null) {
      const nested = value[key] as Record<string, unknown>;
      for (const nestedKey of candidatePaths) {
        if (Array.isArray(nested[nestedKey])) return true;
      }
    }
  }
  return false;
}

function discoverSelectors(pageState: PageState, pageType: PageType): CandidateSelector[] {
  const candidates: CandidateSelector[] = [];
  const elements = pageState.interactive_elements;

  if (pageType === 'search' || pageType === 'home') {
    const searchInputs = elements.filter((element) =>
      element.role === 'input'
      && /search|query|keyword|搜索|查询|关键词/i.test(element.text + (element.name || '') + element.selector),
    );
    for (const element of searchInputs) {
      candidates.push({
        name: 'search_input',
        selector: element.selector,
        purpose: `搜索输入框: "${element.text || element.name}"`,
        occurrences: 1,
      });
    }

    const searchButtons = elements.filter((element) =>
      (element.role === 'button' || element.role === 'clickable')
      && /search|搜索|查找|查询/i.test(element.text),
    );
    for (const element of searchButtons) {
      candidates.push({
        name: 'search_button',
        selector: element.selector,
        purpose: `搜索按钮: "${element.text}"`,
        occurrences: 1,
      });
    }
  }

  if (pageType === 'list' || pageType === 'search') {
    const nextButtons = elements.filter((element) =>
      /next|下一页|下页|后页|>>/i.test(element.text) || element.selector.includes('next'),
    );
    for (const element of nextButtons) {
      candidates.push({
        name: 'next_page',
        selector: element.selector,
        purpose: `下一页按钮: "${element.text}"`,
        occurrences: 1,
      });
    }
  }

  if (pageType === 'login') {
    const loginButtons = elements.filter((element) =>
      element.role === 'button' && /login|登录|sign\s*in/i.test(element.text),
    );
    for (const element of loginButtons) {
      candidates.push({
        name: 'login_button',
        selector: element.selector,
        purpose: `登录按钮: "${element.text}"`,
        occurrences: 1,
      });
    }

    const userInputs = elements.filter((element) =>
      element.role === 'input' && /user|email|phone|账号|手机/i.test(element.text + (element.name || '')),
    );
    for (const element of userInputs) {
      candidates.push({
        name: 'username_input',
        selector: element.selector,
        purpose: `用户名输入: "${element.text || element.name}"`,
        occurrences: 1,
      });
    }

    const passwordInputs = elements.filter((element) =>
      element.role === 'input' && /password|密码/i.test(element.text + (element.name || '') + element.selector),
    );
    for (const element of passwordInputs) {
      candidates.push({
        name: 'password_input',
        selector: element.selector,
        purpose: `密码输入: "${element.text || element.name}"`,
        occurrences: 1,
      });
    }
  }

  return candidates;
}
