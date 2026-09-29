import { props, type StyleXStyles } from '@stylexjs/stylex'
import { styles } from './styles'

function applyStyles(element: HTMLElement, ...values: StyleXStyles[]) {
  const compiled = props(...values)

  element.className = compiled.className ?? ''

  for (const [name, value] of Object.entries(compiled.style ?? {})) {
    element.style.setProperty(name, String(value))
  }
}

function documentTop(element: HTMLElement) {
  let top = 0

  for (let node: Element | null = element; node instanceof HTMLElement; node = node.offsetParent) {
    top += node.offsetTop
  }

  return top
}

function nativeHeaderCandidates(existing: Iterable<HTMLElement>) {
  const candidates = new Set(existing)

  for (const control of document.querySelectorAll<HTMLElement>(
    'header, nav, [role="banner"], [role="tablist"], [class*="sticky"], [class*="Sticky"]',
  )) {
    let element: HTMLElement | null = control

    for (let depth = 0; element && depth < 4; depth++, element = element.parentElement) {
      candidates.add(element)
    }
  }

  return candidates
}

function overlapsBar(bounds: DOMRect, top: number, height: number) {
  return (
    bounds.width >= innerWidth / 2 &&
    bounds.height >= 20 &&
    bounds.height <= innerHeight / 2 &&
    Number.isFinite(top) &&
    top >= 0 &&
    top < height
  )
}

// The placeholder keeps the original flow position. Floating outside GitHub's
// header avoids its limited height and stacking contexts trapping the strip.
export function createStickyBar(host: HTMLElement) {
  const slot = document.createElement('div')

  slot.id = 'ghpin-slot'

  slot.dataset.turboPermanent = ''

  applyStyles(slot, styles.slot)

  let floating = false

  let scheduled = false

  let origin: number | undefined

  type HeaderOffset = { value: string; priority: string }

  const offsetHeaders = new Map<HTMLElement, HeaderOffset>()

  const offsetClass = props(styles.nativeStickyOffset).className ?? ''

  const measureClasses = (props(styles.measureFlow).className ?? '').split(' ').filter(Boolean)

  function measureOrigin() {
    const positionedParents: HTMLElement[] = []

    for (
      let parent = slot.parentElement;
      parent && parent !== document.body;
      parent = parent.parentElement
    ) {
      if (['sticky', 'fixed'].includes(getComputedStyle(parent).position)) {
        positionedParents.push(parent)
      }
    }
    // offsetTop includes a sticky ancestor's current scroll translation. Read
    // its normal flow position synchronously, then restore before any paint.

    positionedParents.forEach((parent) => {
      parent.classList.add(...measureClasses)
    })

    const top = documentTop(slot)

    positionedParents.forEach((parent) => {
      parent.classList.remove(...measureClasses)
    })

    return top
  }

  function restoreHeader(element: HTMLElement, original: HeaderOffset) {
    element.classList.remove(offsetClass)

    delete element.dataset.ghpinStickyOffset

    if (original.value) {
      element.style.setProperty('--ghpin-sticky-top', original.value, original.priority)
    } else {
      element.style.removeProperty('--ghpin-sticky-top')
    }

    offsetHeaders.delete(element)
  }

  function offsetNativeHeaders(height: number) {
    for (const element of nativeHeaderCandidates(offsetHeaders.keys())) {
      if (!element.isConnected) {
        const original = offsetHeaders.get(element)

        if (original) {
          restoreHeader(element, original)
        }

        continue
      }

      if (host.contains(element) || element === slot) {
        continue
      }

      const existing = offsetHeaders.get(element)

      // Read GitHub's current top without our override. Responsive layouts
      // can change it while the strip is floating.
      if (existing) {
        element.classList.remove(offsetClass)
      }

      const css = getComputedStyle(element)

      if (!['sticky', 'fixed'].includes(css.position)) {
        if (existing) {
          restoreHeader(element, existing)
        }

        continue
      }

      const bounds = element.getBoundingClientRect()

      const top = Number(css.top.replace(/px$/u, ''))

      if (!overlapsBar(bounds, top, height)) {
        if (existing) {
          restoreHeader(element, existing)
        }

        continue
      }

      if (!existing) {
        offsetHeaders.set(element, {
          value: element.style.getPropertyValue('--ghpin-sticky-top'),
          priority: element.style.getPropertyPriority('--ghpin-sticky-top'),
        })
      }

      element.classList.add(offsetClass)

      element.dataset.ghpinStickyOffset = ''

      element.style.setProperty('--ghpin-sticky-top', `${top + height}px`)
    }
  }

  function syncNativeHeaders(height: number) {
    // Turbo can restore a cloned header with our classes and inline variables
    // but without its original map entry. Recover its native position first.
    for (const element of document.querySelectorAll<HTMLElement>('[data-ghpin-sticky-offset]')) {
      if (!offsetHeaders.has(element)) {
        element.classList.remove(offsetClass)

        element.style.removeProperty('--ghpin-sticky-top')

        delete element.dataset.ghpinStickyOffset
      }
    }

    if (floating) {
      offsetNativeHeaders(height)
    } else {
      for (const [element, original] of offsetHeaders) {
        restoreHeader(element, original)
      }
    }
  }

  function sync(remeasure = false) {
    if (!slot.isConnected) {
      return
    }

    if (remeasure || origin === undefined) {
      origin = measureOrigin()
    }

    const nextFloating = scrollY > origin

    if (nextFloating !== floating || !host.isConnected) {
      document.dispatchEvent(new Event('ghpin:relocating'))

      host.querySelector<HTMLDialogElement>('dialog[open]')?.close()

      floating = nextFloating

      applyStyles(host, styles.host, floating && styles.floatingHost)

      const container = floating ? document.body : slot

      container.append(host)
    }

    const height = host.getBoundingClientRect().height

    applyStyles(slot, styles.slot)

    slot.style.setProperty('--ghpin-slot-height', floating ? `${height}px` : 'auto')

    host.dataset.ghpinSticky = String(floating)

    syncNativeHeaders(height)
  }

  function schedule() {
    if (scheduled) {
      return
    }

    scheduled = true

    requestAnimationFrame(() => {
      scheduled = false

      sync()
    })
  }

  window.addEventListener('scroll', schedule, { passive: true })

  window.addEventListener('resize', () => {
    origin = undefined

    schedule()
  })

  new ResizeObserver(schedule).observe(host)

  return { slot, sync }
}
