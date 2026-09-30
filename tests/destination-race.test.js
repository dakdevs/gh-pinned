import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browser, expectPinned } from './harness'
import { extensionWorld } from './extension-world'

/** @param {import('playwright').Page} page */
async function pauseNextDestinationRead(page) {
  const { session, contextId } = await extensionWorld(page)

  // Capture an actual Chrome storage snapshot, then hold its delivery. The
  // extension still performs every read, write, reset, and UI interaction.
  const installed = await session.send('Runtime.evaluate', {
    contextId,
    expression: `(async () => {
        const key = 'ghpin-destination:acme/rocket';
        await navigator.locks.request(chrome.runtime.id + ':' + key, () => undefined);
        const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
        let started;
        globalThis.__ghpinReadStarted = new Promise(resolve => {
          started = resolve;
          setTimeout(() => resolve('read did not start'), 5000);
        });
        chrome.storage.local.get = async keys => {
          const snapshot = await originalGet(keys);
          if (keys === key) {
            chrome.storage.local.get = originalGet;
            started(snapshot[key]?.section);
            await new Promise(resolve => { globalThis.__ghpinReleaseRead = resolve; });
          }
          return snapshot;
        };
        return true;
      })()`,
    awaitPromise: true,
    returnByValue: true,
  })

  assert.equal(installed.result.value, true)

  return { session, contextId }
}

async function destinationWriteIsQueued() {
  const locks = await navigator.locks.query()

  return locks.pending.some((lock) => {
    return lock.name.endsWith(':ghpin-destination:acme/rocket')
  })
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
    expression: 'globalThis.__ghpinReadStarted',
    awaitPromise: true,
    returnByValue: true,
  })

  assert.equal(
    oldRead.result.value,
    '/issues',
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
    expression: 'globalThis.__ghpinReleaseRead(); true',
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
