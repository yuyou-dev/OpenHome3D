import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { get } from 'idb-keyval'
import { MODEL_BLOB_KEY } from '../three/runtime'
import { applyToon } from './toon'
import type { ModelDef } from '../models/registry'

/** idb-keyval key for a reference photo attached to a furniture instance (or upload model). */
export const REFPHOTO_KEY = (instanceId: string, n: number): string => `refphoto:${instanceId}:${n}`

/* ---------------------------------------------------------------------------
   Offscreen thumbnail renderer (vanilla three, no R3F).
   Toon colors + EdgesGeometry look matching the 3D view, lazy singleton
   WebGLRenderer, data-URL cache with in-flight dedupe.
--------------------------------------------------------------------------- */

const SIZE = 160
const EDGE_COLOR = 0x2e2a26
const CLEAR_COLOR = 0xfdf6e9

let renderer: THREE.WebGLRenderer | null = null

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    })
    renderer.setSize(SIZE, SIZE)
    renderer.setClearColor(CLEAR_COLOR, 1)
  }
  return renderer
}

const FALLBACK =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">` +
      `<rect width="100%" height="100%" fill="#fdf6e9"/>` +
      `<rect x="52" y="60" width="56" height="40" fill="none" stroke="#d8c7a8"/>` +
      `<path d="M52 60 L66 46 L122 46 L108 60 M122 46 L122 86 L108 100 M66 46 L66 86 L122 86" fill="none" stroke="#d8c7a8"/>` +
      `</svg>`,
  )

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

/**
 * Render (or fetch from cache) a 160×160 data-URL thumbnail of a GLB/upload model.
 * Parametric models are rendered by the R3F ParamThumb component instead.
 */
export function getThumbnail(def: ModelDef): Promise<string> {
  const hit = cache.get(def.id)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(def.id)
  if (pending) return pending
  const p = renderThumbnail(def)
    .catch(() => FALLBACK)
    .then((url) => {
      cache.set(def.id, url)
      inflight.delete(def.id)
      return url
    })
  inflight.set(def.id, p)
  return p
}

/** Drop a cached thumbnail (e.g. after an upload is removed). */
export function evictThumbnail(id: string): void {
  cache.delete(id)
}

async function loadModel(def: ModelDef): Promise<THREE.Object3D> {
  const loader = new GLTFLoader()
  if (def.kind === 'upload') {
    const blob = (await get(MODEL_BLOB_KEY(def.id))) as Blob | undefined
    if (!blob) throw new Error(`missing blob for ${def.id}`)
    const url = URL.createObjectURL(blob)
    try {
      const gltf = await loader.loadAsync(url)
      return gltf.scene
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  if (!def.file) throw new Error(`model ${def.id} has no file`)
  const gltf = await loader.loadAsync(def.file)
  return gltf.scene
}

/** Toon-ify materials (keeping the asset's own colors) and add dark edge lines. */
function stylize(root: THREE.Object3D): void {
  applyToon(root)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh)
  })
  for (const m of meshes) {
    const edges = new THREE.EdgesGeometry(m.geometry, 20)
    m.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: EDGE_COLOR })))
  }
}

async function renderThumbnail(def: ModelDef): Promise<string> {
  const model = await loadModel(def)
  stylize(model)

  // normalize: center at origin, fit inside a ~1.4 unit box
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 1
  const group = new THREE.Group()
  model.position.sub(center)
  group.add(model)
  group.scale.setScalar(1.4 / maxDim)

  const scene = new THREE.Scene()
  scene.add(group)
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0xd9c8e8, 1.4))
  const dir = new THREE.DirectionalLight(0xfff2df, 1.2)
  dir.position.set(2, 3, 2)
  scene.add(dir)

  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 100)
  const az = Math.PI / 4 // 45°
  const el = Math.PI / 6 // ~30°
  const r = 4
  cam.position.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az))
  cam.lookAt(0, 0, 0)

  const rd = getRenderer()
  rd.render(scene, cam)
  const url = rd.domElement.toDataURL('image/png')

  // dispose everything created for this thumbnail — EXCEPT the toon materials
  // (shared cache in lib/toon, reused across renders)
  scene.traverse((o) => {
    const withGeom = o as THREE.Mesh | THREE.LineSegments
    if (withGeom.geometry) withGeom.geometry.dispose()
    const mat = (withGeom as THREE.Mesh).material
    if (mat) {
      ;(Array.isArray(mat) ? mat : [mat]).forEach((m) => {
        if (!m.userData.shared) m.dispose()
      })
    }
  })

  return url
}
