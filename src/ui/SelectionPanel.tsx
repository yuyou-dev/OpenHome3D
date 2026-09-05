import { useEffect, useRef, useState } from 'react'
import { get, keys, set } from 'idb-keyval'
import { useStore } from '../state/store'
import { getModel, type FurnitureInstance, type ParamSpec } from '../models/registry'
import { REFPHOTO_KEY } from '../lib/thumbnails'
import { useUI } from './uiStore'
import { Checkbox, GhostButton, NumberInput, Section, Slider } from './components'

interface Photo {
  key: string
  url: string
}

/**
 * Reference photos for the selection, stored in idb-keyval as
 * `refphoto:<instanceId>:<n>`. Photos saved at upload time are keyed by the
 * model id, so those are surfaced here too as a read-only base set.
 */
function useRefPhotos(inst: FurnitureInstance) {
  const [photos, setPhotos] = useState<Photo[]>([])
  useEffect(() => {
    let alive = true
    const made: string[] = []
    ;(async () => {
      const all = await keys()
      const mine = all
        .filter(
          (k): k is string =>
            typeof k === 'string' &&
            (k.startsWith(`refphoto:${inst.id}:`) || k.startsWith(`refphoto:${inst.modelId}:`)),
        )
        .sort()
      const out: Photo[] = []
      for (const k of mine) {
        const blob = (await get(k)) as Blob | undefined
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        made.push(url)
        out.push({ key: k, url })
      }
      if (alive) setPhotos(out)
      else made.forEach((u) => URL.revokeObjectURL(u))
    })()
    return () => {
      alive = false
      made.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [inst.id, inst.modelId])
  return [photos, setPhotos] as const
}

function nextPhotoIndex(photos: Photo[], instanceId: string): number {
  let max = -1
  const prefix = `refphoto:${instanceId}:`
  for (const p of photos) {
    if (p.key.startsWith(prefix)) {
      const n = parseInt(p.key.slice(prefix.length), 10)
      if (!Number.isNaN(n)) max = Math.max(max, n)
    }
  }
  return max + 1
}

/** Param display heuristic: integer steps are counts; small ranges are meters. */
function paramDisplay(spec: ParamSpec): { unit?: string; digits: number } {
  const step = spec.step ?? 0.01
  if (step >= 1) return { digits: 0 }
  const digits = step >= 0.1 ? 1 : 2
  if (spec.max !== undefined && spec.max <= 5) return { unit: 'm', digits }
  return { digits }
}

export default function SelectionPanel() {
  const inst = useStore((s) => s.furniture.find((f) => f.id === s.selectedId))
  const def = inst ? getModel(inst.modelId) : undefined
  if (!inst || !def) return null
  // key forces a clean remount (and photo reload) per selected instance
  return <SelectionView key={`${inst.id}:${inst.modelId}`} inst={inst} isParametric={def.kind === 'parametric'} params={def.params ?? []} />
}

function SelectionView({
  inst,
  params,
  isParametric,
}: {
  inst: FurnitureInstance
  params: ParamSpec[]
  isParametric: boolean
}) {
  const setParam = useStore((s) => s.setParam)
  const setScale = useStore((s) => s.setScale)
  const resetShape = useStore((s) => s.resetShape)
  const setFurnitureLocked = useStore((s) => s.setFurnitureLocked)
  const pushToast = useUI((s) => s.pushToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [photos, setPhotos] = useRefPhotos(inst)
  const addedPhotoUrls = useRef<string[]>([])
  useEffect(() => () => {
    addedPhotoUrls.current.forEach((url) => URL.revokeObjectURL(url))
    addedPhotoUrls.current = []
  }, [inst.modelId])

  const addPhotos = async (files: File[]) => {
    let n = nextPhotoIndex(photos, inst.id)
    // Own all URLs before async writes, including a selection change mid-save.
    const added = files.map((file) => ({ key: REFPHOTO_KEY(inst.id, n++), url: URL.createObjectURL(file) }))
    addedPhotoUrls.current.push(...added.map((photo) => photo.url))
    for (let i = 0; i < files.length; i++) await set(added[i].key, files[i])
    setPhotos([...photos, ...added])
    pushToast(files.length === 1 ? '已添加参考照片 Reference photo added' : `已添加 ${files.length} 张参考照片 Reference photos added`)
  }

  return (
    <Section title="选中 Selection">
      <div className="sel-name">{inst.label}</div>
      <div className="sel-source">{isParametric ? '内建 built-in' : '导入模型 imported model'}</div>

      <Checkbox
        label="换一换时保留 Keep on shuffle"
        checked={inst.source !== 'generated' || !!inst.locked}
        onChange={(locked) => setFurnitureLocked(inst.id, locked)}
      />
      <p className="caption">手工调整后自动保留。取消勾选可参与重排。<br />Edits are kept. Uncheck to regenerate.</p>

      <div className="lbl" style={{ marginBottom: 5 }}>
        参考照片 Reference photos
      </div>
      {photos.length > 0 && (
        <div className="refphotos">
          {photos.map((p) => (
            <img className="refthumb" key={p.key} src={p.url} alt="参考 reference" />
          ))}
        </div>
      )}
      {photos.length === 0 && (
        <p className="caption" style={{ margin: '0 0 6px' }}>
          暂无参考照片 — 添加一张可引导 AI 出图风格
          <br />
          No reference photo — add one to guide AI renders
        </p>
      )}
      <button type="button" className="btn btn-ghost" style={{ width: '100%' }} onClick={() => fileRef.current?.click()}>
        + 添加参考照片 Add reference photo
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) void addPhotos(files)
          e.target.value = ''
        }}
      />

      {isParametric && params.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {params.map((spec) => {
            const current = inst.params[spec.key] ?? spec.default
            if (spec.kind === 'boolean') {
              return (
                <Checkbox
                  key={spec.key}
                  label={spec.label}
                  checked={current === true}
                  onChange={(v) => setParam(inst.id, spec.key, v)}
                />
              )
            }
            const { unit, digits } = paramDisplay(spec)
            return (
              <NumberInput
                key={spec.key}
                label={spec.label}
                value={typeof current === 'number' ? current : (spec.default as number)}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                digits={digits}
                unit={unit}
                onCommit={(v) => setParam(inst.id, spec.key, v)}
              />
            )
          })}
          <div className="btn-row">
            <GhostButton onClick={() => resetShape(inst.id)}>重置形状 Reset shape</GhostButton>
          </div>
        </div>
      )}

      {!isParametric && (
        <div style={{ marginTop: 10 }}>
          <Slider
            label="缩放 Scale"
            value={Math.round(inst.scale * 100)}
            min={10}
            max={200}
            step={1}
            display={`${Math.round(inst.scale * 100)}%`}
            onChange={(v) => setScale(inst.id, v / 100)}
          />
        </div>
      )}
    </Section>
  )
}
