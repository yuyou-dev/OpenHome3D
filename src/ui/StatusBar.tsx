import { floorPieces, polygonArea } from '../gen/architectureGeometry'
import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { homeAABB, roomById, homeForRoomLevel } from '../state/home'
import { subscribeZoomPct } from '../three/runtime'
import { useUI } from './uiStore'
import { IconButton } from './components'

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

const ROT_STEP = Math.PI / 12 // 15°

function RotateLeftIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...S}>
      <path d="M13 8 A5 5 0 1 1 8 3" />
      <path d="M5.6 2.2 L8 3 L6.6 5.2" />
    </svg>
  )
}

function RotateRightIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...S}>
      <path d="M3 8 A5 5 0 1 0 8 3" />
      <path d="M10.4 2.2 L8 3 L9.4 5.2" />
    </svg>
  )
}

function DuplicateIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...S}>
      <rect x="3" y="3" width="7" height="7" />
      <path d="M6 6 h7 v7 h-7" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" {...S}>
      <path d="M3 6 H12 M12 6 L9.7 3.7 M12 6 L9.7 8.3" />
      <path d="M13 10 H4 M4 10 L6.3 7.7 M4 10 L6.3 12.3" />
    </svg>
  )
}

/** Compact 网格 Grid input (cm) appended to the status info line; commits setMoveGrid on blur/Enter. */
function GridInput() {
  const moveGrid = useStore((s) => s.moveGrid)
  const setMoveGrid = useStore((s) => s.setMoveGrid)
  const [text, setText] = useState<string | null>(null)

  const commit = (raw: string) => {
    setText(null)
    const v = parseFloat(raw)
    if (Number.isNaN(v)) return
    const c = Math.min(100, Math.max(1, v))
    if (c !== Math.round(moveGrid * 100)) setMoveGrid(c / 100)
  }

  return (
    <label className="status-grid">
      · 网格 Grid
      <input
        type="number"
        value={text ?? Math.round(moveGrid * 100)}
        min={1}
        max={100}
        step={1}
        onFocus={(e) => setText(e.target.value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
      />
      CM
    </label>
  )
}

export default function StatusBar() {
  const [zoomPct, setZoomPct] = useState(100)
  useEffect(() => subscribeZoomPct(setZoomPct), [])

  const home = useStore((s) => s.home)
  const room = useStore((s) => s.home.rooms.find((r) => r.id === s.activeRoomId) ?? s.home.rooms[0])
  const seed = useStore((s) => s.seed)
  const inst = useStore((s) => s.furniture.find((f) => f.id === s.selectedId))
  const instRoomName = useStore((s) => {
    const f = s.furniture.find((it) => it.id === s.selectedId)
    return f ? (roomById(s.home, f.roomId)?.name ?? '') : ''
  })
  const duplicateFurniture = useStore((s) => s.duplicateFurniture)
  const removeFurniture = useStore((s) => s.removeFurniture)
  const openModal = useUI((s) => s.openModal)

  const roomLabel = room.name.toUpperCase()
  const visibleHome=homeForRoomLevel(home,room.id)
  const bb = homeAABB(visibleHome)
  const totalArea = home.architecture ? visibleHome.architecture!.spaces.filter(s=>s.kind!=='void'&&s.kind!=='ledge').reduce((sum,s)=>sum+floorPieces(s.polygon,home.architecture!.spaces.filter(v=>v.kind==='void'&&v.levelId===s.levelId).map(v=>v.polygon)).reduce((area,p)=>area+polygonArea(p),0),0) : home.rooms.reduce((sum, r) => sum + r.rect.w * r.rect.d, 0)

  const rotate = (dir: 1 | -1) => {
    const s = useStore.getState()
    const f = s.furniture.find((it) => it.id === s.selectedId)
    if (f) s.rotateFurniture(f.id, f.rotationY + dir * ROT_STEP)
  }

  return (
    <div className="statusbar">
      {inst && (
        <>
          <div className="sel-pill">
            <span className="pill-name" title={`${inst.label} · ${instRoomName}`}>
              {inst.label} · {instRoomName.toUpperCase()}
            </span>
            <div className="pill-btns">
              <IconButton title="左转 15° Rotate left" onClick={() => rotate(-1)}>
                <RotateLeftIcon />
              </IconButton>
              <IconButton title="右转 15° Rotate right" onClick={() => rotate(1)}>
                <RotateRightIcon />
              </IconButton>
              <IconButton title="复制 Duplicate" onClick={() => duplicateFurniture(inst.id)}>
                <DuplicateIcon />
              </IconButton>
              <IconButton title="换模 Swap model" onClick={() => openModal({ kind: 'swap' })}>
                <SwapIcon />
              </IconButton>
              <IconButton title="删除 Delete" onClick={() => removeFurniture(inst.id)}>
                ×
              </IconButton>
            </div>
          </div>
          <span className="status-hint">
            拖拽移动 drag · 方向键微调 arrows · A/E 旋转 · 右键平移 right-drag · Alt = 脱离网格 off-grid
          </span>
        </>
      )}
      <div className="status-info">
        {zoomPct}% · {roomLabel} · 整宅 {bb.w.toFixed(2)} × {bb.d.toFixed(2)} M ·{' '}
        {totalArea.toFixed(1)} M² · SEED {seed} <GridInput />
      </div>
    </div>
  )
}
