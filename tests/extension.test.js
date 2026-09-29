import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { PinIcon, PinSlashIcon, PersonIcon } from '@primer/octicons-react'
import {
  artifactsPath,
  browser,
  launch,
  shortcut,
  expectOcticon,
  confirmUnpin,
  expectPinned,
  openUnpin,
  expectRepos,
} from './harness'

await test('temporary current repository is selected, pinnable by keyboard, and shortcuts open its main page', async (t) => {
  const context = await browser(
    t,
    new Map([
      ['/acme/rocket/issues', { repo: 'acme/rocket' }],
      ['/acme/rocket', { repo: 'acme/rocket' }],
      ['/octo/tools', { repo: 'octo/tools' }],
    ]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket/issues')

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  const bar = page.getByRole('navigation', { name: 'Pinned repositories' })

  assert.equal(await shortcut(page, 'acme/rocket').innerText(), 'rocket')

  const currentTab = shortcut(page, 'acme/rocket').locator('..')

  assert.equal(await currentTab.getAttribute('data-selected'), 'true')

  assert.equal(await currentTab.getAttribute('data-temporary'), 'true')

  assert.equal(
    await currentTab.evaluate((tab) => {
      return getComputedStyle(tab).borderTopStyle
    }),
    'dashed',
  )

  assert.equal(await currentTab.locator('[data-ghpin-indicator]').isVisible(), true)

  assert.equal(
    await currentTab.locator('[data-ghpin-indicator]').evaluate((indicator) => {
      return getComputedStyle(indicator).backgroundColor
    }),
    'rgb(253, 140, 115)',
  )

  const pin = bar.getByRole('button', { name: 'Pin acme/rocket', exact: true })

  assert.equal(await pin.getAttribute('title'), 'Pin acme/rocket')

  await pin.click({ trial: true })

  await pin.focus()

  await page.keyboard.press('Enter')

  await expectPinned(page, 'acme/rocket')

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.getAttribute('aria-label')
    }),
    'Open acme/rocket',
  )

  assert.equal(await currentTab.getAttribute('data-selected'), 'true')

  assert.equal(await currentTab.getAttribute('data-temporary'), 'false')

  assert.equal(
    await currentTab.evaluate((tab) => {
      return getComputedStyle(tab).borderTopStyle
    }),
    'solid',
  )

  assert.equal(await currentTab.locator('[data-ghpin-indicator]').isVisible(), true)

  assert.equal(
    await currentTab.locator('[data-ghpin-indicator]').evaluate((indicator) => {
      return getComputedStyle(indicator).backgroundColor
    }),
    'rgb(253, 140, 115)',
  )

  await openUnpin(page, 'acme/rocket', true)

  await confirmUnpin(page, 'acme/rocket')

  await pin.waitFor()

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.getAttribute('aria-label')
    }),
    'Open acme/rocket',
  )

  assert.equal(await currentTab.getAttribute('data-temporary'), 'true')

  assert.equal(
    await currentTab.evaluate((tab) => {
      return getComputedStyle(tab).borderTopStyle
    }),
    'dashed',
  )

  await pin.click({ trial: true })

  await pin.focus()

  await page.keyboard.press('Enter')

  await expectPinned(page, 'acme/rocket')

  await page.goto('https://github.com/octo/tools')

  await expectRepos(page, ['acme/rocket', 'octo/tools'], 'octo/tools')

  await shortcut(page, 'acme/rocket').click()

  await page.waitForURL('https://github.com/acme/rocket')

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')
})

await test('pins survive a browser restart and unpinning the current repo restores its temporary status', async (t) => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'ghpin-persistence-'))

  const fixtures = new Map([
    ['/acme/rocket', { repo: 'acme/rocket' }],
    ['/acme/rocket/settings', { repo: 'acme/rocket' }],
    ['/dashboard', {}],
  ])

  let context = await launch(profile, fixtures)

  t.after(async () => {
    await context.close()

    await rm(profile, { recursive: true, force: true })
  })

  let page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  await context.close()

  context = await launch(profile, fixtures)

  page = await context.newPage()

  await page.goto('https://github.com/acme/rocket/settings')

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  const currentTab = shortcut(page, 'acme/rocket').locator('..')

  assert.equal(await currentTab.getAttribute('data-temporary'), 'false')

  await openUnpin(page, 'acme/rocket')

  await confirmUnpin(page, 'acme/rocket')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).waitFor()

  assert.equal(await currentTab.getAttribute('data-temporary'), 'true')

  await page.reload()

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).waitFor()

  await page.goto('https://github.com/dashboard')

  await expectRepos(page, [])
})

await test('repository metadata and header fallback reject non-repository pages and stale metadata', async (t) => {
  const context = await browser(
    t,
    new Map([
      ['/acme/rocket', { repo: 'acme/rocket' }],
      ['/octo/tools/pull/1', { repo: 'octo/tools', metadata: null, header: 'Header' }],
      ['/orgs/acme', { metadata: 'acme/rocket' }],
      ['/settings/profile', { metadata: 'acme/rocket' }],
      ['/acme', {}],
      ['/acme/other', { metadata: 'acme/rocket' }],
    ]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  await page.goto('https://github.com/octo/tools/pull/1')

  await expectRepos(page, ['acme/rocket', 'octo/tools'], 'octo/tools')

  for (const pathname of ['/orgs/acme', '/settings/profile', '/acme', '/acme/other']) {
    await page.goto(`https://github.com${pathname}`)

    await expectRepos(page, ['acme/rocket'])
  }
})

await test('soft navigation, header replacement, and body replacement preserve one correctly selected strip', async (t) => {
  const context = await browser(
    t,
    new Map([['/acme/rocket', { repo: 'acme/rocket', header: 'AppHeader' }]]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  assert.equal(
    await page.locator('#ghpin-root').evaluate((host) => {
      return (
        host.getBoundingClientRect().bottom <=
        document.querySelector('.AppHeader').getBoundingClientRect().top
      )
    }),
    true,
    'The strip must stay above the entire fallback header',
  )

  for (const pathname of ['/acme/rocket/issues', '/acme/rocket/pull/1', '/acme/rocket/settings']) {
    await page.evaluate((pathname) => {
      history.pushState({}, '', pathname)
    }, pathname)

    await expectRepos(page, ['acme/rocket'], 'acme/rocket')
  }

  await page.evaluate(() => {
    history.pushState({}, '', '/octo/tools/issues')

    document.querySelector('meta[name="octolytics-dimension-repository_nwo"]').content =
      'octo/tools'

    document.querySelector('.AppHeader').replaceWith(
      Object.assign(document.createElement('header'), {
        className: 'AppHeader',
        textContent: 'Replacement GitHub header',
      }),
    )

    document.querySelector('#repository-container-header').innerHTML =
      '<a href="/octo/tools">octo/tools</a>'
  })

  await expectRepos(page, ['acme/rocket', 'octo/tools'], 'octo/tools')

  assert.equal(
    await page.locator('#ghpin-slot').evaluate((slot) => {
      return slot.previousElementSibling === document.body.firstElementChild
    }),
    true,
    'The body must reserve strip space before the replacement header',
  )

  await page.evaluate(() => {
    const replacement = document.createElement('body')

    replacement.innerHTML =
      '<header class="AppHeader">New body header</header><main>Dashboard</main>'

    document.body.replaceWith(replacement)

    history.pushState({}, '', '/dashboard')
  })

  await expectRepos(page, ['acme/rocket'])

  assert.equal(await page.locator('#ghpin-bar').count(), 1)

  assert.equal(
    await page.locator('#ghpin-root').evaluate((host) => {
      return host.parentElement.tagName
    }),
    'BODY',
  )

  assert.equal(
    await page.locator('#ghpin-bar').evaluate((bar) => {
      return bar.getBoundingClientRect().top
    }),
    0,
  )

  assert.equal(
    await page.locator('#ghpin-root').evaluate((host) => {
      return (
        host.getBoundingClientRect().bottom <=
        document.querySelector('.AppHeader').getBoundingClientRect().top
      )
    }),
    true,
    'Replacing the body must restore the strip above the new global header',
  )
})

await test('simultaneous pins and unpins propagate between open tabs without losing a different repo', async (t) => {
  const context = await browser(
    t,
    new Map([
      ['/acme/rocket', { repo: 'acme/rocket' }],
      ['/octo/tools', { repo: 'octo/tools' }],
      ['/dashboard', {}],
    ]),
  )

  const [first, second] = await Promise.all([context.newPage(), context.newPage()])

  await Promise.all([
    first.goto('https://github.com/acme/rocket'),
    second.goto('https://github.com/octo/tools'),
  ])

  await Promise.all([
    first.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click(),
    second.getByRole('button', { name: 'Pin octo/tools', exact: true }).click(),
  ])

  await Promise.all([
    expectRepos(first, ['acme/rocket', 'octo/tools'], 'acme/rocket'),
    expectRepos(second, ['acme/rocket', 'octo/tools'], 'octo/tools'),
  ])

  await openUnpin(first, 'octo/tools', true)

  await confirmUnpin(first, 'octo/tools')

  await expectRepos(first, ['acme/rocket'], 'acme/rocket')

  await first.waitForFunction(() => {
    return document.activeElement.getAttribute('href') === 'https://github.com/acme/rocket'
  })

  assert.deepEqual(
    await first.evaluate(() => {
      return {
        tag: document.activeElement.tagName,
        href: document.activeElement.getAttribute('href'),
      }
    }),
    {
      tag: 'A',
      href: 'https://github.com/acme/rocket',
    },
  )

  await second.getByRole('button', { name: 'Pin octo/tools', exact: true }).waitFor()

  await first.reload()

  await expectRepos(first, ['acme/rocket'], 'acme/rocket')

  await second.goto('https://github.com/dashboard')

  await expectRepos(second, ['acme/rocket'])
})

await test('the strip follows page theme colors, stays horizontally scrollable, and appears above all GitHub navigation', async (t) => {
  const repos = [
    'acme/rocket',
    'octo/tools',
    'primer/react',
    'microsoft/playwright',
    'nodejs/node',
    'rust-lang/rust',
  ]

  const fixtures = new Map([
    ...repos.map((repo) => {
      return [`/${repo}`, { repo }]
    }),
    ['/features', { header: 'marketing' }],
  ])

  const context = await browser(t, fixtures)

  const page = await context.newPage()

  await mkdir(artifactsPath, { recursive: true })

  for (const repo of repos) {
    await page.goto(`https://github.com/${repo}`)

    await page.getByRole('button', { name: `Pin ${repo}`, exact: true }).click()

    await expectPinned(page, repo)
  }

  await page.goto('https://github.com/acme/rocket')

  await expectRepos(page, repos, 'acme/rocket')

  const bar = page.locator('#ghpin-bar')

  const styles = await bar.evaluate((bar) => {
    return {
      background: getComputedStyle(bar).backgroundColor,
      color: getComputedStyle(bar).color,
      top: bar.getBoundingClientRect().top,
      bottom: bar.getBoundingClientRect().bottom,
      globalTop: document.querySelector('.GlobalNav').getBoundingClientRect().top,
      repositoryTop: document.querySelector('nav[aria-label="Repository"]').getBoundingClientRect()
        .top,
    }
  })

  assert.ok(['rgb(255, 255, 255)', 'rgb(246, 248, 250)'].includes(styles.background))

  assert.equal(styles.color, 'rgb(31, 35, 40)')

  assert.equal(styles.top, 0)

  assert.ok(
    styles.bottom <= styles.globalTop,
    'The whole global header must remain below the strip',
  )

  assert.ok(
    styles.bottom <= styles.repositoryTop,
    'The strip must appear before repository navigation',
  )

  await page.screenshot({ path: path.join(artifactsPath, 'extension-light.png') })

  await page.evaluate(() => {
    return (document.documentElement.dataset.colorMode = 'dark')
  })

  const dark = await bar.evaluate((bar) => {
    return {
      background: getComputedStyle(bar).backgroundColor,
      color: getComputedStyle(bar).color,
    }
  })

  assert.ok(['rgb(13, 17, 23)', 'rgb(21, 27, 35)'].includes(dark.background))

  assert.equal(dark.color, 'rgb(240, 246, 252)')

  await page.screenshot({ path: path.join(artifactsPath, 'extension-dark.png') })

  await page.setViewportSize({ width: 390, height: 800 })

  assert.equal(
    await bar.evaluate((bar) => {
      return [bar, ...bar.querySelectorAll('*')].some((element) => {
        const overflow = getComputedStyle(element).overflowX

        return [
          ['auto', 'scroll'].includes(overflow),
          element.scrollWidth > element.clientWidth,
        ].every(Boolean)
      })
    }),
    true,
    'Multiple pins must be horizontally scrollable on a narrow screen',
  )

  await page.goto('https://github.com/features')

  await expectRepos(page, repos)

  const marketingPlacement = await bar.evaluate((bar) => {
    return {
      insidePartial: Boolean(bar.closest('react-partial')),
      parent: bar.closest('#ghpin-root').parentElement.tagName,
      firstBodyElement: document.body.firstElementChild.id,
      top: bar.getBoundingClientRect().top,
      bottom: bar.getBoundingClientRect().bottom,
      headerTop: document.querySelector('header[data-marketing-header]').getBoundingClientRect()
        .top,
      background: getComputedStyle(bar).backgroundColor,
      color: getComputedStyle(bar).color,
    }
  })

  assert.equal(marketingPlacement.insidePartial, false)

  assert.equal(marketingPlacement.parent, 'BODY')

  assert.equal(marketingPlacement.firstBodyElement, 'ghpin-root')

  assert.equal(marketingPlacement.top, 0)

  assert.ok(marketingPlacement.bottom <= marketingPlacement.headerTop)

  assert.equal(marketingPlacement.background, 'rgb(246, 248, 250)')

  assert.equal(marketingPlacement.color, 'rgb(31, 35, 40)')
})

await test('official Octicon pin geometry, owner avatars, and short repository names preserve distinct pins', async (t) => {
  const context = await browser(
    t,
    new Map([
      ['/acme/widget', { repo: 'acme/widget' }],
      ['/octo/widget', { repo: 'octo/widget' }],
      ['/missing-avatar/widget', { repo: 'missing-avatar/widget' }],
    ]),
    3,
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/widget')

  const pin = page.getByRole('button', { name: 'Pin acme/widget', exact: true })

  await expectOcticon(pin.locator('svg'), PinIcon)

  await mkdir(artifactsPath, { recursive: true })

  await pin.locator('svg').screenshot({ path: path.join(artifactsPath, 'pin-icon@3x.png') })

  await pin.click()

  await expectPinned(page, 'acme/widget')

  await shortcut(page, 'acme/widget').click({ button: 'right' })

  const unpin = page.getByRole('menuitem', { name: 'Unpin repository', exact: true })

  await unpin.waitFor()

  await expectOcticon(unpin.locator('svg'), PinSlashIcon)

  await unpin.locator('svg').screenshot({ path: path.join(artifactsPath, 'unpin-icon@3x.png') })

  await page.keyboard.press('Escape')

  await page.goto('https://github.com/octo/widget')

  await page.getByRole('button', { name: 'Pin octo/widget', exact: true }).click()

  await expectPinned(page, 'octo/widget')

  await expectRepos(page, ['acme/widget', 'octo/widget'], 'octo/widget')

  for (const [name, owner] of [
    ['acme/widget', 'acme'],
    ['octo/widget', 'octo'],
  ]) {
    const link = shortcut(page, name)

    assert.equal(await link.innerText(), 'widget')

    assert.equal(await link.getAttribute('aria-label'), `Open ${name}`)

    assert.equal(await link.getAttribute('title'), `Open ${name}`)

    const avatar = link.locator('img')

    await avatar.waitFor()

    await link.evaluate((anchor) => {
      return anchor.querySelector('img').decode()
    })

    assert.equal(await avatar.getAttribute('alt'), '')

    const image = await link.evaluate((anchor) => {
      const image = anchor.querySelector('img')

      return {
        src: image.currentSrc,
        width: image.getBoundingClientRect().width,
        height: image.getBoundingClientRect().height,
        naturalWidth: image.naturalWidth,
        borderRadius: getComputedStyle(image).borderRadius,
        avatarRight: image.getBoundingClientRect().right,
        nameLeft: image.closest('a').querySelector('[data-content]').getBoundingClientRect().left,
      }
    })

    assert.equal(image.src, `https://github.com/${owner}.png?size=80`)

    assert.equal(image.width, 20)

    assert.equal(image.height, 20)

    // The selected 80px 2x source has a density-corrected intrinsic CSS width of 40px.
    assert.equal(image.naturalWidth, 40)

    assert.notEqual(image.borderRadius, '0px')

    assert.ok(
      image.avatarRight <= image.nameLeft,
      'The owner avatar must precede the repository name',
    )
  }

  await shortcut(page, 'acme/widget').click()

  await page.waitForURL('https://github.com/acme/widget')

  await expectRepos(page, ['acme/widget', 'octo/widget'], 'acme/widget')

  await page.goto('https://github.com/missing-avatar/widget')

  await expectRepos(
    page,
    ['acme/widget', 'octo/widget', 'missing-avatar/widget'],
    'missing-avatar/widget',
  )

  const failedAvatarLink = shortcut(page, 'missing-avatar/widget')

  await failedAvatarLink.locator('svg').waitFor()

  assert.equal(
    await failedAvatarLink.locator('img').count(),
    0,
    'Failed avatars must not show a broken image',
  )

  await expectOcticon(failedAvatarLink.locator('svg'), PersonIcon)
})
