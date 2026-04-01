/**
 * Page state types — the structured representation of a web page for LLM consumption.
 * Implements the four-layer model from the design doc (Section 9).
 */

// ---- Page meta ----

export interface PageMeta {
  pageId: string;
  url: string;
  title: string;
  readyState: 'loading' | 'interactive' | 'complete';
  viewport: { width: number; height: number };
  scrollPosition: { x: number; y: number };
  scrollHeight: number;
  pagesAbove?: number;
  pagesBelow?: number;
  loadingState?: PageLoadingState;
  activeOverlay?: PageOverlay | null;
}

export type PageLoadingState = 'stable' | 'loading' | 'skeleton' | 'navigating';

export interface PageOverlay {
  type: 'dialog' | 'drawer' | 'banner' | 'captcha' | 'unknown';
  text: string;
}

// ---- Layer 1: Actionable View — interactive elements ----

export type ElementRole =
  | 'link' | 'button' | 'input' | 'textarea' | 'select'
  | 'checkbox' | 'radio' | 'tab' | 'menuitem' | 'clickable' | 'other';

export interface ElementState {
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  value?: string;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractiveElement {
  ref: number;
  tag: string;
  role: ElementRole;
  text: string;
  name?: string;
  state?: ElementState;
  selector: string;
  container?: string;
  visible: boolean;
  bbox?: BBox;
}

// ---- Layer 2: Context View — semantic context blocks ----

export type ContextBlockType =
  | 'heading' | 'status' | 'error' | 'notification' | 'breadcrumb'
  | 'filter' | 'pagination' | 'login-prompt' | 'summary' | 'label';

export interface ContextBlock {
  type: ContextBlockType;
  text: string;
  relatedRefs?: number[];
  container?: string;
}

// ---- Layer 3: Scoped DOM ----

export interface ScopedDom {
  selector: string;
  html: string;
  reason: string;
}

// ---- Layer 4: Fallback ----

export interface FallbackView {
  screenshotPath?: string;
  recentRequests?: Array<{ url: string; method: string; status: number }>;
  overlay?: { type: string; text: string };
}

// ---- Composite output ----

export interface StateDiff {
  added_elements: number[];
  removed_elements: number[];
  changed_elements: number[];
  url_changed: boolean;
  title_changed: boolean;
  new_context: string[];
  removed_context: string[];
}

export interface PageState {
  page_meta: PageMeta;
  interactive_elements: InteractiveElement[];
  context_blocks: ContextBlock[];
  scoped_dom?: ScopedDom[];
  fallback?: FallbackView;
  state_diff?: StateDiff;
}
