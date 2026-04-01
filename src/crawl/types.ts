/**
 * Crawl subsystem types — site exploration and experience draft generation.
 */

import type { PageState } from '../page-state/types.js';
import type { CapturedRequest } from '../network/types.js';

// ---- Page types ----

export type PageType =
  | 'home'
  | 'search'
  | 'list'
  | 'detail'
  | 'login'
  | 'upload'
  | 'account'
  | 'other';

// ---- Seed config ----

export interface SeedConfig {
  domain: string;
  start_urls: string[];
  follow_patterns: string[];
  ignore_patterns: string[];
  max_pages: number;
  max_depth: number;
  /** Max pages per page-type (sampling control) */
  page_type_quota: number;
  /** Delay between page visits in ms */
  delay_ms: number;
}

// ---- Crawl task state ----

export type CrawlPageStatus = 'pending' | 'visiting' | 'analyzed' | 'skipped' | 'failed';

export interface CrawlPage {
  url: string;
  depth: number;
  status: CrawlPageStatus;
  parentUrl?: string;
  pageType?: PageType;
  error?: string;
}

export interface CrawlState {
  domain: string;
  startedAt: string;
  /** URL → CrawlPage */
  pages: Map<string, CrawlPage>;
  /** Ordered queue of pending URLs */
  queue: string[];
  /** Page type counters for quota control */
  typeCounters: Map<PageType, number>;
  totalVisited: number;
  totalSkipped: number;
  totalFailed: number;
}

// ---- Link candidate ----

export interface LinkCandidate {
  url: string;
  text: string;
  /** Inferred destination page type */
  inferredType?: PageType;
  depth: number;
}

// ---- Page artifact ----

export interface PageArtifact {
  url: string;
  pageType: PageType;
  depth: number;
  title: string;
  /** Compressed page state */
  pageState: PageState;
  /** Business API requests captured on this page */
  apiRequests: ApiRequestSummary[];
  /** Links discovered on this page */
  linkCandidates: LinkCandidate[];
  /** Candidate selectors found */
  candidateSelectors: CandidateSelector[];
  /** Timestamp */
  collectedAt: string;
}

export interface ApiRequestSummary {
  url: string;
  method: string;
  status: number;
  contentType?: string;
  /** Truncated response body for analysis */
  responsePreview?: string;
  /** JSON root keys if response is JSON */
  jsonKeys?: string[];
  /** Whether this looks like a list/search endpoint */
  isList: boolean;
}

export interface CandidateSelector {
  name: string;
  selector: string;
  purpose: string;
  /** How many pages this selector was found on */
  occurrences: number;
}

// ---- Draft outputs ----

export interface PageTypeSummary {
  type: PageType;
  count: number;
  typicalUrls: string[];
  commonElements: string[];
  commonContextBlocks: string[];
  commonApis: string[];
}

export interface SiteDraft {
  domain: string;
  crawledAt: string;
  requires_login: boolean;
  preferred_strategy: 'dom-first' | 'api-first' | 'hybrid';
  url_templates: {
    search?: string;
    detail?: string;
    list?: string;
  };
  candidate_selectors: Record<string, {
    selector: string;
    purpose: string;
    confidence: 'high' | 'medium' | 'low';
    occurrences: number;
  }>;
  candidate_api_profiles: ApiProfileDraft[];
  candidate_wait_hints: Array<{
    trigger: string;
    condition: string;
    timeout?: number;
  }>;
  candidate_traps: Array<{
    description: string;
    trigger: string;
    workaround?: string;
  }>;
}

export interface ApiProfileDraft {
  name: string;
  purpose: string;
  url_pattern: string;
  method: string;
  trigger: string;
  /** JSON data path (e.g., "data.items") */
  data_path?: string;
  item_fields?: string[];
  pagination_type?: 'offset' | 'cursor' | 'page';
  confidence: 'high' | 'medium' | 'low';
}

export interface CrawlSummary {
  domain: string;
  startedAt: string;
  completedAt: string;
  totalPages: number;
  totalVisited: number;
  totalSkipped: number;
  totalFailed: number;
  pageTypes: Record<PageType, number>;
  apiEndpoints: number;
  outputDir: string;
}
