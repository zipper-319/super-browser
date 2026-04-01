/**
 * Layer 1: Actionable View — extract interactive elements from the page.
 * Runs a browser-side script via page.evaluate() to collect all actionable elements.
 */

import type { Page } from 'playwright-core';
import type { InteractiveElement } from './types.js';

/**
 * Browser-side script that extracts interactive elements.
 * This string is evaluated in the browser context via page.evaluate().
 */
const EXTRACT_SCRIPT = `
(() => {
  const INTERACTIVE_SELECTORS = [
    'a[href]',
    'button',
    'input',
    'textarea',
    'select',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="combobox"]',
    '[role="searchbox"]',
    '[role="option"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
    'summary',
    'details',
    '[contenteditable="true"]',
  ];

  const seen = new Set();
  const elements = [];
  let ref = 1;

  // Infer role from tag + attributes
  function inferRole(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if (role) {
      const roleMap = {
        button: 'button', link: 'link', tab: 'tab', menuitem: 'menuitem',
        checkbox: 'checkbox', radio: 'radio', switch: 'checkbox',
        combobox: 'select', searchbox: 'input', option: 'menuitem',
      };
      return roleMap[role] || 'clickable';
    }
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      return 'input';
    }
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    if (el.getAttribute('onclick') || el.getAttribute('tabindex')) return 'clickable';
    return 'other';
  }

  // Get visible text, trimmed
  function getText(el) {
    // Prefer aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim().slice(0, 200);
    // For inputs, use placeholder or value
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      return (el.placeholder || el.value || el.getAttribute('title') || '').trim().slice(0, 200);
    }
    // innerText (visible text only)
    return (el.innerText || el.textContent || '').trim().slice(0, 200);
  }

  // Get auxiliary name
  function getName(el) {
    return el.getAttribute('name')
      || el.getAttribute('placeholder')
      || el.getAttribute('title')
      || el.getAttribute('aria-describedby')
      || undefined;
  }

  // Build a CSS selector that uniquely identifies the element
  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);

    // Try data-testid / data-id
    for (const attr of ['data-testid', 'data-test-id', 'data-id', 'data-cy']) {
      const val = el.getAttribute(attr);
      if (val) return '[' + attr + '="' + CSS.escape(val) + '"]';
    }

    // Build tag + nth-of-type path (up to 3 levels)
    const parts = [];
    let current = el;
    for (let i = 0; i < 3 && current && current !== document.body; i++) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift('#' + CSS.escape(current.id));
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          parts.unshift(tag + ':nth-of-type(' + idx + ')');
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }
    return parts.join(' > ');
  }

  // Detect container landmark
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
      if (tag === 'dialog' || role === 'dialog' || role === 'alertdialog') return 'dialog';
      if (tag === 'form') return 'form';
      current = current.parentElement;
    }
    return undefined;
  }

  // Get element state
  function getState(el) {
    const s = {};
    if (el.disabled) s.disabled = true;
    if (el.checked) s.checked = true;
    if (el.selected) s.selected = true;
    if (el.getAttribute('aria-expanded') === 'true') s.expanded = true;
    if (el.getAttribute('aria-expanded') === 'false') s.expanded = false;
    if (el.value !== undefined && el.value !== '') s.value = String(el.value).slice(0, 100);
    return Object.keys(s).length > 0 ? s : undefined;
  }

  // Check visibility
  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  // Collect all matching elements
  const allEls = document.querySelectorAll(INTERACTIVE_SELECTORS.join(','));
  for (const el of allEls) {
    if (seen.has(el)) continue;
    seen.add(el);

    // Skip hidden and aria-hidden
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const vis = isVisible(el);
    // Include non-visible elements too (they might be in carousels, dropdowns etc.)
    // but mark them as not visible

    const rect = el.getBoundingClientRect();
    const text = getText(el);

    // Skip elements with no text and no meaningful identity
    if (!text && !el.id && !el.getAttribute('name') && !el.getAttribute('aria-label')) continue;

    elements.push({
      ref: ref++,
      tag: el.tagName.toLowerCase(),
      role: inferRole(el),
      text: text,
      name: getName(el),
      state: getState(el),
      selector: buildSelector(el),
      container: getContainer(el),
      visible: vis,
      bbox: vis ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : undefined,
    });
  }

  return elements;
})()
`;

/**
 * Extract interactive elements from the page.
 */
export async function extractInteractiveElements(page: Page): Promise<InteractiveElement[]> {
  const raw = await page.evaluate(EXTRACT_SCRIPT) as InteractiveElement[];
  return raw;
}
