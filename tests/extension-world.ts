import type { Page } from 'playwright'

function probeExtensionContext() {
  return Boolean(globalThis.chrome?.runtime?.id)
}

export async function extensionWorld(page: Page) {
  const session = await page.context().newCDPSession(page)

  const contexts: number[] = []

  session.on('Runtime.executionContextCreated', ({ context }) => {
    contexts.push(context.id)
  })

  await session.send('Runtime.enable')

  for (const contextId of contexts) {
    const probe = await session.send('Runtime.evaluate', {
      contextId,
      expression: `(${probeExtensionContext.toString()})()`,
      returnByValue: true,
    })

    if (probe.result.value === true) {
      return { session, contextId }
    }
  }

  throw new Error('The actual extension content-script execution context was not found')
}
