// The JavaScript the engine runs around a plugin (worker.ts): the prelude that builds its ctx, and the runtime that
// calls into it.

// What the plugin's code reaches: the bridge is taken off globalThis by the prelude before the plugin runs.
export const PRELUDE = `
const bridge = globalThis.__hodi
// Nothing to share memory with: no threads in here.
delete globalThis.SharedArrayBuffer
delete globalThis.__hodi
// UTF-8 text to bytes and back, as in a browser: the engine has neither.
class TextEncoder {
  get encoding() { return 'utf-8' }
  encode(text = '') {
    const out = []
    for (const char of String(text)) {
      let code = char.codePointAt(0)
      if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd
      if (code < 0x80) out.push(code)
      else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
      else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
      else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    }
    return new Uint8Array(out)
  }
}
class TextDecoder {
  get encoding() { return 'utf-8' }
  decode(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input ?? [])
    const codes = []
    for (let at = 0; at < bytes.length; ) {
      const first = bytes[at]
      const length = first < 0x80 ? 1 : (first & 0xe0) === 0xc0 ? 2 : (first & 0xf0) === 0xe0 ? 3 : (first & 0xf8) === 0xf0 ? 4 : 0
      let code = length === 1 ? first : length === 2 ? first & 31 : length === 3 ? first & 15 : first & 7
      let used = length
      if (length === 0 || at + length > bytes.length) { code = 0xfffd; used = 1 }
      for (let next = 1; next < used; next++) {
        const byte = bytes[at + next]
        if ((byte & 0xc0) !== 0x80) { code = 0xfffd; used = next; break }
        code = (code << 6) | (byte & 63)
      }
      if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) code = 0xfffd
      codes.push(code)
      at += used
    }
    let text = ''
    for (let at = 0; at < codes.length; at += 4096) text += String.fromCodePoint(...codes.slice(at, at + 4096))
    return text
  }
}
globalThis.TextEncoder = TextEncoder
globalThis.TextDecoder = TextDecoder
// Random bytes a guess cannot find, as in a browser: Math.random is not enough for a code or a token. Only
// getRandomValues and randomUUID, never crypto.subtle.
const randomBytes = bridge.randomBytes
const integerArrays = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, BigInt64Array, BigUint64Array]
const getRandomValues = array => {
  if (!integerArrays.some(type => array instanceof type)) throw new TypeError('getRandomValues takes an integer typed array')
  if (array.byteLength > 65536) throw new RangeError('getRandomValues takes 65536 bytes at most')
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(new Uint8Array(randomBytes(array.byteLength)))
  return array
}
const randomUUID = () => {
  const bytes = getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20)
}
globalThis.crypto = Object.freeze({ getRandomValues, randomUUID })
const json = value => JSON.stringify(value === undefined ? null : value)
// Bytes (a BLOB) cross apart from the JSON: their places in the list, then each one's ArrayBuffer.
const pack = params => {
  if (!Array.isArray(params)) return [json(params), '[]']
  const places = []
  const buffers = []
  const plain = params.map((value, at) => {
    if (!(value instanceof Uint8Array) && !(value instanceof ArrayBuffer)) return value
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value
    places.push(at)
    buffers.push(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    return null
  })
  return [json(plain), json(places), ...buffers]
}
const unpack = ([text, places, ...buffers]) => {
  const rows = JSON.parse(text)
  JSON.parse(places).forEach(([row, column], at) => { rows[row][column] = new Uint8Array(buffers[at]) })
  return rows
}
const db = Object.freeze({
  query: (sql, params = []) => unpack(bridge.dbQuery(sql, ...pack(params))),
  get: (sql, params = []) => unpack(bridge.dbQuery(sql, ...pack(params)))[0] ?? null,
  run: (sql, params = []) => JSON.parse(bridge.dbRun(sql, ...pack(params)))
})
let settings = {}
const objects = JSON.parse(bridge.objects)
export const ctx = Object.freeze({
  id: bridge.id,
  db,
  settings: () => settings,
  serverSettings: async () => JSON.parse(await bridge.host('serverSettings', json([]))),
  log: message => bridge.log(String(message)),
  fetchText: async (url, options = {}) => JSON.parse(await bridge.host('fetchText', json([String(url), options]))),
  http: async (url, options = {}) => JSON.parse(await bridge.host('http', json([String(url), options]))),
  articles: Object.freeze({
    get: async id => JSON.parse(await bridge.host('articles.get', json([String(id)]))),
    page: async id => JSON.parse(await bridge.host('articles.page', json([String(id)])))
  }),
  ...(objects.includes('mail')
    ? {
        mail: Object.freeze({
          available: async () => JSON.parse(await bridge.host('mail.available', json([]))),
          appUrl: async () => JSON.parse(await bridge.host('mail.appUrl', json([]))),
          send: async message => { JSON.parse(await bridge.host('mail.send', json([message]))) }
        })
      }
    : {}),
  // Only inside an aiAction, once per click: Hodi refuses the question anywhere else.
  ...(objects.includes('ai')
    ? { ai: Object.freeze({ ask: async question => JSON.parse(await bridge.host('ai.ask', json([question]))) }) }
    : {}),
  ...(objects.includes('notify')
    ? { notify: async notice => { JSON.parse(await bridge.host('notify.send', json([notice]))) } }
    : {}),
  ...(objects.includes('households')
    ? {
        households: Object.freeze({
          list: async () => JSON.parse(await bridge.host('households.list', json([]))),
          get: async id => JSON.parse(await bridge.host('households.get', json([id]))),
          of: async accountId => JSON.parse(await bridge.host('households.of', json([accountId]))),
          create: async household => JSON.parse(await bridge.host('households.create', json([household]))),
          suspend: async id => { JSON.parse(await bridge.host('households.suspend', json([id]))) },
          resume: async id => { JSON.parse(await bridge.host('households.resume', json([id]))) },
          remove: async id => { JSON.parse(await bridge.host('households.remove', json([id]))) }
        })
      }
    : {}),
  ...(objects.includes('accounts')
    ? {
        accounts: Object.freeze({
          get: async id => JSON.parse(await bridge.host('accounts.get', json([id]))),
          findByEmail: async email => JSON.parse(await bridge.host('accounts.findByEmail', json([email]))),
          create: async account => JSON.parse(await bridge.host('accounts.create', json([account]))),
          checkPassword: async (email, password) =>
            JSON.parse(await bridge.host('accounts.checkPassword', json([email, password]))),
          findByLogin: async login => JSON.parse(await bridge.host('accounts.findByLogin', json([login]))),
          addLogin: async (accountId, login) =>
            JSON.parse(await bridge.host('accounts.addLogin', json([accountId, login])))
        })
      }
    : {})
})
export const setSettings = text => { settings = Object.freeze(JSON.parse(text)) }
`

// The hooks a plugin may export: Hodi calls them, no route does.
const HOOKS = ['onArticle', 'checkSignIn', 'onProfileDeleted', 'onAccountDeleted', 'onHouseholdRemoved', 'exportData']

// Runs a call into the plugin: a route of one of its groups, or a hook. Its answer comes back as JSON text.
export const RUNTIME = `
import plugin from 'plugin'
import { ctx, setSettings } from 'hodi:prelude'
const groups = ['routes', 'serverRoutes', 'publicRoutes']
const HOOKS = ${JSON.stringify(HOOKS)}
// A route is a function, or { handler, raw, maxBody, proof } for one that takes a raw body or asks for the person's
// password first.
const handlerIn = entry =>
  typeof entry === 'function' ? entry : entry && typeof entry.handler === 'function' ? entry.handler : null
const handlerOf = (kind, name) => {
  if (groups.includes(kind)) {
    const group = plugin[kind]
    return group && Object.prototype.hasOwnProperty.call(group, name) ? handlerIn(group[name]) : null
  }
  if (kind === 'task') {
    const task = plugin.tasks && Object.prototype.hasOwnProperty.call(plugin.tasks, name) ? plugin.tasks[name] : null
    // A task's run gets ctx alone: no request led to it.
    return task && typeof task.run === 'function' ? (_request, ctx) => task.run(ctx) : null
  }
  if (kind === 'feed') {
    const feed = plugin.feeds && Object.prototype.hasOwnProperty.call(plugin.feeds, name) ? plugin.feeds[name] : null
    // A feed's read gets ctx alone, like a task: it is fetched once for every household that follows it.
    return typeof feed === 'function' ? (_request, ctx) => feed(ctx) : null
  }
  if (kind === 'aiAction') {
    const action = plugin.aiActions && Object.prototype.hasOwnProperty.call(plugin.aiActions, name) ? plugin.aiActions[name] : null
    return typeof action === 'function' ? action : null
  }
  return kind === 'hook' && HOOKS.includes(name) && typeof plugin[name] === 'function' ? plugin[name] : null
}
globalThis.__hodiDescribe = () => {
  if (typeof plugin !== 'object' || plugin === null) throw new Error('server.js must export a plugin by default')
  if (plugin.migrations !== undefined && !(Array.isArray(plugin.migrations) && plugin.migrations.every(step => typeof step === 'string'))) {
    throw new Error('migrations must be a list of SQL statements')
  }
  for (const group of groups) {
    const table = plugin[group]
    if (table !== undefined && (typeof table !== 'object' || table === null || Object.values(table).some(entry => !handlerIn(entry)))) {
      throw new Error(group + ' must be a table of functions')
    }
  }
  if (plugin.tasks !== undefined && (typeof plugin.tasks !== 'object' || plugin.tasks === null)) {
    throw new Error('tasks must be a table of { every, run }')
  }
  if (plugin.feeds !== undefined && (typeof plugin.feeds !== 'object' || plugin.feeds === null || Object.values(plugin.feeds).some(feed => typeof feed !== 'function'))) {
    throw new Error('feeds must be a table of functions')
  }
  if (plugin.aiActions !== undefined && (typeof plugin.aiActions !== 'object' || plugin.aiActions === null || Object.values(plugin.aiActions).some(action => typeof action !== 'function'))) {
    throw new Error('aiActions must be a table of functions')
  }
  const tasks = {}
  for (const [name, task] of Object.entries(plugin.tasks ?? {})) {
    if (typeof task !== 'object' || task === null || typeof task.run !== 'function') throw new Error('task ' + name + ' must have a run function')
    tasks[name] = task.every
  }
  const rawRoutes = {}
  const proofRoutes = []
  for (const group of groups) {
    for (const [key, entry] of Object.entries(plugin[group] ?? {})) {
      if (typeof entry === 'function') continue
      if (entry.proof !== undefined && entry.proof !== false) {
        if (entry.proof !== true) throw new Error(key + ': proof must be true or false')
        proofRoutes.push(group + ' ' + key)
      }
      if (!entry.raw) continue
      if (!Number.isInteger(entry.maxBody) || entry.maxBody < 1) throw new Error(key + ': maxBody must be a number of bytes')
      rawRoutes[group + ' ' + key] = entry.maxBody
    }
  }
  return JSON.stringify({
  migrations: Array.isArray(plugin.migrations) ? plugin.migrations.map(String) : [],
  routes: Object.keys(plugin.routes ?? {}),
  serverRoutes: Object.keys(plugin.serverRoutes ?? {}),
  publicRoutes: Object.keys(plugin.publicRoutes ?? {}),
  hooks: HOOKS.filter(name => typeof plugin[name] === 'function'),
  tasks,
  feeds: Object.keys(plugin.feeds ?? {}),
  aiActions: Object.keys(plugin.aiActions ?? {}),
  rawRoutes,
  proofRoutes
  })
}
globalThis.__hodiRun = async (kind, name, argument, settingsText, body) => {
  setSettings(settingsText)
  const handler = handlerOf(kind, name)
  if (!handler) throw new Error('no_handler')
  const request = JSON.parse(argument)
  if (body !== undefined) request.body = new Uint8Array(body)
  const result = await handler(request, ctx)
  return JSON.stringify(result === undefined ? null : result)
}
`
