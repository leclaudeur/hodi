import express from 'express'
import type { UserAccountStore } from '../db/user-account-store.ts'
import { type CheckProof, askingWithProof } from './proof.ts'

// What cannot be undone asks first for the password of the account asking, and its app's code when « Validation en
// deux étapes » is on: in the app and in /server alike. Listed here in one place, so that none is forgotten and a test
// goes through each. The routes that took a proof before (deleting the account, a backup…) check it themselves.

type Method = 'delete' | 'put' | 'post'

interface ProvedRoute {
  method: Method
  path: string
  // Only some answers of a route undo nothing: a report ignored, a source accepted, leaving the open profile.
  when?: (request: express.Request) => boolean
}

const PROVED_ROUTES: ProvedRoute[] = [
  // Historique › Vider, Mon compte › Statistiques › Effacer, Réglages › Réinitialiser.
  { method: 'delete', path: '/me/read' },
  { method: 'delete', path: '/me/readings' },
  { method: 'put', path: '/me/preferences/reset' },
  // A source added by hand, for everyone who reads it.
  { method: 'delete', path: '/sources/:id' },
  // A young one's profile, and a device of theirs.
  { method: 'delete', path: '/profiles/:id', when: request => String(request.params.id).toLowerCase() !== 'current' },
  { method: 'delete', path: '/profiles/:id/account-devices/:device' },
  // Mon compte: a device signed out, the AI key removed.
  { method: 'delete', path: '/account/devices/:id' },
  { method: 'delete', path: '/account/ai' },
  // Serveur: its e-mail, the articles' texts, a source unlisted or refused.
  { method: 'delete', path: '/server/mail' },
  { method: 'delete', path: '/storage/texts' },
  { method: 'post', path: '/server/reports/:id', when: request => request.body?.decision === 'unlist' },
  { method: 'post', path: '/server/reviews/sources/:id', when: request => request.body?.decision === 'refuse' }
]

// An Express router matches these paths as the real routes do (any case, a trailing slash), so the gate cannot be
// walked around by spelling a route differently.
export const proofGate = (check: CheckProof, accounts: UserAccountStore | undefined): express.Router => {
  const gate = express.Router()
  if (!accounts) return gate
  for (const route of PROVED_ROUTES) {
    gate[route.method](route.path, async (request, response, next) => {
      if (route.when && !route.when(request)) {
        next()
        return
      }
      if (await askingWithProof(check, accounts, request, response)) next()
    })
  }
  return gate
}
