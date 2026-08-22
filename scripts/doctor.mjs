#!/usr/bin/env node
/**
 * OpenHome3D doctor — environment preflight for the codex-powered AI features.
 *
 *   node scripts/doctor.mjs [--json]
 *
 * Checks, in order: Node >= 20, codex CLI on PATH (or HOME3D_CODEX_BIN),
 * codex login status, dev-server port availability. Output is a three-state
 * verdict: ready | action_required | blocked (machine-readable with --json;
 * never reads credential files — `codex login status` is the only auth probe).
 *
 * Exit code: 0 = ready, 1 = action_required, 2 = blocked.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'

const JSON_MODE = process.argv.includes('--json')

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const CODEX_BIN = process.env.HOME3D_CODEX_BIN || 'codex'

const checks = []
let verdict = 'ready'

function check(id, ok, detail, hint) {
  checks.push({ id, ok, detail, hint: ok ? undefined : hint })
  if (!ok && verdict === 'ready') verdict = 'action_required'
}

function run(cmd, args, timeoutMs = 5000) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs })
  return { code: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim(), error: r.error }
}

// 1. Node >= 20 (engines floor for the toolchain)
const [nodeMajor] = process.versions.node.split('.').map(Number)
check('node', nodeMajor >= 20, `node ${process.versions.node}`, 'Install Node.js >= 20 (https://nodejs.org)')

// 2. codex CLI resolvable + version
const ver = run(CODEX_BIN, ['--version'])
if (ver.error?.code === 'ENOENT') {
  verdict = 'blocked'
  checks.push({
    id: 'codex-cli',
    ok: false,
    detail: `${CODEX_BIN} not found on PATH`,
    hint: 'Install the codex CLI: npm i -g @openai/codex (or set HOME3D_CODEX_BIN to its path)',
  })
} else if (ver.error || ver.code !== 0) {
  verdict = 'blocked'
  checks.push({
    id: 'codex-cli',
    ok: false,
    detail: ver.stderr.split('\n')[0] || String(ver.error),
    hint: 'codex CLI found but failed to run — check HOME3D_CODEX_BIN / reinstall',
  })
} else {
  check('codex-cli', true, ver.stdout.split('\n')[0])
}

// 3. codex login status (the AI endpoints spawn codex exec as a child process)
if (checks.find((c) => c.id === 'codex-cli')?.ok) {
  const login = run(CODEX_BIN, ['login', 'status'])
  check(
    'codex-login',
    !login.error && login.code === 0,
    login.code === 0 ? login.stdout.split('\n')[0] || 'logged in' : 'not logged in',
    'Run: codex login',
  )
}

// 4. a dev-server port is available (pick-port caches one in .port)
const portOpen = await new Promise((resolve) => {
  const srv = createServer()
  srv.once('error', () => resolve(false))
  srv.listen(0, '127.0.0.1', () => srv.close(() => resolve(true)))
})
check('port', portOpen, portOpen ? 'a free loopback port is available' : 'no free loopback port', undefined)

const out = { ok: verdict === 'ready', verdict, name: pkg.name, checks }
if (JSON_MODE) {
  console.log(JSON.stringify(out, null, 2))
} else {
  console.log(`OpenHome3D doctor — verdict: ${verdict}`)
  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.id}: ${c.detail}${c.hint ? `\n    → ${c.hint}` : ''}`)
  }
  if (verdict === 'ready') console.log('\nAll good. npm run dev, then open the printed URL.')
}
process.exit(verdict === 'ready' ? 0 : verdict === 'action_required' ? 1 : 2)
