import type { Brand, FurnitureType } from '../models/registry'
import type { Opening, Side } from '../state/home'

/**
 * Bilingual (中文 English) UI labels. Convention: Chinese first, then the
 * English term; technical tokens (Seed, FPS, units, brand/model names,
 * keyboard keys) stay in English.
 */

export const TYPE_LABELS: Record<FurnitureType, string> = {
  BEDS: '床 Beds',
  SEATING: '座椅 Seating',
  LIGHTING: '灯具 Lighting',
  TABLES: '桌几 Tables',
  STORAGE: '收纳 Storage',
  KITCHEN: '厨房 Kitchen',
  BATHROOM: '卫浴 Bathroom',
  DECOR: '装饰 Decor',
  OTHER: '其他 Other',
}

export const BRAND_LABELS: Record<Brand, string> = {
  'BUILT-IN': '内建 Built-in',
  KENNEY: 'KENNEY',
  KAYKIT: 'KAYKIT',
  'MY UPLOADS': '我的上传 My uploads',
}

/** Wall sides (home coordinates: n = -z north, s = +z south). */
export const SIDE_LABELS: Record<Side, string> = {
  n: '北 N',
  s: '南 S',
  e: '东 E',
  w: '西 W',
}

/** Opening kinds ('open' = doorway without a leaf). */
export const OPENING_KIND_LABELS: Record<Opening['kind'], string> = {
  door: '门 Door',
  open: '门洞 Open',
  window: '窗 Window',
}

/** Kind label with the fullHeight nuance (balcony parapet vs opened-up wall). */
export function openingKindLabel(o: Opening): string {
  if (o.kind === 'open' && o.fullHeight) {
    return o.b === 'exterior' ? '阳台开口 Balcony opening' : '打通 Opened up'
  }
  return OPENING_KIND_LABELS[o.kind]
}
