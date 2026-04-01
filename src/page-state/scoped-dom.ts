/**
 * Layer 3: Scoped DOM — extract a trimmed HTML fragment for a specific region.
 * Used when Layer 1+2 are insufficient (e.g., complex tables, custom widgets).
 */

import type { Page } from 'playwright-core';
import type { ScopedDom } from './types.js';

/**
 * Extract a scoped DOM fragment for a given selector.
 * Trims the HTML to reduce size: strips scripts, styles, comments, and deep nesting.
 */
export async function extractScopedDom(
  page: Page,
  selector: string,
  reason: string,
  maxLength = 5000,
): Promise<ScopedDom | null> {
  const html = await page.evaluate(`
    (() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;

      // Clone to avoid modifying the live DOM
      const clone = el.cloneNode(true);

      // Remove noise
      clone.querySelectorAll('script, style, noscript, svg, iframe').forEach(n => n.remove());

      // Remove hidden elements
      // (can't use getComputedStyle on cloned nodes, so skip this)

      // Trim attributes: keep only id, class, href, src, alt, role, aria-*, data-testid
      const keepAttrs = new Set(['id', 'class', 'href', 'src', 'alt', 'role', 'type', 'name', 'value', 'placeholder', 'data-testid']);
      clone.querySelectorAll('*').forEach(n => {
        const attrs = Array.from(n.attributes);
        for (const attr of attrs) {
          if (!keepAttrs.has(attr.name) && !attr.name.startsWith('aria-')) {
            n.removeAttribute(attr.name);
          }
        }
      });

      return clone.outerHTML;
    })()
  `) as string | null;

  if (!html) return null;

  return {
    selector,
    html: html.length > maxLength ? html.slice(0, maxLength) + '<!-- truncated -->' : html,
    reason,
  };
}
