import type express from 'express'
import { currentHouseholdId } from '../db/household-scope.ts'
import { MAX_AI_INPUT_BYTES, type PluginAi, type PluginAiStatus } from '../plugins/ai.ts'
import type { LoadedPlugin, PluginRegistry } from '../plugins/registry.ts'
import { sameSiteOnly } from './plugin-sandbox-routes.ts'
import { isAdminOf, kindOf, profileIdOf } from './profile-routes.ts'

// A plugin is for this profile when it is meant for everyone, or for the admin and this is the admin.
export const isFor = (plugin: LoadedPlugin, response: express.Response) =>
  plugin.manifest?.audience === 'all' || isAdminOf(response)

// How a click on an AiButton that gets no answer is told.
const AI_STATUS: Record<PluginAiStatus, number> = {
  unavailable: 503,
  off: 403,
  limited: 429,
  refused: 422,
  failed: 502
}

// The plugin, its action and who clicks, once Hodi has checked they may ask the household's AI; else the refusal is sent.
const aiClickOf = (
  plugins: PluginRegistry,
  request: express.Request<{ id: string; action: string }>,
  response: express.Response
) => {
  const plugin = plugins.get(request.params.id)
  const { action } = request.params
  if (
    !plugin ||
    !plugins.enabled(plugin.id) ||
    !plugin.signed ||
    !plugin.manifest?.permissions.ai ||
    !plugin.shape?.aiActions.includes(action)
  ) {
    response.status(404).json({ error: 'not_found' })
    return null
  }
  if (!isFor(plugin, response)) {
    response.status(403).json({ error: 'admin_only' })
    return null
  }
  // Like Résumer and the questions: a young profile never spends the household's credits.
  if (kindOf(response) !== 'adult') {
    response.status(403).json({ error: 'young' })
    return null
  }
  const householdId = currentHouseholdId()
  const profileId = profileIdOf(response)
  if (typeof householdId !== 'number' || typeof profileId !== 'number') {
    response.status(403).json({ error: 'no_profile' })
    return null
  }
  const { input = null } = (request.body ?? {}) as { input?: unknown }
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_AI_INPUT_BYTES) {
    response.status(413).json({ error: 'too_large' })
    return null
  }
  return { plugin, action, householdId, profileId, input }
}

// A click on a plugin's AiButton (hodi:sdk): Hodi checks the profile may use the household's AI before the plugin's
// code runs, then hands its aiActions[action] a ticket for one ctx.ai question. Only Hodi's own page clicks: like
// the plugin's routes, a request from another site is refused.
export const mountAiRoute = (router: express.Router, plugins: PluginRegistry, ai: PluginAi | undefined) => {
  router.post(
    '/:id/ai/:action',
    sameSiteOnly,
    async (request: express.Request<{ id: string; action: string }>, response) => {
      const click = aiClickOf(plugins, request, response)
      if (!click) return
      const { plugin, action, householdId, profileId, input } = click
      const refused = ai ? ai.check(plugin.id, householdId, profileId) : 'unavailable'
      if (refused) {
        response.status(AI_STATUS[refused]).json({ error: `ai_${refused}` })
        return
      }
      // Whatever the plugin answers, the browser reads it as data only.
      response.set('X-Content-Type-Options', 'nosniff')
      response.set('Content-Security-Policy', "default-src 'none'; sandbox")
      const result = await plugins.runAiAction(plugin.id, action, input, { householdId, profileId })
      if (!result.ok) {
        // What became of its question says more than the plugin's failure: a cap reached, a refusal.
        const { outcome } = result
        response.status(outcome ? AI_STATUS[outcome] : 502).json({ error: outcome ? `ai_${outcome}` : 'plugin_failed' })
        return
      }
      response.set('Cache-Control', 'no-store').json({ answer: result.answer })
    }
  )
}
