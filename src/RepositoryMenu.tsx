import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  BookIcon,
  CheckIcon,
  CodeIcon,
  CommentDiscussionIcon,
  GearIcon,
  GitPullRequestIcon,
  GraphIcon,
  IssueOpenedIcon,
  PlayIcon,
  PinSlashIcon,
  ProjectIcon,
  RepoIcon,
  ShieldIcon,
} from '@primer/octicons-react'
import { props } from '@stylexjs/stylex'
import {
  discoverRepositoryNavigation,
  type extractRepositoryNavigation,
} from './repository-navigation'
import { menuStyles } from './menu-styles'

type NavResult = ReturnType<typeof extractRepositoryNavigation>
type MenuRequest = { name: string; anchor: HTMLElement; x: number; y: number }
type MenuProps = {
  request: MenuRequest
  choice: string
  isPinned: boolean
  onDiscover: (result: NavResult) => Promise<void>
  onChoose: (section: string) => Promise<void>
  onClose: () => void
  onUnpin: () => void
}
type MenuData = { items: NavResult['items']; error: string }

const icons = new Map([
  ['', CodeIcon],
  ['/issues', IssueOpenedIcon],
  ['/pulls', GitPullRequestIcon],
  ['/discussions', CommentDiscussionIcon],
  ['/actions', PlayIcon],
  ['/wiki', BookIcon],
  ['/projects', ProjectIcon],
  ['/pulse', GraphIcon],
  ['/security', ShieldIcon],
  ['/settings', GearIcon],
])

function tabDestination(anchor: HTMLElement, backwards: boolean, panel: HTMLElement) {
  const controls = [
    ...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'),
  ]
    .filter((element) => {
      return element instanceof HTMLElement
    })
    .filter((element) => {
      return (
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.closest('[inert]') === null &&
        !panel.contains(element) &&
        element.getClientRects().length > 0 &&
        getComputedStyle(element).visibility !== 'hidden'
      )
    })

  const index = controls.indexOf(anchor)

  return controls[index + (backwards ? -1 : 1)] ?? anchor
}

export function RepositoryMenu({
  request,
  choice,
  isPinned,
  onDiscover,
  onChoose,
  onClose,
  onUnpin,
}: MenuProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  const discovered = useEffectEvent(onDiscover)

  const close = useEffectEvent(onClose)

  const mounted = useRef(true)

  const restoreTarget = useRef<HTMLElement | null>(null)

  const interacted = useRef(false)

  const saving = useRef(false)

  const [data, setData] = useState<MenuData | null>(null)

  const [pending, setPending] = useState(false)

  const [saveError, setSaveError] = useState('')

  const [activeSection, setActiveSection] = useState<string | null>(choice)

  const items = useMemo(() => {
    return (
      data?.items ?? [
        { label: 'Repo home', href: `https://github.com/${request.name}`, section: '' },
      ]
    )
  }, [data, request.name])

  const statusMessage = saveError || (data === null ? 'Loading repository pages…' : data.error)

  // The parent keys this component by menu opening, so this request is fixed.
  useEffect(() => {
    let disposed = false

    async function load() {
      try {
        const result = await discoverRepositoryNavigation(request.name)

        if (disposed) {
          return
        }

        try {
          await discovered(result)
        } catch {
          if (!disposed) {
            setSaveError('Could not refresh the saved destination. Choose a page to try again.')
          }
        }

        if (!disposed) {
          setData({
            items: result.items,
            error: result.reliable
              ? ''
              : 'Repository pages could not be verified. Repo home is available.',
          })
        }
      } catch {
        if (!disposed) {
          setData({
            items: [
              { label: 'Repo home', href: `https://github.com/${request.name}`, section: '' },
            ],
            error: 'Could not load repository pages. Repo home is available.',
          })
        }
      }
    }

    void load()

    return () => {
      disposed = true
    }
  }, [request])

  // Async choices and status text can change the panel's height before paint.
  useLayoutEffect(() => {
    const panel = panelRef.current

    const place = () => {
      if (panel === null) {
        return
      }

      const maxHeight = Math.max(0, innerHeight - 16)

      const bounds = panel.getBoundingClientRect()

      const height = Math.min(panel.scrollHeight + bounds.height - panel.clientHeight, maxHeight)

      panel.style.setProperty(
        '--ghpin-menu-left',
        `${Math.max(8, Math.min(request.x, innerWidth - bounds.width - 8))}px`,
      )

      panel.style.setProperty(
        '--ghpin-menu-top',
        `${Math.max(8, Math.min(request.y, innerHeight - height - 8))}px`,
      )

      panel.style.setProperty('--ghpin-menu-height', `${maxHeight}px`)
    }

    place()

    window.addEventListener('resize', place)

    const observer = new ResizeObserver(place)

    if (panel !== null) {
      observer.observe(panel)
    }

    return () => {
      window.removeEventListener('resize', place)

      observer.disconnect()
    }
  })

  useLayoutEffect(() => {
    const panel = panelRef.current

    if (panel === null) {
      return
    }

    if (interacted.current && panel.contains(document.activeElement)) {
      return
    }

    const buttons = [
      ...panel.querySelectorAll<HTMLButtonElement>(
        isPinned ? '[role="menuitemradio"], [role="menuitem"]' : '[role="menuitemradio"]',
      ),
    ]

    const selectedSection =
      items.find((item) => {
        return item.section === choice
      })?.section ?? items[0]?.section

    const initialChoice =
      buttons.find((button) => {
        return button.dataset.section === selectedSection
      }) ?? buttons[0]

    initialChoice?.focus()
  }, [items, choice, isPinned])

  useEffect(() => {
    const panel = panelRef.current

    mounted.current = true

    const outside = (event: Event) => {
      if (panel !== null && (!(event.target instanceof Node) || !panel.contains(event.target))) {
        close()
      }
    }

    const observer = new MutationObserver(() => {
      if (!request.anchor.isConnected) {
        close()
      }
    })

    observer.observe(document.documentElement, { childList: true, subtree: true })

    document.addEventListener('pointerdown', outside, true)

    document.addEventListener('contextmenu', outside, true)

    document.addEventListener('scroll', outside, true)

    return () => {
      mounted.current = false

      observer.disconnect()

      document.removeEventListener('pointerdown', outside, true)

      document.removeEventListener('contextmenu', outside, true)

      document.removeEventListener('scroll', outside, true)

      queueMicrotask(() => {
        if (panel === null) {
          return
        }

        if (
          restoreTarget.current === null &&
          document.activeElement !== document.body &&
          !panel.contains(document.activeElement)
        ) {
          return
        }

        const target =
          restoreTarget.current ??
          (request.anchor.isConnected
            ? request.anchor
            : (document.querySelector<HTMLElement>('#ghpin-bar a') ??
              document.querySelector<HTMLElement>('#ghpin-bar')))

        if (target !== null && target.isConnected) {
          target.focus()
        }
      })
    }
  }, [request])

  async function choose(section: string) {
    if (saving.current) {
      return
    }

    interacted.current = true

    saving.current = true

    setPending(true)

    setSaveError('')

    try {
      await onChoose(section)

      if (mounted.current) {
        onClose()
      }
    } catch {
      if (mounted.current) {
        setSaveError('Could not save the destination. Try again.')
      }
    } finally {
      saving.current = false

      if (mounted.current) {
        setPending(false)
      }
    }
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()

      event.stopPropagation()

      onClose()

      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()

      restoreTarget.current = tabDestination(request.anchor, event.shiftKey, event.currentTarget)

      onClose()

      return
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return
    }

    event.preventDefault()

    event.stopPropagation()

    interacted.current = true

    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"], [role="menuitem"]',
      ),
    ]

    let index = buttons.findIndex((button) => {
      return button === document.activeElement
    })

    if (event.key === 'Home') {
      index = 0
    } else if (event.key === 'End') {
      index = buttons.length - 1
    } else {
      index = (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    }

    buttons[index]?.focus()
  }

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      tabIndex={-1}
      aria-label={`Default destination for ${request.name}`}
      aria-describedby="ghpin-destination-description"
      aria-busy={pending || undefined}
      onKeyDown={keyDown}
      onContextMenu={(event) => {
        event.preventDefault()
      }}
      {...props(menuStyles.panel)}
    >
      <div id="ghpin-destination-description" role="presentation" {...props(menuStyles.heading)}>
        <span {...props(menuStyles.caption)}>Open tab to</span>
        <span {...props(menuStyles.repository)}>{request.name}</span>
      </div>
      {items.map((item) => {
        const Component = icons.get(item.section) ?? RepoIcon

        return (
          <button
            key={item.section}
            type="button"
            role="menuitemradio"
            data-section={item.section}
            aria-checked={choice === item.section}
            aria-disabled={pending || undefined}
            tabIndex={activeSection === item.section ? 0 : -1}
            onFocus={() => {
              setActiveSection(item.section)
            }}
            onPointerDown={() => {
              interacted.current = true
            }}
            onClick={() => {
              void choose(item.section)
            }}
            {...props(menuStyles.item, pending && menuStyles.pending)}
          >
            <Component
              size={16}
              verticalAlign="unset"
              aria-hidden="true"
              {...props(menuStyles.icon, menuStyles.leadingIcon)}
            />
            <span {...props(menuStyles.label)}>{item.label}</span>
            <span aria-hidden="true" {...props(menuStyles.check)}>
              {choice === item.section && (
                <CheckIcon size={16} verticalAlign="unset" {...props(menuStyles.icon)} />
              )}
            </span>
          </button>
        )
      })}
      {statusMessage && (
        <output {...props(menuStyles.status, Boolean(saveError) && menuStyles.error)}>
          {statusMessage}
        </output>
      )}
      {isPinned && (
        <>
          <div role="separator" {...props(menuStyles.separator)} />
          <button
            type="button"
            role="menuitem"
            aria-disabled={pending || undefined}
            tabIndex={activeSection === null ? 0 : -1}
            onFocus={() => {
              setActiveSection(null)
            }}
            onPointerDown={() => {
              interacted.current = true
            }}
            onClick={() => {
              if (!saving.current) {
                onUnpin()
              }
            }}
            {...props(menuStyles.item, pending && menuStyles.pending)}
          >
            <PinSlashIcon
              size={16}
              verticalAlign="unset"
              aria-hidden="true"
              {...props(menuStyles.icon, menuStyles.leadingIcon)}
            />
            <span {...props(menuStyles.label)}>Unpin repository</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
