import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { PinIcon, PersonIcon, XIcon } from '@primer/octicons-react'
import { attrs, props } from '@stylexjs/stylex'
import { styles } from './styles'
import { RepositoryMenu } from './RepositoryMenu'
import { extractRepositoryNavigation } from './repository-navigation'
import { createStickyBar } from './sticky-bar'
import {
  PIN_PREFIX,
  DESTINATION_PREFIX,
  repositoryName,
  storageKey,
  readSavedState,
  readDestination,
  persistDestination,
  persistPin,
} from './repository-store'
import './stylex.css'

const HOST_ID = 'ghpin-root'

type MenuRequest = Parameters<typeof RepositoryMenu>[0]['request']
type NavResult = ReturnType<typeof extractRepositoryNavigation>
type Pin = Awaited<ReturnType<typeof readSavedState>>['pins'][number]

type UnpinRequest = { name: string; invoker: HTMLElement }

// A two-segment path alone could be /orgs/acme or /settings/profile.
// Require GitHub's repository metadata or a matching repository-header link.
function currentRepository() {
  const match = location.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/|$)/u)

  const route = match && repositoryName(`${match[1]}/${match[2]}`)

  if (route === null) {
    return null
  }

  const name = repositoryName(
    document.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-repository_nwo"]')
      ?.content,
  )

  if (name?.toLowerCase() === route.toLowerCase()) {
    return name
  }

  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    '#repository-container-header a[href]',
  )) {
    const url = new URL(link.href, location.origin)

    const candidate = repositoryName(url.pathname.slice(1).replace(/\/$/u, ''))

    if (url.origin === location.origin && candidate?.toLowerCase() === route.toLowerCase()) {
      return candidate
    }
  }

  return null
}

function Icon({ component: Component }: { component: typeof PinIcon }) {
  return <Component size={16} verticalAlign="unset" {...props(styles.icon)} />
}

function OwnerAvatar({ owner }: { owner: string }) {
  const [failed, setFailed] = useState(false)

  return failed ? (
    <span aria-hidden="true" data-ghpin-avatar-fallback="" {...props(styles.avatar)}>
      <Icon component={PersonIcon} />
    </span>
  ) : (
    <picture {...props(styles.avatarContainer)}>
      <source
        srcSet={`https://github.com/${owner}.png?size=40 1x, https://github.com/${owner}.png?size=80 2x`}
      />
      <img
        src={`https://github.com/${owner}.png?size=40`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onError={() => {
          setFailed(true)
        }}
        {...props(styles.avatar)}
      />
    </picture>
  )
}

function UnpinDialog({
  request,
  pending,
  error,
  message,
  onCancel,
  onConfirm,
}: {
  request: UnpinRequest
  pending: boolean
  error: boolean
  message: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  const cancelRef = useRef<HTMLButtonElement>(null)

  const cancelFromDOM = useEffectEvent(() => {
    if (!pending) {
      onCancel()
    }
  })

  const closeFromDOM = useEffectEvent(onCancel)

  useEffect(() => {
    const dialog = dialogRef.current

    if (!dialog) {
      return () => {
        // No dialog was mounted, so there are no native listeners to remove.
      }
    }

    const scrollClasses = (props(styles.scrollLock).className ?? '').split(' ').filter(Boolean)

    const scrollContainers = [document.documentElement, document.body]

    scrollContainers.forEach((element) => {
      element.classList.add(...scrollClasses)
    })

    function cancel(event: Event) {
      event.preventDefault()

      cancelFromDOM()
    }

    const trap = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab') {
        return
      }

      const controls = [...dialog.querySelectorAll('button')]

      const next = event.shiftKey ? controls.at(-1) : controls[0]

      const boundary = event.shiftKey ? controls[0] : controls.at(-1)

      if (document.activeElement === boundary) {
        event.preventDefault()

        next?.focus()
      }
    }

    const backdrop = (event: globalThis.MouseEvent) => {
      if (event.target !== dialog) {
        return
      }

      const bounds = dialog.getBoundingClientRect()

      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        cancelFromDOM()
      }
    }

    dialog.addEventListener('cancel', cancel)

    dialog.addEventListener('close', closeFromDOM)

    dialog.addEventListener('keydown', trap)

    dialog.addEventListener('click', backdrop)

    dialog.showModal()

    cancelRef.current?.focus()

    return () => {
      dialog.removeEventListener('cancel', cancel)

      dialog.removeEventListener('close', closeFromDOM)

      dialog.removeEventListener('keydown', trap)

      dialog.removeEventListener('click', backdrop)

      dialog.close()

      scrollContainers.forEach((element) => {
        element.classList.remove(...scrollClasses)
      })
      // A confirmed non-current shortcut may already have disappeared.

      queueMicrotask(() => {
        const target = request.invoker.isConnected
          ? request.invoker
          : (document.querySelector<HTMLElement>('#ghpin-bar a') ??
            document.querySelector<HTMLElement>('#ghpin-bar'))

        target?.focus()
      })
    }
  }, [request])

  function dismiss() {
    if (!pending) {
      onCancel()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="ghpin-unpin-title"
      aria-describedby="ghpin-unpin-description"
      aria-busy={pending || undefined}
      {...props(styles.dialog)}
    >
      <header {...props(styles.dialogHeader)}>
        <h1 id="ghpin-unpin-title" {...props(styles.dialogTitle)}>
          Unpin repository?
        </h1>
        <button
          type="button"
          aria-label="Close dialog"
          aria-disabled={pending || undefined}
          onClick={dismiss}
          {...props(styles.dialogButton, styles.dialogClose, pending && styles.pendingButton)}
        >
          <Icon component={XIcon} />
        </button>
      </header>
      <div {...props(styles.dialogBody)}>
        <p id="ghpin-unpin-description" {...props(styles.dialogText)}>
          Remove <strong>{request.name}</strong> from your pinned repositories?
        </p>
        {error && (
          <p role="alert" {...props(styles.dialogError)}>
            {message}
          </p>
        )}
      </div>
      <footer {...props(styles.dialogFooter)}>
        <button
          ref={cancelRef}
          type="button"
          aria-disabled={pending || undefined}
          onClick={dismiss}
          {...props(styles.dialogButton, pending && styles.pendingButton)}
        >
          Cancel
        </button>
        <button
          type="button"
          aria-disabled={pending || undefined}
          onClick={onConfirm}
          {...props(styles.dialogButton, pending && styles.pendingButton)}
        >
          {pending ? 'Unpinning…' : 'Unpin'}
        </button>
      </footer>
    </dialog>
  )
}

async function resetUnavailableDestination(name: string, result: NavResult) {
  if (!result.reliable) {
    return
  }

  const choice = await readDestination(name)

  if (
    choice &&
    !result.items.some((item) => {
      return item.section === choice
    })
  ) {
    await persistDestination(name, '')
  }
}

function RepoBar({
  current,
  navigation,
}: {
  current: string | null
  navigation: NavResult | null
}) {
  const [pins, setPins] = useState<Pin[]>([])

  const [ready, setReady] = useState(false)

  const [pending, setPending] = useState(false)

  const [message, setMessage] = useState('')

  const [error, setError] = useState(false)

  const [unpinRequest, setUnpinRequest] = useState<UnpinRequest | null>(null)

  const [menuRequest, setMenuRequest] = useState<(MenuRequest & { id: number }) | null>(null)

  const [destinations, setDestinations] = useState<Record<string, string>>({})

  const listRef = useRef<HTMLUListElement>(null)

  const saving = useRef(false)

  const menuSequence = useRef(0)

  const removedInvoker = useRef<UnpinRequest | null>(null)

  const currentKey = current === null ? '' : storageKey(current)

  const entries = pins.map((pin) => {
    return { name: pin.name, temporary: false }
  })

  if (
    current !== null &&
    !pins.some((pin) => {
      return storageKey(pin.name) === currentKey
    })
  ) {
    entries.push({ name: current, temporary: true })
  }

  useEffect(() => {
    let latestRequest = 0

    let disposed = false

    async function refresh() {
      const request = ++latestRequest

      try {
        const state = await readSavedState()

        if (disposed || request !== latestRequest) {
          return
        }

        setPins(state.pins)

        setDestinations(state.destinations)

        setReady(true)
      } catch {
        if (disposed || request !== latestRequest) {
          return
        }

        setError(true)

        setMessage('Could not read pins. Reload this page and try again.')
      }
    }

    function onChanged(changes: Record<string, chrome.storage.StorageChange>, area: string) {
      if (
        area === 'local' &&
        Object.keys(changes).some((key) => {
          return key.startsWith(PIN_PREFIX) || key.startsWith(DESTINATION_PREFIX)
        })
      ) {
        void refresh()
      }
    }

    chrome.storage.onChanged.addListener(onChanged)

    void refresh()

    return () => {
      disposed = true

      chrome.storage.onChanged.removeListener(onChanged)
    }
  }, [])

  useEffect(() => {
    const list = listRef.current

    if (!list) {
      return
    }

    const item = list.querySelector('[data-selected="true"]')

    if (!item) {
      return
    }

    const itemBounds = item.getBoundingClientRect()

    const listBounds = list.getBoundingClientRect()

    if (itemBounds.left < listBounds.left) {
      list.scrollLeft -= listBounds.left - itemBounds.left
    }

    if (itemBounds.right > listBounds.right) {
      list.scrollLeft += itemBounds.right - listBounds.right
    }
  })

  useEffect(() => {
    const request = removedInvoker.current

    if (request && !request.invoker.isConnected) {
      if (document.activeElement === document.body) {
        const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])]

        const fallback =
          links.find((link) => {
            return link.getAttribute('aria-label') === `Open ${request.name}`
          }) ??
          links[0] ??
          listRef.current?.closest('nav')

        fallback?.focus()
      }

      removedInvoker.current = null
    }
  })

  useEffect(() => {
    function closeOverlays() {
      setUnpinRequest(null)

      setMenuRequest(null)
    }

    document.addEventListener('ghpin:relocating', closeOverlays)

    return () => {
      document.removeEventListener('ghpin:relocating', closeOverlays)
    }
  }, [])

  async function saveDestination(name: string, section: string) {
    await persistDestination(name, section)

    setDestinations((values) => {
      return { ...values, [storageKey(name)]: section }
    })
  }

  const currentDestination = destinations[currentKey]

  useEffect(() => {
    if (
      !ready ||
      current === null ||
      currentDestination === undefined ||
      currentDestination.length === 0 ||
      navigation === null
    ) {
      return
    }

    void resetUnavailableDestination(current, navigation).catch(() => {})
  }, [current, currentDestination, ready, navigation])

  async function changePin(name: string, add: boolean, invoker: HTMLElement) {
    if (saving.current || !ready) {
      return false
    }

    saving.current = true

    setPending(true)

    setMessage('')

    setError(false)

    try {
      const key = storageKey(name)

      if (add || key !== currentKey) {
        removedInvoker.current = { name, invoker }
      }

      await persistPin(name, add)

      setMessage(`${name} ${add ? 'pinned' : 'unpinned'}.`)

      return true
    } catch {
      removedInvoker.current = null

      setError(true)

      setMessage('Could not save pins. Reload this page and try again.')

      return false
    } finally {
      saving.current = false

      setPending(false)
    }
  }

  async function confirmUnpin(request: UnpinRequest) {
    if (await changePin(request.name, false, request.invoker)) {
      setUnpinRequest(null)
    }
  }

  return (
    <nav id="ghpin-bar" aria-label="Pinned repositories" tabIndex={-1} {...props(styles.bar)}>
      <ul ref={listRef} {...props(styles.list)}>
        {entries.map(({ name, temporary }) => {
          const key = storageKey(name)

          const owner = name.slice(0, name.indexOf('/'))

          const repository = name.slice(name.indexOf('/') + 1)

          const selected = key === currentKey

          const action = `Pin ${name}`

          function openMenu(
            event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
            keyboard = false,
          ) {
            event.preventDefault()

            const anchor =
              (event.target instanceof Element
                ? event.target.closest<HTMLElement>('a, button')
                : null) ?? event.currentTarget.querySelector('a')

            if (!anchor) {
              return
            }

            const bounds = anchor.getBoundingClientRect()

            setMenuRequest({
              name,
              anchor,
              id: ++menuSequence.current,
              x: keyboard || !('clientX' in event) ? bounds.left : event.clientX,
              y: keyboard || !('clientY' in event) ? bounds.bottom : event.clientY,
            })
          }

          function menuKeyDown(event: KeyboardEvent<HTMLElement>) {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              openMenu(event, true)
            }
          }

          return (
            <li
              key={key}
              data-selected={selected}
              data-temporary={temporary}
              {...props(styles.tab, temporary && styles.temporary)}
            >
              <a
                onContextMenu={openMenu}
                href={`https://github.com/${name}${destinations[key] ?? ''}`}
                aria-label={`Open ${name}`}
                title={`Open ${name}`}
                onKeyDown={menuKeyDown}
                aria-current={selected ? 'page' : undefined}
                {...props(styles.link, temporary && styles.splitLink)}
              >
                <OwnerAvatar owner={owner} />
                <span
                  data-content={repository}
                  {...props(styles.name, selected && styles.selectedName)}
                >
                  {repository}
                </span>
              </a>
              {temporary && (
                <button
                  onContextMenu={openMenu}
                  type="button"
                  onKeyDown={menuKeyDown}
                  aria-label={action}
                  title={action}
                  disabled={!ready}
                  aria-disabled={pending || undefined}
                  onClick={(event) => {
                    void changePin(name, true, event.currentTarget)
                  }}
                  {...props(styles.button, styles.pinButton, pending && styles.pendingButton)}
                >
                  <Icon component={PinIcon} />
                  Pin
                </button>
              )}
              {selected && (
                <span aria-hidden="true" data-ghpin-indicator="" {...props(styles.indicator)} />
              )}
            </li>
          )
        })}
        {entries.length === 0 && (
          <li {...props(styles.empty)}>Visit a repository to pin it here.</li>
        )}
      </ul>
      <output {...props(styles.status, error && styles.error)}>{message}</output>
      {menuRequest && (
        <RepositoryMenu
          key={menuRequest.id}
          request={menuRequest}
          isPinned={pins.some((pin) => {
            return storageKey(pin.name) === storageKey(menuRequest.name)
          })}
          onUnpin={() => {
            if (saving.current || !ready) {
              return
            }

            setMenuRequest(null)

            setError(false)

            setMessage('')

            setUnpinRequest({ name: menuRequest.name, invoker: menuRequest.anchor })
          }}
          choice={destinations[storageKey(menuRequest.name)] ?? ''}
          onChoose={(section) => {
            return saveDestination(menuRequest.name, section)
          }}
          onDiscover={(result) => {
            return resetUnavailableDestination(menuRequest.name, result)
          }}
          onClose={() => {
            setMenuRequest(null)
          }}
        />
      )}
      {unpinRequest && (
        <UnpinDialog
          request={unpinRequest}
          pending={pending}
          error={error}
          message={message}
          onCancel={() => {
            setUnpinRequest(null)
          }}
          onConfirm={() => {
            void confirmUnpin(unpinRequest)
          }}
        />
      )}
    </nav>
  )
}

const host = document.createElement('div')
host.id = HOST_ID
host.dataset.turboPermanent = ''
Object.entries(attrs(styles.host)).forEach(([key, value]) => {
  host.setAttribute(key, value)
})
const root = createRoot(host)
const sticky = createStickyBar(host)
let previousCurrent: string | null | undefined
let previousNavigationContext: string | undefined
let scheduled = false

function headerAnchor() {
  const header = document.querySelector(
    'header.GlobalNav, .AppHeader, header[data-marketing-header], .Header, header[role="banner"]',
  )

  const globalRow =
    header !== null && header.matches('header.GlobalNav')
      ? header.querySelector(':scope > [data-component="Stack"][data-direction="horizontal"]')
      : null
  // Signed-out GitHub forces its marketing header to dark mode inside a
  // React partial. Mount outside that partial to inherit the page's theme.

  return (
    globalRow ??
    (header !== null && header.matches('header[data-marketing-header]')
      ? (header.closest('react-partial') ?? header)
      : header)
  )
}

function update() {
  // Keep the original React root when Turbo replaces the header or body.
  removeDuplicates(HOST_ID, host)

  removeDuplicates('ghpin-slot', sticky.slot)

  const anchor = headerAnchor()

  const relocated = anchor
    ? anchor.nextElementSibling !== sticky.slot
    : document.body?.firstElementChild !== sticky.slot

  if (relocated) {
    document.dispatchEvent(new Event('ghpin:relocating'))

    host.querySelector<HTMLDialogElement>('dialog[open]')?.close()

    if (anchor) {
      anchor.after(sticky.slot)
    } else {
      document.body?.prepend(sticky.slot)
    }
  }

  sticky.sync(relocated)

  const current = currentRepository()

  const navigation = current === null ? null : extractRepositoryNavigation(document, current)

  const navigationContext = `${location.pathname}${location.search}\n${JSON.stringify(navigation)}`

  if (current !== previousCurrent) {
    document.dispatchEvent(new Event('ghpin:relocating'))

    host.querySelector<HTMLDialogElement>('dialog[open]')?.close()

    previousCurrent = current
  }

  if (navigationContext !== previousNavigationContext) {
    previousNavigationContext = navigationContext

    root.render(<RepoBar current={current} navigation={navigation} />)
  }
}

function removeDuplicates(id: string, original: Element) {
  for (const duplicate of document.querySelectorAll(`#${id}`)) {
    if (duplicate !== original) {
      duplicate.remove()
    }
  }
}

function scheduleUpdate() {
  if (scheduled) {
    return
  }

  scheduled = true

  requestAnimationFrame(() => {
    scheduled = false

    update()
  })
}

new MutationObserver((records) => {
  if (
    records.some((record) => {
      return !host.contains(record.target)
    })
  ) {
    scheduleUpdate()
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    'content',
    'href',
    'aria-disabled',
    'disabled',
    'data-disabled',
    'aria-busy',
    'data-content',
  ],
})
window.navigation?.addEventListener('currententrychange', scheduleUpdate)
window.addEventListener('popstate', scheduleUpdate)
for (const event of ['turbo:load', 'turbo:render', 'pjax:end']) {
  document.addEventListener(event, scheduleUpdate)
}
update()
