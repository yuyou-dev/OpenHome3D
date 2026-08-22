import { useEffect, useState, type ReactNode } from 'react'
import { requestView, type ViewPreset } from '../three/runtime'
import { useStore } from '../state/store'
import { useUI } from './uiStore'
import { Checkbox, IconButton } from './components'

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Tiny isometric cube; the dot marks the corner the view looks from. */
function IsoCube({ dot }: { dot: [number, number] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...S}>
      <path d="M8 2 L14 5.5 L8 9 L2 5.5 Z" />
      <path d="M2 5.5 V10.5 L8 14 V9" />
      <path d="M14 5.5 V10.5 L8 14" />
      <circle cx={dot[0]} cy={dot[1]} r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function TopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...S}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 2.5 V13.5 M2.5 8 H13.5" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...S}>
      <path d="M2.5 8.5 L8 3.5 L13.5 8.5" />
      <path d="M4.5 7.5 V12.5 H11.5 V7.5" />
    </svg>
  )
}

function PanIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" {...S}>
      <path d="M8 1.5 V14.5 M1.5 8 H14.5" />
      <path d="M8 1.5 L6 3.5 M8 1.5 L10 3.5" />
      <path d="M8 14.5 L6 12.5 M8 14.5 L10 12.5" />
      <path d="M1.5 8 L3.5 6 M1.5 8 L3.5 10" />
      <path d="M14.5 8 L12.5 6 M14.5 8 L12.5 10" />
    </svg>
  )
}

/** 显示 Display popover: the five structure/visibility toggles, straight onto setStructure. */
function DisplayMenu() {
  const [open, setOpen] = useState(false)
  const cutawayWalls = useStore((s) => s.cutawayWalls)
  const windows = useStore((s) => s.windows)
  const floorSlab = useStore((s) => s.floorSlab)
  const doorLeaves = useStore((s) => s.doorLeaves)
  const showFurniture = useStore((s) => s.showFurniture)
  const setStructure = useStore((s) => s.setStructure)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="display-menu">
      <button
        type="button"
        className={`btn btn-ghost cam-btn${open ? ' open' : ''}`}
        title="显示 Display"
        onClick={() => setOpen(!open)}
      >
        显示 Display <span className="cam-caret">▾</span>
      </button>
      {open && (
        <>
          <div className="display-backdrop" onClick={() => setOpen(false)} />
          <div className="display-pop">
            <Checkbox
              label="剖切墙体 Cutaway"
              checked={cutawayWalls}
              onChange={(v) => setStructure({ cutawayWalls: v })}
            />
            <Checkbox
              label="窗户 Windows"
              checked={windows}
              onChange={(v) => setStructure({ windows: v })}
            />
            <Checkbox
              label="楼板 Floor slab"
              checked={floorSlab}
              onChange={(v) => setStructure({ floorSlab: v })}
            />
            <Checkbox
              label="门扇 Door leaves"
              checked={doorLeaves}
              onChange={(v) => setStructure({ doorLeaves: v })}
            />
            <Checkbox
              label="显示家具 Show furniture"
              checked={showFurniture}
              onChange={(v) => setStructure({ showFurniture: v })}
            />
          </div>
        </>
      )}
    </div>
  )
}

const VIEWS: { preset: ViewPreset; title: string; icon: ReactNode }[] = [
  { preset: 'iso-ne', title: '等距视角 NE · Isometric NE', icon: <IsoCube dot={[13.4, 4.4]} /> },
  { preset: 'iso-nw', title: '等距视角 NW · Isometric NW', icon: <IsoCube dot={[2.6, 4.4]} /> },
  { preset: 'iso-se', title: '等距视角 SE · Isometric SE', icon: <IsoCube dot={[13.4, 11.6]} /> },
  { preset: 'iso-sw', title: '等距视角 SW · Isometric SW', icon: <IsoCube dot={[2.6, 11.6]} /> },
  { preset: 'top', title: '顶视图 Top view', icon: <TopIcon /> },
  { preset: 'reset', title: '重置视角 Reset view', icon: <ResetIcon /> },
]

export default function TopBar() {
  const projection = useStore((s) => s.projection)
  const setProjection = useStore((s) => s.setProjection)
  const panMode = useUI((s) => s.panMode)
  const togglePanMode = useUI((s) => s.togglePanMode)
  return (
    <div className="topbar">
      <div className="tb-right">
        {/* one merged camera bar: view presets · pan mode · projection */}
        <div className="cam-bar">
          {VIEWS.map((v) => (
            <IconButton key={v.preset} title={v.title} onClick={() => requestView(v.preset)}>
              {v.icon}
            </IconButton>
          ))}
          <span className="cam-sep" />
          <IconButton
            title={panMode ? '平移模式:拖动=平移(点击切回旋转) Pan mode on' : '旋转模式:拖动=旋转(点击切到平移) Orbit mode on'}
            className={panMode ? 'active' : undefined}
            onClick={() => togglePanMode()}
          >
            <PanIcon />
          </IconButton>
          <span className="cam-sep" />
          <Checkbox
            label="轴测 ISO"
            checked={projection === 'isometric'}
            onChange={(v) => setProjection(v ? 'isometric' : 'perspective')}
          />
          <span className="cam-sep" />
          <DisplayMenu />
        </div>
      </div>
    </div>
  )
}
