import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { TestContext } from 'node:test'
import type { PinIcon } from '@primer/octicons-react'
import { chromium, type Locator, type Page } from 'playwright'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fixture } from './fixtures'

const __dirname = import.meta.dirname

const extensionPath = path.resolve(__dirname, '..', 'dist')

export const artifactsPath = path.join(__dirname, 'artifacts')

export function installFixtureDOM() {
  function fixtureElement<Tag extends keyof HTMLElementTagNameMap>(
    tag: Tag,
    selector: string,
    scope: ParentNode = document,
  ) {
    const element = [...scope.querySelectorAll(tag)].find((candidate) => {
      return candidate.matches(selector)
    })

    if (element === undefined) {
      throw new Error(`Required fixture ${tag} element was not found: ${selector}`)
    }

    return element
  }

  window.fixtureElement = fixtureElement

  return fixtureElement
}

declare global {
  var fixtureElement: ReturnType<typeof installFixtureDOM>
}

export async function launch(
  profile: string,
  fixtures: Map<string, NonNullable<Parameters<typeof fixture>[0]>>,
  deviceScaleFactor = 1,
) {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })

  context.setDefaultTimeout(5000)

  await context.addInitScript(installFixtureDOM)

  await context.route(/^https:\/\/github\.com\/[^/]+\.png\?size=(?:40|80)$/u, (route) => {
    const url = new URL(route.request().url())

    if (url.pathname === '/missing-avatar.png') {
      return route.fulfill({ status: 404, body: 'Avatar unavailable' })
    }

    const size = url.searchParams.get('size')

    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 40 40"><rect width="40" height="40" rx="6" fill="#0969da"/><circle cx="20" cy="16" r="7" fill="white"/><path d="M8 36a12 12 0 0 1 24 0" fill="white"/></svg>`,
    })
  })

  await context.route('https://github.com/**', (route) => {
    if (route.request().resourceType() === 'image') {
      return route.fallback()
    }

    const pathname = new URL(route.request().url()).pathname

    return route.fulfill({ contentType: 'text/html', body: fixture(fixtures.get(pathname)) })
  })

  return context
}

export async function browser(
  t: TestContext,
  fixtures: Parameters<typeof launch>[1],
  deviceScaleFactor = 1,
) {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'ghpin-test-'))

  const context = await launch(profile, fixtures, deviceScaleFactor)

  t.after(async () => {
    await context.close()

    await rm(profile, { recursive: true, force: true })
  })

  return context
}

export function shortcut(page: Page, name: string) {
  return page.locator(`#ghpin-bar a[href="https://github.com/${name}"]`)
}

export async function expectPinned(page: Page, name: string) {
  await page.waitForFunction((name) => {
    const anchor = document.querySelector(`#ghpin-bar a[aria-label="Open ${name}"]`)

    return anchor?.parentElement?.dataset.temporary === 'false'
  }, name)

  const tab = page
    .locator('#ghpin-bar')
    .getByRole('link', { name: `Open ${name}`, exact: true })
    .locator('..')

  assert.equal(await tab.getAttribute('data-temporary'), 'false')

  assert.equal(
    await tab.locator('button').count(),
    0,
    'Saved tabs must contain no action or hidden focus buttons',
  )
}

export async function openUnpin(page: Page, name: string, keyboard = false) {
  const anchor = page.locator('#ghpin-bar').getByRole('link', { name: `Open ${name}`, exact: true })

  const menu = page.getByRole('menu', { name: `Default destination for ${name}`, exact: true })

  if (keyboard) {
    await anchor.focus()

    await page.keyboard.press('Shift+F10')

    await menu.getByRole('menuitem', { name: 'Unpin repository', exact: true }).waitFor()

    await page.keyboard.press('End')

    assert.equal(
      await page.evaluate(() => {
        return document.activeElement?.textContent?.trim()
      }),
      'Unpin repository',
    )

    await page.keyboard.press('Enter')
  } else {
    await anchor.click({ button: 'right' })

    await menu.getByRole('menuitem', { name: 'Unpin repository', exact: true }).click()
  }

  await menu.waitFor({ state: 'hidden' })

  await page.getByRole('dialog', { name: 'Unpin repository?', exact: true }).waitFor()
}

export async function expectOcticon(svg: Locator, Icon: typeof PinIcon) {
  assert.equal(await svg.getAttribute('viewBox'), '0 0 16 16')

  assert.equal(await svg.getAttribute('width'), '16')

  assert.equal(await svg.getAttribute('height'), '16')

  assert.equal(await svg.getAttribute('fill'), 'currentColor')
  // GitHub's installed icon package is the independent reference for geometry.

  const officialMarkup = renderToStaticMarkup(createElement(Icon, { size: 16 }))

  const officialPaths = [...officialMarkup.matchAll(/<path[^>]*\sd="([^"]+)"/gu)].map((match) => {
    return match[1]
  })

  assert.deepEqual(
    await svg.locator('path').evaluateAll((paths) => {
      return paths.map((path) => {
        return path.getAttribute('d')
      })
    }),
    officialPaths,
  )
}

export async function confirmUnpin(page: Page, name: string) {
  const dialog = page.getByRole('dialog', { name: 'Unpin repository?', exact: true })

  await dialog.waitFor()

  assert.ok(
    (await dialog.innerText()).includes(name),
    'Confirmation must identify the full repository',
  )

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement?.textContent?.trim()
    }),
    'Cancel',
  )

  await dialog.getByRole('button', { name: 'Unpin', exact: true }).focus()

  await page.keyboard.press('Enter')

  await dialog.waitFor({ state: 'hidden' })
}

export async function expectRepos(page: Page, names: string[], current: string | null = null) {
  const expected = names
    .map((name) => {
      return `https://github.com/${name}`
    })
    .toSorted((left, right) => {
      return left.localeCompare(right)
    })

  await page.waitForFunction(
    ({ expected, current }) => {
      const links = [...document.querySelectorAll('#ghpin-bar a[href]')]

      const actual = links
        .map((link) => {
          return link.getAttribute('href') ?? ''
        })
        .toSorted((left, right) => {
          return left.localeCompare(right)
        })

      const selected = links.filter((link) => {
        return link.getAttribute('aria-current') === 'page'
      })

      return (
        JSON.stringify(actual) === JSON.stringify(expected) &&
        (current === null
          ? selected.length === 0
          : selected.length === 1 &&
            selected[0]?.getAttribute('href') === `https://github.com/${current}`)
      )
    },
    { expected, current },
  )

  assert.deepEqual(
    await page.locator('#ghpin-bar a[href]').evaluateAll((links) => {
      return links
        .map((link) => {
          return link.getAttribute('href') ?? ''
        })
        .toSorted((left, right) => {
          return left.localeCompare(right)
        })
    }),
    expected,
  )

  assert.ok((await page.locator('#ghpin-bar').count()) <= 1, 'There must never be duplicate strips')

  if (current !== null) {
    assert.equal(await shortcut(page, current).getAttribute('aria-current'), 'page')
  }
}
