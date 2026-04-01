/**
 * Decision executor - runs planned action proposals against a Playwright page.
 */

import type { Page } from 'playwright-core';
import type { ActionProposal } from './types.js';

export interface ActionExecutionResult {
  action: ActionProposal['params']['type'];
  selector?: string;
  url?: string;
  value?: string | string[];
  scrollY?: number;
  api?: {
    url: string;
    method: string;
    status: number;
    ok: boolean;
  };
  extracted?: Array<Record<string, string>>;
  evalResult?: unknown;
}

export async function executeProposal(
  page: Page,
  proposal: ActionProposal,
): Promise<ActionExecutionResult> {
  const { params } = proposal;

  switch (params.type) {
    case 'click': {
      const locator = page.locator(params.selector).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.click();
      return {
        action: params.type,
        selector: params.selector,
      };
    }

    case 'click-real': {
      const locator = page.locator(params.selector).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.click({ force: true });
      return {
        action: params.type,
        selector: params.selector,
      };
    }

    case 'type': {
      const locator = page.locator(params.selector).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.fill(params.text);
      return {
        action: params.type,
        selector: params.selector,
        value: params.text,
      };
    }

    case 'select': {
      const locator = page.locator(params.selector).first();
      await locator.scrollIntoViewIfNeeded();
      await locator.selectOption(params.value);
      return {
        action: params.type,
        selector: params.selector,
        value: params.value,
      };
    }

    case 'scroll': {
      const distance = params.distance ?? 3000;
      if (params.direction === 'down') {
        await page.evaluate(`window.scrollBy(0, ${distance})`);
      } else {
        await page.evaluate(`window.scrollBy(0, -${distance})`);
      }
      await page.waitForTimeout(500);
      const scrollY = await page.evaluate('window.scrollY') as number;
      return {
        action: params.type,
        scrollY,
      };
    }

    case 'wait':
      await page.waitForTimeout(params.timeout);
      return {
        action: params.type,
        value: params.condition,
      };

    case 'api-call': {
      const response = await page.context().request.fetch(params.url, {
        method: params.method,
      });
      return {
        action: params.type,
        url: params.url,
        api: {
          url: params.url,
          method: params.method,
          status: response.status(),
          ok: response.ok(),
        },
      };
    }

    case 'extract': {
      const extracted = await page.evaluate(`
        (() => {
          const selector = ${JSON.stringify(params.selector)};
          const fields = ${JSON.stringify(params.fields)};
          const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 20);
          const pricePattern = /(?:[$€¥]|USD|CNY|RMB)\\s?\\d[\\d,.]*/i;

          const readField = (node, field) => {
            const text = ((node.innerText || node.textContent || '') + '').trim().replace(/\\s+/g, ' ');

            switch (field) {
              case 'title':
              case 'text':
                return text.slice(0, 240);
              case 'url': {
                if (node instanceof HTMLAnchorElement) return node.href;
                const anchor = node.querySelector('a[href]');
                return anchor?.href || '';
              }
              case 'image': {
                const image = node.querySelector('img');
                return image?.src || '';
              }
              case 'price': {
                const direct = text.match(pricePattern)?.[0];
                if (direct) return direct;
                const priceNode = node.querySelector('[class*="price"], [data-price], [aria-label*="price" i]');
                return ((priceNode?.innerText || priceNode?.textContent || '') + '').trim().slice(0, 80);
              }
              default:
                return ((node.getAttribute?.(field) || text) + '').slice(0, 240);
            }
          };

          return nodes.map((node) => {
            const item = {};
            for (const field of fields) {
              item[field] = readField(node, field);
            }
            return item;
          });
        })()
      `) as Array<Record<string, string>>;

      return {
        action: params.type,
        selector: params.selector,
        extracted,
      };
    }

    case 'navigate':
      await page.goto(params.url, { waitUntil: 'load', timeout: 30_000 });
      return {
        action: params.type,
        url: params.url,
      };

    case 'eval': {
      const value = await page.evaluate((expr) => {
        return new Function(`return (${expr})`)();
      }, params.code);
      return {
        action: params.type,
        evalResult: value,
      };
    }

    default: {
      const exhaustiveCheck: never = params;
      throw new Error(`Unsupported action type: ${String(exhaustiveCheck)}`);
    }
  }
}
