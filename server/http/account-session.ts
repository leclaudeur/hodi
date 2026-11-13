import type express from 'express'
import {
  SESSION_COOKIE,
  createDeviceSessionToken,
  readCookie,
  sessionCookie,
  userSessionKey,
  verifyAccountToken
} from '../auth/session.ts'
import type { UserAccount, UserAccountStore } from '../db/user-account-store.ts'
import type { UserDevice, UserDeviceStore } from '../db/user-device-store.ts'

// The account a request is signed in with, from its session cookie; null without one.
export type AccountOf = (request: express.Request) => UserAccount | null

// A new session for a device that has just signed in: a row in Appareils, named after its browser.
export type CookieFor = (account: UserAccount, request: express.Request) => string

export const accountSession = (
  accounts: UserAccountStore | undefined,
  devices: UserDeviceStore | undefined,
  secret: Buffer,
  now: () => number
) => {
  // A token's time is in whole seconds: a row made in the same second as it still counts as made before.
  const madeBefore = (createdAt: number, issuedAt: number) => createdAt < issuedAt + 1000

  const keyOf = (account: UserAccount) => userSessionKey(secret, account.id, account.sessionGeneration)

  // device null: a session from before devices were kept, which the app moves to one (see requireSession).
  const sessionOf = (request: express.Request): { account: UserAccount; device: UserDevice | null } | null => {
    const token = readCookie(request.get('cookie'), SESSION_COOKIE)
    if (!accounts || !token) return null
    const found = verifyAccountToken(
      token,
      candidate => {
        const account = accounts.get(candidate)
        return account ? keyOf(account) : null
      },
      now()
    )
    const account = found ? accounts.get(found.userId) : null
    if (!found || !account || !madeBefore(account.createdAt, found.issuedAt)) return null
    if (found.deviceId === null) return { account, device: null }
    // Signed out from Appareils: the row is gone, the cookie with it. A row made after the cookie has its id again
    // (SQLite gives a deleted row's id to the next one): it is another device's.
    const device = devices?.get(account.id, found.deviceId) ?? null
    if (!device || !madeBefore(device.createdAt, found.issuedAt)) return null
    devices?.touch(device, now())
    return { account, device }
  }

  const accountOf: AccountOf = request => sessionOf(request)?.account ?? null

  // This device's session again, signed with the account as it is now (after a new password, say).
  const cookieForDevice = (account: UserAccount, deviceId: number) =>
    sessionCookie(createDeviceSessionToken(account.id, deviceId, keyOf(account), now()))

  const cookieFor: CookieFor = (account, request) => {
    if (!devices) throw new Error('No device store')
    const device = devices.create(account.id, request.get('user-agent') ?? '', now())
    return cookieForDevice(account, device.id)
  }

  return { sessionOf, accountOf, cookieFor, cookieForDevice }
}
