# OpenHome3D Companion lifecycle (for Codex)

Canonical repository: `https://github.com/yuyou-dev/OpenHome3D`

This runbook covers the Companion only. It does not clone, upgrade, or remove
the OpenHome3D app.

## Install

Inspect the configured marketplaces:

```bash
codex plugin marketplace list
```

If the `openhome3d` marketplace is absent:

```bash
codex plugin marketplace add yuyou-dev/OpenHome3D --ref main
```

If it is already present, refresh it:

```bash
codex plugin marketplace upgrade openhome3d
```

Install the Companion and verify it appears:

```bash
codex plugin add openhome3d-companion@openhome3d
codex plugin list
```

## Upgrade

Refresh the Git marketplace snapshot, reinstall from that snapshot, and verify:

```bash
codex plugin marketplace upgrade openhome3d
codex plugin add openhome3d-companion@openhome3d
codex plugin list
```

Do not hand-edit Codex marketplace configuration or cached plugin files.

## Uninstall

First show the installed plugin and configured marketplace state:

```bash
codex plugin list
codex plugin marketplace list
```

After the user confirms removal, uninstall the Companion:

```bash
codex plugin remove openhome3d-companion@openhome3d
```

Ask separately before removing the marketplace, because it may later contain
other OpenHome3D plugins:

```bash
codex plugin marketplace remove openhome3d
```

Removing the Companion or marketplace does not delete the OpenHome3D app,
local project files, GitHub account, Discussions, Issues, or Pull Requests.

## Activate the changed plugin catalog

After installing, upgrading, or uninstalling:

1. Completely quit and reopen the Codex desktop app.
2. Create a new task.
3. For install or upgrade, open `Sources` → `Use plugins` and select
   **OpenHome3D Companion**.
4. Ask: `Open the OpenHome3D community hub.`

Typing the plugin name in an old task does not reload its Skills or MCP tools.
