import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browser, expectRepos, shortcut } from './harness'

function stripIsFixedAtTop() {
  const host = document.querySelector('#ghpin-root')

  return (
    host instanceof HTMLElement &&
    host.parentElement === document.body &&
    getComputedStyle(host).position === 'fixed' &&
    host.getBoundingClientRect().top === 0
  )
}

function nativeHeaderIsBelowStrip() {
  return (
    document.querySelector('.GlobalNav').getBoundingClientRect().top >=
    document.querySelector('#ghpin-bar').getBoundingClientRect().bottom
  )
}

function placement() {
  const host = document.querySelector('#ghpin-root')

  const bar = document.querySelector('#ghpin-bar').getBoundingClientRect()

  const header = document.querySelector('.GlobalNav')

  const slot = document.querySelector('#ghpin-slot')

  return {
    top: bar.top,
    bottom: bar.bottom,
    height: bar.height,
    width: host.getBoundingClientRect().width,
    parent: host.parentElement.tagName,
    firstBodyElement: document.body.firstElementChild.id,
    reservationFollowsHost: host.nextElementSibling === slot,
    reservationHeight: slot.getBoundingClientRect().height,
    mainTop: document.querySelector('main').getBoundingClientRect().top + scrollY,
    nativeTop: header.getBoundingClientRect().top,
    nativeBottom: header.getBoundingClientRect().bottom,
    nativePosition: getComputedStyle(header).position,
  }
}

/** @param {import('playwright').Page} page */
async function expectTopPlacement(page) {
  await page.waitForFunction(stripIsFixedAtTop)

  await page.waitForFunction(nativeHeaderIsBelowStrip)

  const state = await page.evaluate(placement)

  assert.equal(state.top, 0)

  assert.equal(state.parent, 'BODY')

  assert.equal(state.firstBodyElement, 'ghpin-root')

  assert.equal(state.reservationFollowsHost, true)

  assert.equal(state.reservationHeight, state.height)

  assert.ok(state.nativeTop >= state.bottom, 'The whole native header must start below the strip')

  return state
}

/** @param {import('playwright').Page} page */
async function expectNestedHeaderPositions(page) {
  await page.waitForFunction(() => {
    return (
      document.querySelector('.GlobalNav').getBoundingClientRect().top ===
      document.querySelector('#ghpin-bar').getBoundingClientRect().bottom
    )
  })

  const bounds = await page.evaluate(() => {
    return {
      barBottom: document.querySelector('#ghpin-bar').getBoundingClientRect().bottom,
      outerTop: document.querySelector('.GlobalNav').getBoundingClientRect().top,
      innerTop: document.querySelector('#nested-native-nav').getBoundingClientRect().top,
    }
  })

  assert.equal(bounds.outerTop, bounds.barBottom)

  assert.equal(
    bounds.innerTop,
    bounds.outerTop,
    'A nested header must not receive the strip offset twice',
  )
}

await test('the repository strip is always above global headers, reserves content space, and offsets native sticky and fixed navigation once', async (t) => {
  const context = await browser(
    t,
    new Map([
      ['/acme/rocket', { repo: 'acme/rocket', tall: true, nativeSticky: true }],
      ['/octo/tools', { repo: 'octo/tools', tall: true, nativeFixed: true }],
    ]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  const baseline = await expectTopPlacement(page)

  assert.equal(baseline.nativePosition, 'sticky')

  await shortcut(page, 'acme/rocket').click({ trial: true })

  await page.evaluate(() => {
    scrollTo(0, 500)
  })

  const scrolled = await expectTopPlacement(page)

  assert.equal(scrolled.width, 1280)

  assert.equal(
    scrolled.mainTop,
    baseline.mainTop,
    'Scrolling must preserve the document position of content',
  )

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '80px')
  })

  await page.setViewportSize({ width: 760, height: 800 })

  await page.waitForFunction(() => {
    return document.querySelector('#ghpin-root').getBoundingClientRect().width === 760
  })

  await page.waitForFunction(() => {
    return getComputedStyle(document.querySelector('.GlobalNav')).top === '80px'
  })

  assert.equal((await expectTopPlacement(page)).nativeTop, 80)

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '0px')

    window.dispatchEvent(new Event('resize'))
  })

  await expectTopPlacement(page)

  await page.evaluate(() => {
    history.pushState({}, '', '/acme/rocket/issues')

    const replacement = document.createElement('header')

    replacement.className = 'GlobalNav'

    replacement.innerHTML =
      '<div class="global-row" data-component="Stack" data-direction="horizontal">Replacement global header</div><nav class="repo-nav" aria-label="Repository"><a href="/acme/rocket">Code</a></nav>'

    document.querySelector('.GlobalNav').replaceWith(replacement)
  })

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  const beforeClone = await expectTopPlacement(page)

  assert.equal(await page.locator('#ghpin-slot').count(), 1)

  assert.equal(await page.locator('#ghpin-root').count(), 1)

  await page.locator('.GlobalNav').evaluate((header) => {
    header.replaceWith(header.cloneNode(true))

    document.dispatchEvent(new Event('turbo:render'))
  })

  await expectTopPlacement(page)

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '80px')

    window.dispatchEvent(new Event('resize'))
  })

  await page.waitForFunction(() => {
    return getComputedStyle(document.querySelector('.GlobalNav')).top === '80px'
  })

  assert.equal(
    (await expectTopPlacement(page)).nativeTop,
    80,
    'A cloned header must recover its responsive native top',
  )

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '0px')

    window.dispatchEvent(new Event('resize'))
  })

  await page.evaluate(() => {
    scrollTo(0, 0)
  })

  const returned = await expectTopPlacement(page)

  assert.equal(
    returned.mainTop,
    beforeClone.mainTop,
    'Returning to scroll zero must not shift content or relocate the bar',
  )

  await page.goto('https://github.com/octo/tools')

  await expectRepos(page, ['octo/tools'], 'octo/tools')

  const fixedBaseline = await expectTopPlacement(page)

  assert.equal(fixedBaseline.nativePosition, 'fixed')

  assert.ok(
    fixedBaseline.mainTop >= fixedBaseline.nativeBottom,
    `A native fixed header must retain its own content reservation: ${JSON.stringify(fixedBaseline)}`,
  )

  await page.evaluate(() => {
    scrollTo(0, 700)
  })

  assert.equal((await expectTopPlacement(page)).mainTop, fixedBaseline.mainTop)

  await page.setViewportSize({ width: 390, height: 800 })

  await page.waitForFunction(() => {
    return document.querySelector('#ghpin-root').getBoundingClientRect().width === 390
  })

  await expectTopPlacement(page)

  await shortcut(page, 'octo/tools').click({ trial: true })

  await page.setViewportSize({ width: 390, height: 220 })

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.cssText =
      'position:fixed;top:var(--native-top,0px);width:100%;height:112px;overflow:auto;padding:0;border:0'

    header.innerHTML =
      '<nav id="nested-native-nav" aria-label="Repository" style="position:sticky;top:0;width:100%;height:32px"><a href="/octo/tools">Code</a></nav>'

    window.dispatchEvent(new Event('resize'))
  })

  await expectNestedHeaderPositions(page)

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.position = 'sticky'

    header.style.overflow = 'hidden'

    window.dispatchEvent(new Event('resize'))
  })

  await expectNestedHeaderPositions(page)

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '80px')

    window.dispatchEvent(new Event('resize'))
  })

  await page.waitForFunction(() => {
    return document.querySelector('.GlobalNav').getBoundingClientRect().top === 80
  })

  assert.equal(
    await page.locator('#nested-native-nav').evaluate((nav) => {
      return nav.getBoundingClientRect().top
    }),
    80,
    'A nested native header must inherit its parent’s responsive top',
  )

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '0px')

    header.style.position = 'fixed'

    header.style.overflow = 'visible'

    header.querySelector('nav').style.position = 'fixed'

    window.dispatchEvent(new Event('resize'))
  })

  await page.waitForFunction(() => {
    return (
      document.querySelector('#nested-native-nav').getBoundingClientRect().top >=
      document.querySelector('#ghpin-bar').getBoundingClientRect().bottom
    )
  })

  await expectNestedHeaderPositions(page)
})
