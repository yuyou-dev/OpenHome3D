/** Offline API regression: a fake codex CLI, temporary sessions, no credentials or AI calls. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = mkdtempSync(join(tmpdir(), 'home3d-ai-test-'))
const testHome = join(root, 'codex')
const mockBin = join(root, 'codex-mock')
writeFileSync(mockBin, `#!${process.execPath}\n${readFileSync(new URL('./fixtures/ai-mock-codex.mjs', import.meta.url), 'utf8')}`)
chmodSync(mockBin, 0o755)
// These overrides exist only in this test process and its mock children.
process.env.HOME3D_CODEX_BIN = mockBin
process.env.CODEX_HOME = testHome
process.env.HOME3D_AI_MOCK = root

const { aiApi } = await import('./ai-api.mjs')
let middleware
aiApi().configureServer({ middlewares: { use(handler) { middleware = handler } } })
const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end() }))
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}/api/ai`
const image = 'data:image/png;base64,iVBORw0KGgo='
const input = { image, prompt: 'Repaint this room', aspect: '3:2' }
const ownSid = '11111111-1111-1111-1111-111111111111'
const otherSid = '22222222-2222-2222-2222-222222222222'
const sessions = join(testHome, 'sessions', '2026', '09', '05')
const ownRollout = join(sessions, `rollout-mock-${ownSid}.jsonl`)
const otherRollout = join(sessions, `rollout-unrelated-${otherSid}.jsonl`)
const scratch = (sid) => join(testHome, 'generated_images', sid)
const events = () => readFileSync(join(root, 'events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)

function configure(config = {}) {
  writeFileSync(join(root, 'config.json'), JSON.stringify(config))
  writeFileSync(join(root, 'events.jsonl'), '')
}

async function request(path, body = input) {
  const response = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, ...await response.json() }
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `timed out waiting for ${description}`)
    await delay(20)
  }
}

async function assertClean() {
  // The response can arrive just before the finally block releases the slot.
  for (let attempt = 0; attempt < 100; attempt++) {
    const status = await fetch(`${base}/status`).then((response) => response.json())
    if (!status.busy) break
    assert.ok(attempt < 99, 'slot was not released')
    await delay(20)
  }
  assert.equal(existsSync(ownRollout), false)
  assert.equal(existsSync(scratch(ownSid)), false)
  for (const event of events().filter((event) => event.type === 'exec')) assert.equal(existsSync(event.cwd), false)
}

function assertUnrelatedPreserved() {
  assert.equal(readFileSync(otherRollout, 'utf8'), unrelatedContents)
  assert.equal(readFileSync(join(scratch(otherSid), 'keep.txt'), 'utf8'), 'unrelated scratch')
}

const unrelatedContents = JSON.stringify({ type: 'session_meta', payload: { id: otherSid, cwd: '/another/project' } }) + '\n' + JSON.stringify({ type: 'event_msg', payload: { type: 'image_generation_end', status: 'completed', result: Buffer.alloc(100, 2).toString('base64') } })
let checks = 0
try {
  mkdirSync(sessions, { recursive: true })
  mkdirSync(scratch(otherSid), { recursive: true })
  writeFileSync(otherRollout, unrelatedContents)
  writeFileSync(join(scratch(otherSid), 'keep.txt'), 'unrelated scratch')
  // A different task's rollout is newer than ours, reproducing the old fallback bug.
  utimesSync(otherRollout, new Date(), new Date(Date.now() + 60_000))

  configure({ version: '0.144.5' })
  const outdated = await fetch(`${base}/status`).then(response => response.json())
  assert.equal(outdated.codex.available, false)
  assert.match(outdated.codex.reason, /0\.153\.1/)
  for (const path of ['understand', 'render']) {
    const rejected = await request(path)
    assert.equal(rejected.ok, false)
    assert.match(rejected.error, /npm i -g @openai\/codex@latest/)
  }
  assert.ok(events().every(event => event.type === 'version'), 'old CLI must not log in or exec')
  checks++

  configure({ version: '0.153.1' })
  const status = await fetch(`${base}/status`).then(response => response.json())
  assert.equal(status.codex.available, true)
  assert.equal(status.codexModel, 'gpt-6-astra')
  assert.equal(status.model, 'GPT-6 Astra · image_gen')
  checks++
  configure()
  for (const body of [null, [], 42, 'text', {}, { image: 'not an image' }]) {
    const result = await request('understand', body)
    assert.equal(result.status, 400)
    assert.equal(result.ok, false)
    checks++
  }
  assert.equal(events().length, 0, 'invalid input must not invoke codex')

  configure({ loginBarrier: 2, execDelay: 200 })
  const concurrent = await Promise.all([request('render'), request('understand')])
  assert.equal(concurrent.filter((result) => result.ok).length, 1)
  assert.equal(concurrent.filter((result) => result.code === 'busy').length, 1)
  assert.equal(events().filter((event) => event.type === 'exec').length, 1)
  await assertClean()
  assertUnrelatedPreserved()
  checks++

  for (const mode of ['modern', 'modern-paginated', 'legacy', 'no-banner', 'wrong-banner']) {
    configure({ mode })
    const result = await request('render')
    assert.equal(result.ok, true, mode)
    assert.equal(result.aspect, '3:2')
    assert.equal(result.codexModel, 'gpt-6-astra')
    const args = events().find(event => event.type === 'exec').args
    assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-astra')
    assert.ok(args.includes('model_reasoning_effort="high"'))
    assert.equal(args[args.indexOf('-s') + 1], 'workspace-write')
    assert.ok(!args.includes('--ephemeral'))
    assert.ok(args[args.indexOf('--') + 1].includes('Use the image_gen tool exactly once'))
    assert.ok(result.image.startsWith('data:image/png;base64,iVBORw0KGgo'))
    await assertClean()
    assertUnrelatedPreserved()
    checks++
  }

  for (const mode of ['no-owned', 'failed', 'modern-paginated-failed']) {
    configure({ mode })
    const result = await request('render')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'error')
    if (mode === 'modern-paginated-failed') assert.equal(result.error, 'image generation failed')
    await assertClean()
    assertUnrelatedPreserved()
    checks++
  }

  configure({ mode: 'hang' })
  const pending = request('render')
  await waitFor(() => events().some((event) => event.type === 'ready'), 'render subprocess')
  assert.equal((await request('understand/cancel', {})).cancelled, false)
  assert.equal((await request('render/cancel', {})).cancelled, true)
  assert.equal((await pending).code, 'cancelled')
  await assertClean()
  assertUnrelatedPreserved()
  checks++

  configure()
  const understood = await request('understand')
  assert.equal(understood.ok, true)
  assert.equal(understood.plan.rooms[0].name, 'Living')
  assert.equal(understood.codexModel, 'gpt-6-astra')
  const understandArgs = events().find(event => event.type === 'exec').args
  assert.equal(understandArgs[understandArgs.indexOf('--model') + 1], 'gpt-6-astra')
  assert.ok(understandArgs.includes('model_reasoning_effort="high"'))
  assert.equal(understandArgs[understandArgs.indexOf('-s') + 1], 'read-only')
  assert.ok(understandArgs.includes('--ephemeral') && understandArgs.includes('--output-schema'))
  await assertClean()
  checks++

  // A cached successful status must never bypass a fresh task's compatibility check.
  configure({ version: '0.153.0' })
  assert.equal((await request('render')).ok, false)
  assert.ok(events().every(event => event.type === 'version'))
  checks++

  configure({ loginExit: 1 })
  assert.equal((await request('render')).code, 'auth')
  assert.equal(events().filter((event) => event.type === 'exec').length, 0)
  checks++

  console.log(`AI API: ${checks} offline checks passed (no real codex calls).`)
} finally {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  rmSync(root, { recursive: true, force: true })
}
