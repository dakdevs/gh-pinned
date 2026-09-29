import { props } from '@stylexjs/stylex'
import { styles } from './styles'

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

  return [...candidates].toSorted((left, right) => {
    return (left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_PRECEDING) === 0 ? -1 : 1
  })
}

function needsBarOffset(element: HTMLElement, top: number, height: number) {
  const bounds = element.getBoundingClientRect()

  return (
    bounds.width >= innerWidth / 2 &&
    bounds.height >= 20 &&
    Number.isFinite(top) &&
    top >= 0 &&
    top < height &&
    (bounds.top < height || !carriedBelowBar(element, height))
  )
}

function carriedBelowBar(element: HTMLElement, height: number) {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const css = getComputedStyle(parent)

    if (
      ['sticky', 'fixed'].includes(css.position) &&
      Number(css.top.replace(/px$/u, '')) >= height
    ) {
      return true
    }
  }

  return false
}

// Keep the fixed strip and its flow reservation outside GitHub's header.
// The same React host survives Turbo and body replacements.
export function createStickyBar(host: HTMLElement) {
  const slot = document.createElement('div')

  slot.id = 'ghpin-slot'

  slot.dataset.turboPermanent = ''

  host.className = props(styles.host).className ?? ''

  slot.className = props(styles.slot).className ?? ''

  host.dataset.ghpinSticky = 'true'

  let scheduled = false

  type HeaderOffset = { value: string; priority: string }

  const offsetHeaders = new Map<HTMLElement, HeaderOffset>()

  const offsetClass = props(styles.nativeStickyOffset).className ?? ''

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
      // can change it independently of the strip.
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

      const top = Number(css.top.replace(/px$/u, ''))

      if (!needsBarOffset(element, top, height)) {
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

    offsetNativeHeaders(height)
  }

  function sync() {
    const body = document.body

    if (body.firstElementChild !== host || host.nextElementSibling !== slot) {
      document.dispatchEvent(new Event('ghpin:relocating'))

      host.querySelector<HTMLDialogElement>('dialog[open]')?.close()

      body.prepend(host, slot)
    }

    const height = host.getBoundingClientRect().height

    slot.style.setProperty('--ghpin-slot-height', `${height}px`)

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

  window.addEventListener('resize', schedule)

  new ResizeObserver(schedule).observe(host)

  return { slot, sync }
}
