---
name: super-browser
description: Browser automation through the published `@pzeda/super-browser` package and its `super-browser` CLI against a real local Chrome session. Use whenever the task needs to open a webpage, navigate a site, inspect browser-rendered content, reuse an existing website login state, click through a web flow, upload files, take screenshots, inspect network requests, collect structured page state, generate or execute browser decisions, or crawl a domain.
---

# super-browser Skill

Use the published `@pzeda/super-browser` package. Do not rely on repository-only scripts or `src/` paths when performing browser work through this skill.

## Setup

Require:

- Node.js 22+
- Chrome or Chromium installed locally
- A Chrome session that can expose CDP on port `9222`

Check the CLI first:

```bash
super-browser --version
```

If the command is missing, install it:

```bash
npm install -g @pzeda/super-browser
```

This installs the executable as `super-browser`.

If a global install is not appropriate, use:

```bash
npx -y @pzeda/super-browser --help
```

## Standard Rule

If the task needs a real browser at all, use this skill first.

Typical triggers:

- open a website or visit a URL
- browse, click, search, paginate, or fill a web flow
- inspect what a page really renders in Chrome
- reuse an already logged-in browser session
- upload files or take screenshots in a browser
- inspect browser-side network requests
- ask the agent to operate a site instead of only analyzing HTML

## Chrome Connection Flow

Do not lead with daemon management in the normal path.

For ordinary browser tasks, directly run the browser command you need, for example:

```bash
super-browser new --url https://example.com
```

The CLI will auto-start and reuse the daemon in the background.

Only switch into explicit connection diagnosis when browser commands fail or when `browserConnected` is reported as `false`.

Preferred diagnosis entrypoint:

```bash
super-browser doctor
```

Use `super-browser daemon status` only as an advanced status check.

If `browserConnected` is `false`, do not assume that an open Chrome window means CDP is available. On Windows, launching:

```bash
chrome.exe --remote-debugging-port=9222
```

while Chrome is already running may silently reuse the existing instance and ignore the new flag.

Use this recovery order:

1. Try a normal Chrome launch with remote debugging:

```powershell
Start-Process chrome.exe -ArgumentList '--remote-debugging-port=9222'
Start-Sleep -Seconds 2
Invoke-WebRequest http://127.0.0.1:9222/json/version | Select-Object -Expand Content
super-browser doctor
```

2. If `http://127.0.0.1:9222/json/version` still does not respond, explain that Chrome is not actually exposing CDP yet.

3. If the task depends on the user's logged-in Chrome session, ask the user to fully close Chrome and relaunch it with:

```powershell
chrome.exe --remote-debugging-port=9222
```

Then retry:

```bash
super-browser doctor
```

Connection success means all of these are true:

- `super-browser daemon status` shows `"browserConnected": true`
- `chromePort` is not `null`
- `http://127.0.0.1:9222/json/version` responds successfully

Important:

- Treat `browserConnected: false` as a Chrome/CDP setup issue, not as a page-level issue.
- Prefer recovering the existing Chrome session before asking the user to log in again.
- Do not force-close Chrome unless the user is okay restarting it.

## Core Workflow

When the task needs to use the browser, follow this order:

1. Ensure `super-browser` is available.
2. Run the actual browser command you need. Let the CLI auto-start the daemon.
3. If browser connection fails, run `super-browser doctor`.
4. Create and use a dedicated task tab.
5. Reuse the returned `pageId` for all later commands.
6. Prefer structured commands over ad hoc browser scripts.

Create a task tab:

```bash
super-browser new --url https://example.com
```

Important:

- Use `super-browser new --url <url>`
- Do not use `super-browser new page --url <url>`

Navigate:

```bash
super-browser navigate --page <pageId> --url https://example.com/search?q=phone
```

Inspect page state:

```bash
super-browser page-state --page <pageId>
```

List managed tabs:

```bash
super-browser pages
```

Close the task tab:

```bash
super-browser close --page <pageId>
```

## Common Commands

Basic page operations:

```bash
super-browser info --page <pageId>
super-browser eval --page <pageId> "document.title"
super-browser click --page <pageId> "button.search"
super-browser click-real --page <pageId> "input[type=file]"
super-browser scroll --page <pageId> --direction down --distance 3000
super-browser screenshot --page <pageId> --file D:\\temp\\shot.png
super-browser upload --page <pageId> --selector "input[type=file]" --files D:\\tmp\\a.pdf D:\\tmp\\b.pdf
```

Page-state and debugging:

```bash
super-browser page-state --page <pageId>
super-browser page-state --page <pageId> --raw
```

Network inspection:

```bash
super-browser network start --page <pageId>
super-browser network requests --page <pageId> --business
super-browser network patterns --page <pageId>
super-browser network stop --page <pageId>
```

Site profiles:

```bash
super-browser site-profile --domain example.com
super-browser site-profiles
```

## Decision Workflow

Prefer the decision layer when the next action is ambiguous.

Generate candidates:

```bash
super-browser decision candidates --page <pageId> --intent search --target "iphone"
```

Generate proposals:

```bash
super-browser decision propose --page <pageId> --intent search --target "iphone"
```

Build the `sb.v2` model input protocol:

```bash
super-browser decision context --page <pageId> --intent search --target "iphone"
```

Render the protocol into prompt-friendly text:

```bash
super-browser decision render --page <pageId> --intent search --target "iphone"
```

Plan and execute the next browser step automatically:

```bash
super-browser decision execute --page <pageId> --intent search --target "iphone"
```

Run explicit verification:

```bash
super-browser decision verify --page <pageId> --check selector_exists --value ".result-list"
```

## Login Handling

Assume the user's existing Chrome session may already be logged in.

Judge login status by whether the target content is actually reachable. Only ask the user to log in when:

- the required content or action is blocked
- the failure is best explained by missing authentication
- Chrome/CDP connection itself is already healthy

If login is required, tell the user to complete login in their Chrome window, then continue with the same daemon session.

## Crawl

Use crawl when the goal is to discover reusable selectors, API patterns, or site-specific experience.

```bash
super-browser crawl --domain example.com --output .\\outputs --max-pages 50 --max-depth 3
super-browser crawl --domain example.com --output .\\outputs --resume
super-browser crawl --domain example.com --output .\\outputs --with-llm
```

## Operating Rules

- Create and use your own task tabs.
- Do not take over the user's existing tabs unless explicitly asked.
- Treat CLI stdout as machine-readable JSON.
- Prefer `page-state`, `network`, and `decision` over guessing from raw HTML alone.
- Keep the daemon running unless the user explicitly asks to stop it.
- Treat `daemon` commands as advanced diagnostics, not the default workflow.

## Failure Handling

If something fails, classify the problem before proceeding:

- `browserConnected: false`
  Run `super-browser doctor`, then fix Chrome/CDP connection first.
- page opens but target content is missing
  Inspect `page-state` and `network`.
- target content exists but next action is unclear
  Use `decision propose`, `decision context`, or `decision execute`.
- action fails with no visible change
  Re-check page state, overlays, and network activity before retrying.

## Cleanup

At the end of the task:

1. Close every task tab you created with `super-browser close`.
2. Keep the user's original tabs untouched.
3. Leave the daemon running unless the user asks to stop it.

If the user explicitly wants shutdown:

```bash
super-browser daemon stop
```
