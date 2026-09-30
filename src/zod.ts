import { z } from 'zod'

// MV3 blocks runtime code generation. Configure Zod before any module creates
// object schemas so it skips its eval probe and optional compiler fast path.
z.config({ jitless: true })

export { z }
