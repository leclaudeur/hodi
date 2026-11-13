import express from 'express'
import { currentHouseholdId } from '../db/household-scope.ts'
import type { AiCallKind } from '../db/ai-queries.ts'
import { type NewsService } from '../news/news-service.ts'
import { AI_KINDS } from '../news/ai-ledger.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import { isAdminOf, profileIdOf, requireAdmin } from './profile-routes.ts'

// Réglages › IA et crédits.
export const aiUsageRoutes = ({ news, plugins }: { news: NewsService; plugins?: PluginRegistry }) => {
  const router = express.Router()

  router.get('/ai-usage', (_request, response) => {
    const usage = news.aiUsage(profileIdOf(response))
    // Each profile's calls are the admin's to see; a member sees its own and the household's.
    response.json(isAdminOf(response) ? usage : { ...usage, profiles: [] })
  })

  // "Remettre à 0", the admin's: one kind or all, for one profile or the whole household.
  router.post('/ai-usage/reset', requireAdmin, (request, response) => {
    const { kind, profileId } = (request.body ?? {}) as { kind?: unknown; profileId?: unknown }
    if (
      !(kind === undefined || AI_KINDS.includes(kind as AiCallKind)) ||
      !(profileId === undefined || (Number.isInteger(profileId) && (profileId as number) > 0))
    ) {
      response.status(400).json({ error: 'bad_request' })
      return
    }
    news.resetAiUsage({
      kind: (kind as AiCallKind | undefined) ?? null,
      profileId: (profileId as number | undefined) ?? null
    })
    response.json(news.aiUsage(profileIdOf(response)))
  })

  if (plugins) {
    // Réglages › IA et crédits › Plugins: each active plugin whose AiButton may ask the household's AI, its calls of
    // the last 24 hours, and the switch that turns its AI off for the household.
    const aiPlugins = () => {
      const off = plugins.store.aiOff(currentHouseholdId())
      const calls = news.pluginAiCalls()
      return plugins
        .list()
        .filter(
          plugin =>
            plugin.signed &&
            plugin.manifest?.permissions.ai &&
            plugin.shape?.aiActions.length &&
            plugins.enabled(plugin.id)
        )
        .map(plugin => ({
          id: plugin.id,
          name: plugin.manifest!.name,
          translations: plugin.translations,
          on: !off.has(plugin.id),
          calls: calls[plugin.id] ?? 0
        }))
    }
    router.get('/ai-usage/plugins', requireAdmin, (_request, response) => {
      response.json({ plugins: aiPlugins() })
    })
    router.put('/ai-usage/plugins/:id', requireAdmin, (request: express.Request<{ id: string }>, response) => {
      const { on } = (request.body ?? {}) as { on?: unknown }
      const plugin = plugins.get(request.params.id)
      if (typeof on !== 'boolean' || !plugin?.manifest) {
        response
          .status(typeof on !== 'boolean' ? 400 : 404)
          .json({ error: typeof on !== 'boolean' ? 'bad_request' : 'not_found' })
        return
      }
      plugins.store.setAiOff(currentHouseholdId(), plugin.id, !on)
      response.json({ plugins: aiPlugins() })
    })
  }

  return router
}
