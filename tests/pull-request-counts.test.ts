import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import type { Locator, Page, Route } from 'playwright'
import { artifactsPath, browser, expectPinned } from './harness'
import { gate, paintSettledResponse, pullRequestsPage } from './pr-count-fixtures'

function repoLink(page: Page, name: string) {
  return page.locator('#ghpin-bar').getByRole('link', { name: `Open ${name}`, exact: true })
}

async function expectCount(page: Page, name: string, text: string) {
  await page.waitForFunction(
    ({ name, text }) => {
      return (
        document.querySelector(`#ghpin-bar a[aria-label="Open ${name}"] [data-ghpin-pr-count]`)
          ?.textContent === text
      )
    },
    { name, text },
  )

  const badge = repoLink(page, name).locator('[data-ghpin-pr-count]')

  assert.equal(await badge.textContent(), text)

  assert.equal(await badge.getAttribute('aria-hidden'), 'true')

  return badge
}

async function expectNoCount(page: Page, name: string) {
  const link = repoLink(page, name)

  assert.equal(await link.locator('[data-ghpin-pr-count]').count(), 0)

  assert.equal(await link.getAttribute('aria-describedby'), null)
}

function segmentBackgrounds(link: Locator) {
  return link.locator('..').evaluate((tab) => {
    const anchor = tab.querySelector('a')

    const action = tab.querySelector('button')

    if (anchor === null || action === null) {
      throw new Error('A temporary repository tab must have both segments')
    }

    return {
      row: getComputedStyle(tab).backgroundColor,
      link: getComputedStyle(anchor).backgroundColor,
      action: getComputedStyle(action).backgroundColor,
    }
  })
}

async function expectSegmentBackgrounds(
  page: Page,
  link: Locator,
  expected: Awaited<ReturnType<typeof segmentBackgrounds>>,
) {
  await page.waitForFunction((expected) => {
    const anchor = document.querySelector('#ghpin-bar a[aria-label="Open acme/rocket"]')

    const tab = anchor?.parentElement

    const action = tab?.querySelector('button')

    if (!anchor || !tab || !action) {
      return false
    }

    return (
      getComputedStyle(tab).backgroundColor === expected.row &&
      getComputedStyle(anchor).backgroundColor === expected.link &&
      getComputedStyle(action).backgroundColor === expected.action
    )
  }, expected)

  assert.deepEqual(await segmentBackgrounds(link), expected)
}

async function countDescription(page: Page, name: string) {
  const id = await repoLink(page, name).getAttribute('aria-describedby')

  assert.ok(
    id !== null && id !== '',
    'A positive count must have an associated accessible description',
  )

  return page.locator(`[id="${id}"]`).textContent()
}

function countGeometry(badge: Locator) {
  return badge.evaluate((badge) => {
    const badgeBox = badge.getBoundingClientRect()

    const anchor = badge.closest('a')

    const previous = badge.previousElementSibling

    if (anchor === null || previous === null) {
      throw new Error('The counter must follow the repository name inside its anchor')
    }

    const linkBox = anchor.getBoundingClientRect()

    return {
      previousText: previous.textContent,
      parentTag: anchor.tagName,
      top: badgeBox.top,
      bottom: badgeBox.bottom,
      linkTop: linkBox.top,
      linkBottom: linkBox.bottom,
      centersDiffer: Math.abs(
        badgeBox.top + badgeBox.height / 2 - linkBox.top - linkBox.height / 2,
      ),
      color: getComputedStyle(badge).color,
      background: getComputedStyle(badge).backgroundColor,
    }
  })
}

function unavailableTraffic() {
  const cases = [
    {
      repo: 'cases/zero',
      status: 200,
      body: pullRequestsPage({ repo: 'cases/zero', viewer: 'alice', openCount: 0 }),
    },
    { repo: 'cases/private', status: 404, body: '<h1>Page not found</h1>' },
    {
      repo: 'cases/failure',
      status: 503,
      body: pullRequestsPage({ repo: 'cases/failure', viewer: 'alice', openCount: 47 }),
    },
    {
      repo: 'cases/login',
      status: 200,
      body: '<meta name="user-login" content=""><h1>Sign in to GitHub</h1>',
    },
    {
      repo: 'cases/incomplete',
      status: 200,
      body: pullRequestsPage({ repo: 'cases/incomplete', viewer: 'alice' }),
    },
    {
      repo: 'cases/filter',
      status: 200,
      body: pullRequestsPage({
        repo: 'cases/filter',
        viewer: 'alice',
        openCount: 47,
        filter: 'is:pr state:open author:alice created:banana',
      }),
    },
    {
      repo: 'cases/identity',
      status: 200,
      body: pullRequestsPage({
        repo: 'cases/identity',
        viewer: 'alice',
        openCount: 47,
        layoutRepo: 'other/repository',
      }),
    },
    {
      repo: 'cases/string',
      status: 200,
      body: pullRequestsPage({ repo: 'cases/string', viewer: 'alice', openCount: '47' }),
    },
  ]

  const requested: string[] = []

  function handler(route: Route) {
    requested.push(route.request().url())

    const candidate = cases.find(({ repo }) => {
      return route.request().url() === `https://github.com/${repo}/pulls/alice`
    })

    return route.fulfill({
      contentType: 'text/html',
      status: candidate?.status ?? 200,
      body:
        candidate?.body ??
        pullRequestsPage({ repo: 'cases/signed-out', viewer: 'cases', openCount: 47 }),
    })
  }

  return { cases, requested, handler }
}

await test('authored open PR counters show full filtered totals on temporary and saved anchors without changing Pin interactions', async (t) => {
  const context = await browser(
    t,
    new Map([
      [
        '/acme/rocket',
        {
          repo: 'acme/rocket',
          viewer: 'Alice',
          ownerLogin: 'acme',
          navigation: [
            { label: 'Code', section: '' },
            { label: 'Pull requests', section: '/pulls', count: 50000 },
          ],
        },
      ],
      ['/octo/tools', { repo: 'octo/tools', viewer: 'alice', ownerLogin: 'octo' }],
    ]),
  )

  const loading = gate()

  await context.route('https://github.com/acme/rocket/pulls/alice', async (route) => {
    await loading.promise

    return route.fulfill({
      contentType: 'text/html',
      body: pullRequestsPage({ repo: 'acme/rocket', viewer: 'alice', openCount: 12222 }),
    })
  })

  await context.route('https://github.com/octo/tools/pulls/alice', (route) => {
    return route.fulfill({
      contentType: 'text/html',
      body: pullRequestsPage({ repo: 'octo/tools', viewer: 'alice', openCount: 1 }),
    })
  })

  const page = await context.newPage()

  const request = page.waitForRequest('https://github.com/acme/rocket/pulls/alice')

  const response = page.waitForResponse('https://github.com/acme/rocket/pulls/alice')

  await page.goto('https://github.com/acme/rocket')

  const link = repoLink(page, 'acme/rocket')

  const pin = page.getByRole('button', { name: 'Pin acme/rocket', exact: true })

  await pin.click({ trial: true })

  assert.equal((await request).url(), 'https://github.com/acme/rocket/pulls/alice')

  await expectNoCount(page, 'acme/rocket')

  loading.release()

  await paintSettledResponse(page, await response)

  const badge = await expectCount(page, 'acme/rocket', '12222')

  assert.equal(await link.getAttribute('href'), 'https://github.com/acme/rocket')

  assert.equal(await link.getAttribute('aria-label'), 'Open acme/rocket')

  assert.equal(
    await countDescription(page, 'acme/rocket'),
    '12222 open pull requests authored by you in acme/rocket.',
  )

  assert.ok((await link.getAttribute('title'))?.includes('acme/rocket') === true)

  const geometry = await countGeometry(badge)

  assert.equal(geometry.previousText, 'rocket')

  assert.equal(geometry.parentTag, 'A')

  assert.ok(geometry.top >= geometry.linkTop)

  assert.ok(geometry.bottom <= geometry.linkBottom)

  assert.ok(geometry.centersDiffer <= 0.5)

  assert.equal(geometry.color, 'rgb(31, 35, 40)')

  assert.equal(geometry.background, 'rgba(129, 139, 152, 0.12)')

  await badge.hover()

  await expectSegmentBackgrounds(page, link, {
    row: 'rgba(0, 0, 0, 0)',
    link: 'rgba(129, 139, 152, 0.12)',
    action: 'rgba(0, 0, 0, 0)',
  })

  await pin.hover()

  await expectSegmentBackgrounds(page, link, {
    row: 'rgba(0, 0, 0, 0)',
    link: 'rgba(0, 0, 0, 0)',
    action: 'rgba(129, 139, 152, 0.12)',
  })

  await page.mouse.move(1200, 700)

  await link.focus()

  await page.keyboard.press('Tab')

  assert.equal(
    await pin.evaluate((button) => {
      return button === document.activeElement
    }),
    true,
  )

  assert.ok(
    await pin.evaluate((button) => {
      return getComputedStyle(button).outlineWidth !== '0px'
    }),
  )

  assert.equal(
    await link.evaluate((anchor) => {
      return getComputedStyle(anchor).outlineWidth
    }),
    '0px',
  )

  await mkdir(artifactsPath, { recursive: true })

  await page.screenshot({ path: path.join(artifactsPath, 'pr-count-light.png') })

  await page.evaluate(() => {
    document.documentElement.dataset.colorMode = 'dark'
  })

  assert.equal(
    await badge.evaluate((badge) => {
      return getComputedStyle(badge).color
    }),
    'rgb(240, 246, 252)',
  )

  assert.equal(
    await badge.evaluate((badge) => {
      return getComputedStyle(badge).backgroundColor
    }),
    'rgba(101, 108, 118, 0.2)',
  )

  await page.screenshot({ path: path.join(artifactsPath, 'pr-count-dark.png') })

  await page.keyboard.press('Enter')

  await expectPinned(page, 'acme/rocket')

  await expectCount(page, 'acme/rocket', '12222')

  assert.equal(
    await link.evaluate((anchor) => {
      return anchor === document.activeElement
    }),
    true,
  )

  await page.goto('https://github.com/octo/tools')

  await expectCount(page, 'octo/tools', '1')

  assert.equal(
    await countDescription(page, 'octo/tools'),
    '1 open pull request authored by you in octo/tools.',
  )

  await expectCount(page, 'acme/rocket', '12222')

  await expectPinned(page, 'acme/rocket')

  assert.equal(await repoLink(page, 'acme/rocket').getAttribute('aria-current'), null)

  assert.equal(await repoLink(page, 'octo/tools').getAttribute('aria-current'), 'page')
})

await test('zero, unavailable, and unverified authored PR results omit the counter and description', async (t) => {
  const { cases, requested, handler } = unavailableTraffic()

  const fixtures: Parameters<typeof browser>[1] = new Map()

  for (const { repo } of cases) {
    fixtures.set(`/${repo}`, { repo, viewer: 'alice', ownerLogin: 'cases' })
  }

  fixtures.set('/cases/signed-out', {
    repo: 'cases/signed-out',
    viewer: '',
    ownerLogin: 'cases',
  })

  const context = await browser(t, fixtures)

  await context.route('https://github.com/cases/*/pulls/*', handler)

  const page = await context.newPage()

  for (const { repo } of cases) {
    const response = page.waitForResponse(`https://github.com/${repo}/pulls/alice`)

    await page.goto(`https://github.com/${repo}`)

    await repoLink(page, repo).waitFor()

    await paintSettledResponse(page, await response)

    await expectNoCount(page, repo)

    assert.equal(await page.getByRole('button', { name: `Pin ${repo}`, exact: true }).count(), 1)
  }

  await page.goto('https://github.com/cases/signed-out')

  await repoLink(page, 'cases/signed-out').waitFor()

  await page.waitForLoadState('networkidle')

  await expectNoCount(page, 'cases/signed-out')

  assert.equal(
    requested.includes('https://github.com/cases/signed-out/pulls/cases'),
    false,
    'Repository owner metadata must not be used as viewer identity',
  )

  assert.equal(requested.length, 8)
})

await test('viewer changes discard an older authored PR response and signed-out tabs clear personal counts', async (t) => {
  const context = await browser(
    t,
    new Map([['/acme/rocket', { repo: 'acme/rocket', viewer: 'alice', ownerLogin: 'acme' }]]),
  )

  const oldAccount = gate()

  const firstReturn = gate()

  const secondReturn = gate()

  const replies = [
    { wait: oldAccount, count: 47 },
    { wait: firstReturn, count: 47 },
    { wait: secondReturn, count: 13 },
  ]

  await context.route('https://github.com/acme/rocket/pulls/alice', async (route) => {
    const reply = replies.shift()

    assert.ok(reply, 'An account fetch must have a controlled response')

    await reply.wait.promise

    await route.fulfill({
      contentType: 'text/html',
      body: pullRequestsPage({ repo: 'acme/rocket', viewer: 'alice', openCount: reply.count }),
    })
  })

  const newAccount = gate()

  await context.route('https://github.com/acme/rocket/pulls/bob', async (route) => {
    await newAccount.promise

    return route.fulfill({
      contentType: 'text/html',
      body: pullRequestsPage({ repo: 'acme/rocket', viewer: 'bob', openCount: 7 }),
    })
  })

  const page = await context.newPage()

  const oldRequest = page.waitForRequest('https://github.com/acme/rocket/pulls/alice')

  await page.goto('https://github.com/acme/rocket')

  await oldRequest

  await repoLink(page, 'acme/rocket').waitFor()

  const bobRequest = page.waitForRequest('https://github.com/acme/rocket/pulls/bob')

  const bobResponse = page.waitForResponse('https://github.com/acme/rocket/pulls/bob')

  await page.locator('meta[name="user-login"]').evaluate((meta) => {
    meta.setAttribute('content', 'bob')
  })

  await bobRequest

  await expectNoCount(page, 'acme/rocket')

  newAccount.release()

  await paintSettledResponse(page, await bobResponse)

  await expectCount(page, 'acme/rocket', '7')

  oldAccount.release()

  await page.waitForLoadState('networkidle')

  await expectCount(page, 'acme/rocket', '7')

  assert.equal(
    await countDescription(page, 'acme/rocket'),
    '7 open pull requests authored by you in acme/rocket.',
  )

  const firstReturnRequest = page.waitForRequest('https://github.com/acme/rocket/pulls/alice')

  const firstReturnResponse = page.waitForResponse('https://github.com/acme/rocket/pulls/alice')

  await page.locator('meta[name="user-login"]').evaluate((meta) => {
    meta.setAttribute('content', 'alice')
  })

  await firstReturnRequest

  await expectNoCount(page, 'acme/rocket')

  firstReturn.release()

  await paintSettledResponse(page, await firstReturnResponse)

  await expectCount(page, 'acme/rocket', '47')

  await page.locator('meta[name="user-login"]').evaluate((meta) => {
    meta.setAttribute('content', '')
  })

  await page.waitForFunction(() => {
    return document.querySelector('[data-ghpin-pr-count]') === null
  })

  await expectNoCount(page, 'acme/rocket')

  const secondReturnRequest = page.waitForRequest('https://github.com/acme/rocket/pulls/alice')

  const secondReturnResponse = page.waitForResponse('https://github.com/acme/rocket/pulls/alice')

  await page.locator('meta[name="user-login"]').evaluate((meta) => {
    meta.setAttribute('content', 'alice')
  })

  await secondReturnRequest

  await expectNoCount(page, 'acme/rocket')

  secondReturn.release()

  await paintSettledResponse(page, await secondReturnResponse)

  await expectCount(page, 'acme/rocket', '13')

  assert.equal(
    await countDescription(page, 'acme/rocket'),
    '13 open pull requests authored by you in acme/rocket.',
  )

  assert.equal(
    await repoLink(page, 'acme/rocket').getAttribute('href'),
    'https://github.com/acme/rocket',
  )
})
