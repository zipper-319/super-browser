/**
 * super-browser CLI - thin client that sends JSON-RPC 2.0 commands to the daemon.
 */

import { program } from 'commander';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rpcCall, isDaemonRunning } from '../rpc/client.js';
import { isErrorResponse, exitCodeMap } from '../rpc/protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

function fail(message: string, exitCode = 1): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(exitCode);
}

function printHelpfulError(message: string): void {
  const lower = message.toLowerCase();
  if (lower.includes('chrome debugging port') || lower.includes('cdp')) {
    process.stderr.write('Hint: run `super-browser doctor` for a connection diagnosis.\n');
    process.stderr.write('Hint: on Windows, if Chrome is already open, fully close it and relaunch with `chrome.exe --remote-debugging-port=9222`.\n');
  }
}

async function call(method: string, params?: Record<string, unknown>, timeout?: number): Promise<unknown> {
  const running = await isDaemonRunning();
  if (!running) {
    await startDaemon();
  }

  const response = await rpcCall(method, params, { timeout });
  if (isErrorResponse(response)) {
    const exitCode = exitCodeMap[response.error.code] ?? 1;
    process.stderr.write(`Error: ${response.error.message}\n`);
    printHelpfulError(response.error.message);
    output(response.error);
    process.exit(exitCode);
  }
  return response.result;
}

async function startDaemon(): Promise<void> {
  const daemonScript = path.resolve(__dirname, '../daemon.js');
  const child = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env },
  });

  child.unref();

  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(200);
    if (await isDaemonRunning()) {
      return;
    }
  }

  fail('Failed to start daemon (timeout)', 3);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function configureProgram(): void {
  program
    .name('super-browser')
    .description('Browser agent CLI powered by Playwright + local Chrome')
    .version('2.0.0');

  const daemon = program.command('daemon').description('Manage daemon process');
  daemon.command('start')
    .description('Start daemon (auto-discovers Chrome port)')
    .action(async () => {
      if (await isDaemonRunning()) {
        output(await call('daemon.status'));
        return;
      }
      await startDaemon();
      output(await call('daemon.status'));
    });

  daemon.command('status')
    .description('Check daemon and browser connection status')
    .action(async () => {
      output(await call('daemon.status'));
    });

  daemon.command('stop')
    .description('Stop daemon gracefully')
    .action(async () => {
      output(await call('daemon.stop'));
    });

  program.command('doctor')
    .description('Diagnose daemon and Chrome/CDP connection state')
    .action(async () => {
      output(await call('doctor'));
    });

  program.command('new')
    .description('Create a new background tab')
    .requiredOption('--url <url>', 'URL to open')
    .action(async (opts) => {
      output(await call('new', { url: opts.url }, 60_000));
    });

  program.command('close')
    .description('Close a tab')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (opts) => {
      output(await call('close', { pageId: opts.page }));
    });

  program.command('navigate')
    .description('Navigate to URL')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--url <url>', 'URL')
    .action(async (opts) => {
      output(await call('navigate', { pageId: opts.page, url: opts.url }, 60_000));
    });

  program.command('eval')
    .description('Execute JavaScript')
    .requiredOption('--page <id>', 'Page ID')
    .argument('<expression>', 'JS expression')
    .action(async (expression, opts) => {
      output(await call('eval', { pageId: opts.page, expression }));
    });

  program.command('click')
    .description('Click element (JS click)')
    .requiredOption('--page <id>', 'Page ID')
    .argument('<selector>', 'CSS selector')
    .action(async (selector, opts) => {
      output(await call('click', { pageId: opts.page, selector }));
    });

  program.command('click-real')
    .description('Click element (real mouse event)')
    .requiredOption('--page <id>', 'Page ID')
    .argument('<selector>', 'CSS selector')
    .action(async (selector, opts) => {
      output(await call('click-real', { pageId: opts.page, selector }));
    });

  program.command('scroll')
    .description('Scroll page')
    .requiredOption('--page <id>', 'Page ID')
    .option('--direction <dir>', 'up|down|top|bottom', 'down')
    .option('--distance <px>', 'Scroll distance in pixels', '3000')
    .action(async (opts) => {
      output(await call('scroll', {
        pageId: opts.page,
        direction: opts.direction,
        distance: parseInt(opts.distance, 10),
      }));
    });

  program.command('screenshot')
    .description('Take screenshot')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--file <path>', 'Output file path')
    .action(async (opts) => {
      output(await call('screenshot', { pageId: opts.page, file: opts.file }));
    });

  program.command('upload')
    .description('Upload files to file input')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--selector <sel>', 'File input CSS selector')
    .requiredOption('--files <paths...>', 'File paths')
    .action(async (opts) => {
      output(await call('upload', {
        pageId: opts.page,
        selector: opts.selector,
        files: opts.files,
      }));
    });

  program.command('info')
    .description('Get page info (title, URL, state)')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (opts) => {
      output(await call('info', { pageId: opts.page }));
    });

  program.command('pages')
    .description('List all managed tabs')
    .action(async () => {
      output(await call('pages'));
    });

  const network = program.command('network').description('Network monitoring');
  network.command('start')
    .description('Start monitoring network requests')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (opts) => {
      output(await call('network.start', { pageId: opts.page }));
    });

  network.command('requests')
    .description('Get captured API requests')
    .requiredOption('--page <id>', 'Page ID')
    .option('--pattern <pattern>', 'URL filter pattern')
    .option('--business', 'Only show business APIs')
    .action(async (opts) => {
      output(await call('network.requests', {
        pageId: opts.page,
        pattern: opts.pattern,
        businessOnly: opts.business,
      }));
    });

  network.command('patterns')
    .description('Discover API patterns from captured requests')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (opts) => {
      output(await call('network.patterns', { pageId: opts.page }));
    });

  network.command('stop')
    .description('Stop monitoring')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (opts) => {
      output(await call('network.stop', { pageId: opts.page }));
    });

  program.command('page-state')
    .description('Get structured page state (interactive elements + context blocks)')
    .requiredOption('--page <id>', 'Page ID')
    .option('--raw', 'Return raw data without compression')
    .action(async (opts) => {
      output(await call('page-state', { pageId: opts.page, raw: opts.raw }));
    });

  program.command('site-profile')
    .description('Load site experience profile')
    .requiredOption('--domain <domain>', 'Domain name')
    .action(async (opts) => {
      output(await call('site-profile', { domain: opts.domain }));
    });

  program.command('site-profiles')
    .description('List all available site profiles')
    .action(async () => {
      output(await call('site-profiles'));
    });

  const decision = program.command('decision').description('Decision layer');
  decision.command('candidates')
    .description('Generate candidate targets for a task goal')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--intent <intent>', 'Task intent (search|extract|click|paginate|fill-form|login|generic)')
    .option('--description <desc>', 'Natural language goal description')
    .option('--target <value>', 'Target keyword or value')
    .action(async (opts) => {
      output(await call('decision.candidates', {
        pageId: opts.page,
        intent: opts.intent,
        description: opts.description,
        target: opts.target,
      }));
    });

  decision.command('propose')
    .description('Generate action proposals with verification conditions')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--intent <intent>', 'Task intent')
    .option('--description <desc>', 'Natural language goal description')
    .option('--target <value>', 'Target keyword or value')
    .action(async (opts) => {
      output(await call('decision.propose', {
        pageId: opts.page,
        intent: opts.intent,
        description: opts.description,
        target: opts.target,
      }));
    });

  decision.command('context')
    .description('Build the sb.v2 model input protocol for the current page')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--intent <intent>', 'Task intent')
    .option('--description <desc>', 'Natural language goal description')
    .option('--target <value>', 'Target keyword or value')
    .option('--mode <mode>', 'Decision mode (act|extract|validate)', 'act')
    .option('--max-refs <n>', 'Max interactive refs to expose', '18')
    .option('--visual', 'Include fallback/visual artifacts when available')
    .option('--screenshot-dir <dir>', 'Directory for optional decision snapshots')
    .action(async (opts) => {
      output(await call('decision.context', {
        pageId: opts.page,
        intent: opts.intent,
        description: opts.description,
        target: opts.target,
        mode: opts.mode,
        maxRefs: parseInt(opts.maxRefs, 10),
        includeVisual: opts.visual,
        screenshotDir: opts.screenshotDir,
      }));
    });

  decision.command('render')
    .description('Render the sb.v2 model input protocol into prompt-friendly text')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--intent <intent>', 'Task intent')
    .option('--description <desc>', 'Natural language goal description')
    .option('--target <value>', 'Target keyword or value')
    .option('--mode <mode>', 'Decision mode (act|extract|validate)', 'act')
    .option('--max-refs <n>', 'Max interactive refs to expose', '18')
    .option('--visual', 'Include fallback/visual artifacts when available')
    .option('--screenshot-dir <dir>', 'Directory for optional decision snapshots')
    .action(async (opts) => {
      output(await call('decision.render', {
        pageId: opts.page,
        intent: opts.intent,
        description: opts.description,
        target: opts.target,
        mode: opts.mode,
        maxRefs: parseInt(opts.maxRefs, 10),
        includeVisual: opts.visual,
        screenshotDir: opts.screenshotDir,
      }));
    });

  decision.command('execute')
    .description('Plan and automatically execute the next decision step')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--intent <intent>', 'Task intent')
    .option('--description <desc>', 'Natural language goal description')
    .option('--target <value>', 'Target keyword or value')
    .option('--mode <mode>', 'Decision mode (act|extract|validate)', 'act')
    .option('--max-refs <n>', 'Max interactive refs to expose', '18')
    .option('--proposal-index <n>', 'Execute a specific proposal index from the current plan')
    .option('--max-attempts <n>', 'Maximum automatic attempts / replans', '3')
    .option('--no-try-fallbacks', 'Disable automatic fallback/replan attempts')
    .option('--visual', 'Include fallback/visual artifacts when available')
    .option('--screenshot-dir <dir>', 'Directory for optional decision snapshots')
    .action(async (opts) => {
      output(await call('decision.execute', {
        pageId: opts.page,
        intent: opts.intent,
        description: opts.description,
        target: opts.target,
        mode: opts.mode,
        maxRefs: parseInt(opts.maxRefs, 10),
        proposalIndex: opts.proposalIndex !== undefined ? parseInt(opts.proposalIndex, 10) : undefined,
        maxAttempts: parseInt(opts.maxAttempts, 10),
        tryFallbacks: opts.tryFallbacks,
        includeVisual: opts.visual,
        screenshotDir: opts.screenshotDir,
      }, 120_000));
    });

  decision.command('verify')
    .description('Run a verification condition')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--check <type>', 'Check type (selector_exists|url_changed|eval_truthy|...)')
    .requiredOption('--value <value>', 'Check value')
    .option('--timeout <ms>', 'Timeout in ms', '5000')
    .action(async (opts) => {
      output(await call('decision.verify', {
        pageId: opts.page,
        check: opts.check,
        value: opts.value,
        timeout: parseInt(opts.timeout, 10),
      }));
    });

  program.command('crawl')
    .description('Run site-crawl to generate experience drafts')
    .option('--domain <domain>', 'Target domain')
    .option('--seed <path>', 'Seed config JSON path')
    .option('--output <dir>', 'Output directory', './outputs')
    .option('--max-pages <n>', 'Max pages to visit', '50')
    .option('--max-depth <n>', 'Max link depth', '3')
    .option('--resume', 'Resume from the latest checkpoint under the output directory')
    .option('--with-llm', 'Enable optional LLM post-analysis')
    .action(async (opts) => {
      if (!opts.domain && !opts.seed) {
        fail('Either --domain or --seed is required');
      }
      output(await call('crawl', {
        domain: opts.domain,
        seedPath: opts.seed,
        outputDir: opts.output,
        maxPages: parseInt(opts.maxPages, 10),
        maxDepth: parseInt(opts.maxDepth, 10),
        resume: opts.resume,
        withLlm: opts.withLlm,
      }, 600_000));
    });

  const experience = program.command('experience').description('Runtime experience recording');
  experience.command('start')
    .description('Start recording experience for a task')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--intent <intent>', 'Task intent')
    .option('--description <desc>', 'Task description')
    .action(async (opts) => {
      output(await call('experience.start', {
        pageId: opts.page,
        intent: opts.intent,
        description: opts.description,
      }));
    });

  experience.command('record')
    .description('Record an action result')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--action <type>', 'Action type (click|type|scroll|...)')
    .option('--selector <sel>', 'CSS selector used')
    .option('--passed', 'Verification passed')
    .option('--failed', 'Verification failed')
    .option('--reason <reason>', 'Action reason')
    .action(async (opts) => {
      const passed = opts.passed ? true : opts.failed ? false : undefined;
      output(await call('experience.record', {
        pageId: opts.page,
        action: opts.action,
        selector: opts.selector,
        passed,
        reason: opts.reason,
      }));
    });

  experience.command('complete')
    .description('Mark recording as complete')
    .requiredOption('--page <id>', 'Page ID')
    .requiredOption('--outcome <outcome>', 'Task outcome (success|partial|failure)')
    .action(async (opts) => {
      output(await call('experience.complete', {
        pageId: opts.page,
        outcome: opts.outcome,
      }));
    });

  experience.command('flush')
    .description('Flush recording to site profile JSON')
    .requiredOption('--page <id>', 'Page ID')
    .action(async (opts) => {
      output(await call('experience.flush', { pageId: opts.page }));
    });

  experience.command('status')
    .description('Check recording status')
    .option('--page <id>', 'Page ID (omit for all sessions)')
    .action(async (opts) => {
      output(await call('experience.status', { pageId: opts.page }));
    });
}

let configured = false;

export async function runCli(argv: string[] = process.argv): Promise<void> {
  if (!configured) {
    configureProgram();
    configured = true;
  }
  await program.parseAsync(argv);
}
