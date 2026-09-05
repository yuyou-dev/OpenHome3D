import { useEffect, useState } from 'react'
import { useStore, type PlanTab } from '../state/store'
import { ROOM_TYPES } from '../gen/roomTypes'
import { useUI } from './uiStore'
import SelectionPanel from './SelectionPanel'
import HomeTab from './HomeTab'
import ProjectFiles from './ProjectFiles'
import { GhostButton, NumberInput, PrimaryButton, Section, SegmentedTabs, Slider } from './components'

const PLAN_TABS: { value: PlanTab; label: string }[] = [
  { value: 'home', label: '整宅 Home' },
  { value: 'room', label: '房间 Room' },
]

/** 房间 Room tab: edits the ACTIVE room's contents (structure/openings live in the Home tab). */
function RoomTab() {
  const architecture = useStore(s=>s.home.architecture)
  const room = useStore((s) => s.home.rooms.find((r) => r.id === s.activeRoomId) ?? s.home.rooms[0])
  const setRoomType = useStore((s) => s.setRoomType)
  const setRoomRect = useStore((s) => s.setRoomRect)
  const setPlanTab = useStore((s) => s.setPlanTab)
  const newRoom = useStore((s) => s.newRoom)
  const [confirmNew, setConfirmNew] = useState(false)
  const reshuffleFurniture = useStore((s) => s.reshuffleFurniture)
  const wallHeight = useStore((s) => s.wallHeight)
  const setRoomPartition = useStore((s) => s.setRoomPartition)

  const partitionHeight = room.partitionHeight
  const partitionUnit =
    partitionHeight === 0 ? '无 none' : partitionHeight === wallHeight ? '通高 full' : 'm'

  if (architecture) return <>
    <p className="caption">{room.name} · 精确轮廓 Precision outline</p>
    <p className="caption">结构参数请在整宅面板编辑；家具可直接选择、移动和替换。Edit structure in Home; select furniture to move or replace.</p>
    <div className="btn-row"><GhostButton onClick={()=>setPlanTab('home')}>结构参数 Structure</GhostButton><GhostButton onClick={()=>reshuffleFurniture()}>换一换 Shuffle</GhostButton></div>
  </>

  return (
    <>
      {/* label + link already fill the row, so the value wraps to its own line:
          the name ellipsizes (title tooltip) and the link stays whole */}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <span className="row-label">当前房间 Room</span>
        <span
          className="row-value"
          style={{ flex: '1 1 100%', minWidth: 0, justifyContent: 'space-between' }}
        >
          <span
            title={room.name}
            style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {room.name}
          </span>
          <button type="button" className="link-btn" onClick={() => setPlanTab('home')}>
            在整宅中编辑 Edit in Home
          </button>
        </span>
      </div>
      <div className="row">
        <span className="row-label">房间类型 Room type</span>
        <span className="row-value" style={{ flex: 1, maxWidth: 132 }}>
          <select
            className="input"
            value={room.type}
            onChange={(e) => setRoomType(e.target.value)}
          >
            {ROOM_TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <NumberInput
        label="面宽 Width"
        value={room.rect.w}
        min={1.5}
        max={12}
        step={0.05}
        unit="m"
        onCommit={(v) => setRoomRect(room.id, { ...room.rect, w: v })}
      />
      <NumberInput
        label="进深 Depth"
        value={room.rect.d}
        min={1.5}
        max={12}
        step={0.05}
        unit="m"
        onCommit={(v) => setRoomRect(room.id, { ...room.rect, d: v })}
      />
      <NumberInput
        label="隔墙 Partition"
        value={partitionHeight}
        min={0}
        max={5}
        step={0.05}
        unit={partitionUnit}
        onCommit={(v) => setRoomPartition(v)}
      />
      <div className="btn-row">
        <GhostButton onClick={() => setConfirmNew(true)}>新建方案 New plan</GhostButton>
        <GhostButton onClick={() => reshuffleFurniture()}>换一换 Shuffle</GhostButton>
      </div>
      {confirmNew && (
        <div>
          <p className="caption">将替换整宅和家具，可撤销。<br />Replace the entire plan and furniture. Undo is available.</p>
          <div className="btn-row">
            <PrimaryButton onClick={() => { newRoom(); setConfirmNew(false) }}>确认覆盖 Confirm replace</PrimaryButton>
            <GhostButton onClick={() => setConfirmNew(false)}>取消 Cancel</GhostButton>
          </div>
        </div>
      )}
    </>
  )
}

function GitHubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export default function Sidebar() {
  const collapsed = useUI((s) => s.collapsed)
  const openModal = useUI((s) => s.openModal)
  const pushToast = useUI((s) => s.pushToast)
  const selectedId = useStore((s) => s.selectedId)
  const planTab = useStore((s) => s.planTab)
  const setPlanTab = useStore((s) => s.setPlanTab)

  const extras = useStore((s) => s.extras)
  const setExtras = useStore((s) => s.setExtras)

  const structureNotice = useStore(s => s.structureNotice)
  const dismissStructureNotice = useStore(s => s.dismissStructureNotice)
  useEffect(() => {
    if (!structureNotice) return
    pushToast(structureNotice)
    dismissStructureNotice()
  }, [structureNotice, pushToast, dismissStructureNotice])

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-inner">
        <div className="sb-header">
          <img className="sb-logo" src={`${import.meta.env?.BASE_URL ?? '/'}brand/logo-header.webp`} alt="家居生成器 logo" />
          <span className="sb-title">家居生成器</span>
          <span className="sb-axo">Cartoon</span>
          <a
            className="icon-btn sb-github"
            href="https://github.com/yuyou-dev/OpenHome3D"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub 仓库 Repository"
          >
            <GitHubIcon />
          </a>
        </div>

        {selectedId && <SelectionPanel />}

        <Section title="方案 Plan" collapsible>
          <div style={{ marginBottom: 10 }}>
            <SegmentedTabs options={PLAN_TABS} value={planTab} onChange={setPlanTab} />
          </div>
          {planTab === 'room' && <RoomTab />}
          {planTab === 'home' && <HomeTab />}
        </Section>

        <Section title="家具 Furniture" collapsible>
          <Slider
            label="装饰密度 Extras"
            value={extras}
            min={0}
            max={100}
            step={1}
            display={`${extras}%`}
            onChange={setExtras}
          />
          <div className="btn-row">
            <GhostButton onClick={() => openModal({ kind: 'add' })}>+ 添加家具 Add furniture</GhostButton>
          </div>
        </Section>

        <ProjectFiles />

        <a
          className="link-btn sb-feedback"
          href="https://github.com/yuyou-dev/OpenHome3D/issues/new/choose"
          target="_blank"
          rel="noopener noreferrer"
        >
          反馈 Feedback ↗
        </a>
      </div>
    </aside>
  )
}
