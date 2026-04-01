/**
 * Core request handlers — shared between RPC methods and HTTP endpoints.
 * All page operations use Playwright API internally.
 * Parameters are validated via Zod schemas (see schemas.ts).
 */

import { ensureConnected, getConnection, disconnect } from '../browser/connection.js';
import { createTab, closeTab, getPage, listPages, closeAllOwnedTabs, pageCount } from '../browser/tab-manager.js';
import { collectPageState, type CollectOptions } from '../page-state/collector.js';
import { loadProfile, listProfiles } from '../site-intel/profile-loader.js';
import { startMonitor, stopMonitor, getRequests, getMonitorState } from '../network/monitor.js';
import { aggregatePatterns } from '../network/pattern-aggregator.js';
import { generateCandidates } from '../decision/candidate-generator.js';
import { planActions } from '../decision/action-planner.js';
import { executeProposal } from '../decision/executor.js';
import { verify } from '../decision/verifier.js';
import { buildDecisionModelInput, renderDecisionModelInput } from '../decision/model-input.js';
import type { TaskGoal, ActionProposal } from '../decision/types.js';
import {
  startRecording, recordAction, completeRecording,
  getRecording, clearRecording, listRecordings,
} from '../site-intel/experience-recorder.js';
import { updateProfile } from '../site-intel/profile-updater.js';
import { runSiteCrawl } from '../crawl/runner.js';
import { runBatchCrawl } from '../crawl/batch-runner.js';
import { computeStateDiff, summarizeDiff } from '../page-state/state-diff.js';
import type { PageState } from '../page-state/types.js';
import * as S from './schemas.js';

// ---- Lifecycle handlers ----

export async function handleDaemonStatus() {
  const conn = getConnection();
  return {
    running: true,
    pid: process.pid,
    uptime: process.uptime(),
    browserConnected: conn?.status === 'connected',
    chromePort: conn?.chromePort ?? null,
    pageCount: pageCount(),
  };
}

export async function handleDaemonStop() {
  const closed = await closeAllOwnedTabs();
  await disconnect();
  return { stopped: true, closedTabs: closed };
}

// ---- Page operation handlers ----

export async function handleNew(params: Record<string, unknown>) {
  const { url } = S.NewParams.parse(params);
  const conn = await ensureConnected();
  const managed = await createTab(conn.context, url);
  const title = await managed.page.title();
  return {
    pageId: managed.id,
    title,
    url: managed.page.url(),
  };
}

export async function handleClose(params: Record<string, unknown>) {
  const { pageId } = S.CloseParams.parse(params);
  await closeTab(pageId);
  cleanupPageState(pageId);
  return { closed: true };
}

export async function handleNavigate(params: Record<string, unknown>) {
  const { pageId, url } = S.NavigateParams.parse(params);
  const { page } = getPage(pageId);
  await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
  return { url: page.url(), title: await page.title() };
}

export async function handleBack(params: Record<string, unknown>) {
  const { pageId } = S.BackParams.parse(params);
  const { page } = getPage(pageId);
  await page.goBack({ waitUntil: 'load' });
  return { url: page.url(), title: await page.title() };
}

export async function handleEval(params: Record<string, unknown>) {
  const { pageId, expression } = S.EvalParams.parse(params);
  const { page } = getPage(pageId);
  try {
    const value = await page.evaluate((expr) => {
      return new Function(`return (${expr})`)();
    }, expression);
    return { value };
  } catch (err) {
    throw new Error(`Evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function handleClick(params: Record<string, unknown>) {
  const { pageId, selector } = S.ClickParams.parse(params);
  const { page } = getPage(pageId);
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  const tag = await el.evaluate((e) => e.tagName);
  const text = await el.evaluate((e) => (e.textContent || '').slice(0, 100));
  return { clicked: true, tag, text };
}

export async function handleClickReal(params: Record<string, unknown>) {
  const { pageId, selector } = S.ClickParams.parse(params);
  const { page } = getPage(pageId);
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.click({ force: true });
  const tag = await el.evaluate((e) => e.tagName);
  const text = await el.evaluate((e) => (e.textContent || '').slice(0, 100));
  return { clicked: true, tag, text };
}

export async function handleScroll(params: Record<string, unknown>) {
  const { pageId, direction, distance } = S.ScrollParams.parse(params);
  const { page } = getPage(pageId);

  switch (direction) {
    case 'top':
      await page.evaluate('window.scrollTo(0, 0)');
      break;
    case 'bottom':
      await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      break;
    case 'up':
      await page.evaluate(`window.scrollBy(0, -${distance})`);
      break;
    default:
      await page.evaluate(`window.scrollBy(0, ${distance})`);
      break;
  }

  await page.waitForTimeout(800);
  const scrollY = await page.evaluate('window.scrollY') as number;
  return { scrollY };
}

export async function handleScreenshot(params: Record<string, unknown>) {
  const { pageId, file } = S.ScreenshotParams.parse(params);
  const { page } = getPage(pageId);
  await page.screenshot({ path: file, fullPage: false });
  const viewport = page.viewportSize();
  return {
    file,
    width: viewport?.width ?? 0,
    height: viewport?.height ?? 0,
  };
}

export async function handleUpload(params: Record<string, unknown>) {
  const { pageId, selector, files } = S.UploadParams.parse(params);
  const { page } = getPage(pageId);
  await page.setInputFiles(selector, files);
  return { uploaded: true, fileCount: files.length };
}

export async function handleInfo(params: Record<string, unknown>) {
  const { pageId } = S.InfoParams.parse(params);
  const { page } = getPage(pageId);
  return {
    pageId,
    title: await page.title(),
    url: page.url(),
    readyState: await page.evaluate('document.readyState') as string,
  };
}

export async function handlePages() {
  const result = listPages();
  for (const item of result) {
    try {
      const { page } = getPage(item.pageId);
      item.title = await page.title();
      item.url = page.url();
    } catch { /* page may have closed */ }
  }
  return { pages: result };
}

// ---- Page state handler ----

export async function handlePageState(params: Record<string, unknown>) {
  const { pageId, scopedSelectors, raw } = S.PageStateParams.parse(params);
  const { page } = getPage(pageId);
  const state = await collectPageState(page, pageId, { scopedSelectors, raw });
  return state;
}

// ---- Site profile handlers ----

export async function handleSiteProfile(params: Record<string, unknown>) {
  const { domain } = S.SiteProfileParams.parse(params);
  const result = await loadProfile(domain);
  if (!result) {
    throw new Error(`Site profile not found: ${domain}`);
  }
  return {
    profile: result.profile,
    hasMarkdown: result.markdownPath !== null,
  };
}

export async function handleSiteProfiles() {
  return { profiles: listProfiles() };
}

// ---- Network handlers ----

export async function handleNetworkStart(params: Record<string, unknown>) {
  const { pageId } = S.NetworkStartParams.parse(params);
  const { page } = getPage(pageId);
  const state = startMonitor(pageId, page);
  return { active: state.active, startedAt: state.startedAt };
}

export async function handleNetworkRequests(params: Record<string, unknown>) {
  const { pageId, pattern, businessOnly } = S.NetworkRequestsParams.parse(params);
  const requests = getRequests(pageId, { pattern, businessOnly });
  return {
    requests: requests.map(({ responseBody, requestBody, ...r }) => r),
    count: requests.length,
  };
}

export async function handleNetworkStop(params: Record<string, unknown>) {
  const { pageId } = S.NetworkStopParams.parse(params);
  const state = stopMonitor(pageId);
  return {
    active: false,
    totalCaptured: state?.requests.length ?? 0,
    businessApis: state?.requests.filter((r) => r.isBusinessApi).length ?? 0,
  };
}

export async function handleNetworkPatterns(params: Record<string, unknown>) {
  const { pageId } = S.NetworkPatternsParams.parse(params);
  const state = getMonitorState(pageId);
  if (!state) {
    throw new Error(`No active network monitor for page: ${pageId}. Call network.start first.`);
  }
  const patterns = aggregatePatterns(state.requests);
  return { patterns, count: patterns.length };
}

// ---- Decision handlers ----

async function prepareDecisionContext(
  input: {
    pageId: string;
    intent: string;
    description?: string;
    target?: string;
  },
  opts?: {
    includeVisual?: boolean;
    screenshotDir?: string;
  },
) {
  const { pageId, intent, description, target } = input;
  const { page } = getPage(pageId);
  const prevState = previousStates.get(pageId);
  const pageState = await collectPageState(page, pageId, {
    previousState: prevState,
    fallback: opts?.includeVisual
      ? (opts.screenshotDir ? { screenshotDir: opts.screenshotDir } : true)
      : false,
  });
  previousStates.set(pageId, pageState);
  const url = new URL(page.url());
  const profileResult = await loadProfile(url.hostname).catch(() => null);
  const siteProfile = profileResult?.profile ?? null;
  const networkState = getMonitorState(pageId) ?? null;
  const recording = getRecording(pageId);
  const goal: TaskGoal = { intent: intent as TaskGoal['intent'], description: description ?? '', target };
  return { pageId, pageState, siteProfile, networkState, goal, recording };
}

function buildDecisionSnapshot(
  ctx: Awaited<ReturnType<typeof prepareDecisionContext>>,
  opts: {
    mode: 'act' | 'extract' | 'validate';
    maxRefs: number;
    includeVisual?: boolean;
  },
) {
  const candidates = generateCandidates(ctx);
  const proposals = planActions({
    goal: ctx.goal,
    candidates,
    pageState: ctx.pageState,
    siteProfile: ctx.siteProfile,
  });
  const protocol = buildDecisionModelInput({
    goal: ctx.goal,
    pageState: ctx.pageState,
    candidates,
    proposals,
    networkState: ctx.networkState,
    siteProfile: ctx.siteProfile,
    recording: ctx.recording,
    mode: opts.mode,
    maxRefs: opts.maxRefs,
    includeVisual: opts.includeVisual,
  });

  return {
    candidates,
    proposals,
    protocol,
    rendered: renderDecisionModelInput(protocol),
  };
}

function serializeProposal(proposal: ActionProposal | null): Omit<ActionProposal, 'fallback'> | null {
  if (!proposal) return null;
  const { fallback, ...rest } = proposal;
  return rest;
}

function proposalKey(proposal: ActionProposal): string {
  const { params } = proposal;
  switch (params.type) {
    case 'click':
    case 'click-real':
    case 'type':
    case 'select':
    case 'extract':
      return `${params.type}:${params.selector}`;
    case 'navigate':
    case 'api-call':
      return `${params.type}:${params.url}`;
    case 'scroll':
      return `${params.type}:${params.direction}:${params.distance ?? 0}`;
    case 'wait':
      return `${params.type}:${params.condition}:${params.timeout}`;
    case 'eval':
      return `${params.type}:${params.code}`;
    default:
      return 'unknown';
  }
}

export async function handleDecisionCandidates(params: Record<string, unknown>) {
  const parsed = S.DecisionCandidatesParams.parse(params);
  const ctx = await prepareDecisionContext(parsed);
  const candidates = generateCandidates(ctx);
  return { candidates, count: candidates.length };
}

export async function handleDecisionPropose(params: Record<string, unknown>) {
  const parsed = S.DecisionCandidatesParams.parse(params);
  const ctx = await prepareDecisionContext(parsed);
  const candidates = generateCandidates(ctx);
  const proposals = planActions({
    goal: ctx.goal,
    candidates,
    pageState: ctx.pageState,
    siteProfile: ctx.siteProfile,
  });
  return {
    primary: proposals[0] ?? null,
    totalProposals: proposals.length,
    allProposals: proposals.map(({ fallback, ...p }) => p),
  };
}

export async function handleDecisionContext(params: Record<string, unknown>) {
  const parsed = S.DecisionContextParams.parse(params);
  const ctx = await prepareDecisionContext(parsed, {
    includeVisual: parsed.includeVisual,
    screenshotDir: parsed.screenshotDir,
  });
  return buildDecisionSnapshot(ctx, {
    mode: parsed.mode,
    maxRefs: parsed.maxRefs,
    includeVisual: parsed.includeVisual,
  }).protocol;
}

export async function handleDecisionRender(params: Record<string, unknown>) {
  const parsed = S.DecisionContextParams.parse(params);
  const ctx = await prepareDecisionContext(parsed, {
    includeVisual: parsed.includeVisual,
    screenshotDir: parsed.screenshotDir,
  });
  const snapshot = buildDecisionSnapshot(ctx, {
    mode: parsed.mode,
    maxRefs: parsed.maxRefs,
    includeVisual: parsed.includeVisual,
  });
  return {
    protocol: snapshot.protocol,
    rendered: snapshot.rendered,
  };
}

export async function handleDecisionExecute(params: Record<string, unknown>) {
  const parsed = S.DecisionExecuteParams.parse(params);
  const baseCtx = await prepareDecisionContext(parsed, {
    includeVisual: parsed.includeVisual,
    screenshotDir: parsed.screenshotDir,
  });
  const initialSnapshot = buildDecisionSnapshot(baseCtx, {
    mode: parsed.mode,
    maxRefs: parsed.maxRefs,
    includeVisual: parsed.includeVisual,
  });

  if (initialSnapshot.proposals.length === 0) {
    return {
      protocol: initialSnapshot.protocol,
      rendered: initialSnapshot.rendered,
      totalInitialProposals: 0,
      attempts: [],
      executed: null,
      nextProtocol: initialSnapshot.protocol,
      nextRendered: initialSnapshot.rendered,
      nextPrimary: null,
      pageState: baseCtx.pageState,
    };
  }

  const { page } = getPage(parsed.pageId);
  const attempts: Array<{
    attempt: number;
    proposalIndex: number;
    proposal: Omit<ActionProposal, 'fallback'>;
    execution?: Awaited<ReturnType<typeof executeProposal>>;
    verification?: Awaited<ReturnType<typeof verify>>;
    passed: boolean;
    error?: string;
    pageDiff: string;
  }> = [];
  const attempted = new Set<string>();

  let currentCtx = baseCtx;
  let lastSnapshot = initialSnapshot;
  let nextSnapshot = initialSnapshot;
  let executed: (typeof attempts)[number] | null = null;
  const tryFallbacks = parsed.proposalIndex == null ? (parsed.tryFallbacks ?? true) : false;

  for (let attemptIndex = 0; attemptIndex < parsed.maxAttempts; attemptIndex++) {
    const selectedProposal = parsed.proposalIndex != null && attemptIndex === 0
      ? lastSnapshot.proposals[parsed.proposalIndex]
      : lastSnapshot.proposals.find((proposal) => !attempted.has(proposalKey(proposal)));

    if (!selectedProposal) {
      if (parsed.proposalIndex != null) {
        throw new Error(`Proposal index ${parsed.proposalIndex} is out of range`);
      }
      break;
    }

    const selectedProposalIndex = lastSnapshot.proposals.findIndex((proposal) => proposal === selectedProposal);
    attempted.add(proposalKey(selectedProposal));

    let executionResult: Awaited<ReturnType<typeof executeProposal>> | undefined;
    let verificationResult: Awaited<ReturnType<typeof verify>> | undefined;
    let error: string | undefined;

    try {
      executionResult = await executeProposal(page, selectedProposal);
      verificationResult = await verify(page, selectedProposal.verification);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (verificationResult) {
      recordAction(parsed.pageId, selectedProposal, verificationResult);
    }

    const postState = await collectPageState(page, parsed.pageId, {
      previousState: currentCtx.pageState,
      fallback: parsed.includeVisual
        ? (parsed.screenshotDir ? { screenshotDir: parsed.screenshotDir } : true)
        : false,
    });
    previousStates.set(parsed.pageId, postState);

    currentCtx = {
      ...currentCtx,
      pageState: postState,
      networkState: getMonitorState(parsed.pageId) ?? null,
      recording: getRecording(parsed.pageId),
    };

    nextSnapshot = buildDecisionSnapshot(currentCtx, {
      mode: parsed.mode,
      maxRefs: parsed.maxRefs,
      includeVisual: parsed.includeVisual,
    });

    const attemptRecord = {
      attempt: attemptIndex + 1,
      proposalIndex: selectedProposalIndex,
      proposal: serializeProposal(selectedProposal)!,
      execution: executionResult,
      verification: verificationResult,
      passed: verificationResult?.passed ?? false,
      error,
      pageDiff: postState.state_diff ? summarizeDiff(postState.state_diff) : 'no diff available',
    };
    attempts.push(attemptRecord);
    executed = attemptRecord;

    if ((verificationResult?.passed ?? false) || !tryFallbacks || parsed.proposalIndex != null) {
      break;
    }

    lastSnapshot = nextSnapshot;
  }

  return {
    protocol: initialSnapshot.protocol,
    rendered: initialSnapshot.rendered,
    totalInitialProposals: initialSnapshot.proposals.length,
    attempts,
    executed,
    nextProtocol: nextSnapshot.protocol,
    nextRendered: nextSnapshot.rendered,
    nextPrimary: serializeProposal(nextSnapshot.proposals[0] ?? null),
    pageState: currentCtx.pageState,
  };
}

export async function handleDecisionVerify(params: Record<string, unknown>) {
  const { pageId, check, value, timeout } = S.DecisionVerifyParams.parse(params);
  const { page } = getPage(pageId);
  const result = await verify(page, {
    check: check as any,
    value,
    timeout,
  });
  return result;
}

// ---- Experience recording handlers ----

export async function handleExperienceStart(params: Record<string, unknown>) {
  const { pageId, intent, description } = S.ExperienceStartParams.parse(params);
  const { page } = getPage(pageId);
  const url = page.url();
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const record = startRecording(pageId, domain, url, intent, description);
  return { recording: true, domain: record.domain, timestamp: record.timestamp };
}

export async function handleExperienceRecord(params: Record<string, unknown>) {
  const { pageId, action, selector, passed, reason } = S.ExperienceRecordParams.parse(params);

  recordAction(pageId, {
    target: {
      action: action as any,
      reason,
      priority: 0,
      source: 'heuristic',
    },
    params: selector
      ? { type: action as any, selector }
      : { type: action as any } as any,
    verification: {
      check: 'eval_truthy',
      value: 'true',
      timeout: 0,
    },
  }, passed !== undefined ? {
    passed,
    check: 'eval_truthy',
    expected: '',
    elapsed: 0,
  } : undefined);

  const recording = getRecording(pageId);
  return {
    recorded: true,
    actionCount: recording?.action_chain.length ?? 0,
  };
}

export async function handleExperienceComplete(params: Record<string, unknown>) {
  const { pageId, outcome } = S.ExperienceCompleteParams.parse(params);
  const record = completeRecording(pageId, outcome);
  if (!record) {
    throw new Error(`No active recording for page: ${pageId}`);
  }
  return {
    domain: record.domain,
    outcome: record.outcome,
    actions: record.action_chain.length,
    selectors: record.selector_observations.length,
    apis: record.api_observations.length,
    traps: record.trap_observations.length,
  };
}

export async function handleExperienceFlush(params: Record<string, unknown>) {
  const { pageId } = S.ExperienceFlushParams.parse(params);
  const record = getRecording(pageId);
  if (!record) {
    throw new Error(`No recording for page: ${pageId}. Call experience.start first.`);
  }
  const result = updateProfile(record);
  clearRecording(pageId);
  return result;
}

export async function handleExperienceStatus(params: Record<string, unknown>) {
  const { pageId } = S.ExperienceStatusParams.parse(params);
  if (pageId) {
    const record = getRecording(pageId);
    if (!record) {
      return { recording: false };
    }
    return {
      recording: true,
      domain: record.domain,
      outcome: record.outcome,
      actions: record.action_chain.length,
      selectors: record.selector_observations.length,
      apis: record.api_observations.length,
    };
  }
  return { sessions: listRecordings() };
}

// ---- Crawl handler ----

export async function handleCrawl(params: Record<string, unknown>) {
  const { domain, seedPath, outputDir, maxPages, maxDepth, withLlm, resume } = S.CrawlParams.parse(params);
  const logs: string[] = [];
  const result = await runSiteCrawl({
    domain,
    seedPath,
    outputDir,
    maxPages,
    maxDepth,
    withLlm,
    resume,
    onLog: (msg) => logs.push(msg),
  });
  return { ...result.summary, logs };
}

// ---- Batch crawl handler ----

export async function handleBatchCrawl(params: Record<string, unknown>) {
  const { domains, seedPaths, outputDir, maxPages, maxDepth, withLlm } = S.BatchCrawlParams.parse(params);
  const logs: string[] = [];
  const result = await runBatchCrawl({
    domains,
    seedPaths,
    outputDir,
    maxPages,
    maxDepth,
    withLlm,
    onLog: (msg) => logs.push(msg),
  });
  return { ...result, logs };
}

// ---- State diff handler ----

/** In-memory store for previous page states (keyed by pageId) */
const previousStates = new Map<string, PageState>();

export async function handleStateDiff(params: Record<string, unknown>) {
  const { pageId } = S.StateDiffParams.parse(params);
  const { page } = getPage(pageId);
  const currentState = await collectPageState(page, pageId, {});
  const prevState = previousStates.get(pageId);

  let diff;
  let summary;
  if (prevState) {
    diff = computeStateDiff(prevState, currentState);
    summary = summarizeDiff(diff);
  } else {
    diff = null;
    summary = 'no previous state (first collection)';
  }

  previousStates.set(pageId, currentState);
  return { diff, summary, pageState: currentState };
}

/** Clean up stale previous states when a page is closed. */
export function cleanupPageState(pageId: string): void {
  previousStates.delete(pageId);
}

// ---- New handlers: fill / press / select ----

export async function handleFill(params: Record<string, unknown>) {
  const { pageId, selector, value } = S.FillParams.parse(params);
  const { page } = getPage(pageId);
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.fill(value);
  return { filled: true, selector, length: value.length };
}

export async function handlePress(params: Record<string, unknown>) {
  const { pageId, key, selector } = S.PressParams.parse(params);
  const { page } = getPage(pageId);
  if (selector) {
    await page.locator(selector).first().press(key);
  } else {
    await page.keyboard.press(key);
  }
  return { pressed: true, key };
}

export async function handleSelect(params: Record<string, unknown>) {
  const { pageId, selector, values } = S.SelectParams.parse(params);
  const { page } = getPage(pageId);
  const selected = await page.locator(selector).first().selectOption(values);
  return { selected: true, count: selected.length, values: selected };
}
