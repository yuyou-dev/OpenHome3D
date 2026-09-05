import { useEffect, useState, type CSSProperties } from 'react'
import { ReactCompareSlider, ReactCompareSliderImage } from 'react-compare-slider'
import { useStore } from '../../state/store'
import { useAiTask } from '../../state/aiTask'
import { useAiStatus } from '../../lib/useAiStatus'
import { captureFittedScreenshot, captureScreenshot, captureUnbiasedScreenshot } from '../../three/runtime'
import { useUI } from '../uiStore'
import { GhostButton, IconButton, PrimaryButton } from '../components'
import {
  collectReferencePhotos,
  historyImage,
  historyRecord,
  historyList,
  historyRemove,
  nearestAspect,
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
  if (!dims || !aw || !ah) throw new Error('无法读取截图 Cannot read screenshot')
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
  if (!ctx) throw new Error('无法准备截图 Cannot prepare screenshot')
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
    }).catch(() => {
      if (ok) setSrc(null)
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

  const [shot, setShot] = useState<string | null>(null)
  const { form, phase, error, result, historyRevision, updateForm, setResult, start, cancel } = useAiTask()
  const prompt = form.prompt ?? DEFAULT_PROMPT
  const { format, framing, presets } = form
  const rendering = phase === 'preparing' || phase === 'running' || phase === 'saving'
  const compareShot = result?.record.source
  const status = useAiStatus()
  const [history, setHistory] = useState<RenderMeta[]>([])
  const [photoCount, setPhotoCount] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const [zoom, setZoom] = useState<'fit' | 'full'>('fit')

  const model = status?.model ?? 'GPT-6 Astra · image_gen'
  const canRender = !!shot && !rendering && !!status?.codex?.available && !status?.busy

  // capture the current 3D view once when the modal opens
  // (drop any selection first so the blue highlight doesn't end up in the shot)
  useEffect(() => {
    useStore.getState().select(null)
    const t = requestAnimationFrame(() => setShot(captureScreenshot()))
    return () => cancelAnimationFrame(t)
  }, [])

  useEffect(() => {
    let alive = true
    void historyList().then((h) => {
      if (alive) setHistory(h)
    }).catch(() => {
      if (alive) pushToast('无法读取渲染历史 Cannot read render history')
    })
    return () => { alive = false }
  }, [historyRevision, pushToast])

  useEffect(() => {
    let alive = true
    void collectReferencePhotos(furniture).then(({ count }) => {
      if (alive) setPhotoCount(count)
    }).catch(() => {
      if (alive) pushToast('无法读取参考照片 Cannot read reference photos')
    })
    return () => { alive = false }
  }, [furniture, pushToast])

  const typeCount = new Set(furniture.map((f) => f.modelId)).size
  const current = result?.record.image ?? shot
  const currentIsRender = !!result

  const onRender = () => {
    if (!shot || !canRender) return
    const snapshot = useStore.getState()
    void start(async () => {
      const dims = await dataUrlSize(shot)
      const aspect = format === 'match view' ? nearestAspect(dims?.w ?? 4, dims?.h ?? 3) : format
      const [aw, ah] = aspect.split(':').map(Number)
      const frame = framing === 'fit'
        ? await captureFittedScreenshot(aw / ah)
        : await captureUnbiasedScreenshot()
      if (!frame) throw new Error('无法截取 3D 视图 Could not capture the 3D view')
      const cropped = await cropToAspect(frame, aspect)
      const references = await collectReferencePhotos(snapshot.furniture)
      const fragments = presetFragments(presets)
      return {
        image: cropped,
        prompt: fragments.length ? `${prompt.trim()}\n\n${fragments.join('\n')}` : prompt,
        images: references.images,
        aspect,
        seed: snapshot.seed,
        presets: PRESET_GROUPS.map((g) => presetLabel(g.id, presets[g.id]))
          .filter((label): label is string => !!label)
          .map((label) => label.split(' ')[0]),
      }
    })
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
      void historyRemove(result.meta.id).then((next) => {
        setHistory(next)
        setResult(null)
        pushToast('效果图已删除 Render deleted')
      }).catch(() => pushToast('删除失败 Could not delete render'))
    } else if (shot) {
      setShot(null)
    }
  }

  const openHistoryItem = (meta: RenderMeta) => {
    void historyRecord(meta.id).then((record) => {
      if (record) setResult({ record, meta })
    }).catch(() => pushToast('无法读取效果图 Cannot read render'))
  }

  return (
    <div className="ai-panel" data-modal="">
      <div className="modal-head" style={{ flexWrap: 'wrap' }}>
        <span className="modal-title">AI 渲染 AI render</span>
        <span className="tag">{model}</span>
        <span style={{ flex: 1 }} />
        {rendering ? (
          <GhostButton title="关闭面板，任务继续；重新打开可查看或取消 Close panel; task continues" onClick={() => closeModal()}>
            后台运行 Background
          </GhostButton>
        ) : <IconButton title="Close" onClick={() => closeModal()}>×</IconButton>}
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
            {result && compareShot && !rendering ? (
              <div
                className="ai-compare"
                style={{ '--ar': result.meta.aspect.replace(':', '/') } as CSSProperties}
              >
                <span className="cmp-tag left">3D view</span>
                <span className="cmp-tag right">AI render</span>
                <ReactCompareSlider
                  itemOne={
                    <ReactCompareSliderImage
                      src={compareShot}
                      alt="3D view"
                      style={{ objectFit: 'contain', background: '#fff' }}
                    />
                  }
                  itemTwo={
                    <ReactCompareSliderImage
                      src={result.record.image}
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
                <span className="rendering-note">{phase === 'preparing' ? '准备中 Preparing' : phase === 'saving' ? '保存中 Saving' : `渲染中 Rendering with ${model}`}…</span>
                <button type="button" className="rendering-cancel" onClick={cancel} disabled={phase === 'saving'}>
                  取消 Cancel
                </button>
              </>
            )}
          </div>
          {result && (
            <div className="ai-meta">
              {result.meta.model} · {result.meta.aspect} · {(result.meta.durationMs / 1000).toFixed(1)} s ·{' '}
              {result.record.referenceImages?.length ?? '—'} refs · seed {result.meta.seed}
              {result.meta.presets && result.meta.presets.length > 0 && (
                <> · {result.meta.presets.join(' / ')}</>
              )}
            </div>
          )}
          {result && !compareShot && <p className="hint">旧记录未保存输入图，仅显示效果图 Legacy render: source image unavailable.</p>}
          {result?.record.prompt && (
            <details className="hint" style={{ maxHeight: 180, overflowY: 'auto', margin: 8, flexShrink: 0 }}>
              <summary>本次生成信息 Generation details</summary>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{result.record.prompt}</p>
              <span>{result.record.referenceImages?.length ?? 0} 张参考照片 Reference photos</span>
              {!!result.record.referenceImages?.length && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {result.record.referenceImages.map((src, i) => <img key={i} src={src} alt={`参考照片 Reference ${i + 1}`} style={{ width: 64, height: 64, objectFit: 'contain' }} />)}
                </div>
              )}
            </details>
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
            <GhostButton disabled={!current || rendering} onClick={onDelete}>
              删除 Delete
            </GhostButton>
          </div>
        </div>

        <div className="ai-right">
          {status && !status.codex?.available && (
            <div className="ai-warn">
              {status.codex?.reason?.includes('not found')
                ? '未检测到 codex CLI — 请先安装(npm i -g @openai/codex)。codex CLI not found on PATH.'
                : status.codex?.reason?.includes('required for GPT-6')
                  ? `Codex 版本过旧，请先升级。${status.codex.reason}`
                  : 'codex 未登录 — 请在终端运行 codex login 后重试。Not logged in — run: codex login.'}
            </div>
          )}
          {!status && <div className="ai-warn">{import.meta.env.PROD
            ? '本机功能：运行 npm run dev 并执行 codex login 后可用。线上演示不提供 AI 服务。Local only: run the dev server with Codex logged in.'
            : '正在连接本机 AI 服务 Connecting to the local AI service…'}</div>}
          {rendering && <p className="hint">关闭面板后继续渲染；顶部 AI 按钮可查看或取消。刷新或关闭页面将中止任务。Continue in background; reopen from AI to check or cancel. Reloading ends the task.</p>}
          {error && <div className="ai-warn error">{error}</div>}

          <div className="form-row">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="lbl">提示词 Prompt</span>
              <button type="button" className="reset-link" onClick={() => updateForm({ prompt: DEFAULT_PROMPT })}>
                ↺ default
              </button>
            </div>
            <textarea
              className="input"
              rows={8}
              value={prompt}
              onChange={(e) => updateForm({ prompt: e.target.value })}
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
            <select className="input" value={format} onChange={(e) => updateForm({ format: e.target.value })}>
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
              onChange={(e) => updateForm({ framing: e.target.value as 'fit' | 'editor' })}
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
                    onChange={(e) => updateForm({ presets: { ...presets, [g.id]: e.target.value } })}
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
              {result && compareShot ? (
                <>
                  <span className="cmp-tag left">3D view</span>
                  <span className="cmp-tag right">AI render</span>
                  <ReactCompareSlider
                    itemOne={<ReactCompareSliderImage src={compareShot} alt="3D view" style={{ objectFit: 'contain', background: '#fff' }} />}
                    itemTwo={<ReactCompareSliderImage src={result.record.image} alt="AI render" style={{ objectFit: 'contain', background: '#fff' }} />}
                  />
                </>
              ) : <img src={current} alt={currentIsRender ? 'AI render' : '3D view'} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
