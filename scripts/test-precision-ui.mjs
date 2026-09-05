// Real import/review/editor interactions with isolated profiles and intercepted AI routes.
// Does not inspect, cancel or invoke any task on the dev server.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appUrl, launchBrowser, preparePage } from './lib/browser.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/plan-precision.json', import.meta.url), 'utf8'))
const output = process.env.SHOT_DIR || '/tmp/home3d-precision-ui'
await mkdir(output, { recursive: true })
const browser = await launchBrowser()
const results = []
const dialogSelector = 'dialog.plan-dialog[data-modal][open]'
const reviewSelector = `${dialogSelector}[aria-label="户型解析核对 Plan review"]`
const originalSelector = `${dialogSelector}[aria-label="户型原图 Original plan"]`

function sceneSnapshot() {
  const s = window.__store.getState()
  return { layout: s.exportProject(), image: s.planImageUrl, selected: s.selectedId, active: s.activeRoomId, tab: s.planTab, undo: s.canUndo, redo: s.canRedo }
}

async function assertModalIsolation(page) {
  await page.waitForSelector(dialogSelector)
  assert.deepEqual(await page.$eval(dialogSelector, dialog => ({ modal: dialog.matches(':modal'), portal: dialog.parentElement === document.body, focus: dialog.contains(document.activeElement) })), { modal: true, portal: true, focus: true })
  const before = await page.evaluate(sceneSnapshot)
  await page.evaluate(() => document.querySelector('.edge-toggle').focus())
  assert.equal(await page.$eval(dialogSelector, dialog => dialog.contains(document.activeElement)), true, 'background cannot steal focus')
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    // Native dialogs may yield to browser chrome (reported as body); no background control may receive focus.
    assert.equal(await page.$eval(dialogSelector, dialog => dialog.contains(document.activeElement) || document.activeElement === document.body), true, 'Tab cannot enter background controls')
  }
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift')
  assert.equal(await page.$eval(dialogSelector, dialog => dialog.contains(document.activeElement) || document.activeElement === document.body), true, 'reverse Tab cannot enter background controls')
  await page.keyboard.press('Delete')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
  const target = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]'), bounds = dialog.getBoundingClientRect()
    const candidates = [...document.querySelectorAll('.edge-toggle,.seg-btn,.ai-btn')].map(node => ({ node, rect: node.getBoundingClientRect() }))
    const candidate = candidates.find(({ rect: r }) => r.width && r.height && r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && (r.right < bounds.left || r.left > bounds.right || r.bottom < bounds.top || r.top > bounds.bottom))
    window.__modalBackgroundClicks = 0
    candidate?.node.addEventListener('click', () => window.__modalBackgroundClicks++, { once: true })
    return candidate ? { x: candidate.rect.x + candidate.rect.width / 2, y: candidate.rect.y + candidate.rect.height / 2 } : { x: 2, y: 2 }
  })
  await page.mouse.click(target.x, target.y)
  assert.equal(await page.evaluate(() => window.__modalBackgroundClicks), 0, 'top layer blocks background pointer events')
  assert.ok(await page.$(dialogSelector), 'backdrop clicks do not dismiss the dialog')
  const settleFrames = () => page.evaluate(() => new Promise(resolve => {
    let frames = 0
    const tick = () => ++frames === 20 ? resolve() : requestAnimationFrame(tick)
    requestAnimationFrame(tick)
  }))
  const cameraPose = () => page.evaluate(() => {
    const { camera, controls } = window.__three.get()
    return [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.zoom, ...controls.target.toArray()]
  })
  await settleFrames()
  const cameraBefore = await cameraPose()
  const edge = await page.evaluate(() => ({ x: innerWidth - 2, y: innerHeight / 2 }))
  await page.mouse.move(edge.x, edge.y)
  await page.mouse.down()
  await page.mouse.move(edge.x - 40, edge.y + 30, { steps: 4 })
  await page.mouse.up()
  await page.mouse.move(edge.x, edge.y)
  await page.mouse.wheel({ deltaY: 400 })
  await settleFrames()
  assert.ok((await cameraPose()).every((value, index) => Math.abs(value - cameraBefore[index]) < 1e-6), 'modal pointer drag and wheel cannot orbit or zoom the background camera')
  assert.deepEqual(await page.evaluate(sceneSnapshot), before, 'background pointer and keyboard actions cannot edit the scene')
  await page.evaluate(() => window.getSelection()?.removeAllRanges())
}

async function assertContainedMedia(page, selector) {
  const info = await page.$eval(selector, media => {
    const rect = media.getBoundingClientRect(), body = media.closest('.plan-dialog-body').getBoundingClientRect()
    const actions = media.closest('dialog').querySelector('.plan-dialog-actions').getBoundingClientRect()
    let complete, contain, drawn = rect
    if (media instanceof HTMLImageElement) {
      complete = media.complete && media.naturalWidth > 0
      contain = getComputedStyle(media).objectFit === 'contain'
    } else {
      const matrix = media.getScreenCTM(), box = media.viewBox.baseVal
      const start = new DOMPoint(box.x, box.y).matrixTransform(matrix), end = new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix)
      drawn = { left: start.x, top: start.y, right: end.x, bottom: end.y }
      complete = !!media.querySelector('image')
      contain = media.preserveAspectRatio.baseVal.meetOrSlice === 1 && media.preserveAspectRatio.baseVal.align !== 1
    }
    return { complete, contain, visible: drawn.left >= body.left - 2 && drawn.right <= body.right + 2 && drawn.top >= body.top - 2 && drawn.bottom <= body.bottom + 2, controlsVisible: actions.top >= 0 && actions.bottom <= innerHeight + 2, width: rect.width, height: rect.height }
  })
  assert.ok(info.complete && info.contain && info.visible && info.controlsVisible, `entire image and explicit controls remain visible: ${JSON.stringify(info)}`)
  return info
}

async function clickText(page, text, selector = 'button') {
  const handle = await page.evaluateHandle(({ text, selector }) => [...document.querySelectorAll(selector)].find(element => element.textContent.includes(text)), { text, selector })
  const element = handle.asElement()
  assert.ok(element, `Missing interactive control: ${text}`)
  await element.click()
  await handle.dispose()
}

async function setNumber(page, label, value) {
  const handle = await page.evaluateHandle(label => [...document.querySelectorAll('[data-architecture-panel] .row')].find(row => row.querySelector('.row-label')?.textContent === label)?.querySelector('input'), label)
  const input = handle.asElement()
  assert.ok(input, `Missing numeric input: ${label}`)
  await input.click({ clickCount: 3 })
  await input.press('Backspace')
  await input.type(String(value))
  await input.press('Enter')
  await handle.dispose()
}

/** Audit the new controls and modal, allowing vertical scrolling and intentional ellipsis. */
function auditPrecision() {
  const findings = []
  const roots = [...document.querySelectorAll('[data-architecture-panel], dialog.plan-dialog[open]')]
  for (const root of roots) for (const element of [root, ...root.querySelectorAll('*')]) {
    if (!(element instanceof HTMLElement)) continue
    const style = getComputedStyle(element), rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden') continue
    const text = element.textContent.replace(/\s+/g, ' ').trim().slice(0, 65)
    const ownText = [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())
    const control = element.matches('button, select, input')
    if ((ownText || control) && element.scrollWidth > element.clientWidth + 2 && !['auto', 'scroll'].includes(style.overflowX) && style.textOverflow !== 'ellipsis') {
      findings.push({ kind: 'clipped text', text, extra: element.scrollWidth - element.clientWidth })
    }
    if (style.position === 'fixed') {
      if (rect.left < -2 || rect.right > innerWidth + 2) findings.push({ kind: 'viewport overflow', text })
      continue
    }
    let parent = element.parentElement
    while (parent) {
      const parentStyle = getComputedStyle(parent)
      if (['auto', 'scroll'].includes(parentStyle.overflowX)) break
      // A fixed review overlay escapes the sidebar's clipping ancestors.
      if (parentStyle.position === 'fixed') {
        if (rect.left < -2 || rect.right > innerWidth + 2) findings.push({ kind: 'viewport overflow', text })
        break
      }
      if (['hidden', 'clip'].includes(parentStyle.overflowX) || parent === document.body) {
        const bounds = parent.getBoundingClientRect()
        if (rect.left < bounds.left - 2 || rect.right > bounds.right + 2) findings.push({ kind: 'clipped control', text })
        break
      }
      parent = parent.parentElement
    }
  }
  return findings
}

try {
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }, { width: 390, height: 500 }]) {
    const name = `${viewport.width}x${viewport.height}`
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 })
    const calls = []
    let pendingRequest
    const respond = (request, body) => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    const errors = await preparePage(page, (request, path) => {
      calls.push(path)
      if (path === '/api/ai/status') return respond(request, { ok: true, codex: { available: true }, busy: false, model: 'precision mock' })
      if (path === '/api/ai/understand') { pendingRequest = request; return }
      // Even an unexpected cancel stays inside this mock and cannot reach a live Codex process.
      return respond(request, { ok: false, code: 'error', error: `Unexpected mocked route: ${path}` })
    })
    try {
      await page.goto(appUrl(), { waitUntil: 'networkidle0', timeout: 60000 })
      await page.waitForFunction(() => !!window.__store && !!window.__three?.get().controls)
      await page.waitForSelector('.loading-veil', { hidden: true, timeout: 20000 })
      if (await page.$('.sidebar.collapsed')) await page.click('.edge-toggle')
      await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().width >= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) - 1)
      await clickText(page, '整宅 Home', '.seg-btn')
      await page.waitForSelector('.sidebar input[type=file][accept="image/png,image/jpeg"]')
      await page.evaluate(() => {
        const s = window.__store.getState()
        s.select(s.furniture[0]?.id ?? null)
        s.setExtras(s.extras === 50 ? 51 : 50)
      })
      const before = await page.evaluate(() => window.__store.getState().exportProject())
      const png = await page.evaluate(fixture => {
        const canvas = document.createElement('canvas')
        canvas.width = fixture.source.width; canvas.height = fixture.source.height
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.font = '25px sans-serif'
        for (const space of fixture.spaces) {
          ctx.beginPath(); space.polygon.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath()
          ctx.fillStyle = space.kind === 'void' ? '#ffe4eb' : '#e7f1ff'; ctx.fill(); ctx.strokeStyle = '#242424'; ctx.lineWidth = 2; ctx.stroke()
          ctx.fillStyle = '#242424'; ctx.fillText(space.name, space.polygon[0][0] + 15, space.polygon[0][1] + 35)
        }
        for (const wall of fixture.walls) { ctx.beginPath(); ctx.moveTo(...wall.start); ctx.lineTo(...wall.end); ctx.lineWidth = wall.thickness; ctx.stroke() }
        ctx.fillStyle = '#242424'; ctx.fillText('Synthetic precision plan · 8000 / 9000 conflict', 100, 820)
        return canvas.toDataURL('image/png').split(',')[1]
      }, fixture)
      const imagePath = join(output, `source-${name}.png`)
      await writeFile(imagePath, Buffer.from(png, 'base64'))
      const fileInput = await page.$('.sidebar input[type=file][accept="image/png,image/jpeg"]')
      assert.ok(fileInput, 'actual floor-plan file input exists')
      await fileInput.uploadFile(imagePath)
      await page.waitForFunction(() => document.querySelector('dialog[open]')?.textContent.includes('Recognizing'))
      await assertModalIsolation(page)
      await page.screenshot({ path: join(output, `recognizing-${name}.png`) })
      assert.equal(await page.evaluate(() => window.__store.getState().exportProject()), before, 'pending recognition cannot mutate the scene')
      for (let i = 0; i < 200 && !pendingRequest; i++) await new Promise(resolve => setTimeout(resolve, 25))
      assert.ok(pendingRequest, 'file upload sends the intercepted recognition request')
      assert.match(JSON.parse(pendingRequest.postData()).image, /^data:image\/png;base64,/)
      await respond(pendingRequest, { ok: true, plan: fixture, codexModel: 'precision mock' })
      await page.waitForSelector(reviewSelector)
      assert.equal(await page.evaluate(() => window.__store.getState().exportProject()), before, 'review remains a pending draft')
      await assertModalIsolation(page)
      const reviewMedia = await assertContainedMedia(page, `${reviewSelector} [data-plan-trace]`)
      const trace = await page.evaluate(() => ({ polygons: document.querySelectorAll('[data-plan-trace] polygon').length, vertices: document.querySelector('[data-plan-trace] polygon').getAttribute('points').split(' ').length, image: document.querySelector('[data-plan-trace] image').getAttribute('href') }))
      assert.equal(trace.polygons, 4); assert.equal(trace.vertices, 6)
      assert.match(trace.image, /^data:image\/png;base64,/)
      assert.deepEqual(await page.evaluate(auditPrecision), [], `${name}: pending trace overflow`)
      await page.screenshot({ path: join(output, `review-${name}.png`) })
      await clickText(page, '放弃导入 Cancel', `${reviewSelector} button`)
      await page.waitForSelector(dialogSelector, { hidden: true })
      assert.equal(await page.evaluate(() => window.__store.getState().exportProject()), before, 'discarding a reviewed import keeps the original scene')
      pendingRequest = undefined
      await fileInput.uploadFile(imagePath)
      for (let i = 0; i < 200 && !pendingRequest; i++) await new Promise(resolve => setTimeout(resolve, 25))
      assert.ok(pendingRequest, 'a discarded file can be selected again')
      await respond(pendingRequest, { ok: true, plan: fixture, codexModel: 'precision mock' })
      await page.waitForSelector(reviewSelector)
      await clickText(page, '导入 Import', `${reviewSelector} button`)
      await page.waitForSelector(dialogSelector, { hidden: true })
      await page.waitForSelector('[data-architecture-panel]')
      const model = await page.evaluate(() => {
        const s = window.__store.getState()
        return { spaces: s.home.architecture.spaces, opening: s.home.architecture.openings[0], wall: s.home.architecture.walls[0], dimensions: s.home.architecture.dimensions, original: s.planImageUrl, furniture: s.furniture }
      })
      assert.equal(model.spaces[0].polygon.length, 6)
      assert.equal(model.spaces.filter(space => space.name === '次卧').length, 2)
      assert.equal(model.wall.thickness, 0.2); assert.ok(Math.abs(model.opening.offset - 0.7) < 1e-9)
      assert.equal(model.dimensions[1].status, 'conflict')
      assert.match(model.original, /^data:image\/png;base64,/)
      assert.ok(model.furniture.some(item => item.label === '识别椅子' && item.locked))
      await page.waitForFunction(() => !!window.__three.get().scene.getObjectByName('architecture:L2'))
      const floor = await page.evaluate(() => {
        const architecture = window.__three.get().scene.getObjectByName('architecture:L2')
        const mesh = architecture.children[0].children.find(child => child.isMesh)
        const positions = mesh.geometry.attributes.position
        let area = 0, voidCovered = false
        const inside = (p, a, b, c) => {
          const cross = (v, w, q) => (w[0] - v[0]) * (q[1] - v[1]) - (w[1] - v[1]) * (q[0] - v[0])
          const values = [cross(a, b, p), cross(b, c, p), cross(c, a, p)]
          return values.every(v => v >= -1e-6) || values.every(v => v <= 1e-6)
        }
        for (let i = 0; i < positions.count; i += 3) {
          if (![i, i + 1, i + 2].every(j => Math.abs(positions.getY(j)) < 1e-6)) continue
          const [a, b, c] = [i, i + 1, i + 2].map(j => [positions.getX(j), positions.getZ(j)])
          const triangleArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2
          area += triangleArea
          if (triangleArea > 1e-8 && inside([4.5, 3.5], a, b, c)) voidCovered = true
        }
        return { vertices: positions.count, area, voidCovered, material: mesh.material.type }
      })
      assert.ok(floor.vertices > 0 && floor.area > 0, 'actual floor mesh is present')
      assert.equal(floor.voidCovered, false, 'actual floor triangles must not fill the void')
      assert.equal(floor.material, 'MeshToonMaterial')

      await page.click('.plan-minimap-img')
      await page.waitForSelector(originalSelector)
      await page.waitForFunction(() => document.querySelector('dialog[open] img')?.complete)
      await assertModalIsolation(page)
      const originalMedia = await assertContainedMedia(page, `${originalSelector} img`)
      assert.deepEqual(await page.evaluate(auditPrecision), [], `${name}: original plan overflow`)
      await page.screenshot({ path: join(output, `original-${name}.png`) })
      await clickText(page, '关闭 Close', `${originalSelector} button`)
      await page.waitForSelector(originalSelector, { hidden: true })
      assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.plan-minimap-img')), true, 'closing restores the image trigger focus')
      await page.click('.plan-minimap-img')
      await page.waitForSelector(originalSelector)
      await page.keyboard.press('Escape')
      await page.waitForSelector(originalSelector, { hidden: true })
      assert.equal(await page.evaluate(() => window.__store.getState().planImageUrl), model.original, 'closing original view never clears its stored image')
      await clickText(page, '核对原图 Review trace', '[data-architecture-panel] button')
      await page.waitForSelector(reviewSelector)
      assert.equal(await page.$(`${reviewSelector} .btn-primary`), null, 'already-imported review cannot import a second time')
      await clickText(page, '关闭 Close', `${reviewSelector} button`)
      await page.waitForSelector(reviewSelector, { hidden: true })

      await clickText(page, '墙体参数 Walls', '[data-architecture-panel] summary')
      await setNumber(page, '墙厚 Thickness', 0.24)
      await page.waitForFunction(() => window.__store.getState().home.architecture.walls[0].thickness === 0.24)
      await clickText(page, '门窗参数 Hosted openings', '[data-architecture-panel] summary')
      await setNumber(page, '宽 Width', 0.9)
      await page.waitForFunction(() => window.__store.getState().home.architecture.openings[0].width === 0.9)
      await setNumber(page, '沿墙中心 Offset', 0)
      await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('outside its wall')))
      assert.ok(Math.abs(await page.evaluate(() => window.__store.getState().home.architecture.openings[0].offset) - 0.7) < 1e-9, 'invalid opening edit is rejected')
      await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control')
      await page.waitForFunction(() => window.__store.getState().home.architecture.openings[0].width === 0.8)
      await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control')
      await page.waitForFunction(() => window.__store.getState().home.architecture.openings[0].width === 0.9)
      await page.waitForSelector('.toast', { hidden: true, timeout: 15000 })
      assert.deepEqual(await page.evaluate(auditPrecision), [], `${name}: architectural controls overflow`)
      await page.screenshot({ path: join(output, `controls-${name}.png`) })
      await clickText(page, '顶视 Top', '[data-architecture-panel] button')
      await page.waitForFunction(() => {
        const root = window.__three.get(), delta = root.camera.position.clone().sub(root.controls.target)
        return delta.y > 10 && delta.z > 0 && Math.abs(Math.atan2(delta.x, delta.z)) < 0.001 && Math.hypot(delta.x, delta.z) / delta.y < 0.02
      })
      const compass = await page.evaluate(() => {
        const { camera, controls } = window.__three.get()
        const delta = camera.position.clone().sub(controls.target)
        const origin = controls.target.clone(), east = origin.clone(), north = origin.clone()
        east.x++; north.z--
        origin.project(camera); east.project(camera); north.project(camera)
        return { east: east.x - origin.x, north: north.y - origin.y, delta: delta.toArray(), planarRatio: Math.hypot(delta.x, delta.z) / delta.y, theta: Math.atan2(delta.x, delta.z) }
      })
      assert.ok(compass.east > 0 && compass.north > 0, 'top view is east-right and north-up')
      assert.ok(compass.planarRatio < 0.02 && Math.abs(compass.theta) < 0.001, `top camera is vertical with north-up azimuth: ${JSON.stringify(compass)}`)
      if (viewport.width < 720) {
        await page.click('.edge-toggle')
        await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1)
      }
      await page.screenshot({ path: join(output, `top-${name}.png`) })
      assert.deepEqual(errors, [], `${name}: browser errors`)
      assert.equal(calls.filter(path => path === '/api/ai/understand').length, 2)
      assert.equal(calls.some(path => path.includes('cancel') || path.includes('render')), false, 'no cancellation or rendering action is issued')
      results.push({ viewport: name, reviewMedia, originalMedia, floor, compass, browserErrors: errors, interceptedAI: calls })
      console.log(`precision-ui ${name}: modal recognition → automatic review/discard/import → contained original/close/Esc → mesh/edit/undo/redo/north-up passed`)
    } catch (error) {
      await page.screenshot({ path: join(output, `failure-${name}.png`) }).catch(() => {})
      console.error({ viewport: name, errors, calls })
      throw error
    } finally { await context.close() }
  }
} finally { await browser.close() }
await writeFile(join(output, 'verification.json'), JSON.stringify(results, null, 2))
console.log(`Precision UI screenshots: ${output}`)
