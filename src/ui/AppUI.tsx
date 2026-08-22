import { useEffect } from 'react'
import { useUI } from './uiStore'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import StatusBar from './StatusBar'
import PlanMinimap from './PlanMinimap'
import Toasts from './Toasts'
import Modals from './Modals'
import LoadingVeil from './LoadingVeil'

/**
 * Full UI overlay: fixed sidebar + absolutely positioned chrome over the
 * canvas area. Reads both stores directly — no props.
 *
 * The integrator renders this next to the 3D canvas; give the canvas
 * container the `.app-canvas` class (see styles.css) so it picks up the
 * gradient backdrop and slides with the sidebar.
 */
export default function AppUI() {
  const collapsed = useUI((s) => s.collapsed)
  const toggleCollapsed = useUI((s) => s.toggleCollapsed)

  // let the (integrator-owned) canvas container track the sidebar
  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', collapsed)
    return () => document.body.classList.remove('sidebar-collapsed')
  }, [collapsed])

  return (
    <>
      <Sidebar />
      {/* edge tab: rides the sidebar's right edge, vertically centered */}
      <button
        type="button"
        className={`edge-toggle${collapsed ? ' collapsed' : ''}`}
        title={collapsed ? '展开侧栏 Expand sidebar' : '收起侧栏 Collapse sidebar'}
        onClick={() => toggleCollapsed()}
      >
        <svg width="10" height="14" viewBox="0 0 10 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 2.5 L2 7 L6.5 11.5" />
        </svg>
      </button>
      <div className={`ui-overlay${collapsed ? ' collapsed' : ''}`}>
        <TopBar />
        <StatusBar />
        <PlanMinimap />
      </div>
      <Toasts />
      <Modals />
      <LoadingVeil />
    </>
  )
}
