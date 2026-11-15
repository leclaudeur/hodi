import express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import type { PluginInstaller } from '../plugins/installer.ts'
import { MAX_PACKAGE_BYTES, PackageError } from '../plugins/package.ts'
import type { PluginRegistry } from '../plugins/registry.ts'
import { clientAddressOf } from './client-address.ts'

// « npx hodi-plugin dev » sends a build per save and reads the log every two seconds: room for both, not for guessing.
export const DEV_REQUESTS_PER_MINUTE = 60

// « npx hodi-plugin dev »: while Mode développeur is on, the code it shows installs a build of a plugin, unsigned, and
// reads its log. Before any session: the code is the only way in, so every request without it is refused alike.
export const pluginDevRoutes = (
  plugins: PluginRegistry,
  { installer, restart }: { installer: PluginInstaller; restart: () => void }
) => {
  const router = express.Router()
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: DEV_REQUESTS_PER_MINUTE,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: request => ipKeyGenerator(clientAddressOf(request)),
      validate: { xForwardedForHeader: false },
      handler: (_request, response) => {
        response.status(429).json({ error: 'too_many_requests' })
      }
    }),
    (request, response, next) => {
      const code = /^Bearer (\S{1,100})$/.exec(request.get('authorization') ?? '')?.[1]
      if (code && plugins.store.isDevCode(code)) next()
      else response.status(401).json({ error: 'dev_mode_off' })
    }
  )

  router.post(
    '/plugins',
    express.raw({ type: 'application/octet-stream', limit: MAX_PACKAGE_BYTES }),
    async (request, response) => {
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        response.status(400).json({ error: 'not_a_package' })
        return
      }
      try {
        const staged = await installer.stage(request.body)
        // A verified plugin is never replaced by a build: its data and its trust stay as they are.
        if (plugins.get(staged.manifest.id)?.signed && !staged.signed) {
          response.status(409).json({ error: 'replaces_verified' })
          return
        }
        const installed = installer.install(staged.token, { acceptUnsigned: true, dev: true })
        if (installed === null || typeof installed === 'string') throw new Error('staged package lost')
        plugins.store.setDev(installed.manifest.id, Date.now())
        response.on('finish', restart)
        response
          .status(202)
          .json({ installed: installed.manifest.id, version: installed.manifest.version, restarting: true })
      } catch (error) {
        if (!(error instanceof PackageError)) throw error
        response.status(error.code === 'too_big' ? 413 : 400).json({ error: error.code, detail: error.detail })
      }
    }
  )

  router.get('/plugins/:id/log', (request: express.Request<{ id: string }>, response) => {
    const plugin = plugins.get(request.params.id)
    if (!plugin?.dev) {
      response.status(404).json({ error: 'not_found' })
      return
    }
    const after = Number(request.query.after ?? 0)
    response.set('Cache-Control', 'no-store')
    response.json({
      ...plugins.recentLog(plugin.id, Number.isInteger(after) && after >= 0 ? after : 0),
      error: plugin.error
    })
  })
  return router
}
