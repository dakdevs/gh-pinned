import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browser } from './harness'

await test('a repository navigation loading state preserves its saved destination until actual tabs return', async (t) => {
  const context = await browser(t, new Map([['/acme/rocket', { repo: 'acme/rocket' }]]))

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  const link = page
    .locator('#ghpin-bar')
    .getByRole('link', { name: 'Open acme/rocket', exact: true })

  const menu = page.getByRole('menu', { name: 'Default destination for acme/rocket', exact: true })

  await link.click({ button: 'right' })

  await menu.getByRole('menuitemradio', { name: 'Issues', exact: true }).click()

  await menu.waitFor({ state: 'hidden' })

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  for (const busySelector of ['nav[aria-label="Repository"]', '.GlobalNav']) {
    await page.evaluate((selector) => {
      document.querySelector(selector).setAttribute('aria-busy', 'true')

      document.querySelector('nav[aria-label="Repository"]').innerHTML =
        '<a href="/acme/rocket">Code</a>'
    }, busySelector)

    await link.click({ button: 'right' })

    await menu.getByRole('menuitemradio', { name: 'Repo home', exact: true }).waitFor()

    await menu
      .getByRole('status')
      .filter({ hasText: 'Loading repository pages…' })
      .waitFor({ state: 'hidden' })

    assert.equal(
      await link.getAttribute('href'),
      'https://github.com/acme/rocket/issues',
      `A loading ${busySelector} must not erase the saved Issues destination`,
    )

    await page.keyboard.press('Escape')

    await page.reload()

    await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

    await link.click({ button: 'right' })

    assert.equal(
      await menu
        .getByRole('menuitemradio', { name: 'Issues', exact: true })
        .getAttribute('aria-checked'),
      'true',
    )

    await page.keyboard.press('Escape')
  }
})

await test(
  'same-repository Turbo navigation resets a removed destination only after repository tabs finish loading',
  /** @param {import('node:test').TestContext} t */ async (t) => {
    const fixtures = new Map([
      ['/acme/rocket', { repo: 'acme/rocket' }],
      ['/acme/rocket/pulls', { repo: 'acme/rocket' }],
    ])

    const context = await browser(t, fixtures)

    const page = await context.newPage()

    await page.goto('https://github.com/acme/rocket')

    const link = page
      .locator('#ghpin-bar')
      .getByRole('link', { name: 'Open acme/rocket', exact: true })

    const menu = page.getByRole('menu', {
      name: 'Default destination for acme/rocket',
      exact: true,
    })

    await link.click({ button: 'right' })

    await menu.getByRole('menuitemradio', { name: 'Issues', exact: true }).click()

    await menu.waitFor({ state: 'hidden' })

    await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

    await page.evaluate(() => {
      history.pushState({}, '', '/acme/rocket/pulls')

      const navigation = document.querySelector('nav[aria-label="Repository"]')

      navigation.setAttribute('aria-busy', 'true')

      navigation.innerHTML = '<a href="/acme/rocket">Code</a>'

      document.dispatchEvent(new Event('turbo:load'))
    })

    await link.click({ button: 'right' })

    await menu.getByRole('menuitemradio', { name: 'Repo home', exact: true }).waitFor()

    await menu
      .getByRole('status')
      .filter({ hasText: 'Loading repository pages…' })
      .waitFor({ state: 'hidden' })

    assert.equal(page.url(), 'https://github.com/acme/rocket/pulls')

    assert.equal(await link.getAttribute('href'), 'https://github.com/acme/rocket/issues')

    assert.equal(await link.getAttribute('aria-current'), 'page')

    await page.keyboard.press('Escape')

    const completedNavigation = [
      { label: 'Code', section: '' },
      { label: 'Pull requests', section: '/pulls' },
    ]

    fixtures.set('/acme/rocket/pulls', { repo: 'acme/rocket', navigation: completedNavigation })

    await page.evaluate(() => {
      const navigation = document.querySelector('nav[aria-label="Repository"]')

      navigation.removeAttribute('aria-busy')
    })

    await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

    assert.equal(await link.getAttribute('aria-current'), 'page')

    await page.reload()

    await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

    fixtures.set('/acme/rocket/pulls', { repo: 'acme/rocket' })

    await page.reload()

    await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

    await link.click({ button: 'right' })

    await menu.getByRole('menuitemradio', { name: 'Issues', exact: true }).waitFor()

    assert.equal(
      await menu
        .getByRole('menuitemradio', { name: 'Repo home', exact: true })
        .getAttribute('aria-checked'),
      'true',
      'Returning Issues availability must not restore a destination that was permanently reset',
    )

    await page.keyboard.press('Escape')

    for (const unavailable of [
      { attribute: 'aria-disabled', value: 'true' },
      { attribute: 'disabled', value: '' },
      { attribute: 'data-disabled', value: 'true' },
      { attribute: 'href', value: '/octo/tools/issues' },
    ]) {
      await link.click({ button: 'right' })

      await menu.getByRole('menuitemradio', { name: 'Issues', exact: true }).click()

      await menu.waitFor({ state: 'hidden' })

      await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

      await page
        .locator('nav[aria-label="Repository"] a[href="/acme/rocket/issues"]')
        .evaluate((item, unavailable) => {
          item.setAttribute(unavailable.attribute, unavailable.value)
        }, unavailable)

      await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

      await page.reload()

      await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()
    }

    assert.equal(await link.getAttribute('aria-current'), 'page')
  },
)
