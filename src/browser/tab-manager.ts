/**
 * Tab (Page) lifecycle management.
 * Replaces v1's Target.createTarget / Target.closeTarget CDP calls.
 */

import type { Page, BrowserContext } from 'playwright-core';

export interface ManagedPage {
  id: string;
  page: Page;
  createdAt: number;
  /** Whether this tab was created by us (vs user's existing tab) */
  owned: boolean;
}

const pages = new Map<string, ManagedPage>();
let nextId = 1;

/**
 * Create a new background tab and navigate to URL.
 */
export async function createTab(context: BrowserContext, url: string): Promise<ManagedPage> {
  const page = await context.newPage();
  const id = `page_${nextId++}`;

  if (url && url !== 'about:blank') {
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  }

  const managed: ManagedPage = {
    id,
    page,
    createdAt: Date.now(),
    owned: true,
  };

  pages.set(id, managed);

  // Auto-remove on close
  page.on('close', () => {
    pages.delete(id);
  });

  return managed;
}

/**
 * Close a tab by ID. Only closes tabs we own.
 */
export async function closeTab(pageId: string): Promise<boolean> {
  const managed = pages.get(pageId);
  if (!managed) {
    throw new Error(`Page not found: ${pageId}`);
  }
  if (!managed.owned) {
    throw new Error(`Cannot close user's tab: ${pageId}`);
  }

  await managed.page.close();
  pages.delete(pageId);
  return true;
}

/**
 * Get a managed page by ID.
 */
export function getPage(pageId: string): ManagedPage {
  const managed = pages.get(pageId);
  if (!managed) {
    throw new Error(`Page not found: ${pageId}`);
  }
  return managed;
}

/**
 * List all managed pages.
 */
export function listPages(): Array<{ pageId: string; url: string; title: string }> {
  const result: Array<{ pageId: string; url: string; title: string }> = [];
  for (const [id, managed] of pages) {
    result.push({
      pageId: id,
      url: managed.page.url(),
      title: '', // title() is async, filled by caller if needed
    });
  }
  return result;
}

/**
 * Close all owned tabs — called during daemon shutdown.
 */
export async function closeAllOwnedTabs(): Promise<number> {
  let count = 0;
  for (const [id, managed] of pages) {
    if (managed.owned) {
      try {
        await managed.page.close();
        count++;
      } catch { /* already closed */ }
      pages.delete(id);
    }
  }
  return count;
}

/**
 * Get the number of managed pages.
 */
export function pageCount(): number {
  return pages.size;
}
