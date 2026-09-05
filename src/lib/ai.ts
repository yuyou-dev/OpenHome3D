/**
 * Client helpers for the local codex-powered AI API (see scripts/ai-api.mjs).
 * All AI work runs through the local codex CLI — no other backend.
 */
import { del, delMany, get, keys, set, setMany } from 'idb-keyval'
import type { FurnitureInstance } from '../models/registry'

export interface AiStatus {
  ok: boolean
  codex: {
    available: boolean
    reason?: string
  }
  /** single-flight slot occupied (a codex task is running server-side) */
  busy?: boolean
  /** epoch ms when the running task started */
  busySince?: number | null
  /** which endpoint holds the slot */
  busyKind?: 'understand' | 'render' | null
  model: string
  codexModel?: string
}

export interface AiRenderResult {
  ok: true
  image: string // data:image/png;base64,...
  durationMs: number
  model: string
  codexModel?: string
  aspect: string
}

export interface AiRenderError {
  ok: false
  code: 'auth' | 'busy' | 'cancelled' | 'error'
  error: string
  /** busy only: epoch ms when the running (other) task started */
  startedAt?: number
  kind?: 'understand' | 'render'
}

export interface UnderstandResult {
  ok: true
  plan: unknown
  codexModel?: string
  durationMs: number
}

export interface UnderstandError {
  ok: false
  code: 'auth' | 'busy' | 'cancelled' | 'error'
  error: string
  /** busy only: epoch ms when the running (other) task started */
  startedAt?: number
  kind?: 'understand' | 'render'
}

export async function aiStatus(): Promise<AiStatus | null> {
  // Built previews and Pages have no local middleware; avoid repeated 404 probes.
  if (import.meta.env.PROD) return null
  try {
    const r = await fetch('/api/ai/status', { cache: 'no-store' })
    return (await r.json()) as AiStatus
  } catch {
    return null
  }
}

export async function aiRender(opts: {
  prompt: string
  image: string
  images?: string[]
  aspect: string
  signal?: AbortSignal
}): Promise<AiRenderResult | AiRenderError> {
  try {
    const r = await fetch('/api/ai/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: opts.prompt,
        image: opts.image,
        images: opts.images ?? [],
        aspect: opts.aspect,
      }),
      signal: opts.signal ?? null,
    })
    return (await r.json()) as AiRenderResult | AiRenderError
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, code: 'cancelled', error: 'cancelled' }
    }
    return { ok: false, code: 'error', error: String(err) }
  }
}

/**
 * Floor-plan recognition via the local codex CLI (POST /api/ai/understand).
 * `imageDataURL` should be a downscaled PNG/JPEG data URL (see
 * downscaleImageToPng). Errors follow the same HTTP-200 + {ok:false,code}
 * convention as aiRender; a client-side abort yields error 'cancelled'.
 */
export async function understandPlan(
  imageDataURL: string,
  signal?: AbortSignal,
): Promise<UnderstandResult | UnderstandError> {
  try {
    const r = await fetch('/api/ai/understand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataURL }),
      signal: signal ?? null,
    })
    return (await r.json()) as UnderstandResult | UnderstandError
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, code: 'cancelled', error: 'cancelled' }
    }
    return { ok: false, code: 'error', error: String(err) }
  }
}

/**
 * Kill the server-side in-flight codex task (single-flight escape hatch for
 * a stuck or orphaned task). Returns true when something was cancelled.
 */
export async function cancelAiTask(kind: 'understand' | 'render'): Promise<boolean> {
  try {
    const r = await fetch(`/api/ai/${kind}/cancel`, { method: 'POST' })
    const j = (await r.json()) as { ok?: boolean; cancelled?: boolean }
    return !!j?.cancelled
  } catch {
    return false
  }
}

/** Pick the closest supported image_gen aspect for a viewport w×h. */
export function nearestAspect(w: number, h: number): string {
  const CHOICES: [string, number][] = [
    ['1:1', 1],
    ['3:2', 1.5],
    ['2:3', 2 / 3],
  ]
  const ratio = w / h
  let best = CHOICES[0][0]
  let bestDist = Infinity
  for (const [name, r] of CHOICES) {
    const d = Math.abs(Math.log(ratio / r))
    if (d < bestDist) {
      bestDist = d
      best = name
    }
  }
  return best
}

/** Convert any image blob (incl. webp) to a PNG data URL via canvas, downscaled to maxSide. */
export async function downscaleImageToPng(blob: Blob, maxSide = 1600): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    return canvas.toDataURL('image/png')
  } catch {
    return null
  }
}

/**
 * Collect reference photos for the current furniture instances (up to `cap`),
 * as PNG data URLs. Keys: refphoto:<instanceId>:<n> and refphoto:<modelId>:<n>.
 */
export async function collectReferencePhotos(
  furniture: FurnitureInstance[],
  cap = 6,
): Promise<{ count: number; images: string[] }> {
  const all = await keys()
  const wanted = new Set<string>()
  for (const f of furniture) {
    const p1 = `refphoto:${f.id}:`
    const p2 = `refphoto:${f.modelId}:`
    for (const k of all) {
      const ks = String(k)
      if (ks.startsWith(p1) || ks.startsWith(p2)) wanted.add(ks)
    }
  }
  const images: string[] = []
  let count = 0
  for (const k of wanted) {
    const blob = await get(k)
    if (!(blob instanceof Blob)) continue
    count += 1
    if (images.length < cap) {
      const url = await downscaleImageToPng(blob, 1024)
      if (url) images.push(url)
    }
  }
  return { count, images }
}

// ---------------------------------------------------------------------------
// Render history (IndexedDB): metadata index + source/result snapshot per render.
// ---------------------------------------------------------------------------

export interface RenderMeta {
  id: string
  ts: number
  model: string
  aspect: string
  /** legacy field, no longer written */
  size?: string
  durationMs: number
  seed: string
  /** short labels of the style presets used (e.g. ["粘土", "黄昏"]) */
  presets?: string[]
}

const INDEX_KEY = 'render:index'
const RECORD_KEY = (id: string) => `render:${id}`
const HISTORY_CAP = 30

export async function historyList(): Promise<RenderMeta[]> {
  const idx = await get(INDEX_KEY)
  return Array.isArray(idx) ? (idx as RenderMeta[]) : []
}

export interface RenderRecord {
  version: 1
  image: string
  /** Missing for legacy renders: never compare those with the current project. */
  source?: string
  prompt?: string
  referenceImages?: string[]
}

export async function historyRecord(id: string): Promise<RenderRecord | null> {
  const value = await get<string | RenderRecord>(RECORD_KEY(id))
  // Existing records were plain image strings; adapt without rewriting user data.
  if (typeof value === 'string') return { version: 1, image: value }
  return value?.version === 1 && typeof value.image === 'string' ? value : null
}

export async function historyImage(id: string): Promise<string | null> {
  return (await historyRecord(id))?.image ?? null
}

export async function historyAdd(meta: RenderMeta, record: RenderRecord | string): Promise<RenderMeta[]> {
  const idx = await historyList()
  const next = [meta, ...idx.filter((m) => m.id !== meta.id)].slice(0, HISTORY_CAP)
  // Commit source/result and index together; a quota error must not leave a
  // thumbnail pointing to a record that was never saved.
  await setMany([
    [RECORD_KEY(meta.id), typeof record === 'string' ? { version: 1, image: record } : record],
    [INDEX_KEY, next],
  ])
  await delMany(idx.filter((m) => !next.some((n) => n.id === m.id)).map((m) => RECORD_KEY(m.id)))
  return next
}

export async function historyRemove(id: string): Promise<RenderMeta[]> {
  const idx = await historyList()
  const next = idx.filter((m) => m.id !== id)
  await del(RECORD_KEY(id))
  await set(INDEX_KEY, next)
  return next
}
