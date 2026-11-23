import { randomBytes } from 'node:crypto'
import type { LoginThrottle } from '../auth/login-throttle.ts'
import { hashPassword, verifyPassword } from '../auth/password.ts'
import { type AccountLoginStore, isLogin } from '../db/account-login-store.ts'
import type { PluginAccountStore } from '../db/plugin-account-store.ts'
import { type UserAccount, type UserAccountStore, cleanEmail } from '../db/user-account-store.ts'
import { MAX_PASSWORD_LENGTH, isPassword } from '../http/household-input.ts'
import type { PluginAccount } from './api.ts'

// ctx.accounts: the people's accounts, as a plugin may see and make them. It never hands over anything that could
// sign someone in (a hash, a session generation, a code), and a password check costs a plugin what a wrong sign-in
// costs anyone: the same throttle as « Connexion », for the same address.

// What removing an account takes beyond its row (its profiles, the plugins told), filled in by the app once made.
export interface AccountHooks {
  remove: (account: UserAccount) => void
}

export const accountHooks = (): AccountHooks => ({
  remove: () => {
    throw new Error('accounts_unavailable')
  }
})

export interface PluginAccounts {
  get: (id: unknown, pluginId: string) => PluginAccount | null
  findByEmail: (email: unknown, pluginId: string) => PluginAccount | null
  // null when the address has an account already. With a login and no password, the account has no password of its
  // own: the person comes in through the plugin (« Se connecter avec Google »).
  create: (value: unknown, pluginId: string) => Promise<PluginAccount | null>
  // The account when the password is right, null otherwise. client: the address the plugin's call came from.
  checkPassword: (email: unknown, password: unknown, client: string, pluginId: string) => Promise<PluginAccount | null>
  // The account this plugin's login leads to, or null.
  findByLogin: (login: unknown, pluginId: string) => PluginAccount | null
  // Gives an account this plugin's login; false when the login leads to another account. The caller checked that the
  // call vouched for the account.
  addLogin: (accountId: number, login: unknown, pluginId: string) => boolean
  list: (pluginId: string) => PluginAccount[]
  suspend: (id: unknown, pluginId: string) => void
  resume: (id: unknown, pluginId: string) => void
  remove: (id: unknown, pluginId: string) => void
}

const unavailable = () => {
  throw new Error('accounts_unavailable')
}

// No account store at all (tests that do not need one): every call is refused.
export const NO_ACCOUNTS: PluginAccounts = {
  get: unavailable,
  findByEmail: unavailable,
  create: async () => unavailable(),
  checkPassword: async () => unavailable(),
  findByLogin: unavailable,
  addLogin: unavailable,
  list: unavailable,
  suspend: unavailable,
  resume: unavailable,
  remove: unavailable
}

const idOf = (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null)

// A new account as a plugin asks for it: an e-mail and a password, a login of its own, or both. Throws on anything
// else.
const newAccountOf = (value: unknown) => {
  const { email, password, login, ...rest } = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >
  if (Object.keys(rest).length > 0) throw new Error('invalid_account')
  const clean = cleanEmail(email)
  if (!clean || (password === undefined && login === undefined)) throw new Error('invalid_account')
  if (password !== undefined && !isPassword(password)) throw new Error('invalid_account')
  if (login !== undefined && !isLogin(login)) throw new Error('invalid_login')
  return { clean, password: password as string | undefined, login: login as string | undefined }
}

interface AccountDeps {
  accounts: UserAccountStore
  made: PluginAccountStore
  hooks: AccountHooks
  now: () => number
}

// The accounts as a plugin sees them, and what it may do to those it made.
const madeAccounts = ({
  accounts,
  made,
  hooks,
  now
}: AccountDeps): Pick<PluginAccounts, 'list' | 'suspend' | 'resume' | 'remove'> & {
  view: (account: UserAccount | null, pluginId: string) => PluginAccount | null
} => {
  // A teen's or a child's account, which has no e-mail, is not one a plugin sees: its parents make and run it.
  const view = (account: UserAccount | null, pluginId: string): PluginAccount | null => {
    if (!account || account.email === null) return null
    const marks = made.of(account.id)
    return {
      id: account.id,
      email: account.email,
      name: accounts.identityOf(account.id)?.name ?? null,
      createdAt: account.createdAt,
      loginOnly: !account.hasPassword,
      serverAdmin: account.serverAdmin,
      mine: marks?.madeByPlugin === pluginId,
      suspended: marks?.suspendedAt != null
    }
  }

  // Suspend, resume and remove: only what this plugin made; anything else is refused alike.
  const ownOrRefuse = (value: unknown, pluginId: string) => {
    const id = idOf(value)
    const account = id === null ? null : accounts.get(id)
    if (!account || account.serverAdmin || made.of(account.id)?.madeByPlugin !== pluginId)
      throw new Error('not_allowed')
    return account
  }

  return {
    view,
    list: pluginId =>
      made
        .madeBy(pluginId)
        .map(id => view(accounts.get(id), pluginId))
        .filter(account => account !== null),
    suspend: (id, pluginId) => {
      const account = ownOrRefuse(id, pluginId)
      made.setSuspended(account.id, pluginId, now())
      // Every device it is signed in on is signed out now, not at its next sign-in.
      accounts.revokeSessions(account.id)
    },
    resume: (id, pluginId) => {
      made.setSuspended(ownOrRefuse(id, pluginId).id, pluginId, null)
    },
    remove: (id, pluginId) => {
      hooks.remove(ownOrRefuse(id, pluginId))
    }
  }
}

export const pluginAccounts = ({
  accounts,
  logins,
  made,
  hooks,
  throttle,
  now = Date.now
}: {
  accounts: UserAccountStore
  logins: AccountLoginStore
  made: PluginAccountStore
  hooks: AccountHooks
  // The one « Connexion » uses: a plugin's failed checks count with the failed sign-ins of the same address.
  throttle: LoginThrottle
  now?: () => number
}): PluginAccounts => {
  // Compared with when no account has the e-mail, so that a wrong address takes as long as a wrong password.
  let decoyHash: Promise<string> | null = null
  const { view, ...own } = madeAccounts({ accounts, made, hooks, now })

  return {
    ...own,
    get: (id, pluginId) => {
      const known = idOf(id)
      return known === null ? null : view(accounts.get(known), pluginId)
    },
    findByEmail: (email, pluginId) => {
      const clean = cleanEmail(email)
      return clean ? view(accounts.byEmail(clean), pluginId) : null
    },
    create: async (value, pluginId) => {
      const { clean, password, login } = newAccountOf(value)
      if (login !== undefined && logins.accountOf(pluginId, login) !== null) throw new Error('login_taken')
      if (accounts.byEmail(clean)) return null
      // Without a password, a hash of bytes nobody knows: no password can sign in until the person sets one.
      const hash = await hashPassword(password ?? randomBytes(32).toString('hex'))
      const account = accounts.create(clean, hash, now(), { hasPassword: password !== undefined })
      if (!account) return null
      made.markMade(account.id, pluginId)
      if (login !== undefined) logins.add(pluginId, login, account.id, now())
      return view(account, pluginId)
    },
    findByLogin: (login, pluginId) => {
      if (!isLogin(login)) throw new Error('invalid_login')
      const id = logins.accountOf(pluginId, login)
      return id === null ? null : view(accounts.get(id), pluginId)
    },
    addLogin: (accountId, login, pluginId) => {
      if (!isLogin(login)) throw new Error('invalid_login')
      const account = accounts.get(accountId)
      // The server's admin only ever signs in with their password.
      if (!account || account.serverAdmin) throw new Error('not_allowed')
      const current = logins.accountOf(pluginId, login)
      if (current !== null) return current === accountId
      return logins.add(pluginId, login, accountId, now())
    },
    checkPassword: async (email, password, client, pluginId) => {
      // Refused before any hashing: a plugin cannot turn its calls into a free guessing machine.
      if (!throttle.check(now(), client).allowed) throw new Error('throttled')
      const clean = cleanEmail(email)
      if (!clean || typeof password !== 'string' || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
        throttle.recordFailure(now(), client)
        return null
      }
      const account = accounts.byEmail(clean)
      decoyHash ??= hashPassword(randomBytes(16).toString('hex'))
      const valid = await verifyPassword(password, account?.passwordHash ?? (await decoyHash))
      if (!account || !valid) {
        throttle.recordFailure(now(), client)
        return null
      }
      return view(account, pluginId)
    }
  }
}
