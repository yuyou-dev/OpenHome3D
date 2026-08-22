import { chance, range, type Rng } from '../lib/prng'

/** Window/door opening spec: count range and width range (meters). */
export interface OpeningSpec {
  count: [number, number]
  width: [number, number]
}

export interface RoomTypeSpec {
  id: string
  label: string
  /** width range (x, meters) */
  width: [number, number]
  /** depth range (z, meters) */
  depth: [number, number]
  /** wall height range (meters) */
  wallHeight: [number, number]
  /** probability of getting a partition wall */
  partitionChance: number
  /** partition height when present (meters); 0 = no partition */
  partitionHeight: number
  windows: OpeningSpec
  doors: OpeningSpec
}

export const ROOM_TYPES: RoomTypeSpec[] = [
  {
    id: 'studio',
    label: '单间公寓 Studio',
    width: [5.5, 6.5],
    depth: [4.5, 5.5],
    wallHeight: [2.8, 3.4],
    partitionChance: 0.5,
    partitionHeight: 1.2,
    windows: { count: [2, 3], width: [1.0, 1.6] },
    doors: { count: [1, 1], width: [0.9, 1.0] },
  },
  {
    id: 'living',
    label: '客厅 Living room',
    width: [4.8, 6.0],
    depth: [4.0, 5.0],
    wallHeight: [2.9, 3.8],
    partitionChance: 0.35,
    partitionHeight: 1.2,
    windows: { count: [1, 3], width: [1.0, 1.8] },
    doors: { count: [1, 2], width: [0.8, 1.0] },
  },
  {
    id: 'bedroom',
    label: '卧室 Bedroom',
    width: [3.8, 5.0],
    depth: [3.4, 4.6],
    wallHeight: [2.7, 3.1],
    partitionChance: 0,
    partitionHeight: 0,
    windows: { count: [1, 2], width: [0.9, 1.5] },
    doors: { count: [1, 1], width: [0.8, 0.9] },
  },
  {
    id: 'kitchen',
    label: '厨房 Kitchen',
    width: [3.0, 4.2],
    depth: [2.8, 3.8],
    wallHeight: [2.7, 3.1],
    partitionChance: 0,
    partitionHeight: 0,
    windows: { count: [1, 1], width: [0.8, 1.2] },
    doors: { count: [1, 1], width: [0.8, 0.9] },
  },
  {
    id: 'bathroom',
    label: '卫浴 Bathroom',
    width: [2.2, 3.0],
    depth: [1.8, 2.6],
    wallHeight: [2.7, 2.9],
    partitionChance: 0,
    partitionHeight: 0,
    windows: { count: [0, 1], width: [0.5, 0.8] },
    doors: { count: [1, 1], width: [0.7, 0.8] },
  },
  {
    id: 'office',
    label: '书房 Office',
    width: [3.4, 4.6],
    depth: [3.0, 4.2],
    wallHeight: [2.7, 3.1],
    partitionChance: 0,
    partitionHeight: 0,
    windows: { count: [1, 2], width: [0.9, 1.4] },
    doors: { count: [1, 1], width: [0.8, 0.9] },
  },
  {
    id: 'dining',
    label: '餐厅 Dining room',
    width: [4.0, 5.4],
    depth: [3.4, 4.6],
    wallHeight: [2.8, 3.3],
    partitionChance: 0,
    partitionHeight: 0,
    windows: { count: [1, 2], width: [1.0, 1.6] },
    doors: { count: [1, 2], width: [0.8, 0.9] },
  },
  {
    id: 'balcony',
    label: '阳台 Balcony',
    width: [2.6, 3.8],
    depth: [1.2, 1.8],
    wallHeight: [2.7, 3.0],
    partitionChance: 0,
    partitionHeight: 0,
    // windows suppressed (count 0); the open edge is an explicit fullHeight
    // opening (parapet) authored by import or the Home tab
    windows: { count: [0, 0], width: [0.9, 1.2] },
    doors: { count: [0, 0], width: [0.8, 0.9] },
  },
]

export const ROOM_TYPE_IDS: string[] = ROOM_TYPES.map((t) => t.id)

/** Look up a room type spec; falls back to living room for unknown ids. */
export function getRoomType(id: string): RoomTypeSpec {
  return ROOM_TYPES.find((t) => t.id === id) ?? ROOM_TYPES[1]
}

export interface RoomDefaults {
  width: number
  depth: number
  wallHeight: number
  partitionHeight: number
}

const round5cm = (v: number) => Math.round(v * 20) / 20

/**
 * Seed-derived default dimensions for a room type.
 * Pass an rng already seeded with the room seed (deterministic per seed).
 */
export function typeDefaults(typeId: string, rng: Rng): RoomDefaults {
  const t = getRoomType(typeId)
  return {
    width: round5cm(range(rng, t.width[0], t.width[1])),
    depth: round5cm(range(rng, t.depth[0], t.depth[1])),
    wallHeight: Math.round(range(rng, t.wallHeight[0], t.wallHeight[1]) * 100) / 100,
    partitionHeight:
      t.partitionChance > 0 && chance(rng, t.partitionChance) ? t.partitionHeight : 0,
  }
}
