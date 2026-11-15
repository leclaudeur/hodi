import { afterEach, describe, expect, it } from 'vitest'
import { anotherTabOpen } from '../src/lib/other-tabs.ts'

// Another tab of the same browser: a channel of its own on the same name.
const others: BroadcastChannel[] = []
const otherTab = () => {
  const tab = new BroadcastChannel('hodi:tabs')
  others.push(tab)
  return tab
}

afterEach(() => {
  for (const tab of others.splice(0)) tab.close()
})

describe('anotherTabOpen', () => {
  it('says no when this tab is the only one', async () => {
    expect(await anotherTabOpen(50)).toBe(false)
  })

  it('says yes when another tab answers', async () => {
    const tab = otherTab()
    tab.addEventListener('message', event => {
      if (event.data === 'open?') tab.postMessage('here')
    })
    expect(await anotherTabOpen(500)).toBe(true)
  })

  it('answers a tab that opens after it', async () => {
    await anotherTabOpen(10)
    const tab = otherTab()
    const answered = new Promise(resolve => tab.addEventListener('message', event => resolve(event.data)))
    tab.postMessage('open?')
    expect(await answered).toBe('here')
  })
})
