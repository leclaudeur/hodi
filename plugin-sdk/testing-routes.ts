import type { AddressInfo } from 'node:net'
import express from 'express'
import { inHousehold } from '../server/db/household-scope.ts'
import type { ProfileStore } from '../server/db/profile-store.ts'
import type { UserAccountStore } from '../server/db/user-account-store.ts'
import { pluginRoutes, pluginPublicRoutes, pluginServerRoutes } from '../server/http/plugin-routes.ts'
import type { PluginAi } from '../server/plugins/ai.ts'
import type { PluginRegistry } from '../server/plugins/registry.ts'
import type { TestAnswer, TestCall } from './testing.ts'

// Hodi's routes for plugins, as a plugin's tests reach them (testing.ts).

interface KitRoutes {
  registry: PluginRegistry
  ai: PluginAi
  profiles: ProfileStore
  accounts: UserAccountStore
  householdId: number
  signedIn: number[]
}

// Behind a stand-in for Hodi's session: the person the call names, in the household.
const sessionStandIn =
  ({ profiles, accounts, householdId }: KitRoutes): express.RequestHandler =>
  (request, response, next) => {
    const profileId = Number(request.get('x-test-profile'))
    const profile = profiles.get(profileId)
    Object.assign(response.locals, {
      profileId: profile?.id,
      kind: profile?.kind,
      admin: profile?.role === 'admin',
      serverAdmin: request.get('x-test-server-admin') === '1',
      // The account of the profile that calls, as a session would have it.
      accountId: profile ? (accounts.ofProfile(profile.id)?.id ?? undefined) : undefined
    })
    inHousehold(householdId, () => next())
  }

export const serveKit = async (kit: KitRoutes) => {
  const { registry, ai, signedIn } = kit
  const app = express()
  app.use(sessionStandIn(kit))
  // The kit has no passwords: a call with proof stands for the right one, typed in Hodi's dialog.
  const routeProof = async () => true
  app.use('/api/plugins', express.json({ limit: '64kb' }), pluginRoutes(registry, { ai, routeProof }))
  app.use('/api/server/plugins', express.json({ limit: '64kb' }), pluginServerRoutes(registry, { routeProof }))
  app.use(
    '/api/public/plugins',
    express.json({ limit: '64kb' }),
    pluginPublicRoutes(registry, {
      isOpen: () => true,
      signIn: async accountId => {
        signedIn.push(accountId)
        return { cookies: [] }
      }
    })
  )
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api` }
}

// One call to a route of the plugin, as the app would make it.
export const sendTo =
  (base: string, pluginId: string) =>
  async (prefix: string, route: string, call: TestCall, headers: Record<string, string>): Promise<TestAnswer> => {
    const [method, ...rest] = route.split(' ')
    const routePath = rest.join(' ')
    if (!method || !routePath.startsWith('/')) throw new Error(`A route is 'METHOD /path', not ${route}`)
    const query = call.query ? `?${new URLSearchParams(call.query).toString()}` : ''
    const response = await fetch(`${base}${prefix}/${pluginId}${routePath}${query}`, {
      method,
      headers: {
        ...(call.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
        ...(call.proof ? { 'Hodi-Proof': Buffer.from(JSON.stringify({ password: 'kit' })).toString('base64') } : {}),
        ...call.headers
      },
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) })
    })
    const text = await response.text()
    let body: unknown = text
    if ((response.headers.get('content-type') ?? '').includes('json')) body = text ? JSON.parse(text) : null
    return { status: response.status, body, headers: response.headers }
  }
