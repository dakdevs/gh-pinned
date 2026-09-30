import { useEffect, useMemo, useState } from 'react'
import { storageKey } from './repository-store'
import { z } from './zod'

const GITHUB_ORIGIN = 'https://github.com'
const FRESH_FOR = 60_000
const ViewerSchema = z.string().regex(/^[a-z\d][a-z\d-]{0,38}$/iu)
const DashboardSchema = z.object({
  payload: z.object({
    repoPullsDashboardContentRoute: z.object({
      currentPage: z.literal(1),
      openCount: z.int().nonnegative(),
    }),
    repoPullsDashboardLayoutRoute: z.object({
      repository: z.object({ ownerLogin: z.string(), name: z.string() }),
    }),
  }),
})

export function currentViewer(doc: Document) {
  // GitHub's octolytics user_login describes the repository owner, not viewer.
  const result = ViewerSchema.safeParse(
    doc.querySelector<HTMLMetaElement>('meta[name="user-login"]')?.content,
  )

  return result.success ? result.data.toLowerCase() : null
}

function authoredFilter(value: string, viewer: string) {
  const terms = value
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .map((term) => {
      return term === 'is:open' ? 'state:open' : term
    })
    .toSorted()

  return terms.join(' ') === [`author:${viewer}`, 'is:pr', 'state:open'].join(' ')
}

export function extractPullRequestCount(doc: Document, name: string, viewer: string) {
  const expectedPath = `/${name}/pulls/${viewer}`.toLowerCase()

  const app = doc.querySelector('react-app[app-name="repo"][data-ssr="true"]')

  if (
    app === null ||
    currentViewer(doc) !== viewer ||
    app.getAttribute('initial-path')?.toLowerCase() !== expectedPath
  ) {
    return null
  }

  const filter = app.querySelector<HTMLInputElement>(
    'input[name="repo-pulls-dashboard-filter-inputname"]',
  )

  if (filter === null || !authoredFilter(filter.value, viewer)) {
    return null
  }

  const script = app.querySelector(
    'script[type="application/json"][data-target="react-app.embeddedData"]',
  )

  let raw: unknown

  try {
    raw = JSON.parse(script?.textContent ?? '')
  } catch {
    return null
  }

  const result = DashboardSchema.safeParse(raw)

  if (!result.success) {
    return null
  }

  const repository = result.data.payload.repoPullsDashboardLayoutRoute.repository

  if (`${repository.ownerLogin}/${repository.name}`.toLowerCase() !== name.toLowerCase()) {
    return null
  }

  // The filtered total includes every page. The visible result rows and the
  // repository navigation's PR counter are unrelated to this personal total.
  return result.data.payload.repoPullsDashboardContentRoute.openCount
}

async function fetchPullRequestCount(name: string, viewer: string, signal: AbortSignal) {
  if (signal.aborted) {
    return null
  }

  const controller = new AbortController()

  const abort = () => {
    controller.abort()
  }

  const timeout = setTimeout(abort, 8000)

  signal.addEventListener('abort', abort, { once: true })

  try {
    // GitHub's native author filter canonicalizes to this route. Asking for
    // the route directly avoids the query page's redirect and adds no token.
    const url = new URL(`/${name}/pulls/${viewer}`, GITHUB_ORIGIN)

    const response = await fetch(url.href, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: { Accept: 'text/html' },
      signal: controller.signal,
    })

    if (
      !response.ok ||
      response.url.toLowerCase() !== url.href.toLowerCase() ||
      response.headers.get('content-type')?.includes('text/html') !== true
    ) {
      return null
    }

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html')

    return currentViewer(document) === viewer ? extractPullRequestCount(doc, name, viewer) : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)

    signal.removeEventListener('abort', abort)
  }
}

function createCountReader(viewer: string) {
  const controller = new AbortController()

  const cache = new Map<string, { count: number | null; checkedAt: number }>()

  const inFlight = new Map<string, Promise<number | null>>()

  const waiting: (() => void)[] = []

  let active = 0

  async function fetchLimited(name: string) {
    if (active >= 2) {
      await new Promise<void>((resolve) => {
        waiting.push(resolve)
      })
    } else {
      active++
    }

    try {
      return await fetchPullRequestCount(name, viewer, controller.signal)
    } finally {
      const next = waiting.shift()

      if (next) {
        next()
      } else {
        active--
      }
    }
  }

  function read(name: string) {
    const key = storageKey(name)

    const known = cache.get(key)

    if (known && Date.now() - known.checkedAt < FRESH_FOR) {
      return Promise.resolve(known.count)
    }

    const pending = inFlight.get(key)

    if (pending) {
      return pending
    }

    const request = fetchLimited(name)
      .then((count) => {
        if (!controller.signal.aborted) {
          cache.delete(key)

          cache.set(key, { count, checkedAt: Date.now() })

          if (cache.size > 256) {
            const oldest = cache.keys().next().value

            if (oldest !== undefined) {
              cache.delete(oldest)
            }
          }
        }

        return count
      })
      .finally(() => {
        inFlight.delete(key)
      })

    inFlight.set(key, request)

    return request
  }

  return {
    read,
    dispose() {
      controller.abort()

      cache.clear()
    },
  }
}

export function usePullRequestCounts(repositories: string, viewer: string | null, route: string) {
  const reader = useMemo(() => {
    return viewer === null ? null : createCountReader(viewer)
  }, [viewer])

  const [state, setState] = useState<{
    reader: typeof reader
    counts: Record<string, number | null>
  }>({ reader: null, counts: {} })

  useEffect(() => {
    return () => {
      reader?.dispose()
    }
  }, [reader])

  useEffect(() => {
    let disposed = false

    let refreshing = false

    const names = repositories === '' ? [] : repositories.split(',')

    async function refresh() {
      if (
        reader === null ||
        refreshing ||
        document.visibilityState === 'hidden' ||
        route !== `${location.pathname}${location.search}`
      ) {
        return
      }

      const countReader = reader

      refreshing = true

      const counts: Record<string, number | null> = {}

      setState({ reader: countReader, counts })

      await Promise.all(
        names.map(async (name) => {
          const count = await countReader.read(name)

          if (!disposed) {
            counts[storageKey(name)] = count

            setState({ reader: countReader, counts: { ...counts } })
          }
        }),
      )

      refreshing = false
    }

    function onFocus() {
      void refresh()
    }

    void refresh()

    window.addEventListener('focus', onFocus)

    document.addEventListener('visibilitychange', onFocus)

    return () => {
      disposed = true

      window.removeEventListener('focus', onFocus)

      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [reader, repositories, route])

  return reader !== null && state.reader === reader ? state.counts : {}
}
