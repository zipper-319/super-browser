/**
 * Network monitor — captures XHR/Fetch responses using Playwright's page.on('response').
 * Manages listener lifecycle properly (can stop without leaking listeners).
 */

import type { Page, Response } from 'playwright-core';
import type { CapturedRequest, MonitorState } from './types.js';
import { classify } from './classifier.js';

const monitors = new Map<string, MonitorInstance>();

interface MonitorInstance {
  state: MonitorState;
  listener: (response: Response) => void;
  page: Page;
}

/**
 * Start monitoring network requests for a page.
 */
export function startMonitor(pageId: string, page: Page): MonitorState {
  // Stop existing monitor if any
  stopMonitor(pageId);

  const state: MonitorState = {
    pageId,
    active: true,
    startedAt: Date.now(),
    requests: [],
    discoveredPatterns: [],
  };

  const listener = async (response: Response) => {
    try {
      const request = response.request();
      const resourceType = request.resourceType();

      // Only capture XHR and Fetch
      if (resourceType !== 'xhr' && resourceType !== 'fetch') return;

      const url = response.url();
      const method = request.method();
      const status = response.status();
      const contentType = response.headers()['content-type'] || '';
      const timing = request.timing();
      const duration = timing.responseEnd > 0 && timing.requestStart > 0
        ? Math.round(timing.responseEnd - timing.requestStart)
        : 0;

      const classification = classify(url, method, contentType, resourceType);

      const captured: CapturedRequest = {
        url,
        method,
        status,
        resourceType,
        contentType,
        bodySize: 0,
        duration,
        isBusinessApi: classification === 'business-api',
        classification,
        timestamp: Date.now(),
      };

      // Try to capture response body for business APIs
      if (classification === 'business-api' && status >= 200 && status < 400) {
        try {
          const body = await response.text();
          captured.bodySize = body.length;
          // Keep truncated body for pattern analysis
          captured.responseBody = body.slice(0, 8000);
        } catch { /* body may not be available */ }
      }

      // Capture POST request body
      if (method === 'POST') {
        try {
          const postData = request.postData();
          if (postData) {
            captured.requestBody = postData.slice(0, 2000);
          }
        } catch { /* may not be available */ }
      }

      state.requests.push(captured);
    } catch {
      // Response may have been disposed, ignore
    }
  };

  page.on('response', listener);

  monitors.set(pageId, { state, listener, page });
  return state;
}

/**
 * Stop monitoring and remove listener.
 */
export function stopMonitor(pageId: string): MonitorState | null {
  const instance = monitors.get(pageId);
  if (!instance) return null;

  instance.state.active = false;
  // Remove the specific listener to avoid leaks
  instance.page.removeListener('response', instance.listener);
  monitors.delete(pageId);

  return instance.state;
}

/**
 * Get current monitor state.
 */
export function getMonitorState(pageId: string): MonitorState | null {
  const instance = monitors.get(pageId);
  return instance?.state ?? null;
}

/**
 * Get captured requests, optionally filtered.
 */
export function getRequests(
  pageId: string,
  filter?: { pattern?: string; businessOnly?: boolean },
): CapturedRequest[] {
  const instance = monitors.get(pageId);
  if (!instance) return [];

  let requests = instance.state.requests;

  if (filter?.businessOnly) {
    requests = requests.filter((r) => r.isBusinessApi);
  }

  if (filter?.pattern) {
    const pat = filter.pattern;
    requests = requests.filter((r) => r.url.includes(pat));
  }

  return requests;
}

/**
 * Check if a monitor is active for a page.
 */
export function isMonitoring(pageId: string): boolean {
  return monitors.get(pageId)?.state.active ?? false;
}

/**
 * Get all active monitor page IDs.
 */
export function activeMonitors(): string[] {
  return Array.from(monitors.keys());
}
