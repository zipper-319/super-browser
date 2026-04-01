/**
 * Fallback view (Layer 4) — screenshot capture, overlay detection,
 * and recent network request summary.
 *
 * Used when Layers 1-2 yield insufficient information (e.g., canvas-heavy pages,
 * shadow DOM, or heavily obfuscated UIs).
 */

import type { Page } from 'playwright-core';
import type { FallbackView } from './types.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Capture the fallback view for a page.
 */
export async function captureFallbackView(
  page: Page,
  pageId: string,
  screenshotDir?: string,
): Promise<FallbackView> {
  const fallback: FallbackView = {};

  // 1. Screenshot
  if (screenshotDir) {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const filename = `${pageId}-${Date.now()}.png`;
    const screenshotPath = path.join(screenshotDir, filename);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    fallback.screenshotPath = screenshotPath;
  }

  // 2. Overlay / modal detection
  const overlay = await detectOverlay(page);
  if (overlay) {
    fallback.overlay = overlay;
  }

  // 3. Recent network requests (from Performance API)
  const recentRequests = await collectRecentRequests(page);
  if (recentRequests.length > 0) {
    fallback.recentRequests = recentRequests;
  }

  return fallback;
}

/**
 * Detect common overlay/modal patterns that block page interaction.
 */
async function detectOverlay(page: Page): Promise<{ type: string; text: string } | undefined> {
  const result = await page.evaluate(`
    (() => {
      // Check for common modal/overlay selectors
      const selectors = [
        '[class*="modal"][style*="display: block"], [class*="modal"][style*="visibility: visible"]',
        '[class*="overlay"][style*="display: block"], [class*="overlay"]:not([style*="display: none"])',
        '[class*="dialog"][open], [role="dialog"]',
        '[class*="popup"]:not([style*="display: none"])',
        '[class*="mask"]:not([style*="display: none"])',
        '.login-modal, .auth-modal, #login-dialog',
        '[class*="captcha"], [id*="captcha"]',
        '[class*="cookie-consent"], [class*="cookie-banner"]',
      ];

      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const rect = el.getBoundingClientRect();
            // Must be visible and large enough
            if (rect.width > 100 && rect.height > 100) {
              const style = getComputedStyle(el);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
                const text = (el.textContent || '').trim().slice(0, 200);
                let type = 'unknown';
                const cls = (el.className || '').toLowerCase();
                if (/login|auth|signin/i.test(cls + text)) type = 'login';
                else if (/captcha|verify|验证/i.test(cls + text)) type = 'captcha';
                else if (/cookie|consent|隐私/i.test(cls + text)) type = 'cookie-consent';
                else if (/modal|dialog|popup/i.test(cls)) type = 'modal';
                else type = 'overlay';
                return { type, text };
              }
            }
          }
        } catch {}
      }
      return null;
    })()
  `) as { type: string; text: string } | null;

  return result ?? undefined;
}

/**
 * Collect recent XHR/Fetch requests from the Performance API.
 */
async function collectRecentRequests(
  page: Page,
): Promise<Array<{ url: string; method: string; status: number }>> {
  const requests = await page.evaluate(`
    (() => {
      const entries = performance.getEntriesByType('resource');
      // Filter to last 30 seconds of XHR/Fetch-like requests
      const cutoff = performance.now() - 30000;
      return entries
        .filter(e => e.startTime >= cutoff && (e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'fetch'))
        .slice(-20)
        .map(e => ({
          url: e.name.slice(0, 200),
          method: 'GET',
          status: e.responseStatus || 0,
        }));
    })()
  `) as Array<{ url: string; method: string; status: number }>;

  return requests || [];
}
