# INSTALL.md — OpenHome3D install runbook (for Codex)

> This runbook is written for Codex (or a similar coding agent). A human can
> follow it too — every step is an explicit command with a completion check.

## Expected end state (observable)

- The repo is cloned and dependencies are installed
- `npm run doctor` exits 0 (Node ≥ 20, codex CLI found, `codex login status` OK)
- The dev server is running and `http://127.0.0.1:<port>/api/ai/status` answers
  `{"ok":true,"codex":{"available":true},...}`
- The user knows the URL to open

Already-correct counts as success at every step — rerun safely.

## Guardrails

- Never read or print credential files (`~/.codex/auth.json` etc.); the only
  auth probe is `codex login status`
- Never pipe downloaded content into a shell
- Ask before installing system-level software
- Do not kill unrelated dev servers; if the cached port is taken, pick another

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

Already inside an existing clone → `git pull --ff-only` + `npm install`.

### 3. Doctor

```bash
npm run doctor
# or machine-readable: npm run doctor -- --json
```

Expected: `verdict: "ready"`, exit 0. Fix what it flags (it prints a hint per
failed check) and rerun until ready.

### 4. Start the dev server

```bash
npm run dev   # prints http://127.0.0.1:<port> (random high port, cached in .port)
```

Run it in the background and keep it alive for the user.

### 5. Verify end to end

```bash
curl -s http://127.0.0.1:<port>/api/ai/status
# expect {"ok":true,"codex":{"available":true}, ...}
```

Then open the page (`curl -s -o /dev/null -w '%{http_code}' <url>` → 200).

### 6. Hand off

Tell the user:

- the URL to open
- the two AI entry points: 整宅 Home tab →「导入户型图 Import plan」(floor-plan
  recognition) and the「AI 渲染」button in the top bar (image repaint)
- the first render/recognition takes ~1–2 minutes (codex image_gen / exec)

## Troubleshooting

- `codex CLI not logged in` in the UI → `codex login` in a terminal, then reload
- AI buttons warn about "Local-only" on the online demo → expected: the AI runs
  through your local codex CLI; the GitHub Pages demo has no AI backend
- anything else → `npm run doctor -- --json` and read the failing check's hint
