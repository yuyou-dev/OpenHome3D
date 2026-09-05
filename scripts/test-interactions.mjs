// Browser regression gate. AI endpoints are intercepted by preparePage.
import assert from 'node:assert/strict'
import { appUrl, launchBrowser, preparePage } from './lib/browser.mjs'

const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  const errors = await preparePage(page)
  await page.goto(appUrl(), { waitUntil: 'networkidle0', timeout: 60000 })
  assert.match(await page.title(), /家居生成器 Cartoon/)
  await page.waitForFunction(() => !!window.__store && !!window.__three?.get().controls)
  await page.waitForSelector('.loading-veil', { hidden: true, timeout: 10000 })
  assert.equal(await page.$('vite-error-overlay'), null)
  await page.waitForSelector('.topbar button')

  const clickText = async (text) => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text)), text)
    assert.ok(handle.asElement(), `button not found: ${text}`)
    await handle.asElement().click()
    await handle.dispose()
  }
  const modelState = () => page.evaluate(() => {
    const s = window.__store.getState()
    return { selected: s.selectedId, furniture: s.furniture }
  })

  // Rebuild must reproduce the same generated furniture for a fixed seed.
  assert.equal(await page.evaluate(() => {
    const s = () => window.__store.getState()
    s().setSeed('DETERM1')
    const before = JSON.stringify(s().furniture)
    s().rebuild()
    return before === JSON.stringify(s().furniture)
  }), true, 'rebuild must be deterministic')

  // Add a centered item to avoid nudging a wall-clamped layout fixture.
  await clickText('添加家具')
  await page.waitForSelector('.mb-grid .card')
  const beforeAdd = (await modelState()).furniture.length
  await page.click('.mb-grid .card')
  await page.waitForSelector('.mb-grid', { hidden: true })
  let state = await modelState()
  assert.equal(state.furniture.length, beforeAdd + 1, 'add card must insert furniture')
  const id = state.selected
  await page.evaluate(id => window.__store.getState().moveFurniture(id, 0, 0), id)
  const original = (await modelState()).furniture.find(f => f.id === id)
  await page.waitForSelector('.sel-pill')
  await page.keyboard.press('e')
  await page.waitForFunction(({ id, rotation }) => window.__store.getState().furniture.find(f => f.id === id).rotationY !== rotation, {}, { id, rotation: original.rotationY })
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(({ id, x }) => window.__store.getState().furniture.find(f => f.id === id).position[0] !== x, {}, { id, x: original.position[0] })

  // Target controls by their accessible titles, never by button index.
  await page.click('.sel-pill button[title*="Swap model"]')
  await page.waitForSelector('.mb-grid .card')
  const beforeSwap = (await modelState()).furniture.find(f => f.id === id).modelId
  await page.locator('.mb-grid .card:not(.current)').click()
  await page.waitForSelector('.mb-grid', { hidden: true })
  const swapped = (await modelState()).furniture.find(f => f.id === id)
  assert.notEqual(swapped.modelId, beforeSwap, 'swap must change the selected model')
  await page.click('.topbar button[title*="Undo"]')
  assert.equal((await modelState()).furniture.find(f => f.id === id).modelId, beforeSwap)
  await page.click('.topbar button[title*="Redo"]')
  assert.equal((await modelState()).furniture.find(f => f.id === id).modelId, swapped.modelId)

  await page.click('.sel-pill button[title*="Duplicate"]')
  state = await modelState()
  assert.equal(state.furniture.length, beforeAdd + 2)
  assert.notEqual(state.selected, id)
  await page.click('.sel-pill button[title*="Delete"]')
  assert.equal((await modelState()).furniture.length, beforeAdd + 1)

  // Check the live Three camera, not just the projection flag in the store.
  await page.evaluate(() => window.__store.getState().setProjection('perspective'))
  await page.waitForFunction(() => window.__three.get().camera.isPerspectiveCamera)
  await page.evaluate(() => window.__store.getState().setProjection('isometric'))
  await page.waitForFunction(() => window.__three.get().camera.isOrthographicCamera)

  // Replaces the old one-off shot-edge script with assertions.
  const expanded = await page.$eval('.edge-toggle', element => element.getBoundingClientRect().x)
  await page.click('.edge-toggle')
  await page.waitForFunction(x => document.querySelector('.edge-toggle').getBoundingClientRect().x < x - 100, {}, expanded)
  await page.click('.edge-toggle')
  await page.waitForFunction(x => Math.abs(document.querySelector('.edge-toggle').getBoundingClientRect().x - x) < 2, {}, expanded)

  const beforeNew = await page.evaluate(() => window.__store.getState().exportProject())
  await clickText('新建方案')
  assert.equal(await page.evaluate(() => window.__store.getState().exportProject()), beforeNew, 'new plan must wait for confirmation')
  await clickText('Confirm replace')
  assert.notEqual(await page.evaluate(() => window.__store.getState().exportProject()), beforeNew)
  await page.click('.topbar button[title*="Undo"]')
  assert.equal(await page.evaluate(() => window.__store.getState().exportProject()), beforeNew, 'undo must restore the entire plan')

  // Opening AI is sufficient here; no render submission is part of this test.
  await page.click('.ai-btn')
  await page.waitForSelector('.ai-panel')
  await page.screenshot({ path: process.env.SHOT || '/tmp/openhome3d-interactions.png' })
  assert.deepEqual(errors, [], 'browser must have no console, page or HTTP errors')
  console.log('interactions OK: page identity, load, add, keyboard, swap, undo/redo, duplicate/delete, live camera, sidebar, new-plan confirmation, AI panel (stubbed)')
} finally {
  await browser.close()
}
