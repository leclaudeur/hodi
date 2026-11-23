import type express from 'express'
import { rateLimit } from 'express-rate-limit'
import type { AccountAiStore } from '../db/account-ai-store.ts'
import type { UserAccount } from '../db/user-account-store.ts'
import type { AiProvider } from '../news/ai-providers.ts'
import type { AccountHelpers, AccountRoutesOptions } from './account-routes.ts'
import { aiOf, keyHint, providersList } from './household-input.ts'
import { CONFIG } from '../fixed-config.ts'

// Each check asks the provider: an account cannot use the server to try keys in a loop.
export const KEY_CHECKS_PER_MINUTE = CONFIG.ai.keyChecksPerMinute

export interface AccountAiOptions {
  // Each account's own AI key, and the providers it may come from.
  accountAi?: AccountAiStore
  providers?: AiProvider[]
}

// Mon compte › IA et crédits: the key, what the account's AI buttons run on. Shown as its provider and its end only.
export const accountAiView = ({ accountAi, providers = [] }: AccountAiOptions, account: UserAccount) => {
  const ai = accountAi?.get(account.id) ?? null
  const provider = providers.find(candidate => candidate.id === ai?.provider)
  return {
    ai:
      ai && provider
        ? {
            provider: provider.id,
            providerName: provider.name,
            model: ai.model ?? provider.defaultModel,
            keyHint: keyHint(ai.key)
          }
        : null,
    providers: providersList(providers)
  }
}

export const mountAiRoutes = (
  router: express.Router,
  { accountAi, providers = [], sessionOf }: AccountRoutesOptions,
  { sessionOrRefuse, view }: AccountHelpers
) => {
  if (!accountAi) return
  const checkLimit = rateLimit({
    windowMs: 60_000,
    limit: KEY_CHECKS_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: request => `account-ai:${sessionOf(request)?.account.id ?? 'none'}`,
    validate: { xForwardedForHeader: false },
    handler: (_request, response) => {
      response.status(429).json({ error: 'too_many_requests' })
    }
  })
  // A request that costs no credits.
  router.post('/ai/check', checkLimit, async (request, response) => {
    if (!sessionOrRefuse(request, response)) return
    const ai = aiOf(providers, request.body)
    response.json({ result: ai ? await ai.provider.checkKey(ai.key) : 'invalid' })
  })

  // A key is kept only once its provider took it.
  router.put('/ai', checkLimit, async (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    const ai = aiOf(providers, request.body)
    const result = ai ? await ai.provider.checkKey(ai.key) : 'invalid'
    if (!ai || result !== 'ok') {
      response.status(422).json({ error: 'key_refused', result })
      return
    }
    accountAi.set(session.account.id, { provider: ai.provider.id, key: ai.key, model: null })
    response.json(view(session.account, session.device))
  })

  router.delete('/ai', (request, response) => {
    const session = sessionOrRefuse(request, response)
    if (!session) return
    accountAi.set(session.account.id, null)
    response.json(view(session.account, session.device))
  })
}
