/** Verify built Pages assets and AI degradation without a dev API or mocked requests. */
import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { preview } from 'vite'
import { launchBrowser } from './lib/browser.mjs'

const server = await preview({ configFile: false, base: '/OpenHome3D/', preview: { host: '127.0.0.1', port: randomInt(40000, 65001), strictPort: true } })
const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 960 })
  const errors = []
  const requests = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  page.on('request', request => requests.push(new URL(request.url()).pathname))
  await page.goto(server.resolvedUrls.local[0], { waitUntil: 'networkidle0' })
  await page.waitForSelector('.loading-veil', { hidden: true, timeout: 15000 })
  await page.click('.ai-btn')
  await page.waitForSelector('.ai-panel')
  assert.ok(await page.$eval('.ai-panel', el => el.textContent.includes('本机')))
  assert.equal(await page.$eval('.ai-panel .btn-primary', el => el.disabled), true)
  await page.screenshot({ path: '/tmp/openhome3d-pages-ai.png' })
  assert.ok(requests.some(path => path.startsWith('/OpenHome3D/models/')))
  assert.ok(requests.some(path => path.startsWith('/OpenHome3D/brand/')))
  assert.ok(!requests.some(path => path.startsWith('/models/') || path.startsWith('/brand/') || path.includes('/api/ai/')))
  assert.deepEqual(errors, [])
  console.log('Pages OK: subpath assets, loaded scene, local-only AI message, disabled render, no API requests/errors')
} finally {
  await browser.close()
  await server.close()
}
