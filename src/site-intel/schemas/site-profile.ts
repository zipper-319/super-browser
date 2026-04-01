/**
 * Zod schema for Site Profile — structured site experience.
 */

import { z } from 'zod';
import { ApiProfileSchema } from './api-profile.js';

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const SelectorEntrySchema = z.object({
  selector: z.string(),
  purpose: z.string(),
  verified_at: z.string(),
  confidence: ConfidenceSchema,
});

export const WaitHintSchema = z.object({
  trigger: z.string(),
  condition: z.string(),
  timeout: z.number().optional(),
});

export const VerificationSignalSchema = z.object({
  after_action: z.string(),
  expect: z.string(),
  check: z.enum(['selector_exists', 'url_contains', 'text_contains', 'network_request', 'element_count']),
  value: z.string(),
});

export const KnownTrapSchema = z.object({
  description: z.string(),
  trigger: z.string(),
  workaround: z.string().optional(),
  discovered_at: z.string(),
});

export const UrlTemplatesSchema = z.object({
  search: z.string().optional(),
  detail: z.string().optional(),
  list: z.string().optional(),
}).optional();

export const SiteProfileSchema = z.object({
  domain: z.string(),
  aliases: z.array(z.string()).default([]),
  updated: z.string(),
  requires_login: z.boolean().default(false),
  preferred_strategy: z.enum(['dom-first', 'api-first', 'hybrid']).default('dom-first'),
  url_templates: UrlTemplatesSchema,
  selectors: z.record(SelectorEntrySchema).optional(),
  api_profiles: z.array(ApiProfileSchema).optional(),
  wait_hints: z.array(WaitHintSchema).optional(),
  verification_signals: z.array(VerificationSignalSchema).optional(),
  known_traps: z.array(KnownTrapSchema).optional(),
});

export type SiteProfile = z.infer<typeof SiteProfileSchema>;
export type SelectorEntry = z.infer<typeof SelectorEntrySchema>;
export type WaitHint = z.infer<typeof WaitHintSchema>;
export type VerificationSignal = z.infer<typeof VerificationSignalSchema>;
export type KnownTrap = z.infer<typeof KnownTrapSchema>;
