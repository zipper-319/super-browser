/**
 * Public library surface for the reusable super-browser runtime.
 * This keeps the stable browser/page-state/network/site-intel/decision APIs
 * behind a dedicated entrypoint, independent from the daemon and CLI shells.
 */

export * as browserConnection from '../browser/connection.js';
export * as browserPorts from '../browser/port-discovery.js';
export * as browserTabs from '../browser/tab-manager.js';

export * as pageStateCollector from '../page-state/collector.js';
export * as pageStateCompressor from '../page-state/compressor.js';
export * as pageStateDiff from '../page-state/state-diff.js';
export type {
  PageState,
  PageMeta,
  InteractiveElement,
  ContextBlock,
  ScopedDom,
  FallbackView,
  StateDiff,
} from '../page-state/types.js';

export * as networkMonitor from '../network/monitor.js';
export * as networkClassifier from '../network/classifier.js';
export * as networkPatterns from '../network/pattern-aggregator.js';
export type {
  CapturedRequest,
  MonitorState,
  DiscoveredApiPattern,
  DraftApiProfile,
} from '../network/types.js';

export * as siteProfiles from '../site-intel/profile-loader.js';
export * as siteProfileUpdater from '../site-intel/profile-updater.js';
export * as siteExperience from '../site-intel/experience-recorder.js';
export type { SiteProfile } from '../site-intel/schemas/site-profile.js';
export type { ApiProfile } from '../site-intel/schemas/api-profile.js';

export * as decisionCandidates from '../decision/candidate-generator.js';
export * as decisionExecutor from '../decision/executor.js';
export * as decisionPlanner from '../decision/action-planner.js';
export * as decisionModelInput from '../decision/model-input.js';
export * as decisionVerifier from '../decision/verifier.js';
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
export type {
  ModelInputMode,
  ModelCompression,
  DecisionTaskContext,
  DecisionHistoryContext,
  DecisionPageStatus,
  DecisionPageContext,
  DecisionInteractiveRefs,
  DecisionPageDelta,
  DecisionPageView,
  DecisionCandidateView,
  DecisionVerificationView,
  DecisionArtifacts,
  DecisionModelInputProtocol,
  BuildDecisionModelInputOptions,
} from '../decision/model-input.js';
export type { ActionExecutionResult } from '../decision/executor.js';
