const GITHUB_ORIGIN = 'https://github.com'
const inFlight = new Map<string, Promise<NavResult>>()

function repositoryHome(name: string) {
  return new URL(`/${name}`, GITHUB_ORIGIN)
}

function belongsToRepository(url: URL, home: URL) {
  const path = url.pathname.toLowerCase()

  const root = home.pathname.toLowerCase()

  return (
    url.origin === home.origin &&
    !url.username &&
    !url.password &&
    (path === root || path.startsWith(`${root}/`))
  )
}

function tabLabel(link: HTMLAnchorElement) {
  const content = link.querySelector<HTMLElement>('[data-content]')?.dataset.content

  if (content !== undefined && content !== '') {
    return content.trim()
  }

  const text = link.ownerDocument.importNode(link, true)

  text
    .querySelectorAll(
      'svg, [aria-hidden="true"], [data-component="counter"], .Counter, .sr-only, .visually-hidden, [class*="VisuallyHidden"]',
    )
    .forEach((element) => {
      element.remove()
    })

  return (text.textContent ?? '')
    .replace(/\s*\([\d,.\s]+[km]?\)\s*$/iu, '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

function repositoryLinks(nav: Element, home: URL) {
  const links = []

  for (const link of nav.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    if (link.closest('[aria-disabled="true"], [disabled], [data-disabled="true"]')) {
      continue
    }

    const href = link.getAttribute('href')?.trim()

    if (href === undefined || href === '' || href.startsWith('#')) {
      continue
    }

    let url

    try {
      url = new URL(href, home)
    } catch {
      continue
    }

    if (belongsToRepository(url, home)) {
      links.push({ link, url })
    }
  }

  return links
}

// Read only the repository's own tabs, including responsive overflow copies.
// Visibility and tabindex do not indicate whether a GitHub section is enabled.
export function extractRepositoryNavigation(doc: Document, name: string) {
  const home = repositoryHome(name)

  const items = [{ label: 'Repo home', href: home.href, section: '' }]

  const seen = new Set([''])

  let reliable = false

  for (const nav of doc.querySelectorAll('nav[aria-label="Repository"]')) {
    if (nav.closest('[aria-busy="true"]')) {
      continue
    }

    const links = repositoryLinks(nav, home)
    // A matching Code/home tab proves this navigation belongs to this repo.
    // Metadata alone can survive while GitHub is still replacing its header.

    if (
      !links.some(({ url }) => {
        return url.pathname.replace(/\/$/u, '').toLowerCase() === home.pathname.toLowerCase()
      })
    ) {
      continue
    }

    reliable = true

    for (const { link, url } of links) {
      const section = url.pathname.slice(home.pathname.length).replace(/\/$/u, '')

      if (!section || seen.has(section)) {
        continue
      }

      const label = tabLabel(link)

      if (!label) {
        continue
      }

      seen.add(section)

      items.push({ label, href: url.href, section })
    }
  }

  return { items, reliable }
}

type NavResult = ReturnType<typeof extractRepositoryNavigation>

async function fetchRepositoryNavigation(name: string, home: URL) {
  const controller = new AbortController()

  const timeout = setTimeout(() => {
    controller.abort()
  }, 8000)

  try {
    const response = await fetch(home.href, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}.`)
    }

    const finalUrl = new URL(response.url)

    if (
      !belongsToRepository(finalUrl, home) ||
      finalUrl.pathname.replace(/\/$/u, '').toLowerCase() !== home.pathname.toLowerCase()
    ) {
      throw new Error('GitHub returned a different page.')
    }

    if (response.headers.get('content-type')?.includes('text/html') !== true) {
      throw new Error('GitHub did not return a repository page.')
    }

    const html = await response.text()

    return extractRepositoryNavigation(new DOMParser().parseFromString(html, 'text/html'), name)
  } catch (error) {
    const reason = controller.signal.aborted
      ? 'The request timed out.'
      : error instanceof Error
        ? error.message
        : String(error)

    throw new Error(`Could not load sections for ${name}. ${reason}`, { cause: error })
  } finally {
    clearTimeout(timeout)
  }
}

export async function discoverRepositoryNavigation(name: string) {
  const home = repositoryHome(name)

  if (location.origin !== GITHUB_ORIGIN) {
    throw new Error('Repository sections are available only on GitHub.')
  }

  if (belongsToRepository(new URL(location.href), home)) {
    return extractRepositoryNavigation(document, name)
  }

  const key = name.toLowerCase()

  const existing = inFlight.get(key)

  if (existing) {
    return existing
  }

  if (inFlight.size >= 4) {
    throw new Error('Sections are still loading. Try again in a moment.')
  }
  // Share concurrent requests, but refresh availability on each later menu open.

  const request = fetchRepositoryNavigation(name, home).finally(() => {
    inFlight.delete(key)
  })

  inFlight.set(key, request)

  const result = await request

  return result
}
