import assert from 'node:assert/strict'
import { test } from 'node:test'
import { browser } from './harness'
import { pullRequestsPage } from './pr-count-fixtures'

/** @param {import('playwright').Locator} link */
async function geometry(link) {
  await link.locator('[data-ghpin-pr-count]').waitFor()

  return link.evaluate((anchor) => {
    const label = anchor.querySelector('[data-content]')

    const badge = anchor.querySelector('[data-ghpin-pr-count]')

    const range = document.createRange()

    range.selectNodeContents(label)

    const text = range.getBoundingClientRect()

    const name = label.getBoundingClientRect()

    const css = getComputedStyle(label)

    return {
      gap: badge.getBoundingClientRect().left - Math.min(text.right, name.right),
      linkWidth: anchor.getBoundingClientRect().width,
      nameWidth: name.width,
      textWidth: text.width,
      weight: css.fontWeight,
      scrollWidth: label.scrollWidth,
      clientWidth: label.clientWidth,
      overflow: css.overflow,
      textOverflow: css.textOverflow,
    }
  })
}

await test('repository badges keep an 8px visible gap and stable tab widths through selection and truncation', async (t) => {
  const repo = 'acme/weather-pipelines-extension'

  const other = 'acme/another-repository'

  const longRepo =
    'acme/repository-with-an-exceedingly-long-name-to-check-that-counter-spacing-preserves-ellipsis-truncation'

  const fixtures = new Map(
    [repo, other, longRepo].map((name) => {
      return [`/${name}`, { repo: name, ownerLogin: 'acme', viewer: 'alice' }]
    }),
  )

  const context = await browser(t, fixtures)

  await context.route('https://github.com/*/*/pulls/alice', (route) => {
    const name = new URL(route.request().url()).pathname.slice(1).replace(/\/pulls\/alice$/u, '')

    return route.fulfill({
      contentType: 'text/html',
      body: pullRequestsPage({ repo: name, viewer: 'alice', openCount: 13 }),
    })
  })

  const page = await context.newPage()

  const link = (name) => {
    return page.locator('#ghpin-bar').getByRole('link', { name: `Open ${name}`, exact: true })
  }

  await page.goto(`https://github.com/${repo}`)

  await page.getByRole('button', { name: `Pin ${repo}`, exact: true }).click()

  await page.getByRole('button', { name: `Pin ${repo}`, exact: true }).waitFor({ state: 'hidden' })

  const active = await geometry(link(repo))

  await page.goto(`https://github.com/${other}`)

  const inactive = await geometry(link(repo))

  assert.equal(active.weight, '600')

  assert.equal(inactive.weight, '400')

  // Native navigation spacing is 8px; bold-width reservation must not enlarge it.
  for (const value of [active, inactive]) {
    assert.ok(Math.abs(value.gap - 8) <= 0.5, `Visible label-to-badge gap was ${value.gap}px`)

    assert.ok(value.scrollWidth <= value.clientWidth, 'The discriminating label must not truncate')
  }

  assert.ok(
    Math.abs(active.linkWidth - inactive.linkWidth) <= 0.5,
    'Selection must keep tab width stable',
  )

  await page.goto(`https://github.com/${longRepo}`)

  const truncated = await geometry(link(longRepo))

  assert.equal(truncated.overflow, 'hidden')

  assert.equal(truncated.textOverflow, 'ellipsis')

  assert.ok(truncated.scrollWidth > truncated.clientWidth, 'Long labels must remain clipped')

  assert.ok(Math.abs(truncated.gap - 8) <= 0.5, 'The clipped label must retain the 8px badge gap')
})
