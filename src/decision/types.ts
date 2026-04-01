/**
 * Decision runtime types — candidate generation, action proposals, verification.
 */

// ---- Candidate target ----

export type CandidateAction = 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'api-call' | 'extract' | 'navigate';
export type CandidateSource = 'site-profile' | 'page-state' | 'api-profile' | 'heuristic';

export interface CandidateTarget {
  /** Interactive element ref (from PageState) */
  ref?: number;
  /** Resolved CSS selector when already known */
  selector?: string;
  /** Resolved URL for navigation or API-style actions */
  url?: string;
  /** API profile name (from SiteProfile) */
  api_profile?: string;
  action: CandidateAction;
  reason: string;
  /** Lower = higher priority */
  priority: number;
  source: CandidateSource;
}

// ---- Action proposal ----

export type ActionParams =
  | { type: 'click'; selector: string }
  | { type: 'click-real'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'select'; selector: string; value: string }
  | { type: 'scroll'; direction: 'up' | 'down'; distance?: number }
  | { type: 'wait'; condition: string; timeout: number }
  | { type: 'api-call'; url: string; method: string }
  | { type: 'extract'; selector: string; fields: string[] }
  | { type: 'navigate'; url: string }
  | { type: 'eval'; code: string };

export interface ActionProposal {
  target: CandidateTarget;
  params: ActionParams;
  verification: VerificationCondition;
  fallback?: ActionProposal;
}

// ---- Verification condition ----

export type VerificationCheck =
  | 'selector_exists'
  | 'selector_absent'
  | 'url_changed'
  | 'url_contains'
  | 'text_contains'
  | 'element_count_changed'
  | 'network_response'
  | 'eval_truthy';

export interface VerificationCondition {
  check: VerificationCheck;
  value: string;
  timeout: number;
}

// ---- Task goal (input to decision layer) ----

export type TaskIntent = 'search' | 'navigate' | 'extract' | 'click' | 'fill-form' | 'paginate' | 'upload' | 'login' | 'generic';

export interface TaskGoal {
  intent: TaskIntent;
  /** Natural language description */
  description: string;
  /** Target keyword or value (e.g., search query, URL, form value) */
  target?: string;
}
