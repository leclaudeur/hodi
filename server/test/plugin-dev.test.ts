import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import express from 'express'
import { create as createTar } from 'tar'
import { devOptions, sendBuild } from '../../plugin-sdk/dev.ts'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { pluginDevRoutes, pluginRoutes } from '../http/plugin-routes.ts'
import { PluginInstaller } from '../plugins/installer.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { packageDigest } from '../plugins/package.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

const FILES = {
  'plugin.json': JSON.stringify({
    id: 'hello',
    name: 'Hello',
    version: '0.1.0',
    description: 'Dit bonjour.',
    api: PLUGIN_API,
    audience: 'all'
  }),
  'server.js': `export default { routes: { 'GET /hi': async (_request, ctx) => { ctx.log('salut'); return { body: 'hi' } } } }`,
  'web.js': 'window.hello = true',
  'locales/fr.json': '{}'
}

const makePackage = async (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hodi-dev-package-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), content)
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-dev-tgz-')), 'hello.hodi-plugin')
  await createTar({ gzip: true, file, cwd: root, portable: true }, readdirSync(root))
  return { root, bytes: readFileSync(file) }
}

const registries: PluginRegistry[] = []
const servers: { close: () => void }[] = []
after(async () => {
  servers.forEach(server => server.close())
  await Promise.all(registries.map(registry => registry.stop()))
})

describe('Mode développeur and « npx hodi-plugin dev »', () => {
  const keys = generateKeyPairSync('ed25519')
  const trusted = [keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]
  const dir = mkdtempSync(path.join(tmpdir(), 'hodi-dev-plugins-'))
  const dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-dev-data-'))
  const store = new PluginStore(openDatabase(':memory:'))
  let restarts = 0
  const installer = new PluginInstaller({ dir, keys: trusted, installedVersion: () => null })

  // Hodi as it starts: the plugins read from the folder, the server admin signed in.
  const start = async () => {
    const plugins = await loadPlugins({ dir, dataDir, store, trustedKeys: trusted, log: () => {} })
    registries.push(plugins)
    const app = express()
    app.use((_request, response, next) => {
      Object.assign(response.locals, { serverAdmin: true, admin: true, profileId: 1 })
      next()
    })
    const restart = () => {
      restarts++
    }
    app.use('/api/dev', pluginDevRoutes(plugins, { installer, restart }))
    app.use('/api/plugins', pluginRoutes(plugins, { installer, restart }))
    const server = app.listen(0)
    servers.push(server)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
    return { plugins, base }
  }
  const send = (base: string, code: string, bytes: Buffer) =>
    fetch(`${base}/dev/plugins`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/octet-stream' },
      body: bytes
    })

  it('installs a build only with the code, and serves its pages while the mode is on', async () => {
    const { bytes } = await makePackage(FILES)
    let { base } = await start()

    assert.deepEqual(await (await fetch(`${base}/plugins/dev-mode`)).json(), { on: false })
    assert.equal((await send(base, 'anything', bytes)).status, 401)

    const { code } = (await (await fetch(`${base}/plugins/dev-mode`, { method: 'POST' })).json()) as { code: string }
    assert.ok(code.length >= 32)
    assert.equal((await send(base, `${code}x`, bytes)).status, 401)
    assert.equal((await send(base, '', bytes)).status, 401)

    const sent = await send(base, code, bytes)
    assert.equal(sent.status, 202)
    assert.deepEqual(await sent.json(), { installed: 'hello', version: '0.1.0', restarting: true })
    assert.equal(restarts, 1)

    // After the restart: unsigned, but in development, so its web part is served and its log can be read.
    const restarted = await start()
    base = restarted.base
    const hello = restarted.plugins.get('hello')!
    assert.deepEqual([hello.signed, hello.dev, hello.web.script], [false, true, true])
    assert.equal((await fetch(`${base}/plugins/hello/files/web.js`)).status, 200)
    await hello.sandbox!.call('routes', 'GET /hi', {}, { householdId: null })
    const log = (await (
      await fetch(`${base}/dev/plugins/hello/log?after=0`, { headers: { Authorization: `Bearer ${code}` } })
    ).json()) as { lines: string[]; next: number }
    assert.deepEqual(log.lines, ['salut'])
    const later = (await (
      await fetch(`${base}/dev/plugins/hello/log?after=${log.next}`, { headers: { Authorization: `Bearer ${code}` } })
    ).json()) as { lines: string[] }
    assert.deepEqual(later.lines, [])
    assert.equal((await fetch(`${base}/dev/plugins/hello/log`)).status, 401)

    // Its data belongs to the plugin in development, not to these exact files: the next build keeps it.
    await hello.sandbox!.call('routes', 'GET /hi', {}, { householdId: null })
    assert.equal(store.dataOwner('hello'), 'dev:hello')

    // Off: the code stops working, Hodi restarts, and the plugin is a plain unsigned one again.
    const off = (await (await fetch(`${base}/plugins/dev-mode`, { method: 'DELETE' })).json()) as {
      restarting: boolean
    }
    assert.equal(off.restarting, true)
    assert.equal(restarts, 2)
    assert.equal((await send(base, code, bytes)).status, 401)
    const plain = await start()
    assert.deepEqual([plain.plugins.get('hello')!.dev, plain.plugins.get('hello')!.web.script], [false, false])
    assert.equal((await fetch(`${plain.base}/plugins/hello/files/web.js`)).status, 404)
  })

  it('never replaces a verified plugin with a build', async () => {
    const { root } = await makePackage(FILES)
    const signed = await makePackage({
      ...FILES,
      signature: sign(null, packageDigest(root), keys.privateKey).toString('base64')
    })
    const staged = await installer.stage(signed.bytes)
    assert.equal(staged.signed, true)
    installer.install(staged.token, { acceptUnsigned: false })

    const { base } = await start()
    const { code } = (await (await fetch(`${base}/plugins/dev-mode`, { method: 'POST' })).json()) as { code: string }
    const refused = await send(base, code, (await makePackage(FILES)).bytes)
    assert.equal(refused.status, 409)
    assert.deepEqual(await refused.json(), { error: 'replaces_verified' })
  })
})

describe('hodi-plugin dev', () => {
  it('reads its folder, Hodi’s address and the code', () => {
    assert.deepEqual(devOptions(['my-plugin', '--server', 'http://localhost:3000/', '--code', 'abc'], {}), {
      folder: path.resolve('my-plugin'),
      server: 'http://localhost:3000',
      code: 'abc'
    })
    assert.equal(devOptions(['--server', 'https://hodi.example'], { HODI_DEV_CODE: 'xyz' }).code, 'xyz')
    for (const args of [
      ['--server', 'http://localhost:3000'],
      ['--code', 'abc'],
      ['--server', 'ftp://hodi.example', '--code', 'abc'],
      ['--server', '--code', 'abc'],
      ['a', 'b', '--server', 'http://localhost:3000', '--code', 'abc']
    ]) {
      assert.throws(() => devOptions(args, {}), /Usage/, JSON.stringify(args))
    }
  })

  it('sends a build and waits for Hodi to come back with another boot', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-dev-built-')), 'hello-0.1.0.hodi-plugin')
    writeFileSync(file, 'package')
    const calls: string[] = []
    let boot = 'first'
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/health')) return Response.json({ status: 'ok', boot })
      assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer abc')
      boot = 'second'
      return Response.json({ installed: 'hello' }, { status: 202 })
    }) as typeof fetch
    const built = await sendBuild(
      { folder: '/plugin', server: 'http://hodi.test', code: 'abc' },
      {
        fetch: fakeFetch,
        build: async () => ({ id: 'hello', version: '0.1.0', file, signed: false }),
        wait: async () => {}
      }
    )
    assert.equal(built.id, 'hello')
    assert.deepEqual(calls, [
      'GET http://hodi.test/health',
      'POST http://hodi.test/api/dev/plugins',
      'GET http://hodi.test/health'
    ])

    const refusing = (async (url: string) =>
      url.endsWith('/health')
        ? Response.json({ boot: 'x' })
        : Response.json({ error: 'dev_mode_off' }, { status: 401 })) as typeof fetch
    await assert.rejects(
      sendBuild(
        { folder: '/plugin', server: 'http://hodi.test', code: 'abc' },
        { fetch: refusing, build: async () => ({ id: 'hello', version: '0.1.0', file, signed: false }) }
      ),
      /Mode développeur/
    )
  })
})
