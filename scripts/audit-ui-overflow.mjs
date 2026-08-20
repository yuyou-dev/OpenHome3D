// UI overflow audit: drive the app through 10 UI states at 2 viewports in
// headless system Chrome and report every visible text clipping / overflow bug.
//
// Checks (per element inside .sidebar/.topbar/.statusbar/.sel-pill/.status-info/[data-modal]/.toast):
//   A. scrollWidth > clientWidth+1 (or scrollHeight > clientHeight+1) on elements
//      WITHOUT overflow auto/scroll — intentional ellipsis (text-overflow:ellipsis
//      + overflow hidden) and intentional scroll containers are skipped.
//   B. bounding rect overflowing the nearest clipping ancestor / panel root /
//      viewport padding box by > 1px horizontally (text spilling or hard-clipped
//      with no recourse, e.g. .sidebar's overflow-x:hidden).
//   C. buttons/selects whose text is clipped (clientWidth < scrollWidth) — via A.
//
// Exit code 1 when any finding, 0 when clean (regression gate).
// Env: APP_URL (default http://127.0.0.1:<.port>/), SHOT_DIR (per-state screenshots).
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync } from 'node:fs'

let port = '59683'
try {
  port = readFileSync(new URL('../.port', import.meta.url), 'utf8').trim()
} catch {
  /* fall back to default */
}
const url = process.env.APP_URL || `http://127.0.0.1:${port}/`
const SHOT_DIR = process.env.SHOT_DIR || ''
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })

const VIEWPORTS = [
  { label: '1600x1000', width: 1600, height: 1000 },
  { label: '1280x800', width: 1280, height: 800 },
]

const LONG_ROOM_NAME = 'Sitting Room Great Hall'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// in-page audit
// ---------------------------------------------------------------------------
function auditInPage() {
  const ROOT_SEL = '.sidebar, .topbar, .statusbar, .sel-pill, .status-info, [data-modal], .toast'
  const TOL = 1
  const findings = []

  const path = (el) => {
    const parts = []
    let cur = el
    while (cur && cur !== document.body && parts.length < 6) {
      let p = cur.tagName.toLowerCase()
      if (typeof cur.className === 'string' && cur.className.trim()) {
        p += '.' + cur.className.trim().split(/\s+/).slice(0, 2).join('.')
      }
      if (cur.parentElement) {
        const same = [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName)
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`
      }
      parts.unshift(p)
      cur = cur.parentElement
    }
    return parts.join(' > ')
  }

  const snippet = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 42)

  const roots = [...document.querySelectorAll(ROOT_SEL)]
  const els = new Set()
  for (const r of roots) {
    els.add(r)
    r.querySelectorAll('*').forEach((e) => els.add(e))
  }

  const seen = new Set()
  const report = (kind, el, detail) => {
    const key = `${kind}|${path(el)}|${detail}`
    if (seen.has(key)) return
    seen.add(key)
    findings.push({ kind, path: path(el), text: snippet(el), detail })
  }

  const vw = window.innerWidth

  for (const el of els) {
    if (!el.isConnected) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    // deliberately parked offscreen (e.g. the parametric thumbnail worker canvas)
    if (rect.right < -50 || rect.left > vw + 50) continue

    // ---- check A/C: content clipped inside the element --------------------
    const cw = el.clientWidth
    const ch = el.clientHeight
    const sw = el.scrollWidth
    const sh = el.scrollHeight
    const ox = cs.overflowX
    const oy = cs.overflowY
    const tag = el.tagName
    const hasDirectText = [...el.childNodes].some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '',
    )
    const isControl = tag === 'SELECT' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA'
    if (cw > 0 && (hasDirectText || isControl)) {
      const ellipsis = cs.textOverflow === 'ellipsis' && (ox === 'hidden' || ox === 'clip')
      if (sw > cw + TOL && ox !== 'auto' && ox !== 'scroll' && !ellipsis) {
        report(isControl ? 'control-text-clipped-x' : 'text-clipped-x', el, `+${sw - cw}px`)
      }
    }
    if (ch > 0 && sh > ch + TOL && oy !== 'auto' && oy !== 'scroll') {
      // vertical clip: only meaningful for elements holding text/controls;
      // textless native controls (range/checkbox) report bogus scrollHeight
      const textlessInput =
        tag === 'INPUT' && !['text', 'number', 'search', 'email', 'url', 'tel', 'password'].includes(el.type)
      if ((hasDirectText || isControl) && !textlessInput) {
        report('text-clipped-y', el, `+${sh - ch}px`)
      }
    }

    // ---- check B: element spilling past its clipping ancestor / panel -----
    // fixed-position elements are viewport-contained by definition — only
    // compare them against the viewport (e.g. the display-menu backdrop).
    if (cs.position === 'fixed') {
      const overL = 0 - rect.left
      const overR = rect.right - vw
      if (overL > TOL || overR > TOL) {
        report('spills-viewport', el, `${Math.max(overL, overR).toFixed(0)}px`)
      }
      continue
    }
    let p = el.parentElement
    while (p) {
      const pcs = getComputedStyle(p)
      const pox = pcs.overflowX
      if (pox === 'auto' || pox === 'scroll') break // user can scroll to it: OK
      if (pox === 'hidden' || pox === 'clip' || p.matches(ROOT_SEL) || p === document.body) {
        const pr = p.getBoundingClientRect()
        const boxL = pr.left + p.clientLeft
        const boxR = boxL + p.clientWidth
        const overL = boxL - rect.left
        const overR = rect.right - boxR
        if (overL > TOL || overR > TOL) {
          // report only the outermost offender of this branch (parent spills too)
          const pr2 = p.parentElement ? el.parentElement.getBoundingClientRect() : null
          const parentSpills =
            el.parentElement &&
            el.parentElement !== p &&
            pr2 &&
            (boxL - pr2.left > TOL || pr2.right - boxR > TOL)
          if (!parentSpills) {
            const side = overL > TOL && overR > TOL ? 'both' : overL > TOL ? 'left' : 'right'
            report(
              'spills-' + side,
              el,
              `${Math.max(overL, overR).toFixed(0)}px past ${p.tagName.toLowerCase()}${typeof p.className === 'string' && p.className.trim() ? '.' + p.className.trim().split(/\s+/)[0] : ''}`,
            )
          }
        }
        break
      }
      p = p.parentElement
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// state drivers
// ---------------------------------------------------------------------------
async function evalStore(page, fn) {
  await page.evaluate(fn)
  await sleep(450)
}

async function closeAnyModal(page) {
  await page.evaluate(() => {
    // model browser / upload modal close button
    const btns = [...document.querySelectorAll('[data-modal] .modal-head .icon-btn')]
    btns[btns.length - 1]?.click()
    document.querySelector('.display-backdrop')?.click()
  })
  await sleep(300)
}

const STATES = [
  {
    id: 'S1-default',
    async setup(page) {
      await evalStore(page, () => {
        window.__store.getState().select(null)
      })
    },
  },
  {
    id: 'S2-studio',
    async setup(page) {
      await evalStore(page, () => {
        const s = window.__store.getState()
        s.setRoomType('studio')
        s.select(null)
      })
    },
  },
  {
    id: 'S3-longname',
    async setup(page) {
      await evalStore(page, () => {
        const st = window.__store
        window.__origRoomName = st.getState().home.rooms[0].name
        st.setState((cur) => ({
          home: {
            ...cur.home,
            rooms: cur.home.rooms.map((r, i) => (i === 0 ? { ...r, name: 'Sitting Room Great Hall' } : r)),
          },
        }))
      })
    },
  },
  {
    id: 'S4-restore',
    async setup(page) {
      await evalStore(page, () => {
        const st = window.__store
        st.setState((cur) => ({
          home: {
            ...cur.home,
            rooms: cur.home.rooms.map((r, i) => (i === 0 ? { ...r, name: window.__origRoomName } : r)),
          },
        }))
        st.getState().setRoomType('living')
      })
    },
  },
  {
    id: 'S5-select-first',
    async setup(page) {
      await evalStore(page, () => {
        const s = window.__store.getState()
        const f = s.furniture[0]
        if (f) s.select(f.id)
      })
    },
  },
  {
    id: 'S5b-select-parametric',
    async setup(page) {
      await evalStore(page, () => {
        const s = window.__store.getState()
        const para = s.furniture.filter((f) => f.modelId.startsWith('builtin:'))
        const pick = para.find((f) => f.modelId.includes('sofa')) ?? para[0] ?? s.furniture[0]
        if (pick) s.select(pick.id)
      })
    },
  },
  {
    id: 'S6-modal-add',
    async setup(page) {
      await closeAnyModal(page)
      await page.evaluate(() => {
        ;[...document.querySelectorAll('.sidebar button')]
          .find((b) => b.textContent.includes('添加家具'))
          ?.click()
      })
      await page.waitForSelector('.mb-grid .card', { timeout: 20000 })
      await sleep(900)
    },
  },
  {
    id: 'S7-display-menu',
    async setup(page) {
      await closeAnyModal(page)
      await page.evaluate(() => {
        ;[...document.querySelectorAll('.topbar button')]
          .find((b) => (b.title || '').includes('Display'))
          ?.click()
      })
      await page.waitForSelector('.display-pop', { timeout: 5000 })
      await sleep(300)
    },
  },
  {
    id: 'S9-toast',
    async setup(page) {
      await closeAnyModal(page)
      await page.evaluate(() => {
        ;[...document.querySelectorAll('.sidebar button')]
          .find((b) => b.textContent.includes('添加家具'))
          ?.click()
      })
      await page.waitForSelector('.mb-grid .card', { timeout: 20000 })
      await sleep(600)
      await page.click('.mb-grid .card') // picking a model toasts "已添加 — 拖拽放置"
      await sleep(400)
    },
  },
  {
    id: 'S10-pill-longlabel',
    async setup(page) {
      // let the S9 toast expire so this state is clean
      await page
        .waitForFunction(() => !document.querySelector('.toast'), { timeout: 8000 })
        .catch(() => {})
      await evalStore(page, () => {
        const s = window.__store.getState()
        const longest = s.furniture.reduce(
          (a, b) => (b.label.length > (a?.label.length ?? -1) ? b : a),
          null,
        )
        if (longest) s.select(longest.id)
      })
    },
  },
]

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const browser = await puppeteer.launch({
  executablePath:
    process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--headless=new', '--hide-scrollbars', '--mute-audio', '--use-angle=metal'],
})

const allFindings = []
let n = 0

for (const vp of VIEWPORTS) {
  const page = await browser.newPage()
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)))
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`)
  })
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
  await page.waitForFunction(() => !!window.__store, { timeout: 15000 })
  await sleep(2500)

  for (const st of STATES) {
    try {
      await st.setup(page)
    } catch (e) {
      allFindings.push({ viewport: vp.label, state: st.id, kind: 'SETUP-FAIL', path: '', text: '', detail: String(e).slice(0, 160) })
      continue
    }
    const found = await page.evaluate(auditInPage)
    for (const f of found) {
      n += 1
      allFindings.push({ viewport: vp.label, state: st.id, ...f })
      console.log(
        `${String(n).padStart(3)}. [${vp.label} ${st.id}] ${f.kind} ${f.path} — "${f.text}" ${f.detail}`,
      )
    }
    if (SHOT_DIR) {
      await page.screenshot({ path: `${SHOT_DIR}/${vp.label}-${st.id}.png` })
    }
  }
  if (errors.length) {
    console.log(`PAGE ERRORS [${vp.label}]:`)
    errors.slice(0, 8).forEach((e) => console.log('   -', e))
    errors.forEach((detail) => {
      const kind = detail.startsWith('PAGEERROR:')
        ? 'PAGEERROR'
        : detail.startsWith('HTTP ')
          ? 'HTTP_ERROR'
          : 'CONSOLE_ERROR'
      allFindings.push({
        viewport: vp.label,
        state: 'runtime',
        kind,
        path: '',
        text: '',
        detail,
      })
    })
  }
  await page.close()
}

await browser.close()
console.log(allFindings.length === 0 ? '\nAUDIT CLEAN — no overflow findings.' : `\n${allFindings.length} finding(s).`)
process.exit(allFindings.length === 0 ? 0 : 1)
