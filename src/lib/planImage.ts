import { del, get, set } from 'idb-keyval'

/**
 * Latest imported floor-plan image (PNG dataURL), stored outside the zustand
 * persist slice to avoid blowing the localStorage quota — same pattern as
 * the render history in lib/ai.ts. Single slot: a new import overwrites.
 * The store only persists the key name (`planImageKey`) as the reactive
 * "has image" flag.
 */
export const PLAN_IMAGE_KEY = 'plan:image'

export function savePlanImage(dataUrl: string): Promise<void> {
  return set(PLAN_IMAGE_KEY, dataUrl)
}

export function loadPlanImage(): Promise<string | undefined> {
  return get<string>(PLAN_IMAGE_KEY)
}

export function deletePlanImage(): Promise<void> {
  return del(PLAN_IMAGE_KEY)
}
