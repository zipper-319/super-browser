/**
 * Daemon runtime state — coordinates lifecycle and cleanup across modules.
 *
 * Instead of threading a context parameter through every function (too invasive),
 * this module provides:
 *   - Centralized page cleanup (when a page closes, clean all related state)
 *   - Browser disconnect handler (cleans up stale page references)
 *   - initRuntime() for wiring up cross-module lifecycle hooks
 */

import { onDisconnect } from '../browser/connection.js';
import { listPages } from '../browser/tab-manager.js';
import { stopMonitor } from '../network/monitor.js';
import { clearRecording } from '../site-intel/experience-recorder.js';
import { cleanupPageState } from '../server/handlers.js';

let initialized = false;

/**
 * Initialize runtime lifecycle hooks.
 * Called once during daemon startup.
 */
export function initRuntime(): void {
  if (initialized) return;
  initialized = true;

  // When browser disconnects, all page references become stale
  onDisconnect(() => {
    console.log('[runtime] Browser disconnected — cleaning up all page state');
    for (const item of listPages()) {
      cleanupPage(item.pageId);
    }
  });
}

/**
 * Clean up all state associated with a pageId.
 * Called when a page is closed or the daemon shuts down.
 */
export function cleanupPage(pageId: string): void {
  // Stop network monitor (no-ops if not active)
  try { stopMonitor(pageId); } catch { /* ignore */ }

  // Clear experience recording session
  try { clearRecording(pageId); } catch { /* ignore */ }

  // Clear previousStates diff cache
  try { cleanupPageState(pageId); } catch { /* ignore */ }
}
