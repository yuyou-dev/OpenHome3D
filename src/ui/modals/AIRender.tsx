import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider'
import { useStore } from '../../state/store'
import { captureFittedScreenshot, captureScreenshot, captureUnbiasedScreenshot } from '../../three/runtime'
import { useUI } from '../uiStore'
import { GhostButton, IconButton, PrimaryButton } from '../components'
import {
  aiRender,
  aiStatus,
  collectReferencePhotos,
  historyAdd,
  historyImage,
  historyList,
  historyRemove,
  nearestAspect,
  type AiStatus,
  type RenderMeta,
} from '../../lib/ai'
import { PRESET_GROUPS, presetFragments, presetLabel } from '../../lib/aiPresets'

const DEFAULT_PROMPT =
  'Transform this stylized 3D cartoon room preview into a photorealistic interior photograph. ' +
  'STRICTLY preserve the exact camera angle and framing — same margins around the home, no cropping, no zooming, no recomposing — ' +
  'the room shell (walls, window and door positions and sizes), ' +
  'and the number, type, position, orientation and proportions of every furniture piece — do not add, remove, move or substitute anything. ' +
  'Only re-materialize into realistic finishes: fabric upholstery with visible weave, real wood grain, matte painted walls, ' +
  'brushed metal and frosted glass where they fit (use the attached reference photos for the materials, colours and style of the furniture). ' +
  'Natural soft daylight through the windows, believable indoor photography, gentle shadows, lived-in cozy mood, high quality render.'

const FORMATS: { id: string; label: string }[] = [
  { id: 'match view', label: '跟随视图 Match view' },
  { id: '3:2', label: '横版 Landscape 3:2' },
  { id: '1:1', label: '方版 Square 1:1' },
  { id: '2:3', label: '竖版 Portrait 2:3' },
]

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

/** Pixel dimensions of a data-URL image. */
function dataUrlSize(dataUrl: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = dataUrl
  })
}

/**
 * Center-crop a data-URL image to an exact aspect ("3:2"), flattened onto the
 * app's paper color. Two reasons: the cropped frame is what we send to the
 * image model AND what the compare slider shows as the 3D side (same ratio
 * and framing), and the canvas captures with alpha — a transparent surround
 * reaches the model as a black void, which invites it to crop/zoom into the
 * room and comes back as black background in the render.
 */
async function cropToAspect(dataUrl: string, aspect: string): Promise<string> {
  const [aw, ah] = aspect.split(':').map(Number)
  const dims = await dataUrlSize(dataUrl)
  if (!dims || !aw || !ah) return dataUrl
  const target = aw / ah
  const src = dims.w / dims.h
  let sw = dims.w
  let sh = dims.h
  if (Math.abs(src - target) >= 0.005) {
    if (src > target) sw = Math.round(dims.h * target)
    else sh = Math.round(dims.w / target)
  }
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) return dataUrl
  ctx.fillStyle = paperColor()
  ctx.fillRect(0, 0, sw, sh)
  ctx.drawImage(img, (dims.w - sw) / 2, (dims.h - sh) / 2, sw, sh, 0, 0, sw, sh)
  return canvas.toDataURL('image/png')
}

/** The app's paper backdrop color (--paper token), so API inputs match the on-screen canvas. */
function paperColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fbf3e4'
}

/** History thumbnail: loads its image from IndexedDB lazily. */
function HistoryThumb({ meta, active, onPick }: { meta: RenderMeta; active: boolean; onPick: () => void }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let ok = true
    void historyImage(meta.id).then((u) => {
      if (ok) setSrc(u)
    })
    return () => {
      ok = false
    }
  }, [meta.id])
  return (
    <button type="button" className={`ai-hist-item${active ? ' active' : ''}`} onClick={onPick}>
      {src ? <img src={src} alt={`render ${new Date(meta.ts).toLocaleString()}`} /> : <span className="ai-hist-ph" />}
      <span className="ai-hist-meta">
        {(meta.durationMs / 1000).toFixed(1)} s · {meta.aspect}
      </span>
    </button>
  )
}

export default function AIRender() {
  const closeModal = useUI((s) => s.closeModal)
  const pushToast = useUI((s) => s.pushToast)
  const furniture = useStore((s) => s.furniture)
  const seed = useStore((s) => s.seed)

  const [shot, setShot] = useState<string | null>(null)
  /** view frame cropped to the render's aspect — API input and 3D compare side */
  const [compareShot, setCompareShot] = useState<string | null>(null)
  const [result, setResult] = useState<{ image: string; meta: RenderMeta } | null>(null)
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [format, setFormat] = useState('match view')
  /** 'fit' = zoom the room to fill the frame; 'editor' = capture the editor as-is */
  const [framing, setFraming] = useState<'fit' | 'editor'>('fit')
  const [presets, setPresets] = useState<Record<string, string>>({})
  const [rendering, setRendering] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [history, setHistory] = useState<RenderMeta[]>([])
  const [photoCount, setPhotoCount] = useState(0)
  const [refPhotos, setRefPhotos] = useState<string[]>([])
  const [lightbox, setLightbox] = useState(false)
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit')
  const abortRef = useRef<AbortController | null>(null)

  const model = status?.model ?? 'codex image_gen'
  const canRender = !!shot && !rendering && !!status?.codex?.available && !status?.busy

  // capture the current 3D view once when the modal opens
  // (drop any selection first so the blue highlight doesn't end up in the shot)
  useEffect(() => {
    useStore.getState().select(null)
    const t = requestAnimationFrame(() => setShot(captureScreenshot()))
    return () => cancelAnimationFrame(t)
  }, [])

  // status + history + reference photos on open
  useEffect(() => {
    let alive = true
    void aiStatus().then((s) => {
      if (alive) setStatus(s)
    })
    void historyList().then((h) => {
      if (alive) setHistory(h)
    })
    void collectReferencePhotos(furniture).then(({ count, images }) => {
      if (!alive) return
      setPhotoCount(count)
      setRefPhotos(images)
    })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const typeCount = new Set(furniture.map((f) => f.modelId)).size
  const current = result?.image ?? shot
  const currentIsRender = !!result

  const onRender = async () => {
    if (!shot || rendering) return
    setError(null)
    setRendering(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // aspect + view frame. Best-fit re-frames the camera so the room fills the
    // image at the target ratio; editor mode captures the viewport as-is.
    // Both paths drop the editor's -10% framing bias (the image model centers
    // the subject on its own — a biased input guarantees a mismatched render),
    // and fit mode picks the aspect BEFORE framing so the post-crop never clips.
    let aspect: string
    let frame: string | null
    if (framing === 'fit') {
      if (format === 'match view') {
        const probeDims = shot ? await dataUrlSize(shot) : null
        aspect = nearestAspect(probeDims?.w ?? 4, probeDims?.h ?? 3)
      } else {
        aspect = format
      }
      const [aw, ah] = aspect.split(':').map(Number)
      frame = await captureFittedScreenshot(aw / ah)
    } else {
      const dims = shot ? await dataUrlSize(shot) : null
      aspect = format === 'match view' ? nearestAspect(dims?.w ?? 4, dims?.h ?? 3) : format
      frame = (await captureUnbiasedScreenshot()) ?? shot
    }
    if (!frame) {
      setRendering(false)
      setError('could not capture the 3D view')
      return
    }
    // crop the view frame to the exact render aspect — the AI output then
    // matches the 3D side 1:1 in ratio and framing
    const cropped = await cropToAspect(frame, aspect)
    setCompareShot(cropped)
    // style presets are prompt-driven: fragments append AFTER the base prompt,
    // so the structure lock stays intact
    const fragments = presetFragments(presets)
    const finalPrompt = fragments.length
      ? `${prompt.trim()}\n\n${fragments.join('\n')}`
      : prompt
    const res = await aiRender({
      prompt: finalPrompt,
      image: cropped,
      images: refPhotos,
      aspect,
      signal: ctrl.signal,
    })
    setRendering(false)
    abortRef.current = null
    if (!res.ok) {
      if (res.code === 'busy') setError('另一个 codex 任务进行中,请稍候 Another codex task is running…')
      else if (res.error !== 'cancelled') setError(res.error)
      return
    }
    const meta: RenderMeta = {
      id: `r${Date.now().toString(36)}`,
      ts: Date.now(),
      model: res.model,
      aspect: res.aspect,
      durationMs: res.durationMs,
      seed,
      presets: PRESET_GROUPS.map((g) => presetLabel(g.id, presets[g.id]))
        .filter(Boolean)
        .map((l) => (l as string).split(' ')[0]),
    }
    setResult({ image: res.image, meta })
    setError(null)
    void historyAdd(meta, res.image).then(setHistory)
    pushToast(`完成 Done · ${(res.durationMs / 1000).toFixed(1)} s`)
  }

  const onCancel = () => {
    abortRef.current?.abort()
    setRendering(false)
    pushToast('已取消 Cancelled')
  }

  const onCopy = async () => {
    if (!current) return
    try {
      const blob = await (await fetch(current)).blob()
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      pushToast('已复制到剪贴板 Copied to clipboard')
    } catch {
      pushToast('复制失败 — 剪贴板不可用 Copy failed')
    }
  }

  const onDelete = () => {
    if (result) {
      void historyRemove(result.meta.id).then(setHistory)
      setResult(null)
      setCompareShot(null)
      pushToast('效果图已删除 Render deleted')
    } else if (shot) {
      setShot(null)
    }
  }

  const openHistoryItem = (meta: RenderMeta) => {
    void historyImage(meta.id).then((u) => {
      if (u) setResult({ image: u, meta })
    })
  }

  return (
    <div className="ai-panel" data-modal="">
      <div className="modal-head">
        <span className="modal-title">AI 渲染 AI render</span>
        <span className="tag">{model}</span>
        <span style={{ flex: 1 }} />
        <IconButton title="Close" onClick={() => closeModal()}>
          ×
        </IconButton>
      </div>

      <div className="ai-cols">
        <div className="ai-history">
          <span className="lbl">历史 History · {history.length}</span>
          {history.length === 0 && <p className="hint">暂无效果图 No renders yet</p>}
          {history.map((m) => (
            <HistoryThumb key={m.id} meta={m} active={result?.meta.id === m.id} onPick={() => openHistoryItem(m)} />
          ))}
        </div>

        <div className="ai-center">
          <div className="ai-canvas">
            {result && !rendering ? (
              <div
                className="ai-compare"
                style={{ '--ar': result.meta.aspect.replace(':', '/') } as CSSProperties}
              >
                <span className="cmp-tag left">3D view</span>
                <span className="cmp-tag right">AI render</span>
                <ReactCompareSlider
                  itemOne={
                    <ReactCompareSliderImage
                      src={compareShot ?? shot ?? ''}
                      alt="3D view"
                      style={{ objectFit: 'contain', background: '#fff' }}
                    />
                  }
                  itemTwo={
                    <ReactCompareSliderImage
                      src={result.image}
                      alt="AI render"
                      style={{ objectFit: 'contain', background: '#fff' }}
                    />
                  }
                />
              </div>
            ) : current ? (
              <>
                <img src={current} alt={currentIsRender ? 'AI render' : 'current 3D view'} />
                <span className="cmp-tag-render">{currentIsRender ? 'AI render' : '3D view'}</span>
              </>
            ) : (
              <span className="ai-placeholder">效果图将在这里显示 Your render will appear here</span>
            )}
            {rendering && (
              <>
                <div className="shimmer">
                  <div className="shimmer-bar" />
                </div>
                <span className="rendering-note">渲染中 Rendering with {model}…</span>
                <button type="button" className="rendering-cancel" onClick={onCancel}>
                  取消 Cancel
                </button>
              </>
            )}
          </div>
          {result && (
            <div className="ai-meta">
              {result.meta.model} · {result.meta.aspect} · {(result.meta.durationMs / 1000).toFixed(1)} s ·{' '}
              {photoCount} refs · seed {result.meta.seed}
              {result.meta.presets && result.meta.presets.length > 0 && (
                <> · {result.meta.presets.join(' / ')}</>
              )}
            </div>
          )}
          <div className="ai-actions">
            <GhostButton disabled={!current} onClick={() => setLightbox(true)}>
              全屏 Full size
            </GhostButton>
            <GhostButton
              disabled={!current}
              onClick={() => current && download(current, `home-generator-cartoon-${currentIsRender ? 'render' : '3dview'}.png`)}
            >
              下载 Download
            </GhostButton>
            <GhostButton disabled={!current} onClick={() => void onCopy()}>
              复制 Copy
            </GhostButton>
            <GhostButton disabled={!current} onClick={onDelete}>
              删除 Delete
            </GhostButton>
          </div>
        </div>

        <div className="ai-right">
          {status === null && (
            <div className="ai-warn">
              本机功能:AI 渲染需要在本地运行(npm run dev)并登录 codex(codex login);线上 demo 没有 AI
              后端。Local-only: the AI render needs the local dev server with codex logged in — the
              online demo has no AI backend.
            </div>
          )}
          {status && !status.codex?.available && (
            <div className="ai-warn">
              {status.codex?.reason?.includes('not found')
                ? '未检测到 codex CLI — 请先安装(npm i -g @openai/codex)。codex CLI not found on PATH.'
                : 'codex 未登录 — 请在终端运行 codex login 后重试。Not logged in — run: codex login.'}
            </div>
          )}
          {error && <div className="ai-warn error">{error}</div>}

          <div className="form-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="lbl">提示词 Prompt</span>
              <button type="button" className="reset-link" onClick={() => setPrompt(DEFAULT_PROMPT)}>
                ↺ default
              </button>
            </div>
            <textarea
              className="input"
              rows={8}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <div className="form-row">
            <span className="lbl">模型 Model</span>
            <select className="input" disabled>
              <option>codex · image_gen</option>
            </select>
            <span className="caption">
              本机 codex CLI 出图(ChatGPT 登录态,无需 API key) Runs on the local codex CLI
            </span>
          </div>

          <div className="form-row">
            <span className="lbl">比例 Format</span>
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
              {FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <span className="lbl">取景 Framing</span>
            <select
              className="input"
              value={framing}
              onChange={(e) => setFraming(e.target.value as 'fit' | 'editor')}
            >
              <option value="fit">最佳取景 Best fit — 房间充满画面</option>
              <option value="editor">编辑区视角 Editor view — 按当前画面</option>
            </select>
            <span className="caption">
              最佳取景让房间在画面中更大,结构锁定更稳 Best fit locks structure much better
            </span>
          </div>

          <div className="form-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="lbl">风格预设 Style presets</span>
              <span className="caption">追加到提示词 appended to prompt</span>
            </div>
            <div className="preset-grid">
              {PRESET_GROUPS.map((g) => (
                <label key={g.id} className="preset-item">
                  <span className="preset-label">{g.label}</span>
                  <select
                    className="input"
                    value={presets[g.id] ?? 'none'}
                    onChange={(e) => setPresets((p) => ({ ...p, [g.id]: e.target.value }))}
                  >
                    {g.options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>

          <span className="caption">
            {photoCount} 张参考照片 reference photos · {typeCount} 类物品 object types in view
          </span>

          <div style={{ marginTop: 'auto' }}>
            {!!status?.busy && !rendering && (
              <span className="caption">
                另一个 codex 任务进行中,结束后即可渲染 A codex task is running — render unlocks when it
                finishes
              </span>
            )}
            <PrimaryButton
              style={{ width: '100%', padding: '12px 10px' }}
              disabled={!canRender}
              onClick={() => void onRender()}
            >
              {rendering ? '渲染中… Rendering…' : '生成效果图 Render image'}
            </PrimaryButton>
          </div>
        </div>
      </div>

      {lightbox && current && (
        <div className="lightbox" data-modal="">
          <div className="lb-controls">
            <GhostButton onClick={() => setZoom('fit')} disabled={zoom === 'fit'}>
              适配 Fit
            </GhostButton>
            <GhostButton onClick={() => setZoom('full')} disabled={zoom === 'full'}>
              100%
            </GhostButton>
            <GhostButton onClick={() => download(current, `home-generator-cartoon-${currentIsRender ? 'render' : '3dview'}.png`)}>
              下载 Download
            </GhostButton>
            <GhostButton onClick={() => setLightbox(false)}>×</GhostButton>
          </div>
          <div className="lb-stage">
            <div
              className={`lb-compare ${zoom}`}
              style={{ '--ar': (result?.meta.aspect ?? '4:3').replace(':', '/') } as CSSProperties}
            >
              <span className="cmp-tag left">3D view</span>
              <span className="cmp-tag right">AI render</span>
              <ReactCompareSlider
                itemOne={
                  <ReactCompareSliderImage
                    src={compareShot ?? shot ?? current}
                    alt="3D view"
                    style={{ objectFit: 'contain', background: '#fff' }}
                  />
                }
                itemTwo={
                  <ReactCompareSliderImage
                    src={result?.image ?? shot ?? current}
                    alt="AI render"
                    style={{ objectFit: 'contain', background: '#fff' }}
                  />
                }
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
