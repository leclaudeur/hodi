import type express from 'express'
import {
  PROFILE_COOKIE,
  SESSION_COOKIE,
  clearedSessionCookie,
  createDeviceSessionToken,
  readCookie,
  readProfileToken,
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

export interface Session {
  account: UserAccount
  // null: a session from before devices were kept, which the app moves to one (see requireSession).
  device: UserDevice | null
  token: string
}

// A household has five profiles at most: no more accounts sign in on one device.
const MAX_SESSIONS = 5

// « Qui lit ? » shows the accounts signed in on this device, like a TV's streaming app: the session cookie holds one
// token per account, apart by « ~ », all of one household.
const tokensOf = (request: express.Request) =>
  (readCookie(request.get('cookie'), SESSION_COOKIE) ?? '').split('~').filter(Boolean).slice(0, MAX_SESSIONS)

export const accountSession = (
  accounts: UserAccountStore | undefined,
  devices: UserDeviceStore | undefined,
  secret: Buffer,
  now: () => number,
  // The version a profile's cookie is signed for (see profileToken); null for no such profile.
  profileVersionOf: (profileId: number) => number | string | null = () => null
) => {
  // A token's time is in whole seconds: a row made in the same second as it still counts as made before.
  const madeBefore = (createdAt: number, issuedAt: number) => createdAt < issuedAt + 1000

  const keyOf = (account: UserAccount) => userSessionKey(secret, account.id, account.sessionGeneration)

  const verify = (token: string): Session | null => {
    if (!accounts) return null
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
    if (found.deviceId === null) return { account, device: null, token }
    // Signed out from Appareils: the row is gone, the cookie with it. A row made after the cookie has its id again
    // (SQLite gives a deleted row's id to the next one): it is another device's.
    const device = devices?.get(account.id, found.deviceId) ?? null
    if (!device || !madeBefore(device.createdAt, found.issuedAt)) return null
    return { account, device, token }
  }

  // Every account signed in on this device, once each.
  const sessionsOf = (request: express.Request) =>
    tokensOf(request)
      .map(verify)
      .filter(
        (session, index, all): session is Session =>
          session !== null && all.findIndex(other => other?.account.id === session.account.id) === index
      )

  // The account of the profile open here, from a cookie Hodi signed when it opened: an id typed in the cookie by hand
  // never makes another account signed in on the device the one asking.
  const ownerOfOpenProfile = (request: express.Request) => {
    const raw = readCookie(request.get('cookie'), PROFILE_COOKIE)
    const profileId = Number((raw ?? '').split('.')[0])
    const version = Number.isInteger(profileId) && profileId > 0 ? profileVersionOf(profileId) : null
    if (version === null || !readProfileToken(raw, secret, () => version)?.signed) return null
    return accounts?.ofProfile(profileId) ?? null
  }

  // The account whose profile is open here, else the first one signed in: the one its pages and checks are for.
  const sessionOf = (request: express.Request): Session | null => {
    const all = sessionsOf(request)
    const owner = ownerOfOpenProfile(request)
    const session = all.find(candidate => candidate.account.id === owner?.id) ?? all[0] ?? null
    if (session?.device) devices?.touch(session.device, now())
    return session
  }

  const accountOf: AccountOf = request => sessionOf(request)?.account ?? null

  // The device's cookie with this token of the account in place of any it had. The others of another household go:
  // a device serves one household. An account in no household is alone on its device: nothing else would tell which
  // of two such accounts asks.
  const cookieWith = (account: UserAccount, token: string, request: express.Request) => {
    const household = accounts?.householdOf(account.id) ?? null
    const others = sessionsOf(request)
      .filter(
        session =>
          household !== null &&
          session.account.id !== account.id &&
          accounts?.householdOf(session.account.id) === household
      )
      .map(session => session.token)
    return sessionCookie([...others, token].slice(-MAX_SESSIONS).join('~'))
  }

  // This device's session again, signed with the account as it is now (after a new password, say).
  const cookieForDevice = (account: UserAccount, deviceId: number, request: express.Request) =>
    cookieWith(account, createDeviceSessionToken(account.id, deviceId, keyOf(account), now()), request)

  const cookieFor: CookieFor = (account, request) => {
    if (!devices) throw new Error('No device store')
    const device = devices.create(account.id, request.get('user-agent') ?? '', now())
    return cookieForDevice(account, device.id, request)
  }

  // « Se déconnecter » for one account: the device keeps the others, and how many are left.
  const cookieWithout = (accountId: number, request: express.Request) => {
    const left = sessionsOf(request).filter(session => session.account.id !== accountId)
    const cookie = left.length ? sessionCookie(left.map(session => session.token).join('~')) : clearedSessionCookie()
    return { cookie, left }
  }

  return { sessionOf, sessionsOf, accountOf, cookieFor, cookieForDevice, cookieWithout }
}
