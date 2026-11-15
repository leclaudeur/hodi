// Hodi's other tabs in this browser, and the installed app's window: they share one profile cookie. A tab that opens
// asks whether another one is open, and every open tab answers, for as long as its page lives.
const CHANNEL = 'hodi:tabs'
const ASK = 'open?'
const HERE = 'here'
// Long enough for a tab in the background to answer, short enough not to hold the first screen.
const WAIT_MS = 150

// One channel per page: a page never hears its own messages, so it never answers itself.
let channel: BroadcastChannel | null | undefined

const channelOf = () => {
  if (channel !== undefined) return channel
  try {
    channel = new BroadcastChannel(CHANNEL)
    channel.addEventListener('message', (event: MessageEvent) => {
      if (event.data === ASK) channel?.postMessage(HERE)
    })
  } catch {
    // No BroadcastChannel: every tab reads as the only one, as before.
    channel = null
  }
  return channel
}

// This page answers the other tabs from now on: call it as the app starts, reload included.
export const answerOtherTabs = () => {
  channelOf()
}

// Whether another tab of Hodi is open in this browser. This page answers the others from now on.
export const anotherTabOpen = (wait = WAIT_MS): Promise<boolean> => {
  const open = channelOf()
  if (!open) return Promise.resolve(false)
  return new Promise(resolve => {
    const heard = (event: MessageEvent) => {
      if (event.data !== HERE) return
      clearTimeout(timer)
      open.removeEventListener('message', heard)
      resolve(true)
    }
    const timer = setTimeout(() => {
      open.removeEventListener('message', heard)
      resolve(false)
    }, wait)
    open.addEventListener('message', heard)
    open.postMessage(ASK)
  })
}
