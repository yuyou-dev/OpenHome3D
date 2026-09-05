// Executed only by test-ai-api.mjs in its isolated temporary CODEX_HOME.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const root = process.env.HOME3D_AI_MOCK
if (!root) throw new Error('HOME3D_AI_MOCK is required')
const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'))
const events = join(root, 'events.jsonl')
const record = (event) => appendFileSync(events, `${JSON.stringify(event)}\n`)
const args = process.argv.slice(2)

if (args[0] === '--version') {
  record({ type: 'version' })
  console.log(`codex-cli ${config.version ?? '0.153.4'}`)
  process.exit(0)
}

if (args[0] === 'login') {
  record({ type: 'login' })
  if (config.loginBarrier) {
    // Both preflight probes must be in progress before either may complete.
    const deadline = Date.now() + 3_000
    while (readFileSync(events, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse).filter(event => event.type === 'login').length < config.loginBarrier) {
      if (Date.now() > deadline) throw new Error('login barrier timed out')
      await delay(10)
    }
  }
  await delay(40)
  process.exit(config.loginExit ?? 0)
}

if (args[0] !== 'exec') throw new Error(`unexpected command: ${args[0]}`)
const cwd = args[args.indexOf('-C') + 1]
record({ type: 'exec', cwd, args })
if (args.includes('--ephemeral')) {
  await delay(config.execDelay ?? 0)
  const plan = { overall: { widthM: 5, depthM: 4 }, rooms: [{ name: 'Living', type: 'living', x: 0, y: 0, w: 5, d: 4 }], doors: [], windows: [] }
  writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(plan))
} else {
  const sid = '11111111-1111-1111-1111-111111111111'
  const unrelatedSid = '22222222-2222-2222-2222-222222222222'
  if (config.mode !== 'no-owned') {
    const sessions = join(process.env.CODEX_HOME, 'sessions', '2026', '09', '05')
    const scratch = join(process.env.CODEX_HOME, 'generated_images', sid)
    mkdirSync(sessions, { recursive: true })
    mkdirSync(scratch, { recursive: true })
    writeFileSync(join(scratch, 'image.png'), 'owned scratch')
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]).toString('base64')
    const payload = config.mode === 'legacy'
      ? { type: 'image_generation_call', result: png }
      : { type: 'image_generation_end', status: 'completed', result: png, saved_path: '/untrusted/path.png' }
    const paginated = config.mode === 'modern-paginated' || config.mode === 'modern-paginated-failed'
    const imageEvent = paginated ? {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'Extension', kind: 'image_gen.generation', id: 'image-call',
          status: config.mode === 'modern-paginated-failed' ? 'failed' : 'completed',
          result: config.mode === 'modern-paginated-failed' ? '' : png,
          savedPath: '/untrusted/path.png',
        },
      },
    } : { type: config.mode === 'legacy' ? 'response_item' : 'event_msg', payload }
    const records = [
      { type: 'session_meta', payload: { id: sid, cwd, history_mode: paginated ? 'paginated' : 'legacy' } },
      imageEvent,
    ]
    writeFileSync(join(sessions, `rollout-mock-${sid}.jsonl`), records.map(JSON.stringify).join('\n'))
  }
  record({ type: 'ready' })
  if (config.mode === 'hang') await delay(60_000)
  await delay(config.execDelay ?? 0)
  if (config.mode === 'wrong-banner' || config.mode === 'no-owned') console.log(`session id: ${unrelatedSid}`)
  else if (config.mode !== 'no-banner') console.log(`session id: ${sid}`)
  if (config.mode === 'failed') process.exit(1)
}
