# UNINSTALL.md — OpenHome3D uninstall runbook (for Codex)

> Use this runbook when a user asks Codex to uninstall OpenHome3D, its Companion,
> or both. Uninstallation is intentionally previewed before anything is removed.

## Guardrails

- First determine whether the user means the app, the Companion, or both
- Resolve the exact app directory and inspect `git status --short`
- Show what will be removed and ask for explicit confirmation before deleting or moving files
- Preserve uncommitted work, exported project files, screenshots, and user-added assets unless the user explicitly includes them
- Prefer moving the app directory to the operating system Trash over permanent deletion
- Stop only the OpenHome3D dev server associated with the confirmed directory; never kill unrelated servers
- Removing the local clone does not clear browser IndexedDB data automatically; explain this separately if the user asks for a complete data reset

## Uninstall the OpenHome3D app

1. Locate the exact OpenHome3D clone and show its path.
2. Run `git status --short` and identify any uncommitted or untracked work.
3. Stop the dev server started from that clone.
4. Preview the removal scope and ask the user to confirm.
5. After confirmation, move only that confirmed clone to Trash. Do not use a broad recursive target, `$HOME`, `~`, or a workspace root.
6. Confirm whether the move was recoverable and whether browser-local data remains.

There is no system-wide OpenHome3D package to remove in the normal setup: the
application is the cloned repository plus its local `node_modules` directory.

## Uninstall the Companion when requested

Follow the **Uninstall** section in
`plugins/openhome3d-companion/LIFECYCLE.md`. Removing the Companion does not
remove the OpenHome3D app or GitHub account data.

## Completion report

Report exactly which component was removed, which files or browser data were
preserved, and whether the operation can be recovered from Trash.
