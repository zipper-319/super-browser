# super-browser

`super-browser` is a browser automation runtime and CLI that reuses a real local Chrome session instead of launching a separate browser profile.

It is designed for agent-style workflows where we want to:

- connect to the user's existing Chrome login state
- open isolated task tabs
- collect structured page state for LLM decision-making
- inspect network activity and site-specific API patterns
- generate and execute ranked next-step proposals
- crawl a domain and accumulate reusable site experience

## What It Includes

- A reusable runtime library exported from `src/core`
- A daemon that manages the browser connection and JSON-RPC methods
- A CLI for page operations, network inspection, decision support, and crawl
- A site-intel layer for profiles, selectors, API patterns, and experience recording
- An `sb.v2` model input protocol for LLM-facing browser state

## Requirements

- Node.js 22+
- A local Chrome or Chromium instance
- Chrome remote debugging enabled for the browser instance you want to reuse

## Install

If the package has been published:

```bash
npm install -g super-browser
```

From source:

```bash
npm install
npm run build
npm install -g .
```

If you do not want a global install, you can use the local bin:

```bash
node ./bin/super-browser.js --help
```

## Chrome Setup

`super-browser` expects to connect to a real Chrome session through CDP.

Example on Windows:

```powershell
chrome.exe --remote-debugging-port=9222
```

Then start the daemon:

```bash
super-browser daemon start
super-browser daemon status
```

## Quick Start

Create a task tab:

```bash
super-browser new --url https://example.com
```

Inspect tabs:

```bash
super-browser pages
super-browser info --page <pageId>
```

Navigate and inspect page state:

```bash
super-browser navigate --page <pageId> --url https://example.com/search?q=phone
super-browser page-state --page <pageId>
```

Take common actions:

```bash
super-browser click --page <pageId> "button.search"
super-browser scroll --page <pageId> --direction down --distance 3000
super-browser screenshot --page <pageId> --file D:\temp\shot.png
```

## Decision Layer

The decision layer can generate candidates, build LLM-facing context, render a prompt-friendly snapshot, and execute the next step automatically.

Generate ranked candidates:

```bash
super-browser decision candidates --page <pageId> --intent search --target "iphone 15"
```

Generate proposals:

```bash
super-browser decision propose --page <pageId> --intent search --target "iphone 15"
```

Build the `sb.v2` model input protocol:

```bash
super-browser decision context --page <pageId> --intent search --target "iphone 15"
```

Render the protocol into prompt-friendly text:

```bash
super-browser decision render --page <pageId> --intent search --target "iphone 15"
```

Plan and execute the next step automatically:

```bash
super-browser decision execute --page <pageId> --intent search --target "iphone 15"
```

`decision.execute` returns:

- the current protocol snapshot
- the rendered prompt text
- execution attempts and verification results
- the next protocol snapshot for the following step

## Network and Site Intel

Start monitoring network requests:

```bash
super-browser network start --page <pageId>
super-browser network requests --page <pageId> --business
super-browser network patterns --page <pageId>
super-browser network stop --page <pageId>
```

Inspect site profiles:

```bash
super-browser site-profile --domain example.com
super-browser site-profiles
```

Record runtime experience:

```bash
super-browser experience start --page <pageId> --intent search --description "Search for a product"
super-browser experience status --page <pageId>
super-browser experience complete --page <pageId> --outcome success
super-browser experience flush --page <pageId>
```

## Crawl

Run a crawl to generate site drafts and reusable experience artifacts:

```bash
super-browser crawl --domain example.com --output ./outputs --max-pages 50 --max-depth 3
```

Resume from checkpoint:

```bash
super-browser crawl --domain example.com --output ./outputs --resume
```

Run optional LLM post-analysis:

```bash
super-browser crawl --domain example.com --output ./outputs --with-llm
```

## Library Usage

The package also exposes a reusable runtime API.

```ts
import {
  connect,
  createTab,
  collectPageState,
  generateCandidates,
  planActions,
  buildDecisionModelInput,
} from 'super-browser';
```

See the public exports in [src/core/index.ts](./src/core/index.ts).

## Architecture

The project is organized into these main layers:

- `src/core`
  - public runtime/library surface
- `src/browser`
  - CDP connection, tab management, Chrome port discovery
- `src/page-state`
  - structured page-state collection, compression, diffs, fallback capture
- `src/network`
  - network monitoring, request classification, pattern aggregation
- `src/site-intel`
  - site profiles, runtime experience recording, profile updates
- `src/decision`
  - candidate generation, action planning, execution, verification, `sb.v2` model input
- `src/daemon`
  - daemon bootstrap and protocol wiring
- `src/server`
  - handlers, schemas, HTTP compatibility router
- `src/crawl`
  - site crawl, checkpointing, draft generation, optional LLM analysis

## Development

Install dependencies and build:

```bash
npm install
npm run build
```

Watch mode:

```bash
npm run dev
```

Run the daemon from source:

```bash
npm run daemon
```

## Notes

- CLI stdout is intended to stay machine-readable JSON.
- The daemon auto-starts when CLI commands need it.
- `super-browser` should operate on dedicated task tabs rather than taking over the user's existing tabs.
- The best results come from combining `page-state`, `network`, and the decision layer instead of relying on raw DOM inspection alone.
