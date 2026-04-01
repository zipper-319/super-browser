/**
 * Site profile loader — replaces v1's match-site.sh.
 * Loads structured JSON profiles, with fallback to Markdown parsing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SiteProfileSchema, type SiteProfile } from './schemas/site-profile.js';

// Default site-patterns directory (relative to project root)
const DEFAULT_PATTERNS_DIR = path.resolve(
  import.meta.url ? path.dirname(new URL(import.meta.url).pathname) : __dirname,
  '../../references/site-patterns',
);

// Normalize Windows paths (file:///D:/... → D:/...)
function normalizePath(p: string): string {
  if (process.platform === 'win32' && p.startsWith('/')) {
    // Remove leading slash for Windows paths like /D:/...
    return p.replace(/^\/([A-Za-z]:)/, '$1');
  }
  return p;
}

/**
 * Load a site profile by domain name or alias.
 * Lookup order:
 *   1. {domain}.json — structured profile
 *   2. Scan all .json files for matching alias
 *   3. Return null if not found
 */
export async function loadProfile(
  domainOrAlias: string,
  patternsDir?: string,
): Promise<{ profile: SiteProfile; markdownPath: string | null } | null> {
  const dir = normalizePath(patternsDir || DEFAULT_PATTERNS_DIR);

  if (!fs.existsSync(dir)) {
    return null;
  }

  // Normalize input: lowercase, strip protocol/path
  const query = domainOrAlias
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');

  // 1. Direct match by filename
  const directJsonPath = path.join(dir, `${query}.json`);
  if (fs.existsSync(directJsonPath)) {
    return loadFromJson(directJsonPath, dir);
  }

  // 2. Scan all .json for alias match
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const jsonPath = path.join(dir, file);
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const aliases = (raw.aliases || []).map((a: string) => a.toLowerCase());
      const domain = (raw.domain || '').toLowerCase();
      if (domain === query || aliases.includes(query)) {
        return loadFromJson(jsonPath, dir);
      }
    } catch { /* skip invalid files */ }
  }

  return null;
}

/**
 * List all available site profiles.
 */
export function listProfiles(patternsDir?: string): Array<{ domain: string; aliases: string[]; file: string }> {
  const dir = normalizePath(patternsDir || DEFAULT_PATTERNS_DIR);
  if (!fs.existsSync(dir)) return [];

  const result: Array<{ domain: string; aliases: string[]; file: string }> = [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      result.push({
        domain: raw.domain || file.replace('.json', ''),
        aliases: raw.aliases || [],
        file,
      });
    } catch { /* skip */ }
  }

  return result;
}

// ---- Internal ----

function loadFromJson(
  jsonPath: string,
  dir: string,
): { profile: SiteProfile; markdownPath: string | null } {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const result = SiteProfileSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(
      `Invalid site profile ${jsonPath}: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
    );
  }

  // Check for companion markdown
  const mdPath = jsonPath.replace('.json', '.md');
  const markdownPath = fs.existsSync(mdPath) ? mdPath : null;

  return { profile: result.data, markdownPath };
}
