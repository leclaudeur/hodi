import { createHmac, randomInt } from 'node:crypto'
import type { Database } from './database.ts'
import { currentHouseholdId } from './household-scope.ts'
import { CONFIG } from '../fixed-config.ts'

// "J'ai un code": eight letters and digits that let a person make their account in the household, from a device signed in with
// nothing. An invitation (no profile) adds them as a new adult; a code for a profile gives that profile its person.
// A reset code gives an adult who has an account a new password. Valid once, for a day. The table keeps a hash keyed with the server's secret, so a copy of the database alone
// cannot be turned back into codes.

// Eight characters of 31 (about 850 billion codes, against a million for six digits): guessing one is out of reach
// even for many devices sharing the throttle's global allowance. No 0, O, 1, I or L, which read alike.
export const SIGN_IN_CODE_LENGTH = 8
export const SIGN_IN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const SIGN_IN_CODE_LIFETIME = CONFIG.codes.signInLifetime

export interface SignInCode {
  householdId: number
  // null: an invitation to join as a new adult.
  profileId: number | null
  // The profile that made it, for "Rejoins <foyer>": "<name> t'invite".
  createdBy: number | null
  // "Mot de passe oublié": the profile's account chooses a new password.
  reset: boolean
  expiresAt: number
}

// What an invitation was given: a name, and the address its code was sent to.
export interface Invite {
  name: string
  email: string | null
}

export interface Invitation {
  id: number
  name: string | null
  email: string | null
  expiresAt: number
}

interface SignInCodeRow {
  account_id: number
  profile_id: number | null
  created_by: number | null
  reset: number
  expires_at: number
}

const toCode = (row: SignInCodeRow): SignInCode => ({
  householdId: row.account_id,
  profileId: row.profile_id,
  createdBy: row.created_by,
  reset: row.reset === 1,
  expiresAt: row.expires_at
})

// Eight characters of the alphabet, drawn at random: about 40 bits. The setup code is one too.
export const drawCode = () =>
  Array.from(
    { length: SIGN_IN_CODE_LENGTH },
    () => SIGN_IN_CODE_ALPHABET[randomInt(SIGN_IN_CODE_ALPHABET.length)]
  ).join('')

// A code as people read it: two groups of four, joined by a dash, as the boxes draw it. Typed back, the dash goes.
export const codeForPeople = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`

const CODE_PATTERN = new RegExp(`^[${SIGN_IN_CODE_ALPHABET}]{${SIGN_IN_CODE_LENGTH}}$`)

// A code as typed, read as the code it is: in capitals, without the spaces or dashes a person may add. null when it
// cannot be one.
export const signInCodeOf = (value: unknown): string | null => {
  if (typeof value !== 'string' || value.length > 32) return null
  const code = value.toUpperCase().replace(/[\s-]/g, '')
  return CODE_PATTERN.test(code) ? code : null
}

export class SignInCodeStore {
  readonly #db: Database
  readonly #secret: Buffer

  constructor(db: Database, secret: Buffer) {
    this.#db = db
    this.#secret = secret
  }

  #hash(code: string) {
    return createHmac('sha256', this.#secret).update(`sign-in-code.${code}`).digest('base64url')
  }

  // A new code. A profile has one at a time: a new one replaces the one given before.
  create(
    {
      profileId = null,
      createdBy,
      reset = false,
      invite = null,
      householdId = currentHouseholdId()
    }: {
      profileId?: number | null
      // null: the server's admin, who has no profile in the household.
      createdBy: number | null
      reset?: boolean
      // « Inviter un adulte »: the name it is known by in Personnes invitées, and the address it went to.
      invite?: Invite | null
      householdId?: number
    },
    now: number
  ) {
    this.#db.prepare('DELETE FROM sign_in_codes WHERE expires_at <= ?').run(now)
    if (profileId !== null) this.#db.prepare('DELETE FROM sign_in_codes WHERE profile_id = ?').run(profileId)
    const expiresAt = now + SIGN_IN_CODE_LIFETIME
    // A code that happens to be in use already is drawn again: few are ever valid at once.
    for (;;) {
      const code = drawCode()
      const { changes } = this.#db
        .prepare(
          `INSERT OR IGNORE INTO sign_in_codes
             (code_hash, account_id, profile_id, created_by, reset, created_at, expires_at, invite_name, invite_email)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          this.#hash(code),
          householdId,
          profileId,
          createdBy,
          reset ? 1 : 0,
          now,
          expiresAt,
          invite?.name ?? null,
          invite?.email ?? null
        )
      if (changes === 1) return { code, expiresAt }
    }
  }

  // What the code opens, while it is valid; it stays valid.
  peek(code: string, now: number): SignInCode | null {
    const row = this.#db
      .prepare(
        'SELECT account_id, profile_id, created_by, reset, expires_at FROM sign_in_codes WHERE code_hash = ? AND expires_at > ?'
      )
      .get(this.#hash(code), now) as SignInCodeRow | undefined
    return row ? toCode(row) : null
  }

  // The code is used: it works no more, whatever happens next.
  take(code: string, now: number): SignInCode | null {
    const row = this.#db
      .prepare(
        `DELETE FROM sign_in_codes WHERE code_hash = ? AND expires_at > ?
         RETURNING account_id, profile_id, created_by, reset, expires_at`
      )
      .get(this.#hash(code), now) as SignInCodeRow | undefined
    return row ? toCode(row) : null
  }

  // Personnes invitées: the household's invitations still waiting, oldest first. An invitation made before names were
  // kept has none.
  invitations(now: number, householdId = currentHouseholdId()): Invitation[] {
    return (
      this.#db
        .prepare(
          `SELECT rowid AS id, invite_name AS name, invite_email AS email, expires_at AS expiresAt FROM sign_in_codes
           WHERE account_id = ? AND profile_id IS NULL AND reset = 0 AND expires_at > ? ORDER BY created_at, rowid`
        )
        .all(householdId, now) as unknown as Invitation[]
    ).map(row => ({ ...row }))
  }

  // « Annuler »: the invitation's code works no more. false when there was no such invitation in the household.
  cancelInvitation(id: number, householdId = currentHouseholdId()) {
    return (
      this.#db
        .prepare('DELETE FROM sign_in_codes WHERE rowid = ? AND account_id = ? AND profile_id IS NULL AND reset = 0')
        .run(id, householdId).changes === 1
    )
  }

  // « Voir le code », « Renvoyer »: a hash cannot be read back, so the invitation gets a new code for another day, under
  // the same name and address. null when there was no such invitation.
  renewInvitation(id: number, createdBy: number | null, now: number, householdId = currentHouseholdId()) {
    const row = this.#db
      .prepare(
        `SELECT invite_name AS name, invite_email AS email FROM sign_in_codes
         WHERE rowid = ? AND account_id = ? AND profile_id IS NULL AND reset = 0 AND expires_at > ?`
      )
      .get(id, householdId, now) as { name: string | null; email: string | null } | undefined
    if (!row) return null
    this.cancelInvitation(id, householdId)
    const invite = row.name === null ? null : { name: row.name, email: row.email }
    return { ...this.create({ createdBy, invite, householdId }, now), invite }
  }
}
