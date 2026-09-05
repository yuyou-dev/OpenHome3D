import { get, keys, setMany } from 'idb-keyval'
import { getModel, type ModelDef } from '../models/registry'
import { useStore, type CompleteProjectState } from '../state/store'
import { roomsOverlap, validateOpening } from '../state/home'
import { ROOM_TYPES } from '../gen/roomTypes'
import { MODEL_BLOB_KEY } from '../three/runtime'
import { loadPlanImage } from './planImage'
import { uid } from './prng'

const FORMAT = 'home3d-cartoon'
const VERSION = 1
interface PackedModel { def: ModelDef; data: string }
interface PackedPhoto { owner: 'instance' | 'model'; id: string; index: number; data: string }
interface ProjectPackage {
  format: typeof FORMAT
  version: typeof VERSION
  scene: Omit<CompleteProjectState, 'uploads'>
  models: PackedModel[]
  photos: PackedPhoto[]
}

function requireValue(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`工程包无效 Invalid project package: ${message}`)
}
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const imageUrl = (value: unknown): value is string => typeof value === 'string' && /^data:image\/([a-zA-Z0-9.+-]+);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)

function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('无法读取项目资源 Cannot read project asset'))
    reader.readAsDataURL(blob)
  })
}

function dataBlob(data: string): Blob {
  const match = /^data:([^;,]*);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data)
  requireValue(match, 'asset encoding')
  const bytes = Uint8Array.from(atob(match[2]), character => character.charCodeAt(0))
  return new Blob([bytes], { type: match[1] || 'application/octet-stream' })
}

/** Select file fields explicitly so input JSON cannot overwrite store actions. */
function sceneFields(s: ProjectPackage['scene']): ProjectPackage['scene'] {
  return {
    home: s.home, seed: s.seed, furniture: s.furniture, extras: s.extras,
    wallHeight: s.wallHeight, cutawayWalls: s.cutawayWalls, floorSlab: s.floorSlab,
    windows: s.windows, doorLeaves: s.doorLeaves, showFurniture: s.showFurniture,
    projection: s.projection, moveGrid: s.moveGrid, planImageUrl: s.planImageUrl,
  }
}

/** Snapshot only resources actually referenced by this scene, not the whole browser library. */
export async function exportCompleteProject(): Promise<string> {
  const s = useStore.getState()
  const usedModels = new Set(s.furniture.map(f => f.modelId))
  const usedInstances = new Set(s.furniture.map(f => f.id))
  const uploads = s.uploads.filter(def => usedModels.has(def.id))
  const models = await Promise.all(uploads.map(async def => {
    const blob = await get<Blob>(MODEL_BLOB_KEY(def.id))
    requireValue(blob instanceof Blob, `模型资源缺失 Missing model: ${def.name}`)
    return { def, data: await blobData(blob) }
  }))
  for (const id of usedModels) {
    requireValue(!id.startsWith('upload:') || uploads.some(def => def.id === id), `model metadata: ${id}`)
  }
  const photos: PackedPhoto[] = []
  for (const key of await keys()) {
    if (typeof key !== 'string' || !key.startsWith('refphoto:')) continue
    const match = /^refphoto:(.+):(\d+)$/.exec(key)
    if (!match) continue
    const id = match[1]
    const owner = usedInstances.has(id) ? 'instance' : usedModels.has(id) ? 'model' : null
    if (!owner) continue
    const blob = await get<Blob>(key)
    requireValue(blob instanceof Blob, `参考照片缺失 Missing reference: ${key}`)
    photos.push({ owner, id, index: Number(match[2]), data: await blobData(blob) })
  }
  const planImageUrl = s.planImageKey ? s.planImageUrl ?? await loadPlanImage() ?? null : null
  requireValue(!s.planImageKey || planImageUrl, '户型原图缺失 Missing floor-plan image')
  const scene = sceneFields({ ...s, planImageUrl })
  return JSON.stringify({ format: FORMAT, version: VERSION, scene, models, photos } satisfies ProjectPackage)
}

/** Reject incomplete packages before writing any assets or replacing the current scene. */
function parsePackage(json: string): ProjectPackage {
  const p: ProjectPackage = JSON.parse(json)
  requireValue(p?.format === FORMAT && p.version === VERSION, 'unsupported format/version')
  const s = p.scene
  requireValue(s && text(s.seed) && finite(s.extras) && s.extras >= 0 && s.extras <= 100, 'scene settings')
  requireValue(positive(s.wallHeight) && positive(s.moveGrid) && ['isometric', 'perspective'].includes(s.projection), 'shell/camera settings')
  requireValue(['cutawayWalls', 'floorSlab', 'windows', 'doorLeaves', 'showFurniture'].every(key => typeof s[key as keyof typeof s] === 'boolean'), 'display settings')
  requireValue(s.planImageUrl === null || imageUrl(s.planImageUrl), 'floor-plan image')
  requireValue(Array.isArray(s.home?.rooms) && s.home.rooms.length && Array.isArray(s.home.openings) && Array.isArray(s.furniture), 'scene collections')
  const roomIds = new Set<string>()
  for (const room of s.home.rooms) {
    requireValue(room && text(room.id) && !roomIds.has(room.id) && text(room.name) && ROOM_TYPES.some(type => type.id === room.type), 'room identity/type')
    requireValue(room.rect && finite(room.rect.x) && finite(room.rect.z) && positive(room.rect.w) && positive(room.rect.d) && finite(room.salt) && finite(room.partitionHeight) && room.partitionHeight >= 0, 'room geometry')
    requireValue(!s.home.rooms.some(other => other !== room && roomsOverlap(room, other)), 'overlapping rooms')
    roomIds.add(room.id)
  }
  const openingIds = new Set<string>()
  for (const opening of s.home.openings) {
    requireValue(opening && text(opening.id) && !openingIds.has(opening.id) && ['door', 'window', 'open'].includes(opening.kind) && ['n', 's', 'e', 'w'].includes(opening.side), 'opening identity/type')
    requireValue(finite(opening.offset) && positive(opening.width) && validateOpening(s.home, opening), 'opening wall connection')
    openingIds.add(opening.id)
  }
  requireValue(Array.isArray(p.models) && Array.isArray(p.photos), 'asset collections')
  const modelIds = new Set<string>()
  for (const model of p.models) {
    const def = model?.def
    requireValue(def && text(def.id) && def.id.startsWith('upload:') && !modelIds.has(def.id) && def.kind === 'upload' && def.brand === 'MY UPLOADS' && text(def.name), 'upload metadata')
    requireValue(['BEDS', 'SEATING', 'LIGHTING', 'TABLES', 'STORAGE', 'KITCHEN', 'BATHROOM', 'DECOR', 'OTHER'].includes(def.type), 'upload type')
    requireValue(Array.isArray(def.footprint) && def.footprint.length === 2 && def.footprint.every(positive) && (def.height === undefined || positive(def.height)), 'upload dimensions')
    requireValue(def.mount === undefined || ['floor', 'wall', 'ceiling'].includes(def.mount), 'upload mount')
    requireValue(text(model.data), 'model data')
    modelIds.add(def.id)
  }
  const instanceIds = new Set<string>()
  const usedModels = new Set<string>()
  for (const f of s.furniture) {
    requireValue(f && text(f.id) && !instanceIds.has(f.id) && roomIds.has(f.roomId) && text(f.label) && (modelIds.has(f.modelId) || getModel(f.modelId)?.kind !== 'upload' && getModel(f.modelId)), 'furniture references')
    requireValue(Array.isArray(f.position) && f.position.length === 2 && f.position.every(finite) && finite(f.rotationY) && positive(f.scale), 'furniture pose')
    requireValue(f.params && typeof f.params === 'object' && !Array.isArray(f.params) && Object.values(f.params).every(value => typeof value === 'boolean' || finite(value)), 'furniture parameters')
    requireValue(f.source === undefined || ['manual', 'generated'].includes(f.source), 'furniture source')
    requireValue((f.locked === undefined || typeof f.locked === 'boolean') && (f.decor === undefined || typeof f.decor === 'boolean'), 'furniture flags')
    instanceIds.add(f.id)
    usedModels.add(f.modelId)
  }
  const photoIds = new Set<string>()
  for (const photo of p.photos) {
    requireValue(photo && (photo.owner === 'instance' ? instanceIds.has(photo.id) : photo.owner === 'model' && usedModels.has(photo.id)) && Number.isInteger(photo.index) && photo.index >= 0 && imageUrl(photo.data), 'reference photo')
    const key = `${photo.owner}:${photo.id}:${photo.index}`
    requireValue(!photoIds.has(key), 'duplicate reference photo')
    photoIds.add(key)
  }
  return p
}

/** New asset/instance IDs keep existing browser resources and undo snapshots intact. */
export async function importCompleteProject(json: string): Promise<void> {
  const p = parsePackage(json)
  const modelIds = new Map(p.models.map(model => [model.def.id, `upload:${uid()}`]))
  const instanceIds = new Map(p.scene.furniture.map(f => [f.id, uid()]))
  const entries: [IDBValidKey, Blob][] = []
  const uploads: ModelDef[] = []
  for (const model of p.models) {
    const id = modelIds.get(model.def.id)!
    const blob = dataBlob(model.data)
    const header = new DataView(await blob.slice(0, 12).arrayBuffer())
    requireValue(header.byteLength === 12 && header.getUint32(0, true) === 0x46546c67 && header.getUint32(4, true) === 2 && header.getUint32(8, true) === blob.size, 'GLB header')
    uploads.push({ id, name: model.def.name, kind: 'upload', brand: 'MY UPLOADS', type: model.def.type, footprint: model.def.footprint, height: model.def.height, mount: model.def.mount })
    entries.push([MODEL_BLOB_KEY(id), blob])
  }
  // Uploads have new model IDs, so their model-level references remain inheritable.
  // Shared built-in model photos become instance-local to avoid overwriting other projects.
  for (const photo of p.photos) {
    const blob = dataBlob(photo.data)
    if (photo.owner === 'model' && modelIds.has(photo.id)) {
      entries.push([`refphoto:${modelIds.get(photo.id)!}:${photo.index}`, blob])
      continue
    }
    const owners = photo.owner === 'instance' ? [photo.id] : p.scene.furniture.filter(f => f.modelId === photo.id).map(f => f.id)
    for (const owner of owners) {
      const prefix = `refphoto:${instanceIds.get(owner)!}:`
      let index = photo.index
      while (entries.some(([key]) => key === `${prefix}${index}`)) index++
      entries.push([`${prefix}${index}`, blob])
    }
  }
  await setMany(entries) // One IDB transaction; failure leaves the current project intact.
  const furniture = p.scene.furniture.map(f => ({ ...f, id: instanceIds.get(f.id)!, modelId: modelIds.get(f.modelId) ?? f.modelId }))
  useStore.getState().restoreCompleteProject({ ...sceneFields(p.scene), furniture, uploads })
}
