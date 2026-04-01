/**
 * Model input protocol builder for browser decisions.
 * Produces a compact, goal-aware snapshot that is safer for LLM consumption
 * than exposing raw selectors or full-page DOM.
 */

import { summarizeDiff } from '../page-state/state-diff.js';
import type {
  PageState,
  InteractiveElement,
  ContextBlock,
  ElementState,
  PageOverlay,
} from '../page-state/types.js';
import type { MonitorState, CapturedRequest } from '../network/types.js';
import type { SiteProfile } from '../site-intel/schemas/site-profile.js';
import type { ExperienceRecord, ActionRecord } from '../site-intel/experience-recorder.js';
import type { CandidateTarget, ActionProposal, TaskGoal } from './types.js';

export type ModelInputMode = 'act' | 'extract' | 'validate';
export type ModelCompression = 'compact' | 'goal-focused' | 'visual-assisted';

export interface DecisionTaskContext {
  intent: TaskGoal['intent'];
  goal: string;
  success_criteria: string[];
  termination_criteria: string[];
  output_schema: string[] | null;
  constraints: string[];
}

export interface DecisionHistoryAction {
  action: string;
  target_ref?: string;
  input?: string | string[];
  result: 'success' | 'failed' | 'unknown';
  reason?: string;
}

export interface DecisionHistoryContext {
  step: number;
  recent_actions: DecisionHistoryAction[];
  last_delta_summary: string[];
  failure_hints: string[];
}

export interface DecisionPageStatus {
  url: string;
  title: string;
  ready_state: PageState['page_meta']['readyState'];
  viewport: PageState['page_meta']['viewport'];
  pages_above: number;
  pages_below: number;
  loading_state: NonNullable<PageState['page_meta']['loadingState']>;
  active_overlay: PageOverlay | null;
  pending_requests: number;
}

export interface DecisionContextPreview {
  type: ContextBlock['type'];
  text: string;
  container?: string;
}

export interface DecisionInteractiveRef {
  ref: string;
  role: InteractiveElement['role'];
  label: string;
  text: string;
  state: ElementState | Record<string, never>;
  container?: string;
  visible: boolean;
  position_hint: string;
}

export interface DecisionPageContext {
  blocks: DecisionContextPreview[];
}

export interface DecisionInteractiveRefs {
  compression: ModelCompression;
  refs: DecisionInteractiveRef[];
}

export interface DecisionPageDelta {
  url_changed: boolean;
  title_changed: boolean;
  added_refs: string[];
  removed_refs: string[];
  changed_refs: string[];
  new_context: string[];
}

export interface DecisionPageView {
  status: DecisionPageStatus;
  context: DecisionPageContext;
  interactive_refs: DecisionInteractiveRefs;
  delta: DecisionPageDelta;
}

export interface DecisionCandidateView {
  id: string;
  action: CandidateTarget['action'];
  target_ref?: string;
  reason: string;
  confidence: number;
  source: CandidateTarget['source'];
}

export interface DecisionVerificationView {
  must_check: string[];
  success_signals: string[];
  failure_signals: string[];
}

export interface DecisionScopedDomArtifact {
  selector: string;
  reason: string;
  preview: string;
}

export interface DecisionNetworkArtifact {
  method: string;
  url: string;
  status: number;
  classification: CapturedRequest['classification'];
}

export interface DecisionArtifacts {
  visual_snapshot: string | null;
  scoped_dom: DecisionScopedDomArtifact[];
  network_summary: DecisionNetworkArtifact[];
  notes: string[];
}

export interface DecisionModelInputProtocol {
  protocol_version: 'sb.v2';
  mode: ModelInputMode;
  task: DecisionTaskContext;
  history: DecisionHistoryContext;
  page: DecisionPageView;
  candidates: DecisionCandidateView[];
  verification: DecisionVerificationView;
  artifacts: DecisionArtifacts;
}

export interface BuildDecisionModelInputOptions {
  goal: TaskGoal;
  pageState: PageState;
  candidates?: CandidateTarget[];
  proposals?: ActionProposal[];
  networkState?: MonitorState | null;
  siteProfile?: SiteProfile | null;
  recording?: ExperienceRecord | null;
  mode?: ModelInputMode;
  maxRefs?: number;
  includeVisual?: boolean;
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'of',
  'on', 'or', 'the', 'to', 'with', 'page', 'open', 'click', 'find', 'show', 'use',
  'go', 'new', 'item', 'result', 'results', 'button', 'link',
]);

const CONTEXT_PRIORITY: Record<ContextBlock['type'], number> = {
  error: 0,
  'login-prompt': 1,
  notification: 2,
  status: 3,
  heading: 4,
  summary: 5,
  pagination: 6,
  breadcrumb: 7,
  filter: 8,
  label: 9,
};

export function buildDecisionModelInput(
  options: BuildDecisionModelInputOptions,
): DecisionModelInputProtocol {
  const mode = options.mode ?? 'act';
  const includeVisual = options.includeVisual ?? false;
  const compression = includeVisual ? 'visual-assisted' : mode === 'extract' ? 'compact' : 'goal-focused';
  const selectedRefs = selectInteractiveRefs(
    options.pageState,
    options.goal,
    options.candidates ?? [],
    options.maxRefs ?? 18,
  );

  return {
    protocol_version: 'sb.v2',
    mode,
    task: buildTaskContext(options.goal, options.siteProfile, options.pageState),
    history: buildHistoryContext(options.pageState, options.recording, options.siteProfile),
    page: buildPageView(options.pageState, selectedRefs, options.networkState, compression),
    candidates: buildCandidateViews(options.candidates ?? []),
    verification: buildVerificationView(
      options.goal,
      options.pageState,
      options.proposals ?? [],
      options.siteProfile,
    ),
    artifacts: buildArtifacts(options.pageState, options.networkState, options.siteProfile),
  };
}

export function renderDecisionModelInput(input: DecisionModelInputProtocol): string {
  const lines: string[] = [];

  lines.push('[Task]');
  lines.push(`Mode: ${input.mode}`);
  lines.push(`Intent: ${input.task.intent}`);
  lines.push(`Goal: ${input.task.goal}`);
  if (input.task.success_criteria.length > 0) {
    lines.push('Success:');
    for (const item of input.task.success_criteria) {
      lines.push(`- ${item}`);
    }
  }
  if (input.task.termination_criteria.length > 0) {
    lines.push('Stop if:');
    for (const item of input.task.termination_criteria) {
      lines.push(`- ${item}`);
    }
  }
  if (input.task.constraints.length > 0) {
    lines.push('Constraints:');
    for (const item of input.task.constraints) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('[History]');
  lines.push(`Step: ${input.history.step}`);
  if (input.history.recent_actions.length > 0) {
    for (const action of input.history.recent_actions) {
      const target = action.target_ref ? ` ${action.target_ref}` : '';
      const value = action.input
        ? ` input=${Array.isArray(action.input) ? action.input.join(', ') : action.input}`
        : '';
      lines.push(`- ${action.action}${target}${value} -> ${action.result}`);
    }
  } else {
    lines.push('- No recorded actions yet');
  }
  if (input.history.last_delta_summary.length > 0) {
    lines.push('Recent delta:');
    for (const item of input.history.last_delta_summary) {
      lines.push(`- ${item}`);
    }
  }
  if (input.history.failure_hints.length > 0) {
    lines.push('Failure hints:');
    for (const item of input.history.failure_hints) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('[Page Status]');
  lines.push(`URL: ${input.page.status.url}`);
  lines.push(`Title: ${input.page.status.title}`);
  lines.push(`Ready: ${input.page.status.ready_state}`);
  lines.push(`Loading: ${input.page.status.loading_state}`);
  lines.push(
    `Viewport: ${input.page.status.viewport.width}x${input.page.status.viewport.height}`,
  );
  lines.push(
    `Scroll window: ${input.page.status.pages_above.toFixed(1)} pages above, ${input.page.status.pages_below.toFixed(1)} pages below`,
  );
  lines.push(`Recent network activity: ${input.page.status.pending_requests}`);
  if (input.page.status.active_overlay) {
    lines.push(
      `Active overlay: ${input.page.status.active_overlay.type} "${input.page.status.active_overlay.text}"`,
    );
  }

  lines.push('');
  lines.push('[Context]');
  if (input.page.context.blocks.length > 0) {
    for (const block of input.page.context.blocks) {
      lines.push(`- ${block.type}: ${block.text}`);
    }
  } else {
    lines.push('- No high-signal context blocks detected');
  }

  lines.push('');
  lines.push(`[Relevant Refs | ${input.page.interactive_refs.compression}]`);
  if (input.page.interactive_refs.refs.length > 0) {
    for (const ref of input.page.interactive_refs.refs) {
      const state = Object.keys(ref.state).length > 0
        ? ` state=${formatStateForLine(ref.state)}`
        : '';
      const container = ref.container ? ` container=${ref.container}` : '';
      lines.push(
        `- [${ref.ref}] ${ref.role} "${ref.label}"${ref.text && ref.text !== ref.label ? ` text="${ref.text}"` : ''}${state}${container} visible=${ref.visible} pos=${ref.position_hint}`,
      );
    }
  } else {
    lines.push('- No relevant interactive refs selected');
  }

  lines.push('');
  lines.push('[Delta]');
  const deltaLines = renderDeltaLines(input.page.delta);
  if (deltaLines.length > 0) {
    for (const item of deltaLines) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('- No previous page delta available');
  }

  lines.push('');
  lines.push('[Candidates]');
  if (input.candidates.length > 0) {
    for (const candidate of input.candidates) {
      const target = candidate.target_ref ? ` ${candidate.target_ref}` : '';
      lines.push(
        `- [${candidate.id}] ${candidate.action}${target} confidence=${candidate.confidence.toFixed(2)} source=${candidate.source}: ${candidate.reason}`,
      );
    }
  } else {
    lines.push('- No precomputed candidates');
  }

  lines.push('');
  lines.push('[Verification]');
  if (input.verification.must_check.length > 0) {
    lines.push('Must check:');
    for (const item of input.verification.must_check) {
      lines.push(`- ${item}`);
    }
  }
  if (input.verification.success_signals.length > 0) {
    lines.push('Success signals:');
    for (const item of input.verification.success_signals) {
      lines.push(`- ${item}`);
    }
  }
  if (input.verification.failure_signals.length > 0) {
    lines.push('Failure signals:');
    for (const item of input.verification.failure_signals) {
      lines.push(`- ${item}`);
    }
  }

  lines.push('');
  lines.push('[Artifacts]');
  lines.push(`Visual snapshot: ${input.artifacts.visual_snapshot ?? 'none'}`);
  if (input.artifacts.scoped_dom.length > 0) {
    lines.push('Scoped DOM:');
    for (const item of input.artifacts.scoped_dom) {
      lines.push(`- ${item.reason} (${item.selector}): ${item.preview}`);
    }
  }
  if (input.artifacts.network_summary.length > 0) {
    lines.push('Network summary:');
    for (const item of input.artifacts.network_summary) {
      lines.push(`- ${item.method} ${item.url} -> ${item.status} [${item.classification}]`);
    }
  }
  if (input.artifacts.notes.length > 0) {
    lines.push('Notes:');
    for (const item of input.artifacts.notes) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join('\n');
}

function buildTaskContext(
  goal: TaskGoal,
  siteProfile: SiteProfile | null | undefined,
  pageState: PageState,
): DecisionTaskContext {
  const taskGoal = [goal.description.trim(), goal.target?.trim()].filter(Boolean).join(' ').trim()
    || `${goal.intent} on ${pageState.page_meta.title || pageState.page_meta.url}`;
  const successCriteria = inferSuccessCriteria(goal, pageState);
  const terminationCriteria = inferTerminationCriteria(goal, pageState, siteProfile);
  const constraints = inferConstraints(goal, pageState, siteProfile);

  return {
    intent: goal.intent,
    goal: taskGoal,
    success_criteria: successCriteria,
    termination_criteria: terminationCriteria,
    output_schema: goal.intent === 'extract' ? ['title', 'url'] : null,
    constraints,
  };
}

function buildHistoryContext(
  pageState: PageState,
  recording: ExperienceRecord | null | undefined,
  siteProfile: SiteProfile | null | undefined,
): DecisionHistoryContext {
  const recentActions = (recording?.action_chain ?? [])
    .slice(-4)
    .map(mapRecordedAction);

  const lastDeltaSummary = buildDeltaSummary(pageState);
  const failureHints = buildFailureHints(pageState, recording, siteProfile);

  return {
    step: (recording?.action_chain.length ?? 0) + 1,
    recent_actions: recentActions,
    last_delta_summary: lastDeltaSummary,
    failure_hints: failureHints,
  };
}

function buildPageView(
  pageState: PageState,
  refs: InteractiveElement[],
  networkState: MonitorState | null | undefined,
  compression: ModelCompression,
): DecisionPageView {
  return {
    status: {
      url: pageState.page_meta.url,
      title: pageState.page_meta.title,
      ready_state: pageState.page_meta.readyState,
      viewport: pageState.page_meta.viewport,
      pages_above: pageState.page_meta.pagesAbove ?? 0,
      pages_below: pageState.page_meta.pagesBelow ?? 0,
      loading_state: pageState.page_meta.loadingState ?? inferLoadingState(pageState),
      active_overlay: pageState.page_meta.activeOverlay ?? null,
      pending_requests: estimatePendingRequests(networkState),
    },
    context: {
      blocks: pageState.context_blocks
        .slice()
        .sort((a, b) => (CONTEXT_PRIORITY[a.type] ?? 99) - (CONTEXT_PRIORITY[b.type] ?? 99))
        .slice(0, 8)
        .map((block) => ({
          type: block.type,
          text: block.text,
          container: block.container,
        })),
    },
    interactive_refs: {
      compression,
      refs: refs.map((element) => ({
        ref: toRefId(element.ref),
        role: element.role,
        label: bestLabel(element),
        text: element.text,
        state: element.state ?? {},
        container: element.container,
        visible: element.visible,
        position_hint: positionHint(element, pageState.page_meta.viewport),
      })),
    },
    delta: {
      url_changed: pageState.state_diff?.url_changed ?? false,
      title_changed: pageState.state_diff?.title_changed ?? false,
      added_refs: (pageState.state_diff?.added_elements ?? []).map(toRefId),
      removed_refs: (pageState.state_diff?.removed_elements ?? []).map(toRefId),
      changed_refs: (pageState.state_diff?.changed_elements ?? []).map(toRefId),
      new_context: pageState.state_diff?.new_context ?? [],
    },
  };
}

function buildCandidateViews(candidates: CandidateTarget[]): DecisionCandidateView[] {
  return candidates.slice(0, 8).map((candidate, index) => ({
    id: `c${index + 1}`,
    action: candidate.action,
    target_ref: candidate.ref != null ? toRefId(candidate.ref) : undefined,
    reason: candidate.reason,
    confidence: scoreCandidateConfidence(candidate),
    source: candidate.source,
  }));
}

function buildVerificationView(
  goal: TaskGoal,
  pageState: PageState,
  proposals: ActionProposal[],
  siteProfile: SiteProfile | null | undefined,
): DecisionVerificationView {
  const mustCheck = proposals
    .slice(0, 3)
    .map((proposal) => describeVerification(proposal))
    .filter(Boolean);

  if (mustCheck.length === 0) {
    mustCheck.push(defaultMustCheck(goal));
  }

  const successSignals = new Set<string>();
  for (const signal of siteProfile?.verification_signals ?? []) {
    successSignals.add(`${signal.after_action}: expect ${signal.expect}`);
  }

  for (const block of pageState.context_blocks) {
    if (block.type === 'summary' || block.type === 'heading' || block.type === 'pagination') {
      successSignals.add(`${block.type}: ${block.text}`);
    }
  }

  const failureSignals = new Set<string>();
  failureSignals.add('The page remains unchanged after the action');
  if (pageState.page_meta.activeOverlay) {
    failureSignals.add(`Blocking overlay remains visible: ${pageState.page_meta.activeOverlay.text}`);
  }
  for (const block of pageState.context_blocks) {
    if (block.type === 'error' || block.type === 'login-prompt') {
      failureSignals.add(block.text);
    }
  }
  for (const trap of siteProfile?.known_traps ?? []) {
    failureSignals.add(trap.workaround
      ? `${trap.description} (workaround: ${trap.workaround})`
      : trap.description);
  }

  return {
    must_check: mustCheck.slice(0, 5),
    success_signals: Array.from(successSignals).slice(0, 6),
    failure_signals: Array.from(failureSignals).slice(0, 6),
  };
}

function buildArtifacts(
  pageState: PageState,
  networkState: MonitorState | null | undefined,
  siteProfile: SiteProfile | null | undefined,
): DecisionArtifacts {
  const scopedDom = (pageState.scoped_dom ?? []).slice(0, 3).map((item) => ({
    selector: item.selector,
    reason: item.reason,
    preview: collapseWhitespace(item.html).slice(0, 220),
  }));

  const networkSummary = (networkState?.requests ?? [])
    .filter((request) => request.isBusinessApi)
    .slice(-5)
    .map((request) => ({
      method: request.method,
      url: truncateUrl(request.url),
      status: request.status,
      classification: request.classification,
    }));

  const notes: string[] = [];
  if (pageState.page_meta.loadingState && pageState.page_meta.loadingState !== 'stable') {
    notes.push(`Page is still ${pageState.page_meta.loadingState}`);
  }
  if (siteProfile?.preferred_strategy) {
    notes.push(`Preferred site strategy: ${siteProfile.preferred_strategy}`);
  }
  if (pageState.fallback?.overlay?.text) {
    notes.push(`Fallback overlay detected: ${pageState.fallback.overlay.text}`);
  }
  if (pageState.fallback?.recentRequests?.length) {
    notes.push(`Fallback captured ${pageState.fallback.recentRequests.length} recent requests`);
  }

  return {
    visual_snapshot: pageState.fallback?.screenshotPath ?? null,
    scoped_dom: scopedDom,
    network_summary: networkSummary,
    notes,
  };
}

function selectInteractiveRefs(
  pageState: PageState,
  goal: TaskGoal,
  candidates: CandidateTarget[],
  maxRefs: number,
): InteractiveElement[] {
  const tokens = tokenizeGoal(goal);
  const candidateRefSet = new Set(candidates.flatMap((candidate) => candidate.ref != null ? [candidate.ref] : []));
  const overlayActive = !!pageState.page_meta.activeOverlay;

  return pageState.interactive_elements
    .slice()
    .sort((left, right) => {
      const scoreDelta = scoreInteractiveElement(right, goal, tokens, candidateRefSet, overlayActive)
        - scoreInteractiveElement(left, goal, tokens, candidateRefSet, overlayActive);
      if (scoreDelta !== 0) return scoreDelta;
      return left.ref - right.ref;
    })
    .slice(0, maxRefs);
}

function scoreInteractiveElement(
  element: InteractiveElement,
  goal: TaskGoal,
  tokens: string[],
  candidateRefSet: Set<number>,
  overlayActive: boolean,
): number {
  let score = 0;

  if (candidateRefSet.has(element.ref)) score += 40;
  if (element.visible) score += 12;
  if (element.state?.disabled) score -= 8;

  const text = `${element.text} ${element.name ?? ''} ${element.state?.value ?? ''}`.toLowerCase();
  const tokenMatches = tokens.filter((token) => text.includes(token)).length;
  score += tokenMatches * 8;

  switch (goal.intent) {
    case 'search':
      if (element.role === 'input' || element.role === 'textarea') score += 12;
      if (element.container === 'header' || element.container === 'form') score += 8;
      break;
    case 'fill-form':
    case 'login':
      if (element.container === 'form' || element.container === 'dialog') score += 10;
      if (element.role === 'input' || element.role === 'textarea' || element.role === 'select') score += 8;
      break;
    case 'paginate':
      if (element.container === 'nav' || element.container === 'main') score += 6;
      break;
    case 'extract':
      if (element.role === 'link' || element.container === 'main') score += 5;
      break;
    default:
      if (element.role === 'button' || element.role === 'link') score += 4;
      break;
  }

  if (overlayActive) {
    if (element.container === 'dialog') score += 12;
    else score -= 4;
  }

  if (element.bbox) {
    if (element.bbox.y >= 0 && element.bbox.y <= 900) score += 3;
    if (element.bbox.height > 28) score += 1;
  }

  return score;
}

function buildDeltaSummary(pageState: PageState): string[] {
  if (!pageState.state_diff) return [];

  const lines: string[] = [];
  const summary = summarizeDiff(pageState.state_diff);
  if (summary && summary !== 'no changes') {
    lines.push(summary);
  }
  if (pageState.state_diff.new_context.length > 0) {
    lines.push(`New context: ${pageState.state_diff.new_context.slice(0, 3).join(' | ')}`);
  }

  return lines;
}

function buildFailureHints(
  pageState: PageState,
  recording: ExperienceRecord | null | undefined,
  siteProfile: SiteProfile | null | undefined,
): string[] {
  const hints = new Set<string>();

  const failedActions = (recording?.action_chain ?? [])
    .filter((action) => action.result === 'failed')
    .slice(-3);
  for (const action of failedActions) {
    hints.add(action.target?.reason
      ? `${action.action} failed: ${action.target.reason}`
      : `${action.action} failed`);
  }

  if (pageState.page_meta.activeOverlay) {
    hints.add(`Active ${pageState.page_meta.activeOverlay.type} may block interaction`);
  }

  for (const block of pageState.context_blocks) {
    if (block.type === 'error' || block.type === 'login-prompt') {
      hints.add(block.text);
    }
  }

  for (const trap of siteProfile?.known_traps ?? []) {
    hints.add(trap.workaround
      ? `${trap.description}. Workaround: ${trap.workaround}`
      : trap.description);
  }

  return Array.from(hints).slice(0, 5);
}

function mapRecordedAction(action: ActionRecord): DecisionHistoryAction {
  return {
    action: action.action,
    target_ref: action.target?.ref != null ? toRefId(action.target.ref) : undefined,
    input: action.value,
    result: action.result ?? 'unknown',
    reason: action.target?.reason,
  };
}

function inferSuccessCriteria(goal: TaskGoal, pageState: PageState): string[] {
  switch (goal.intent) {
    case 'search':
      return [
        goal.target
          ? `Visible results or headings clearly relate to "${goal.target}"`
          : 'The page reflects the submitted search intent',
        'A search result list or search summary becomes visible',
      ];
    case 'navigate':
      return [
        'The page URL or title changes to the intended destination',
        'A destination-specific heading or primary content appears',
      ];
    case 'extract':
      return [
        'Relevant content can be read from visible page content or structured DOM',
        'The extracted fields are available without guessing hidden state',
      ];
    case 'fill-form':
      return [
        'The intended form fields contain the provided values',
        'The page shows the form is ready for submission',
      ];
    case 'paginate':
      return [
        'A new page of results or items is visible',
        'Pagination controls or summaries reflect the new page',
      ];
    case 'login':
      return [
        'Authenticated UI becomes visible or the login prompt disappears',
        'The page no longer blocks the task behind a login form',
      ];
    case 'click':
      return [
        goal.target
          ? `An element matching "${goal.target}" is activated`
          : 'The intended clickable target is activated',
        'The page state changes in a meaningful way afterward',
      ];
    default:
      return [
        `The page advances toward: ${goal.description || goal.intent}`,
        `The current page title "${pageState.page_meta.title}" no longer looks stuck`,
      ];
  }
}

function inferTerminationCriteria(
  goal: TaskGoal,
  pageState: PageState,
  siteProfile: SiteProfile | null | undefined,
): string[] {
  const criteria = new Set<string>();
  criteria.add('A blocking error, anti-bot gate, or modal prevents further progress');
  criteria.add('Repeated actions produce no meaningful page change');

  if (siteProfile?.requires_login || pageState.context_blocks.some((block) => block.type === 'login-prompt')) {
    criteria.add('The site requires login and the current session cannot continue');
  }
  if (goal.intent === 'search') {
    criteria.add('The page clearly reports no results for the query');
  }

  return Array.from(criteria).slice(0, 4);
}

function inferConstraints(
  goal: TaskGoal,
  pageState: PageState,
  siteProfile: SiteProfile | null | undefined,
): string[] {
  const constraints = new Set<string>();

  if (goal.target) {
    constraints.add(`Prefer elements whose text, label, or state clearly matches "${goal.target}"`);
  }
  if (pageState.page_meta.activeOverlay) {
    constraints.add('Resolve the active overlay before interacting with the underlying page');
  }
  if (pageState.page_meta.loadingState && pageState.page_meta.loadingState !== 'stable') {
    constraints.add('Avoid acting until loading indicators settle unless the task is to dismiss them');
  }
  if (siteProfile?.preferred_strategy) {
    constraints.add(`Follow the site preference: ${siteProfile.preferred_strategy}`);
  }

  return Array.from(constraints).slice(0, 4);
}

function inferLoadingState(pageState: PageState): NonNullable<PageState['page_meta']['loadingState']> {
  if (pageState.page_meta.readyState !== 'complete') return 'loading';
  return 'stable';
}

function estimatePendingRequests(networkState: MonitorState | null | undefined): number {
  if (!networkState || networkState.requests.length === 0) return 0;
  const latestTimestamp = Math.max(...networkState.requests.map((request) => request.timestamp));
  return networkState.requests.filter((request) => latestTimestamp - request.timestamp <= 2_000).length;
}

function describeVerification(proposal: ActionProposal): string {
  const { params, verification } = proposal;
  switch (verification.check) {
    case 'url_changed':
      return `${params.type}: confirm the URL changes from ${verification.value}`;
    case 'url_contains':
      return `${params.type}: confirm the URL contains ${verification.value}`;
    case 'selector_exists':
      return `${params.type}: confirm selector ${verification.value} appears`;
    case 'selector_absent':
      return `${params.type}: confirm selector ${verification.value} disappears`;
    case 'text_contains':
      return `${params.type}: confirm page text includes ${verification.value}`;
    case 'network_response':
      return `${params.type}: confirm a network response reaches ${verification.value}`;
    case 'eval_truthy':
      return `${params.type}: confirm the expected DOM state becomes truthy`;
    case 'element_count_changed':
      return `${params.type}: confirm the target element count changes`;
    default:
      return `${params.type}: run the configured verification`;
  }
}

function defaultMustCheck(goal: TaskGoal): string {
  switch (goal.intent) {
    case 'search':
      return 'Confirm the page now shows search results or a search summary';
    case 'extract':
      return 'Confirm the relevant data fields are visible and extractable';
    case 'paginate':
      return 'Confirm the result set or page number has changed';
    default:
      return 'Confirm the page meaningfully changed after the action';
  }
}

function tokenizeGoal(goal: TaskGoal): string[] {
  const raw = `${goal.description} ${goal.target ?? ''}`.toLowerCase();
  const tokens = raw
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));

  return Array.from(new Set(tokens)).slice(0, 12);
}

function bestLabel(element: InteractiveElement): string {
  if (element.role === 'input' || element.role === 'textarea' || element.role === 'select') {
    return (element.name || element.text || element.tag).trim();
  }
  return (element.text || element.name || element.tag).trim();
}

function positionHint(
  element: InteractiveElement,
  viewport: PageState['page_meta']['viewport'],
): string {
  if (!element.visible || !element.bbox) return 'offscreen';

  const centerX = element.bbox.x + element.bbox.width / 2;
  const centerY = element.bbox.y + element.bbox.height / 2;
  const horizontal = centerX < viewport.width / 3
    ? 'left'
    : centerX > viewport.width * 2 / 3
      ? 'right'
      : 'center';
  const vertical = centerY < viewport.height / 3
    ? 'top'
    : centerY > viewport.height * 2 / 3
      ? 'bottom'
      : 'mid';

  return `${vertical}-${horizontal}`;
}

function scoreCandidateConfidence(candidate: CandidateTarget): number {
  const sourceBonus: Record<CandidateTarget['source'], number> = {
    'site-profile': 0.2,
    'api-profile': 0.16,
    'page-state': 0.1,
    heuristic: 0.04,
  };
  const base = 0.48 + sourceBonus[candidate.source];
  const priorityPenalty = candidate.priority * 0.08;
  const targetBonus = candidate.ref != null || candidate.selector || candidate.url ? 0.06 : 0;
  return clamp(base + targetBonus - priorityPenalty, 0.2, 0.98);
}

function renderDeltaLines(delta: DecisionPageDelta): string[] {
  const lines: string[] = [];
  if (delta.url_changed) lines.push('URL changed');
  if (delta.title_changed) lines.push('Title changed');
  if (delta.added_refs.length > 0) lines.push(`Added refs: ${delta.added_refs.join(', ')}`);
  if (delta.removed_refs.length > 0) lines.push(`Removed refs: ${delta.removed_refs.join(', ')}`);
  if (delta.changed_refs.length > 0) lines.push(`Changed refs: ${delta.changed_refs.join(', ')}`);
  if (delta.new_context.length > 0) lines.push(`New context: ${delta.new_context.join(' | ')}`);
  return lines;
}

function formatStateForLine(state: ElementState | Record<string, never>): string {
  return Object.entries(state)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}${parsed.search}`.slice(0, 160);
  } catch {
    return url.slice(0, 160);
  }
}

function toRefId(ref: number): string {
  return `r${ref}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
