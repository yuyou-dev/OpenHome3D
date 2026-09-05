import { useEffect, useRef, useState, type DragEvent } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { set } from 'idb-keyval'
import { useStore } from '../../state/store'
import type { FurnitureType, ModelDef } from '../../models/registry'
import { MODEL_BLOB_KEY } from '../../three/runtime'
import { REFPHOTO_KEY } from '../../lib/thumbnails'
import { useUI } from '../uiStore'
import { GhostButton, IconButton, PrimaryButton } from '../components'

const ACCEPT = '.glb,.gltf,.obj,.dae,.stl,.ply'

interface Category {
  label: string
  type: FurnitureType
}

const CATEGORIES: Category[] = [
  { label: '扶手椅 Armchair', type: 'SEATING' },
  { label: '床 Bed', type: 'BEDS' },
  { label: '蜡烛 Candle', type: 'DECOR' },
  { label: '吸顶灯 Ceiling Light', type: 'LIGHTING' },
  { label: '椅子 Chair', type: 'SEATING' },
  { label: '吊灯 Chandelier', type: 'LIGHTING' },
  { label: '茶几 Coffee Table', type: 'TABLES' },
  { label: '装饰 Decor', type: 'DECOR' },
  { label: '书桌 Desk', type: 'TABLES' },
  { label: '餐椅 Dining Chair', type: 'SEATING' },
  { label: '餐桌 Dining Table', type: 'TABLES' },
  { label: '户外桌 Exterior Table', type: 'TABLES' },
  { label: '落地灯 Floor Lamp', type: 'LIGHTING' },
  { label: '吊灯 Pendant Light', type: 'LIGHTING' },
  { label: '植物 Plant', type: 'DECOR' },
  { label: '地毯 Rug', type: 'DECOR' },
  { label: '层架 Shelving', type: 'STORAGE' },
  { label: '边柜 Sideboard', type: 'STORAGE' },
  { label: '沙发 Sofa', type: 'SEATING' },
  { label: '凳 Stool', type: 'SEATING' },
  { label: '其他 Other', type: 'OTHER' },
]

/** Best-guess category from the file name; falls back to Other. */
function guessCategory(filename: string): number {
  const n = filename.toLowerCase()
  const rules: [RegExp, string][] = [
    [/sofa|couch/, '沙发 Sofa'],
    [/armchair/, '扶手椅 Armchair'],
    [/dining.?chair/, '餐椅 Dining Chair'],
    [/chair/, '椅子 Chair'],
    [/stool/, '凳 Stool'],
    [/bed/, '床 Bed'],
    [/chandelier/, '吊灯 Chandelier'],
    [/pendant|hanging/, '吊灯 Pendant Light'],
    [/ceiling/, '吸顶灯 Ceiling Light'],
    [/floor.?lamp/, '落地灯 Floor Lamp'],
    [/lamp|light/, '吊灯 Pendant Light'],
    [/coffee.?table/, '茶几 Coffee Table'],
    [/dining.?table/, '餐桌 Dining Table'],
    [/desk/, '书桌 Desk'],
    [/table/, '茶几 Coffee Table'],
    [/shel(f|ves|ving)|bookcase/, '层架 Shelving'],
    [/sideboard|cabinet|wardrobe|dresser/, '边柜 Sideboard'],
    [/plant|pot/, '植物 Plant'],
    [/rug|carpet/, '地毯 Rug'],
    [/candle/, '蜡烛 Candle'],
  ]
  for (const [re, label] of rules) {
    if (re.test(n)) {
      const i = CATEGORIES.findIndex((c) => c.label === label)
      if (i >= 0) return i
    }
  }
  return CATEGORIES.length - 1 // Other
}

const whiteMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })

async function loadFileToGroup(file: File): Promise<THREE.Group> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  const url = URL.createObjectURL(file)
  try {
    switch (ext) {
      case 'glb':
      case 'gltf': {
        const gltf = await new GLTFLoader().loadAsync(url)
        return gltf.scene
      }
      case 'obj':
        return await new OBJLoader().loadAsync(url)
      case 'stl': {
        const geo = await new STLLoader().loadAsync(url)
        return new THREE.Group().add(new THREE.Mesh(geo, whiteMat()))
      }
      case 'ply': {
        const geo = await new PLYLoader().loadAsync(url)
        if (!geo.attributes.normal) geo.computeVertexNormals()
        return new THREE.Group().add(new THREE.Mesh(geo, whiteMat()))
      }
      case 'dae': {
        const collada = await new ColladaLoader().loadAsync(url)
        if (!collada?.scene) throw new Error('empty collada file')
        return new THREE.Group().add(collada.scene)
      }
      default:
        throw new Error(`unsupported format: ${ext}`)
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function measure(group: THREE.Object3D): { size: THREE.Vector3; triangles: number } {
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
  let triangles = 0
  group.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = m.geometry
    triangles += Math.round((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3)
  })
  return { size, triangles }
}

const thousands = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

interface RefPhoto {
  file: File
  url: string
}

export default function UploadModel() {
  const closeUpload = useUI((s) => s.closeUpload)
  const pushToast = useUI((s) => s.pushToast)
  const addUpload = useStore((s) => s.addUpload)

  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [category, setCategory] = useState(CATEGORIES.length - 1)
  const [sizeLine, setSizeLine] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState<RefPhoto[]>([])
  const groupRef = useRef<THREE.Group | null>(null)
  const sizeRef = useRef<THREE.Vector3 | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photoRef = useRef<HTMLInputElement>(null)
  const photoUrls = useRef<string[]>([])

  // Keep ownership separate from render state so unmount sees every preview.
  useEffect(() => () => {
    photoUrls.current.forEach((url) => URL.revokeObjectURL(url))
    photoUrls.current = []
  }, [])

  const pickFile = async (f: File) => {
    setError(null)
    setSizeLine(null)
    setFile(f)
    groupRef.current = null
    sizeRef.current = null
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
    setCategory(guessCategory(f.name))
    try {
      const group = await loadFileToGroup(f)
      const { size, triangles } = measure(group)
      groupRef.current = group
      sizeRef.current = size
      setSizeLine(
        `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m · ${thousands(triangles)} triangles`,
      )
    } catch {
      setFile(null)
      setError(
        '无法读取该文件。注意:不支持引用外部 buffer 的 .gltf — 请导出单个 .glb。Could not read that file; .gltf with external buffers is not supported.',
      )
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) void pickFile(f)
  }

  const addPhotos = (files: File[]) => {
    const added = files.map((file) => ({ file, url: URL.createObjectURL(file) }))
    photoUrls.current.push(...added.map((photo) => photo.url))
    setPhotos((prev) => [...prev, ...added])
  }

  const canAdd = !!file && !!groupRef.current && !!name.trim() && !busy

  const onAdd = async () => {
    const group = groupRef.current
    const size = sizeRef.current
    if (!file || !group || !size) return
    setBusy(true)
    setError(null)
    try {
      const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        new GLTFExporter().parse(
          group,
          (out) => resolve(out as ArrayBuffer),
          (err) => reject(err),
          { binary: true },
        )
      })
      const blob = new Blob([buffer], { type: 'model/gltf-binary' })
      const id = `upload:${crypto.randomUUID()}`
      await set(MODEL_BLOB_KEY(id), blob)
      const def: ModelDef = {
        id,
        name: name.trim(),
        brand: 'MY UPLOADS',
        type: CATEGORIES[category].type,
        kind: 'upload',
        footprint: [Math.max(size.x, 0.05), Math.max(size.z, 0.05)],
        height: size.y,
      }
      addUpload(def)
      for (let i = 0; i < photos.length; i++) {
        await set(REFPHOTO_KEY(id, i), photos[i].file)
      }
      pushToast(`已添加 Added: ${def.name}`)
      closeUpload(true)
    } catch {
      setError('导出失败 — 请换一个文件试试 Export failed, try a different file.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay higher">
      <div className="modal-panel upload-panel" data-modal="">
        <div className="modal-head">
          <span className="modal-title">上传模型 Upload model</span>
          <span style={{ flex: 1 }} />
          <IconButton title="关闭 Close" onClick={() => closeUpload(false)}>
            ×
          </IconButton>
        </div>

        <div className="upload-body">
          <div
            className={`dropzone${file ? ' has-file' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            role="button"
          >
            {file ? file.name : '选择或拖入一个模型文件 Choose or drop a model'}
            <br />
            <span className="caption">.glb .gltf .obj .dae .stl .ply</span>
            <br />
            <span className="caption">
              不支持引用外部 buffer 的 .gltf — 请导出单个 .glb
            </span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void pickFile(f)
              e.target.value = ''
            }}
          />

          {sizeLine && <div className="size-line">{sizeLine}</div>}
          {error && <div className="error-line">{error}</div>}

          <div className="form-row">
            <span className="lbl">名称 Name</span>
            <input
              className="input"
              value={name}
              placeholder="模型名称 Model name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-row">
            <span className="lbl">分类 Category</span>
            <select
              className="input"
              value={category}
              onChange={(e) => setCategory(parseInt(e.target.value, 10))}
            >
              {CATEGORIES.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <span className="lbl">参考照片 Reference photos(可选)</span>
            {photos.length > 0 && (
              <div className="ref-previews">
                {photos.map((p) => (
                  <img key={p.url} src={p.url} alt="参考 reference" />
                ))}
              </div>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: '100%' }}
              onClick={() => photoRef.current?.click()}
            >
              + 添加参考照片 Add reference photos
            </button>
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                if (files.length) addPhotos(files)
                e.target.value = ''
              }}
            />
          </div>

          <div className="btn-row">
            <GhostButton onClick={() => closeUpload(false)}>取消 Cancel</GhostButton>
            <PrimaryButton disabled={!canAdd} onClick={() => void onAdd()}>
              {busy ? '添加中… Adding…' : '添加模型 Add model'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  )
}
