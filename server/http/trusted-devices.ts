import type express from 'express'
import {
  TRUST_COOKIE,
  clearedTrustCookie,
  createDeviceSessionToken,
  readCookie,
  trustCookie,
  userSessionKey,
  verifyAccountToken
} from '../auth/session.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { UserDevice, UserDeviceStore } from '../db/user-device-store.ts'
import type { accountSession } from './account-session.ts'

// A household has five profiles at most: no more accounts trust one browser.
const MAX_TRUSTED = 5

interface TrustedDevicesOptions {
  accounts: UserAccountStore
  devices: UserDeviceStore
  session: ReturnType<typeof accountSession>
  secret: Buffer
  now: () => number
}

// « Ne plus demander sur cet appareil »: the browser keeps a session of each account that trusts it, apart from the
// one it is signed in with, so a tablet shared by a parent and a teen opens the parent's private profile only on the
// devices the parent chose. The account's row of the device says it is trusted: « Redemander », « Déconnecter », a
// new password or signing out here end it.
export const trustedDevices = ({ accounts, devices, session, secret, now }: TrustedDevicesOptions) => {
  const keyOf = (userId: number) => {
    const account = accounts.get(userId)
    return account ? userSessionKey(secret, account.id, account.sessionGeneration) : null
  }

  // A token's time is in whole seconds: a row made in the same second as it still counts as made before.
  const entriesOf = (request: express.Request) =>
    (readCookie(request.get('cookie'), TRUST_COOKIE) ?? '')
      .split('~')
      .filter(Boolean)
      .slice(0, MAX_TRUSTED)
      .flatMap(token => {
        const found = verifyAccountToken(token, keyOf, now())
        const device = found?.deviceId ? devices.get(found.userId, found.deviceId) : null
        return found && device?.trusted && device.createdAt < found.issuedAt + 1000
          ? [{ token, userId: found.userId, device }]
          : []
      })

  const trustedFor = (request: express.Request, account: UserAccount): UserDevice | null =>
    entriesOf(request).find(entry => entry.userId === account.id)?.device ?? null

  // This browser trusted by the account: the given row, or the one it is signed in with when that is the account's,
  // or a new one. It is signed in with that account from now on, as when its profile opens with the password.
  const trustHere = (request: express.Request, account: UserAccount, trusted: UserDevice | null = null) => {
    const signedIn = session.sessionOf(request)
    const device =
      trusted ??
      (signedIn?.account.id === account.id ? signedIn.device : null) ??
      devices.create(account.id, request.get('user-agent') ?? '', now())
    devices.setTrusted(account.id, device.id, true)
    const others = entriesOf(request)
      .filter(entry => entry.userId !== account.id)
      .map(entry => entry.token)
    const token = createDeviceSessionToken(account.id, device.id, keyOf(account.id)!, now())
    return [session.cookieForDevice(account, device.id), trustCookie([...others, token].slice(-MAX_TRUSTED))]
  }

  // Signing out here: no account trusts this browser any more.
  const forget = (request: express.Request) => {
    for (const { userId, device } of entriesOf(request)) devices.setTrusted(userId, device.id, false)
    return clearedTrustCookie()
  }

  return { trustedFor, trustHere, forget }
}

export type TrustedDevices = ReturnType<typeof trustedDevices>
