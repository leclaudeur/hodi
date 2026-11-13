import { randomBytes } from 'node:crypto'
import compression from 'compression'
import express from 'express'
import type { AppOptions } from './app-options.ts'
import type { Config } from './config.ts'
import { mountHousehold } from './app/household-space.ts'
import { mountReading } from './app/reading.ts'
import { mountServerSpace } from './app/server-space.ts'
import { mountSignedOut } from './app/signed-out.ts'
import { wiringOf } from './app/wiring.ts'
import { jsonBodies, sameSiteOnly } from './http/request-guards.ts'
import { servePublicPages } from './http/public-pages.ts'
import { requestLimit } from './http/request-limit.ts'
import { securityHeaders } from './http/security-headers.ts'
import { sessionGuards } from './http/session-guard.ts'
import { errorHandler, serveWebApp } from './http/web-app.ts'

// The API in the order a request meets it: what answers signed out, the session check, then the household, /server
// and the reading itself.
const apiRouter = (config: Config, appOptions: AppOptions) => {
  const wiring = wiringOf(config, appOptions)
  const { options } = wiring
  const api = express.Router()
  api.use(sameSiteOnly)
  api.use(jsonBodies)

  mountSignedOut(api, wiring)

  const { requireSession, chooseProfile } = sessionGuards({
    accounts: options.accounts,
    devices: options.devices,
    profiles: options.profiles,
    household: options.household,
    serverSettings: options.serverSettings,
    serverStats: options.serverStats,
    presence: wiring.presence,
    sessionOf: wiring.session.sessionOf,
    cookieFor: wiring.session.cookieFor,
    linkedDevices: wiring.linkedDevices,
    secret: config.sessionSecret,
    now: options.now
  })
  api.use(requireSession)
  api.use(chooseProfile)

  mountHousehold(api, wiring)
  mountServerSpace(api, wiring)
  mountReading(api, wiring)

  api.use((_request, response) => {
    response.status(404).json({ error: 'not_found' })
  })
  return api
}

export const createApp = (config: Config, options: AppOptions) => {
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders)
  // Text responses (the web bundle, the API's JSON) shrink to about a quarter, which matters most to phones on mobile
  // data: fewer bytes, an earlier first paint and less time with the radio on. Images and fonts are already compressed.
  app.use(compression())

  // Public liveness endpoint used by the Docker healthcheck. boot changes on each start: the web app waiting for Hodi
  // to restart (after a plugin change) knows the new one answers.
  const boot = randomBytes(8).toString('hex')
  app.get('/health', (_request, response) => {
    response.set('Cache-Control', 'no-store').json({ status: 'ok', boot })
  })

  app.use(requestLimit())

  app.use('/api', (_request, response, next) => {
    // API responses are per-user and must never be cached by the browser or a proxy.
    response.set('Cache-Control', 'no-store')
    next()
  })
  app.use('/api', apiRouter(config, options))

  const { plugins, serverMail, household, serverSettings } = options
  if (plugins) {
    servePublicPages(app, config.webDir, {
      plugins,
      appUrl: () => serverMail?.store.get()?.appUrl ?? null,
      isOpen: () => household.isSetUp() || Boolean(serverSettings?.householdLater())
    })
  }
  serveWebApp(app, config.webDir)
  app.use(errorHandler)
  return app
}
