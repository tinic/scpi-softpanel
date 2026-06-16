#!/usr/bin/env node
// Capture docs/screenshot.png (or any output) from the running SCPI SoftPanel UI.
//
//   node scripts/screenshot.mjs [url] [outPath]
//     url      default http://localhost:8080   (scpi-server must be running AND
//              connected to the meter so the readout shows a live value)
//     outPath  default docs/screenshot.png
//
// Why this exists: the dev/CI host has no system Chrome and no sudo to install
// one, and the @playwright/mcp server insists on a browser it can't fetch here.
// So we drive playwright-core directly against the chromium that the npx cache
// already downloaded under ~/.cache/ms-playwright. This script encapsulates the
// fiddly part — picking the playwright-core copy whose bundled chromium revision
// is actually installed — so it never has to be re-derived by hand.
//
// Overrides (rarely needed): PLAYWRIGHT_CORE_DIR=<dir containing index.mjs>,
// PLAYWRIGHT_BROWSERS_PATH=<ms-playwright cache>.

import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const url = process.argv[2] || 'http://localhost:8080'
const out = process.argv[3] || 'docs/screenshot.png'

const browsersPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright')

// True if playwright-core at `dir` bundles a chromium revision that is installed
// in the ms-playwright cache (otherwise launch fails with "browser not found").
function chromiumIsInstalled(dir) {
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'browsers.json'), 'utf8'))
    const chromium = meta.browsers.find((b) => b.name === 'chromium')
    if (!chromium) return false
    return existsSync(join(browsersPath, `chromium-${chromium.revision}`))
  } catch {
    return false
  }
}

// Candidate playwright-core locations: explicit override, a local install, then
// every copy the npx cache has fetched (there can be several at different revs).
function findPlaywrightCore() {
  const candidates = []
  if (process.env.PLAYWRIGHT_CORE_DIR) candidates.push(process.env.PLAYWRIGHT_CORE_DIR)
  candidates.push(join(process.cwd(), 'node_modules', 'playwright-core'))
  const npx = join(homedir(), '.npm', '_npx')
  try {
    for (const hash of readdirSync(npx)) {
      candidates.push(join(npx, hash, 'node_modules', 'playwright-core'))
    }
  } catch {
    /* no npx cache */
  }
  const usable = candidates.filter((d) => existsSync(join(d, 'index.mjs')))
  return usable.find(chromiumIsInstalled) || usable[0]
}

const coreDir = findPlaywrightCore()
if (!coreDir) {
  console.error(
    'No playwright-core with an installed chromium found. Set PLAYWRIGHT_CORE_DIR, or run\n' +
      '  npx @playwright/mcp@latest --browser chromium --help\n' +
      'once to populate ~/.cache/ms-playwright.',
  )
  process.exit(1)
}
process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath

const { chromium } = await import(pathToFileURL(join(coreDir, 'index.mjs')).href)

const browser = await chromium.launch({ headless: true })
// 1280 logical width at 2x → a crisp 2560-wide PNG, matching docs/screenshot.png.
// Tall viewport so the content-height crop below is never capped by the viewport.
const page = await browser.newPage({
  viewport: { width: 1280, height: 1200 },
  deviceScaleFactor: 2,
})
await page.goto(url, { waitUntil: 'networkidle' })
// Wait for the live value to render, then let the WS stream a few readings so the
// trend chart has a line in it.
await page
  .locator('.num')
  .first()
  .waitFor({ timeout: 10_000 })
  .catch(() => {})
await page.waitForTimeout(1500)

// Crop to the app's actual content height so there's no dead viewport space below.
const height = await page.evaluate(() => {
  const app = document.querySelector('#app')
  return Math.ceil((app ?? document.body).getBoundingClientRect().height)
})
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height } })
await browser.close()
console.log(`wrote ${out} (1280x${height} @2x) from ${url}`)
console.log(`(playwright-core: ${coreDir})`)
