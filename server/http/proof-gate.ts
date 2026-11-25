import type express from 'express'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { type CheckProof, askingWithProof } from './proof.ts'

// What cannot be undone asks first for the password of the account asking, and its app's code when « Validation en
// deux étapes » is on: in the app and in /server alike. Listed here in one place, so that none is forgotten and a test
// goes through each. The routes that took a proof before (deleting the account, a backup…) check it themselves.

interface ProvedRoute {
  method: string
  path: RegExp
  // Only some answers of a route undo nothing: a report ignored, a source accepted.
  when?: (body: Record<string, unknown>) => boolean
}

const PROVED_ROUTES: ProvedRoute[] = [
  // Historique › Vider, Mon compte › Statistiques › Effacer, Réglages › Réinitialiser.
  { method: 'DELETE', path: /^\/me\/read$/ },
  { method: 'DELETE', path: /^\/me\/readings$/ },
  { method: 'PUT', path: /^\/me\/preferences\/reset$/ },
  // A source added by hand, for everyone who reads it.
  { method: 'DELETE', path: /^\/sources\/[^/]+$/ },
  // A young one's profile, and a device of theirs.
  { method: 'DELETE', path: /^\/profiles\/\d+$/ },
  { method: 'DELETE', path: /^\/profiles\/\d+\/account-devices\/\d+$/ },
  // Mon compte: a device signed out, the AI key removed.
  { method: 'DELETE', path: /^\/account\/devices\/\d+$/ },
  { method: 'DELETE', path: /^\/account\/ai$/ },
  // Serveur: its e-mail, the articles' texts, a source unlisted or refused.
  { method: 'DELETE', path: /^\/server\/mail$/ },
  { method: 'DELETE', path: /^\/storage\/texts$/ },
  { method: 'POST', path: /^\/server\/reports\/[^/]+$/, when: body => body.decision === 'unlist' },
  { method: 'POST', path: /^\/server\/reviews\/sources\/[^/]+$/, when: body => body.decision === 'refuse' }
]

export const needsProof = (method: string, path: string, body: unknown) => {
  const fields = (body ?? {}) as Record<string, unknown>
  return PROVED_ROUTES.some(route => route.method === method && route.path.test(path) && (route.when?.(fields) ?? true))
}

// Mounted once the profile is chosen: the proof is that of the account whose profile is open here.
export const proofGate =
  (check: CheckProof, accounts: UserAccountStore | undefined): express.RequestHandler =>
  async (request, response, next) => {
    if (!accounts || !needsProof(request.method, request.path, request.body)) {
      next()
      return
    }
    if (await askingWithProof(check, accounts, request, response)) next()
  }
