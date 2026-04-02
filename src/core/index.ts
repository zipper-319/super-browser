/**
 * Public library surface for the reusable super-browser runtime.
 * Exports named functions for a clean API surface.
 */

// ---- Browser ----
export {
  connect,
  connectToPort,
  disconnect,
  ensureConnected,
  getConnection,
  onDisconnect,
  type ConnectionState,
} from '../browser/connection.js';
export {
  discoverChromePort,
  getCdpEndpoint,
  type DiscoveryResult,
} from '../browser/port-discovery.js';
export {
  createTab,
  closeTab,
  getPage,
  listPages,
  closeAllOwnedTabs,
  pageCount,
  type ManagedPage,
} from '../browser/tab-manager.js';

// ---- Page State ----
export { collectPageState, type CollectOptions } from '../page-state/collector.js';
export { compress, type CompressorOptions } from '../page-state/compressor.js';
export { computeStateDiff, summarizeDiff, isSignificantChange } from '../page-state/state-diff.js';
export { captureFallbackView } from '../page-state/fallback-view.js';
export type {
  PageState,
  PageMeta,
  PageLoadingState,
  PageOverlay,
  InteractiveElement,
  ElementRole,
  ElementState,
  BBox,
  ContextBlock,
  ContextBlockType,
  ScopedDom,
  FallbackView,
  StateDiff,
} from '../page-state/types.js';

// ---- Network ----
export { startMonitor, stopMonitor, getRequests, getMonitorState } from '../network/monitor.js';
export { classify } from '../network/classifier.js';
export { aggregatePatterns } from '../network/pattern-aggregator.js';
export type {
  CapturedRequest,
  MonitorState,
  DiscoveredApiPattern,
  DraftApiProfile,
} from '../network/types.js';

// ---- Site Intel ----
export { loadProfile, listProfiles } from '../site-intel/profile-loader.js';
export { updateProfile } from '../site-intel/profile-updater.js';
export {
  startRecording,
  recordAction,
  completeRecording,
  getRecording,
  clearRecording,
  listRecordings,
  type ExperienceRecord,
  type ActionRecord,
} from '../site-intel/experience-recorder.js';
export type { SiteProfile } from '../site-intel/schemas/site-profile.js';
export type { ApiProfile } from '../site-intel/schemas/api-profile.js';

// ---- Decision ----
export { generateCandidates } from '../decision/candidate-generator.js';
export { planActions } from '../decision/action-planner.js';
export { executeProposal, type ActionExecutionResult } from '../decision/executor.js';
export { verify, type VerifyResult } from '../decision/verifier.js';
export {
  buildDecisionModelInput,
  renderDecisionModelInput,
  type DecisionModelInputProtocol,
  type BuildDecisionModelInputOptions,
  type ModelInputMode,
  type ModelCompression,
} from '../decision/model-input.js';
export type {
  CandidateAction,
  CandidateSource,
  CandidateTarget,
  ActionParams,
  ActionProposal,
  VerificationCheck,
  VerificationCondition,
  TaskIntent,
  TaskGoal,
} from '../decision/types.js';
