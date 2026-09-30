import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Page } from 'playwright'
import { browser, expectPinned } from './harness'
import { extensionWorld } from './extension-world'
import type { gate } from './pr-count-fixtures'

declare global {
  var __ghpinReadStarted: Promise<unknown>
  var __ghpinReleaseRead: ReturnType<typeof gate>['release']
}

async function installDestinationReadPause() {
  const key = 'ghpin-destination:acme/rocket'

  await navigator.locks.request(`${chrome.runtime.id}:${key}`, () => {})

  const originalGet = chrome.storage.local.get.bind(chrome.storage.local)

  window.__ghpinReadStarted = new Promise<unknown>((started) => {
    setTimeout(() => {
      started('read did not start')
    }, 5000)

    chrome.storage.local.get = new Proxy(originalGet, {
      apply(target, _receiver, argumentsList) {
        const keys: unknown = argumentsList[0]

        // This isolated fixture supports Promise reads for its repository.
        if (argumentsList.length > 1 || (keys !== null && keys !== undefined && keys !== key)) {
          throw new Error(
            'The held-read fixture requires a Promise read for acme/rocket or all keys',
          )
        }

        const delivery = target(keys)

        if (keys !== key) {
          return delivery
        }

        return delivery.then(async (snapshot) => {
          chrome.storage.local.get = originalGet

          started(snapshot[key])

          await new Promise<void>((resolve) => {
            window.__ghpinReleaseRead = resolve
          })

          return snapshot
        })
      },
    })
  })

  return true
}

function heldDestinationRead() {
  return window.__ghpinReadStarted
}

function releaseDestinationRead() {
  window.__ghpinReleaseRead()

  return true
}

async function pauseNextDestinationRead(page: Page) {
  const { session, contextId } = await extensionWorld(page)

  // Capture an actual Chrome storage snapshot, then hold its delivery. The
  // extension still performs every read, write, reset, and UI interaction.
  const installed = await session.send('Runtime.evaluate', {
    contextId,
    expression: `(${installDestinationReadPause.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
  })

  assert.equal(installed.result.value, true)

  return { session, contextId }
}

async function destinationWriteIsQueued() {
  const locks = await navigator.locks.query()

  return (
    locks.pending?.some((lock) => {
      return lock.name?.endsWith(':ghpin-destination:acme/rocket') === true
    }) ?? false
  )
}

await test('a newer destination choice survives an older availability reset in another content-script tab', async (t) => {
  const context = await browser(t, new Map([['/acme/rocket', { repo: 'acme/rocket' }]]))

  const selecting = await context.newPage()

  await selecting.goto('https://github.com/acme/rocket')

  await selecting.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(selecting, 'acme/rocket')

  const selectedLink = selecting.getByRole('link', { name: 'Open acme/rocket', exact: true })

  const menu = selecting.getByRole('menu', {
    name: 'Default destination for acme/rocket',
    exact: true,
  })

  await selectedLink.click({ button: 'right' })

  await menu.getByRole('menuitemradio', { name: 'Issues', exact: true }).click()

  await menu.waitFor({ state: 'hidden' })

  await selecting.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  const resetting = await context.newPage()

  await resetting.goto('https://github.com/acme/rocket')

  await resetting.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  await selectedLink.click({ button: 'right' })

  await menu.getByRole('menuitemradio', { name: 'Settings', exact: true }).waitFor()

  const paused = await pauseNextDestinationRead(resetting)

  await resetting
    .locator('nav[aria-label="Repository"] a[href="/acme/rocket/issues"]')
    .evaluate((link) => {
      link.setAttribute('aria-disabled', 'true')
    })

  const oldRead = await paused.session.send('Runtime.evaluate', {
    contextId: paused.contextId,
    expression: `(${heldDestinationRead.toString()})()`,
    awaitPromise: true,
    returnByValue: true,
  })

  assert.deepEqual(
    oldRead.result.value,
    { name: 'acme/rocket', section: '/issues' },
    'The older reset must hold the saved Issues snapshot',
  )

  await menu.getByRole('menuitemradio', { name: 'Settings', exact: true }).click()

  await selecting.waitForFunction(destinationWriteIsQueued)

  assert.equal(
    await menu
      .getByRole('menuitemradio', { name: 'Settings', exact: true })
      .getAttribute('aria-disabled'),
    'true',
    'The queued choice must expose its pending state',
  )

  assert.equal(
    await menu.isVisible(),
    true,
    'The newer write must wait for the old reset to finish',
  )

  assert.equal(await selectedLink.getAttribute('href'), 'https://github.com/acme/rocket/issues')

  const release = await paused.session.send('Runtime.evaluate', {
    contextId: paused.contextId,
    expression: `(${releaseDestinationRead.toString()})()`,
    returnByValue: true,
  })

  assert.equal(release.result.value, true)

  await menu.waitFor({ state: 'hidden' })

  await selecting.locator('#ghpin-bar a[href="https://github.com/acme/rocket/settings"]').waitFor()

  await resetting.locator('#ghpin-bar a[href="https://github.com/acme/rocket/settings"]').waitFor()

  await expectPinned(selecting, 'acme/rocket')

  await expectPinned(resetting, 'acme/rocket')

  await resetting
    .locator('nav[aria-label="Repository"] a[href="/acme/rocket/settings"]')
    .evaluate((link) => {
      link.setAttribute('aria-disabled', 'true')
    })

  await resetting.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

  await selecting.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

  await resetting.reload()

  await resetting.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

  await selecting.reload()

  await selecting.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

  await selectedLink.click({ button: 'right' })

  await menu.getByRole('menuitemradio', { name: 'Settings', exact: true }).waitFor()

  assert.equal(
    await menu
      .getByRole('menuitemradio', { name: 'Repo home', exact: true })
      .getAttribute('aria-checked'),
    'true',
    'A durably removed destination must stay home when the section becomes available again',
  )
})
