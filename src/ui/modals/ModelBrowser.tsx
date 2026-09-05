import { memo, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { del } from 'idb-keyval'
import { useStore } from '../../state/store'
import {
  allModels,
  defaultParams,
  type Brand,
  type FurnitureType,
  type ModelDef,
} from '../../models/registry'
import { PARAMETRIC_COMPONENTS } from '../../models/parametric/index'
import { matchesModelSearch } from '../../models/search'
import { MODEL_BLOB_KEY } from '../../three/runtime'
import { evictThumbnail, getThumbnail } from '../../lib/thumbnails'
import { useUI } from '../uiStore'
import { Chip, GhostButton, IconButton, useInView } from '../components'
import { BRAND_LABELS, TYPE_LABELS } from '../labels'

const BRANDS: Brand[] = ['BUILT-IN', 'KENNEY', 'KAYKIT', 'MY UPLOADS']

const TYPES: FurnitureType[] = [
  'BEDS',
  'SEATING',
  'LIGHTING',
  'TABLES',
  'STORAGE',
  'KITCHEN',
  'BATHROOM',
  'DECOR',
  'OTHER',
]

type BrandFilter = 'ALL' | Brand
type TypeFilter = 'ALL' | FurnitureType

/** Aim the thumbnail camera at the model's approximate bbox center, once. */
function Aim({ y }: { y: number }) {
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    camera.lookAt(0, y, 0)
    invalidate()
  }, [camera, invalidate, y])
  return null
}

/** Capture after a few live frames, then report it. */
function Capture({ onShot }: { onShot: (url: string) => void }) {
  const gl = useThree((s) => s.gl)
  const frames = useRef(0)
  const done = useRef(false)
  useFrame(() => {
    if (done.current) return
    if (++frames.current >= 3) {
      done.current = true
      onShot(gl.domElement.toDataURL('image/png'))
    }
  })
  return null
}

// ---------------------------------------------------------------------------
// Parametric thumbnails: ONE shared hidden canvas renders jobs serially.
// Per-card canvases blow past the browser's ~16 WebGL context limit (the main
// scene + this modal already hold several), and evicted contexts capture as
// blank transparent PNGs — so jobs queue onto a single worker canvas instead.
// ---------------------------------------------------------------------------

const paramThumbCache = new Map<string, string>()
type ParamJob = { def: ModelDef; resolve: (url: string) => void }
const paramJobQueue: ParamJob[] = []
const paramJobPending = new Set<string>()
let paramWorkerKick: (() => void) | null = null

function requestParamThumb(def: ModelDef): Promise<string> {
  const hit = paramThumbCache.get(def.id)
  if (hit) return Promise.resolve(hit)
  return new Promise((resolve) => {
    if (!paramJobPending.has(def.id)) {
      paramJobPending.add(def.id)
      paramJobQueue.push({ def, resolve })
    } else {
      paramJobQueue.push({ def, resolve }) // extra waiter for the same id
    }
    paramWorkerKick?.()
  })
}

/** Mounted once inside ModelBrowser; invisible. */
function ParamThumbWorker() {
  const [job, setJob] = useState<ParamJob | null>(null)

  // kick: pick up the next queued job when idle
  useEffect(() => {
    paramWorkerKick = () => {
      setJob((cur) => cur ?? paramJobQueue.shift() ?? null)
    }
    return () => {
      paramWorkerKick = null
    }
  }, [])

  if (!job) return null
  const { def } = job
  const Comp = PARAMETRIC_COMPONENTS[def.id]
  const h = def.height ?? 1
  const maxDim = Math.max(def.footprint[0], def.footprint[1], h)
  const d = 1.8 * maxDim

  const finish = (url: string) => {
    paramThumbCache.set(def.id, url)
    // resolve every queued waiter for this id
    const waiters = [job, ...paramJobQueue.filter((j) => j.def.id === def.id)]
    for (let i = paramJobQueue.length - 1; i >= 0; i--) {
      if (paramJobQueue[i].def.id === def.id) paramJobQueue.splice(i, 1)
    }
    paramJobPending.delete(def.id)
    waiters.forEach((j) => j.resolve(url))
    setJob(paramJobQueue.shift() ?? null)
  }

  return (
    <div style={{ position: 'absolute', width: 160, height: 160, left: -9999, top: -9999 }}>
      <Canvas
        key={def.id}
        dpr={1}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        camera={{ fov: 22, position: [d, 0.8 * d, d], near: 0.01, far: 100 }}
        style={{ background: '#fdf6e9' }}
      >
        <ambientLight intensity={0.95} />
        <directionalLight position={[3, 5, 2]} intensity={1.7} color="#fff2df" />
        <Aim y={h / 2} />
        {Comp ? <Comp params={defaultParams(def)} /> : null}
        <Capture onShot={finish} />
      </Canvas>
    </div>
  )
}

/** Parametric (built-in) thumbnail: data URL from the shared worker canvas. */
const ParamThumb = memo(function ParamThumb({ def }: { def: ModelDef }) {
  const [url, setUrl] = useState(() => paramThumbCache.get(def.id) ?? null)
  useEffect(() => {
    if (url) return
    let ok = true
    void requestParamThumb(def).then((u) => {
      if (ok) setUrl(u)
    })
    return () => {
      ok = false
    }
  }, [def, url])
  return url ? <img src={url} alt={def.name} /> : null
})

/** GLB/upload thumbnail: data URL from the offscreen vanilla-three renderer. */
function GlbThumb({ def }: { def: ModelDef }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let ok = true
    void getThumbnail(def).then((u) => {
      if (ok) setUrl(u)
    })
    return () => {
      ok = false
    }
  }, [def])
  return url ? <img src={url} alt={def.name} /> : null
}

function Card({
  def,
  mode,
  current,
  onPick,
  onDelete,
}: {
  def: ModelDef
  mode: 'swap' | 'add'
  current: boolean
  onPick: () => void
  onDelete?: () => void
}) {
  const { ref, inView } = useInView<HTMLDivElement>()
  return (
    <div
      className={`card${current ? ' current' : ''}`}
      onClick={onPick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onPick()
      }}
      title={def.name}
    >
      <div className="card-thumb" ref={ref}>
        {inView && (def.kind === 'parametric' ? <ParamThumb def={def} /> : <GlbThumb def={def} />)}
      </div>
      <div className="card-name">{def.name}</div>
      {mode === 'swap' && current && <span className="card-badge">✓</span>}
      {onDelete && (
        <button
          type="button"
          className="card-del"
          title={`Delete ${def.name}`}
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          ×
        </button>
      )}
    </div>
  )
}

export default function ModelBrowser({ mode }: { mode: 'swap' | 'add' }) {
  const closeModal = useUI((s) => s.closeModal)
  const openUpload = useUI((s) => s.openUpload)
  const pushToast = useUI((s) => s.pushToast)
  const uploads = useStore((s) => s.uploads) // re-render on upload add/remove
  const selectedId = useStore((s) => s.selectedId)
  const swapModel = useStore((s) => s.swapModel)
  const addFurniture = useStore((s) => s.addFurniture)
  const removeUpload = useStore((s) => s.removeUpload)
  void uploads

  const [search, setSearch] = useState('')
  const [brand, setBrand] = useState<BrandFilter>(() => useUI.getState().forcedBrand ?? 'ALL')
  const [type, setType] = useState<TypeFilter>('ALL')

  // the browser reopens with MY UPLOADS active after an upload — consume that once
  useEffect(() => {
    useUI.getState().consumeForcedBrand()
  }, [])

  const models = allModels()
  const matchSearch = (m: ModelDef) => matchesModelSearch(m, search)
  const brandFiltered = models.filter((m) => (brand === 'ALL' || m.brand === brand) && matchSearch(m))
  const visible = brandFiltered.filter((m) => type === 'ALL' || m.type === type)

  const brandCount = (b: BrandFilter) =>
    b === 'ALL' ? models.length : models.filter((m) => m.brand === b).length
  const typeCount = (t: TypeFilter) =>
    t === 'ALL' ? brandFiltered.length : brandFiltered.filter((m) => m.type === t).length

  const currentModelId = useStore((s) =>
    mode === 'swap' ? s.furniture.find((f) => f.id === s.selectedId)?.modelId : undefined,
  )

  const pick = (def: ModelDef) => {
    if (mode === 'swap') {
      if (selectedId) {
        swapModel(selectedId, def.id)
        pushToast(`已换模 Swapped for ${def.name}`)
      }
    } else {
      addFurniture(def.id)
      pushToast('已添加 — 拖拽放置 Added, drag to place')
    }
    closeModal()
  }

  const deleteUpload = (def: ModelDef) => {
    removeUpload(def.id)
    void del(MODEL_BLOB_KEY(def.id))
    evictThumbnail(def.id)
    pushToast(`已移除 Removed: ${def.name}`)
  }

  return (
    <div className="modal-overlay">
      <div className="modal-panel" data-modal="">
        <div className="modal-head">
          <span className="modal-title">{mode === 'swap' ? '换模 Swap model' : '添加家具 Add furniture'}</span>
          <input
            className="input search"
            placeholder="搜索模型 Search models…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          <GhostButton onClick={() => openUpload(mode)}>+ 上传模型 Upload model</GhostButton>
          <IconButton title="关闭 Close" onClick={() => closeModal()}>
            ×
          </IconButton>
        </div>

        <div className="filters">
          <div className="filter-row">
            <span className="lbl filter-label">品牌 Brand</span>
            <div className="chips">
              <Chip label="全部 All" count={brandCount('ALL')} active={brand === 'ALL'} onClick={() => setBrand('ALL')} />
              {BRANDS.map((b) => (
                <Chip
                  key={b}
                  label={BRAND_LABELS[b]}
                  count={brandCount(b)}
                  active={brand === b}
                  onClick={() => setBrand(b)}
                />
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="lbl filter-label">类型 Type</span>
            <div className="chips">
              <Chip label="全部 All" count={typeCount('ALL')} active={type === 'ALL'} onClick={() => setType('ALL')} />
              {TYPES.map((t) => (
                <Chip
                  key={t}
                  label={TYPE_LABELS[t]}
                  count={typeCount(t)}
                  active={type === t}
                  onClick={() => setType(t)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mb-grid">
          <ParamThumbWorker />
          {visible.map((def) => (
            <Card
              key={def.id}
              def={def}
              mode={mode}
              current={def.id === currentModelId}
              onPick={() => pick(def)}
              onDelete={def.kind === 'upload' ? () => deleteUpload(def) : undefined}
            />
          ))}
          {visible.length === 0 && (
            <p className="hint" style={{ gridColumn: '1 / -1' }}>
              没有匹配的模型 No models match these filters.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
