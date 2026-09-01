# INSTALL.md — OpenHome3D install runbook (for Codex)

> This runbook is written for Codex (or a similar coding agent). A human can
> follow it too — every step is an explicit command with a completion check.

## Expected end state (observable)

- The repo is cloned and dependencies are installed
- When requested, the `openhome3d-companion` Codex plugin is installed from this repository
- `npm run doctor` exits 0 (Node ≥ 20, codex CLI found, `codex login status` OK)
- The dev server is running and `http://127.0.0.1:<port>/api/ai/status` answers
  `{"ok":true,"codex":{"available":true},...}`
- The app is open in the built-in browser when available, or the user has its URL

Already-correct counts as success at every step — rerun safely.

## Guardrails

- Never read or print credential files (`~/.codex/auth.json` etc.); the only
  auth probe is `codex login status`
- Never pipe downloaded content into a shell
- Ask before installing system-level software
- Do not kill unrelated dev servers; if the cached port is taken, pick another
- OpenHome3D installation and local use do not require a GitHub account; GitHub setup is deferred until the user first wants to post or submit

## Phases

### 1. Confirm prerequisites

Run, and stop with a clear report when one fails:

```bash
node --version          # need >= 20
codex --version         # codex CLI on PATH (or $HOME3D_CODEX_BIN)
codex login status      # ChatGPT login — the AI endpoints spawn codex exec
```

Missing codex CLI → install with `npm i -g @openai/codex` (ask first).
Not logged in → tell the user to run `codex login` themselves (browser auth),
then re-check. Never attempt login on the user's behalf.

### 2. Clone + install (skip when already inside a clone)

```bash
git clone https://github.com/yuyou-dev/OpenHome3D.git
cd OpenHome3D
npm install
```

Already inside an existing clone → inspect `git status --short` first. If it is
clean, run `git pull --ff-only` + `npm install`. If it is dirty, preserve the
user's work and ask how to proceed instead of stashing, discarding, committing,
or overwriting it without permission.

### 3. Install the Companion plugin (when requested)

Skip this phase when the user explicitly asked for the OpenHome3D app only.
For a Companion-only request, use
`plugins/openhome3d-companion/LIFECYCLE.md` instead of cloning the app.

Inspect configured marketplaces first:

```bash
codex plugin marketplace list
```

If `openhome3d` is absent:

```bash
codex plugin marketplace add yuyou-dev/OpenHome3D --ref main
```

If it is already present, refresh it instead:

```bash
codex plugin marketplace upgrade openhome3d
```

Then install or update the plugin:

```bash
codex plugin add openhome3d-companion@openhome3d
```

Plugin Skills and MCP tools become available in a new Codex task. Continue the current installation now; do not force the user to restart before the app is running.

### 4. Doctor

```bash
npm run doctor
# or machine-readable: npm run doctor -- --json
```

Expected: `verdict: "ready"`, exit 0. Fix what it flags (it prints a hint per
failed check) and rerun until ready.

### 5. Build and start the dev server

```bash
npm run build
```

```bash
npm run dev   # prints http://127.0.0.1:<port> (random high port, cached in .port)
```

Run it in the background and keep it alive for the user.

### 6. Verify end to end

```bash
curl -s http://127.0.0.1:<port>/api/ai/status
# expect {"ok":true,"codex":{"available":true}, ...}
```

Then verify the page (`curl -s -o /dev/null -w '%{http_code}' <url>` → 200) and open it in Codex's in-app browser when available. If this client cannot open a browser, return the clickable loopback URL.

### 7. Hand off

Tell the user:

- the URL to open
- the two AI entry points: 整宅 Home tab →「导入户型图 Import plan」(floor-plan
  recognition) and the「AI 渲染」button in the top bar (image repaint)
- the first render/recognition takes ~1–2 minutes (codex image_gen / exec)
- when the Companion was requested, it is ready in a new task; the user can say `Open the OpenHome3D community hub.` to browse Discussions, get GitHub onboarding, or prepare a contribution

## Troubleshooting

- `codex CLI not logged in` in the UI → `codex login` in a terminal, then reload
- AI buttons warn about "Local-only" on the online demo → expected: the AI runs
  through your local codex CLI; the GitHub Pages demo has no AI backend
- anything else → `npm run doctor -- --json` and read the failing check's hint
- Companion not visible after a requested installation → start a new Codex task, then run `codex plugin list` if it is still missing
