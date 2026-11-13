import express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import type { LoadedPlugin, PluginRegistry } from '../plugins/registry.ts'
import { clientAddressOf } from './client-address.ts'
import { WEB_FILE, sendWebFile } from './plugin-files.ts'
import { type PluginSignIn, sandboxRoutes } from './plugin-sandbox-routes.ts'

// How many requests one address may send to one plugin's public routes in a minute.
export const PUBLIC_REQUESTS_PER_MINUTE = 30

// Each plugin's routes open to anyone, at /api/public/plugins/<id>/: a sign-up, a waiting list, the way back from a
// sign-in with another site. Hodi checks before the plugin's code runs: the setup is over, the plugin is on and its
// manifest asks for them, the request comes from Hodi's own page, and its address has not sent too many. The plugin
// never learns who is signed in on the device: request.who is null, even with a session cookie.
export const pluginPublicRoutes = (
  plugins: PluginRegistry,
  { isOpen, signIn }: { isOpen: () => boolean; signIn?: PluginSignIn }
) => {
  const router = express.Router()

  // The plugins that draw on the screens before a profile is open (Connexion, « J'ai un code », « Qui lit ? »): only a
  // signed one, on, with a public web part (web-public.js), that may open pages without sign-in. Nothing of their
  // settings: anyone asks this.
  const onScreens = (plugin: LoadedPlugin) =>
    isOpen() &&
    (plugin.signed || plugin.dev) &&
    plugins.enabled(plugin.id) &&
    plugin.web.publicScript &&
    plugin.manifest?.permissions.publicRoutes === true &&
    !plugin.error

  router.get('/', (_request, response) => {
    response.set('Cache-Control', 'no-store')
    response.json({
      plugins: plugins
        .list()
        .filter(onScreens)
        .map(plugin => ({
          id: plugin.id,
          name: plugin.manifest?.name ?? plugin.id,
          version: plugin.manifest?.version ?? null,
          // web.js and web.css stay for those signed in.
          web: { ...plugin.web, script: false, style: false }
        }))
    })
  })

  // Their public files, as /api/plugins/<id>/files/… gives them once signed in, but never web.js nor web.css: a path
  // their own public routes cannot take.
  router.get('/:id/files/*file', (request: express.Request<{ id: string; file: string[] }>, response) => {
    const plugin = plugins.get(request.params.id)
    const file = request.params.file.join('/')
    if (!plugin || !onScreens(plugin) || !WEB_FILE.test(file) || /^web\.(?:js|css)$/.test(file)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    sendWebFile(plugin, file, response)
  })

  for (const plugin of plugins.list()) {
    if (!plugin.shape?.publicRoutes.length || !plugin.manifest?.permissions.publicRoutes) continue
    router.use(
      `/${plugin.id}`,
      (_request, response, next) => {
        if (isOpen() && plugins.enabled(plugin.id)) next()
        else response.status(404).json({ error: 'not_found' })
      },
      sandboxRoutes(plugins, plugin, 'publicRoutes', signIn, [
        // Counted per plugin, so that one plugin's visitors never use up another's. The address is the one the login
        // throttle uses: a proxy on this machine or network names the visitor, anyone else is known by the connection.
        rateLimit({
          windowMs: 60_000,
          limit: PUBLIC_REQUESTS_PER_MINUTE,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          keyGenerator: request => ipKeyGenerator(clientAddressOf(request)),
          // clientAddressOf reads X-Forwarded-For itself, from a proxy it trusts: Express's own setting stays off.
          validate: { xForwardedForHeader: false },
          handler: (_request, response) => {
            response.status(429).json({ error: 'too_many_requests' })
          }
        })
      ])
    )
  }
  // Anything else under /public is nobody's: it never falls through to the routes that need a session.
  router.use((_request, response) => {
    response.status(404).json({ error: 'not_found' })
  })
  return router
}
