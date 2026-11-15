import express from 'express'
import { currentHouseholdId } from '../db/household-scope.ts'
import { type CallContext, callContext, vouchedFor } from '../plugins/call-context.ts'
import { reserveIo } from '../plugins/io-budget.ts'
import { sendZip, takeZipRoom, zipOf } from '../plugins/plugin-zip.ts'
import type { LoadedPlugin, PluginRegistry, SignInRefusal } from '../plugins/registry.ts'
import { type PluginSandbox, SandboxError } from '../plugins/sandbox/sandbox.ts'
import { clientAddressOf } from './client-address.ts'
import { refuseSignIn } from './sign-in-check.ts'
import { isAdminOf, isServerAdminOf, kindOf, profileIdOf } from './profile-routes.ts'

// The cookies that sign this device in with the account, the plugins' refusal, or, for an account with « Validation en
// deux étapes » on, the ticket of the second step (Hodi's dialog asks for the app's code, then POST /api/login/
// second-step signs in); null for an account Hodi never signs in through a plugin (none with that id, the server's
// admin).
export type PluginSignIn = (
  accountId: number,
  request: express.Request
) => Promise<{ cookies: string[] } | { refusal: SignInRefusal } | { secondStep: string } | null>

// Moves the signed-in device to a household its account has a profile in: the cookies to set, or null when refused.
export type MoveDevice = (request: express.Request, householdId: number) => string[] | null

// What a plugin's handler answers may set: only how long the answer may be kept.
const CACHE_CONTROL = /^(?:no-store|no-cache|(?:private|public), max-age=\d{1,6}|max-age=\d{1,6})$/

const queryOf = (query: unknown) =>
  Object.fromEntries(
    Object.entries(typeof query === 'object' && query !== null ? query : {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

const ERROR_STATUS: Record<SandboxError['code'], number> = {
  timeout: 504,
  busy: 503,
  plugin_error: 500,
  out_of_memory: 500,
  failed: 502,
  crashed: 502,
  stopped: 502
}

// The raw bodies a plugin's route may take, and the most bytes any route may ask for, whatever its maxBody says.
const RAW_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream']
export const MAX_RAW_BYTES = 10 * 1024 * 1024
// How long a raw body may take to arrive.
const RAW_READ_MS = 30_000

// Checks the password and code typed in Hodi's dialog against whoever asks (the profile's account, or the server's
// admin in /server): false when the refusal was sent (403 invalid_password, invalid_code, sign_in_again, 429).
export type RouteProof = (
  request: express.Request,
  response: express.Response,
  typed: { password: unknown; code: unknown }
) => Promise<boolean>

// The longest Hodi-Proof header Hodi reads: a password and a code, base64 of their JSON.
const MAX_PROOF_HEADER = 2048

// What Hodi's dialog typed, sent beside the plugin's own body: Hodi-Proof, base64 of { password, code } in JSON, so
// any password fits in a header. null when it is missing or not that.
const typedProof = (request: express.Request) => {
  const header = request.get('Hodi-Proof')
  if (!header || header.length > MAX_PROOF_HEADER) return null
  try {
    const typed = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown
    if (typeof typed !== 'object' || typed === null || Array.isArray(typed)) return null
    const { password = '', code = '' } = typed as { password?: unknown; code?: unknown }
    return { password, code }
  } catch {
    return null
  }
}

type RouteGroup = 'routes' | 'serverRoutes' | 'publicRoutes'

// Only Hodi's own pages call a plugin, or the person typing its address: a link or a form on another site, which
// the session cookie follows (SameSite=Lax), never reaches the plugin's code. Every supported browser says where a
// request comes from.
export const sameSiteOnly: express.RequestHandler = (request, response, next) => {
  const site = request.get('Sec-Fetch-Site')
  if (site === undefined || site === 'same-origin' || site === 'none') next()
  else response.status(403).json({ error: 'cross_site' })
}

// A sensitive route: the person's own password (and code) first, before a byte of its body is read. The plugin
// never sees them, and without them its code never runs.
const proofGuard =
  (routeProof: RouteProof | undefined): express.RequestHandler =>
  async (request, response, next) => {
    const typed = typedProof(request)
    if (!typed || !routeProof) {
      response.status(403).json({ error: 'proof_required' })
      return
    }
    if (await routeProof(request, response, typed)) next()
  }

// A route that takes a raw body reads it here, counting the bytes as they come (never trusting Content-Length):
// past its limit the answer is 413 before the plugin runs.
const rawBodyGuards = (sandbox: PluginSandbox, limit: number): express.RequestHandler[] => [
  // Before a byte is read: the plugin can take one more call, and Hodi has room for the body (and the copy
  // handed to the plugin's thread), counted at its announced length or, sent in chunks, at the route's
  // limit. Otherwise the answer comes at once.
  (request, response, next) => {
    const announced = Number(request.get('Content-Length'))
    if (Number.isFinite(announced) && announced > limit) {
      response.status(413).json({ error: 'too_large' })
      return
    }
    if (!sandbox.hasRoom()) {
      response.status(503).json({ error: 'busy' })
      return
    }
    const release = reserveIo(2 * (Number.isFinite(announced) ? announced : limit))
    if (!release) {
      response.status(503).json({ error: 'busy' })
      return
    }
    response.once('close', release)
    // A body sent so slowly that it holds its room for long is dropped.
    const timer = setTimeout(() => {
      if (!request.complete) request.destroy()
    }, RAW_READ_MS)
    const clear = () => clearTimeout(timer)
    request.once('end', clear)
    response.once('close', clear)
    next()
  },
  express.raw({ type: RAW_TYPES, limit }),
  (request, response, next) => {
    if (Buffer.isBuffer(request.body)) next()
    else response.status(415).json({ error: 'unsupported_type' })
  }
]

// One route of a plugin, and what Hodi may do with its answer.
interface RouteCall {
  plugins: PluginRegistry
  plugin: LoadedPlugin
  sandbox: PluginSandbox
  group: RouteGroup
  key: string
  method: string
  maxBody: number | undefined
  signIn: PluginSignIn | undefined
  moveDevice: MoveDevice | undefined
}

// The clean request the plugin gets: no cookie, no header, who Hodi says asks.
const argumentOf = (
  { group, method, maxBody }: RouteCall,
  request: express.Request,
  response: express.Response,
  householdId: number | null
) => {
  const open = group === 'publicRoutes'
  const serverOnly = response.locals.serverOnly === true
  return {
    method,
    path: request.path,
    params: { ...(request.params as Record<string, string>) },
    query: queryOf(request.query),
    body: maxBody === undefined ? ((request.body as unknown) ?? null) : null,
    who: open
      ? null
      : {
          profileId: serverOnly ? null : profileIdOf(response),
          householdId,
          kind: kindOf(response),
          householdAdmin: isAdminOf(response),
          serverAdmin: isServerAdminOf(response),
          accountId: typeof response.locals.accountId === 'number' ? response.locals.accountId : null
        }
  }
}

// What the plugin's code answers, or null when it failed and the failure was sent.
const answerOf = async (
  { plugins, plugin, sandbox, group, key, maxBody }: RouteCall,
  request: express.Request,
  response: express.Response,
  argument: ReturnType<typeof argumentOf>,
  context: CallContext
) => {
  try {
    const buffer = request.body as Buffer
    const rawBody =
      maxBody === undefined ? undefined : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    return { answer: (await sandbox.call(group, key, argument, context, rawBody)) as unknown }
  } catch (error) {
    const code = error instanceof SandboxError ? error.code : 'crashed'
    plugins.log(plugin.id, `${key} failed: ${error instanceof Error ? error.message : String(error)}`)
    response.status(ERROR_STATUS[code]).json({ error: code === 'busy' ? 'busy' : 'plugin_failed' })
    return null
  }
}

// A zip Hodi builds from what the plugin names, streamed while there is room for it.
const sendZipAnswer = async (
  { plugins, plugin, sandbox, key }: RouteCall,
  answer: { zip: unknown },
  response: express.Response
) => {
  const zip = zipOf(answer.zip)
  if (!zip) {
    plugins.log(plugin.id, `${key} answered with a zip Hodi cannot build`)
    response.status(502).json({ error: 'plugin_failed' })
    return
  }
  const release = takeZipRoom()
  if (!release) {
    response.status(503).json({ error: 'busy' })
    return
  }
  await sendZip(response, zip, (sql, params) => sandbox.read(sql, params), release).catch((error: unknown) =>
    plugins.log(plugin.id, `${key} zip stopped: ${error instanceof Error ? error.message : String(error)}`)
  )
}

// Only a 2xx or a 4xx goes on to the browser.
const isPassedStatus = (status: unknown): status is number =>
  typeof status === 'number' &&
  Number.isInteger(status) &&
  ((status >= 200 && status < 300) || (status >= 400 && status < 500))

// The answer's signIn: false when the plugins' refusal was sent instead of the answer.
const applySignIn = async (
  { plugins, plugin, key, signIn }: RouteCall,
  answer: object,
  context: CallContext,
  request: express.Request,
  response: express.Response
) => {
  if (!('signIn' in answer) || answer.signIn === undefined || answer.signIn === null) return true
  const asked = answer.signIn
  // Only an account this very call made or checked, by a plugin allowed to, from a public route: anything
  // else is the plugin's mistake (or worse), logged, and the answer goes on without a session.
  const id = typeof asked === 'number' && Number.isSafeInteger(asked) ? asked : null
  const signedIn =
    id !== null && signIn && plugin.manifest?.permissions.signIn && vouchedFor(context, id)
      ? await signIn(id, request)
      : null
  if (signedIn && 'refusal' in signedIn) {
    refuseSignIn(response, signedIn.refusal)
    return false
  }
  // A plugin never sees, nor stands for, the app's code: the answer goes on with no session, and Hodi's page
  // asks for the code with the ticket.
  if (signedIn && 'secondStep' in signedIn) response.set('Hodi-Second-Step', signedIn.secondStep)
  else if (signedIn) response.append('Set-Cookie', signedIn.cookies)
  else plugins.log(plugin.id, `${key}: signIn refused for account ${JSON.stringify(asked).slice(0, 40)}`)
  return true
}

const applyMoveDevice = (
  { plugins, plugin, key, moveDevice }: RouteCall,
  answer: object,
  request: express.Request,
  response: express.Response
) => {
  if (!('moveDevice' in answer) || answer.moveDevice === undefined || answer.moveDevice === null) return
  const asked = answer.moveDevice
  const id = typeof asked === 'number' && Number.isSafeInteger(asked) && asked > 0 ? asked : null
  // Only from a signed-in route, by a plugin allowed to, to a household the account has a profile in.
  const cookies = id !== null && moveDevice && plugin.manifest?.permissions.households ? moveDevice(request, id) : null
  if (cookies) response.append('Set-Cookie', cookies)
  else plugins.log(plugin.id, `${key}: moveDevice refused for household ${JSON.stringify(asked).slice(0, 40)}`)
}

// Runs the plugin's handler and writes its answer: JSON, a 2xx or 4xx status, no header but Cache-Control; or a zip.
const callRoute = (call: RouteCall) => async (request: express.Request, response: express.Response) => {
  const householdId = call.group === 'publicRoutes' || response.locals.serverOnly === true ? null : currentHouseholdId()
  const argument = argumentOf(call, request, response, householdId)
  // Whatever the plugin answers, the browser reads it as data only.
  response.set('X-Content-Type-Options', 'nosniff')
  response.set('Content-Security-Policy', "default-src 'none'; sandbox")
  const context = callContext(householdId, clientAddressOf(request))
  const called = await answerOf(call, request, response, argument, context)
  if (!called) return
  const { answer } = called
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) {
    response.status(502).json({ error: 'plugin_failed' })
    return
  }
  if ('zip' in answer) {
    await sendZipAnswer(call, answer, response)
    return
  }
  const { status = 200, body = null, headers } = answer as { status?: unknown; body?: unknown; headers?: unknown }
  if (!isPassedStatus(status)) {
    call.plugins.log(call.plugin.id, `${call.key} answered with status ${String(status)}, which Hodi does not pass on`)
    response.status(502).json({ error: 'plugin_failed' })
    return
  }
  if (!(await applySignIn(call, answer, context, request, response))) return
  applyMoveDevice(call, answer, request, response)
  const cache = (headers as Record<string, unknown> | undefined)?.['Cache-Control']
  response.set('Cache-Control', typeof cache === 'string' && CACHE_CONTROL.test(cache) ? cache : 'no-store')
  if (status === 204) response.status(204).end()
  else response.status(status).json(body)
}

// A plugin's route table as Express routes. The plugin gets a clean request (no cookie, no header, who Hodi says asks)
// and Hodi writes the answer: JSON, a 2xx or 4xx status, no header but Cache-Control; or a zip Hodi builds.
export const sandboxRoutes = (
  plugins: PluginRegistry,
  plugin: LoadedPlugin,
  group: RouteGroup,
  // Signs the device in when a public route's answer names an account (publicRoutes only).
  signIn: PluginSignIn | undefined,
  // What runs once the request is known to come from Hodi's page, before the plugin's code.
  guards: express.RequestHandler[] = [],
  // routes only: « Changer de foyer ».
  moveDevice?: MoveDevice,
  // routes and serverRoutes: the check of a route marked proof: true.
  routeProof?: RouteProof
) => {
  const own = express.Router()
  const { sandbox, shape } = plugin
  if (!sandbox || !shape) return own
  own.use(sameSiteOnly)
  if (guards.length > 0) own.use(...guards)
  for (const key of shape[group]) {
    const [method, route] = key.split(' ') as [string, string]
    const maxBody = shape.rawRoutes[`${group} ${key}`]
    const limit = Math.min(maxBody ?? 0, MAX_RAW_BYTES)
    const proof = shape.proofRoutes.includes(`${group} ${key}`) ? [proofGuard(routeProof)] : []
    const raw = maxBody === undefined ? [] : rawBodyGuards(sandbox, limit)
    const call = { plugins, plugin, sandbox, group, key, method, maxBody, signIn, moveDevice }
    own[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](route, ...proof, ...raw, callRoute(call))
  }
  return own
}
