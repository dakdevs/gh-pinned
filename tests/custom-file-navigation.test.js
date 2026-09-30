import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fixture } from './fixtures'
import { artifactsPath, browser } from './harness'

const rocketDigest = '0'.repeat(64)
const toolsDigest = '1'.repeat(64)
const nativeDigest = '2'.repeat(64)

function customFilePage() {
  const tree = `<aside id="pr-file-tree"><ul role="tree" aria-label="File Tree">
    <li role="treeitem" aria-expanded="true" tabindex="0"><span id="directory-label">src</span><ul role="group">
      <li role="treeitem" tabindex="0" data-client-scroll><a href="#diff-${rocketDigest}" role="presentation" tabindex="-1">rocket.ts</a></li>
      <li role="treeitem" tabindex="0" data-client-scroll><a href="#diff-${toolsDigest}" role="presentation" tabindex="-1">tools.ts</a></li>
      <li role="treeitem" tabindex="0"><a href="#diff-${nativeDigest}" role="presentation" tabindex="-1">native.ts</a></li>
    </ul></li></ul></aside>`

  const files = [rocketDigest, toolsDigest, nativeDigest]
    .map((digest, index) => {
      return `<div role="region" id="diff-${digest}" aria-labelledby="heading-${index}" class="diff-file">
      <div data-diff-header-wrapper><h3 id="heading-${index}"><a href="#diff-${digest}">File ${index + 1}</a></h3></div>
      <p>Generic changed-file content.</p></div><div class="file-spacer"></div>`
    })
    .join('')

  // The public GitHub File.tsx and scroll-helpers.ts source map confirms
  // replaceState/statechange, pushState/statechange, then this numeric RAF
  // scroll. The native row deliberately exercises the already-clear guard.
  const script = `<script>
    history.replaceState({ appId: 'fixture' }, '', location.href);
    function currentState() { return history.state || {}; }
    function selectFile(row, event) {
      const hash = row.querySelector('a').hash;
      if (event.metaKey || event.ctrlKey || event.button === 1) {
        window.open(hash, '_blank');
        return;
      }
      history.replaceState(currentState(), '', hash);
      window.dispatchEvent(new CustomEvent('statechange', { bubbles: false, cancelable: false }));
      history.pushState({ appId: currentState().appId }, '', location.href);
      window.dispatchEvent(new CustomEvent('statechange', { bubbles: false, cancelable: false }));
      requestAnimationFrame(() => {
        const element = document.getElementById(hash.slice(1));
        const modernPR = false;
        const yOffset = element.getBoundingClientRect().top + window.scrollY - 10 - (60 + (modernPR ? 48 : 0));
        window.scrollTo({ top: yOffset, left: 0 });
        element.focus();
      });
    }
    for (const row of document.querySelectorAll('#pr-file-tree [data-client-scroll]')) {
      row.querySelector('a').addEventListener('click', event => { event.preventDefault(); });
      row.addEventListener('click', event => {
        selectFile(row, event);
        event.stopPropagation();
      });
      row.addEventListener('keydown', event => {
        if (document.activeElement === row && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          selectFile(row, event);
          event.stopPropagation();
        }
      });
    }
  </script>`

  return fixture({ repo: 'acme/rocket', nativeSticky: true })
    .replace(
      '</style>',
      `.GlobalNav { height:60px; padding:14px 32px; border:0; }
      .GlobalNav .repo-nav { display:none; }
      #pr-file-tree { position:fixed; top:128px; left:16px; width:180px; }
      #pr-file-tree ul { padding-left:16px; list-style:none; }
      #pr-file-tree li { padding:4px 0; }
      .diff-file { scroll-margin-top:70px; min-height:320px; margin-left:220px; }
      .diff-file h3 { margin:0; }
      .file-spacer { height:600px; } #file-tail { height:1600px; }
      </style>`,
    )
    .replace(
      '</main>',
      `${tree}<div class="file-spacer"></div>${files}<div id="file-tail"></div></main>`,
    )
    .replace('</body>', `${script}</body>`)
}

/** @param {import('playwright').Page} page @param {string} digest @param {string} phase */
async function fileGeometry(page, digest, phase) {
  await page.evaluate(() => {
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })

  const geometry = await page.evaluate((digest) => {
    const target = document.querySelector(`#diff-${digest}`)

    return {
      targetTop: target.getBoundingClientRect().top,
      targetMargin: getComputedStyle(target).scrollMarginTop,
      barHeight: document.querySelector('#ghpin-root').getBoundingClientRect().height,
      toolbarBottom: document.querySelector('.GlobalNav').getBoundingClientRect().bottom,
      scrollY,
      hash: location.hash,
    }
  }, digest)

  await mkdir(artifactsPath, { recursive: true })

  await page.screenshot({ path: path.join(artifactsPath, `file-navigation-${phase}.png`) })

  return geometry
}

/** @param {Awaited<ReturnType<typeof fileGeometry>>} geometry @param {number} expected */
function expectFileVisible(geometry, expected) {
  assert.equal(geometry.targetMargin, '70px')

  assert.ok(
    geometry.targetTop >= geometry.toolbarBottom,
    `The file must clear the shifted toolbar: ${JSON.stringify(geometry)}`,
  )

  assert.ok(
    Math.abs(geometry.targetTop - expected) <= 0.5,
    `Add the measured strip once: expected ${expected}, ${JSON.stringify(geometry)}`,
  )
}

await test('React file-tree numeric scrolling clears the shifted toolbar once and leaves native navigation and user scrolling alone', async (t) => {
  const context = await browser(t, new Map())

  await context.route('https://github.com/acme/rocket/pull/1/files', (route) => {
    return route.fulfill({ contentType: 'text/html', body: customFilePage() })
  })

  const page = await context.newPage()

  page.on('pageerror', (error) => {
    t.diagnostic(error.message)
  })

  await page.goto('https://github.com/acme/rocket/pull/1/files')

  await page.waitForFunction(() => {
    return document.querySelector('.GlobalNav').getBoundingClientRect().top === 48
  })

  const tree = page.getByRole('tree', { name: 'File Tree', exact: true })

  const rocket = tree.getByRole('treeitem', { name: 'rocket.ts', exact: true })

  const tools = tree.getByRole('treeitem', { name: 'tools.ts', exact: true })

  await rocket.click({ position: { x: 130, y: 10 } })

  const mouse = await fileGeometry(page, rocketDigest, 'mouse')

  assert.equal(mouse.toolbarBottom, 108)

  expectFileVisible(mouse, 118)

  await tools.click()

  expectFileVisible(await fileGeometry(page, toolsDigest, 'changed-file'), 118)

  await tools.click()

  expectFileVisible(await fileGeometry(page, toolsDigest, 'same-file'), 118)

  await rocket.focus()

  await page.keyboard.press('Enter')

  expectFileVisible(await fileGeometry(page, rocketDigest, 'enter'), 118)

  await tools.focus()

  await page.keyboard.press('Space')

  expectFileVisible(await fileGeometry(page, toolsDigest, 'space'), 118)

  await tree.getByRole('treeitem', { name: 'native.ts', exact: true }).locator('a').click()

  expectFileVisible(await fileGeometry(page, nativeDigest, 'native'), 118)

  await page.locator('#ghpin-bar').evaluate((bar) => {
    bar.style.minHeight = '84px'
  })

  await page.waitForFunction(() => {
    return document.querySelector('.GlobalNav').getBoundingClientRect().top === 84
  })

  await rocket.click()

  expectFileVisible(await fileGeometry(page, rocketDigest, 'resized'), 154)

  await page.locator('#ghpin-bar').evaluate((bar) => {
    bar.style.removeProperty('min-height')
  })

  await page.waitForFunction(() => {
    return document.querySelector('.GlobalNav').getBoundingClientRect().top === 48
  })

  await rocket.click()

  const beforeWheel = await fileGeometry(page, rocketDigest, 'before-wheel')

  expectFileVisible(beforeWheel, 118)

  await page.mouse.move(1100, 600)

  await page.mouse.wheel(0, 48)

  await page.waitForFunction((expected) => {
    return scrollY === expected
  }, beforeWheel.scrollY + 48)

  const afterWheel = await fileGeometry(page, rocketDigest, 'wheel')

  assert.equal(afterWheel.scrollY, beforeWheel.scrollY + 48)

  assert.ok(Math.abs(afterWheel.targetTop - 70) <= 0.5, JSON.stringify(afterWheel))

  assert.equal(afterWheel.hash, `#diff-${rocketDigest}`)

  await page.locator('#directory-label').click()

  assert.equal((await fileGeometry(page, rocketDigest, 'directory')).scrollY, afterWheel.scrollY)

  const popup = context.waitForEvent('page')

  await rocket.click({ modifiers: ['ControlOrMeta'] })

  const opened = await popup

  assert.equal((await fileGeometry(page, rocketDigest, 'modifier')).scrollY, afterWheel.scrollY)

  await opened.close()
})
