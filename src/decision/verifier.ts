/**
 * Post-action verifier — executes verification conditions against a Playwright page
 * to confirm whether an action succeeded.
 */

import type { Page } from 'playwright-core';
import type { VerificationCondition, VerificationCheck } from './types.js';

export interface VerifyResult {
  passed: boolean;
  check: VerificationCheck;
  expected: string;
  actual?: string;
  elapsed: number;
}

/**
 * Run a verification condition against the current page state.
 * Polls until the condition is met or timeout is reached.
 */
export async function verify(
  page: Page,
  condition: VerificationCondition,
): Promise<VerifyResult> {
  const start = Date.now();
  const deadline = start + condition.timeout;

  while (Date.now() < deadline) {
    const result = await checkOnce(page, condition);
    if (result.passed) {
      return { ...result, elapsed: Date.now() - start };
    }
    // Poll interval: 300ms
    await page.waitForTimeout(Math.min(300, deadline - Date.now()));
  }

  // Final check
  const final = await checkOnce(page, condition);
  return { ...final, elapsed: Date.now() - start };
}

/**
 * Single-shot check (no polling).
 */
async function checkOnce(
  page: Page,
  condition: VerificationCondition,
): Promise<Omit<VerifyResult, 'elapsed'>> {
  const { check, value } = condition;

  try {
    switch (check) {
      case 'selector_exists': {
        const count = await page.locator(value).count();
        return {
          passed: count > 0,
          check,
          expected: value,
          actual: `${count} elements found`,
        };
      }

      case 'selector_absent': {
        const count = await page.locator(value).count();
        return {
          passed: count === 0,
          check,
          expected: `no ${value}`,
          actual: `${count} elements found`,
        };
      }

      case 'url_changed': {
        const currentUrl = page.url();
        return {
          passed: currentUrl !== value,
          check,
          expected: `URL changed from ${value}`,
          actual: currentUrl,
        };
      }

      case 'url_contains': {
        const currentUrl = page.url();
        return {
          passed: currentUrl.includes(value),
          check,
          expected: `URL contains "${value}"`,
          actual: currentUrl,
        };
      }

      case 'text_contains': {
        const bodyText = await page.evaluate('document.body?.innerText || ""') as string;
        return {
          passed: bodyText.includes(value),
          check,
          expected: `page contains "${value}"`,
          actual: bodyText.length > 200 ? bodyText.slice(0, 200) + '...' : bodyText,
        };
      }

      case 'element_count_changed': {
        // value format: "selector:previousCount"
        const [selector, prevStr] = value.split(':');
        const prevCount = parseInt(prevStr, 10) || 0;
        const currentCount = await page.locator(selector).count();
        return {
          passed: currentCount !== prevCount,
          check,
          expected: `count changed from ${prevCount}`,
          actual: `${currentCount} elements`,
        };
      }

      case 'network_response': {
        // Check if a matching request has completed recently
        // This is best-effort — for precise checks, use network monitor
        const found = await page.evaluate((urlPattern) => {
          const entries = performance.getEntriesByType('resource');
          return entries.some((e) => (e as any).name?.includes(urlPattern));
        }, value);
        return {
          passed: found as boolean,
          check,
          expected: `network response matching "${value}"`,
          actual: found ? 'found' : 'not found',
        };
      }

      case 'eval_truthy': {
        const result = await page.evaluate((expr) => {
          return new Function(`return !!(${expr})`)();
        }, value);
        return {
          passed: !!result,
          check,
          expected: `eval truthy: ${value.slice(0, 100)}`,
          actual: String(result),
        };
      }

      default:
        return {
          passed: false,
          check,
          expected: value,
          actual: `Unknown check type: ${check}`,
        };
    }
  } catch (err) {
    return {
      passed: false,
      check,
      expected: value,
      actual: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
