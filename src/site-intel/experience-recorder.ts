/**
 * Experience recorder — captures task execution results for later sedimentation.
 *
 * Records are accumulated per-domain during a session and flushed to
 * profile-updater when the caller decides (e.g., after task completes).
 *
 * Design principles (Section 8.5):
 *   - Only record verified facts (action succeeded + verification passed)
 *   - Each record carries a timestamp for freshness
 *   - Failed attempts are recorded separately for known_traps
 */

import type { ActionProposal, VerificationCondition, CandidateTarget } from '../decision/types.js';
import type { VerifyResult } from '../decision/verifier.js';

// ---- Types ----

export interface SelectorObservation {
  name: string;
  selector: string;
  purpose: string;
  succeeded: boolean;
  /** How the selector was discovered */
  source: 'site-profile' | 'page-state' | 'heuristic';
}

export interface ApiObservation {
  name: string;
  url_pattern: string;
  method: string;
  purpose: string;
  succeeded: boolean;
  /** Response data path if discovered */
  data_path?: string;
  /** Discovered item fields */
  item_fields?: string[];
}

export interface TrapObservation {
  description: string;
  trigger: string;
  workaround?: string;
}

export interface ActionRecord {
  action: string;
  selector?: string;
  value?: string | string[];
  target?: CandidateTarget;
  verification?: VerifyResult;
  result?: 'success' | 'failed' | 'unknown';
  timestamp: string;
}

export interface ExperienceRecord {
  domain: string;
  url: string;
  task_intent: string;
  task_description: string;
  timestamp: string;
  /** Ordered list of actions taken */
  action_chain: ActionRecord[];
  /** Selectors that were tested */
  selector_observations: SelectorObservation[];
  /** API endpoints that were tested */
  api_observations: ApiObservation[];
  /** Traps / failures discovered */
  trap_observations: TrapObservation[];
  /** Overall task outcome */
  outcome: 'success' | 'partial' | 'failure';
}

// ---- In-memory store ----

/** Active recording sessions, keyed by pageId */
const sessions = new Map<string, ExperienceRecord>();

/**
 * Start recording experience for a page/task.
 */
export function startRecording(
  pageId: string,
  domain: string,
  url: string,
  taskIntent: string,
  taskDescription: string,
): ExperienceRecord {
  const record: ExperienceRecord = {
    domain,
    url,
    task_intent: taskIntent,
    task_description: taskDescription,
    timestamp: new Date().toISOString(),
    action_chain: [],
    selector_observations: [],
    api_observations: [],
    trap_observations: [],
    outcome: 'failure', // default, updated on completion
  };
  sessions.set(pageId, record);
  return record;
}

/**
 * Record an action execution result.
 */
export function recordAction(
  pageId: string,
  proposal: ActionProposal,
  verification?: VerifyResult,
): void {
  const session = sessions.get(pageId);
  if (!session) return;

  session.action_chain.push({
    action: proposal.params.type,
    selector: 'selector' in proposal.params ? (proposal.params as any).selector : undefined,
    value: extractActionValue(proposal),
    target: proposal.target,
    verification,
    result: verification ? (verification.passed ? 'success' : 'failed') : 'unknown',
    timestamp: new Date().toISOString(),
  });

  // Extract selector observation
  if ('selector' in proposal.params) {
    const selector = (proposal.params as any).selector as string;
    const succeeded = verification?.passed ?? false;

    session.selector_observations.push({
      name: inferSelectorName(selector, proposal.target),
      selector,
      purpose: proposal.target.reason,
      succeeded,
      source: proposal.target.source === 'site-profile' ? 'site-profile'
        : proposal.target.source === 'page-state' ? 'page-state'
        : 'heuristic',
    });
  }

  // Extract API observation
  if (proposal.params.type === 'api-call') {
    session.api_observations.push({
      name: proposal.target.api_profile || inferApiName(proposal.params.url),
      url_pattern: proposal.params.url,
      method: proposal.params.method,
      purpose: proposal.target.reason,
      succeeded: verification?.passed ?? false,
    });
  }

  // Record trap if verification failed
  if (verification && !verification.passed) {
    session.trap_observations.push({
      description: `${proposal.params.type} failed: ${verification.actual || 'unknown'}`,
      trigger: proposal.target.reason,
      workaround: undefined,
    });
  }
}

/**
 * Mark session outcome and return the completed record.
 */
export function completeRecording(
  pageId: string,
  outcome: ExperienceRecord['outcome'],
): ExperienceRecord | null {
  const session = sessions.get(pageId);
  if (!session) return null;

  session.outcome = outcome;
  return session;
}

/**
 * Get current recording session (without removing it).
 */
export function getRecording(pageId: string): ExperienceRecord | null {
  return sessions.get(pageId) ?? null;
}

/**
 * Remove the session after flushing.
 */
export function clearRecording(pageId: string): void {
  sessions.delete(pageId);
}

/**
 * Get all active recordings.
 */
export function listRecordings(): Array<{ pageId: string; domain: string; outcome: string }> {
  const result: Array<{ pageId: string; domain: string; outcome: string }> = [];
  for (const [pageId, record] of sessions) {
    result.push({ pageId, domain: record.domain, outcome: record.outcome });
  }
  return result;
}

// ---- Helpers ----

function inferSelectorName(selector: string, target: CandidateTarget): string {
  // Try to derive a semantic name from the selector or reason
  const reason = target.reason.toLowerCase();
  if (/search\s*input/i.test(reason)) return 'search_input';
  if (/search\s*button/i.test(reason)) return 'search_button';
  if (/submit/i.test(reason)) return 'submit_button';
  if (/next.*page|pagination/i.test(reason)) return 'next_page';
  if (/product.*list|item.*list/i.test(reason)) return 'product_list';
  if (/product.*card|item.*card/i.test(reason)) return 'product_card';
  if (/login/i.test(reason)) return 'login_form';

  // Fall back to a sanitized version of the selector
  return selector
    .replace(/[#.\[\]='"]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);
}

function inferApiName(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    return segments.slice(-2).join('_') || 'api';
  } catch {
    return 'api';
  }
}

function extractActionValue(proposal: ActionProposal): string | string[] | undefined {
  switch (proposal.params.type) {
    case 'type':
      return proposal.params.text;
    case 'select':
      return proposal.params.value;
    case 'navigate':
    case 'api-call':
      return proposal.params.url;
    case 'extract':
      return proposal.params.fields;
    default:
      return undefined;
  }
}
