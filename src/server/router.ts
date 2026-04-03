/**
 * HTTP compatibility router — maps v1 HTTP endpoints to internal handlers.
 * This enables backward compatibility: existing curl calls from SKILL.md still work.
 */

import http from 'node:http';
import { URL } from 'node:url';
import * as handlers from './handlers.js';

/**
 * Create the HTTP server for v1 backward compatibility.
 * Maps GET/POST /endpoint?params to the corresponding handler.
 */
export function createHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    const parsed = new URL(req.url || '/', `http://localhost`);
    const pathname = parsed.pathname;
    const q = Object.fromEntries(parsed.searchParams);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    try {
      let result: unknown;

      switch (pathname) {
        case '/health':
          result = await handlers.handleDaemonStatus();
          break;

        case '/doctor':
          result = await handlers.handleDoctor();
          break;

        case '/targets':
          result = (await handlers.handlePages()).pages;
          break;

        case '/new':
          result = await handlers.handleNew({ url: q.url });
          break;

        case '/close':
          result = await handlers.handleClose({ pageId: q.target });
          break;

        case '/navigate':
          result = await handlers.handleNavigate({ pageId: q.target, url: q.url });
          break;

        case '/back':
          result = await handlers.handleBack({ pageId: q.target });
          break;

        case '/eval': {
          const body = await readBody(req);
          result = await handlers.handleEval({
            pageId: q.target,
            expression: body || q.expr || 'document.title',
          });
          break;
        }

        case '/click': {
          const selector = await readBody(req);
          result = await handlers.handleClick({ pageId: q.target, selector });
          break;
        }

        case '/clickAt': {
          const selector = await readBody(req);
          result = await handlers.handleClickReal({ pageId: q.target, selector });
          break;
        }

        case '/scroll':
          result = await handlers.handleScroll({
            pageId: q.target,
            direction: q.direction || 'down',
            distance: parseInt(q.y || '3000'),
          });
          break;

        case '/fill': {
          const body = await readBody(req);
          const parsed = body ? JSON.parse(body) : {};
          result = await handlers.handleFill({
            pageId: q.target,
            selector: parsed.selector || q.selector,
            value: parsed.value ?? q.value ?? '',
          });
          break;
        }

        case '/press':
          result = await handlers.handlePress({
            pageId: q.target,
            key: q.key,
            selector: q.selector,
          });
          break;

        case '/select': {
          const body = JSON.parse(await readBody(req));
          result = await handlers.handleSelect({
            pageId: q.target,
            selector: body.selector || q.selector,
            values: body.values,
          });
          break;
        }

        case '/screenshot':
          result = await handlers.handleScreenshot({ pageId: q.target, file: q.file });
          break;

        case '/setFiles': {
          const body = JSON.parse(await readBody(req));
          result = await handlers.handleUpload({
            pageId: q.target,
            selector: body.selector,
            files: body.files,
          });
          break;
        }

        case '/info':
          result = await handlers.handleInfo({ pageId: q.target });
          break;

        case '/page-state':
          result = await handlers.handlePageState({ pageId: q.target });
          break;

        case '/site-profile':
          result = await handlers.handleSiteProfile({ domain: q.domain });
          break;

        case '/site-profiles':
          result = await handlers.handleSiteProfiles();
          break;

        case '/network/start':
          result = await handlers.handleNetworkStart({ pageId: q.target, pattern: q.pattern });
          break;

        case '/network/requests':
          result = await handlers.handleNetworkRequests({ pageId: q.target, pattern: q.pattern });
          break;

        case '/network/stop':
          result = await handlers.handleNetworkStop({ pageId: q.target });
          break;

        case '/network/patterns':
          result = await handlers.handleNetworkPatterns({ pageId: q.target });
          break;

        case '/decision/candidates':
          result = await handlers.handleDecisionCandidates({
            pageId: q.target,
            intent: q.intent,
            description: q.description,
            target: q.target_value,
          });
          break;

        case '/decision/propose':
          result = await handlers.handleDecisionPropose({
            pageId: q.target,
            intent: q.intent,
            description: q.description,
            target: q.target_value,
          });
          break;

        case '/decision/context':
          result = await handlers.handleDecisionContext({
            pageId: q.target,
            intent: q.intent,
            description: q.description,
            target: q.target_value,
            mode: q.mode,
            maxRefs: q.max_refs ? parseInt(q.max_refs) : undefined,
            includeVisual: q.include_visual === 'true',
            screenshotDir: q.screenshot_dir,
          });
          break;

        case '/decision/render':
          result = await handlers.handleDecisionRender({
            pageId: q.target,
            intent: q.intent,
            description: q.description,
            target: q.target_value,
            mode: q.mode,
            maxRefs: q.max_refs ? parseInt(q.max_refs) : undefined,
            includeVisual: q.include_visual === 'true',
            screenshotDir: q.screenshot_dir,
          });
          break;

        case '/decision/execute':
          result = await handlers.handleDecisionExecute({
            pageId: q.target,
            intent: q.intent,
            description: q.description,
            target: q.target_value,
            mode: q.mode,
            maxRefs: q.max_refs ? parseInt(q.max_refs) : undefined,
            includeVisual: q.include_visual === 'true',
            screenshotDir: q.screenshot_dir,
            proposalIndex: q.proposal_index ? parseInt(q.proposal_index) : undefined,
            maxAttempts: q.max_attempts ? parseInt(q.max_attempts) : undefined,
            tryFallbacks: q.try_fallbacks === 'true',
          });
          break;

        case '/decision/verify':
          result = await handlers.handleDecisionVerify({
            pageId: q.target,
            check: q.check,
            value: q.value,
            timeout: q.timeout ? parseInt(q.timeout) : undefined,
          });
          break;

        case '/crawl': {
          const body = req.method === 'POST' ? JSON.parse(await readBody(req)) : {};
          result = await handlers.handleCrawl({
            domain: q.domain || body.domain,
            seedPath: q.seed || body.seedPath,
            outputDir: q.output || body.outputDir || './outputs',
            maxPages: q.max_pages ? parseInt(q.max_pages) : body.maxPages,
            maxDepth: q.max_depth ? parseInt(q.max_depth) : body.maxDepth,
            withLlm: q.with_llm === 'true' || body.withLlm,
            resume: q.resume === 'true' || body.resume,
          });
          break;
        }

        case '/crawl/batch': {
          const body = JSON.parse(await readBody(req));
          result = await handlers.handleBatchCrawl({
            domains: body.domains,
            seedPaths: body.seedPaths,
            outputDir: body.outputDir || './outputs',
            maxPages: body.maxPages,
            maxDepth: body.maxDepth,
            withLlm: body.withLlm,
          });
          break;
        }

        case '/state-diff':
          result = await handlers.handleStateDiff({ pageId: q.target });
          break;

        case '/experience/start':
          result = await handlers.handleExperienceStart({
            pageId: q.target,
            intent: q.intent,
            description: q.description,
          });
          break;

        case '/experience/record': {
          const body = JSON.parse(await readBody(req));
          result = await handlers.handleExperienceRecord({
            pageId: q.target,
            ...body,
          });
          break;
        }

        case '/experience/complete':
          result = await handlers.handleExperienceComplete({
            pageId: q.target,
            outcome: q.outcome,
          });
          break;

        case '/experience/flush':
          result = await handlers.handleExperienceFlush({ pageId: q.target });
          break;

        case '/experience/status':
          result = await handlers.handleExperienceStatus({ pageId: q.target });
          break;

        default:
          res.statusCode = 404;
          result = { error: 'Unknown endpoint', path: pathname };
      }

      res.end(JSON.stringify(result, null, 2));
    } catch (err) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
