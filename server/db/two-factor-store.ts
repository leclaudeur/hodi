import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt } from 'node:crypto'
import { Secret, TOTP } from 'otpauth'
import { type Database, transaction } from './database.ts'
import { SIGN_IN_CODE_ALPHABET } from './sign-in-code-store.ts'

// « Validation en deux étapes »: an authenticator app (Google Authenticator, 1Password, Aegis…) shows a new 6-digit code
// every 30 seconds from a secret it shares with Hodi (TOTP, RFC 6238, through otpauth). Ten recovery codes stand in
// for the app when it is lost, each once.

export const TWO_FACTOR_DIGITS = 6
const PERIOD_SECONDS = 30
// The step before and after count too: a phone's clock a little off, or a code typed as it changed.
const WINDOW = 1
export const RECOVERY_CODES = 10
const RECOVERY_LENGTH = 8
// A secret shown and not confirmed is forgotten after this.
export const PENDING_LIFETIME = 15 * 60 * 1000

const totpOf = (secret: string, label: string) =>
  new TOTP({
    issuer: 'Hodi',
    label,
    algorithm: 'SHA1',
    digits: TWO_FACTOR_DIGITS,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secret)
  })

// A recovery code as typed: capitals, without spaces or dashes; null when it cannot be one.
export const recoveryCodeOf = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 32) return null
  const code = value.toUpperCase().replace(/[\s-]/g, '')
  return new RegExp(`^[${SIGN_IN_CODE_ALPHABET}]{${RECOVERY_LENGTH}}$`).test(code) ? code : null
}

// The app's code as typed: six digits, spaces allowed.
const appCodeOf = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 16) return null
  const code = value.replace(/\s/g, '')
  return new RegExp(`^\\d{${TWO_FACTOR_DIGITS}}$`).test(code) ? code : null
}

// Shown in two groups of four, as the codes of « J'ai un code ».
const newRecoveryCode = () => {
  const code = Array.from(
    { length: RECOVERY_LENGTH },
    () => SIGN_IN_CODE_ALPHABET[randomInt(SIGN_IN_CODE_ALPHABET.length)]
  )
  return `${code.slice(0, 4).join('')}-${code.slice(4).join('')}`
}

export interface TwoFactorStatus {
  // When it was turned on, or null.
  since: number | null
  recoveryLeft: number
}

export class TwoFactorStore {
  readonly #db: Database
  readonly #key: Buffer
  readonly #hashKey: Buffer

  // secret: the server's session secret, from which the key that seals the apps' secrets is derived. A copy of the
  // database alone cannot make codes.
  constructor(db: Database, secret: Buffer) {
    this.#db = db
    this.#key = createHmac('sha256', secret).update('two-factor').digest()
    this.#hashKey = createHmac('sha256', secret).update('two-factor-recovery').digest()
  }

  // A recovery code's hash, keyed with the session secret too: a copy of the database alone cannot be searched for them.
  #hashOf(code: string) {
    return createHmac('sha256', this.#hashKey).update(code).digest('base64url')
  }

  #seal(text: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv)
    const sealed = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return [iv, cipher.getAuthTag(), sealed].map(part => part.toString('base64url')).join('.')
  }

  #open(value: string) {
    const [iv, tag, sealed] = value.split('.').map(part => Buffer.from(part, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', this.#key, iv!)
    decipher.setAuthTag(tag!)
    return Buffer.concat([decipher.update(sealed!), decipher.final()]).toString('utf8')
  }

  status(userId: number): TwoFactorStatus {
    const row = this.#db
      .prepare(
        `SELECT two_factor_since AS since,
           (SELECT COUNT(*) FROM recovery_codes WHERE user_id = users.id AND used_at IS NULL) AS recoveryLeft
         FROM users WHERE id = ?`
      )
      .get(userId) as { since: number | null; recoveryLeft: number } | undefined
    return row ? { since: row.since, recoveryLeft: row.recoveryLeft } : { since: null, recoveryLeft: 0 }
  }

  isOn(userId: number) {
    return this.status(userId).since !== null
  }

  // A new secret for the app, waiting for its first code: its otpauth link (the QR) and its text to type.
  start(userId: number, label: string, now: number) {
    const secret = new Secret({ size: 20 }).base32
    this.#db
      .prepare('UPDATE users SET two_factor_pending = ?, two_factor_pending_at = ? WHERE id = ?')
      .run(this.#seal(secret), now, userId)
    return { secret, uri: totpOf(secret, label).toString() }
  }

  // The app's first code: on from now, with new recovery codes, shown once. null when the code is not the app's.
  confirm(userId: number, code: unknown, now: number): string[] | null {
    const row = this.#db
      .prepare('SELECT two_factor_pending AS pending, two_factor_pending_at AS at FROM users WHERE id = ?')
      .get(userId) as { pending: string | null; at: number | null } | undefined
    if (!row?.pending || row.at === null || now - row.at > PENDING_LIFETIME) return null
    const secret = this.#open(row.pending)
    const step = this.#stepOf(secret, code, now)
    if (step === null) return null
    return transaction(this.#db, () => {
      this.#db
        .prepare(
          `UPDATE users SET two_factor_secret = ?, two_factor_since = ?, two_factor_step = ?,
             two_factor_pending = NULL, two_factor_pending_at = NULL WHERE id = ?`
        )
        .run(this.#seal(secret), now, step, userId)
      return this.#newRecoveryCodes(userId)
    })
  }

  // Off: the app's secret and the recovery codes go.
  stop(userId: number) {
    transaction(this.#db, () => {
      this.#db
        .prepare(
          `UPDATE users SET two_factor_secret = NULL, two_factor_since = NULL, two_factor_step = NULL,
             two_factor_pending = NULL, two_factor_pending_at = NULL WHERE id = ?`
        )
        .run(userId)
      this.#db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId)
    })
  }

  // « Nouveaux codes de secours »: the old ones stop working.
  newRecoveryCodes(userId: number) {
    return transaction(this.#db, () => this.#newRecoveryCodes(userId))
  }

  #newRecoveryCodes(userId: number) {
    this.#db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(userId)
    const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode)
    const insert = this.#db.prepare('INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)')
    for (const code of codes) insert.run(userId, this.#hashOf(code.replace('-', '')))
    return codes
  }

  // The 30-second step a code of the app is for, or null.
  #stepOf(secret: string, code: unknown, now: number) {
    const typed = appCodeOf(code)
    if (typed === null) return null
    const delta = totpOf(secret, '').validate({ token: typed, timestamp: now, window: WINDOW })
    return delta === null ? null : Math.floor(now / 1000 / PERIOD_SECONDS) + delta
  }

  // The app's code, or with recovery a recovery code, used up. A code of the app works once: one seen over a shoulder
  // or sent twice is refused.
  verify(userId: number, code: unknown, now: number, { recovery = true } = {}) {
    const row = this.#db
      .prepare('SELECT two_factor_secret AS secret, two_factor_step AS step FROM users WHERE id = ?')
      .get(userId) as { secret: string | null; step: number | null } | undefined
    if (!row?.secret) return false
    const step = this.#stepOf(this.#open(row.secret), code, now)
    if (step !== null) {
      if (row.step !== null && step <= row.step) return false
      this.#db.prepare('UPDATE users SET two_factor_step = ? WHERE id = ?').run(step, userId)
      return true
    }
    const typed = recovery ? recoveryCodeOf(code) : null
    if (typed === null) return false
    return (
      this.#db
        .prepare('UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
        .run(now, userId, this.#hashOf(typed)).changes === 1
    )
  }
}
