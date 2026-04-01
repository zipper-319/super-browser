/**
 * Candidate target generator - combines PageState, SiteProfile, and NetworkMonitorState
 * to produce a ranked list of candidate actions for a given task goal.
 */

import type { PageState, InteractiveElement } from '../page-state/types.js';
import type { SiteProfile } from '../site-intel/schemas/site-profile.js';
import type { CandidateTarget, TaskGoal, TaskIntent } from './types.js';
import type { MonitorState } from '../network/types.js';

export interface GeneratorInput {
  goal: TaskGoal;
  pageState: PageState;
  siteProfile?: SiteProfile | null;
  networkState?: MonitorState | null;
}

/**
 * Generate ranked candidate targets for the given goal and context.
 */
export function generateCandidates(input: GeneratorInput): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];

  if (input.siteProfile) {
    candidates.push(...fromSiteProfile(input.goal, input.siteProfile));
  }

  if (input.siteProfile?.api_profiles) {
    candidates.push(...fromApiProfiles(input.goal, input.siteProfile));
  }

  if (input.networkState) {
    candidates.push(...fromNetworkPatterns(input.goal, input.networkState));
  }

  candidates.push(...fromPageState(input.goal, input.pageState));

  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    const key = candidate.ref != null
      ? `ref:${candidate.ref}`
      : candidate.api_profile
        ? `api:${candidate.api_profile}`
        : candidate.selector
          ? `selector:${candidate.action}:${candidate.selector}`
          : candidate.url
            ? `url:${candidate.action}:${candidate.url}`
            : `${candidate.action}:${candidate.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => a.priority - b.priority);
  return deduped;
}

function fromSiteProfile(goal: TaskGoal, profile: SiteProfile): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];

  if (goal.intent === 'search' && profile.url_templates?.search && goal.target) {
    candidates.push({
      action: 'navigate',
      url: applyUrlTemplate(profile.url_templates.search, goal.target),
      reason: `Site profile search URL template: ${profile.url_templates.search}`,
      priority: 0,
      source: 'site-profile',
    });
  }

  if (!profile.selectors) {
    return candidates;
  }

  for (const [name, entry] of Object.entries(profile.selectors)) {
    const relevance = selectorRelevance(name, goal.intent);
    if (relevance <= 0) continue;

    candidates.push({
      action: inferActionFromSelector(name),
      selector: entry.selector,
      reason: `Site profile selector "${name}": ${entry.purpose}`,
      priority: 2 - relevance,
      source: 'site-profile',
    });
  }

  return candidates;
}

function fromApiProfiles(goal: TaskGoal, profile: SiteProfile): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];
  if (!profile.api_profiles) return candidates;

  for (const api of profile.api_profiles) {
    const relevance = apiRelevance(api.purpose, api.name, goal);
    if (relevance <= 0) continue;

    candidates.push({
      api_profile: api.name,
      action: 'api-call',
      reason: `API profile "${api.name}": ${api.purpose}`,
      priority: 1,
      source: 'api-profile',
    });
  }

  return candidates;
}

function fromNetworkPatterns(goal: TaskGoal, state: MonitorState): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];
  const businessRequests = state.requests.filter((request) => request.isBusinessApi);
  if (businessRequests.length === 0) return candidates;

  for (const request of businessRequests) {
    if (goal.intent === 'search' && /search|query|keyword/i.test(request.url)) {
      candidates.push({
        action: 'api-call',
        reason: `Discovered search API: ${request.method} ${truncateUrl(request.url)}`,
        priority: 1,
        source: 'heuristic',
      });
    }

    if (goal.intent === 'extract' && /list|items|products|goods/i.test(request.url)) {
      candidates.push({
        action: 'api-call',
        reason: `Discovered list API: ${request.method} ${truncateUrl(request.url)}`,
        priority: 1,
        source: 'heuristic',
      });
    }
  }

  return candidates;
}

function fromPageState(goal: TaskGoal, pageState: PageState): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];
  const elements = pageState.interactive_elements;

  switch (goal.intent) {
    case 'search':
      candidates.push(...findSearchCandidates(elements));
      break;
    case 'paginate':
      candidates.push(...findPaginationCandidates(elements, pageState));
      break;
    case 'click':
      candidates.push(...findClickCandidates(elements, goal));
      break;
    case 'fill-form':
      candidates.push(...findFormCandidates(elements));
      break;
    case 'extract':
      candidates.push(...findExtractCandidates(elements));
      break;
    case 'login':
      candidates.push(...findLoginCandidates(pageState));
      break;
    default:
      candidates.push(...findGenericCandidates(elements));
      break;
  }

  return candidates;
}

function findSearchCandidates(elements: InteractiveElement[]): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];

  const searchInputs = elements.filter((element) =>
    element.role === 'input' && (
      /search|query|keyword|搜索|查询|关键词/i.test(element.text + (element.name || ''))
      || element.selector.includes('search')
    ),
  );
  for (const element of searchInputs) {
    candidates.push({
      ref: element.ref,
      action: 'type',
      reason: `Search input: "${element.text || element.name}"`,
      priority: 3,
      source: 'page-state',
    });
  }

  const searchButtons = elements.filter((element) =>
    (element.role === 'button' || element.role === 'clickable')
    && /search|搜索|查找|查询|go/i.test(element.text),
  );
  for (const element of searchButtons) {
    candidates.push({
      ref: element.ref,
      action: 'click',
      reason: `Search button: "${element.text}"`,
      priority: 4,
      source: 'page-state',
    });
  }

  return candidates;
}

function findPaginationCandidates(elements: InteractiveElement[], pageState: PageState): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];
  const paginationContext = pageState.context_blocks.find((block) => block.type === 'pagination');

  const nextButtons = elements.filter((element) =>
    /next|下一页|下页|后页|>>/i.test(element.text) || element.selector.includes('next'),
  );
  for (const element of nextButtons) {
    candidates.push({
      ref: element.ref,
      action: 'click',
      reason: `Next page button: "${element.text}"${paginationContext ? ` (${paginationContext.text})` : ''}`,
      priority: 3,
      source: 'page-state',
    });
  }

  candidates.push({
    action: 'scroll',
    reason: 'Scroll down to trigger lazy-load pagination',
    priority: 5,
    source: 'heuristic',
  });

  return candidates;
}

function findClickCandidates(elements: InteractiveElement[], goal: TaskGoal): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];
  if (!goal.target) return candidates;

  const query = goal.target.toLowerCase();
  const matches = elements.filter((element) =>
    element.visible && (
      element.text.toLowerCase().includes(query)
      || (element.name || '').toLowerCase().includes(query)
    ),
  );

  for (const element of matches) {
    candidates.push({
      ref: element.ref,
      action: 'click',
      reason: `Text match "${element.text}" for target "${goal.target}"`,
      priority: 3,
      source: 'page-state',
    });
  }

  return candidates;
}

function findFormCandidates(elements: InteractiveElement[]): CandidateTarget[] {
  const candidates: CandidateTarget[] = [];

  const inputs = elements.filter((element) =>
    element.role === 'input' || element.role === 'textarea' || element.role === 'select',
  );
  for (const element of inputs) {
    candidates.push({
      ref: element.ref,
      action: element.role === 'select' ? 'select' : 'type',
      reason: `Form field: "${element.text || element.name}" (${element.role})`,
      priority: 4,
      source: 'page-state',
    });
  }

  const submitButtons = elements.filter((element) =>
    element.role === 'button' && /submit|提交|确定|保存|save|confirm/i.test(element.text),
  );
  for (const element of submitButtons) {
    candidates.push({
      ref: element.ref,
      action: 'click',
      reason: `Submit button: "${element.text}"`,
      priority: 5,
      source: 'page-state',
    });
  }

  return candidates;
}

function findExtractCandidates(elements: InteractiveElement[]): CandidateTarget[] {
  const links = elements.filter((element) => element.role === 'link' && element.visible && element.text.length > 3);
  if (links.length === 0) return [];

  return [{
    action: 'extract',
    reason: `${links.length} visible links available for extraction`,
    priority: 3,
    source: 'page-state',
  }];
}

function findLoginCandidates(pageState: PageState): CandidateTarget[] {
  const loginContext = pageState.context_blocks.find((block) => block.type === 'login-prompt');
  if (!loginContext) return [];

  return [{
    action: 'wait',
    reason: `Login required: ${loginContext.text}`,
    priority: 0,
    source: 'page-state',
  }];
}

function findGenericCandidates(elements: InteractiveElement[]): CandidateTarget[] {
  return elements
    .filter((element) => element.visible)
    .slice(0, 10)
    .map((element, index) => ({
      ref: element.ref,
      action: inferActionFromRole(element.role),
      reason: `Visible ${element.role}: "${element.text}"`,
      priority: 5 + index,
      source: 'page-state' as const,
    }));
}

function selectorRelevance(name: string, intent: TaskIntent): number {
  const map: Record<string, TaskIntent[]> = {
    search_input: ['search'],
    search_button: ['search'],
    product_list: ['extract'],
    product_card: ['extract'],
    pagination: ['paginate'],
    next_page: ['paginate'],
    filter: ['search'],
    login: ['login'],
  };

  const lower = name.toLowerCase();
  for (const [pattern, intents] of Object.entries(map)) {
    if (lower.includes(pattern) && intents.includes(intent)) {
      return 1;
    }
  }
  return 0;
}

function inferActionFromSelector(name: string): CandidateTarget['action'] {
  if (/input|search_input|query/i.test(name)) return 'type';
  if (/list|card|product|result/i.test(name)) return 'extract';
  return 'click';
}

function inferActionFromRole(role: string): CandidateTarget['action'] {
  switch (role) {
    case 'link':
    case 'button':
    case 'tab':
    case 'menuitem':
    case 'clickable':
      return 'click';
    case 'input':
    case 'textarea':
      return 'type';
    case 'select':
    case 'checkbox':
    case 'radio':
      return 'select';
    default:
      return 'click';
  }
}

function apiRelevance(purpose: string, name: string, goal: TaskGoal): number {
  const combined = `${purpose} ${name}`.toLowerCase();
  if (goal.intent === 'search' && /search|query/i.test(combined)) return 1;
  if (goal.intent === 'extract' && /list|items|detail|products/i.test(combined)) return 1;
  if (goal.intent === 'paginate' && /list|page|items/i.test(combined)) return 1;
  if (goal.target && combined.includes(goal.target.toLowerCase())) return 1;
  return 0;
}

function truncateUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname.slice(0, 60)}`;
  } catch {
    return url.slice(0, 80);
  }
}

function applyUrlTemplate(template: string, target: string): string {
  const encoded = encodeURIComponent(target);
  return template
    .replace(/\{query\}/gi, encoded)
    .replace(/\{keyword\}/gi, encoded)
    .replace(/\{q\}/gi, encoded)
    .replace(/\{search\}/gi, encoded)
    .replace(/\{kw\}/gi, encoded);
}
