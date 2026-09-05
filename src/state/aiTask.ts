import { create } from 'zustand'
import { aiRender, historyAdd, type RenderMeta, type RenderRecord } from '../lib/ai'
import { useUI } from '../ui/uiStore'

interface RenderForm {
  prompt: string | null
  format: string
  framing: 'fit' | 'editor'
  presets: Record<string, string>
}

export interface RenderInput {
  image: string
  prompt: string
  images: string[]
  aspect: string
  seed: string
  presets: string[]
}

interface AiTaskState {
  phase: 'idle' | 'preparing' | 'running' | 'saving' | 'done' | 'error'
  error: string | null
  result: { meta: RenderMeta; record: RenderRecord } | null
  historyRevision: number
  form: RenderForm
  updateForm: (patch: Partial<RenderForm>) => void
  setResult: (result: AiTaskState['result']) => void
  start: (prepare: () => Promise<RenderInput>) => Promise<void>
  cancel: () => void
}

// The owner lives outside React so closing the panel neither drops a task nor
// lets a stale completion replace the result of a later task.
let owner: AbortController | null = null

export const useAiTask = create<AiTaskState>()((set, get) => ({
  phase: 'idle',
  error: null,
  result: null,
  historyRevision: 0,
  form: { prompt: null, format: 'match view', framing: 'fit', presets: {} },
  updateForm: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),
  setResult: (result) => set({ result }),
  start: async (prepare) => {
    if (owner) return
    const ctrl = new AbortController()
    owner = ctrl
    const current = () => owner === ctrl && !ctrl.signal.aborted
    set({ phase: 'preparing', error: null })
    try {
      const input = await prepare()
      if (!current()) return
      set({ phase: 'running' })
      const response = await aiRender({ ...input, signal: ctrl.signal })
      if (!current()) return
      if (!response.ok) {
        if (response.code === 'cancelled') {
          set({ phase: 'idle' })
          useUI.getState().pushToast('渲染已取消 Render cancelled')
          return
        }
        throw new Error(response.code === 'busy'
          ? '另一个 codex 任务进行中，请稍候 Another codex task is running'
          : response.error)
      }
      const meta: RenderMeta = {
        id: `r${crypto.randomUUID()}`,
        ts: Date.now(),
        model: response.model,
        aspect: response.aspect,
        durationMs: response.durationMs,
        seed: input.seed,
        presets: input.presets,
      }
      const record: RenderRecord = {
        version: 1,
        image: response.image,
        source: input.image,
        prompt: input.prompt,
        referenceImages: input.images,
      }
      // Keep the finished image available even when the browser storage is full.
      set({ result: { meta, record }, phase: 'saving' })
      try {
        await historyAdd(meta, record)
        set((s) => ({ historyRevision: s.historyRevision + 1 }))
      } catch {
        if (current()) set({ error: '效果图已完成，但历史保存失败，请下载图片 Render ready; history could not be saved. Download the image.' })
      }
      set({ phase: 'done' })
      if (current()) useUI.getState().pushToast(`完成 Done · ${(response.durationMs / 1000).toFixed(1)} s`)
    } catch (error) {
      if (!current()) return
      const message = error instanceof Error ? error.message : String(error)
      set({ phase: 'error', error: message })
      useUI.getState().pushToast(`渲染失败 Render failed: ${message}`)
    } finally {
      if (owner === ctrl) owner = null
    }
  },
  cancel: () => {
    if (!owner || (get().phase !== 'preparing' && get().phase !== 'running')) return
    owner.abort() // the server kills this request's subprocess on disconnect
    owner = null
    set({ phase: 'idle', error: null })
    useUI.getState().pushToast('已取消 Cancelled')
  },
}))
