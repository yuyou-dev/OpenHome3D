import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

export function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL
  let port
  try {
    port = Number(readFileSync(new URL('../../.port', import.meta.url), 'utf8').trim())
  } catch {
    throw new Error('Start npm run dev first, or set APP_URL to the running app.')
  }
  if (!Number.isInteger(port) || port < 40000 || port > 65000) {
    throw new Error('Invalid .port cache. Start npm run dev or set APP_URL.')
  }
  return `http://127.0.0.1:${port}/`
}

export function launchBrowser() {
  return puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--hide-scrollbars', '--mute-audio', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
  })
}

/** Keep browser regressions offline from Codex, including status/login probes. */
export async function preparePage(page, mockAi) {
  const errors = []
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`CONSOLE: ${message.text().slice(0, 300)}`)
  })
  page.on('pageerror', error => errors.push(`PAGEERROR: ${String(error).slice(0, 300)}`))
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`)
  })
  await page.setRequestInterception(true)
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (!path.startsWith('/api/ai/')) return request.continue()
    if (mockAi) return mockAi(request, path)
    const body = path === '/api/ai/status'
      ? { ok: true, codex: { available: true }, busy: false, busySince: null, busyKind: null, model: 'test stub' }
      : path.endsWith('/cancel')
        ? { ok: true, cancelled: false }
        : { ok: false, code: 'error', error: 'AI calls are disabled in browser regression tests' }
    return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return errors
}
