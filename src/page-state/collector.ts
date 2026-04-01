/**
 * Page state collector — orchestrates all layers to produce the final PageState.
 */

import type { Page } from 'playwright-core';
import type { PageState, PageMeta, ScopedDom, FallbackView } from './types.js';
import { extractInteractiveElements } from './actionable-view.js';
import { extractContextBlocks } from './context-view.js';
import { extractScopedDom } from './scoped-dom.js';
import { compress, type CompressorOptions } from './compressor.js';
import { computeStateDiff } from './state-diff.js';
import { captureFallbackView } from './fallback-view.js';

export interface CollectOptions extends CompressorOptions {
  /** Include scoped DOM for these selectors (Layer 3) */
  scopedSelectors?: Array<{ selector: string; reason: string }>;
  /** Skip compression (return raw data) */
  raw?: boolean;
  /** Previous state for diff computation */
  previousState?: PageState;
  /** Enable fallback view (Layer 4): screenshot + network summary */
  fallback?: boolean | { screenshotDir?: string };
}

/**
 * Collect the full page state.
 */
export async function collectPageState(
  page: Page,
  pageId: string,
  opts?: CollectOptions,
): Promise<PageState> {
  // ---- Page meta ----
  const meta = await collectMeta(page, pageId);

  // ---- Layer 1: Interactive elements ----
  const interactiveElements = await extractInteractiveElements(page);

  // ---- Layer 2: Context blocks ----
  const contextBlocks = await extractContextBlocks(page);

  // ---- Layer 3: Scoped DOM (on demand) ----
  let scopedDom: ScopedDom[] | undefined;
  if (opts?.scopedSelectors?.length) {
    const results = await Promise.all(
      opts.scopedSelectors.map((s) => extractScopedDom(page, s.selector, s.reason)),
    );
    const valid = results.filter((r): r is ScopedDom => r !== null);
    if (valid.length > 0) {
      scopedDom = valid;
    }
  }

  // ---- Layer 4: Fallback view (on demand) ----
  let fallback: FallbackView | undefined;
  if (opts?.fallback) {
    const fbOpts = typeof opts.fallback === 'object' ? opts.fallback : {};
    fallback = await captureFallbackView(page, pageId, fbOpts.screenshotDir);
  }

  // ---- Assemble ----
  const state: PageState = {
    page_meta: meta,
    interactive_elements: interactiveElements,
    context_blocks: contextBlocks,
    scoped_dom: scopedDom,
    fallback,
  };

  // ---- StateDiff ----
  if (opts?.previousState) {
    state.state_diff = computeStateDiff(opts.previousState, state);
  }

  // ---- Compress ----
  if (opts?.raw) return state;
  return compress(state, opts);
}

async function collectMeta(page: Page, pageId: string): Promise<PageMeta> {
  const data = await page.evaluate(`
    (() => {
      const interactiveSelector = [
        'a[href]',
        'button',
        'input',
        'textarea',
        'select',
        '[role="button"]',
        '[role="link"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[onclick]',
        '[tabindex]:not([tabindex="-1"])',
      ].join(',');
      const loadingSelector = [
        '[aria-busy="true"]',
        '[role="progressbar"]',
        '[class*="loading"]',
        '[class*="spinner"]',
        '[class*="skeleton"]',
        '[data-loading="true"]',
      ].join(',');
      const overlaySelector = [
        '[role="dialog"]',
        '[aria-modal="true"]',
        'dialog[open]',
        '[class*="modal"]',
        '[class*="overlay"]',
        '[class*="drawer"]',
        '[class*="popup"]',
        '[class*="captcha"]',
      ].join(',');

      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const findActiveOverlay = () => {
        const viewportArea = Math.max(window.innerWidth * window.innerHeight, 1);
        const candidates = Array.from(document.querySelectorAll(overlaySelector))
          .filter(isVisible)
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.width * rect.height >= viewportArea * 0.08)
          .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

        const top = candidates[0];
        if (!top) return null;

        const text = (top.el.innerText || top.el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
        const marker = (String(top.el.className || '') + ' ' + text).toLowerCase();
        let type = 'unknown';
        if (/captcha|verify/.test(marker)) type = 'captcha';
        else if (/drawer|sheet/.test(marker)) type = 'drawer';
        else if (/banner|toast|alert/.test(marker)) type = 'banner';
        else if (top.el.matches('[role="dialog"], [aria-modal="true"], dialog[open]')) type = 'dialog';
        else if (/modal|popup/.test(marker)) type = 'dialog';

        return { type, text };
      };

      const scrollHeight = document.documentElement.scrollHeight;
      const bodyTextLength = (document.body?.innerText || '').trim().length;
      const viewportHeight = Math.max(window.innerHeight, 1);
      const interactiveCount = document.querySelectorAll(interactiveSelector).length;
      const loadingIndicatorCount = Array.from(document.querySelectorAll(loadingSelector)).filter(isVisible).length;
      const pixelsBelow = Math.max(scrollHeight - (window.scrollY + viewportHeight), 0);
      const pagesAbove = window.scrollY / viewportHeight;
      const pagesBelow = pixelsBelow / viewportHeight;

      let loadingState = 'stable';
      if (document.readyState !== 'complete' || loadingIndicatorCount > 0) {
        loadingState = 'loading';
      }
      if (
        loadingIndicatorCount > 0
        && interactiveCount > 12
        && bodyTextLength < interactiveCount * 4
      ) {
        loadingState = 'skeleton';
      }

      return {
        title: document.title,
        readyState: document.readyState,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        scrollHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        pagesAbove,
        pagesBelow,
        loadingState,
        activeOverlay: findActiveOverlay(),
      };
    })()
  `) as {
    title: string;
    readyState: string;
    scrollX: number;
    scrollY: number;
    scrollHeight: number;
    innerWidth: number;
    innerHeight: number;
    pagesAbove: number;
    pagesBelow: number;
    loadingState: NonNullable<PageMeta['loadingState']>;
    activeOverlay: PageMeta['activeOverlay'];
  };

  return {
    pageId,
    url: page.url(),
    title: data.title,
    readyState: data.readyState as PageMeta['readyState'],
    viewport: { width: data.innerWidth, height: data.innerHeight },
    scrollPosition: { x: data.scrollX, y: data.scrollY },
    scrollHeight: data.scrollHeight,
    pagesAbove: roundMetric(data.pagesAbove),
    pagesBelow: roundMetric(data.pagesBelow),
    loadingState: data.loadingState,
    activeOverlay: data.activeOverlay,
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 10) / 10;
}
