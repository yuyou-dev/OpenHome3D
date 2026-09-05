// Real-store regression: edits preserve user work and openings always match actual walls.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
const memory = new Map()
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: key => memory.delete(key),
}
globalThis.window = { localStorage }
const vite = await createServer({
  configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true }, appType: 'custom',
  plugins: [{
    name: 'in-memory-plan-image', enforce: 'pre',
    transform(_source, id) {
      if (id.endsWith('/src/lib/planImage.ts')) return `
        export const PLAN_IMAGE_KEY = 'plan:image';
        export async function savePlanImage() {}
        export async function loadPlanImage() {}
        export async function deletePlanImage() {}`
    },
  }],
})
try {
  const { useStore: store } = await vite.ssrLoadModule('/src/state/store.ts')
  const { validateOpening, fitOpening, openingIntervals } = await vite.ssrLoadModule('/src/state/home.ts')
  const { boxAt, overlaps } = await vite.ssrLoadModule('/src/lib/geom.ts')
  const { getModel, footprintOf } = await vite.ssrLoadModule('/src/models/registry.ts')
  const { deriveWalls } = await vite.ssrLoadModule('/src/gen/walls.ts')
  const { overlapAllowed } = await vite.ssrLoadModule('/src/gen/layout.ts')
  const s = () => store.getState()
  const room = (id, x = 0, z = 0, w = 8, d = 8) => ({ id, type: 'living', name: id, rect: { x, z, w, d }, salt: 0, partitionHeight: 0 })
  const a = room('a'), b = room('b', 8)
  s().importHome({ rooms: [a, b], openings: [] })
  s().setSeed('PRESERVE-EDITING')
  for (const r of [a, b]) {
    s().selectRoom(r.id)
    s().addFurniture('builtin:plant', [0, 0])
  }
  const manual = s().furniture.filter(f => f.source === 'manual')
  const core = s().furniture.filter(f => f.source === 'generated' && !f.decor)
  s().setExtras(0)
  for (const f of [...manual, ...core]) assert.equal(s().furniture.find(next => next.id === f.id), f, 'density preserves main and manual pieces exactly')
  assert.equal(s().furniture.some(f => f.source === 'generated' && f.decor), false, 'zero density removes only automatic decorations')
  s().setExtras(100)
  const decor = s().furniture.filter(f => f.source === 'generated' && f.decor)
  assert.ok(decor.length >= 2, 'automatic decorations can be replenished')
  s().moveFurniture(decor[0].id, 0.25, -0.25)
  s().setFurnitureLocked(decor[1].id, true)
  const edited = s().furniture.find(f => f.id === decor[0].id)
  const locked = s().furniture.find(f => f.id === decor[1].id)
  assert.equal(edited.source, 'manual', 'manual adjustment promotes generated furniture to user work')
  const legacy = { ...manual[0], id: 'legacy-piece', source: undefined }
  store.setState({ furniture: [...s().furniture, legacy] })
  s().setExtras(0)
  for (const f of [edited, locked, legacy]) assert.equal(s().furniture.find(next => next.id === f.id), f)
  s().selectRoom('a')
  s().reshuffleFurniture()
  for (const f of [...manual, edited, locked, legacy]) assert.equal(s().furniture.find(next => next.id === f.id), f, 'shuffle retains all protected work across rooms')
  assert.equal(new Set(s().furniture.map(f => f.id)).size, s().furniture.length, 'regeneration cannot collide with preserved IDs')
  const box = f => boxAt(...f.position, ...footprintOf(getModel(f.modelId), f.params, f.scale), f.rotationY)
  const protectedPieces = s().furniture.filter(f => f.roomId === 'a' && (f.source !== 'generated' || f.locked))
  for (const f of s().furniture.filter(f => f.roomId === 'a' && f.source === 'generated' && !f.locked)) {
    for (const kept of protectedPieces) {
      if (!overlapAllowed(f, kept)) assert.equal(overlaps(box(f), box(kept), 0.049), false, 'new layout avoids retained furniture')
    }
  }
  const beforeType = s().furniture
  s().setRoomType('bedroom')
  assert.equal(s().furniture, beforeType, 'room type is descriptive until explicit shuffle')
  s().setRoomRect('a', { ...a.rect, w: 6, d: 6 })
  assert.deepEqual(s().furniture.map(f => f.id), beforeType.map(f => f.id), 'resize never replaces furniture')
  for (const f of s().furniture.filter(f => f.roomId === 'b')) assert.equal(f, beforeType.find(old => old.id === f.id), 'resize leaves other rooms untouched')
  s().undo()
  assert.equal(s().furniture, beforeType, 'resize undo restores exact placement')
  const user = manual[0]
  s().setFurnitureLocked(user.id, false)
  assert.equal(s().furniture.find(f => f.id === user.id).source, 'generated', 'unchecking keep opts back into regeneration')

  const west = room('west', 0, 0, 4, 6), east = room('east', 4, 1, 4, 2)
  const door = { id: 'door', kind: 'door', a: west.id, b: east.id, side: 'e', offset: 4, width: 0.9 }
  const home = { rooms: [west, east], openings: [door] }
  assert.equal(validateOpening(home, door), true)
  assert.equal(deriveWalls(home, 2.8).flatMap(w => w.doorways).length, 1, 'declared connected door is actually rendered')
  assert.equal(validateOpening(home, { ...door, offset: 1 }), false, 'interior opening must fit shared interval')
  assert.equal(validateOpening(home, { ...door, side: 'w' }), false, 'interior opening must face its neighbor')
  assert.equal(validateOpening(home, { ...door, kind: 'window' }), false, 'windows cannot be interior')
  assert.equal(validateOpening(home, { ...door, b: 'exterior' }), false, 'external door cannot overlap a neighbor')
  assert.equal(validateOpening(home, { ...door, kind: 'window', b: 'exterior', offset: 1 }), true, 'partial exterior segments allow windows')
  assert.deepEqual(openingIntervals(home, { ...door, b: 'exterior' }), [[0, 3], [5, 6]])
  const fitted = fitOpening(home, { ...door, offset: 0, width: 4 })
  assert.deepEqual([fitted.offset, fitted.width], [4, 2], 'width and position clamp into shared span')
  s().importHome(home)
  s().selectOpening(door.id)
  s().setRoomType('office')
  assert.deepEqual(s().home.openings, [door], 'changing room type retains authored openings')
  s().setRoomRect(east.id, { ...east.rect, z: 2 })
  assert.ok(s().home.openings.every(o => validateOpening(s().home, o)), 'neighbor edits repair openings owned by the other room')
  s().setRoomRect(east.id, { ...east.rect, x: 7 })
  assert.equal(s().home.openings.length, 0, 'disconnect removes invalid inner door')
  assert.equal(deriveWalls(s().home, 2.8).flatMap(w => w.doorways).length, 0, 'rendered wall and opening data agree after disconnect')
  assert.equal(s().selectedOpeningId, null)
  assert.match(s().structureNotice, /移除 1/, 'topology repair is disclosed')
  s().undo()
  assert.equal(s().home.openings.length, 1, 'undo restores room connection and its door atomically')
  s().addOpening({ ...door, id: undefined, side: 'w' })
  assert.equal(s().home.openings.length, 1, 'invalid opening creation is rejected')
  s().updateOpening(door.id, { offset: 100, width: 100 })
  assert.ok(s().home.openings.every(o => validateOpening(s().home, o)))
  s().removeRoom(east.id)
  assert.equal(s().home.openings.length, 0)
  s().undo()
  assert.ok(s().home.openings.every(o => validateOpening(s().home, o)))
  assert.equal(s().importProject(s().exportProject()), null)
  assert.ok(s().home.openings.every(o => validateOpening(s().home, o)), 'lightweight round trip retains valid topology')
  s().importHome({ rooms: [{ ...room('kitchen'), type: 'kitchen' }], openings: [] })
  s().setSeed('DECOR-DEPENDENCIES')
  s().setExtras(100)
  assert.ok(s().furniture.some(f => f.modelId === 'builtin:dining-table'))
  for (const f of s().furniture.filter(f => f.modelId === 'builtin:chair')) assert.equal(f.decor, true, 'chairs inherit their optional table decoration provenance')
  s().setExtras(0)
  assert.equal(s().furniture.some(f => ['builtin:chair', 'builtin:dining-table'].includes(f.modelId)), false, 'removing optional table also removes its automatic chairs')
  const single = room('single', 0, 0, 6, 6)
  const exterior = { ...door, id: 'covered-window', kind: 'window', a: single.id, b: 'exterior', side: 'e', offset: 3 }
  s().importHome({ rooms: [single], openings: [exterior] })
  s().addRoom('bedroom')
  assert.equal(s().home.openings.some(o => o.id === exterior.id), false, 'adding neighbor reconciles existing room exterior openings too')
  assert.ok(s().home.openings.every(o => validateOpening(s().home, o)))
  s().setProjection('isometric')
  s().setMoveGrid(0.05)
  const beforeImport = s()
  const complete = {
    home: structuredClone(beforeImport.home), seed: beforeImport.seed, extras: beforeImport.extras,
    furniture: structuredClone(beforeImport.furniture), uploads: [], planImageUrl: null,
    wallHeight: beforeImport.wallHeight, cutawayWalls: beforeImport.cutawayWalls,
    floorSlab: beforeImport.floorSlab, windows: beforeImport.windows,
    doorLeaves: beforeImport.doorLeaves, showFurniture: beforeImport.showFurniture,
    projection: 'perspective', moveGrid: 0.2,
  }
  s().restoreCompleteProject(complete)
  s().undo()
  assert.equal(s().home, beforeImport.home)
  assert.deepEqual([s().projection, s().moveGrid], ['isometric', 0.05], 'project undo restores previous projection and movement grid')
  s().redo()
  assert.deepEqual([s().projection, s().moveGrid], ['perspective', 0.2], 'project redo restores imported projection and movement grid')
  s().addFurniture('builtin:plant')
  s().setProjection('isometric')
  s().setMoveGrid(0.4)
  s().undo()
  assert.deepEqual([s().projection, s().moveGrid], ['isometric', 0.4], 'ordinary furniture undo leaves later view and grid changes alone')
  s().redo()
  assert.deepEqual([s().projection, s().moveGrid], ['isometric', 0.4], 'ordinary furniture redo leaves the view alone too')
  s().undo()
  s().undo()
  assert.deepEqual([s().projection, s().moveGrid], ['isometric', 0.05], 'import metadata survives intervening edit undo/redo')
  s().redo()
  assert.deepEqual([s().projection, s().moveGrid], ['isometric', 0.4], 'redo returns to the actual imported scene state before undo')
  assert.equal('importSettings' in s(), false, 'history-only import metadata never enters the store')
  console.log('editing-invariants OK: density, provenance, locks, shuffle obstacles, IDs, resizing, room type, wall segments, disconnection, undo and import')
} finally {
  await vite.close()
}
