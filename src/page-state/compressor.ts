/**
 * Page state compressor — deduplicate, truncate, and limit output size.
 * Ensures the page state fits within LLM context budget.
 */

import type { PageState, InteractiveElement, ContextBlock } from './types.js';

export interface CompressorOptions {
  /** Max interactive elements to include (default: 200) */
  maxElements?: number;
  /** Max context blocks (default: 30) */
  maxContextBlocks?: number;
  /** Prioritize visible elements (default: true) */
  prioritizeVisible?: boolean;
}

const DEFAULTS: Required<CompressorOptions> = {
  maxElements: 200,
  maxContextBlocks: 30,
  prioritizeVisible: true,
};

/**
 * Compress the page state by applying limits and deduplication.
 */
export function compress(state: PageState, opts?: CompressorOptions): PageState {
  const config = { ...DEFAULTS, ...opts };
  return {
    ...state,
    interactive_elements: compressElements(state.interactive_elements, config),
    context_blocks: compressContextBlocks(state.context_blocks, config),
  };
}

function compressElements(
  elements: InteractiveElement[],
  config: Required<CompressorOptions>,
): InteractiveElement[] {
  let result = elements;

  // Dedup: same selector → keep first
  const seen = new Set<string>();
  result = result.filter((el) => {
    if (seen.has(el.selector)) return false;
    seen.add(el.selector);
    return true;
  });

  // Sort: visible first, then by DOM order (ref)
  if (config.prioritizeVisible) {
    result.sort((a, b) => {
      if (a.visible !== b.visible) return a.visible ? -1 : 1;
      return a.ref - b.ref;
    });
  }

  // Truncate
  if (result.length > config.maxElements) {
    result = result.slice(0, config.maxElements);
  }

  // Trim long text
  result = result.map((el) => ({
    ...el,
    text: el.text.slice(0, 150),
    name: el.name?.slice(0, 80),
  }));

  return result;
}

function compressContextBlocks(
  blocks: ContextBlock[],
  config: Required<CompressorOptions>,
): ContextBlock[] {
  let result = blocks;

  // Dedup by type + text
  const seen = new Set<string>();
  result = result.filter((b) => {
    const key = `${b.type}|${b.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Priority order for block types
  const typePriority: Record<string, number> = {
    'error': 0,
    'login-prompt': 1,
    'notification': 2,
    'heading': 3,
    'pagination': 4,
    'breadcrumb': 5,
    'filter': 6,
    'summary': 7,
    'status': 8,
    'label': 9,
  };

  result.sort((a, b) => (typePriority[a.type] ?? 10) - (typePriority[b.type] ?? 10));

  if (result.length > config.maxContextBlocks) {
    result = result.slice(0, config.maxContextBlocks);
  }

  return result;
}
