import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { artifactsPath, browser, shortcut, expectRepos, expectPinned, openUnpin } from './harness'

/** @param {string} expected */
function stickyStateIs(expected) {
  const host = document.querySelector('#ghpin-root')

  return host instanceof HTMLElement && host.dataset.ghpinSticky === expected
}

await test('unpin confirmation contains keyboard focus and cancellation preserves pins and restores the invoker', async (t) => {
  const context = await browser(
    t,
    new Map([
      ['/acme/rocket', { repo: 'acme/rocket' }],
      ['/octo/tools', { repo: 'octo/tools' }],
    ]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  await page.goto('https://github.com/octo/tools')

  await page.getByRole('button', { name: 'Pin octo/tools', exact: true }).click()

  await expectPinned(page, 'octo/tools')

  const observer = await context.newPage()

  await observer.goto('https://github.com/acme/rocket')

  const dialog = page.getByRole('dialog', { name: 'Unpin repository?', exact: true })

  const dismissals = [
    () => {
      return dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    },
    () => {
      return page.keyboard.press('Escape')
    },
    () => {
      return dialog.getByRole('button', { name: 'Close dialog', exact: true }).click()
    },
  ]

  for (const dismiss of dismissals) {
    await openUnpin(page, 'octo/tools')

    await dialog.waitFor()

    assert.ok((await dialog.innerText()).includes('octo/tools'))

    assert.equal(
      await page.evaluate(() => {
        return document.activeElement.textContent.trim()
      }),
      'Cancel',
    )

    await expectRepos(page, ['acme/rocket', 'octo/tools'], 'octo/tools')

    assert.equal(
      await shortcut(page, 'octo/tools').locator('..').getAttribute('data-temporary'),
      'false',
    )

    await observer.reload()

    await expectRepos(observer, ['acme/rocket', 'octo/tools'], 'acme/rocket')

    await page.bringToFront()

    await mkdir(artifactsPath, { recursive: true })

    await dialog.screenshot({ path: path.join(artifactsPath, 'unpin-confirmation.png') })

    for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)

      assert.equal(
        await dialog.evaluate((dialog) => {
          return dialog.contains(document.activeElement)
        }),
        true,
        `Focus escaped after ${key}: ${await page.evaluate(() => {
          return document.activeElement.outerHTML.slice(0, 160)
        })}`,
      )
    }

    await shortcut(page, 'acme/rocket').focus()

    assert.equal(
      await dialog.evaluate((dialog) => {
        return dialog.contains(document.activeElement)
      }),
      true,
      'The background must be inert',
    )

    await dismiss()

    await dialog.waitFor({ state: 'hidden' })

    assert.equal(
      await page.evaluate(() => {
        return document.activeElement.getAttribute('aria-label')
      }),
      'Open octo/tools',
    )

    await page.reload()

    await expectRepos(page, ['acme/rocket', 'octo/tools'], 'octo/tools')

    assert.equal(
      await shortcut(page, 'octo/tools').locator('..').getAttribute('data-temporary'),
      'false',
    )
  }
})

/** @param {import('playwright').Page} page @param {string} temporary @param {string} actionLabel */
async function expectSplitSegmentState(page, temporary, actionLabel) {
  const link = shortcut(page, 'acme/rocket')

  const tab = link.locator('..')

  const action = tab.getByRole('button')

  const transparent = 'rgba(0, 0, 0, 0)'

  const hover = 'rgba(129, 139, 152, 0.12)'

  /** @param {{tab: string, link: string, action: string}} expected */
  async function expectBackgrounds(expected) {
    await page.waitForFunction((expected) => {
      const link = document.querySelector('#ghpin-bar a[href="https://github.com/acme/rocket"]')

      const tab = link.parentElement

      const action = tab.querySelector('button')

      return (
        getComputedStyle(tab).backgroundColor === expected.tab &&
        getComputedStyle(link).backgroundColor === expected.link &&
        getComputedStyle(action).backgroundColor === expected.action
      )
    }, expected)

    assert.deepEqual(
      await tab.evaluate((tab) => {
        return {
          tab: getComputedStyle(tab).backgroundColor,
          link: getComputedStyle(tab.querySelector('a')).backgroundColor,
          action: getComputedStyle(tab.querySelector('button')).backgroundColor,
        }
      }),
      expected,
    )
  }

  assert.equal(await tab.getAttribute('data-selected'), 'true')

  assert.equal(await tab.getAttribute('data-temporary'), temporary)

  await page.mouse.move(1200, 700)

  await expectBackgrounds({ tab: transparent, link: transparent, action: transparent })

  const geometry = await tab.evaluate((tab) => {
    const link = tab.querySelector('a')

    const action = tab.querySelector('button')

    const linkBox = link.getBoundingClientRect()

    const actionBox = action.getBoundingClientRect()

    const tabBox = tab.getBoundingClientRect()

    const linkStyle = getComputedStyle(link)

    const actionStyle = getComputedStyle(action)

    return {
      linkCorners: [
        linkStyle.borderTopLeftRadius,
        linkStyle.borderTopRightRadius,
        linkStyle.borderBottomRightRadius,
        linkStyle.borderBottomLeftRadius,
      ],
      actionCorners: [
        actionStyle.borderTopLeftRadius,
        actionStyle.borderTopRightRadius,
        actionStyle.borderBottomRightRadius,
        actionStyle.borderBottomLeftRadius,
      ],
      linkTop: linkBox.top,
      linkBottom: linkBox.bottom,
      actionTop: actionBox.top,
      actionBottom: actionBox.bottom,
      actionRight: actionBox.right,
      tabRight: tabBox.right,
    }
  })

  assert.deepEqual(geometry.linkCorners, ['6px', '0px', '0px', '6px'])

  assert.deepEqual(geometry.actionCorners, ['0px', '6px', '6px', '0px'])

  assert.equal(geometry.actionTop, geometry.linkTop)

  assert.equal(geometry.actionBottom, geometry.linkBottom)

  assert.ok(
    geometry.tabRight - geometry.actionRight <= 1,
    'The action segment must reach the tab edge',
  )

  await link.hover()

  await expectBackgrounds({ tab: transparent, link: hover, action: transparent })

  await action.hover()

  await expectBackgrounds({ tab: transparent, link: transparent, action: hover })

  await page.mouse.move(1200, 700)

  await expectBackgrounds({ tab: transparent, link: transparent, action: transparent })

  await page.locator('#ghpin-bar').focus()

  await page.keyboard.press('Tab')

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.getAttribute('href')
    }),
    'https://github.com/acme/rocket',
  )

  assert.deepEqual(
    await tab.evaluate((tab) => {
      return {
        link: getComputedStyle(tab.querySelector('a')).outlineWidth,
        action: getComputedStyle(tab.querySelector('button')).outlineWidth,
        tab: getComputedStyle(tab).outlineStyle,
        tabBackground: getComputedStyle(tab).backgroundColor,
        otherBackground: getComputedStyle(tab.querySelector('button')).backgroundColor,
      }
    }),
    {
      link: '2px',
      action: '0px',
      tab: 'none',
      tabBackground: transparent,
      otherBackground: transparent,
    },
  )

  await page.keyboard.press('Tab')

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.getAttribute('aria-label')
    }),
    actionLabel,
  )

  assert.deepEqual(
    await tab.evaluate((tab) => {
      return {
        link: getComputedStyle(tab.querySelector('a')).outlineWidth,
        action: getComputedStyle(tab.querySelector('button')).outlineWidth,
        tab: getComputedStyle(tab).outlineStyle,
        tabBackground: getComputedStyle(tab).backgroundColor,
        otherBackground: getComputedStyle(tab.querySelector('a')).backgroundColor,
      }
    }),
    {
      link: '0px',
      action: '2px',
      tab: 'none',
      tabBackground: transparent,
      otherBackground: transparent,
    },
  )
}

await test('temporary tabs have independent Pin segments and saved tabs become complete rectangular anchors', async (t) => {
  const context = await browser(t, new Map([['/acme/rocket', { repo: 'acme/rocket' }]]))

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  await expectSplitSegmentState(page, 'true', 'Pin acme/rocket')

  await page.keyboard.press('Enter')

  await expectPinned(page, 'acme/rocket')

  const link = shortcut(page, 'acme/rocket')

  const tab = link.locator('..')

  const savedGeometry = await link.evaluate((anchor) => {
    const style = getComputedStyle(anchor)

    const anchorBox = anchor.getBoundingClientRect()

    const tabBox = anchor.parentElement.getBoundingClientRect()

    return {
      corners: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      leftGap: anchorBox.left - tabBox.left,
      rightGap: tabBox.right - anchorBox.right,
    }
  })

  assert.deepEqual(savedGeometry.corners, ['6px', '6px', '6px', '6px'])

  assert.ok(savedGeometry.leftGap <= 1, 'The saved anchor must reach the tab’s left edge')

  assert.ok(savedGeometry.rightGap <= 1, 'The saved anchor must reach the tab’s right edge')

  await link.hover()

  await page.waitForFunction(() => {
    return (
      getComputedStyle(document.querySelector('#ghpin-bar a')).backgroundColor ===
      'rgba(129, 139, 152, 0.12)'
    )
  })

  assert.equal(
    await tab.evaluate((tab) => {
      return getComputedStyle(tab).backgroundColor
    }),
    'rgba(0, 0, 0, 0)',
  )

  await page.mouse.move(1200, 700)

  await page.waitForFunction(() => {
    return (
      getComputedStyle(document.querySelector('#ghpin-bar a')).backgroundColor ===
      'rgba(0, 0, 0, 0)'
    )
  })

  await page.locator('#ghpin-bar').focus()

  await page.keyboard.press('Tab')

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.getAttribute('aria-label')
    }),
    'Open acme/rocket',
  )

  assert.equal(
    await link.evaluate((anchor) => {
      return getComputedStyle(anchor).outlineWidth
    }),
    '2px',
  )

  await page.keyboard.press('Tab')

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.closest('#ghpin-bar')
    }),
    null,
    'A saved tab must have only its anchor in the keyboard tab order',
  )
})

await test('repository destination menus use actual navigation, preserve pin status, and save independently across tabs', async (t) => {
  const acme = {
    repo: 'acme/rocket',
    controls: true,
    navigation: [
      { label: 'Code', section: '' },
      { label: 'Issues', section: '/issues' },
      { label: 'Pull requests', section: '/pulls' },
      { label: 'Settings', section: '/settings' },
      { label: 'Projects', section: '/projects', disabled: true },
    ],
  }

  const octo = {
    repo: 'octo/tools',
    navigation: [
      { label: 'Code', section: '' },
      { label: 'Pull requests', section: '/pulls' },
      { label: 'Wiki', section: '/wiki' },
    ],
  }

  const context = await browser(
    t,
    new Map([
      ['/acme/rocket', acme],
      ['/acme/rocket/settings', acme],
      ['/octo/tools', octo],
    ]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  const acmeLink = page
    .locator('#ghpin-bar')
    .getByRole('link', { name: 'Open acme/rocket', exact: true })

  const menu = page.getByRole('menu', { name: 'Default destination for acme/rocket', exact: true })

  await acmeLink.focus()

  await page.keyboard.press('Shift+F10')

  await menu.waitFor()

  assert.equal(
    await menu.getByRole('menuitem', { name: 'Unpin repository', exact: true }).count(),
    0,
    'Temporary tabs must not offer Unpin',
  )

  assert.deepEqual(
    await menu.getByRole('menuitemradio').evaluateAll((items) => {
      return items.map((item) => {
        return item.textContent.trim()
      })
    }),
    ['Repo home', 'Issues', 'Pull requests', 'Settings'],
  )

  assert.equal(
    await menu
      .getByRole('menuitemradio', { name: 'Repo home', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )

  for (const [key, focused] of [
    ['ArrowDown', 'Issues'],
    ['ArrowUp', 'Repo home'],
    ['End', 'Settings'],
    ['Home', 'Repo home'],
    ['ArrowUp', 'Settings'],
    ['Home', 'Repo home'],
    ['ArrowDown', 'Issues'],
  ]) {
    await page.keyboard.press(key)

    assert.equal(
      await page.evaluate(() => {
        return document.activeElement.textContent.trim()
      }),
      focused,
    )
  }

  await page.keyboard.press('Enter')

  await menu.waitFor({ state: 'hidden' })

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  assert.equal(page.url(), 'https://github.com/acme/rocket')

  assert.equal(await acmeLink.getAttribute('aria-current'), 'page')

  assert.equal(await acmeLink.locator('..').getAttribute('data-temporary'), 'true')

  assert.equal(await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).count(), 1)

  await page.reload()

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  const other = await context.newPage()

  await other.goto('https://github.com/acme/rocket')

  await other.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  await page.bringToFront()

  await acmeLink.click({ button: 'right' })

  await menu.getByRole('menuitemradio', { name: 'Pull requests', exact: true }).click()

  await menu.waitFor({ state: 'hidden' })

  await other.locator('#ghpin-bar a[href="https://github.com/acme/rocket/pulls"]').waitFor()

  await page.evaluate(() => {
    document.querySelector('nav[aria-label="Repository"] a[href="/acme/rocket/issues"]').remove()
  })

  await acmeLink.click({ button: 'right' })

  await menu.waitFor()

  assert.equal(await menu.getByRole('menuitemradio', { name: 'Issues', exact: true }).count(), 0)

  assert.equal(await menu.getByRole('menuitemradio', { name: 'Projects', exact: true }).count(), 0)

  assert.equal(
    await menu
      .getByRole('menuitemradio', { name: 'Pull requests', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )

  await page.keyboard.press('Escape')

  await menu.waitFor({ state: 'hidden' })

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.getAttribute('aria-label')
    }),
    'Open acme/rocket',
  )

  await acmeLink.click({ button: 'right' })

  await menu.waitFor()

  await page.getByRole('button', { name: 'Fixture control', exact: true }).click()

  await menu.waitFor({ state: 'hidden' })

  assert.equal(
    await page.evaluate(() => {
      return document.activeElement.id
    }),
    'fixture-control',
  )

  await page.setViewportSize({ width: 390, height: 220 })

  await acmeLink.click({ button: 'right' })

  await menu.waitFor()

  const menuBounds = await menu.evaluate((menu) => {
    const rect = menu.getBoundingClientRect()

    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  })

  await mkdir(artifactsPath, { recursive: true })

  await page.screenshot({ path: path.join(artifactsPath, 'menu-small-viewport.png') })

  assert.ok(menuBounds.left >= 0, 'Menu left edge must remain inside the viewport')

  assert.ok(menuBounds.top >= 0, 'Menu top edge must remain inside the viewport')

  assert.ok(menuBounds.right <= 390, 'Menu right edge must remain inside the viewport')

  assert.ok(
    menuBounds.bottom <= 220,
    `Menu bottom edge must remain inside the viewport: ${JSON.stringify(menuBounds)}`,
  )

  await page.keyboard.press('Escape')

  await page.setViewportSize({ width: 1280, height: 800 })

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  await page.goto('https://github.com/octo/tools')

  await page.getByRole('button', { name: 'Pin octo/tools', exact: true }).click()

  await expectPinned(page, 'octo/tools')

  await acmeLink.click({ button: 'right' })

  await menu.getByRole('menuitemradio', { name: 'Settings', exact: true }).waitFor()

  assert.equal(await menu.getByRole('menuitemradio', { name: 'Wiki', exact: true }).count(), 0)

  await menu.getByRole('menuitemradio', { name: 'Settings', exact: true }).click()

  await menu.waitFor({ state: 'hidden' })

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/settings"]').waitFor()

  assert.equal(page.url(), 'https://github.com/octo/tools')

  assert.equal(
    await page.locator('#ghpin-bar a[aria-current="page"]').getAttribute('aria-label'),
    'Open octo/tools',
  )

  await acmeLink.click()

  await page.waitForURL('https://github.com/acme/rocket/settings')

  assert.equal(await acmeLink.getAttribute('aria-current'), 'page')
})

await test('reliable removal of a saved destination resets it permanently, while incomplete or failed discovery preserves it', async (t) => {
  const fullNavigation = [
    { label: 'Code', section: '' },
    { label: 'Issues', section: '/issues' },
    { label: 'Pull requests', section: '/pulls' },
    { label: 'Settings', section: '/settings' },
  ]

  const fixtures = new Map([
    ['/acme/rocket', { repo: 'acme/rocket', navigation: fullNavigation }],
    ['/octo/tools', { repo: 'octo/tools' }],
  ])

  const context = await browser(t, fixtures)

  const page = await context.newPage()

  const link = (name) => {
    return page.locator('#ghpin-bar').getByRole('link', { name: `Open ${name}`, exact: true })
  }

  const menu = (name) => {
    return page.getByRole('menu', { name: `Default destination for ${name}`, exact: true })
  }

  /** @param {string} name @param {string} destination */
  async function choose(name, destination) {
    await link(name).click({ button: 'right' })

    await menu(name).getByRole('menuitemradio', { name: destination, exact: true }).click()

    await menu(name).waitFor({ state: 'hidden' })
  }

  await page.goto('https://github.com/acme/rocket')

  await page.getByRole('button', { name: 'Pin acme/rocket', exact: true }).click()

  await expectPinned(page, 'acme/rocket')

  await choose('acme/rocket', 'Issues')

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/issues"]').waitFor()

  await page.goto('https://github.com/octo/tools')

  await page.getByRole('button', { name: 'Pin octo/tools', exact: true }).click()

  await expectPinned(page, 'octo/tools')

  await choose('octo/tools', 'Pull requests')

  fixtures.set('/acme/rocket', {
    repo: 'acme/rocket',
    navigation: fullNavigation.filter((item) => {
      return item.label !== 'Issues'
    }),
  })

  await link('acme/rocket').click({ button: 'right' })

  await menu('acme/rocket').getByRole('menuitemradio', { name: 'Repo home', exact: true }).waitFor()

  assert.equal(
    await menu('acme/rocket').getByRole('menuitemradio', { name: 'Issues', exact: true }).count(),
    0,
  )

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

  assert.equal(
    await menu('acme/rocket')
      .getByRole('menuitemradio', { name: 'Repo home', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )

  await page.keyboard.press('Escape')

  await page.reload()

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket"]').waitFor()

  await page.locator('#ghpin-bar a[href="https://github.com/octo/tools/pulls"]').waitFor()

  await expectPinned(page, 'acme/rocket')

  await expectPinned(page, 'octo/tools')

  fixtures.set('/acme/rocket', { repo: 'acme/rocket', navigation: fullNavigation })

  await link('acme/rocket').click({ button: 'right' })

  await menu('acme/rocket').getByRole('menuitemradio', { name: 'Issues', exact: true }).waitFor()

  assert.equal(
    await menu('acme/rocket')
      .getByRole('menuitemradio', { name: 'Repo home', exact: true })
      .getAttribute('aria-checked'),
    'true',
  )

  await menu('acme/rocket').getByRole('menuitemradio', { name: 'Settings', exact: true }).click()

  await menu('acme/rocket').waitFor({ state: 'hidden' })

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/settings"]').waitFor()

  await context.route('https://github.com/acme/rocket', (route) => {
    return route.fulfill({
      status: 503,
      contentType: 'text/html',
      body: '<h1>Temporarily unavailable</h1>',
    })
  })

  const failure = page.waitForResponse('https://github.com/acme/rocket')

  await link('acme/rocket').click({ button: 'right' })

  assert.equal((await failure).status(), 503)

  await menu('acme/rocket').getByRole('menuitemradio', { name: 'Repo home', exact: true }).waitFor()

  assert.equal(
    await link('acme/rocket').getAttribute('href'),
    'https://github.com/acme/rocket/settings',
  )

  await page.keyboard.press('Escape')

  await context.unroute('https://github.com/acme/rocket')

  fixtures.set('/acme/rocket', {
    repo: 'acme/rocket',
    navigation: [{ label: 'Settings', section: '/settings' }],
  })

  await link('acme/rocket').click({ button: 'right' })

  await menu('acme/rocket').getByRole('menuitemradio', { name: 'Repo home', exact: true }).waitFor()

  assert.equal(
    await link('acme/rocket').getAttribute('href'),
    'https://github.com/acme/rocket/settings',
  )

  await page.keyboard.press('Escape')

  await page.reload()

  await page.locator('#ghpin-bar a[href="https://github.com/acme/rocket/settings"]').waitFor()

  await page.locator('#ghpin-bar a[href="https://github.com/octo/tools/pulls"]').waitFor()
})

await test('the repository strip stays at the viewport top while scrolling without shifting content or covering native sticky navigation', async (t) => {
  const context = await browser(
    t,
    new Map([['/acme/rocket', { repo: 'acme/rocket', tall: true, nativeSticky: true }]]),
  )

  const page = await context.newPage()

  await page.goto('https://github.com/acme/rocket')

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  const host = page.locator('#ghpin-root')

  await page.waitForFunction(stickyStateIs, 'false')

  const baseline = await page.evaluate(() => {
    return {
      mainTop: document.querySelector('main').getBoundingClientRect().top + scrollY,
      barTop: document.querySelector('#ghpin-bar').getBoundingClientRect().top,
      globalBottom: document.querySelector('.global-row').getBoundingClientRect().bottom,
    }
  })

  assert.ok(baseline.barTop >= baseline.globalBottom)

  await page.evaluate(() => {
    scrollTo(0, 500)
  })

  await page.waitForFunction(stickyStateIs, 'true')

  const sticky = await page.evaluate(() => {
    return {
      top: document.querySelector('#ghpin-bar').getBoundingClientRect().top,
      bottom: document.querySelector('#ghpin-bar').getBoundingClientRect().bottom,
      width: document.querySelector('#ghpin-root').getBoundingClientRect().width,
      parent: document.querySelector('#ghpin-root').parentElement.tagName,
      mainTop: document.querySelector('main').getBoundingClientRect().top + scrollY,
      nativeTop: document.querySelector('.GlobalNav').getBoundingClientRect().top,
    }
  })

  assert.equal(sticky.top, 0)

  assert.equal(sticky.width, 1280)

  assert.equal(sticky.parent, 'BODY')

  assert.equal(sticky.mainTop, baseline.mainTop, 'The placeholder must preserve content position')

  assert.ok(
    sticky.nativeTop >= sticky.bottom,
    'Native sticky navigation must be below the repository strip',
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

  assert.equal(
    await page.locator('.GlobalNav').evaluate((header) => {
      return header.getBoundingClientRect().top
    }),
    80,
    'A responsive native top below the bar must keep its own 80px position',
  )

  await page.locator('.GlobalNav').evaluate((header) => {
    header.style.setProperty('--native-top', '0px')

    window.dispatchEvent(new Event('resize'))
  })

  await page.waitForFunction(() => {
    const bar = document.querySelector('#ghpin-bar').getBoundingClientRect()

    return document.querySelector('.GlobalNav').getBoundingClientRect().top >= bar.bottom
  })

  await page.evaluate(() => {
    history.pushState({}, '', '/acme/rocket/issues')

    const replacement = document.createElement('header')

    replacement.className = 'GlobalNav'

    replacement.innerHTML =
      '<div class="global-row" data-component="Stack" data-direction="horizontal">Replacement global header</div><nav class="repo-nav" aria-label="Repository"><a href="/acme/rocket">Code</a></nav>'

    document.querySelector('.GlobalNav').replaceWith(replacement)
  })

  await expectRepos(page, ['acme/rocket'], 'acme/rocket')

  await page.waitForFunction(stickyStateIs, 'true')

  await page.waitForFunction(() => {
    return document.querySelector('#ghpin-root').getBoundingClientRect().top === 0
  })

  await page.waitForFunction(() => {
    return (
      document.querySelector('.GlobalNav').getBoundingClientRect().top >=
      document.querySelector('#ghpin-root').getBoundingClientRect().bottom
    )
  })

  assert.equal(await page.locator('#ghpin-slot').count(), 1)

  assert.equal(await host.count(), 1)

  await page.locator('.GlobalNav').evaluate((header) => {
    header.replaceWith(header.cloneNode(true))

    document.dispatchEvent(new Event('turbo:render'))
  })

  await page.waitForFunction(stickyStateIs, 'true')

  await page.evaluate(() => {
    scrollTo(0, 0)
  })

  await page.waitForFunction(stickyStateIs, 'false')

  assert.equal(
    await host.evaluate((host) => {
      return host.parentElement.id
    }),
    'ghpin-slot',
  )

  assert.equal(
    await page.locator('.GlobalNav').evaluate((header) => {
      return getComputedStyle(header).top
    }),
    '0px',
    'Restoring a cloned header must not retain the extension’s temporary sticky offset',
  )

  assert.ok(
    await page.evaluate(() => {
      return (
        document.querySelector('#ghpin-bar').getBoundingClientRect().top >=
        document.querySelector('.global-row').getBoundingClientRect().bottom
      )
    }),
    'Returning to the top must place the strip below the restored global row',
  )
})
