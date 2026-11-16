import { addServerPushDevice, removeServerPushDevice } from '../api.ts'
import { notificationSupport } from './notifications.ts'

// « Push sur cet appareil » in Serveur › Notifications: this device takes the server's notices for the admin's
// account, apart from a profile's notifications (Réglages › Notifications). Both can share the browser's one
// subscription, so turning this off only tells the server, never unsubscribes the browser.
const STORAGE_KEY = 'hodi:server-push'

export const serverPushOn = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: the choice lasts for this visit.
  }
}

const fromBase64Url = (text: string) => {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

const subscription = async (publicKey: string) => {
  const registration = await navigator.serviceWorker.ready
  return (
    (await registration.pushManager.getSubscription()) ??
    registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(publicKey) })
  )
}

export type ServerPushResult = 'enabled' | 'denied' | 'unsupported' | 'failed'

// Asks for permission (it must follow a tap on iOS), subscribes and tells the server.
export const enableServerPush = async (publicKey: string): Promise<ServerPushResult> => {
  if (notificationSupport() !== 'supported') return 'unsupported'
  try {
    if ((await Notification.requestPermission()) !== 'granted') return 'denied'
    await addServerPushDevice((await subscription(publicKey)).toJSON())
    remember(true)
    return 'enabled'
  } catch {
    return 'failed'
  }
}

export const disableServerPush = async () => {
  remember(false)
  const registration = await navigator.serviceWorker.ready.catch(() => null)
  const current = await registration?.pushManager.getSubscription().catch(() => null)
  if (current) await removeServerPushDevice(current.endpoint).catch(() => {})
}

// Sent again each time the page opens with the switch on: a browser can renew its subscription.
export const syncServerPush = async (publicKey: string) => {
  if (!serverPushOn() || notificationSupport() !== 'supported' || Notification.permission !== 'granted') return
  await addServerPushDevice((await subscription(publicKey)).toJSON()).catch(() => {})
}
