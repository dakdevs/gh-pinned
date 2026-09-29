import { z } from 'zod'

export const PIN_PREFIX = 'ghpin:'
export const DESTINATION_PREFIX = 'ghpin-destination:'

const RepositoryNameSchema = z
  .string()
  .regex(/^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/iu)
  .refine((name) => {
    return !['.', '..'].includes(name.slice(name.indexOf('/') + 1))
  })
const PinSchema = z.object({ name: RepositoryNameSchema, pinnedAt: z.number() })
const DestinationSchema = z
  .object({ name: RepositoryNameSchema, section: z.string() })
  .refine((value) => {
    return validDestination(value.name, value.section)
  })
type Pin = z.infer<typeof PinSchema>

export function repositoryName(value: string | undefined) {
  const result = RepositoryNameSchema.safeParse(value)

  return result.success ? result.data : null
}

export function storageKey(name: string) {
  return PIN_PREFIX + name.toLowerCase()
}

function destinationKey(name: string) {
  return DESTINATION_PREFIX + name.toLowerCase()
}

function validDestination(name: string, section: string) {
  if (section && (!section.startsWith('/') || section.startsWith('//'))) {
    return false
  }

  const home = `https://github.com/${name}`

  const url = new URL(home + section)

  return (
    url.origin === location.origin &&
    !url.hash &&
    (url.pathname.toLowerCase() === `/${name.toLowerCase()}` ||
      url.pathname.toLowerCase().startsWith(`/${name.toLowerCase()}/`))
  )
}

// Chrome's storage result is untyped external data. Parse entries here once;
// the UI receives only schema-derived pins and validated destination strings.
export async function readSavedState() {
  const values = await chrome.storage.local.get(null)

  const pins: Pin[] = []

  const destinations: Record<string, string> = {}

  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith(PIN_PREFIX)) {
      const result = PinSchema.safeParse(value)

      if (result.success && storageKey(result.data.name) === key) {
        pins.push(result.data)
      }
    } else if (key.startsWith(DESTINATION_PREFIX)) {
      const result = DestinationSchema.safeParse(value)

      if (result.success && destinationKey(result.data.name) === key) {
        destinations[storageKey(result.data.name)] = result.data.section
      }
    }
  }

  pins.sort((a, b) => {
    return a.pinnedAt - b.pinnedAt || a.name.localeCompare(b.name)
  })

  return { pins, destinations }
}

export async function readDestination(name: string) {
  const key = destinationKey(name)

  const values = await chrome.storage.local.get(key)

  const result = DestinationSchema.safeParse(values[key])

  return result.success && destinationKey(result.data.name) === key ? result.data.section : ''
}

export async function persistDestination(name: string, section: string) {
  if (!validDestination(name, section)) {
    throw new Error('Invalid repository destination.')
  }

  const key = destinationKey(name)

  if (section) {
    await chrome.storage.local.set({ [key]: { name, section } })
  } else {
    await chrome.storage.local.remove(key)
  }
}

export async function persistPin(name: string, add: boolean) {
  const key = storageKey(name)
  // Independent keys keep different repositories' concurrent changes intact.

  if (add) {
    await chrome.storage.local.set({ [key]: { name, pinnedAt: Date.now() } })
  } else {
    await chrome.storage.local.remove(key)
  }
}
