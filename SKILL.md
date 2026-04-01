---
name: super-browser
description: Use when Codex needs to operate a real local Chrome session through the `super-browser` npm package, including opening task tabs, navigating pages, collecting structured page state, monitoring network requests, generating action proposals, or running site crawl flows. Prefer this skill for browser automation that should reuse the user's existing Chrome login state instead of launching a separate browser.
---

# super-browser Skill

Install and use the published `super-browser` package. Do not rely on `src/`, local scripts, or repository-only paths when performing browser work through this skill.

## Setup

Require:
- Node.js 22+
- Chrome or Chromium running locally
- Chrome remote debugging enabled for the current browser instance

Check the CLI first:

```bash
super-browser --version
```

If the command is missing, install the package:

```bash
npm install -g super-browser
```

If a global install is not appropriate, use:

```bash
npx super-browser --help
```

## Chrome Requirement

Use the local Chrome session so the browser already carries the user's login state.

Before browser actions:
1. Ensure Chrome is already open.
2. Ensure remote debugging is enabled for that browser instance.
3. Start the daemon and confirm the connection:

```bash
super-browser daemon start
super-browser daemon status
```

If the daemon reports that Chrome is not connected, stop and help the user enable remote debugging before continuing.

## Operating Rules

- Create and use your own task tabs. Do not take over the user's existing tabs unless the user explicitly asks.
- Prefer structured CLI commands over ad hoc browser scripts.
- Treat CLI stdout as machine-readable JSON.
- Close tabs you created when the task is finished.
- Usually leave the daemon running after the task unless the user explicitly asks to stop it.

## Core Workflow

Create a task tab:

```bash
super-browser new --url https://example.com
```

The response returns a `pageId`. Reuse that `pageId` in later commands.

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

Click or type:

```bash
super-browser click --page <pageId> "button.search"
super-browser click-real --page <pageId> "input[type=file]"
super-browser eval --page <pageId> "document.title"
super-browser scroll --page <pageId> --direction down --distance 3000
super-browser screenshot --page <pageId> --file D:\\temp\\shot.png
super-browser upload --page <pageId> --selector "input[type=file]" --files D:\\tmp\\a.pdf D:\\tmp\\b.pdf
```

Inspect browser state:

```bash
super-browser info --page <pageId>
super-browser page-state --page <pageId> --raw
```

Use network monitoring:

```bash
super-browser network start --page <pageId>
super-browser network requests --page <pageId> --business
super-browser network patterns --page <pageId>
super-browser network stop --page <pageId>
```

Use the decision layer:

```bash
super-browser decision candidates --page <pageId> --intent search --target "iphone"
super-browser decision propose --page <pageId> --intent search --target "iphone"
super-browser decision verify --page <pageId> --check selector_exists --value ".result-list"
```

Use site profiles:

```bash
super-browser site-profile --domain example.com
super-browser site-profiles
```

Run crawl:

```bash
super-browser crawl --domain example.com --output .\\outputs --max-pages 50 --max-depth 3
super-browser crawl --domain example.com --output .\\outputs --resume
super-browser crawl --domain example.com --output .\\outputs --with-llm
```

## Login Handling

Assume the user's everyday Chrome may already be logged in.

Judge login status by whether the target content can actually be reached. Only ask the user to log in when:
- the required page or data is not accessible, and
- the failure is best explained by missing authentication.

When login is required, tell the user to complete login in their Chrome window, then continue with the same daemon session.

## Recommended Strategy

- Prefer `page-state` when deciding what to do next on a page.
- Prefer `network` commands when the page is a SPA or the useful data comes from XHR or fetch responses.
- Prefer `decision propose` when a site profile exists or when you want a ranked next action instead of guessing.
- Prefer `crawl` when the goal is to discover reusable selectors, URL templates, or API patterns for a domain.

## Cleanup

At the end of the task:
1. Close every task tab you created with `super-browser close`.
2. Keep the user's original tabs untouched.
3. Leave the daemon running unless the user asks to stop it.

If the user explicitly wants shutdown:

```bash
super-browser daemon stop
```
