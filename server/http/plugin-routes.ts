import express from 'express'
import type { PluginInstaller } from '../plugins/installer.ts'
import { checkSettings } from '../plugins/manifest.ts'
import { MAX_PACKAGE_BYTES, PackageError } from '../plugins/package.ts'
import type { LoadedPlugin, PluginRegistry } from '../plugins/registry.ts'
import type { PluginAi } from '../plugins/ai.ts'
import { isFor, mountAiRoute } from './plugin-ai-routes.ts'
import { mountCatalogRoutes } from './plugin-catalog-routes.ts'
import { describeStaged } from './plugin-staged.ts'
import type { PluginCatalog } from '../plugins/catalog.ts'
import { LOCALE_FILE, WEB_FILE, sendWebFile } from './plugin-files.ts'
import { type MoveDevice, type RouteProof, sandboxRoutes } from './plugin-sandbox-routes.ts'
import { isServerAdminOf, requireServerAdmin } from './profile-routes.ts'

export { pluginDevRoutes } from './plugin-dev-routes.ts'
export { pluginPublicRoutes } from './plugin-public-routes.ts'
export { type MoveDevice, type RouteProof } from './plugin-sandbox-routes.ts'

// Serveur › Plugins: what is installed, on or off, and each plugin's settings; then each plugin's own routes.

export interface PluginRoutesOptions {
  // Absent in tests that do not install anything.
  installer?: PluginInstaller
  // Hodi stops once the answer is sent; Docker starts it again (restart: unless-stopped), with the new plugins.
  restart?: () => void
  // « Changer de foyer » for a route's moveDevice: the cookies that go with it, or null when refused.
  moveDevice?: MoveDevice
  // The household's AI, for the plugins' AiButtons; absent in tests that do not need it.
  ai?: PluginAi
  // The server admin's own password, before a plugin comes in or goes, or the developer mode starts: false when the
  // refusal was sent. Absent in tests without accounts.
  proof?: (request: express.Request, response: express.Response) => Promise<boolean>
  // Hodi's plugin registry, for Serveur › Plugins › Disponibles; absent in tests that do not need it.
  catalog?: PluginCatalog
  // The password (and code) of whoever asks a route marked proof: true. Absent in tests without accounts, where
  // such a route is always refused.
  routeProof?: RouteProof
}

const describePlugin = (plugins: PluginRegistry, plugin: LoadedPlugin) => {
  const { manifest } = plugin
  return {
    id: plugin.id,
    name: manifest?.name ?? plugin.id,
    version: manifest?.version ?? null,
    description: manifest?.description ?? null,
    translations: plugin.translations,
    audience: manifest?.audience ?? 'admin',
    provides: manifest?.provides ?? [],
    menu: manifest?.menu ?? null,
    settings: manifest?.settings ?? [],
    values: plugins.settings(plugin.id),
    enabled: plugins.enabled(plugin.id),
    signed: plugin.signed,
    dev: plugin.dev,
    web: plugin.web,
    // It may send notifications: Réglages › Notifications shows the « Plugins » switch.
    notifies: manifest?.permissions.notify ?? false,
    // Its AiButton may ask the household's AI: Réglages › IA et crédits lists it, with a switch.
    usesAi: Boolean(manifest?.permissions.ai && plugin.signed && plugin.shape?.aiActions.length),
    error: plugin.error
  }
}

// The server admin sees every plugin, broken or off, to manage them; any other profile only the active ones meant
// for it.
const mountListRoute = (router: express.Router, plugins: PluginRegistry) => {
  router.get('/', (_request, response) => {
    const admin = isServerAdminOf(response)
    response.json({
      plugins: plugins
        .list()
        .filter(plugin => admin || (plugins.enabled(plugin.id) && isFor(plugin, response)))
        .map(plugin => describePlugin(plugins, plugin))
    })
  })
}

type Proof = NonNullable<PluginRoutesOptions['proof']>
type RestartAfter = (response: express.Response) => void

const mountInstallRoutes = (
  router: express.Router,
  installer: PluginInstaller,
  proof: Proof,
  restartAfter: RestartAfter
) => {
  // Step 1: the server admin sends a package; Hodi unpacks it apart and says what it is, signed or not.
  router.post(
    '/packages',
    requireServerAdmin,
    express.raw({ type: 'application/octet-stream', limit: MAX_PACKAGE_BYTES }),
    async (request, response) => {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: 'not_a_package' })
        return
      }
      try {
        response.status(201).json(describeStaged(await installer.stage(request.body)))
      } catch (error) {
        if (!(error instanceof PackageError)) throw error
        response.status(error.code === 'too_big' ? 413 : 400).json({ error: error.code, detail: error.detail })
      }
    }
  )

  // Step 2: the server admin confirms; an unsigned package needs acceptUnsigned. Hodi then restarts to load it.
  router.post(
    '/packages/:token/install',
    requireServerAdmin,
    async (request: express.Request<{ token: string }>, response) => {
      if (!(await proof(request, response))) return
      const acceptUnsigned = (request.body as { acceptUnsigned?: unknown } | undefined)?.acceptUnsigned === true
      const result = installer.install(request.params.token, { acceptUnsigned })
      if (result === null) {
        response.status(404).json({ error: 'not_found' })
        return
      }
      if (result === 'unsigned' || result === 'signed_only') {
        response.status(409).json({ error: result })
        return
      }
      restartAfter(response)
      response.status(202).json({ installed: result.manifest.id, version: result.manifest.version, restarting: true })
    }
  )
}

const mountDevModeRoutes = (
  router: express.Router,
  plugins: PluginRegistry,
  proof: Proof,
  restartAfter: RestartAfter
) => {
  // Mode développeur: on makes a new code for « npx hodi-plugin dev » (shown once); off stops it, and Hodi restarts
  // so that the plugins it installed lose their web part.
  router.get('/dev-mode', requireServerAdmin, (_request, response) => {
    response.json({ on: plugins.store.devMode() })
  })
  router.post('/dev-mode', requireServerAdmin, async (request, response) => {
    if (!(await proof(request, response))) return
    response.status(201).json({ on: true, code: plugins.store.startDevMode(Date.now()) })
  })
  router.delete('/dev-mode', requireServerAdmin, (_request, response) => {
    const installed = plugins.list().some(plugin => plugin.dev)
    plugins.store.stopDevMode()
    if (installed) restartAfter(response)
    response.json({ on: false, restarting: installed })
  })
}

const mountRemoveRoute = (
  router: express.Router,
  plugins: PluginRegistry,
  installer: PluginInstaller,
  proof: Proof,
  restartAfter: RestartAfter
) => {
  // ?data=delete also deletes what it kept (its database, its settings); without it, they stay 30 days for a reinstall.
  router.delete('/:id', requireServerAdmin, async (request: express.Request<{ id: string }>, response) => {
    const id = request.params.id
    if (!(await proof(request, response))) return
    if (!installer.remove(id)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    const withData = request.query.data === 'delete'
    if (withData) await plugins.forget(id)
    // Kept for a reinstall, 30 days at most.
    else plugins.store.setRemoved(id, Date.now())
    restartAfter(response)
    response.status(202).json({ removed: id, data: withData ? 'deleted' : 'kept', restarting: true })
  })
}

const mountSettingsRoute = (router: express.Router, plugins: PluginRegistry) => {
  router.patch('/:id', requireServerAdmin, (request: express.Request<{ id: string }>, response) => {
    const plugin = plugins.get(request.params.id)
    if (!plugin?.manifest) {
      response.status(404).json({ error: 'not_found' })
      return
    }

    const { enabled, settings } = (request.body ?? {}) as { enabled?: unknown; settings?: unknown }
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      response.status(400).json({ error: 'invalid_enabled' })
      return
    }
    const values = settings === undefined ? {} : checkSettings(plugin.manifest.settings, settings)
    if (!values) {
      response.status(400).json({ error: 'invalid_settings' })
      return
    }

    if (Object.keys(values).length > 0) plugins.store.updateSettings(plugin.id, values)
    if (enabled !== undefined) plugins.store.setEnabled(plugin.id, enabled)
    response.json(describePlugin(plugins, plugin))
  })
}

const mountFilesRoute = (router: express.Router, plugins: PluginRegistry) => {
  // The plugin's files for the web app, at /api/plugins/<id>/files/…: a path its own routes cannot take. The same
  // checks as its routes; the browser asks again each time (no-cache) and gets 304 while the file is the same.
  router.get('/:id/files/*file', (request: express.Request<{ id: string; file: string[] }>, response) => {
    const plugin = plugins.get(request.params.id)
    const file = request.params.file.join('/')
    // An unsigned plugin's web part would run in Hodi's page with the session: it is never served, but for one
    // « npx hodi-plugin dev » installed while the server admin has Mode développeur on. Its texts are only data.
    const trusted = plugin && (plugin.signed || plugin.dev || LOCALE_FILE.test(file))
    if (!plugin || !trusted || !plugins.enabled(plugin.id) || !WEB_FILE.test(file)) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    // The server's admin draws every plugin's sections of /server, whoever the plugin is for in the household.
    if (!isFor(plugin, response) && !isServerAdminOf(response)) {
      response.status(403).json({ error: 'admin_only' })
      return
    }
    sendWebFile(plugin, file, response)
  })
}

// Each plugin's own routes. Hodi checks before the plugin's code runs: the plugin is on, and meant for this profile.
const mountOwnRoutes = (
  router: express.Router,
  plugins: PluginRegistry,
  { moveDevice, routeProof }: PluginRoutesOptions
) => {
  for (const plugin of plugins.list()) {
    if (!plugin.shape?.routes.length) continue
    router.use(
      `/${plugin.id}`,
      (_request, response, next) => {
        if (!plugins.enabled(plugin.id)) response.status(404).json({ error: 'not_found' })
        else if (!isFor(plugin, response)) response.status(403).json({ error: 'admin_only' })
        else next()
      },
      sandboxRoutes(plugins, plugin, 'routes', undefined, [], moveDevice, routeProof)
    )
  }
}

export const pluginRoutes = (plugins: PluginRegistry, { restart = () => {}, ...options }: PluginRoutesOptions = {}) => {
  const { installer, ai, proof = async () => true } = options
  const router = express.Router()
  const restartAfter = (response: express.Response) => response.on('finish', restart)
  mountListRoute(router, plugins)
  if (installer) {
    mountInstallRoutes(router, installer, proof, restartAfter)
    if (options.catalog) mountCatalogRoutes(router, options.catalog, installer)
    mountDevModeRoutes(router, plugins, proof, restartAfter)
    mountRemoveRoute(router, plugins, installer, proof, restartAfter)
  }
  mountSettingsRoute(router, plugins)
  mountFilesRoute(router, plugins)
  mountAiRoute(router, plugins, ai)
  mountOwnRoutes(router, plugins, options)
  return router
}

// Each plugin's routes for the server's own space, at /api/server/plugins/<id>/: requireServerAdmin stands in front of
// them, and Hodi checks the plugin is on before its code runs.
export const pluginServerRoutes = (plugins: PluginRegistry, { routeProof }: { routeProof?: RouteProof } = {}) => {
  const router = express.Router()
  for (const plugin of plugins.list()) {
    if (!plugin.shape?.serverRoutes.length) continue
    router.use(
      `/${plugin.id}`,
      (_request, response, next) => {
        if (plugins.enabled(plugin.id)) next()
        else response.status(404).json({ error: 'not_found' })
      },
      sandboxRoutes(plugins, plugin, 'serverRoutes', undefined, [], undefined, routeProof)
    )
  }
  return router
}
