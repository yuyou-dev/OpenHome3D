// Runtime smoke: load the app in headless system Chrome, collect console errors, screenshot.
import { appUrl, launchBrowser, preparePage } from './lib/browser.mjs'

const url = appUrl()
const out = process.env.SHOT || '/tmp/openhome3d.png'
const actions = (process.env.ACTIONS || '').split(',').filter(Boolean)
const supported = ['select-first', 'open-add', 'open-ai', 'shuffle', 'new-plan', 'loading-veil', 'furniture-bounds', 'openings-bounds']
for (const action of actions) {
  if (!supported.includes(action)) throw new Error(`Unknown ACTIONS value: ${action}; choose ${supported.join(', ')}`)
}
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  await page.setViewport({ width: Number(process.env.WIDTH || 1600), height: Number(process.env.HEIGHT || 1000), deviceScaleFactor: 1 })
  const errors = await preparePage(page)

  if (actions.includes('loading-veil')) {
    await page.evaluateOnNewDocument(() => {
      window.__loadingVeilObserved = false
      const detectVeil = () => {
        if (document.querySelector('.loading-veil:not(.done)')) {
          window.__loadingVeilObserved = true
        }
      }
      new MutationObserver(detectVeil).observe(document, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
      })
      document.addEventListener('DOMContentLoaded', detectVeil)
    })
  }

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
  if (actions.includes('loading-veil')) {
    const observed = await page.evaluate(() => window.__loadingVeilObserved === true)
    if (!observed) errors.push('ACTION FAILED: loading veil was not observed')
    try {
      await page.waitForSelector('.loading-veil', { hidden: true, timeout: 6000 })
    } catch {
      errors.push('ACTION FAILED: loading veil did not disappear')
    }
  } else {
    await new Promise((r) => setTimeout(r, 4000))
  }

  if (actions.includes('shuffle')) {
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const button = btns.find(
        (b) => b.textContent.includes('换一换') && b.textContent.includes('Shuffle'),
      )
      button?.click()
      return Boolean(button)
    })
    if (!clicked) errors.push('ACTION FAILED: 换一换 Shuffle button not found')
    await new Promise((r) => setTimeout(r, 4000))
  }

  if (actions.includes('new-plan')) {
    const before = await page.evaluate(() => {
      const state = window.__store?.getState?.()
      return { roomId: state?.home?.rooms?.[0]?.id, seed: state?.seed }
    })
    const clicked = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const button = btns.find(
        (b) => b.textContent.includes('新建方案') && b.textContent.includes('New plan'),
      )
      button?.click()
      return Boolean(button)
    })
    if (!clicked) {
      errors.push('ACTION FAILED: 新建方案 New plan button not found')
    } else {
      const pending = await page.evaluate(() => window.__store.getState().seed)
      if (pending !== before.seed) errors.push('ACTION FAILED: new plan replaced the home before confirmation')
      await page.click('.sidebar .btn-primary')
      try {
        await page.waitForFunction(
          ({ roomId, seed }) => {
            const state = window.__store?.getState?.()
            return state?.home?.rooms?.[0]?.id !== roomId && state?.seed !== seed
          },
          { timeout: 5000 },
          before,
        )
      } catch {
        errors.push('ACTION FAILED: room did not change after 新建方案')
      }
    }
  }

  if (actions.includes('open-add')) {
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      btns.find((b) => /add furniture/i.test(b.textContent))?.click()
    })
    await new Promise((r) => setTimeout(r, 3500))
  }
  if (actions.includes('open-ai')) {
    await page.evaluate(() => {
      document.querySelector('.ai-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await new Promise((r) => setTimeout(r, 2000))
  }
  if (actions.includes('select-first')) {
    // click center of canvas to try selecting a furniture piece
    await page.mouse.click(950, 520)
    await new Promise((r) => setTimeout(r, 1200))
  }
  if (actions.includes('furniture-bounds')) {
    const failures = await checkFurnitureBounds()
    failures.forEach((failure) => errors.push(`BOUNDS: ${failure}`))
  }
  if (actions.includes('openings-bounds')) {
    const failures = await checkOpeningsBounds()
    failures.forEach((failure) => errors.push(`OPENINGS: ${failure}`))
  }

  await page.screenshot({ path: out })
  console.log('SCREENSHOT', out)
  console.log('CONSOLE ERRORS:', errors.length)
  errors.slice(0, 12).forEach((e) => console.log(' -', e))
  if (errors.length) process.exitCode = 1

  // Regression for OpenHome3D issue #4: after resizing a room, every retained
  // opening must still fit inside its wall span.
  async function checkOpeningsBounds() {
    return page.evaluate(() => {
      const store = window.__store
      const failures = []
      const assertAllFit = (label) => {
        const { home } = store.getState()
        const rect = home.rooms[0].rect
        const spanFor = (side) => (side === 'n' || side === 's' ? rect.w : rect.d)
        for (const o of home.openings) {
          const span = spanFor(o.side)
          if (o.offset - o.width / 2 < -1e-9 || o.offset + o.width / 2 > span + 1e-9) {
            failures.push(`${label}: ${o.side} ${o.kind} offset=${o.offset} width=${o.width} span=${span}`)
          }
        }
      }
      const room = store.getState().home.rooms[0]
      store.getState().setRoomRect(room.id, { ...room.rect, w: 1.5 })
      store.getState().setRoomRect(room.id, { ...room.rect, w: 1.5, d: 1.5 })
      assertAllFit('shrink 1.5x1.5')
      store.getState().setRoomRect(room.id, { ...room.rect, w: 12, d: 12 })
      assertAllFit('grow 12x12')
      return failures
    })
  }

  async function checkFurnitureBounds() {
    return page.evaluate(() => {
      const store = window.__store
      const failures = []
      const EPS = 1e-6
      const near = (actual, expected, label) => {
        if (Math.abs(actual - expected) > EPS) {
          failures.push(`${label}: expected x=${expected}, got ${actual}`)
        }
      }
      const resetFixture = () => {
        store.setState((state) => {
          const room = {
            ...state.home.rooms[0],
            rect: { x: 0, z: 0, w: 4, d: 4 },
          }
          return {
            home: { rooms: [room], openings: [] },
            furniture: [],
            selectedId: null,
          }
        })
      }
      const selected = () => {
        const state = store.getState()
        return state.furniture.find((item) => item.id === state.selectedId)
      }

      resetFixture()
      store.getState().addFurniture('kenney:bathtub', [1.15, 0])
      const bathtub = selected()
      if (!bathtub) {
        failures.push('scale: bathtub fixture was not added')
      } else if (typeof store.getState().setScale !== 'function') {
        failures.push('scale: setScale action is missing')
      } else {
        store.getState().setScale(bathtub.id, 2)
        near(selected().position[0], 0.3, 'scale')
      }

      resetFixture()
      store.getState().addFurniture('builtin:side-table', [1.75, 0])
      const sideTable = selected()
      store.getState().swapModel(sideTable.id, 'builtin:sofa')
      near(selected().position[0], 0.85, 'swap')

      resetFixture()
      store.getState().addFurniture('builtin:sofa', [0, 0])
      const sofa = selected()
      store.getState().setParam(sofa.id, 'Width', 1.6)
      store.getState().moveFurniture(sofa.id, 1.2, 0)
      store.getState().setParam(sofa.id, 'Width', 3.6)
      near(selected().position[0], 0.2, 'param')

      resetFixture()
      store.getState().addFurniture('builtin:sofa', [0, 0])
      const resetSofa = selected()
      store.getState().setParam(resetSofa.id, 'Width', 1.6)
      store.getState().moveFurniture(resetSofa.id, 1.2, 0)
      store.getState().resetShape(resetSofa.id)
      near(selected().position[0], 0.85, 'reset')

      resetFixture()
      store.getState().addFurniture('builtin:plant', [1.8, 0])
      const plant = selected()
      store.getState().setParam(plant.id, 'Size', 1.2)
      near(selected().position[0], 1.5885714285714285, 'size param')

      return failures
    })
  }

} finally {
  await browser.close()
}
