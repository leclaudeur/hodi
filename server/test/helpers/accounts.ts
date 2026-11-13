import { hashPassword } from '../../auth/password.ts'
import type { Database } from '../../db/database.ts'
import type { ProfileStore } from '../../db/profile-store.ts'
import { UserAccountStore } from '../../db/user-account-store.ts'
import { UserDeviceStore } from '../../db/user-device-store.ts'

export const ADMIN_EMAIL = 'antho@example.com'

// The server admin's account, on the household's first profile, as the setup screens make it; with the stores
// createApp signs in with.
export const withAdminAccount = async (db: Database, profiles: ProfileStore, password: string, now: number) => {
  const accounts = new UserAccountStore(db)
  const admin = accounts.createServerAdmin(ADMIN_EMAIL, await hashPassword(password, { N: 2 ** 10, r: 8, p: 1 }), now)
  if (!admin) throw new Error('The server admin already exists')
  accounts.linkProfile(admin.id, profiles.list()[0]!.id)
  return { accounts, devices: new UserDeviceStore(db) }
}
