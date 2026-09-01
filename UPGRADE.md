# UPGRADE.md — OpenHome3D upgrade runbook (for Codex)

> Use this runbook when a user asks Codex to upgrade an existing OpenHome3D
> installation. It preserves local work and verifies the result.

## Expected end state

- The existing OpenHome3D clone is fast-forwarded to the latest `origin/main`
- Dependencies match the current lockfile
- `npm run doctor` and `npm run build` have been run
- The app is restarted and opened at its actual local URL
- When requested, the Companion is upgraded using its own lifecycle runbook

## Guardrails

- Locate the existing clone; do not create a second copy just to call it an upgrade
- Inspect `git status --short` before pulling
- Never discard, overwrite, stash, commit, or publish a user's local changes without permission
- Use `git pull --ff-only`; stop and explain if the branch has diverged
- Never read credential files; use only `codex login status` for Codex authentication
- Do not kill unrelated development servers

## Upgrade the OpenHome3D app

From the existing clone:

```bash
git status --short
git pull --ff-only
npm install
npm run doctor
npm run build
```

If the working tree is not clean, show the user the affected files and ask how
they want to preserve the work before pulling. A failed Codex login blocks only
the optional local AI features; it does not block the browser-only designer.

Restart the OpenHome3D dev server with `npm run dev`, read the printed random
loopback URL, verify it returns HTTP 200, and open it in the in-app browser when
available.

## Upgrade the Companion when requested

Follow the **Upgrade** section in
`plugins/openhome3d-companion/LIFECYCLE.md`. After upgrading, completely quit
and reopen Codex desktop, create a new task, and attach **OpenHome3D Companion**
through `Sources` → `Use plugins`.

## Completion report

Report the installed commit, build result, running URL, and whether the
Companion was also upgraded. Do not claim success when a dirty tree, diverged
branch, failed build, or failed plugin refresh remains unresolved.
