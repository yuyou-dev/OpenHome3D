import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../state/store'
import { exportCompleteProject, importCompleteProject } from '../lib/projectPackage'
import { useUI } from './uiStore'
import { GhostButton, PrimaryButton } from './components'

function download(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function ProjectFiles() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<{ json: string; complete: boolean; name: string } | null>(null)
  const [lightExport, setLightExport] = useState(false)
  const pushToast = useUI(s => s.pushToast)
  const reportError = (error: unknown) => pushToast(error instanceof Error ? error.message : '工程文件操作失败 Project file operation failed')

  const save = async () => {
    setBusy(true)
    try {
      const name = useStore.getState().seed.toLowerCase()
      download(await exportCompleteProject(), `openhome3d-${name}.home3d`)
      pushToast('工程已保存（含引用模型和照片）Project saved with assets')
    } catch (error) { reportError(error) }
    finally { setBusy(false) }
  }
  const readFile = async (file?: File) => {
    if (!file) return
    setBusy(true)
    try {
      const json = await file.text()
      const data = JSON.parse(json)
      setPending({ json, complete: data?.format === 'home3d-cartoon', name: file.name })
    } catch (error) { reportError(error) }
    finally { setBusy(false) }
  }
  const open = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.complete) await importCompleteProject(pending.json)
      else {
        const error = useStore.getState().importProject(pending.json)
        if (error) throw new Error(error)
      }
      setPending(null)
      pushToast('方案已恢复，可撤销 Project restored; undo is available')
    } catch (error) { reportError(error) }
    finally { setBusy(false) }
  }
  const omittedUploads = useStore(s => s.furniture.filter(f => f.modelId.startsWith('upload:')).length)

  return <>
    <div className="project-files">
      <div className="sb-tools">
        <button className="link-btn" type="button" onClick={() => void save()}>保存工程 Save</button>
        <button className="link-btn" type="button" onClick={() => fileRef.current?.click()}>打开 Open</button>
        <button className="link-btn" type="button" onClick={() => setLightExport(true)}>仅布局 Layout</button>
        <input ref={fileRef} type="file" accept=".home3d,.json,application/json" hidden onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          void readFile(file)
        }} />
      </div>
      <p className="caption">工程包含布局、模型和照片<br />Project includes layout, models and photos</p>
    </div>
    {(busy || pending || lightExport) && createPortal(
      <div className="modal-overlay higher" data-modal="">
        <div className="modal-panel" role="dialog" aria-modal="true" aria-label="工程文件 Project file" style={{ width: 'min(480px, 92vw)', height: 'auto', maxHeight: '90vh', padding: 20, gap: 14, overflow: 'auto' }}>
          {busy ? <p role="status">正在处理工程文件…<br />Processing project file…</p> : pending ? <>
            <strong>打开{pending.complete ? '完整工程' : '布局文件'} Open {pending.complete ? 'project' : 'layout'}</strong>
            <p className="caption" style={{ overflowWrap: 'anywhere' }}>{pending.name}</p>
            <p>将替换当前方案，可撤销。<br />Replace the current plan. Undo is available.</p>
            {!pending.complete && <p className="caption">布局文件不包含上传模型和图片。<br />Layout files do not include uploads or images.</p>}
            <div className="btn-row">
              <PrimaryButton onClick={() => void open()}>确认打开 Open file</PrimaryButton>
              <GhostButton onClick={() => setPending(null)}>取消 Cancel</GhostButton>
            </div>
          </> : <>
            <strong>仅导出布局 Export layout only</strong>
            <p>将省略 {omittedUploads} 件上传家具，以及图片、墙高和显示设置。<br />Omits {omittedUploads} uploaded items, images, wall height and display settings.</p>
            <p className="caption">完整保存请使用「保存工程」。<br />Use Save for a complete project.</p>
            <div className="btn-row">
              <PrimaryButton onClick={() => {
                const s = useStore.getState()
                download(s.exportProject(), `openhome3d-layout-${s.seed.toLowerCase()}.json`)
                setLightExport(false)
                pushToast('已导出轻量布局 Layout exported')
              }}>导出布局 Export layout</PrimaryButton>
              <GhostButton onClick={() => setLightExport(false)}>取消 Cancel</GhostButton>
            </div>
          </>}
        </div>
      </div>, document.body,
    )}
  </>
}
