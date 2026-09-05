import { chance, pick, range, rngFrom, type Rng } from '../lib/prng'
import { boxAt, clamp, fitsInRoom, overlaps, quantize, type Box } from '../lib/geom'
import { defaultParams, footprintOf, type FurnitureInstance, type ModelDef } from '../models/registry'

export interface LayoutOpts {
  roomType: string
  seed: string
  salt: number
  width: number
  depth: number
  /** 0–100, gates DECOR pieces */
  extras: number
  models: ModelDef[]
  /** Existing user work used as placement obstacles; output contains new pieces only. */
  preserved?: FurnitureInstance[]
  /** Density edits generate only decorative rules. */
  decorOnly?: boolean
  /**
   * Doorway intervals the layout must keep clear, in wall-local coordinates
   * (meters from the wall start: west end for n/s walls, north end for e/w
   * walls — same convention as Opening.offset in state/home.ts), from < to.
   * Only wall/run placements avoid them; other rule kinds are unchanged.
   */
  doors?: { side: Side; from: number; to: number }[]
}

/** Clearance kept between pieces (meters). */
export const COLLISION_MARGIN = 0.05

/** Clearance kept between a wall/run piece and a doorway (meters, each side). */
export const DOOR_CLEAR = 0.35

// ---------------------------------------------------------------------------
// Placement rule model — room programs are data, not code
// ---------------------------------------------------------------------------

export type Side = 'n' | 's' | 'e' | 'w'
type Params = Record<string, number | boolean>

interface BaseRule {
  /** registry id, or list of candidate ids (first available is picked via rng) */
  model: string | string[]
  /** params overriding the model defaults (e.g. a narrower sofa) */
  params?: Params
  /** when set, rule only applies if chance(rng, extras/100 * gate) passes */
  gate?: number
}

/** Against a wall, facing inward. */
interface WallRule extends BaseRule {
  kind: 'wall'
  /** candidate walls (default: all four) */
  sides?: Side[]
  /** fraction range along the wall (default [0.1, 0.9]) */
  along?: [number, number]
  /** wall opposite the one the referenced model was placed on */
  oppositeOf?: string
  /** same wall the referenced model was placed on */
  sameSideAs?: string
  /** tuck directly beside the referenced model on its wall (bedside tables) */
  besideOf?: string
  /** random ± radians added to the snapped facing rotation */
  jitterRot?: number
  /** rotate to face the room center instead of straight inward */
  faceCenter?: boolean
}

/** In front of another placed piece (on its facing axis). */
interface FrontRule extends BaseRule {
  kind: 'front'
  of: string
  /** gap between the two footprints (default 0.25) */
  gap?: number
  /** face back toward the host instead of same direction */
  faceHost?: boolean
  /** never collides nor blocks (rugs) */
  ghost?: boolean
}

/** Same position as another placed piece (TV on bench, rug under table). */
interface OnRule extends BaseRule {
  kind: 'on'
  of: string
  ghost?: boolean
}

/** Centered in the room (dining set). */
interface CenterRule extends BaseRule {
  kind: 'center'
}

/** In a corner, optionally facing the room center. */
interface CornerRule extends BaseRule {
  kind: 'corner'
  faceCenter?: boolean
  jitterRot?: number
}

/** Anywhere collision-free, rotation snapped to 90°. */
interface FreeRule extends BaseRule {
  kind: 'free'
  faceCenter?: boolean
  count?: number
}

/** Ring of pieces around another piece (chairs around a table). */
interface RingRule extends BaseRule {
  kind: 'ring'
  around: string
  count: number
}

/** A consecutive run of pieces along one wall (kitchen counters). */
interface RunRule extends BaseRule {
  kind: 'run'
  models: string[]
  sides?: Side[]
  gap?: number
}

type Rule =
  | WallRule
  | FrontRule
  | OnRule
  | CenterRule
  | CornerRule
  | FreeRule
  | RingRule
  | RunRule

interface RoomProgram {
  rules: Rule[]
  /** registry types eligible for seed-count decor GLBs */
  decorTypes: string[]
  /** optional allowlist on top of decorTypes (e.g. appliances only in kitchens) */
  decorInclude?: RegExp
  /** max decor GLBs at extras=100 */
  maxDecor: number
}

// ---------------------------------------------------------------------------
// Room programs
// ---------------------------------------------------------------------------

const ALL_SIDES: Side[] = ['n', 's', 'e', 'w']

const PROGRAMS: Record<string, RoomProgram> = {
  living: {
    rules: [
      { kind: 'wall', model: 'builtin:sofa' },
      { kind: 'wall', model: 'builtin:tv-bench', oppositeOf: 'builtin:sofa' },
      { kind: 'on', model: 'builtin:tv', of: 'builtin:tv-bench' },
      { kind: 'front', model: 'builtin:coffee-table', of: 'builtin:sofa', gap: 0.32 },
      {
        kind: 'on',
        model: 'builtin:rug',
        of: 'builtin:coffee-table',
        ghost: true,
        params: { Width: 2.4, Depth: 1.7 },
      },
      { kind: 'corner', model: 'builtin:armchair', faceCenter: true, jitterRot: 0.35 },
      { kind: 'corner', model: 'builtin:floor-lamp' },
      { kind: 'corner', model: 'builtin:plant', gate: 1 },
      { kind: 'wall', model: 'builtin:shelf', gate: 0.9 },
      { kind: 'wall', model: 'builtin:side-table', gate: 0.8 },
    ],
    decorTypes: ['DECOR'],
    maxDecor: 3,
  },
  studio: {
    rules: [
      { kind: 'wall', model: 'builtin:bed', sides: ['n', 'e', 'w'], along: [0, 0.35] },
      { kind: 'wall', model: 'builtin:wardrobe' },
      {
        kind: 'wall',
        model: 'builtin:sofa',
        oppositeOf: 'builtin:bed',
        params: { Width: 1.7, Seats: 2 },
      },
      {
        kind: 'front',
        model: 'builtin:rug',
        of: 'builtin:sofa',
        ghost: true,
        gap: 0.05,
        params: { Width: 1.9, Depth: 1.3 },
        gate: 1,
      },
      {
        kind: 'free',
        model: 'builtin:dining-table',
        params: { Width: 1.2, Depth: 0.8 },
      },
      { kind: 'ring', model: 'builtin:chair', around: 'builtin:dining-table', count: 2 },
      { kind: 'corner', model: 'builtin:floor-lamp' },
      { kind: 'corner', model: 'builtin:plant', gate: 1 },
      { kind: 'wall', model: 'builtin:shelf', gate: 0.8 },
    ],
    decorTypes: ['DECOR'],
    maxDecor: 3,
  },
  bedroom: {
    rules: [
      { kind: 'wall', model: 'builtin:bed', sides: ['n', 'e', 'w'], along: [0, 0.3] },
      { kind: 'wall', model: 'builtin:wardrobe', oppositeOf: 'builtin:bed' },
      {
        kind: 'wall',
        model: 'builtin:side-table',
        besideOf: 'builtin:bed',
        params: { Width: 0.45, Depth: 0.45 },
      },
      {
        kind: 'wall',
        model: 'builtin:side-table',
        besideOf: 'builtin:bed',
        params: { Width: 0.45, Depth: 0.45 },
        gate: 1.1,
      },
      {
        kind: 'front',
        model: 'builtin:rug',
        of: 'builtin:bed',
        ghost: true,
        gap: 0.1,
        params: { Width: 2.0, Depth: 1.2 },
        gate: 1,
      },
      { kind: 'corner', model: 'builtin:armchair', faceCenter: true, gate: 0.9 },
      { kind: 'corner', model: 'builtin:plant', gate: 1 },
      { kind: 'wall', model: 'builtin:shelf', gate: 0.7 },
    ],
    decorTypes: ['DECOR'],
    maxDecor: 2,
  },
  kitchen: {
    rules: [
      {
        kind: 'run',
        model: 'kenney:kitchen-cabinet',
        models: [
          'kenney:kitchen-fridge',
          'kenney:kitchen-stove',
          'kenney:kitchen-sink',
          'kenney:kitchen-cabinet',
          'kenney:kitchen-cabinet-drawer',
        ],
        sides: ['n', 'w', 'e'],
      },
      {
        kind: 'free',
        model: 'builtin:dining-table',
        params: { Width: 1.1, Depth: 0.7 },
        gate: 1.15,
      },
      { kind: 'ring', model: 'builtin:chair', around: 'builtin:dining-table', count: 2 },
      { kind: 'corner', model: 'builtin:plant', gate: 0.7 },
    ],
    decorTypes: ['KITCHEN'],
    decorInclude: /toaster|microwave|blender|coffee-machine/,
    maxDecor: 1,
  },
  bathroom: {
    rules: [
      { kind: 'wall', model: ['kenney:bathtub', 'kenney:shower'], sides: ['n', 'e', 'w'] },
      { kind: 'wall', model: 'kenney:toilet' },
      { kind: 'wall', model: 'kenney:bathroom-sink' },
      { kind: 'wall', model: 'kenney:washer', gate: 0.9 },
      { kind: 'wall', model: 'kaykit:towelrail', gate: 0.8 },
    ],
    decorTypes: [],
    maxDecor: 0,
  },
  office: {
    rules: [
      { kind: 'wall', model: 'builtin:desk', sides: ['n', 'e', 'w'] },
      { kind: 'front', model: 'builtin:chair', of: 'builtin:desk', gap: 0.08, faceHost: true },
      { kind: 'wall', model: 'builtin:shelf' },
      { kind: 'corner', model: 'builtin:floor-lamp', gate: 0.9 },
      { kind: 'corner', model: 'builtin:plant', gate: 1 },
      { kind: 'wall', model: 'builtin:side-table', gate: 0.6 },
    ],
    decorTypes: ['DECOR'],
    maxDecor: 2,
  },
  dining: {
    rules: [
      { kind: 'center', model: 'builtin:dining-table' },
      { kind: 'ring', model: 'builtin:chair', around: 'builtin:dining-table', count: 4 },
      {
        kind: 'on',
        model: 'builtin:rug',
        of: 'builtin:dining-table',
        ghost: true,
        params: { Width: 2.6, Depth: 2.0 },
        gate: 1,
      },
      { kind: 'wall', model: 'builtin:shelf', gate: 0.9 },
      { kind: 'corner', model: 'builtin:plant', gate: 1 },
      { kind: 'wall', model: 'builtin:side-table', gate: 0.7 },
    ],
    decorTypes: ['DECOR'],
    maxDecor: 2,
  },
  balcony: {
    // sparse on purpose: plants only, the open parapet edge stays clear
    rules: [
      { kind: 'corner', model: 'builtin:plant', gate: 1 },
      { kind: 'corner', model: 'builtin:plant', gate: 0.7 },
      { kind: 'wall', model: 'builtin:side-table', sides: ['n', 'e', 'w'], gate: 0.6 },
    ],
    decorTypes: [],
    maxDecor: 0,
  },
}

/** Decor GLBs that make no sense standing on a floor. */
const DECOR_EXCLUDE =
  /rug|pillow|pictureframe|wall|doormat|laptop|computer|keyboard|mouse|book|television|menu|food|stew|knife|jar|crate|cutting|dishrack|bottle|plate|bowl|mug|pan|pot|shelf-papertowel|towel/

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Placed {
  inst: FurnitureInstance
  box: Box
  ghost: boolean
  side?: Side
}

interface Ctx {
  rng: Rng
  models: Map<string, ModelDef>
  roomW: number
  roomD: number
  /** door intervals per side, converted once to room-centered axis coords */
  doorSpans: Record<Side, [number, number][]>
  placed: Placed[]
  sideOf: Map<string, Side>
  seq: number
  decorative: boolean
}

const ATTEMPTS = 24
const WALL_INSET = 0.03

const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' }

/**
 * True if a piece spanning [axisPos±axisSize/2] along `side` blocks a doorway
 * (closed-interval test against door intervals expanded by DOOR_CLEAR, so an
 * exact touch counts as blocked — keeps ~1 grid step of margin against the
 * rotation rounding commit() applies to stored boxes).
 */
function hitsDoor(ctx: Ctx, side: Side, axisPos: number, axisSize: number): boolean {
  const lo = axisPos - axisSize / 2
  const hi = axisPos + axisSize / 2
  for (const [dLo, dHi] of ctx.doorSpans[side]) {
    if (lo <= dHi + DOOR_CLEAR && hi >= dLo - DOOR_CLEAR) return true
  }
  return false
}

/**
 * Free intervals along a wall's [lo, hi] range after subtracting the door
 * zones on that side, each expanded by DOOR_CLEAR. Pure, deterministic.
 */
function freeSpans(ctx: Ctx, side: Side, lo: number, hi: number): [number, number][] {
  let spans: [number, number][] = [[lo, hi]]
  for (const [dLo, dHi] of ctx.doorSpans[side]) {
    const eLo = dLo - DOOR_CLEAR
    const eHi = dHi + DOOR_CLEAR
    const next: [number, number][] = []
    for (const [sLo, sHi] of spans) {
      if (eHi <= sLo || eLo >= sHi) {
        next.push([sLo, sHi])
        continue
      }
      if (eLo > sLo) next.push([sLo, eLo])
      if (eHi < sHi) next.push([eHi, sHi])
    }
    spans = next
  }
  return spans
}

/** rotationY that makes a piece on the given wall face the room interior (model front = +z). */
function inwardRotation(side: Side): number {
  switch (side) {
    case 'n':
      return 0
    case 's':
      return Math.PI
    case 'e':
      return -Math.PI / 2
    case 'w':
      return Math.PI / 2
  }
}

/** rotationY that makes a piece at (x, z) face the room center. */
function faceCenterRotation(x: number, z: number): number {
  return Math.atan2(-x, -z)
}

function resolveModel(ctx: Ctx, model: string | string[]): ModelDef | undefined {
  const ids = Array.isArray(model) ? model : [model]
  const available = ids.filter((id) => ctx.models.has(id))
  if (available.length === 0) return undefined
  return ctx.models.get(pick(ctx.rng, available))
}

function makeInstance(ctx: Ctx, def: ModelDef, rule: BaseRule): FurnitureInstance {
  ctx.seq += 1
  return {
    id: `f${ctx.seq}`,
    roomId: '', // room-local engine output; the store assigns roomId + id prefix
    modelId: def.id,
    label: def.name,
    position: [0, 0],
    rotationY: 0,
    params: { ...defaultParams(def), ...(rule.params ?? {}) },
    scale: 1,
    source: 'generated',
    decor: rule.gate !== undefined || ctx.decorative,
  }
}

/** Accept a candidate if it fits the room and collides with nothing (5 cm margin). */
function accepts(
  ctx: Ctx,
  box: Box,
  opts: { ghost?: boolean; ignoreId?: string; ignoreFrom?: number } = {},
): boolean {
  // test the quantized box — exactly what commit() will store
  const qb: Box = { ...box, x: quantize(box.x), z: quantize(box.z) }
  if (!fitsInRoom(qb, ctx.roomW, ctx.roomD, 0.01)) return false
  if (opts.ghost) return true
  for (let idx = 0; idx < ctx.placed.length; idx++) {
    if (opts.ignoreFrom !== undefined && idx >= opts.ignoreFrom) break
    const p = ctx.placed[idx]
    if (p.ghost) continue
    if (opts.ignoreId && p.inst.id === opts.ignoreId) continue
    if (overlaps(qb, p.box, COLLISION_MARGIN)) return false
  }
  return true
}

function commit(
  ctx: Ctx,
  inst: FurnitureInstance,
  def: ModelDef,
  x: number,
  z: number,
  rot: number,
  extra: { ghost?: boolean; side?: Side } = {},
): void {
  const qx = quantize(x)
  const qz = quantize(z)
  inst.position = [qx, qz]
  inst.rotationY = Math.round(rot * 10000) / 10000
  const [w, d] = footprintOf(def, inst.params, inst.scale)
  const placed: Placed = { inst, box: boxAt(qx, qz, w, d, rot), ghost: extra.ghost ?? false }
  if (extra.side) {
    placed.side = extra.side
    if (!ctx.sideOf.has(def.id)) ctx.sideOf.set(def.id, extra.side)
  }
  ctx.placed.push(placed)
}

function candidateBox(def: ModelDef, rule: BaseRule, x: number, z: number, rot: number): Box {
  const [w, d] = footprintOf(def, rule.params ? { ...defaultParams(def), ...rule.params } : undefined)
  return boxAt(x, z, w, d, rot)
}

function placeWall(ctx: Ctx, rule: WallRule): void {
  const def = resolveModel(ctx, rule.model)
  if (!def) return
  const inst = makeInstance(ctx, def, rule)

  let sides = rule.sides ?? ALL_SIDES
  if (rule.oppositeOf) {
    const s = ctx.sideOf.get(rule.oppositeOf)
    if (s) sides = [OPPOSITE[s]]
  }
  if (rule.sameSideAs) {
    const s = ctx.sideOf.get(rule.sameSideAs)
    if (s) sides = [s]
  }
  const host = rule.besideOf ? findPlaced(ctx, rule.besideOf) : undefined
  if (rule.besideOf && !host) return
  const useBeside = host !== undefined && host.side !== undefined
  if (useBeside && host.side) sides = [host.side]

  for (let i = 0; i < ATTEMPTS; i++) {
    const side = pick(ctx.rng, sides)
    const rot = inwardRotation(side)
    const box0 = candidateBox(def, rule, 0, 0, rot)
    const alongX = side === 'n' || side === 's'
    const L = alongX ? ctx.roomW : ctx.roomD
    const axisSize = alongX ? box0.w : box0.d
    const half = Math.max(0, L / 2 - axisSize / 2 - WALL_INSET - COLLISION_MARGIN)
    let axisPos: number
    if (useBeside && host) {
      // tuck against one side of the host piece along its wall
      const hMin = (alongX ? host.box.x - host.box.w / 2 : host.box.z - host.box.d / 2)
      const hMax = (alongX ? host.box.x + host.box.w / 2 : host.box.z + host.box.d / 2)
      const cands = [hMin - axisSize / 2 - 0.07, hMax + axisSize / 2 + 0.07]
      axisPos = pick(ctx.rng, cands) + range(ctx.rng, -0.04, 0.04)
    } else {
      const along = rule.along ?? [0.1, 0.9]
      const t = range(ctx.rng, along[0], along[1])
      axisPos = (t - 0.5) * L
    }
    axisPos = clamp(axisPos, -half, half)
    // skip candidates that would block a doorway (test the quantized position
    // — exactly what commit() will store); no rng draw, so determinism holds
    if (hitsDoor(ctx, side, quantize(axisPos), axisSize)) continue
    let x: number
    let z: number
    if (side === 'n') {
      x = axisPos
      z = -ctx.roomD / 2 + box0.d / 2 + WALL_INSET
    } else if (side === 's') {
      x = axisPos
      z = ctx.roomD / 2 - box0.d / 2 - WALL_INSET
    } else if (side === 'e') {
      x = ctx.roomW / 2 - box0.w / 2 - WALL_INSET
      z = axisPos
    } else {
      x = -ctx.roomW / 2 + box0.w / 2 + WALL_INSET
      z = axisPos
    }
    let finalRot = rot
    if (rule.faceCenter) finalRot = faceCenterRotation(x, z)
    if (rule.jitterRot) finalRot += range(ctx.rng, -rule.jitterRot, rule.jitterRot)
    const box = candidateBox(def, rule, x, z, finalRot)
    if (!accepts(ctx, box)) continue
    commit(ctx, inst, def, x, z, finalRot, { side })
    return
  }
  // not placed: instance dropped (ctx.seq already bumped — keeps determinism simple)
}

function placeRun(ctx: Ctx, rule: RunRule): void {
  // runs go on the longest candidate wall so nothing has to be dropped
  const candidates = rule.sides ?? (['n'] as Side[])
  const sideLen = (s: Side) => (s === 'n' || s === 's' ? ctx.roomW : ctx.roomD)
  const longest = candidates.reduce((best, s) => (sideLen(s) > sideLen(best) ? s : best))
  const defs = rule.models
    .map((id) => ctx.models.get(id))
    .filter((d): d is ModelDef => d !== undefined)
  if (defs.length === 0) return
  const gap = rule.gap ?? 0.05 // ≥5 cm: survives 0.05-grid quantization of both neighbors
  const INSET = WALL_INSET + COLLISION_MARGIN

  // fit the run on a side: rotated boxes, trailing items dropped until it fits
  const fitRun = (s: Side): { boxes: Box[]; total: number } => {
    const rotS = inwardRotation(s)
    const boxesS = defs.map((d) => candidateBox(d, rule, 0, 0, rotS))
    const axisOfS = (b: Box) => (s === 'n' || s === 's' ? b.w : b.d)
    const L = sideLen(s)
    // drop trailing items until the run fits the wall
    while (boxesS.length > 1) {
      const total = boxesS.reduce((sum, b) => sum + axisOfS(b), 0) + gap * (boxesS.length - 1)
      if (total <= L - 2 * INSET) break
      boxesS.pop()
    }
    return { boxes: boxesS, total: boxesS.reduce((sum, b) => sum + axisOfS(b), 0) + gap * (boxesS.length - 1) }
  }

  let side = longest
  let fitted = fitRun(side)
  // door-aware: among candidate sides pick the longest door-free span that
  // fits the run and start the run at the span start; no fit → fall back to
  // the longest wall (may cover a door — accepted limitation). Pure math, no
  // rng draws, so determinism is unaffected.
  let startAt: number | undefined
  if (candidates.some((s) => ctx.doorSpans[s].length > 0)) {
    let best: { s: Side; start: number; len: number; boxes: Box[]; total: number } | undefined
    for (const s of candidates) {
      const f = fitRun(s)
      const L = sideLen(s)
      for (const [a, b] of freeSpans(ctx, s, -L / 2 + INSET, L / 2 - INSET)) {
        // one grid step of padding per end: 5 cm position quantization can
        // then never drift a piece into the door clearance
        const start = a + 0.05
        const len = b - a - 0.1
        if (len >= f.total && (!best || len > best.len)) {
          best = { s, start, len, boxes: f.boxes, total: f.total }
        }
      }
    }
    if (best) {
      side = best.s
      fitted = { boxes: best.boxes, total: best.total }
      startAt = best.start
    }
  }

  const rot = inwardRotation(side)
  const alongX = side === 'n' || side === 's'
  const boxes = fitted.boxes
  const total = fitted.total
  const axisOf = (b: Box) => (alongX ? b.w : b.d)
  const L = sideLen(side)
  const slack = Math.max(0, L - 2 * INSET - total)
  let cursor = startAt !== undefined ? startAt : -total / 2 + range(ctx.rng, -slack / 2, slack / 2)
  const runStart = ctx.placed.length // run siblings intentionally sit ~2 cm apart
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    // quantize as we go so sibling gaps survive commit()'s position rounding
    const axisPos = quantize(cursor + axisOf(b) / 2)
    cursor = axisPos + axisOf(b) / 2 + gap
    let x: number
    let z: number
    if (side === 'n') {
      x = axisPos
      z = -ctx.roomD / 2 + b.d / 2 + WALL_INSET
    } else if (side === 's') {
      x = axisPos
      z = ctx.roomD / 2 - b.d / 2 - WALL_INSET
    } else if (side === 'e') {
      x = ctx.roomW / 2 - b.w / 2 - WALL_INSET
      z = axisPos
    } else {
      x = -ctx.roomW / 2 + b.w / 2 + WALL_INSET
      z = axisPos
    }
    const box: Box = { x, z, w: b.w, d: b.d } // b is already the rotated AABB
    if (!accepts(ctx, box, { ignoreFrom: runStart })) continue
    const inst = makeInstance(ctx, defs[i], rule)
    commit(ctx, inst, defs[i], x, z, rot, { side })
  }
}

function findPlaced(ctx: Ctx, modelId: string): Placed | undefined {
  return ctx.placed.find((p) => p.inst.modelId === modelId)
}

function placeFront(ctx: Ctx, rule: FrontRule): void {
  const def = resolveModel(ctx, rule.model)
  const host = findPlaced(ctx, rule.of)
  if (!def || !host) return
  const inst = makeInstance(ctx, def, rule)
  const hostRot = host.inst.rotationY
  const rot = rule.faceHost ? hostRot + Math.PI : hostRot
  const gap = rule.gap ?? 0.25
  const dx = Math.sin(hostRot)
  const dz = Math.cos(hostRot)
  const box0 = candidateBox(def, rule, 0, 0, rot)
  const hostHalf = (host.box.w * Math.abs(dx) + host.box.d * Math.abs(dz)) / 2
  const itemHalf = (box0.w * Math.abs(dx) + box0.d * Math.abs(dz)) / 2
  for (let i = 0; i < ATTEMPTS; i++) {
    const jitter = i === 0 ? 0 : range(ctx.rng, -0.2, 0.2)
    const x = host.inst.position[0] + dx * (hostHalf + itemHalf + gap) + jitter * dz
    const z = host.inst.position[1] + dz * (hostHalf + itemHalf + gap) - jitter * dx
    const box = candidateBox(def, rule, x, z, rot)
    if (!accepts(ctx, box, { ghost: rule.ghost })) continue
    commit(ctx, inst, def, x, z, rot, { ghost: rule.ghost })
    return
  }
}

function placeOn(ctx: Ctx, rule: OnRule): void {
  const def = resolveModel(ctx, rule.model)
  const host = findPlaced(ctx, rule.of)
  if (!def || !host) return
  const inst = makeInstance(ctx, def, rule)
  const x = host.inst.position[0]
  const z = host.inst.position[1]
  const rot = host.inst.rotationY
  const box = candidateBox(def, rule, x, z, rot)
  if (!accepts(ctx, box, { ghost: rule.ghost, ignoreId: host.inst.id })) return
  commit(ctx, inst, def, x, z, rot, { ghost: rule.ghost })
}

function placeCenter(ctx: Ctx, rule: CenterRule): void {
  const def = resolveModel(ctx, rule.model)
  if (!def) return
  const inst = makeInstance(ctx, def, rule)
  // align the longer axis of the piece with the longer axis of the room
  const rot = ctx.roomW >= ctx.roomD ? 0 : Math.PI / 2
  for (let i = 0; i < ATTEMPTS; i++) {
    const x = i === 0 ? 0 : range(ctx.rng, -0.3, 0.3)
    const z = i === 0 ? 0 : range(ctx.rng, -0.3, 0.3)
    const box = candidateBox(def, rule, x, z, rot)
    if (!accepts(ctx, box)) continue
    commit(ctx, inst, def, x, z, rot)
    return
  }
}

function placeCorner(ctx: Ctx, rule: CornerRule): void {
  const def = resolveModel(ctx, rule.model)
  if (!def) return
  const inst = makeInstance(ctx, def, rule)
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]
  for (let i = 0; i < ATTEMPTS; i++) {
    const [cx, cz] = pick(ctx.rng, corners)
    // first pass: approximate position to derive the facing rotation
    const rough = candidateBox(def, rule, 0, 0, 0)
    const rx = cx * Math.max(0, ctx.roomW / 2 - rough.w / 2 - WALL_INSET)
    const rz = cz * Math.max(0, ctx.roomD / 2 - rough.d / 2 - WALL_INSET)
    let rot = rule.faceCenter ? faceCenterRotation(rx, rz) : inwardRotation(cz < 0 ? 'n' : 's')
    if (rule.jitterRot) rot += range(ctx.rng, -rule.jitterRot, rule.jitterRot)
    // second pass: inset using the rotated footprint so the piece stays in bounds
    const box1 = candidateBox(def, rule, 0, 0, rot)
    const x = cx * Math.max(0, ctx.roomW / 2 - box1.w / 2 - WALL_INSET)
    const z = cz * Math.max(0, ctx.roomD / 2 - box1.d / 2 - WALL_INSET)
    const box = candidateBox(def, rule, x, z, rot)
    if (!accepts(ctx, box)) continue
    commit(ctx, inst, def, x, z, rot)
    return
  }
}

function placeFree(ctx: Ctx, rule: FreeRule): void {
  const def = resolveModel(ctx, rule.model)
  if (!def) return
  const count = rule.count ?? 1
  for (let n = 0; n < count; n++) {
    const inst = makeInstance(ctx, def, rule)
    for (let i = 0; i < ATTEMPTS; i++) {
      const rot = pick(ctx.rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2])
      const box0 = candidateBox(def, rule, 0, 0, rot)
      const hw = Math.max(0, ctx.roomW / 2 - box0.w / 2 - WALL_INSET)
      const hd = Math.max(0, ctx.roomD / 2 - box0.d / 2 - WALL_INSET)
      const x = range(ctx.rng, -hw, hw)
      const z = range(ctx.rng, -hd, hd)
      const finalRot = rule.faceCenter ? faceCenterRotation(x, z) : rot
      const box = candidateBox(def, rule, x, z, finalRot)
      if (!accepts(ctx, box)) continue
      commit(ctx, inst, def, x, z, finalRot)
      break
    }
  }
}

function placeRing(ctx: Ctx, rule: RingRule): void {
  const def = resolveModel(ctx, rule.model)
  const host = findPlaced(ctx, rule.around)
  if (!def || !host) return
  const [hx, hz] = host.inst.position
  const hostHalf = Math.max(host.box.w, host.box.d) / 2
  const box0 = candidateBox(def, rule, 0, 0, 0)
  const itemHalf = Math.max(box0.w, box0.d) / 2
  const dist = hostHalf + itemHalf + 0.06
  for (let i = 0; i < rule.count; i++) {
    const inst = makeInstance(ctx, def, rule)
    const angle = host.inst.rotationY + (i * 2 * Math.PI) / rule.count
    const x = hx + Math.sin(angle) * dist
    const z = hz + Math.cos(angle) * dist
    const rot = angle + Math.PI // face the host
    const box = candidateBox(def, rule, x, z, rot)
    if (!accepts(ctx, box)) continue
    commit(ctx, inst, def, x, z, rot)
  }
}

/** Deterministic per-instance id suffix is not used elsewhere; exported for tests/tools. */
export function overlapAllowed(a: FurnitureInstance, b: FurnitureInstance): boolean {
  const ids = [a.modelId, b.modelId]
  // rugs slide under everything; the TV sits on its bench
  if (ids.includes('builtin:rug')) return true
  if (ids.includes('builtin:tv') && ids.includes('builtin:tv-bench')) return true
  return false
}

/** A placed instance plus the wall it was placed against (wall/run rules only). */
export interface PlacedInstance {
  inst: FurnitureInstance
  side?: Side
}

/**
 * Generate a deterministic furniture layout with placement metadata.
 * Same opts (seed + salt + roomType + dims + extras + models + doors) → same output.
 */
export function generateLayoutDetailed(opts: LayoutOpts): PlacedInstance[] {
  const rng = rngFrom(`${opts.seed}:${opts.salt}:${opts.roomType}`)
  const program = PROGRAMS[opts.roomType] ?? PROGRAMS.living
  // door zones: wall-local → room-centered axis coords, once
  const doorSpans: Record<Side, [number, number][]> = { n: [], s: [], e: [], w: [] }
  for (const d of opts.doors ?? []) {
    const half = (d.side === 'n' || d.side === 's' ? opts.width : opts.depth) / 2
    doorSpans[d.side].push([d.from - half, d.to - half])
  }
  const ctx: Ctx = {
    rng,
    models: new Map(opts.models.map((m) => [m.id, m])),
    roomW: opts.width,
    roomD: opts.depth,
    doorSpans,
    placed: [],
    sideOf: new Map(),
    seq: 0,
    decorative: false,
  }
  for (const inst of opts.preserved ?? []) {
    const def = ctx.models.get(inst.modelId)
    if (!def) continue
    const [w, d] = footprintOf(def, inst.params, inst.scale)
    ctx.placed.push({ inst, box: boxAt(...inst.position, w, d, inst.rotationY), ghost: inst.modelId === 'builtin:rug' })
    ctx.seq = Math.max(ctx.seq, Number(inst.id.match(/(?:^|:)f(\d+)$/)?.[1] ?? 0))
  }
  const preservedCount = ctx.placed.length
  const extrasGate = Math.max(0, Math.min(100, opts.extras)) / 100

  for (const rule of program.rules) {
    const hostId = rule.kind === 'ring' ? rule.around : rule.kind === 'front' || rule.kind === 'on' ? rule.of : undefined
    ctx.decorative = rule.gate !== undefined || !!(hostId && findPlaced(ctx, hostId)?.inst.decor)
    if (opts.decorOnly && !ctx.decorative) continue
    const modelIds = Array.isArray(rule.model) ? rule.model : [rule.model]
    if (opts.preserved?.some((f) => (f.source !== 'generated' || f.locked) && modelIds.includes(f.modelId))) continue
    if (rule.gate !== undefined && !chance(rng, extrasGate * rule.gate)) continue
    switch (rule.kind) {
      case 'wall':
        placeWall(ctx, rule)
        break
      case 'run':
        placeRun(ctx, rule)
        break
      case 'front':
        placeFront(ctx, rule)
        break
      case 'on':
        placeOn(ctx, rule)
        break
      case 'center':
        placeCenter(ctx, rule)
        break
      case 'corner':
        placeCorner(ctx, rule)
        break
      case 'free':
        placeFree(ctx, rule)
        break
      case 'ring':
        placeRing(ctx, rule)
        break
    }
  }

  // sprinkle registry GLB decor, gated by extras %
  if (program.maxDecor > 0 && program.decorTypes.length > 0) {
    const pool = opts.models.filter(
      (m) =>
        m.kind === 'glb' &&
        program.decorTypes.includes(m.type) &&
        !DECOR_EXCLUDE.test(m.id) &&
        // restaurant clutter only belongs in kitchens/dining rooms
        (opts.roomType === 'kitchen' ||
          opts.roomType === 'dining' ||
          !m.file?.includes('kaykit-restaurant')) &&
        (!program.decorInclude || program.decorInclude.test(m.id)),
    )
    const count = Math.round(extrasGate * program.maxDecor)
    for (let i = 0; i < count && pool.length > 0; i++) {
      const def = pick(rng, pool)
      placeFree(ctx, { kind: 'free', model: def.id, gate: 1 })
    }
  }

  return ctx.placed.slice(preservedCount).map((p) => ({ inst: p.inst, side: p.side }))
}

/**
 * Generate a deterministic furniture layout.
 * Same opts (seed + salt + roomType + dims + extras + models + doors) → same output.
 */
export function generateLayout(opts: LayoutOpts): FurnitureInstance[] {
  return generateLayoutDetailed(opts).map((p) => p.inst)
}
