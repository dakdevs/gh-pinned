import type { Page } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fixture } from './fixtures'
import { artifactsPath, browser } from './harness'

function anchorPage() {
  return fixture({ repo: 'acme/rocket', nativeSticky: true })
    .replace('<html lang="en"', '<html style="scroll-padding-top:12px!important" lang="en"')
    .replace(
      '</style>',
      '.GlobalNav { height:112px; } #anchor-spacer { height:1200px; } #anchor-tail { height:1600px; }</style>',
    )
    .replace(
      '</main>',
      '<a id="anchor-jump" href="#anchor-target">Jump to section</a><div id="anchor-spacer"></div><h2 id="anchor-target" style="scroll-margin-top:112px!important">Anchor destination</h2><div id="anchor-tail"></div></main>',
    )
}

function anchorGeometry() {
  return {
    targetTop: window.fixtureElement('h2', '#anchor-target').getBoundingClientRect().top,
    barHeight: window.fixtureElement('div', '#ghpin-root').getBoundingClientRect().height,
    nativeTop: window.fixtureElement('header', '.GlobalNav').getBoundingClientRect().top,
    nativeBottom: window.fixtureElement('header', '.GlobalNav').getBoundingClientRect().bottom,
    padding: getComputedStyle(document.documentElement).scrollPaddingTop,
    margin: getComputedStyle(window.fixtureElement('h2', '#anchor-target')).scrollMarginTop,
  }
}

async function waitForBar(page: Page) {
  await page.locator('#ghpin-bar').waitFor()

  await page.waitForFunction(() => {
    return window.fixtureElement('header', '.GlobalNav').getBoundingClientRect().top === 48
  })
}

async function captureAnchorPosition(page: Page, phase: string) {
  // Anchor scrolling is native browser behavior. Allow its layout to paint,
  // then inspect the result rather than polling until a desired answer appears.
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })

  const geometry = await page.evaluate(anchorGeometry)

  await mkdir(artifactsPath, { recursive: true })

  await page.screenshot({ path: path.join(artifactsPath, `anchor-${phase}.png`) })

  return geometry
}

function expectAnchorPosition(
  geometry: Awaited<ReturnType<typeof captureAnchorPosition>>,
  phase: string,
  expected: number,
) {
  assert.ok(
    geometry.targetTop >= geometry.nativeBottom,
    `${phase}: the target must clear the native header: ${JSON.stringify(geometry)}`,
  )

  assert.ok(
    Math.abs(geometry.targetTop - expected) <= 0.5,
    `${phase}: preserve existing spacing and add the strip once: expected ${expected}, ${JSON.stringify(geometry)}`,
  )
}

async function setStripVisible(page: Page, visible: boolean) {
  await page.locator('#ghpin-root').evaluate((host, visible) => {
    host.style.display = visible ? '' : 'none'
  }, visible)

  await page.waitForFunction((visible) => {
    return (
      window.fixtureElement('header', '.GlobalNav').getBoundingClientRect().top ===
      (visible ? 48 : 0)
    )
  }, visible)
}

function inlinePadding() {
  return [
    document.documentElement.style.getPropertyValue('scroll-padding-top'),
    document.documentElement.style.getPropertyPriority('scroll-padding-top'),
  ]
}

async function scrollTarget(page: Page, phase: string) {
  await page.locator('#anchor-target').evaluate((target) => {
    target.scrollIntoView({ block: 'start' })
  })

  return captureAnchorPosition(page, phase)
}

await test('native anchor navigation adds the repository strip to existing page scroll spacing exactly once', async (t) => {
  const context = await browser(t, new Map())

  await context.route('https://github.com/acme/rocket', (route) => {
    return route.fulfill({ contentType: 'text/html', body: anchorPage() })
  })

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await waitForBar(page)

  await page.locator('#anchor-jump').click()

  // Native header112 + page padding12 + fixed strip48 = target172.
  // Counting the native header a second time would incorrectly land at284.
  const click = await captureAnchorPosition(page, 'click')

  await page.evaluate(() => {
    scrollTo(0, 0)

    window.fixtureElement('h2', '#anchor-target').scrollIntoView({ block: 'start' })
  })

  const intoView = await captureAnchorPosition(page, 'scroll-into-view')

  const direct = await context.newPage()

  await direct.goto('https://github.com/acme/rocket#anchor-target')

  await waitForBar(direct)

  const fragment = await captureAnchorPosition(direct, 'direct-fragment')

  expectAnchorPosition(click, 'click', 172)

  expectAnchorPosition(intoView, 'scroll-into-view', 172)

  expectAnchorPosition(fragment, 'direct-fragment', 172)
})

await test('anchor offsets follow measured strip height and restore page-owned inline spacing when the strip has no height', async (t) => {
  const context = await browser(t, new Map())

  await context.route('https://github.com/acme/rocket', (route) => {
    return route.fulfill({ contentType: 'text/html', body: anchorPage() })
  })

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await waitForBar(page)

  await page.locator('#ghpin-bar').evaluate((bar) => {
    bar.style.minHeight = '84px'
  })

  await page.waitForFunction(() => {
    return window.fixtureElement('header', '.GlobalNav').getBoundingClientRect().top === 84
  })

  await page.locator('#anchor-target').evaluate((target) => {
    target.scrollIntoView({ block: 'start' })
  })

  const expanded = await captureAnchorPosition(page, 'expanded')

  assert.equal(expanded.barHeight, 84)

  assert.equal(expanded.padding, '96px')

  expectAnchorPosition(expanded, 'expanded', 208)

  await page.locator('#ghpin-root').evaluate((host) => {
    host.style.display = 'none'
  })

  await page.waitForFunction(() => {
    return window.fixtureElement('header', '.GlobalNav').getBoundingClientRect().top === 0
  })

  const restored = await page.evaluate(() => {
    const target = window.fixtureElement('h2', 'main h2')

    return {
      padding: document.documentElement.style.getPropertyValue('scroll-padding-top'),
      paddingPriority: document.documentElement.style.getPropertyPriority('scroll-padding-top'),
      margin: target.style.getPropertyValue('scroll-margin-top'),
      marginPriority: target.style.getPropertyPriority('scroll-margin-top'),
      reserveHeight: window.fixtureElement('div', '#ghpin-slot').getBoundingClientRect().height,
    }
  })

  assert.deepEqual(restored, {
    padding: '12px',
    paddingPriority: 'important',
    margin: '112px',
    marginPriority: 'important',
    reserveHeight: 0,
  })

  await page.locator('#anchor-target').evaluate((target) => {
    target.scrollIntoView({ block: 'start' })
  })

  expectAnchorPosition(await captureAnchorPosition(page, 'hidden'), 'hidden', 124)

  await page.locator('#ghpin-root').evaluate((host) => {
    host.style.removeProperty('display')

    window.fixtureElement('nav', 'nav', host).style.removeProperty('min-height')
  })

  await waitForBar(page)

  await page.locator('#anchor-target').evaluate((target) => {
    target.scrollIntoView({ block: 'start' })
  })

  expectAnchorPosition(await captureAnchorPosition(page, 'restored'), 'restored', 172)
})

await test('anchor spacing keeps native percentage expressions and adopts later page-owned declarations', async (t) => {
  const context = await browser(t, new Map())

  await context.route('https://github.com/acme/rocket', (route) => {
    const html = anchorPage()
      .replace('scroll-padding-top:12px!important', '')
      .replace('</style>', ':root { scroll-padding-top:calc(2% + 7px); }</style>')

    return route.fulfill({ contentType: 'text/html', body: html })
  })

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await waitForBar(page)

  // At viewport800, native2% +7px is23px. Add margin112 +strip48.
  expectAnchorPosition(await scrollTarget(page, 'percentage'), 'percentage', 183)

  await setStripVisible(page, false)

  assert.deepEqual(await page.evaluate(inlinePadding), ['', ''])

  expectAnchorPosition(await scrollTarget(page, 'percentage-hidden'), 'percentage-hidden', 135)

  await setStripVisible(page, true)

  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-padding-top', '24px', 'important')

    scrollBy(0, 1)
  })

  await page.waitForFunction(() => {
    return getComputedStyle(document.documentElement).scrollPaddingTop === '72px'
  })

  expectAnchorPosition(await scrollTarget(page, 'page-updated'), 'page-updated', 184)

  await setStripVisible(page, false)

  assert.deepEqual(await page.evaluate(inlinePadding), ['24px', 'important'])

  expectAnchorPosition(await scrollTarget(page, 'page-updated-hidden'), 'page-updated-hidden', 136)

  await page.evaluate(() => {
    document.documentElement.style.setProperty('scroll-padding-top', '12px', 'important')

    document.documentElement.style.setProperty('scroll-padding-block-start', '24px', 'important')
  })

  await setStripVisible(page, true)

  await scrollTarget(page, 'logical-first')

  expectAnchorPosition(await scrollTarget(page, 'logical-current'), 'logical-current', 184)

  await setStripVisible(page, false)

  const logical = await page.evaluate(() => {
    const style = document.documentElement.style

    return {
      top: style.getPropertyValue('scroll-padding-top'),
      topPriority: style.getPropertyPriority('scroll-padding-top'),
      block: style.getPropertyValue('scroll-padding-block-start'),
      blockPriority: style.getPropertyPriority('scroll-padding-block-start'),
      native: getComputedStyle(document.documentElement).scrollPaddingTop,
    }
  })

  assert.deepEqual(logical, {
    top: '12px',
    topPriority: 'important',
    block: '24px',
    blockPriority: 'important',
    native: '24px',
  })

  expectAnchorPosition(await scrollTarget(page, 'logical-hidden'), 'logical-hidden', 136)
})
