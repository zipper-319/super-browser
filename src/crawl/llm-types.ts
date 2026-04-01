/**
 * LLM analysis layer types — structured inputs/outputs for model-based summarization.
 */

import type { PageType } from './types.js';

// ---- Input: compressed page artifact for LLM ----

export interface LlmPageInput {
  url: string;
  title: string;
  pageType: PageType;
  /** Top interactive elements (compressed) */
  elements: Array<{
    role: string;
    text: string;
    name?: string;
  }>;
  /** Context blocks summary */
  contextBlocks: Array<{
    type: string;
    text: string;
  }>;
  /** API request summaries */
  apis: Array<{
    url: string;
    method: string;
    isList: boolean;
    jsonKeys?: string[];
  }>;
}

export interface LlmSiteInput {
  domain: string;
  pageCount: number;
  pageTypes: Record<string, number>;
  /** Representative pages per type */
  samplePages: LlmPageInput[];
  /** All discovered API patterns */
  apiPatterns: Array<{
    url_pattern: string;
    method: string;
    occurrences: number;
    isList: boolean;
  }>;
  /** Candidate selectors with frequency */
  candidateSelectors: Array<{
    name: string;
    selector: string;
    purpose: string;
    occurrences: number;
  }>;
}

// ---- Output: LLM insights ----

export interface LlmInsight {
  /** Site-level summary */
  site_summary: string;
  /** Refined page type descriptions */
  page_type_insights: Array<{
    type: PageType;
    description: string;
    key_interactions: string[];
    data_available: string[];
  }>;
  /** API purpose and field semantic analysis */
  api_insights: Array<{
    url_pattern: string;
    inferred_purpose: string;
    field_semantics: Record<string, string>;
    confidence: 'high' | 'medium' | 'low';
    notes?: string;
  }>;
  /** Selector confidence refinement */
  selector_insights: Array<{
    name: string;
    selector: string;
    inferred_purpose: string;
    reliability: 'stable' | 'fragile' | 'unknown';
    notes?: string;
  }>;
  /** Open questions for human review */
  open_questions: string[];
  /** Evidence references */
  evidence: Array<{
    claim: string;
    source_url: string;
    source_type: 'page' | 'api' | 'selector';
  }>;
}

// ---- Config ----

export interface LlmAnalyzerConfig {
  /** Anthropic API key (falls back to ANTHROPIC_API_KEY env) */
  apiKey?: string;
  /** Model to use */
  model?: string;
  /** Max tokens for response */
  maxTokens?: number;
  /** Temperature (low = more deterministic) */
  temperature?: number;
  /** Whether to enable LLM analysis */
  enabled: boolean;
}
