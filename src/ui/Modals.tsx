import { useEffect } from 'react'
import { useUI } from './uiStore'
import AIRender from './modals/AIRender'
import ModelBrowser from './modals/ModelBrowser'
import UploadModel from './modals/UploadModel'

/** Renders the active modal from uiStore (upload nests above the model browser). */
export default function Modals() {
  const active = useUI((s) => s.activeModal)
  const returnTo = useUI((s) => s.returnTo)
  const closeModal = useUI((s) => s.closeModal)

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, closeModal])

  if (!active) return null
  return (
    <>
      {active.kind === 'upload' && returnTo && <ModelBrowser mode={returnTo} />}
      {(active.kind === 'swap' || active.kind === 'add') && <ModelBrowser mode={active.kind} />}
      {active.kind === 'upload' && <UploadModel />}
      {active.kind === 'ai' && <AIRender />}
    </>
  )
}
