/**
 * Zod schemas for handler parameter validation.
 * Replaces manual `as` type assertions with runtime type checking.
 */

import { z } from 'zod';

// ---- Shared primitives ----

const pageId = z.string().min(1, 'pageId is required');
const optionalString = z.string().optional();
const optionalNumber = z.number().optional();
const optionalBoolean = z.boolean().optional();

// ---- Page operations ----

export const NewParams = z.object({
  url: z.string().default('about:blank'),
});

export const CloseParams = z.object({
  pageId,
});

export const NavigateParams = z.object({
  pageId,
  url: z.string().min(1, 'url is required'),
});

export const BackParams = z.object({
  pageId,
});

export const EvalParams = z.object({
  pageId,
  expression: z.string().min(1, 'expression is required'),
});

export const ClickParams = z.object({
  pageId,
  selector: z.string().min(1, 'selector is required'),
});

export const ScrollParams = z.object({
  pageId,
  direction: z.enum(['up', 'down', 'top', 'bottom']).default('down'),
  distance: z.number().default(3000),
});

export const ScreenshotParams = z.object({
  pageId,
  file: z.string().min(1, 'file path is required'),
});

export const UploadParams = z.object({
  pageId,
  selector: z.string().min(1, 'selector is required'),
  files: z.array(z.string()).min(1, 'at least one file is required'),
});

export const InfoParams = z.object({
  pageId,
});

// ---- Page state ----

export const PageStateParams = z.object({
  pageId,
  scopedSelectors: z.array(z.object({
    selector: z.string(),
    reason: z.string(),
  })).optional(),
  raw: optionalBoolean,
});

// ---- Site profile ----

export const SiteProfileParams = z.object({
  domain: z.string().min(1, 'domain is required'),
});

// ---- Network ----

export const NetworkStartParams = z.object({
  pageId,
});

export const NetworkRequestsParams = z.object({
  pageId,
  pattern: optionalString,
  businessOnly: optionalBoolean,
});

export const NetworkStopParams = z.object({
  pageId,
});

export const NetworkPatternsParams = z.object({
  pageId,
});

// ---- Decision ----

export const DecisionCandidatesParams = z.object({
  pageId,
  intent: z.string().min(1, 'intent is required'),
  description: z.string().default(''),
  target: optionalString,
});

export const DecisionContextParams = DecisionCandidatesParams.extend({
  mode: z.enum(['act', 'extract', 'validate']).default('act'),
  maxRefs: z.number().int().min(1).max(100).default(18),
  includeVisual: optionalBoolean,
  screenshotDir: optionalString,
});

export const DecisionExecuteParams = DecisionContextParams.extend({
  proposalIndex: z.number().int().min(0).optional(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  tryFallbacks: optionalBoolean,
});

export const DecisionVerifyParams = z.object({
  pageId,
  check: z.string().min(1, 'check is required'),
  value: z.string().min(1, 'value is required'),
  timeout: z.number().default(5_000),
});

// ---- Experience ----

export const ExperienceStartParams = z.object({
  pageId,
  intent: z.string().min(1, 'intent is required'),
  description: z.string().default(''),
});

export const ExperienceRecordParams = z.object({
  pageId,
  action: z.string().min(1, 'action is required'),
  selector: optionalString,
  passed: optionalBoolean,
  reason: z.string().default(''),
});

export const ExperienceCompleteParams = z.object({
  pageId,
  outcome: z.enum(['success', 'partial', 'failure']),
});

export const ExperienceFlushParams = z.object({
  pageId,
});

export const ExperienceStatusParams = z.object({
  pageId: z.string().optional(),
});

// ---- Crawl ----

export const CrawlParams = z.object({
  domain: optionalString,
  seedPath: optionalString,
  outputDir: z.string().min(1, 'outputDir is required'),
  maxPages: optionalNumber,
  maxDepth: optionalNumber,
  withLlm: optionalBoolean,
  resume: optionalBoolean,
}).refine(
  (d) => d.domain || d.seedPath,
  { message: 'Either domain or seedPath must be provided' },
);

export const BatchCrawlParams = z.object({
  domains: z.array(z.string()).optional(),
  seedPaths: z.array(z.string()).optional(),
  outputDir: z.string().min(1, 'outputDir is required'),
  maxPages: optionalNumber,
  maxDepth: optionalNumber,
  withLlm: optionalBoolean,
});

// ---- State diff ----

export const StateDiffParams = z.object({
  pageId,
});

// ---- Fill / Press / Select (new handlers) ----

export const FillParams = z.object({
  pageId,
  selector: z.string().min(1, 'selector is required'),
  value: z.string(),
});

export const PressParams = z.object({
  pageId,
  key: z.string().min(1, 'key is required'),
  selector: optionalString,
});

export const SelectParams = z.object({
  pageId,
  selector: z.string().min(1, 'selector is required'),
  values: z.array(z.string()).min(1, 'at least one value is required'),
});
