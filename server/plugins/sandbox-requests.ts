import type { IsAllowedUrl } from '../news/address-guard.ts'
import { type FetchHttp, type FetchText } from '../news/fetch-text.ts'
import type { PluginAccounts } from './accounts.ts'
import type { PluginArticles } from './articles.ts'
import type { PluginMailer } from './mail.ts'
import type { PluginNotifier } from './notify.ts'
import { type PluginAi, PluginAiError, pluginQuestion } from './ai.ts'
import type { PublicServerSettings } from '../db/server-settings-store.ts'
import type { Manifest } from './manifest.ts'
import type { SandboxRequest } from './sandbox/sandbox.ts'
import { type CallContext, clientOf, readerOf, readerOnly, vouch, vouchedFor } from './call-context.ts'
import type { PluginServerNotifier } from './server-notify.ts'
import { CONFIG } from '../fixed-config.ts'

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const stringRecord = (value: unknown) =>
  typeof value === 'object' && value !== null
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    : undefined

// The request headers a plugin may set on ctx.fetchText; Hodi writes the others.
const FETCH_HEADERS = new Set(['accept', 'accept-language', 'if-none-match', 'if-modified-since'])

const allowedHeaders = (value: unknown) => {
  const record = stringRecord(value)
  return record && Object.fromEntries(Object.entries(record).filter(([name]) => FETCH_HEADERS.has(name.toLowerCase())))
}

// What ctx.http may send: the methods, the headers a plugin may set (Hodi writes the others), and the body's size.
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const HTTP_HEADERS = new Set([...FETCH_HEADERS, 'content-type', 'authorization'])
export const MAX_HTTP_BODY = CONFIG.pluginSandbox.httpBodyMaxSize

// The body of a ctx.http request as text, at most one of the three. Hodi names the type of the JSON or the form it
// writes, in sent.
const bodyOf = (
  { body, json, form }: { body: unknown; json: unknown; form: unknown },
  sent: Record<string, string>
) => {
  const bodies = [body, json, form].filter(value => value !== undefined)
  if (bodies.length > 1) throw new Error('one_body')
  if (typeof body === 'string') return body
  if (body !== undefined) throw new Error('invalid_body')
  if (json === undefined && form === undefined) return undefined
  for (const name of Object.keys(sent)) if (name.toLowerCase() === 'content-type') delete sent[name]
  if (json !== undefined) {
    sent['content-type'] = 'application/json'
    return JSON.stringify(json)
  }
  // Every field is text: a field left out without a word would make a request the plugin did not mean.
  if (typeof form !== 'object' || form === null || Array.isArray(form)) throw new Error('invalid_form')
  const fields = Object.entries(form)
  if (fields.some(([, value]) => typeof value !== 'string')) throw new Error('invalid_form')
  sent['content-type'] = 'application/x-www-form-urlencoded'
  return new URLSearchParams(fields as [string, string][]).toString()
}

// A plugin's ctx.http options, checked: a body is text, JSON or a form, and only goes over https.
const httpRequestOf = (url: unknown, options: unknown) => {
  if (typeof url !== 'string') throw new Error('invalid_url')
  const {
    method = 'GET',
    headers,
    body,
    json,
    form
  } = (typeof options === 'object' && options !== null ? options : {}) as {
    method?: unknown
    headers?: unknown
    body?: unknown
    json?: unknown
    form?: unknown
  }
  if (typeof method !== 'string' || !HTTP_METHODS.has(method)) throw new Error('invalid_method')
  const record = stringRecord(headers) ?? {}
  const sent: Record<string, string> = Object.fromEntries(
    Object.entries(record).filter(([name]) => HTTP_HEADERS.has(name.toLowerCase()))
  )
  const text = bodyOf({ body, json, form }, sent)
  if (text !== undefined && method === 'GET') throw new Error('get_has_no_body')
  if (text !== undefined && Buffer.byteLength(text) > MAX_HTTP_BODY) throw new Error('body_too_large')
  // What carries a secret (a body, a token) never travels in clear.
  const secret = text !== undefined || Object.keys(sent).some(name => name.toLowerCase() === 'authorization')
  if (secret && !URL.canParse(url)) throw new Error('invalid_url')
  if (secret && new URL(url).protocol !== 'https:') throw new Error('https_only')
  return { url, method, headers: sent, body: text }
}

interface RequestDeps {
  fetchTextFor: (isAllowed: IsAllowedUrl) => FetchText
  fetchHttpFor: (isAllowed: IsAllowedUrl) => FetchHttp
  isPublicUrl: IsAllowedUrl
  articles: PluginArticles
  accounts: PluginAccounts
  mail: PluginMailer
  notifier: PluginNotifier
  serverNotifier: PluginServerNotifier
  serverSettings: () => PublicServerSettings
  signed: boolean
  ai: PluginAi
}

type Requests = Record<string, SandboxRequest>

const addNetwork = (
  requests: Requests,
  network: string[],
  { fetchTextFor, fetchHttpFor, isPublicUrl }: RequestDeps
) => {
  // Every hop of a redirect is checked too: a listed site cannot send the request elsewhere.
  const isAllowed: IsAllowedUrl = async url =>
    ['http:', 'https:'].includes(url.protocol) && network.includes(url.hostname) && (await isPublicUrl(url))
  const fetchText = fetchTextFor(isAllowed)
  requests.fetchText = async ([url, options]) => {
    if (typeof url !== 'string') throw new Error('invalid_url')
    const { headers } = (typeof options === 'object' && options !== null ? options : {}) as { headers?: unknown }
    const fetched = await fetchText(url, { headers: allowedHeaders(headers) })
    return { url: fetched.url, text: fetched.text }
  }
  const fetchHttp = fetchHttpFor(isAllowed)
  requests.http = async ([url, options]) => {
    const { method, headers, body } = httpRequestOf(url, options)
    return fetchHttp(String(url), { method, headers, body })
  }
}

const addAccounts = (requests: Requests, manifest: Manifest, { accounts }: RequestDeps) => {
  const plugin = manifest.id
  requests['accounts.get'] = async ([id]) => accounts.get(id, plugin)
  requests['accounts.findByEmail'] = async ([email]) => accounts.findByEmail(email, plugin)
  requests['accounts.list'] = async () => accounts.list(plugin)
  requests['accounts.suspend'] = async ([id]) => accounts.suspend(id, plugin)
  requests['accounts.resume'] = async ([id]) => accounts.resume(id, plugin)
  requests['accounts.remove'] = async ([id]) => accounts.remove(id, plugin)
  requests['accounts.create'] = async ([value], context) => vouch(context, await accounts.create(value, manifest.id))
  requests['accounts.checkPassword'] = async ([email, password], context) =>
    vouch(context, await accounts.checkPassword(email, password, clientOf(context, plugin), plugin))
  // The plugin vouches for whom its own login names: the person proved it to the plugin (a Google sign-in).
  requests['accounts.findByLogin'] = async ([login], context) =>
    vouch(context, accounts.findByLogin(login, manifest.id))
  // Only for an account this same call made or checked: a plugin cannot give itself a way into anyone's account.
  requests['accounts.addLogin'] = async ([accountId, login], context) => {
    const id = typeof accountId === 'number' ? accountId : NaN
    if (typeof context !== 'object' || context === null || !vouchedFor(context as CallContext, id))
      throw new Error('not_vouched')
    return accounts.addLogin(id, login, manifest.id)
  }
}

const addAi = (requests: Requests, manifest: Manifest, { ai }: RequestDeps) => {
  requests['ai.ask'] = async ([question], context) => {
    const ticket = typeof context === 'object' && context !== null ? (context as CallContext).ai : undefined
    // Only the aiAction a click started, once: a route, a task, a hook, a feed or work left over has no ticket.
    if (!ticket) throw new Error('ai_no_click')
    if (ticket.used) throw new Error('ai_already_asked')
    ticket.used = true
    const asked = pluginQuestion(question)
    if (!asked) throw new Error('ai_invalid_question')
    try {
      return await ai.ask(manifest.id, ticket.profileId, asked)
    } catch (error) {
      ticket.outcome = error instanceof PluginAiError ? error.status : 'failed'
      throw error
    }
  }
}

// What a plugin may ask of Hodi, from what its manifest allows: a request it was not given is refused in the main
// thread, whatever its code does.
export const requestsOf = (manifest: Manifest, deps: RequestDeps) => {
  const { articles, mail, notifier, serverSettings, signed } = deps
  // Read only, and the same for every plugin: what the legal pages of a plugin say.
  const requests: Requests = { serverSettings: async () => serverSettings() }
  const { network } = manifest.permissions
  if (network.length > 0) addNetwork(requests, network, deps)
  if (manifest.permissions.articles) {
    // Only within the call that asked (call-context.ts): never from work a plugin left running.
    requests['articles.get'] = ([id], context) => {
      readerOnly(context)
      return articles.get(String(id))
    }
    requests['articles.page'] = ([id], context) => {
      readerOnly(context)
      return articles.page(String(id))
    }
  }
  if (manifest.permissions.accounts) addAccounts(requests, manifest, deps)
  if (manifest.permissions.mail) {
    const plugin = { id: manifest.id, name: manifest.name }
    requests['mail.available'] = async () => mail.available()
    requests['mail.appUrl'] = async () => mail.appUrl()
    requests['mail.send'] = async ([message]) => {
      await mail.send(plugin, message)
      return null
    }
  }
  if (manifest.permissions.notify) {
    const plugin = { id: manifest.id, name: manifest.name }
    requests['notify.send'] = async ([notice], context) => {
      // A request after its call ended reaches nobody; within a reader's call, only the people around them.
      if (typeof context !== 'object' || context === null) throw new Error('no_call')
      await notifier.send(plugin, notice, readerOf(context as CallContext))
      return null
    }
  }
  if (manifest.permissions.notify && manifest.serverNotifications.length > 0) {
    const plugin = { id: manifest.id, name: manifest.name, kinds: manifest.serverNotifications }
    requests['serverNotify.send'] = async ([type, notice]) => {
      await deps.serverNotifier.send(plugin, type, notice)
      return null
    }
    requests['serverNotify.handled'] = async ([key]) => {
      deps.serverNotifier.handled(plugin, key)
      return null
    }
  }
  // The household pays for it: only a plugin a trusted key signed gets it, whatever its manifest says.
  if (manifest.permissions.ai && signed) addAi(requests, manifest, deps)
  return requests
}
