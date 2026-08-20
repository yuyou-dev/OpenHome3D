// Runtime smoke: load the app in headless system Chrome, collect console errors, screenshot.
import puppeteer from 'puppeteer-core'

const url = process.env.APP_URL || 'http://127.0.0.1:59683/'
const out = process.env.SHOT || '/tmp/openhome3d.png'
const actions = process.env.ACTIONS || '' // e.g. "select-first" | "open-add" | "shuffle" | "new-room" | "loading-veil"
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

if (actions.includes('new-room')) {
  const before = await page.evaluate(() => {
    const state = window.__store?.getState?.()
    return { roomId: state?.home?.rooms?.[0]?.id, seed: state?.seed }
  })
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const button = btns.find(
      (b) => b.textContent.includes('新建房间') && b.textContent.includes('New room'),
    )
    button?.click()
    return Boolean(button)
  })
  if (!clicked) {
    errors.push('ACTION FAILED: 新建房间 New room button not found')
  } else {
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
      errors.push('ACTION FAILED: New room did not replace the room and seed')
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
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

await page.screenshot({ path: out })
console.log('SCREENSHOT', out)
console.log('CONSOLE ERRORS:', errors.length)
errors.slice(0, 12).forEach((e) => console.log(' -', e))
await browser.close()
if (errors.length) process.exitCode = 1
