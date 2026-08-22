import { useEffect, useState } from 'react'
import { useStore } from '../state/store'
import { loadPlanImage } from '../lib/planImage'

/**
 * Corner minimap of the imported floor-plan image, map-style: visible only in
 * the home (户型图) tab while an imported image is stored. Click the thumbnail
 * for a lightbox zoom; the × clears the stored image (store.clearPlanImage).
 */
export default function PlanMinimap() {
  const planTab = useStore((s) => s.planTab)
  const planImageKey = useStore((s) => s.planImageKey)
  const clearPlanImage = useStore((s) => s.clearPlanImage)
  const [src, setSrc] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)

  // bytes live in IndexedDB; the persisted key is just the "has image" flag
  useEffect(() => {
    let alive = true
    if (planImageKey) {
      loadPlanImage()
        .then((v) => {
          if (alive) setSrc(typeof v === 'string' ? v : null)
        })
        .catch(() => {})
    } else {
      setSrc(null)
    }
    return () => {
      alive = false
    }
  }, [planImageKey])

  // Esc closes the lightbox (click anywhere on it does too)
  useEffect(() => {
    if (!zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom])

  if (planTab !== 'home' || !planImageKey || !src) return null
  return (
    <>
      <div className="plan-minimap">
        <button
          type="button"
          className="plan-minimap-img"
          title="放大查看 Enlarge"
          onClick={() => setZoom(true)}
        >
          <img src={src} alt="户型原图 Original plan" />
        </button>
        <button
          type="button"
          className="plan-minimap-close"
          title="清除原图 Clear plan image"
          onClick={() => clearPlanImage()}
        >
          ×
        </button>
      </div>
      {zoom && (
        <div className="lightbox" data-modal="" onClick={() => setZoom(false)}>
          <div className="lb-stage">
            <img className="plan-lightbox-img" src={src} alt="户型原图 Original plan" />
          </div>
        </div>
      )}
    </>
  )
}
