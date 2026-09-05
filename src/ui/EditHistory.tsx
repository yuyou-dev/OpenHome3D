import { useEffect } from 'react'
import { useStore } from '../state/store'
import { IconButton } from './components'

export default function EditHistory() {
  const canUndo = useStore((s) => s.canUndo)
  const canRedo = useStore((s) => s.canRedo)
  useEffect(() => {
    const begin = () => useStore.getState().beginEdit()
    const end = () => useStore.getState().endEdit()
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editing = target?.closest('input, textarea, select, [contenteditable="true"]')
      if (e.isComposing || document.querySelector('[data-modal]')) return
      const key = e.key.toLowerCase()
      if (!editing && (e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) {
        e.preventDefault()
        const redo = key === 'y' || e.shiftKey
        useStore.getState()[redo ? 'redo' : 'undo']()
      } else if ((!editing || target?.matches('input[type="range"]')) &&
        ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'a', 'e'].includes(key)) {
        begin()
      }
    }
    window.addEventListener('pointerdown', begin, true)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', end)
    window.addEventListener('blur', end)
    return () => {
      end()
      window.removeEventListener('pointerdown', begin, true)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', end)
      window.removeEventListener('blur', end)
    }
  }, [])
  return (
    <>
      <IconButton title="撤销 Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={() => useStore.getState().undo()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3 L2 7 L6 11 M2 7 H10 A4 4 0 0 1 10 15" />
        </svg>
      </IconButton>
      <IconButton title="重做 Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={() => useStore.getState().redo()}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3 L14 7 L10 11 M14 7 H6 A4 4 0 0 0 6 15" />
        </svg>
      </IconButton>
    </>
  )
}
