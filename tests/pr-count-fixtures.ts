import type { Page, Response } from 'playwright'
import { fixture } from './fixtures'

type PullRequestsOptions = {
  repo: string
  viewer: string
  openCount?: number | string | null
  layoutRepo?: string
  metadataRepo?: string
  filter?: string
  initialPath?: string
  currentPage?: number
}

export function pullRequestsPage(options: PullRequestsOptions) {
  const { repo, viewer, openCount, currentPage = 1 } = options

  const [ownerLogin, name] = (options.layoutRepo ?? repo).split('/')

  const numericCount = Number(openCount ?? 0)

  const visibleRows = Math.min(Math.max(numericCount, 0), 25)

  const rows = Array.from({ length: visibleRows }, (_, index) => {
    return { number: index + 1, title: `Visible result ${index + 1}` }
  })

  // The zero dashboard really omits results, totalPages, and totalCount.
  const content =
    openCount === 0
      ? { currentPage, openCount: 0, closedCount: 0 }
      : {
          currentPage,
          openCount,
          closedCount: 2222,
          totalCount: openCount,
          totalPages: Math.min(Math.ceil(numericCount / 25), 40),
          results: rows,
        }

  const payload = {
    repoPullsDashboardContentRoute: content,
    repoPullsDashboardLayoutRoute: { repository: { ownerLogin, name } },
  }

  const html = fixture({
    repo,
    metadata: options.metadataRepo ?? repo,
    viewer,
    ownerLogin,
    navigation: [
      { label: 'Code', section: '' },
      { label: 'Pull requests', section: '/pulls', count: 50000 },
    ],
  })

  // Markers and payload fields follow independently captured GitHub SSR pages;
  // viewer identity and counts are controlled fixtures, not production output.
  return html.replace(
    '</main>',
    `<react-app app-name="repo" data-ssr="true" initial-path="${options.initialPath ?? `/${repo}/pulls/${viewer}`}">
    <script type="application/json" data-target="react-app.embeddedData">${JSON.stringify({ payload })}</script>
    <input name="repo-pulls-dashboard-filter-inputname" value="${options.filter ?? `is:pr state:open author:${viewer}`}">
    <ul>${rows
      .map((row) => {
        return `<li>${row.title}</li>`
      })
      .join('')}</ul>
    <a href="/${repo}/pulls/${viewer}?page=2">Next page</a>
  </react-app></main>`,
  )
}

export function gate() {
  let release = () => {}

  const promise = new Promise<void>((resolve) => {
    release = () => {
      resolve()
    }
  })

  return { promise, release }
}

export async function softVisit(page: Page, name: string) {
  await page.evaluate((name) => {
    history.pushState({}, '', `/${name}`)

    window
      .fixtureElement('meta', '[name="octolytics-dimension-repository_nwo"]')
      .setAttribute('content', name)

    window.fixtureElement('div', '#repository-container-header').innerHTML =
      `<a href="/${name}">${name}</a>`

    window.fixtureElement('nav', '[aria-label="Repository"]').innerHTML =
      `<a href="/${name}">Code</a><a href="/${name}/pulls">Pull requests</a>`

    document.dispatchEvent(new Event('turbo:load'))
  }, name)
}

export async function paintSettledResponse(page: Page, response: Response) {
  await response.finished()

  // Let the consumed response commit and paint before asserting an omitted
  // state, which would otherwise also pass while the request was still loading.
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
    })
  })
}
