// Isolated browser/profile; every AI route is intercepted. No Codex calls or account data.
import assert from 'node:assert/strict'
import { appUrl, launchBrowser, preparePage } from './lib/browser.mjs'

const browser = await launchBrowser()
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1600, height: 1000 })
  let busy = true
  let available = true
  let reason
  const requests = []
  const recognitionRequests = []
  const cancellationPaths = []
  const respond = (request, body) => request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  const errors = await preparePage(page, (request, path) => {
    if (path === '/api/ai/status') return respond(request, { ok: true, codex: { available, reason }, busy, model: 'mock image_gen' })
    if (path === '/api/ai/render') {
      requests.push({ request, body: JSON.parse(request.postData()) })
      return
    }
    if (path === '/api/ai/understand') {
      if (busy) return respond(request, { ok: false, code: 'busy', kind: 'render', startedAt: Date.now(), error: 'busy' })
      recognitionRequests.push(request)
      return
    }
    if (path.endsWith('/cancel')) {
      cancellationPaths.push(path)
      busy = false
      return respond(request, { ok: true, cancelled: true })
    }
    return respond(request, { ok: false, code: 'error', error: 'Unexpected mock route' })
  })
  await page.goto(appUrl(), { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => !!window.__store && !!window.__three?.get().controls).catch(error => {
    console.error(errors)
    throw error
  })
  await page.waitForSelector('.loading-veil', { hidden: true, timeout: 15000 })
  // Import the app's exact URL (including Vite's HMR timestamp), not a second
  // bare-URL module with a different zustand singleton.
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => new URL(url).pathname === '/src/state/aiTask.ts')
    if (!moduleUrl) throw new Error('The app did not load its AI task store')
    window.__testAiTask = (await import(moduleUrl)).useAiTask
  })
  const clickText = async text => {
    const button = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.textContent.includes(text)), text)
    assert.ok(button.asElement(), `button not found: ${text}`)
    await button.asElement().click()
    await button.dispose()
  }
  const waitPhase = phase => page.waitForFunction(async phase => window.__testAiTask.getState().phase === phase, {}, phase).catch(async error => {
    console.error(errors, await page.evaluate(async () => {
      const { phase, error, result } = window.__testAiTask.getState()
      return { phase, error, resultId: result?.meta.id, marker: document.querySelector('.ai-btn')?.textContent }
    }))
    throw error
  })
  const open = async () => {
    await page.click('.ai-btn')
    await page.waitForSelector('.ai-panel')
  }
  const render = async () => {
    await page.waitForFunction(() => !document.querySelector('.ai-panel .btn-primary')?.disabled, { timeout: 7000 })
    await page.click('.ai-panel .btn-primary')
  }
  const waitRequests = async count => {
    for (let attempt = 0; attempt < 200 && requests.length < count; attempt++) await new Promise(resolve => setTimeout(resolve, 50))
    const state = requests.length === count ? '' : await page.evaluate(async () => {
      const { phase, error } = window.__testAiTask.getState()
      return JSON.stringify({ phase, error, disabled: document.querySelector('.ai-panel .btn-primary')?.disabled })
    })
    assert.equal(requests.length, count, `expected ${count} mock render requests; ${state}`)
  }
  const fixture = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 4
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff8844'
    ctx.fillRect(0, 0, 4, 4)
    const url = canvas.toDataURL('image/png')
    const { set } = await import('/node_modules/idb-keyval/dist/index.js')
    await set(`refphoto:${window.__store.getState().furniture[0].id}:0`, await (await fetch(url)).blob())
    return url
  })
  await open()
  await page.waitForFunction(() => document.querySelector('.ai-panel .btn-primary')?.disabled)
  busy = false
  await page.waitForFunction(() => !document.querySelector('.ai-panel .btn-primary')?.disabled, { timeout: 7000 })
  available = false
  reason = 'codex CLI >= 0.153.1 required for GPT-6 Astra — update: npm i -g @openai/codex@latest'
  await page.waitForFunction(() => document.querySelector('.ai-warn')?.textContent.includes('Codex 版本过旧'), { timeout: 7000 })
  assert.equal(await page.$eval('.ai-panel .btn-primary', button => button.disabled), true)
  assert.match(await page.$eval('.ai-warn', node => node.textContent), /npm i -g @openai\/codex@latest/)
  reason = 'codex CLI not logged in — run: codex login'
  await page.waitForFunction(() => document.querySelector('.ai-warn')?.textContent.includes('codex 未登录'), { timeout: 7000 })
  available = true
  reason = undefined
  await page.waitForFunction(() => !document.querySelector('.ai-panel .btn-primary')?.disabled, { timeout: 7000 })

  await page.evaluate(() => {
    const textarea = document.querySelector('.ai-panel textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, 'Keep the exact layout and framing. Test prompt.')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.select('.ai-right select:not([disabled])', '1:1')
  await render()
  await waitRequests(1)
  assert.equal(requests[0].body.images.length, 1, 'reference snapshot sent with request')
  assert.match(requests[0].body.prompt, /Test prompt/)
  await page.evaluate(() => document.querySelector('.ai-panel .btn-primary').click())
  assert.equal(requests.length, 1, 'repeat click cannot create a second task')
  await clickText('后台运行')
  await page.waitForSelector('.ai-panel', { hidden: true })
  assert.match(await page.$eval('.ai-btn', node => node.textContent), /Rendering/)
  await respond(requests[0].request, { ok: true, image: fixture, model: 'mock image_gen', aspect: '1:1', durationMs: 42 })
  await waitPhase('done')
  await open()
  await page.waitForSelector('.ai-compare img[alt="3D view"]')
  assert.equal(await page.$eval('.ai-compare img[alt="3D view"]', node => node.src), requests[0].body.image, 'comparison uses the actual request image')
  assert.match(await page.$eval('.ai-panel textarea', node => node.value), /Test prompt/, 'form survives panel close')
  const first = await page.evaluate(async () => {
    const ai = await import('/src/lib/ai.ts')
    const [meta] = await ai.historyList()
    return { meta, record: await ai.historyRecord(meta.id) }
  })
  assert.equal(first.record.source, requests[0].body.image)
  assert.deepEqual(first.record.referenceImages, requests[0].body.images)
  assert.equal(first.record.prompt, requests[0].body.prompt)

  // Changing the project and reopening history cannot replace the original source.
  await page.click('.ai-panel button[title="Close"]')
  await page.evaluate(() => window.__store.getState().newHome('studio'))
  await open()
  await page.click('.ai-hist-item')
  await page.waitForSelector('.ai-compare img[alt="3D view"]')
  assert.equal(await page.$eval('.ai-compare img[alt="3D view"]', node => node.src), first.record.source)

  // Legacy data is still a plain image in IndexedDB, with no input image to compare.
  await page.evaluate(async ({ fixture, meta }) => {
    const { set, get } = await import('/node_modules/idb-keyval/dist/index.js')
    await set('render:legacy-test', fixture)
    await set('render:index', [{ ...meta, id: 'legacy-test', ts: meta.ts + 1 }, ...await get('render:index')])
  }, { fixture, meta: first.meta })
  await page.click('.ai-panel button[title="Close"]')
  await open()
  await page.waitForFunction(() => document.querySelectorAll('.ai-hist-item').length === 2)
  await page.click('.ai-hist-item')
  await page.waitForFunction(() => document.querySelector('.ai-center').textContent.includes('Legacy render'))
  assert.equal(await page.$('.ai-compare'), null, 'legacy image has no misleading comparison')
  await clickText('全屏')
  assert.equal(await page.$('.lightbox img[alt="3D view"]'), null, 'legacy lightbox is also result only')
  await page.click('.lb-controls button:last-child')

  await render()
  await waitRequests(2)
  await clickText('后台运行')
  await open()
  await page.waitForSelector('.rendering-cancel')
  await page.click('.rendering-cancel')
  await waitPhase('idle')
  await render()
  await waitRequests(3)
  // A cancelled request may still deliver late in a mock/browser race; it must be ignored.
  await respond(requests[1].request, { ok: true, image: fixture, model: 'stale', aspect: '1:1', durationMs: 1 }).catch(() => {})
  await respond(requests[2].request, { ok: false, code: 'error', error: 'Mock render failure' })
  await waitPhase('error')
  assert.match(await page.$eval('.ai-warn.error', node => node.textContent), /Mock render failure/)
  assert.equal(await page.evaluate(async () => (await import('/src/lib/ai.ts')).historyList().then(list => list.length)), 2, 'cancelled request cannot persist a late result')

  // Exceptions during capture/reference preparation release the owner and permit retry.
  await page.evaluate(async () => {
    const useAiTask = window.__testAiTask
    await useAiTask.getState().start(async () => { throw new Error('Mock preparation failure') })
  })
  await waitPhase('error')
  assert.match(await page.$eval('.ai-warn.error', node => node.textContent), /Mock preparation failure/)
  await render()
  await waitRequests(4)
  await respond(requests[3].request, { ok: true, image: fixture, model: 'mock image_gen', aspect: '1:1', durationMs: 42 })
  await waitPhase('done')
  // Cancelling asynchronous preparation cannot launch a request after its promise resolves.
  await page.evaluate(async () => {
    const useAiTask = window.__testAiTask
    const input = { image: 'unused', images: [], prompt: 'cancelled', aspect: '1:1', seed: '', presets: [] }
    let release
    const pending = useAiTask.getState().start(() => new Promise(resolve => { release = resolve }))
    useAiTask.getState().cancel()
    release(input)
    await pending
  })
  assert.equal(requests.length, 4)

  // A storage failure leaves the completed image downloadable and the task reusable.
  await render()
  await waitRequests(5)
  await page.evaluate(() => {
    window.__originalAiTransaction = IDBDatabase.prototype.transaction
    IDBDatabase.prototype.transaction = function (...args) {
      if (args[1] === 'readwrite') throw new DOMException('Mock quota exceeded', 'QuotaExceededError')
      return window.__originalAiTransaction.apply(this, args)
    }
  })
  await respond(requests[4].request, { ok: true, image: fixture, model: 'mock image_gen', aspect: '1:1', durationMs: 42 })
  await page.waitForFunction(async () => window.__testAiTask.getState().error?.includes('history could not be saved'))
  await page.evaluate(() => {
    IDBDatabase.prototype.transaction = window.__originalAiTransaction
    delete window.__originalAiTransaction
  })
  assert.equal(await page.$eval('.ai-compare img[alt="AI render"]', node => node.src), fixture)
  assert.equal(await page.evaluate(async () => (await import('/src/lib/ai.ts')).historyList().then(list => list.length)), 3, 'failed save cannot create an orphan index entry')

  // Recognition shares the backend slot: queued cancellation targets its actual owner.
  await page.click('.ai-panel button[title="Close"]')
  await page.evaluate(() => window.__store.getState().setPlanTab('home'))
  busy = true
  await page.evaluate(async fixture => {
    const file = new File([await (await fetch(fixture)).blob()], 'mock-plan.png', { type: 'image/png' })
    const input = document.querySelector('input[accept="image/png,image/jpeg"]')
    const transfer = new DataTransfer()
    transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, fixture)
  await page.waitForFunction(() => document.body.textContent.includes('Queued…'))
  await clickText('中止 Kill')
  await page.waitForFunction(() => document.body.textContent.includes('Recognizing…'))
  assert.deepEqual(cancellationPaths, ['/api/ai/render/cancel'])
  assert.equal(recognitionRequests.length, 1, 'queue resumes once when the slot is free')
  await clickText('取消 Cancel')
  await page.waitForFunction(() => document.body.textContent.includes('导入户型图 Import plan'))
  await respond(recognitionRequests[0], { ok: true, plan: { rooms: [{ id: 'late' }], overall: { widthM: 3, depthM: 3 } }, durationMs: 1 }).catch(() => {})
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)))
  assert.equal(await page.evaluate(() => document.body.textContent.includes('识别到 1 个房间')), false, 'late recognition reply cannot revive a cancelled import')
  assert.deepEqual(errors, [], 'browser console/network must remain clean')
  console.log('AI flow: status/login refresh, background/reopen/cancel, duplicate guard, source/history compatibility, failure recovery, recognition queue cancellation passed')
} finally {
  await browser.close()
}
