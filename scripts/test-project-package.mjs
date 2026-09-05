// Real downloads, uploads and IndexedDB across isolated browser contexts; no AI calls.
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appUrl, launchBrowser, preparePage } from './lib/browser.mjs'

const dir = await mkdtemp(join(tmpdir(), 'home3d-project-'))
const browser = await launchBrowser()
try {
  const source = await browser.newPage()
  await source.setViewport({ width: 1600, height: 1000 })
  const sourceErrors = await preparePage(source)

  await source.goto(appUrl(), { waitUntil: 'networkidle0' })
  await source.waitForSelector('.loading-veil', { hidden: true })
  const expected = await source.evaluate(async () => {
    const { allModels } = await import('/src/models/registry.ts')
    const { set } = await import('/node_modules/idb-keyval/dist/index.js')
    const { MODEL_BLOB_KEY } = await import('/src/three/runtime.ts')
    const s = () => window.__store.getState()
    s().newRoom()
    const def = allModels().find(model => model.kind === 'glb' && model.type === 'SEATING')
    const blob = await (await fetch(def.file)).blob()
    const upload = { ...def, id: 'upload:package-test', kind: 'upload', brand: 'MY UPLOADS', name: 'Package chair' }
    delete upload.file
    await set(MODEL_BLOB_KEY(upload.id), blob)
    s().addUpload(upload)
    s().addFurniture(upload.id)
    const id = s().selectedId
    s().moveFurniture(id, 0.25, -0.25)
    s().setFurnitureLocked(id, false)
    s().setFurnitureLocked(id, true)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 4
    const context = canvas.getContext('2d')
    context.fillStyle = '#e85c44'
    context.fillRect(0, 0, 4, 4)
    const image = canvas.toDataURL('image/png')
    const photo = await (await fetch(image)).blob()
    await set(`refphoto:${id}:0`, photo)
    await set(`refphoto:${upload.id}:0`, photo)
    // Unreferenced browser assets must not travel with this project.
    await set('refphoto:unrelated:0', photo)
    s().setPlanImage(image)
    s().setStructure({ wallHeight: 3.25, windows: false, cutawayWalls: false, floorSlab: false, doorLeaves: false, showFurniture: true })
    s().setProjection('perspective')
    s().setMoveGrid(0.1)
    return { image, bytes: blob.size, home: s().home, count: s().furniture.length, item: s().furniture.find(f => f.id === id), seed: s().seed }
  })
  const cdp = await source.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })
  await source.waitForSelector('.project-files button')
  await source.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('保存工程')).click())
  let filename
  for (let attempt = 0; attempt < 200; attempt++) {
    filename = (await readdir(dir)).find(name => name.endsWith('.home3d'))
    if (filename) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(filename, 'Save must download a .home3d package')
  const path = join(dir, filename)
  const json = await readFile(path, 'utf8')
  const packed = JSON.parse(json)
  assert.equal(packed.models.length, 1)
  assert.equal(packed.photos.length, 2, 'only referenced photos are included')
  assert.equal(packed.scene.planImageUrl, expected.image)

  const targetContext = await browser.createBrowserContext()
  const target = await targetContext.newPage()
  await target.setViewport({ width: 1600, height: 1000 })
  const targetErrors = await preparePage(target)
  await target.goto(appUrl(), { waitUntil: 'networkidle0' })
  await target.waitForSelector('.loading-veil', { hidden: true })
  const before = await target.evaluate(() => window.__store.getState().exportProject())
  const beforeView = await target.evaluate(() => [window.__store.getState().projection, window.__store.getState().moveGrid])
  await (await target.$('.project-files input[type="file"]')).uploadFile(path)
  await target.waitForSelector('[data-modal] .btn-primary')
  assert.equal(await target.evaluate(() => window.__store.getState().exportProject()), before, 'opening requires confirmation')
  await target.click('[data-modal] .btn-primary')
  await target.waitForFunction(() => window.__store.getState().uploads.some(def => def.name === 'Package chair'))
  const inspect = () => target.evaluate(async () => {
    const s = window.__store.getState()
    const { get, keys } = await import('/node_modules/idb-keyval/dist/index.js')
    const { MODEL_BLOB_KEY } = await import('/src/three/runtime.ts')
    const item = s.furniture.find(f => f.label === 'Package chair')
    return { home: s.home, count: s.furniture.length, seed: s.seed, item, bytes: (await get(MODEL_BLOB_KEY(item.modelId))).size, image: s.planImageUrl, photos: (await keys()).filter(key => String(key).startsWith(`refphoto:${item.id}:`) || String(key).startsWith(`refphoto:${item.modelId}:`)).length,
      settings: [s.wallHeight, s.windows, s.cutawayWalls, s.floorSlab, s.doorLeaves, s.projection, s.moveGrid], canUndo: s.canUndo }
  })
  const restored = await inspect()
  assert.deepEqual(restored.home, expected.home)
  assert.equal(restored.count, expected.count)
  assert.equal(restored.bytes, expected.bytes)
  assert.equal(restored.image, expected.image)
  assert.equal(restored.photos, 2)
  assert.deepEqual(restored.settings, [3.25, false, false, false, false, 'perspective', 0.1])
  assert.deepEqual(restored.item.position, expected.item.position)
  assert.equal(restored.item.locked, true)
  assert.notEqual(restored.item.id, expected.item.id)
  assert.notEqual(restored.item.modelId, expected.item.modelId)
  await target.evaluate(() => window.__store.getState().undo())
  assert.equal(await target.evaluate(() => window.__store.getState().exportProject()), before, 'one undo restores the previous scene')
  assert.deepEqual(await target.evaluate(() => [window.__store.getState().projection, window.__store.getState().moveGrid]), beforeView, 'undo restores imported projection and grid')
  await target.evaluate(() => window.__store.getState().redo())
  await target.reload({ waitUntil: 'networkidle0' })
  await target.waitForFunction(() => !!window.__store.getState().planImageUrl)
  assert.equal((await inspect()).image, expected.image, 'restored plan image survives reload')

  // Invalid/missing resources fail before changing state or storing partial assets.
  for (const mutate of [p => p.models = [], p => p.models[0].data = 'data:application/octet-stream;base64,YQ==', p => p.scene.home.openings[0].b = 'missing-room']) {
    const bad = structuredClone(packed)
    mutate(bad)
    const outcome = await target.evaluate(async bad => {
      const { importCompleteProject } = await import('/src/lib/projectPackage.ts')
      const { keys } = await import('/node_modules/idb-keyval/dist/index.js')
      const old = window.__store.getState().exportProject()
      const count = (await keys()).length
      let error
      try { await importCompleteProject(JSON.stringify(bad)) } catch (caught) { error = caught.message }
      return { rejected: !!error, unchanged: old === window.__store.getState().exportProject(), assetsUnchanged: count === (await keys()).length }
    }, bad)
    assert.deepEqual(outcome, { rejected: true, unchanged: true, assetsUnchanged: true })
  }
  // Only known scene fields can reach the store.
  const extra = structuredClone(packed)
  extra.scene.undo = 'not a function'
  await target.evaluate(async data => (await import('/src/lib/projectPackage.ts')).importCompleteProject(JSON.stringify(data)), extra)
  assert.equal(await target.evaluate(() => typeof window.__store.getState().undo), 'function')
  await target.waitForSelector('[data-modal]', { hidden: true })
  await target.screenshot({ path: process.env.SHOT || '/tmp/openhome3d-project-restored.png' })
  assert.deepEqual(sourceErrors, [])
  assert.deepEqual(targetErrors, [])
  // The legacy layout format remains accepted via the same Open flow.
  const legacy = join(dir, 'layout.json')
  await writeFile(legacy, before)
  await (await target.$('.project-files input[type="file"]')).uploadFile(legacy)
  await target.waitForSelector('[data-modal] .btn-primary')
  await target.click('[data-modal] .btn-primary')
  await target.waitForSelector('[data-modal]', { hidden: true })
  assert.equal(await target.evaluate(() => window.__store.getState().exportProject()), before)
  console.log('project-package OK: UI save/open, isolated storage, GLB/photo/plan restore, settings, identity remap, undo/redo/reload, invalid package rollback, legacy import')
} finally {
  await browser.close()
  await rm(dir, { recursive: true, force: true })
}
