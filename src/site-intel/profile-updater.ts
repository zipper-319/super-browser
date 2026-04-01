/**
 * Profile updater — merges runtime experience records into site profile JSON.
 *
 * Update principles (Section 8.5):
 *   1. Only write verified-successful facts
 *   2. Don't solidify one-off success as universal rule — require repeated success
 *   3. JSON only stores decision fields (no raw HTML/DOM)
 *   4. Every entry carries verified_at date
 *   5. New vs old conflict: most recent verified-success wins
 */

import fs from 'node:fs';
import path from 'node:path';
import { SiteProfileSchema, type SiteProfile, type SelectorEntry, type KnownTrap } from './schemas/site-profile.js';
import type { ApiProfile } from './schemas/api-profile.js';
import type { ExperienceRecord, SelectorObservation, ApiObservation, TrapObservation } from './experience-recorder.js';

// Default site-patterns directory
const DEFAULT_PATTERNS_DIR = path.resolve(
  import.meta.url ? path.dirname(new URL(import.meta.url).pathname) : __dirname,
  '../../references/site-patterns',
);

function normalizePath(p: string): string {
  if (process.platform === 'win32' && p.startsWith('/')) {
    return p.replace(/^\/([A-Za-z]:)/, '$1');
  }
  return p;
}

export interface UpdateResult {
  domain: string;
  filePath: string;
  created: boolean;
  updates: {
    selectors_added: string[];
    selectors_updated: string[];
    api_profiles_added: string[];
    api_profiles_updated: string[];
    traps_added: number;
    strategy_changed: boolean;
  };
}

/**
 * Merge an experience record into the site profile JSON.
 * Creates a new profile file if none exists.
 */
export function updateProfile(
  record: ExperienceRecord,
  patternsDir?: string,
): UpdateResult {
  const dir = normalizePath(patternsDir || DEFAULT_PATTERNS_DIR);
  const today = new Date().toISOString().slice(0, 10);
  const domain = record.domain;

  // Ensure directory exists
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${domain}.json`);
  const created = !fs.existsSync(filePath);

  // Load or create base profile
  let profile: SiteProfile;
  if (created) {
    profile = {
      domain,
      aliases: [],
      updated: today,
      requires_login: false,
      preferred_strategy: 'dom-first',
      selectors: {},
      api_profiles: [],
      wait_hints: [],
      known_traps: [],
    };
  } else {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const parsed = SiteProfileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Cannot update invalid profile ${filePath}: ${parsed.error.message}`);
    }
    profile = parsed.data;
  }

  const result: UpdateResult = {
    domain,
    filePath,
    created,
    updates: {
      selectors_added: [],
      selectors_updated: [],
      api_profiles_added: [],
      api_profiles_updated: [],
      traps_added: 0,
      strategy_changed: false,
    },
  };

  // Only process successful or partially successful records
  if (record.outcome === 'failure') {
    // Still record traps from failures
    result.updates.traps_added = mergeTraps(profile, record.trap_observations, today);
    profile.updated = today;
    writeProfile(filePath, profile);
    return result;
  }

  // 1. Merge selector observations (only succeeded ones)
  const succeededSelectors = record.selector_observations.filter((s) => s.succeeded);
  for (const obs of succeededSelectors) {
    mergeSelector(profile, obs, today, result);
  }

  // 2. Merge API observations (only succeeded ones)
  const succeededApis = record.api_observations.filter((a) => a.succeeded);
  for (const obs of succeededApis) {
    mergeApiProfile(profile, obs, today, result);
  }

  // 3. Merge traps
  result.updates.traps_added = mergeTraps(profile, record.trap_observations, today);

  // 4. Strategy adjustment: if API succeeded, consider api-first
  if (succeededApis.length > 0 && profile.preferred_strategy === 'dom-first') {
    // Only upgrade to hybrid if we also have working selectors
    if (succeededSelectors.length > 0) {
      profile.preferred_strategy = 'hybrid';
      result.updates.strategy_changed = true;
    } else {
      profile.preferred_strategy = 'api-first';
      result.updates.strategy_changed = true;
    }
  }

  // 5. Update timestamp
  profile.updated = today;

  // Write back
  writeProfile(filePath, profile);
  return result;
}

// ---- Selector merging ----

function mergeSelector(
  profile: SiteProfile,
  obs: SelectorObservation,
  today: string,
  result: UpdateResult,
): void {
  if (!profile.selectors) profile.selectors = {};

  const existing = profile.selectors[obs.name];

  if (!existing) {
    // New selector — add with medium confidence (needs repeat verification for high)
    profile.selectors[obs.name] = {
      selector: obs.selector,
      purpose: obs.purpose,
      verified_at: today,
      confidence: obs.source === 'site-profile' ? 'high' : 'medium',
    };
    result.updates.selectors_added.push(obs.name);
    return;
  }

  // Existing selector — update if different or refresh verified_at
  if (existing.selector === obs.selector) {
    // Same selector verified again — boost confidence
    existing.verified_at = today;
    if (existing.confidence === 'low') existing.confidence = 'medium';
    else if (existing.confidence === 'medium') existing.confidence = 'high';
    result.updates.selectors_updated.push(obs.name);
  } else {
    // Conflict: different selector — new one wins (recency principle)
    existing.selector = obs.selector;
    existing.purpose = obs.purpose;
    existing.verified_at = today;
    existing.confidence = 'medium'; // reset confidence on change
    result.updates.selectors_updated.push(obs.name);
  }
}

// ---- API profile merging ----

function mergeApiProfile(
  profile: SiteProfile,
  obs: ApiObservation,
  today: string,
  result: UpdateResult,
): void {
  if (!profile.api_profiles) profile.api_profiles = [];

  const existing = profile.api_profiles.find((a) => a.name === obs.name);

  if (!existing) {
    // Create a new API profile entry
    const newProfile: ApiProfile = {
      name: obs.name,
      purpose: obs.purpose,
      url_pattern: obs.url_pattern,
      method: obs.method as ApiProfile['method'],
      trigger: 'runtime-discovered',
      auth: 'cookie', // conservative default
      confidence: 'medium',
      verified_at: today,
    };

    if (obs.data_path) {
      newProfile.response = {
        data_path: obs.data_path,
        item_fields: obs.item_fields || [],
      };
    }

    profile.api_profiles.push(newProfile);
    result.updates.api_profiles_added.push(obs.name);
    return;
  }

  // Update existing
  existing.url_pattern = obs.url_pattern;
  existing.verified_at = today;
  if (existing.confidence === 'low') existing.confidence = 'medium';
  else if (existing.confidence === 'medium') existing.confidence = 'high';

  if (obs.data_path && !existing.response) {
    existing.response = {
      data_path: obs.data_path,
      item_fields: obs.item_fields || [],
    };
  }

  result.updates.api_profiles_updated.push(obs.name);
}

// ---- Trap merging ----

function mergeTraps(
  profile: SiteProfile,
  observations: TrapObservation[],
  today: string,
): number {
  if (!profile.known_traps) profile.known_traps = [];
  let added = 0;

  for (const obs of observations) {
    // Deduplicate: don't add if a similar trap already exists
    const isDuplicate = profile.known_traps.some((t) =>
      t.description.toLowerCase().includes(obs.description.toLowerCase().slice(0, 30)) ||
      obs.description.toLowerCase().includes(t.description.toLowerCase().slice(0, 30)),
    );

    if (!isDuplicate) {
      profile.known_traps.push({
        description: obs.description,
        trigger: obs.trigger,
        workaround: obs.workaround,
        discovered_at: today,
      });
      added++;
    }
  }

  // Keep traps list manageable — cap at 20, keeping most recent
  if (profile.known_traps.length > 20) {
    profile.known_traps = profile.known_traps.slice(-20);
  }

  return added;
}

// ---- File I/O ----

function writeProfile(filePath: string, profile: SiteProfile): void {
  // Validate before writing
  const validated = SiteProfileSchema.safeParse(profile);
  if (!validated.success) {
    throw new Error(`Profile validation failed before write: ${validated.error.message}`);
  }
  fs.writeFileSync(filePath, JSON.stringify(validated.data, null, 2) + '\n', 'utf-8');
}
