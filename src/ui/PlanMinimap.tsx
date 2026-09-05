import { useState } from 'react'
import { useStore } from '../state/store'
import PlanDialog from './PlanDialog'
import { GhostButton } from './components'

/**
 * Corner minimap of the imported floor-plan image, map-style: visible only in
 * the home (户型图) tab while an imported image is stored. Click the thumbnail
 * for a lightbox zoom; the × clears the stored image (store.clearPlanImage).
 */
export default function PlanMinimap() {
  const planTab = useStore((s) => s.planTab)
  const planImageKey = useStore((s) => s.planImageKey)
  const clearPlanImage = useStore((s) => s.clearPlanImage)
  const src = useStore((s) => s.planImageUrl)
  const [zoom, setZoom] = useState(false)

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
        <PlanDialog title="户型原图 Original plan" label="户型原图 Original plan" onDismiss={() => setZoom(false)}
          actions={<GhostButton onClick={() => setZoom(false)}>关闭 Close</GhostButton>}>
          <img className="plan-dialog-image" src={src} alt="户型原图 Original plan" />
        </PlanDialog>
      )}
    </>
  )
}
