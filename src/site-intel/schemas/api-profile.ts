/**
 * Zod schema for API Profile — structured API experience for a site.
 */

import { z } from 'zod';

export const ApiProfilePaginationSchema = z.object({
  type: z.enum(['offset', 'cursor', 'page']),
  param: z.string(),
  total_path: z.string().optional(),
});

export const ApiProfileRequestSchema = z.object({
  query_params: z.record(z.string()).optional(),
  body_schema: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

export const ApiProfileResponseSchema = z.object({
  data_path: z.string(),
  item_fields: z.array(z.string()),
  pagination: ApiProfilePaginationSchema.optional(),
});

export const ApiProfileSchema = z.object({
  name: z.string(),
  purpose: z.string(),
  url_pattern: z.string(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  trigger: z.string(),
  request: ApiProfileRequestSchema.optional(),
  response: ApiProfileResponseSchema.optional(),
  field_mapping: z.record(z.string()).optional(),
  auth: z.enum(['none', 'cookie', 'token', 'signature']),
  confidence: z.enum(['high', 'medium', 'low']),
  verified_at: z.string(),
});

export type ApiProfile = z.infer<typeof ApiProfileSchema>;
