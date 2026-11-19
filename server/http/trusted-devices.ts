import type express from 'express'
import type { UserAccount } from '../db/user-account-store.ts'
import type { UserDevice, UserDeviceStore } from '../db/user-device-store.ts'
import type { accountSession } from './account-session.ts'

interface TrustedDevicesOptions {
  devices: UserDeviceStore
  session: ReturnType<typeof accountSession>
}

// « Ne plus demander sur cet appareil »: the account's own session on this browser is marked trusted, so a tablet
// shared by a parent and a teen opens the parent's private profile only on the devices the parent chose.
// « Redemander », « Déconnecter », a new password or signing out here end it.
export const trustedDevices = ({ devices, session }: TrustedDevicesOptions) => {
  const deviceOf = (request: express.Request, account: UserAccount): UserDevice | null =>
    session.sessionsOf(request).find(candidate => candidate.account.id === account.id)?.device ?? null

  const trustedFor = (request: express.Request, account: UserAccount): UserDevice | null => {
    const device = deviceOf(request, account)
    return device?.trusted ? device : null
  }

  // This browser trusted by the account, through its session here.
  const trustHere = (request: express.Request, account: UserAccount) => {
    const device = deviceOf(request, account)
    if (device) devices.setTrusted(account.id, device.id, true)
  }

  return { trustedFor, trustHere }
}

export type TrustedDevices = ReturnType<typeof trustedDevices>
