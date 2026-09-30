import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extensionWorld } from './extension-world'
import { browser, expectPinned } from './harness'
import { gate, pullRequestsPage, softVisit } from './pr-count-fixtures'

/** @param {import('playwright').Page} page @param {string} name @param {string} expected */
async function countIs(page, name, expected) {
  await page.waitForFunction(
    ({ name, expected }) => {
      return (
        document.querySelector(`#ghpin-bar a[aria-label="Open ${name}"] [data-ghpin-pr-count]`)
          ?.textContent === expected
      )
    },
    { name, expected },
  )
}

function countTraffic() {
  const replies = new Map([
    [
      'https://github.com/acme/rocket/pulls/alice',
      { name: 'acme/rocket', initial: 3, refreshed: 11, wait: gate() },
    ],
    [
      'https://github.com/octo/tools/pulls/alice',
      { name: 'octo/tools', initial: 5, refreshed: 13, wait: gate() },
    ],
    [
      'https://github.com/primer/react/pulls/alice',
      { name: 'primer/react', initial: 7, refreshed: 17, wait: gate() },
    ],
  ])

  const state = { expired: false, active: 0, peak: 0, requested: /** @type {string[]} */ ([]) }

  /** @param {import('playwright').Route} route */
  async function handler(route) {
    const url = route.request().url()

    const reply = replies.get(url)

    assert.ok(reply, `Unexpected authored-count request: ${url}`)

    state.requested.push(url)

    if (!state.expired) {
      await route.fulfill({
        contentType: 'text/html',
        body: pullRequestsPage({ repo: reply.name, viewer: 'alice', openCount: reply.initial }),
      })

      return
    }

    state.active++

    state.peak = Math.max(state.peak, state.active)

    try {
      await reply.wait.promise

      await route.fulfill({
        contentType: 'text/html',
        body: pullRequestsPage({ repo: reply.name, viewer: 'alice', openCount: reply.refreshed }),
      })
    } finally {
      state.active--
    }
  }

  return { handler, state, replies }
}

await test('authored PR fetching deduplicates fresh counts, refreshes after one minute, and keeps at most two requests active', async (t) => {
  const context = await browser(
    t,
    new Map([['/acme/rocket', { repo: 'acme/rocket', viewer: 'alice' }]]),
  )

  const traffic = countTraffic()

  await context.route('https://github.com/*/*/pulls/alice', traffic.handler)

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await countIs(page, 'acme/rocket', '3')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  await softVisit(page, 'octo/tools')

  await countIs(page, 'octo/tools', '5')

  await page.getByRole('button', { name: 'Pin octo/tools', exact: true }).click()

  await expectPinned(page, 'octo/tools')

  await softVisit(page, 'primer/react')

  await countIs(page, 'primer/react', '7')

  await page.getByRole('button', { name: 'Pin primer/react', exact: true }).click()

  await expectPinned(page, 'primer/react')

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))

    window.dispatchEvent(new Event('focus'))
  })

  await countIs(page, 'acme/rocket', '3')

  await countIs(page, 'octo/tools', '5')

  await countIs(page, 'primer/react', '7')

  assert.deepEqual(traffic.state.requested.toSorted(), [
    'https://github.com/acme/rocket/pulls/alice',
    'https://github.com/octo/tools/pulls/alice',
    'https://github.com/primer/react/pulls/alice',
  ])

  traffic.state.expired = true

  const world = await extensionWorld(page)

  const clock = await world.session.send('Runtime.evaluate', {
    contextId: world.contextId,
    expression:
      '(() => { const future = Date.now() + 61000; Date.now = () => future; return true; })()',
    returnByValue: true,
  })

  assert.equal(clock.result.value, true)

  const acmeRequest = page.waitForRequest('https://github.com/acme/rocket/pulls/alice')

  const octoRequest = page.waitForRequest('https://github.com/octo/tools/pulls/alice')

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))
  })

  await acmeRequest

  await octoRequest

  await page.evaluate(() => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })

  assert.equal(traffic.state.active, 2)

  assert.equal(
    traffic.state.requested.filter((url) => {
      return url === 'https://github.com/primer/react/pulls/alice'
    }).length,
    1,
    'The third stale repository must wait for a free request slot',
  )

  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'))

    window.dispatchEvent(new Event('focus'))
  })

  // Restart the count effect on a real same-document repository visit while
  // its requests are pending. Repeated focus alone could be gated upstream.
  await softVisit(page, 'acme/rocket')

  await page.evaluate(() => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })

  assert.equal(
    await page.locator('[data-ghpin-pr-count]').count(),
    0,
    'Refreshing counts must omit stale values while requests are held',
  )

  const primerRequest = page.waitForRequest('https://github.com/primer/react/pulls/alice')

  const acme = traffic.replies.get('https://github.com/acme/rocket/pulls/alice')

  assert.ok(acme)

  acme.wait.release()

  await primerRequest

  const octo = traffic.replies.get('https://github.com/octo/tools/pulls/alice')

  const primer = traffic.replies.get('https://github.com/primer/react/pulls/alice')

  assert.ok(octo)

  assert.ok(primer)

  octo.wait.release()

  primer.wait.release()

  await countIs(page, 'acme/rocket', '11')

  await countIs(page, 'octo/tools', '13')

  await countIs(page, 'primer/react', '17')

  assert.equal(traffic.state.peak, 2)

  assert.deepEqual(traffic.state.requested.toSorted(), [
    'https://github.com/acme/rocket/pulls/alice',
    'https://github.com/acme/rocket/pulls/alice',
    'https://github.com/octo/tools/pulls/alice',
    'https://github.com/octo/tools/pulls/alice',
    'https://github.com/primer/react/pulls/alice',
    'https://github.com/primer/react/pulls/alice',
  ])
})
