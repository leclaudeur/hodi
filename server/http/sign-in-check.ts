import type express from 'express'
import type { UserAccount } from '../db/user-account-store.ts'
import type { SignInRefusal } from '../plugins/registry.ts'

// Whether a sign-in may go on, asked of the plugins (checkSignIn) once the account is known and before anything is
// written: null lets it in. The server's admin is never asked, so that a broken plugin cannot lock out the one person
// who can remove it.
export type CheckSignIn = (account: UserAccount) => Promise<SignInRefusal | null>

export const ANYONE_IN: CheckSignIn = async () => null

// The page shows the plugin's message when it knows the key, Hodi's neutral one otherwise.
export const refuseSignIn = (response: express.Response, refusal: SignInRefusal) => {
  response.status(403).json({ error: 'sign_in_refused', plugin: refusal.plugin, message: refusal.message })
}
