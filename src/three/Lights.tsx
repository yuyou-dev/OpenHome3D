import { useStore } from '../state/store'
import { homeAABB, homeForRoomLevel } from '../state/home'

/**
 * Toon lighting: warm sky / soft lavender ground hemisphere fill (the lavender
 * bounce gives shadows their pastel purple tint) plus one directional "sun"
 * shining from the window side (-x), high up, casting soft PCF shadows sized
 * to the home.
 */
export default function Lights() {
  const home = useStore((s) => s.home)
  const activeRoomId = useStore(s=>s.activeRoomId)
  const aabb = homeAABB(homeForRoomLevel(home,activeRoomId))
  const extent = Math.max(aabb.w, aabb.d) + 2

  return (
    <>
      <hemisphereLight args={['#FFF6E8', '#D9C8E8', 1.35]} />
      <directionalLight
        position={[-(extent + 5), 9, extent * 0.35]}
        intensity={2.2}
        color="#FFF2DF"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-extent}
        shadow-camera-right={extent}
        shadow-camera-top={extent}
        shadow-camera-bottom={-extent}
        shadow-camera-near={0.5}
        shadow-camera-far={40}
        shadow-bias={-0.0002}
      />
    </>
  )
}
