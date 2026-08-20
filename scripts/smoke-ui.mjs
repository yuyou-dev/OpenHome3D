// Runtime smoke: load the app in headless system Chrome, collect console errors, screenshot.
import puppeteer from 'puppeteer-core'

const url = process.env.APP_URL || 'http://127.0.0.1:59683/'
const out = process.env.SHOT || '/tmp/openhome3d.png'
const actions = process.env.ACTIONS || '' // e.g. "select-first" | "open-add" | "shuffle"
const chromePath =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: 'new',
  args: ['--headless=new', '--hide-scrollbars', '--mute-audio', '--use-angle=metal'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)))
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`)
})

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
await new Promise((r) => setTimeout(r, 4000))

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

if (actions.includes('open-add')) {
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    btns.find((b) => b.textContent.includes('ADD FURNITURE'))?.click()
  })
  await new Promise((r) => setTimeout(r, 3500))
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

await page.screenshot({ path: out })
console.log('SCREENSHOT', out)
console.log('CONSOLE ERRORS:', errors.length)
errors.slice(0, 12).forEach((e) => console.log(' -', e))
await browser.close()
if (errors.length) process.exitCode = 1

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
