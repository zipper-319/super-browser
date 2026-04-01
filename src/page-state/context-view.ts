/**
 * Layer 2: Context View - extract semantic context blocks from the page.
 * Provides heading hierarchy, status messages, errors, breadcrumbs, pagination info, etc.
 */

import type { Page } from 'playwright-core';
import type { ContextBlock } from './types.js';

const EXTRACT_CONTEXT_SCRIPT = `
(() => {
  const blocks = [];

  document.querySelectorAll('h1, h2, h3').forEach(el => {
    const text = (el.innerText || '').trim();
    if (!text || getComputedStyle(el).display === 'none') return;
    blocks.push({
      type: 'heading',
      text: text.slice(0, 300),
      container: getContainer(el),
    });
  });

  document.querySelectorAll('[role="alert"], [role="status"], .alert, .notice, .message, .toast').forEach(el => {
    const text = (el.innerText || '').trim();
    if (!text || getComputedStyle(el).display === 'none') return;
    const isError = el.classList.contains('error') || el.classList.contains('danger')
      || el.getAttribute('role') === 'alert';
    blocks.push({
      type: isError ? 'error' : 'status',
      text: text.slice(0, 300),
      container: getContainer(el),
    });
  });

  document.querySelectorAll('[role="banner"] .notification, [class*="notification"], [class*="banner-msg"]').forEach(el => {
    const text = (el.innerText || '').trim();
    if (!text || text.length < 5 || getComputedStyle(el).display === 'none') return;
    blocks.push({
      type: 'notification',
      text: text.slice(0, 300),
      container: getContainer(el),
    });
  });

  document.querySelectorAll('nav[aria-label*="breadcrumb" i], [role="navigation"][aria-label*="breadcrumb" i], .breadcrumb, .breadcrumbs, [class*="breadcrumb"]').forEach(el => {
    const items = Array.from(el.querySelectorAll('a, span, li'))
      .map(a => (a.innerText || '').trim())
      .filter(Boolean);
    if (items.length < 2) return;
    blocks.push({
      type: 'breadcrumb',
      text: items.join(' > ').slice(0, 300),
      container: getContainer(el),
    });
  });

  document.querySelectorAll('nav[aria-label*="paginat" i], [role="navigation"][aria-label*="paginat" i], .pagination, [class*="pagination"], .pager, [class*="pager"]').forEach(el => {
    const current = el.querySelector('[aria-current="page"], .active, .current, [class*="active"]');
    const currentPage = current ? (current.innerText || '').trim() : '';
    const pageNums = Array.from(el.querySelectorAll('a, button, span'))
      .map(a => (a.innerText || '').trim())
      .filter(t => /^\\d+$/.test(t));
    const text = currentPage
      ? 'Page ' + currentPage + (pageNums.length ? ' of ' + pageNums[pageNums.length - 1] : '')
      : 'Pagination: ' + pageNums.join(', ');
    if (!text || text.length < 3) return;
    blocks.push({
      type: 'pagination',
      text: text.slice(0, 200),
      container: getContainer(el),
    });
  });

  document.querySelectorAll('[class*="filter"], [class*="facet"], [data-role="filter"]').forEach(el => {
    const active = el.querySelectorAll('.active, [aria-selected="true"], [aria-checked="true"], .selected');
    if (active.length === 0) return;
    const items = Array.from(active).map(a => (a.innerText || '').trim()).filter(Boolean);
    if (items.length === 0) return;
    blocks.push({
      type: 'filter',
      text: 'Active filters: ' + items.join(', ').slice(0, 300),
      container: getContainer(el),
    });
  });

  const loginIndicators = document.querySelectorAll(
    'form[action*="login"], form[action*="signin"], form[action*="sign-in"],'
    + '[class*="login-form"], [class*="signin-form"],'
    + 'input[type="password"]'
  );
  if (loginIndicators.length > 0) {
    blocks.push({
      type: 'login-prompt',
      text: 'Login form detected on page',
      container: getContainer(loginIndicators[0]),
    });
  }

  document.querySelectorAll('label[for]').forEach(el => {
    const text = (el.innerText || '').trim();
    if (!text || getComputedStyle(el).display === 'none') return;
    const forId = el.getAttribute('for');
    const target = forId ? document.getElementById(forId) : null;
    if (!target) return;
    blocks.push({
      type: 'label',
      text: text.slice(0, 100),
      container: getContainer(el),
    });
  });

  const body = document.body.innerText || '';
  const summaryPatterns = [
    /(showing|displaying)\\s+\\d+\\s*[-–]\\s*\\d+\\s+(of|out of)\\s+[\\d,]+/i,
    /共\\s*[\\d,]+\\s*(条|个结果|条结果)/,
    /total[:\\s]+[\\d,]+/i,
    /[\\d,]+\\s*results?/i,
  ];
  for (const pattern of summaryPatterns) {
    const match = body.match(pattern);
    if (match) {
      blocks.push({ type: 'summary', text: match[0].trim().slice(0, 200) });
      break;
    }
  }

  const seen = new Set();
  return blocks.filter(block => {
    const key = block.type + '|' + block.text;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  function getContainer(el) {
    let current = el.parentElement;
    while (current && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute('role');
      if (tag === 'header' || role === 'banner') return 'header';
      if (tag === 'nav' || role === 'navigation') return 'nav';
      if (tag === 'main' || role === 'main') return 'main';
      if (tag === 'footer' || role === 'contentinfo') return 'footer';
      if (tag === 'aside' || role === 'complementary') return 'sidebar';
      if (tag === 'dialog' || role === 'dialog') return 'dialog';
      if (tag === 'form') return 'form';
      current = current.parentElement;
    }
    return undefined;
  }
})()
`;

/**
 * Extract context blocks from the page.
 */
export async function extractContextBlocks(page: Page): Promise<ContextBlock[]> {
  const raw = await page.evaluate(EXTRACT_CONTEXT_SCRIPT) as ContextBlock[];
  return raw;
}
