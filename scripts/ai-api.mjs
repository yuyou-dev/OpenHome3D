/**
 * Local AI API (dev-server middleware) — powered entirely by the local
 * codex CLI (child processes). No credentials are read by this script:
 * codex authentication lives in $CODEX_HOME/auth.json and is managed by
 * codex itself (`codex login`).
 *
 *   GET  /api/ai/status  → { ok, codex: { available, reason? }, busy, busySince, busyKind, model }
 *   POST /api/ai/understand  { image: dataURL }
 *                      → { ok, plan, durationMs, engine: 'codex' }
 *                      → { ok: false, code: 'auth'|'busy'|'cancelled'|'error', error, startedAt? }
 *   POST /api/ai/render  { prompt, image: dataURL, images?: dataURL[], aspect: '1:1'|'3:2'|'2:3' }
 *                      → { ok, image: dataURL, durationMs, model, aspect }
 *                      → { ok: false, code: 'auth'|'busy'|'cancelled'|'error', error, startedAt? }
 *   POST /api/ai/understand/cancel · /api/ai/render/cancel
 *                      → { ok, cancelled }  (escape hatch for a stuck task)
 *
 * Both endpoints run codex exec and share ONE single-flight slot (codex
 * tasks are heavy; one at a time). Errors are HTTP 200 + { ok:false }
 * (only malformed input → 400).
 *
 * Two codex output mechanics, hard-won:
 * - understand uses --output-schema + `-o` file + --ephemeral (strict JSON,
 *   nothing persisted).
 * - render asks codex to call its image_gen tool exactly once. image_gen
 *   delivers the PNG ONLY inside the session rollout jsonl
 *   ($CODEX_HOME/sessions/**‎/rollout-*-<sid>.jsonl) as inline base64 —
 *   record shape differs by codex version (v0.140: response_item
 *   image_generation_call.result; v0.144+: event_msg image_generation_end
 *   .result with status/saved_path). We decode the inline base64 (the
 *   saved_path on disk is deliberately NOT trusted) and then delete the
 *   rollout file to restore --ephemeral-like cleanliness. This is why
 *   render must NOT pass --ephemeral and must run with sandbox
 *   workspace-write (read-only sandboxes don't register image_gen at all).
 */
import { spawn } from 'node:child_process'
import { createReadStream, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { CODEX_MODEL, CODEX_REASONING_EFFORT, MODEL_LABEL, MIN_CODEX_VERSION, supportsCodexModel } from './ai-config.mjs'

const CODEX_BIN = process.env.HOME3D_CODEX_BIN || 'codex'
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex')

const UNDERSTAND_TIMEOUT_MS = 180_000
const RENDER_TIMEOUT_MS = 240_000
const CODEX_CHECK_TTL_MS = 30_000
const MAX_BODY = 48 * 1024 * 1024

const DATA_URL_RE = /^data:image\/(png|jpeg);base64,(.+)$/
const ASPECT_WORDS = { '1:1': 'square (1:1)', '3:2': 'landscape (3:2)', '2:3': 'portrait (2:3)' }

function send(res, obj, status = 200) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Spawn the codex CLI; resolve with { code, stdout, stderr, timedOut, killed, error? }.
 * The returned promise carries a `kill()` handle: SIGKILLs the child (e.g. when
 * the HTTP client disconnects mid-task) and flags the result `killed`.
 *
 * Two hard-won details:
 * - detached + process-group kill: codex spawns MCP-server grandchildren that
 *   inherit the stdio pipes; killing only the direct child leaves them (and
 *   the pipes) alive for seconds, and 'close' waits for the pipes.
 * - killed/timed-out runs settle on 'exit', not 'close' — same reason.
 */
function runCodex(args, timeoutMs) {
  let child = null
  let killed = false
  const killTree = () => {
    try {
      process.kill(-child.pid, 'SIGKILL') // negative pid = the process group
    } catch {
      try {
        child?.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }
  const promise = new Promise((resolve) => {
    let settled = false
    const done = (r) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    child = spawn(CODEX_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree()
    }, timeoutMs)
    child.stdout.on('data', (c) => {
      stdout += c
    })
    child.stderr.on('data', (c) => {
      stderr += c
    })
    child.on('exit', (code) => {
      if (killed || timedOut) done({ code: code ?? -1, stdout, stderr, timedOut, killed })
    })
    child.on('error', (err) =>
      done({ code: -1, stdout, stderr, timedOut, killed, error: err.code || err.message }),
    )
    child.on('close', (code) => done({ code, stdout, stderr, timedOut, killed }))
  })
  promise.kill = () => {
    killed = true
    killTree()
  }
  return promise
}

/** Fallback: extract the last balanced {...} block from text that parses as JSON. */
function extractLastJson(text) {
  for (let start = text.lastIndexOf('{'); start >= 0; start = text.lastIndexOf('{', start - 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < text.length; i++) {
      const ch = text[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}

let codexCheckCache = { at: 0, result: null }

/** Check CLI compatibility before asking it to log in or run GPT-6. */
async function codexVersionError() {
  const r = await runCodex(['--version'], 3_000)
  if (r.error === 'ENOENT') return 'codex CLI not found on PATH'
  if (r.timedOut) return 'codex version check timed out'
  if (r.error || r.code !== 0) return 'codex CLI failed to report its version'
  if (!supportsCodexModel(r.stdout)) return `codex CLI >= ${MIN_CODEX_VERSION} required for GPT-6 Astra — update: npm i -g @openai/codex@latest`
  return null
}

/** Successful compatibility/login probes are cached ~30 s to avoid spawn-per-poll. */
async function codexAvailability() {
  if (codexCheckCache.result?.available && Date.now() - codexCheckCache.at < CODEX_CHECK_TTL_MS) {
    return codexCheckCache.result
  }
  const versionError = await codexVersionError()
  if (versionError) return { available: false, reason: versionError }
  const r = await runCodex(['login', 'status'], 3_000)
  let result
  if (r.error === 'ENOENT') result = { available: false, reason: 'codex CLI not found on PATH' }
  else if (r.timedOut) result = { available: false, reason: 'codex login status timed out' }
  else if (r.error || r.code !== 0) {
    result = { available: false, reason: 'codex CLI not logged in — run: codex login' }
  } else result = { available: true }
  codexCheckCache = { at: Date.now(), result }
  return result
}

// ---------------------------------------------------------------------------
// Single-flight slot shared by understand + render (one codex task at a time).
// ---------------------------------------------------------------------------

/** @type {{ kind: 'understand'|'render', startedAt: number, kill: (() => void)|null } | null} */
let codexCurrent = null

function busyResponse(res) {
  return send(res, {
    ok: false,
    code: 'busy',
    error: `another codex task (${codexCurrent.kind}) is running`,
    startedAt: codexCurrent.startedAt,
    kind: codexCurrent.kind,
  })
}

/** Check login, then atomically claim the shared slot before returning it. */
async function preflight(kind, res) {
  if (codexCurrent) {
    busyResponse(res)
    return null
  }
  const versionError = await codexVersionError()
  if (versionError) {
    send(res, { ok: false, code: 'error', error: versionError })
    return null
  }
  const login = await runCodex(['login', 'status'], 3_000)
  if (login.error || login.timedOut || login.code !== 0) {
    send(res, { ok: false, code: 'auth', error: 'codex CLI not logged in — run: codex login' })
    return null
  }
  // Other requests can finish their login probe while this one is awaiting it.
  if (codexCurrent) {
    busyResponse(res)
    return null
  }
  if (res.destroyed) return null
  codexCurrent = { kind, startedAt: Date.now(), kill: null }
  return codexCurrent
}

/** Escape hatch: SIGKILL the in-flight codex task of the given kind. */
function handleCancel(kind, res) {
  if (!codexCurrent || codexCurrent.kind !== kind) return send(res, { ok: true, cancelled: false })
  codexCurrent.kill?.()
  send(res, { ok: true, cancelled: true })
}

/** Parse a request body whose `image` (and optional `images`) are PNG/JPEG data URLs. */
async function readImageBody(req, res) {
  let body
  try {
    body = JSON.parse(await readBody(req))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body')
  } catch {
    send(res, { ok: false, code: 'error', error: 'invalid request body' }, 400)
    return null
  }
  const rawImages = [body.image, ...(Array.isArray(body.images) ? body.images : [])].filter(Boolean)
  if (rawImages.length === 0) {
    send(res, { ok: false, code: 'error', error: 'no source image' }, 400)
    return null
  }
  const images = []
  for (const raw of rawImages) {
    const m = typeof raw === 'string' ? raw.match(DATA_URL_RE) : null
    if (!m) {
      send(res, { ok: false, code: 'error', error: 'images must be PNG or JPEG data URLs' }, 400)
      return null
    }
    images.push({ ext: m[1] === 'jpeg' ? 'jpg' : 'png', data: Buffer.from(m[2], 'base64') })
  }
  return { body, images }
}

// ---------------------------------------------------------------------------
// Floor-plan recognition: codex exec --output-schema (strict JSON, ephemeral).
// ---------------------------------------------------------------------------

/** Recognition prompt (English, proven against real floor plans). */
const UNDERSTAND_PROMPT = `Analyze the attached residential floor plan image. Do not use any tools; just answer. Output ONLY a JSON object (no markdown fences, no commentary) with this shape:
{
  "overall": { "widthM": <number>, "depthM": <number> },
  "rooms": [ { "name": <as labeled>, "type": <living|bedroom|kitchen|bathroom|dining|balcony|garage|office|other>, "x": <m>, "y": <m>, "w": <m>, "d": <m> } ],
  "doors": [ { "between": [<roomNameA>, <roomNameB or "exterior">], "wall": <n|s|e|w|null>, "at": <0..1|null>, "widthM": <m|null>, "open": <boolean|null> } ],
  "windows": [ { "room": <roomName>, "wall": <n|s|e|w>, "at": <0..1|null>, "widthM": <m|null> } ]
}
Rules: use the dimension annotations to set overall size in meters (annotations may be mm like "8400" or feet/inches like 12'0" — convert); if a room carries its own dimension or area annotation, prefer it for that room; (x,y) is each room's top-left corner in meters from the plan's top-left outer corner; estimate room rectangles from the WALL GEOMETRY (ignore furniture and label positions); "n" is the top edge of the image. Be precise to 0.1 m. If something is unreadable, omit it rather than inventing it.
Door/window placement: "at" is the opening's CENTER position as a fraction along its wall, measured from the wall's west end (for n/s walls) or north end (for e/w walls) — read it from where the door swing / window symbol is actually drawn, not the wall's midpoint; for a door between two rooms the wall is their shared wall, and the fraction runs along the shared portion. "widthM" is the opening's width in meters (estimate from door-swing arcs, window symbols, or dimension annotations; a typical interior door is 0.8-0.9). For an entrance door ("exterior"), "wall" says which exterior wall of that room it sits on. If two rooms connect with NO door leaf — a wide cased opening, an open-plan kitchen/living area, or a missing wall between them — still list the pair in "doors" but with "open": true, "at" centered on the open stretch, and "widthM" spanning the full open stretch (null if the entire shared wall is gone). Every key must be present; use null for any value you cannot read.
Balconies: output a balcony as a room with type "balcony". If its outer edge is a railing or half-wall (not a full wall with windows), add a "doors" entry between the balcony room and "exterior" with "open": true, "wall" = the outer edge, and "widthM" spanning the railing. A wide sliding door between a room and its balcony is a "doors" entry between the two rooms with "open": true and "widthM" = the sliding span.`

/** Strict JSON Schema for codex --output-schema. */
const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overall', 'rooms', 'doors', 'windows'],
  properties: {
    overall: {
      type: 'object',
      additionalProperties: false,
      required: ['widthM', 'depthM'],
      properties: {
        widthM: { type: 'number' },
        depthM: { type: 'number' },
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'x', 'y', 'w', 'd'],
        properties: {
          name: { type: 'string' },
          type: {
            type: 'string',
            enum: ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'balcony', 'garage', 'office', 'other'],
          },
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          d: { type: 'number' },
        },
      },
    },
    doors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        // codex strict mode: required must list every property; optionality
        // is expressed with nullable types
        required: ['between', 'wall', 'at', 'widthM', 'open'],
        properties: {
          between: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 2,
          },
          wall: { type: ['string', 'null'], enum: ['n', 's', 'e', 'w', null] },
          at: { type: ['number', 'null'] },
          widthM: { type: ['number', 'null'] },
          open: { type: ['boolean', 'null'] },
        },
      },
    },
    windows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['room', 'wall', 'at', 'widthM'],
        properties: {
          room: { type: 'string' },
          wall: { type: 'string', enum: ['n', 's', 'e', 'w'] },
          at: { type: ['number', 'null'] },
          widthM: { type: ['number', 'null'] },
        },
      },
    },
  },
}

async function handleUnderstand(req, res) {
  const parsed = await readImageBody(req, res)
  if (!parsed) return
  const current = await preflight('understand', res)
  if (!current) return
  const started = current.startedAt
  let dir = null
  // client went away (page refresh / abort) → kill the codex subprocess so
  // the single-flight slot frees immediately instead of after the timeout
  res.on('close', () => {
    if (!res.writableEnded && codexCurrent === current) current.kill?.()
  })
  try {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'home3d-ai-')))
    const imageFile = join(dir, `image.${parsed.images[0].ext}`)
    writeFileSync(imageFile, parsed.images[0].data)
    const schemaFile = join(dir, 'schema.json')
    writeFileSync(schemaFile, JSON.stringify(PLAN_SCHEMA))
    const outFile = join(dir, 'out.json')
    const rp = runCodex(
      [
        'exec',
        '--model', CODEX_MODEL,
        '-c', `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
        '--skip-git-repo-check',
        '--ephemeral',
        '-s',
        'read-only',
        '-C',
        dir,
        '-i',
        imageFile,
        '--output-schema',
        schemaFile,
        '-o',
        outFile,
        UNDERSTAND_PROMPT,
      ],
      UNDERSTAND_TIMEOUT_MS,
    )
    current.kill = rp.kill
    const r = await rp
    if (r.killed) {
      return send(res, { ok: false, code: 'cancelled', error: 'recognition cancelled' })
    }
    if (r.timedOut) {
      return send(res, { ok: false, code: 'error', error: 'recognition timed out (180 s)' })
    }
    if (r.error || r.code !== 0) {
      const tail = (r.stderr || '').trim().slice(-300) || r.error || `codex exited with code ${r.code}`
      return send(res, { ok: false, code: 'error', error: tail })
    }
    let plan = null
    try {
      plan = JSON.parse(readFileSync(outFile, 'utf8'))
    } catch {
      plan = extractLastJson(r.stdout)
    }
    if (!plan || !plan.overall || !Array.isArray(plan.rooms) || plan.rooms.length === 0) {
      return send(res, { ok: false, code: 'error', error: 'unparseable model output' })
    }
    send(res, { ok: true, plan, durationMs: Date.now() - started, engine: 'codex', codexModel: CODEX_MODEL })
  } finally {
    if (codexCurrent === current) codexCurrent = null
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// 3D view repaint: codex exec asks the image_gen tool for exactly one image;
// the PNG arrives as inline base64 in the session rollout jsonl.
// ---------------------------------------------------------------------------

const SESSION_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/

/** Read only the session header; never extract images from another task's rollout. */
async function ownsRollout(file, cwd, sid) {
  const stream = createReadStream(file, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      const record = JSON.parse(line)
      return record.type === 'session_meta' && record.payload?.cwd === cwd && record.payload?.id === sid
    }
  } catch {
    // A rollout can disappear or still have an incomplete header during a scan.
  } finally {
    lines.close()
    stream.destroy()
  }
  return false
}

/**
 * Locate only rollouts belonging to this run's unique, canonical temporary cwd.
 * A session banner is a search hint, not proof of ownership: desktop Codex and
 * other CLI processes can write newer rollouts into the same sessions tree.
 */
async function findOwnedRollout(cwd, sinceMs, preferredSid = null) {
  const queue = [join(CODEX_HOME, 'sessions')]
  const candidates = []
  while (queue.length) {
    const dir = queue.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(file)
      else if (entry.name.startsWith('rollout-')) {
        const sid = SESSION_ID_RE.exec(entry.name)?.[1]
        if (sid) {
          try {
            if (statSync(file).mtimeMs >= sinceMs) candidates.push({ file, sid })
          } catch {
            // Another process may remove a rollout during the scan.
          }
        }
      }
    }
  }
  candidates.sort((a, b) => Number(b.sid === preferredSid) - Number(a.sid === preferredSid))
  for (const candidate of candidates) {
    if (await ownsRollout(candidate.file, cwd, candidate.sid)) return candidate
  }
  return null
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Extract the last completed image_gen result from a session rollout jsonl.
 * Record shape differs by codex version:
 * - v0.140: { type: 'response_item', payload: { type: 'image_generation_call', result } }
 * - v0.144+: { type: 'event_msg', payload: { type: 'image_generation_end', status, result, saved_path } }
 * - v0.153 paginated: event_msg/item_completed → item { type: 'Extension',
 *   kind: 'image_gen.generation', status, result, savedPath }
 * The inline base64 is the only source of truth (saved_path is deliberately
 * ignored). Returns { buffer, failed? } — failed carries the last non-completed
 * status when no image was produced.
 */
function extractRolloutImage(file) {
  let image = null
  let failed = null
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line || (!line.includes('image_generation') && !line.includes('image_gen.generation'))) continue
    let rec
    try {
      rec = JSON.parse(line)
    } catch {
      continue
    }
    const event = rec?.payload
    const paginated = rec?.type === 'event_msg' && event?.type === 'item_completed' &&
      event.item?.type === 'Extension' && event.item.kind === 'image_gen.generation'
    const p = paginated ? event.item : event
    if (!p || typeof p !== 'object') continue
    if (paginated || p.type === 'image_generation_end' || p.type === 'image_generation_call') {
      if (typeof p.result === 'string' && p.result.length > 100 && (!p.status || p.status === 'completed')) {
        const buf = Buffer.from(p.result, 'base64')
        if (buf.length > 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) image = buf
      } else if (p.status && p.status !== 'completed') {
        failed = p.status
      }
    }
  }
  return image ? { buffer: image } : { buffer: null, failed }
}

/** Wrapper prompt: one image_gen call, no file writes, no shell, no path reports. */
function renderPrompt(aspectWord, prompt, refCount) {
  return (
    'Use the image_gen tool exactly once to generate ONE image. The first attached image is a ' +
    '3D room preview to repaint' +
    (refCount > 0
      ? `; the other ${refCount} attached image(s) are furniture reference photos`
      : '') +
    '. Do not write files, do not run shell commands, do not report paths — just make the single image_gen call.\n' +
    `Requested aspect ratio: ${aspectWord}.\n` +
    'Image prompt:\n' +
    prompt
  )
}

async function handleRender(req, res) {
  const parsed = await readImageBody(req, res)
  if (!parsed) return
  const prompt = typeof parsed.body.prompt === 'string' ? parsed.body.prompt.trim() : ''
  if (!prompt) return send(res, { ok: false, code: 'error', error: 'prompt is required' }, 400)
  const aspect = Object.hasOwn(ASPECT_WORDS, parsed.body.aspect) ? parsed.body.aspect : '3:2'
  const current = await preflight('render', res)
  if (!current) return
  const started = current.startedAt
  let dir = null
  let rollout = null
  res.on('close', () => {
    if (!res.writableEnded && codexCurrent === current) current.kill?.()
  })
  try {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'home3d-ai-')))
    const viewFile = join(dir, `view.${parsed.images[0].ext}`)
    writeFileSync(viewFile, parsed.images[0].data)
    const args = [
      'exec',
      '--model', CODEX_MODEL,
      '-c', `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
      '--skip-git-repo-check',
      '--color',
      'never',
      // image_gen is only registered in a writable sandbox
      '-s',
      'workspace-write',
      '-C',
      dir,
      '--add-dir',
      join(CODEX_HOME, 'generated_images'),
      '-i',
      viewFile,
    ]
    // reference photos (max 5 after the view shot)
    for (const img of parsed.images.slice(1, 6)) {
      const f = join(dir, `ref-${args.length}.${img.ext}`)
      writeFileSync(f, img.data)
      args.push('-i', f)
    }
    // NO --ephemeral: the session rollout must persist for image extraction
    // '--' ends option parsing: -i is variadic and would otherwise swallow the prompt
    args.push('--', renderPrompt(ASPECT_WORDS[aspect], prompt, Math.min(parsed.images.length - 1, 5)))
    const rp = runCodex(args, RENDER_TIMEOUT_MS)
    current.kill = rp.kill
    const r = await rp
    if (r.killed) {
      return send(res, { ok: false, code: 'cancelled', error: 'render cancelled' })
    }
    if (r.timedOut) {
      return send(res, { ok: false, code: 'error', error: 'render timed out (240 s)' })
    }
    if (r.error || r.code !== 0) {
      const tail = (r.stderr || '').trim().slice(-300) || r.error || `codex exited with code ${r.code}`
      return send(res, { ok: false, code: 'error', error: tail })
    }
    const sid = /session id: ([0-9a-f-]+)/.exec(r.stdout)?.[1] ?? /session id: ([0-9a-f-]+)/.exec(r.stderr)?.[1]
    rollout = await findOwnedRollout(dir, started - 5_000, sid)
    if (!rollout) {
      return send(res, { ok: false, code: 'error', error: 'codex session rollout not found' })
    }
    const { buffer, failed } = extractRolloutImage(rollout.file)
    if (!buffer) {
      return send(res, {
        ok: false,
        code: 'error',
        error: failed ? `image generation ${failed}` : 'no image in codex output',
      })
    }
    send(res, {
      ok: true,
      image: `data:image/png;base64,${buffer.toString('base64')}`,
      durationMs: Date.now() - started,
      model: MODEL_LABEL,
      codexModel: CODEX_MODEL,
      aspect,
    })
  } finally {
    // Also clean owned artifacts after cancellation/failure. An unverified banner
    // must never authorize deleting generated_images/<sid> or another rollout.
    try {
      if (dir) rollout ??= await findOwnedRollout(dir, started - 5_000)
      if (rollout) {
        rmSync(rollout.file, { force: true })
        rmSync(join(CODEX_HOME, 'generated_images', rollout.sid), { recursive: true, force: true })
      }
    } catch {
      // Cleanup is best effort; always release the slot below.
    } finally {
      if (codexCurrent === current) codexCurrent = null
      if (dir) rmSync(dir, { recursive: true, force: true })
    }
  }
}

async function handleStatus(res) {
  send(res, {
    ok: true,
    codex: await codexAvailability(),
    busy: !!codexCurrent,
    busySince: codexCurrent?.startedAt ?? null,
    busyKind: codexCurrent?.kind ?? null,
    model: MODEL_LABEL,
    codexModel: CODEX_MODEL,
  })
}

/** Vite plugin: mounts the API on the dev server. */
export function aiApi() {
  return {
    name: 'home3d-ai-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url || '').split('?')[0]
        let task
        if (url === '/api/ai/status' && req.method === 'GET') task = handleStatus(res)
        else if (url === '/api/ai/understand' && req.method === 'POST') task = handleUnderstand(req, res)
        else if (url === '/api/ai/render' && req.method === 'POST') task = handleRender(req, res)
        else if (url === '/api/ai/understand/cancel' && req.method === 'POST') {
          return void handleCancel('understand', res)
        } else if (url === '/api/ai/render/cancel' && req.method === 'POST') {
          return void handleCancel('render', res)
        } else return next()
        task.catch((error) => {
          if (!res.destroyed && !res.headersSent) send(res, { ok: false, code: 'error', error: error.message })
        })
      })
    },
  }
}
