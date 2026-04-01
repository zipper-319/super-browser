/**
 * State diff — computes the difference between two PageStates.
 * Used by the decision layer to understand what changed after an action.
 */

import type { PageState, StateDiff, InteractiveElement, ContextBlock } from './types.js';

/**
 * Compute the diff between a previous and current PageState.
 */
export function computeStateDiff(prev: PageState, curr: PageState): StateDiff {
  const prevRefs = new Set(prev.interactive_elements.map((e) => e.ref));
  const currRefs = new Set(curr.interactive_elements.map((e) => e.ref));

  const added_elements: number[] = [];
  const removed_elements: number[] = [];
  const changed_elements: number[] = [];

  // Added: in current but not in previous
  for (const ref of currRefs) {
    if (!prevRefs.has(ref)) {
      added_elements.push(ref);
    }
  }

  // Removed: in previous but not in current
  for (const ref of prevRefs) {
    if (!currRefs.has(ref)) {
      removed_elements.push(ref);
    }
  }

  // Changed: same ref but different content
  const prevMap = new Map(prev.interactive_elements.map((e) => [e.ref, e]));
  for (const el of curr.interactive_elements) {
    const prevEl = prevMap.get(el.ref);
    if (prevEl && hasElementChanged(prevEl, el)) {
      changed_elements.push(el.ref);
    }
  }

  const prevContext = new Set(prev.context_blocks.map(contextKey));
  const currContext = new Set(curr.context_blocks.map(contextKey));
  const new_context: string[] = [];
  const removed_context: string[] = [];

  for (const block of curr.context_blocks) {
    const key = contextKey(block);
    if (!prevContext.has(key)) {
      new_context.push(block.text);
    }
  }

  for (const block of prev.context_blocks) {
    const key = contextKey(block);
    if (!currContext.has(key)) {
      removed_context.push(block.text);
    }
  }

  return {
    added_elements,
    removed_elements,
    changed_elements,
    url_changed: prev.page_meta.url !== curr.page_meta.url,
    title_changed: prev.page_meta.title !== curr.page_meta.title,
    new_context,
    removed_context,
  };
}

/**
 * Check if an element has meaningfully changed between snapshots.
 */
function hasElementChanged(prev: InteractiveElement, curr: InteractiveElement): boolean {
  if (prev.text !== curr.text) return true;
  if (prev.visible !== curr.visible) return true;
  if (prev.selector !== curr.selector) return true;
  if (prev.role !== curr.role) return true;

  // Check state changes (value, checked, disabled, etc.)
  if (prev.state?.value !== curr.state?.value) return true;
  if (prev.state?.checked !== curr.state?.checked) return true;
  if (prev.state?.disabled !== curr.state?.disabled) return true;
  if (prev.state?.selected !== curr.state?.selected) return true;
  if (prev.state?.expanded !== curr.state?.expanded) return true;

  return false;
}

/**
 * Summarize a StateDiff into a human-readable string.
 */
export function summarizeDiff(diff: StateDiff): string {
  const parts: string[] = [];

  if (diff.url_changed) parts.push('URL changed');
  if (diff.title_changed) parts.push('title changed');
  if (diff.added_elements.length > 0) parts.push(`+${diff.added_elements.length} elements`);
  if (diff.removed_elements.length > 0) parts.push(`-${diff.removed_elements.length} elements`);
  if (diff.changed_elements.length > 0) parts.push(`~${diff.changed_elements.length} changed`);
  if (diff.new_context.length > 0) parts.push(`+${diff.new_context.length} context blocks`);
  if (diff.removed_context.length > 0) parts.push(`-${diff.removed_context.length} context blocks`);

  return parts.length > 0 ? parts.join(', ') : 'no changes';
}

/**
 * Check if a diff indicates significant change (useful for verification).
 */
export function isSignificantChange(diff: StateDiff): boolean {
  return (
    diff.url_changed ||
    diff.title_changed ||
    diff.added_elements.length > 0 ||
    diff.removed_elements.length > 0 ||
    diff.changed_elements.length >= 3 ||
    diff.new_context.length > 0
  );
}

function contextKey(block: ContextBlock): string {
  return `${block.type}|${block.text}`;
}
