/**
 * Action planner - converts a CandidateTarget into a concrete ActionProposal
 * with executable params, verification condition, and optional fallback.
 */

import type { PageState } from '../page-state/types.js';
import type { SiteProfile } from '../site-intel/schemas/site-profile.js';
import type {
  CandidateTarget,
  ActionProposal,
  ActionParams,
  VerificationCondition,
  TaskGoal,
} from './types.js';

export interface PlannerInput {
  goal: TaskGoal;
  candidates: CandidateTarget[];
  pageState: PageState;
  siteProfile?: SiteProfile | null;
}

/**
 * Plan concrete actions for the top candidates.
 * Returns an ordered list of ActionProposals (first = primary, rest = fallbacks).
 */
export function planActions(input: PlannerInput): ActionProposal[] {
  const proposals: ActionProposal[] = [];

  for (const candidate of input.candidates) {
    const proposal = planSingle(candidate, input);
    if (proposal) {
      proposals.push(proposal);
    }
  }

  for (let index = 0; index < proposals.length - 1; index++) {
    proposals[index].fallback = proposals[index + 1];
  }

  return proposals;
}

function planSingle(candidate: CandidateTarget, input: PlannerInput): ActionProposal | null {
  const params = resolveParams(candidate, input);
  if (!params) return null;

  return {
    target: candidate,
    params,
    verification: bindVerification(params, input),
  };
}

function resolveParams(candidate: CandidateTarget, input: PlannerInput): ActionParams | null {
  const { goal, pageState, siteProfile } = input;

  switch (candidate.action) {
    case 'navigate':
      if (!candidate.url) return null;
      return { type: 'navigate', url: candidate.url };

    case 'click': {
      const selector = resolveSelector(candidate, pageState);
      if (!selector) return null;
      return { type: 'click', selector };
    }

    case 'type': {
      const selector = resolveSelector(candidate, pageState);
      if (!selector) return null;
      return { type: 'type', selector, text: goal.target || '' };
    }

    case 'select': {
      const selector = resolveSelector(candidate, pageState);
      if (!selector) return null;
      return { type: 'select', selector, value: goal.target || '' };
    }

    case 'scroll':
      return {
        type: 'scroll',
        direction: 'down',
        distance: 3000,
      };

    case 'wait':
      return {
        type: 'wait',
        condition: candidate.reason,
        timeout: 10_000,
      };

    case 'api-call': {
      if (candidate.api_profile && siteProfile?.api_profiles) {
        const api = siteProfile.api_profiles.find((profile) => profile.name === candidate.api_profile);
        if (api) {
          let url = api.url_pattern;
          if (goal.target) {
            url = url.replace(/\{keyword\}/gi, encodeURIComponent(goal.target));
            url = url.replace(/\{query\}/gi, encodeURIComponent(goal.target));
            url = url.replace(/\{id\}/gi, goal.target);
          }
          return {
            type: 'api-call',
            url,
            method: api.method,
          };
        }
      }

      const urlMatch = candidate.reason.match(/:\s+(\w+)\s+(https?:\/\/\S+)/);
      if (!urlMatch) return null;

      return {
        type: 'api-call',
        url: urlMatch[2],
        method: urlMatch[1],
      };
    }

    case 'extract':
      return {
        type: 'extract',
        selector: resolveExtractSelector(siteProfile),
        fields: inferExtractFields(goal),
      };

    default:
      return null;
  }
}

function resolveSelector(candidate: CandidateTarget, pageState: PageState): string | null {
  if (candidate.selector) {
    return candidate.selector;
  }

  if (candidate.ref != null) {
    const element = pageState.interactive_elements.find((entry) => entry.ref === candidate.ref);
    if (element) return element.selector;
  }

  if (candidate.source === 'site-profile') {
    const match = candidate.reason.match(/selector "([^"]+)"/);
    if (match) return match[1];
  }

  return null;
}

function resolveExtractSelector(siteProfile?: SiteProfile | null): string {
  if (siteProfile?.selectors) {
    for (const [name, entry] of Object.entries(siteProfile.selectors)) {
      if (/product_list|item_list|result_list/i.test(name)) {
        return entry.selector;
      }
    }
    for (const [name, entry] of Object.entries(siteProfile.selectors)) {
      if (/product_card|item_card|result_card/i.test(name)) {
        return entry.selector;
      }
    }
  }

  return 'a[href]';
}

function inferExtractFields(goal: TaskGoal): string[] {
  const description = `${goal.description} ${goal.target || ''}`.toLowerCase();

  if (/price|价格/.test(description)) return ['title', 'price', 'url'];
  if (/product|商品|goods/.test(description)) return ['title', 'price', 'url', 'image'];
  if (/link|链接/.test(description)) return ['text', 'url'];

  return ['title', 'url'];
}

function bindVerification(params: ActionParams, input: PlannerInput): VerificationCondition {
  switch (params.type) {
    case 'click':
    case 'click-real':
      return {
        check: 'url_changed',
        value: input.pageState.page_meta.url,
        timeout: 5_000,
      };

    case 'type':
      return {
        check: 'eval_truthy',
        value: `document.querySelector('${escapeSelector(params.selector)}')?.value?.includes('${escapeJs(params.text)}')`,
        timeout: 3_000,
      };

    case 'select':
      return {
        check: 'eval_truthy',
        value: `document.querySelector('${escapeSelector(params.selector)}')?.value === '${escapeJs(params.value)}'`,
        timeout: 3_000,
      };

    case 'scroll':
      return {
        check: 'eval_truthy',
        value: `window.scrollY !== ${input.pageState.page_meta.scrollPosition.y}`,
        timeout: 3_000,
      };

    case 'wait':
      return {
        check: 'eval_truthy',
        value: 'true',
        timeout: params.timeout,
      };

    case 'api-call':
      return {
        check: 'network_response',
        value: params.url,
        timeout: 10_000,
      };

    case 'extract':
      return {
        check: 'selector_exists',
        value: params.selector,
        timeout: 5_000,
      };

    case 'navigate':
      return {
        check: 'url_contains',
        value: params.url,
        timeout: 10_000,
      };

    case 'eval':
      return {
        check: 'eval_truthy',
        value: params.code,
        timeout: 5_000,
      };

    default:
      return {
        check: 'eval_truthy',
        value: 'true',
        timeout: 5_000,
      };
  }
}

function escapeSelector(value: string): string {
  return value.replace(/'/g, "\\'");
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}
