import express from 'express'
import { type NewsService } from '../news/news-service.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import { profileIdOf, requireServerAdmin } from './profile-routes.ts'

// Mon compte › IA et crédits, and the household's plugins that may use AI (the admin's).
export const aiUsageRoutes = ({ news, plugins }: { news: NewsService; plugins?: PluginRegistry }) => {
  const router = express.Router()

  // Mon compte › IA et crédits: the reader's own calls of the last 24 hours, on its own key.
  router.get('/ai-usage', (_request, response) => {
    response.json(news.aiUsage(profileIdOf(response)))
  })

  if (plugins) {
    // Each active plugin whose AiButton may ask a reader's AI, the admin's own calls of it in the last 24 hours, and
    // the switch that turns its AI off for the server.
    const aiPlugins = (profileId: number) => {
      const off = plugins.store.aiOff()
      const calls = news.pluginAiCalls(profileId)
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
    router.get('/ai-usage/plugins', requireServerAdmin, (_request, response) => {
      response.json({ plugins: aiPlugins(profileIdOf(response)) })
    })
    router.put('/ai-usage/plugins/:id', requireServerAdmin, (request: express.Request<{ id: string }>, response) => {
      const { on } = (request.body ?? {}) as { on?: unknown }
      const plugin = plugins.get(request.params.id)
      if (typeof on !== 'boolean' || !plugin?.manifest) {
        response
          .status(typeof on !== 'boolean' ? 400 : 404)
          .json({ error: typeof on !== 'boolean' ? 'bad_request' : 'not_found' })
        return
      }
      plugins.store.setAiOff(plugin.id, !on)
      response.json({ plugins: aiPlugins(profileIdOf(response)) })
    })
  }

  return router
}
