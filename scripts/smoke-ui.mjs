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

await page.screenshot({ path: out })
console.log('SCREENSHOT', out)
console.log('CONSOLE ERRORS:', errors.length)
errors.slice(0, 12).forEach((e) => console.log(' -', e))
await browser.close()
if (errors.length) process.exitCode = 1
