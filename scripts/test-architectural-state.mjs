// Real store and project codec, isolated in-memory persistence; no browser or AI calls.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
globalThis.window = { localStorage }
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false }, appType: 'custom',
  plugins: [{ name: 'architectural-state-memory', enforce: 'pre',
    resolveId(id) { if (id === 'virtual:architecture-idb') return id },
    load(id) { if (id === 'virtual:architecture-idb') return `let writes=0; export const get=async()=>undefined; export const keys=async()=>[]; export const setMany=async()=>{writes++}; export const writeCount=()=>writes;` },
    transform(source, id) {
      if (id.endsWith('/src/lib/planImage.ts')) return `export const PLAN_IMAGE_KEY='plan:image'; let image; export async function savePlanImage(value){image=value} export async function loadPlanImage(){return image} export async function deletePlanImage(){image=undefined}`
      if (id.endsWith('/src/lib/projectPackage.ts')) return source.replace("from 'idb-keyval'", "from 'virtual:architecture-idb'")
    },
  }],
})
const polygon = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]]
const plan = {
  version: 1, levels: [{ id: 'ground', name: '一层', elevation: 0, height: 2.8 }, { id: 'upper', name: '二层', elevation: 3.2, height: 2.8 }],
  spaces: [
    { id: 'living', name: 'L形客厅', type: 'living', kind: 'room', levelId: 'ground', polygon },
    { id: 'upper-room', name: '二层房间', type: 'bedroom', kind: 'room', levelId: 'upper', polygon },
    { id: 'void', name: '挑空', type: 'other', kind: 'void', levelId: 'ground', polygon: [[0.6, 2.4], [1.4, 2.4], [1.4, 3.2], [0.6, 3.2]] },
    { id: 'stair', name: '楼梯', type: 'other', kind: 'stair', levelId: 'ground', polygon: [[4, 0.3], [5, 0.3], [5, 1.7], [4, 1.7]], stair: { flights: [{ id: 'flight', path: [[4.5, 0.5], [4.5, 1.5]], width: 0.6, rise: 3.2, steps: 16 }] } },
    { id: 'ledge', name: '主卧飘窗', type: 'other', kind: 'ledge', levelId: 'ground', surfaceHeight: 0.5, polygon: [[0.5, 5], [1.5, 5], [1.5, 5.8], [0.5, 5.8]] },
  ],
  walls: [{ id: 'west', levelId: 'ground', start: [0, 0], end: [0, 6], thickness: 0.2, height: 2.8, kind: 'exterior' }],
  openings: [{ id: 'entrance', wallId: 'west', kind: 'door', offset: 1, width: 0.9, sill: 0, height: 2.1, operation: 'hinged', hinge: 'start', swing: 1 }],
  furniture: [{ id: 'chair-drawing', spaceId: 'living', type: 'chair', label: '识别椅子', center: [1, 4], width: 0.5, depth: 0.5, rotation: 0.25, confidence: 0.9 },
    { id: 'chair-on-ledge', spaceId: 'ledge', type: 'chair', label: '飘窗误识别家具', center: [1, 5.4], width: 0.5, depth: 0.5, rotation: 0, confidence: 0.5 }],
  dimensions: [], warnings: ['需要确认层高'], source: { width: 600, height: 600, bounds: [0, 0, 600, 600], scale: 0.01, confidence: 0.9 },
}
try {
  const { useStore: store } = await vite.ssrLoadModule('/src/state/store.ts')
  const { architectureToHome } = await vite.ssrLoadModule('/src/gen/importArchitecture.ts')
  const { calibrateArchitecture } = await vite.ssrLoadModule('/src/gen/calibrateArchitecture.ts')
  const { homeForRoomLevel, homeAABB, homeHeight } = await vite.ssrLoadModule('/src/state/home.ts')
  const { architecturalFurnitureFits, importArchitecturalFurniture } = await vite.ssrLoadModule('/src/gen/architecturalFurniture.ts')
  const codec = await vite.ssrLoadModule('/src/lib/projectPackage.ts')
  const idb = await vite.ssrLoadModule('virtual:architecture-idb')
  const s = () => store.getState()
  const dimensionPlan = { ...plan, dimensions: [
    { label: '8000', axis: 'x', from: 1, to: 9, meters: 8, status: 'used' },
    { label: '9000', axis: 'x', from: 1, to: 9, meters: 9, status: 'conflict' },
    { label: 'estimated 9000', axis: 'x', from: 1, to: 9, meters: 9, status: 'estimated' },
    { label: 'estimated 8000', axis: 'x', from: 1, to: 9, meters: 8, status: 'estimated' },
  ], warnings: ['原始识别记录：9000 与 8m 几何冲突'] }
  const verifiedDimensions = calibrateArchitecture(dimensionPlan, 0.01125)
  assert.deepEqual(verifiedDimensions.dimensions.map(d => d.status), ['conflict', 'used', 'estimated', 'conflict'], 'calibration updates current conflicts and retains matching estimates')
  assert.deepEqual(verifiedDimensions.dimensions.map(d => d.meters), [8, 9, 9, 8], 'written measurements remain unchanged')
  assert.deepEqual(verifiedDimensions.warnings, dimensionPlan.warnings, 'import conflict notes remain historical evidence')
  assert.deepEqual(dimensionPlan.dimensions.map(d => d.status), ['used', 'conflict', 'estimated', 'estimated'], 'calibration does not mutate its input')
  const separatedFloors = structuredClone(plan)
  separatedFloors.spaces.find(space => space.id === 'upper-room').polygon = polygon.map(([x, z]) => [x + 100, z + 200])
  separatedFloors.walls.push({ id: 'upper-wall', levelId: 'upper', start: [100, 200], end: [106, 200], thickness: 0.2, height: 5, kind: 'exterior' })
  separatedFloors.openings.push({ id: 'upper-window', wallId: 'upper-wall', kind: 'window', offset: 3, width: 1, sill: 1, height: 1, operation: 'fixed', hinge: 'start', swing: 1 })
  separatedFloors.furniture.push({ ...plan.furniture[0], id: 'upper-chair', spaceId: 'upper-room', center: [101, 204] })
  const completeBuilding = architectureToHome(separatedFloors)
  const groundView = homeForRoomLevel(completeBuilding, 'living')
  const upperView = homeForRoomLevel(completeBuilding, 'upper-room')
  assert.deepEqual(upperView.rooms.map(room => room.id), ['upper-room'])
  assert.deepEqual(upperView.architecture.walls.map(wall => wall.id), ['upper-wall'])
  assert.deepEqual(upperView.architecture.openings.map(opening => opening.id), ['upper-window'])
  assert.deepEqual(upperView.architecture.furniture.map(item => item.id), ['upper-chair'])
  assert.deepEqual(upperView.architecture.levels.map(level => level.id), ['upper'])
  assert.ok(homeAABB(groundView).maxX < 10 && homeAABB(groundView).maxZ < 10, 'ground framing excludes distant upper-floor geometry')
  assert.ok(homeAABB(upperView).minX > 99 && homeAABB(upperView).minZ > 199, 'upper framing excludes the ground floor')
  assert.equal(homeHeight(groundView, 3), 2.8)
  assert.equal(homeHeight(upperView, 3), 5, 'framing height follows only the visible floor')
  assert.deepEqual(homeForRoomLevel(completeBuilding, 'unknown'), groundView, 'missing selection falls back to the first floor')
  assert.equal(completeBuilding.rooms.length, 5, 'view filtering must not mutate the complete building')
  const semanticPlan = { ...structuredClone(plan), walls: [], openings: [], furniture: [], spaces: [
    { id: 'kitchen', name: '厨房', type: 'kitchen', kind: 'room', levelId: 'ground', polygon: [[0, 0], [12, 0], [12, 12], [0, 12]] },
    { id: 'bathroom', name: '卫浴', type: 'bathroom', kind: 'room', levelId: 'upper', polygon: [[0, 0], [12, 0], [12, 12], [0, 12]] },
  ] }
  for (const [id, type, label, spaceId] of [['washer', 'appliance', '洗衣机', 'kitchen'], ['fridge', 'appliance', '冰箱', 'kitchen'], ['stove', 'appliance', '双眼灶', 'kitchen'], ['tv', 'appliance', '电视', 'kitchen'], ['kitchen-sink', 'sink', '双槽水槽', 'kitchen'], ['bathroom-sink', 'sink', '洗手盆', 'bathroom'], ['dining', 'table', '餐桌', 'kitchen'], ['counter', 'counter', '厨房台面', 'kitchen'], ['sink-counter', 'counter', '带水槽台面', 'kitchen'], ['small-bed', 'bed', '识别床', 'kitchen']]) {
    semanticPlan.furniture.push({ id, type, label, spaceId, center: [5, 5], width: 0.7, depth: 0.6, rotation: 0, confidence: 1 })
  }
  const semantics = importArchitecturalFurniture(architectureToHome(semanticPlan), 'SEMANTIC', 0).furniture
  for (const [id, expected] of [['washer', /washer/], ['fridge', /fridge/], ['stove', /stove/], ['tv', /television|tv/], ['kitchen-sink', /kitchen.*sink/], ['bathroom-sink', /bathroom.*sink/]]) {
    assert.match(semantics.find(item => item.id.endsWith(`:${id}`)).modelId, expected, `${id} must match function before footprint similarity`)
  }
  assert.doesNotMatch(semantics.find(item => item.id.endsWith(':dining')).modelId, /lamp|coffee|side-table/)
  assert.doesNotMatch(semantics.find(item => item.id.endsWith(':counter')).modelId, /sink|stove|oven/)
  assert.match(semantics.find(item => item.id.endsWith(':sink-counter')).modelId, /sink/)
  assert.doesNotMatch(semantics.find(item => item.id.endsWith(':small-bed')).modelId, /cabinet|drawer|nightstand|bedside|table/)

  const bedTrace = { ...plan, spaces: [{ ...plan.spaces[0], type: 'bedroom', polygon: [[0, 0], [3, 0], [3, 3], [0, 3]] }], walls: [], openings: [],
    furniture: [{ ...plan.furniture[0], id: 'bed-trace', type: 'bed', label: '识别单人床', center: [1.5, 1.5], width: 1.02, depth: 2, rotation: 0 }] }
  const exactBed = importArchitecturalFurniture(architectureToHome(bedTrace), 'BED', 0).furniture[0]
  assert.equal(exactBed.modelId, 'kenney:bed-single')
  assert.deepEqual(exactBed.position, [0, 0], 'legal original centers take priority over any correction')
  bedTrace.furniture[0].center = [0.5, 1.5]
  const correctedBed = importArchitecturalFurniture(architectureToHome(bedTrace), 'BED', 0)
  const shifted = correctedBed.furniture.find(item => item.id.endsWith(':bed-trace'))
  assert.ok(shifted)
  assert.equal(shifted.modelId, exactBed.modelId)
  assert.equal(shifted.scale, exactBed.scale)
  assert.deepEqual(shifted.params, exactBed.params)
  assert.equal(shifted.rotationY, exactBed.rotationY)
  const correction = Math.hypot(shifted.position[0] + 1, shifted.position[1])
  assert.ok(correction > 0 && correction <= 0.2, 'bed correction is bounded in radial distance')
  assert.ok(architecturalFurnitureFits(architectureToHome(bedTrace), shifted))
  assert.ok(correctedBed.warnings.some(warning => warning.includes('Bed shifted within 20 cm')))
  assert.deepEqual(bedTrace.furniture[0].center, [0.5, 1.5], 'recognized source center is preserved for review')
  bedTrace.furniture[0].center = [0.2, 1.5]
  const missingBed = importArchitecturalFurniture(architectureToHome(bedTrace), 'BED', 0)
  assert.ok(!missingBed.furniture.some(item => item.id.endsWith(':bed-trace')), 'large errors cannot be concealed by moving or substituting a cabinet')
  assert.ok(missingBed.warnings.some(warning => warning.includes('Recognized bed missing')))
  s().importHome(architectureToHome(plan), 'data:image/png;base64,YQ==')
  const recognized = s().furniture.find(f => f.label === '识别椅子')
  assert.ok(recognized, 'recognized furniture matches an existing registry model')
  assert.equal(recognized.source, 'manual')
  assert.equal(recognized.locked, true)
  assert.equal(recognized.rotationY, 0.25)
  assert.deepEqual(recognized.position, [-2, 1], 'metric source center becomes room-local coordinates')
  assert.match(s().structureNotice, /专业面板/)
  assert.ok(s().home.architecture.warnings.includes('需要确认层高'), 'recognized warnings stay available in the structure panel')
  assert.ok(s().furniture.every(item => architecturalFurnitureFits(s().home, item)), 'fallback furniture fits actual polygons and obstacles')
  assert.ok(!s().furniture.some(item => ['void', 'stair', 'ledge'].includes(item.roomId)))
  s().selectRoom('ledge')
  assert.equal(s().activeRoomId, 'ledge', 'raised surfaces remain selectable structure')
  const furnitureBeforeLedge = s().furniture
  s().addFurniture('builtin:coffee-table', [0, 0])
  s().reshuffleFurniture()
  assert.deepEqual(s().furniture, furnitureBeforeLedge, 'raised surfaces reject manual and generated furniture')
  s().selectRoom('living')
  const id = recognized.id
  for (const point of [[0, 0], [-3, 1], [-2.5, -2], [-2, -0.2], [1.5, -2], [-2, 2.4]]) {
    s().moveFurniture(id, ...point)
    assert.equal(s().furniture.find(f => f.id === id), recognized, 'notch/wall/door/void/stair/ledge move is rejected')
  }
  s().selectRoom('living')
  s().reshuffleFurniture()
  s().setExtras(50)
  assert.equal(s().furniture.find(f => f.id === id), recognized, 'recognized work survives regeneration and density')
  s().addFurniture('builtin:coffee-table', [-1.62, 1])
  const table = s().furniture.find(f => f.id === s().selectedId)
  assert.equal(table.modelId, 'builtin:coffee-table')
  s().moveFurniture(table.id, -1.8, 1)
  s().undo()
  for (const action of [() => s().rotateFurniture(table.id, Math.PI / 4), () => s().setScale(table.id, 2), () => s().setParam(table.id, 'Width', 2.4), () => s().swapModel(table.id, 'builtin:sofa'), () => s().duplicateFurniture(table.id)]) {
    const count = s().furniture.length
    action()
    assert.equal(s().furniture.find(f => f.id === table.id), table, 'rotation/scale/parameters/model replacement reject an illegal footprint')
    assert.equal(s().furniture.length, count, 'duplication must not add an illegal footprint')
    assert.equal(s().canRedo, true, 'rejected edits keep redo available')
  }
  s().removeFurniture(table.id)
  const before = s().home
  for (const action of [() => s().setRoomRect('living', { x: 0, z: 0, w: 12, d: 12 }), () => s().setRoomType('kitchen'), () => s().setRoomPartition(1), () => s().addRoom(), () => s().removeRoom('living'), () => s().addOpening({ a: 'living', b: 'exterior', side: 'n', width: 1, offset: 2, kind: 'door' })]) {
    action()
    assert.equal(s().home, before, 'legacy rectangle operation cannot replace real structure')
    assert.match(s().structureNotice, /专业结构面板/)
  }
  const changed = structuredClone(plan)
  changed.spaces[0].polygon[1][0] = 6.5
  changed.spaces[0].polygon[2][0] = 6.5
  s().setArchitecture(changed)
  assert.deepEqual(s().furniture.find(f => f.id === id).position, [-2.25, 1], 'bbox changes preserve furniture world position')
  assert.equal(s().planImageUrl, 'data:image/png;base64,YQ==')
  s().undo()
  assert.equal(s().home, before, 'architecture edits join existing history')
  assert.equal(s().planImageUrl, 'data:image/png;base64,YQ==')

  // Calibrating an edited scene scales live manual work, not just the original recognized hints.
  s().moveFurniture(id, -1.9, 1)
  const beforeCalibration = { home: s().home, furniture: s().furniture }
  const edited = s().furniture.find(item => item.id === id)
  const roomBefore = s().home.rooms.find(room => room.id === 'living')
  const scaled = calibrateArchitecture(s().home.architecture, 0.0125)
  const flight = scaled.spaces.find(space => space.id === 'stair').stair.flights[0]
  assert.deepEqual(flight.path, [[5.625, 0.625], [5.625, 1.875]])
  assert.equal(flight.width, 0.75)
  assert.equal(flight.rise, 3.2, 'vertical rise stays in measured metres')
  assert.equal(scaled.spaces.find(space => space.id === 'ledge').surfaceHeight, 0.5)
  s().setArchitecture(scaled)
  const calibrated = s().furniture.find(item => item.id === id)
  const roomAfter = s().home.rooms.find(room => room.id === 'living')
  assert.ok(calibrated, 'calibration keeps legal manually edited furniture')
  assert.equal(calibrated.source, 'manual'); assert.equal(calibrated.locked, true)
  assert.equal(calibrated.scale, edited.scale * 1.25)
  for (const [axis, center, extent] of [[0, 'x', 'w'], [1, 'z', 'd']]) {
    assert.ok(Math.abs((calibrated.position[axis] + roomAfter.rect[center]) - (edited.position[axis] + roomBefore.rect[center]) * 1.25) < 1e-9)
    assert.ok(Math.abs(calibrated.position[axis] / roomAfter.rect[extent] - edited.position[axis] / roomBefore.rect[extent]) < 1e-9, 'furniture relative location is invariant under calibration')
  }
  assert.equal(s().planImageUrl, 'data:image/png;base64,YQ==')
  s().undo()
  assert.equal(s().home, beforeCalibration.home)
  assert.deepEqual(s().furniture, beforeCalibration.furniture, 'undo restores furniture pose and scale together with geometry')
  s().undo()

  const salt = s().home.rooms.find(room => room.id === 'living').salt
  const savedArchitecture = structuredClone(s().home.architecture)
  const layout = s().exportProject()
  s().newRoom()
  assert.equal(s().importProject(layout), null)
  assert.deepEqual(s().home.architecture, savedArchitecture, 'lightweight export preserves architecture and notices')
  assert.equal(s().home.rooms.find(room => room.id === 'living').salt, salt, 'lightweight import preserves room generation counter')
  assert.equal(s().home.rooms.length, 5, 'overlapping compatibility bounding boxes do not drop spaces, raised surfaces or levels')
  const packed = await codec.exportCompleteProject()
  s().newRoom()
  await codec.importCompleteProject(packed)
  assert.deepEqual(s().home.architecture, savedArchitecture, 'complete project preserves architecture and notices')
  assert.equal(s().home.rooms.length, 5)
  assert.equal(s().home.rooms.find(room => room.id === 'living').salt, salt, 'complete import preserves room generation counter')
  assert.ok(s().furniture.every(item => architecturalFurnitureFits(s().home, item)))
  const saved = s().exportProject(), writes = idb.writeCount()
  const invalid = JSON.parse(packed)
  invalid.scene.home.architecture.openings[0].wallId = 'missing'
  await assert.rejects(codec.importCompleteProject(JSON.stringify(invalid)))
  assert.equal(idb.writeCount(), writes, 'invalid architecture fails before resource transactions')
  assert.equal(s().exportProject(), saved, 'invalid import cannot replace the current project')
  invalid.scene.home.architecture = plan
  invalid.scene.furniture[0].position = [0, 0]
  await assert.rejects(codec.importCompleteProject(JSON.stringify(invalid)))
  assert.equal(idb.writeCount(), writes, 'furniture in a concave notch fails before resource transactions')

  const openRoom = { ...plan, spaces: [{ ...plan.spaces[0], polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }], walls: [], openings: [], furniture: [{ ...plan.furniture[0], center: [5, 5] }] }
  for (const [initialScale, calibratedScale] of [[2, 0.011], [0.1, 0.009]]) {
    s().importHome(architectureToHome(openRoom))
    const itemId = s().furniture[0].id
    s().setScale(itemId, initialScale)
    s().setArchitecture(calibrateArchitecture(s().home.architecture, calibratedScale))
    const expectedScale = s().furniture[0].scale
    assert.ok(expectedScale > 2 || expectedScale < 0.1, 'calibrated model can exceed legacy scale controls')
    const calibratedLayout = s().exportProject()
    assert.equal(s().importProject(calibratedLayout), null)
    assert.equal(s().furniture[0].scale, expectedScale, 'architecture layout JSON preserves the calibrated model scale exactly')
    const calibratedPackage = await codec.exportCompleteProject()
    await codec.importCompleteProject(calibratedPackage)
    assert.equal(s().furniture[0].scale, expectedScale, 'complete project also preserves calibrated model scale')
    for (const invalidScale of [0, -1, null]) {
      const invalidLayout = JSON.parse(calibratedLayout)
      invalidLayout.furniture[0].scale = invalidScale
      const unchanged = s().exportProject()
      assert.match(s().importProject(JSON.stringify(invalidLayout)), /Invalid furniture scale/)
      assert.equal(s().exportProject(), unchanged, 'invalid architecture scale cannot mutate the scene')
    }
  }
  s().newRoom()
  const legacyLayout = JSON.parse(s().exportProject())
  assert.ok(legacyLayout.furniture.length)
  legacyLayout.furniture[0].scale = 5
  assert.equal(s().importProject(JSON.stringify(legacyLayout)), null)
  assert.equal(s().furniture[0].scale, 2, 'legacy layouts retain their scale clamp')
  console.log('Architectural state: recognition, protected editing, polygons/obstacles/ledges, calibration, floor framing, multi-level roundtrips and atomic validation passed')
} finally { await vite.close() }
