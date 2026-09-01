---
name: openhome3d-start
description: Open the OpenHome3D Community Hub or install, update, verify, start, and introduce OpenHome3D. Use whenever the user asks for the OpenHome3D community center/hub, Companion UI, or to try, open, run, set up, or learn the project. Use for local application setup and the visual community entry, not for publishing GitHub contributions.
---

# OpenHome3D Start

Bring the user to an observable running OpenHome3D session with the least manual setup.

## Outcome

- An existing clone is updated safely, or a new clone is created.
- Node.js 20+ dependencies are installed and the project passes `npm run doctor` and `npm run build`.
- The dev server remains running on its printed random loopback port.
- Open the URL in Codex's in-app browser when that capability is available; otherwise return the clickable URL.
- Briefly point out whole-home editing, furniture editing, floor-plan import, AI repaint, and the Companion community hub.

## Workflow

1. If the current workspace is OpenHome3D, use it. Otherwise look for an existing nearby `OpenHome3D` clone before creating one. Never overwrite a non-empty directory.
2. Before pulling an existing clone, inspect `git status --short`. Preserve user changes; use `git pull --ff-only` only when it is safe.
3. Check Node.js, npm, Codex CLI, and Codex login. Do not read credential files. Ask before installing system-level software.
4. Run `npm install`, `npm run doctor`, and `npm run build`. A failed Codex login blocks only optional AI features; the browser-only designer can still run.
5. Start `npm run dev` in a persistent terminal/session. Read the actual printed URL rather than assuming a port.
6. Verify the page returns HTTP 200. Open it in the in-app browser if available.

## Community hub

When the user asks to open the OpenHome3D community center, resolve and call the Companion MCP tool `open_openhome3d_hub`. Its `ui://openhome3d/community-hub/v2.html` value is an internal MCP Apps resource identifier, not a browser URL.

The tool may be deferred even when the plugin is loaded. If it is not in the initial visible tool list, use the host's tool-search mechanism to discover the exact registered name and call it. Do not switch to `oss-inbox`, Chrome, GitHub Discussions, or another community route merely because the tool was deferred.

Only after exact-name discovery confirms the tool is absent should you explain the install boundary: completely quit and reopen the Codex desktop app, create a new task, and select OpenHome3D Companion through `Sources` → `Use plugins`. You may offer the normal HTTPS Discussions page as an explicitly labeled temporary fallback, but never send a `ui://` URI to the browser and never claim the interactive hub opened unless the tool call completed.

Use [installation details](references/installation.md) only when handling a missing prerequisite or installing the Companion plugin itself.

## Boundaries

- Never pipe remote scripts into a shell.
- Never expose GitHub, Codex, or npm credentials.
- Installing/running the designer does not require a GitHub account.
- Do not publish, push, fork, or create a PR unless the user separately requests a contribution workflow.
