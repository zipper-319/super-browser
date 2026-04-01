/**
 * Zod schemas for crawl subsystem — seed config validation.
 */

import { z } from 'zod';

export const SeedConfigSchema = z.object({
  domain: z.string().min(1),
  start_urls: z.array(z.string().url()).min(1),
  follow_patterns: z.array(z.string()).default(['*']),
  ignore_patterns: z.array(z.string()).default([
    '*logout*', '*checkout*', '*cart*', '*payment*',
    '*delete*', '*remove*', '*.pdf', '*.zip',
  ]),
  max_pages: z.number().int().min(1).max(500).default(50),
  max_depth: z.number().int().min(1).max(10).default(3),
  page_type_quota: z.number().int().min(1).max(50).default(10),
  delay_ms: z.number().int().min(0).max(30000).default(1500),
});

export type ValidatedSeedConfig = z.infer<typeof SeedConfigSchema>;
