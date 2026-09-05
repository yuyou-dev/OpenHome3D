import PlanDialog from './PlanDialog'
import ArchitecturePanel, { PlanReview } from './ArchitecturePanel'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../state/store'
import { useUI } from './uiStore'
import { HOME_TEMPLATES } from '../gen/templates'
import { ROOM_TYPES, getRoomType } from '../gen/roomTypes'
import { planJsonToHome, type ImportReport } from '../gen/importPlan'
import { aiStatus, cancelAiTask, downscaleImageToPng, understandPlan } from '../lib/ai'
import {
  roomById,
  openingIntervals,
  sharedSpan,
  sideSpan,
  type HomeDef,
  type Opening,
  type RoomDef,
  type Side,
} from '../state/home'
import { OPENING_KIND_LABELS, openingKindLabel, SIDE_LABELS } from './labels'
import { Checkbox, GhostButton, IconButton, NumberInput, PrimaryButton, Row, Section, Slider } from './components'

const SIDES: Side[] = ['n', 's', 'e', 'w']
const OPPOSITE: Record<Side, Side> = { n: 's', s: 'n', e: 'w', w: 'e' }

// mini cards follow the project's card DNA: 2px ink border, no radius
const cardStyle: CSSProperties = {
  border: '2px solid var(--ink)',
  borderRadius: 0,
  background: '#fff',
  padding: '6px 8px',
  marginTop: 6,
}

const miniBtnStyle: CSSProperties = {
  padding: '2px 8px',
  fontSize: 11,
  whiteSpace: 'nowrap',
}

/** Template picker + two-step apply: the first click arms a ~3s "confirm replace" state. */
function TemplateRow() {
  const newHome = useStore((s) => s.newHome)
  const [templateId, setTemplateId] = useState(HOME_TEMPLATES[0].id)
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const apply = () => {
    if (!confirming) {
      setConfirming(true)
      timer.current = setTimeout(() => setConfirming(false), 3000)
      return
    }
    if (timer.current) clearTimeout(timer.current)
    setConfirming(false)
    newHome(templateId)
  }

  return (
    // the label sits on its own line so the select keeps a usable width;
    // the Apply button never shrinks (in the confirm state it wraps below)
    <div className="row" style={{ flexWrap: 'wrap' }}>
      <span className="row-label">模板 Template</span>
      <span className="row-value" style={{ flex: '1 1 100%', minWidth: 0, flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ flex: '1 1 120px', minWidth: 0, width: 'auto' }}
          value={templateId}
          onChange={(e) => {
            setTemplateId(e.target.value)
            setConfirming(false)
          }}
        >
          {HOME_TEMPLATES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {confirming ? (
          <PrimaryButton style={{ ...miniBtnStyle, flexShrink: 0 }} onClick={apply}>
            确认覆盖? Confirm replace
          </PrimaryButton>
        ) : (
          <GhostButton style={{ ...miniBtnStyle, flexShrink: 0 }} onClick={apply}>
            应用 Apply
          </GhostButton>
        )}
      </span>
    </div>
  )
}

/** Pick → blocking, cancellable recognition → review draft → atomic import. */
function ImportRow() {
  const importHome = useStore((s) => s.importHome)
  const pushToast = useUI((s) => s.pushToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0) // invalidates preparation, recognition and queued status replies
  const blockingKindRef = useRef<'understand' | 'render'>('understand')
  const pollRef = useRef<number | null>(null)
  const imgRef = useRef<string | null>(null) // image waiting for a free slot
  const startRef = useRef(0) // running: our start; queued: other task's busySince
  const [phase, setPhase] = useState<'idle' | 'running' | 'queued'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [importError, setImportError] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    home: HomeDef
    report: ImportReport
    rooms: number
    w: number
    d: number
    dataUrl: string
  } | null>(null)

  // elapsed-seconds ticker (running: our task; queued: the blocking task)
  useEffect(() => {
    if (phase === 'idle') return
    const t = setInterval(
      () => setElapsed(Math.max(0, Math.floor((Date.now() - startRef.current) / 1000))),
      1000,
    )
    return () => clearInterval(t)
  }, [phase])

  const stopPolling = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // abort an in-flight recognition + stop queue polling if the tab unmounts
  useEffect(
    () => () => {
      generationRef.current += 1
      abortRef.current?.abort()
      stopPolling()
    },
    [],
  )

  const reset = () => {
    generationRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    stopPolling()
    imgRef.current = null
    setPhase('idle')
    setElapsed(0)
    setPending(null)
    setImportError(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const recognize = async (dataUrl: string) => {
    const generation = generationRef.current
    const ctrl = new AbortController()
    abortRef.current = ctrl
    startRef.current = Date.now()
    setElapsed(0)
    setPhase('running')
    const res = await understandPlan(dataUrl, ctrl.signal)
    if (generation !== generationRef.current) return
    abortRef.current = null
    if (!res.ok) {
      if (res.error === 'cancelled') {
        reset() // user aborted: silent (the server kills codex on disconnect)
        return
      }
      if (res.code === 'busy') {
        // single-flight slot held by another (possibly stale) task → queue:
        // poll status, auto-start once it frees
        startRef.current = res.startedAt ?? Date.now()
        blockingKindRef.current = res.kind ?? 'understand'
        setPhase('queued')
        stopPolling()
        let polling = false
        pollRef.current = window.setInterval(() => {
          if (polling) return
          polling = true
          void aiStatus().then((st) => {
            polling = false
            if (generation !== generationRef.current || !st) return
            if (st.busy) {
              if (st.busyKind) blockingKindRef.current = st.busyKind
              if (st.busySince) startRef.current = st.busySince
              return
            }
            stopPolling()
            const img = imgRef.current
            if (img) void recognize(img)
          })
        }, 2000)
        return
      }
      reset()
      if (res.code === 'auth') {
        pushToast('codex 未登录,请在终端运行 codex login / codex CLI not logged in')
      } else if (res.code === 'cancelled') {
        pushToast('识别任务被中止 Recognition was killed')
      } else {
        pushToast(res.error)
      }
      return
    }
    setPhase('idle')
    try {
      const {home,report}=planJsonToHome(res.plan)
      const xs=home.rooms.flatMap(r=>[r.rect.x-r.rect.w/2,r.rect.x+r.rect.w/2])
      const zs=home.rooms.flatMap(r=>[r.rect.z-r.rect.d/2,r.rect.z+r.rect.d/2])
      setPending({home,report,rooms:home.rooms.length,w:Math.max(...xs)-Math.min(...xs),d:Math.max(...zs)-Math.min(...zs),dataUrl})
    } catch(err) { reset();pushToast(`解析校验失败 Validation failed: ${err instanceof Error?err.message:String(err)}`) }

  }

  const onFile = async (file: File | undefined) => {
    if (!file || phase !== 'idle' || import.meta.env.PROD) return
    const generation = ++generationRef.current
    startRef.current = Date.now()
    setElapsed(0)
    setPhase('running')
    const dataUrl = await downscaleImageToPng(file, 1600)
    if (generation !== generationRef.current) return
    if (!dataUrl) {
      reset()
      pushToast('无法读取图片 Cannot read image')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    imgRef.current = dataUrl
    void recognize(dataUrl)
  }

  const killPrevious = () => {
    void cancelAiTask(blockingKindRef.current).then((killed) =>
      pushToast(killed ? '已中止上一任务 Previous task killed' : '上一任务已结束 Nothing to kill'),
    )
  }

  const apply = () => {
    if (!pending) return
    try {
      const { home, report } = pending
      importHome(home, pending.dataUrl)
      const dropped = report.roomsDropped + report.doorsDropped + report.windowsDropped
      pushToast(
        `已导入 ${report.roomsApplied} 房间/${report.doorsApplied} 门/${report.windowsApplied} 窗 Imported` +
          (dropped > 0 ? `,丢弃 ${dropped} dropped` : ''),
      )
    } catch (err) {
      setImportError(`导入失败 Import failed: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    reset()
  }

  return (
    <div style={{ padding: '3px 0' }}>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" style={{ display: 'none' }}
        onChange={(e) => void onFile(e.target.files?.[0])}/>
      {import.meta.env.PROD && <p className="caption">本机运行可用：npm run dev + codex login<br />AI import is available in the local dev server.</p>}
      <div className="btn-row"><GhostButton style={miniBtnStyle} disabled={import.meta.env.PROD} onClick={() => fileRef.current?.click()}>
        导入户型图 Import plan
      </GhostButton></div>
      {pending ? <PlanReview plan={pending.home.architecture} home={pending.home} image={pending.dataUrl}
        summary={`识别到 ${pending.rooms} 个空间 · ${pending.w.toFixed(1)}×${pending.d.toFixed(1)} m`}
        warnings={pending.report.warnings} error={importError} onClose={reset} onImport={apply}/>
      : phase !== 'idle' && <PlanDialog compact title="识别户型 · 1 / 3 Recognize plan" label="户型识别 Plan recognition" onDismiss={reset}
        actions={<><GhostButton onClick={reset}>放弃识别 Cancel</GhostButton>{phase==='queued'&&<GhostButton title="中止上一 AI 任务后开始识别 End the previous AI task" onClick={killPrevious}>中止 Kill</GhostButton>}</>}>
        <div className="plan-recognition" aria-busy="true">
          <span className="plan-recognition-spinner" aria-hidden="true"/>
          <p role="status">{phase==='queued'?'排队中 Queued…':'正在识别户型 Recognizing…'}</p>
          <p className="plan-recognition-time">{phase==='queued'?'上一任务已运行':'已等待'} {elapsed} 秒</p>
          <p className="caption">{phase==='queued'?'正在等待上一 AI 任务结束，随后自动识别。Waiting for the previous task.':'正在读取墙线、门窗和空间位置，复杂户型可能需要几分钟。Reading walls, openings and rooms; complex plans can take several minutes.'}</p>
          <p className="caption">请在此等待，完成后自动进入原图与解析核对。可随时放弃，当前方案保持不变。Review opens automatically when ready. Cancel to keep your current plan.</p>
        </div>
      </PlanDialog>}
    </div>
  )
}

/** One opening owned by the active room: kind select / offset slider / width / delete. */
function OpeningCard({ room, opening }: { room: RoomDef; opening: Opening }) {
  const home = useStore((s) => s.home)
  const updateOpening = useStore((s) => s.updateOpening)
  const removeOpening = useStore((s) => s.removeOpening)
  const selected = useStore((s) => s.selectedOpeningId === opening.id)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  const intervals = openingIntervals(home, opening)
  const [from, to] = intervals.find(([lo, hi]) => opening.offset >= lo && opening.offset <= hi) ?? [0, sideSpan(room, opening.side).length]
  const span = to - from
  const canGap = opening.kind === 'open'
  return (
    <div ref={ref} style={selected ? { ...cardStyle, outline: '2px solid var(--select)' } : cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <select
          className="input"
          style={{ flex: 1, minWidth: 0 }}
          value={opening.kind}
          onChange={(e) => {
            const kind = e.target.value as Opening['kind']
            // fullHeight only means anything for 'open' — drop the stale flag otherwise
            updateOpening(opening.id, kind === 'open' ? { kind } : { kind, fullHeight: undefined })
          }}
        >
          {(['door', 'open', 'window'] as const).map((k) => (
            <option key={k} value={k}>
              {OPENING_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <span className="caption">{SIDE_LABELS[opening.side]}</span>
        <IconButton title="删除 Delete" onClick={() => removeOpening(opening.id)}>
          ×
        </IconButton>
      </div>
      {canGap && (
        <div style={{ marginTop: 4 }}>
          <Checkbox
            label={
              opening.b === 'exterior'
                ? '阳台护栏 Balcony parapet'
                : '通高打通 Full-height opening'
            }
            checked={!!opening.fullHeight}
            onChange={(v) => updateOpening(opening.id, { fullHeight: v })}
          />
        </div>
      )}
      <Slider
        label="位置 Offset"
        value={opening.offset}
        min={from + opening.width / 2}
        max={Math.max(from + opening.width / 2, to - opening.width / 2)}
        step={0.05}
        display={`${opening.offset.toFixed(2)} m`}
        onChange={(v) => updateOpening(opening.id, { offset: v })}
      />
      <NumberInput
        label="宽度 Width"
        value={opening.width}
        min={0.3}
        max={opening.fullHeight ? span : Math.min(span, 2.4)}
        step={0.05}
        unit="m"
        onCommit={(v) => updateOpening(opening.id, { width: v })}
      />
    </div>
  )
}

/** Read-only card for an opening declared by a neighbor room on a shared wall. */
function MirroredCard({ home, opening }: { home: HomeDef; opening: Opening }) {
  const selected = useStore((s) => s.selectedOpeningId === opening.id)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div
      ref={ref}
      style={{
        ...cardStyle,
        opacity: 0.65,
        ...(selected ? { outline: '2px solid var(--select)' } : null),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{openingKindLabel(opening)}</span>
        <span className="caption">{SIDE_LABELS[OPPOSITE[opening.side]]}</span>
        <span style={{ flex: 1 }} />
        <span className="caption">{opening.width.toFixed(2)} m</span>
      </div>
      <div className="caption">
        由{roomById(home, opening.a)?.name ?? opening.a}声明 Declared by{' '}
        {roomById(home, opening.a)?.name ?? opening.a}
      </div>
    </div>
  )
}

/** 整宅 Home tab: templates, plan import, wall height, room list, and the active room's openings. */
export default function HomeTab() {
  const home = useStore((s) => s.home)
  const activeRoomId = useStore((s) => s.activeRoomId)
  const selectRoom = useStore((s) => s.selectRoom)
  const addRoom = useStore((s) => s.addRoom)
  const removeRoom = useStore((s) => s.removeRoom)
  const addOpening = useStore((s) => s.addOpening)
  const wallHeight = useStore((s) => s.wallHeight)
  const setStructure = useStore((s) => s.setStructure)
  const [newType, setNewType] = useState('bedroom')

  const room = roomById(home, activeRoomId) ?? home.rooms[0]
  const own = room ? home.openings.filter((o) => o.a === room.id) : []
  const mirrored = room ? home.openings.filter((o) => o.b === room.id) : []

  const addOnSide = (side: Side, kind: 'door' | 'window' | 'gap') => {
    if (!room) return
    const neighbor = home.rooms.find((r) => r.id !== room.id && sharedSpan(room, r)?.side === side)
    if (kind === 'gap') {
      // interior side: 打通 — full-height opening across the shared interval
      // (no wall there). exterior side: 阳台开口 — the wall across the span
      // becomes a railing-height parapet.
      const sh = neighbor && sharedSpan(room, neighbor)
      if (neighbor && sh && sh.side === side) {
        addOpening({
          kind: 'open',
          a: room.id,
          b: neighbor.id,
          side,
          offset: (sh.from + sh.to) / 2,
          width: sh.to - sh.from,
          fullHeight: true,
        })
      } else if (!neighbor) {
        const len = sideSpan(room, side).length
        addOpening({
          kind: 'open',
          a: room.id,
          b: 'exterior',
          side,
          offset: len / 2,
          width: len,
          fullHeight: true,
        })
      }
      return
    }
    addOpening({
      kind,
      a: room.id,
      b: kind === 'window' ? 'exterior' : (neighbor?.id ?? 'exterior'),
      side,
      offset: sideSpan(room, side).length / 2,
      width: kind === 'window' ? 1.2 : 0.9,
    })
  }

  if (home.architecture) return <><TemplateRow/><ImportRow/><ArchitecturePanel/></>

  return (
    <>
      <TemplateRow />
      <ImportRow />
      <NumberInput
        label="墙高 Wall height"
        value={wallHeight}
        min={2}
        max={5}
        step={0.05}
        unit="m"
        onCommit={(v) => setStructure({ wallHeight: v })}
      />

      <div className="lib-group">
        <div className="lbl" style={{ marginBottom: 4 }}>
          房间 Rooms
        </div>
        {home.rooms.map((r) => {
          const active = room?.id === r.id
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => selectRoom(r.id)}
              className={`room-item${active ? ' active' : ''}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span>{r.name}</span>
                <span className="caption">{(r.rect.w * r.rect.d).toFixed(1)} m²</span>
              </div>
              <div className="caption">
                {getRoomType(r.type).label} · {r.rect.w.toFixed(2)} × {r.rect.d.toFixed(2)} m
              </div>
            </button>
          )
        })}
        {/* select gets the full row so long bilingual type labels fit;
            the add button sits on its own row (matches 删除房间 below) */}
        <div className="row">
          <span className="row-value" style={{ flex: 1, minWidth: 0 }}>
            <select
              className="input"
              style={{ flex: 1, minWidth: 0 }}
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
            >
              {ROOM_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </span>
        </div>
        <div className="btn-row">
          <GhostButton onClick={() => addRoom(newType)}>+ 添加房间 Add room</GhostButton>
        </div>
        <div className="btn-row">
          <GhostButton
            disabled={home.rooms.length <= 1}
            title={
              home.rooms.length <= 1 ? '至少保留一个房间 Keep at least one room' : undefined
            }
            onClick={() => room && removeRoom(room.id)}
          >
            删除房间 Delete room
          </GhostButton>
        </div>
      </div>

      {room && (
        <Section title="门窗 Openings" collapsible right={`· ${room.name}`}>
          {SIDES.map((side) => {
            const hasNeighbor = home.rooms.some(
              (r) => r.id !== room.id && sharedSpan(room, r)?.side === side
            )
            return (
              <Row key={side} label={SIDE_LABELS[side]}>
                {/* inner wrapper: three bilingual mini buttons don't fit one
                    line, so they wrap instead of spilling past the sidebar */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end' }}>
                  <GhostButton style={miniBtnStyle} onClick={() => addOnSide(side, 'door')}>
                    + 门 Door
                  </GhostButton>
                  <GhostButton style={miniBtnStyle} onClick={() => addOnSide(side, 'window')}>
                    + 窗 Window
                  </GhostButton>
                  {hasNeighbor ? (
                    <GhostButton style={miniBtnStyle} onClick={() => addOnSide(side, 'gap')}>
                      + 打通 Open up
                    </GhostButton>
                  ) : (
                    <GhostButton
                      style={miniBtnStyle}
                      title="外墙变护栏半墙 Railing parapet instead of a full wall"
                      onClick={() => addOnSide(side, 'gap')}
                    >
                      + 阳台 Balcony
                    </GhostButton>
                  )}
                </div>
              </Row>
            )
          })}
          {own.map((o) => (
            <OpeningCard key={o.id} room={room} opening={o} />
          ))}
          {mirrored.map((o) => (
            <MirroredCard key={o.id} home={home} opening={o} />
          ))}
          {own.length === 0 && mirrored.length === 0 && (
            <p className="hint">该房间还没有门窗 No openings on this room yet.</p>
          )}
        </Section>
      )}
    </>
  )
}
