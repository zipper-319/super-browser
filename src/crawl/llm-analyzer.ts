/**
 * LLM Analysis Layer - uses Claude to generate structured insights
 * from crawl artifacts.
 *
 * Principles:
 *   - LLM reads compressed structured artifacts, not raw DOM/HAR
 *   - LLM only generates drafts/suggestions, not final decisions
 *   - Output must include evidence references and confidence
 *   - Low temperature, structured JSON output
 */

import fs from 'node:fs';
import path from 'node:path';
import type { PageArtifact, ApiProfileDraft } from './types.js';
import type { LlmPageInput, LlmSiteInput, LlmInsight, LlmAnalyzerConfig } from './llm-types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.2;
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;

type MessageContentBlock = { type: string; text?: string };

interface AnthropicClient {
  messages: {
    create(input: {
      model: string;
      max_tokens: number;
      temperature: number;
      messages: Array<{ role: 'user'; content: string }>;
    }): Promise<{ content: MessageContentBlock[] }>;
  };
}

interface AnthropicModule {
  default: new (options: { apiKey: string }) => AnthropicClient;
}

/**
 * Analyze crawl results using LLM and produce structured insights.
 */
export async function analyzeCrawlWithLlm(
  artifacts: PageArtifact[],
  apiDrafts: ApiProfileDraft[],
  domain: string,
  config: LlmAnalyzerConfig,
): Promise<LlmInsight | null> {
  if (!config.enabled) return null;

  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[llm-analyzer] No API key found, skipping LLM analysis');
    return null;
  }

  const Anthropic = await loadAnthropicClient();
  if (!Anthropic) {
    console.warn('[llm-analyzer] @anthropic-ai/sdk is unavailable, skipping LLM analysis');
    return null;
  }

  const client = new Anthropic({ apiKey });
  const siteInput = buildSiteInput(artifacts, apiDrafts, domain);
  const prompt = buildAnalysisPrompt(siteInput);

  const response = await client.messages.create({
    model: config.model || DEFAULT_MODEL,
    max_tokens: config.maxTokens || DEFAULT_MAX_TOKENS,
    temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block): block is Required<Pick<MessageContentBlock, 'type' | 'text'>> => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  return parseInsights(text);
}

/**
 * Write LLM insights to the output directory.
 */
export function writeLlmInsights(insights: LlmInsight, outputDir: string): void {
  const filePath = path.join(outputDir, 'llm-insights.json');
  fs.writeFileSync(filePath, JSON.stringify(insights, null, 2) + '\n', 'utf-8');
}

function buildSiteInput(
  artifacts: PageArtifact[],
  apiDrafts: ApiProfileDraft[],
  domain: string,
): LlmSiteInput {
  const pageTypes: Record<string, number> = {};
  for (const artifact of artifacts) {
    pageTypes[artifact.pageType] = (pageTypes[artifact.pageType] || 0) + 1;
  }

  const pagesByType = new Map<string, PageArtifact[]>();
  for (const artifact of artifacts) {
    const list = pagesByType.get(artifact.pageType) || [];
    list.push(artifact);
    pagesByType.set(artifact.pageType, list);
  }

  const samplePages: LlmPageInput[] = [];
  for (const [, pages] of pagesByType) {
    for (const page of pages.slice(0, 2)) {
      samplePages.push(compressPageForLlm(page));
    }
  }

  const apiMap = new Map<string, { pattern: string; method: string; count: number; isList: boolean }>();
  for (const artifact of artifacts) {
    for (const api of artifact.apiRequests) {
      const key = `${api.method}:${normalizeApiUrl(api.url)}`;
      const existing = apiMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        apiMap.set(key, {
          pattern: normalizeApiUrl(api.url),
          method: api.method,
          count: 1,
          isList: api.isList,
        });
      }
    }
  }

  const selectorMap = new Map<string, { name: string; selector: string; purpose: string; count: number }>();
  for (const artifact of artifacts) {
    for (const selector of artifact.candidateSelectors) {
      const existing = selectorMap.get(selector.name);
      if (existing) {
        existing.count++;
      } else {
        selectorMap.set(selector.name, {
          name: selector.name,
          selector: selector.selector,
          purpose: selector.purpose,
          count: 1,
        });
      }
    }
  }

  return {
    domain,
    pageCount: artifacts.length,
    pageTypes,
    samplePages,
    apiPatterns: [...apiMap.values()].map((value) => ({
      url_pattern: value.pattern,
      method: value.method,
      occurrences: value.count,
      isList: value.isList,
    })),
    candidateSelectors: [...selectorMap.values()].map((value) => ({
      name: value.name,
      selector: value.selector,
      purpose: value.purpose,
      occurrences: value.count,
    })),
  };
}

function compressPageForLlm(artifact: PageArtifact): LlmPageInput {
  return {
    url: artifact.url,
    title: artifact.title,
    pageType: artifact.pageType,
    elements: artifact.pageState.interactive_elements
      .filter((element) => element.visible)
      .slice(0, 15)
      .map((element) => ({
        role: element.role,
        text: element.text.slice(0, 60),
        name: element.name,
      })),
    contextBlocks: artifact.pageState.context_blocks
      .slice(0, 10)
      .map((block) => ({
        type: block.type,
        text: block.text.slice(0, 100),
      })),
    apis: artifact.apiRequests.map((api) => ({
      url: normalizeApiUrl(api.url),
      method: api.method,
      isList: api.isList,
      jsonKeys: api.jsonKeys?.slice(0, 10),
    })),
  };
}

function buildAnalysisPrompt(input: LlmSiteInput): string {
  return `You are a web site analysis expert. Analyze the following crawl results for the domain "${input.domain}" and produce structured insights.

## Crawl Data

**Pages crawled:** ${input.pageCount}
**Page types found:** ${JSON.stringify(input.pageTypes)}

### Sample Pages
${JSON.stringify(input.samplePages, null, 2)}

### API Patterns Discovered
${JSON.stringify(input.apiPatterns, null, 2)}

### Candidate Selectors
${JSON.stringify(input.candidateSelectors, null, 2)}

## Task

Analyze the above data and produce a JSON object with this exact structure:

\`\`\`json
{
  "site_summary": "One paragraph summary of the site's structure and capabilities",
  "page_type_insights": [
    {
      "type": "search|list|detail|home|login|...",
      "description": "What this page type does",
      "key_interactions": ["interaction1", "interaction2"],
      "data_available": ["data field 1", "data field 2"]
    }
  ],
  "api_insights": [
    {
      "url_pattern": "the API URL pattern",
      "inferred_purpose": "What this API does in Chinese",
      "field_semantics": {"field_name": "semantic meaning in Chinese"},
      "confidence": "high|medium|low",
      "notes": "optional notes"
    }
  ],
  "selector_insights": [
    {
      "name": "selector name",
      "selector": "CSS selector",
      "inferred_purpose": "purpose in Chinese",
      "reliability": "stable|fragile|unknown",
      "notes": "optional notes"
    }
  ],
  "open_questions": [
    "Question 1 about things that need human verification"
  ],
  "evidence": [
    {
      "claim": "The claim being made",
      "source_url": "URL where evidence was found",
      "source_type": "page|api|selector"
    }
  ]
}
\`\`\`

Requirements:
- Only state facts supported by the crawl data
- Every API insight must reference specific URLs from the data
- Mark confidence as "low" for anything inferred from a single occurrence
- Include open_questions for ambiguous findings
- Use Chinese for purpose/description fields when the site is Chinese
- Keep field_semantics concise

Return ONLY the JSON object, no other text.`;
}

function parseInsights(text: string): LlmInsight {
  let jsonText = text.trim();
  const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText);
    return {
      site_summary: parsed.site_summary || '',
      page_type_insights: parsed.page_type_insights || [],
      api_insights: parsed.api_insights || [],
      selector_insights: parsed.selector_insights || [],
      open_questions: parsed.open_questions || [],
      evidence: parsed.evidence || [],
    };
  } catch {
    return {
      site_summary: `LLM analysis completed but response was not valid JSON. Raw: ${text.slice(0, 500)}`,
      page_type_insights: [],
      api_insights: [],
      selector_insights: [],
      open_questions: ['LLM response could not be parsed as JSON, manual review needed'],
      evidence: [],
    };
  }
}

function normalizeApiUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const normalized = parsed.pathname.replace(/\/\d+/g, '/{id}');
    return `${parsed.origin}${normalized}`;
  } catch {
    return url;
  }
}

async function loadAnthropicClient(): Promise<AnthropicModule['default'] | null> {
  try {
    const mod = await dynamicImport('@anthropic-ai/sdk') as AnthropicModule;
    return mod.default;
  } catch {
    return null;
  }
}
