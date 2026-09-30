/** @param {import('playwright').Page} page */
export async function extensionWorld(page) {
  const session = await page.context().newCDPSession(page)

  /** @type {number[]} */
  const contexts = []

  session.on('Runtime.executionContextCreated', ({ context }) => {
    contexts.push(context.id)
  })

  await session.send('Runtime.enable')

  for (const contextId of contexts) {
    const probe = await session.send('Runtime.evaluate', {
      contextId,
      expression: "typeof chrome === 'object' && Boolean(chrome.runtime?.id)",
      returnByValue: true,
    })

    if (probe.result.value === true) {
      return { session, contextId }
    }
  }

  throw new Error('The actual extension content-script execution context was not found')
}
