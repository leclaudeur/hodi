import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import express from 'express'
import { create as createTar } from 'tar'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { pluginRoutes } from '../http/plugin-routes.ts'
import { PluginCatalog } from '../plugins/catalog.ts'
import { PluginInstaller } from '../plugins/installer.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

const REPO = 'https://github.com/someone/hodi-plugin-hello'
const URL = `${REPO}/releases/download/v0.2.0/hello-0.2.0.hodi-plugin`

const makePackage = async (version = '0.2.0') => {
  const root = mkdtempSync(path.join(tmpdir(), 'hodi-catalog-package-'))
  const files: Record<string, string> = {
    'plugin.json': JSON.stringify({
      id: 'hello',
      name: 'Bonjour',
      version,
      description: 'Dit bonjour.',
      api: PLUGIN_API,
      audience: 'all'
    }),
    'server.js': 'export default {}',
    'locales/fr.json': '{}'
  }
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), content)
  }
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-catalog-tgz-')), 'hello.hodi-plugin')
  await createTar({ gzip: true, file, cwd: root, portable: true }, readdirSync(root))
  return readFileSync(file)
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const entry = (overrides: Record<string, unknown> = {}) => ({
  id: 'hello',
  name: 'Bonjour',
  description: 'Dit bonjour.',
  translations: { en: { name: 'Hello', description: 'Says hello.' }, xx1: { name: 'dropped' } },
  repo: REPO,
  version: '0.2.0',
  api: PLUGIN_API,
  url: URL,
  sha256: '0'.repeat(64),
  ...overrides
})

// A registry served from memory: its index, and the files at their release addresses.
const fakeOutside = (plugins: unknown[], files: Record<string, Buffer> = {}) => {
  const asked: string[] = []
  return {
    asked,
    fetchText: async (url: string) => {
      asked.push(url)
      return { url, text: JSON.stringify({ plugins }) }
    },
    fetchBytes: async (url: string) => {
      const bytes = files[url]
      if (!bytes) throw new Error('HTTP 404')
      return { url, bytes }
    }
  }
}

const registries: PluginRegistry[] = []
const servers: { close: () => void }[] = []
after(async () => {
  servers.forEach(server => server.close())
  await Promise.all(registries.map(registry => registry.stop()))
})

describe("Hodi's plugin registry", () => {
  it('lists only the entries Hodi can install, pre-releases included, and reads the index again after ten minutes', async () => {
    let time = 0
    const outside = fakeOutside([
      entry(),
      entry({
        id: 'beta',
        version: '1.0.0-beta.1',
        url: `${REPO}/releases/download/v1.0.0-beta.1/beta-1.0.0-beta.1.hodi-plugin`
      }),
      entry({ id: 'no-version', version: 'latest' }),
      entry({ id: 'old', api: PLUGIN_API - 1 }),
      entry({ id: 'elsewhere', url: 'https://example.com/hello.hodi-plugin' }),
      entry({ id: 'other-repo', url: 'https://github.com/x/y/releases/download/v0.2.0/y.hodi-plugin' }),
      entry({ id: 'no-sum', sha256: 'abc' }),
      entry({ id: 'Bad id' }),
      'not an entry'
    ])
    const catalog = new PluginCatalog({ ...outside, now: () => time })
    const listed = await catalog.list()
    assert.deepEqual(
      listed.map(plugin => plugin.id),
      ['hello', 'beta']
    )
    assert.deepEqual(listed[0]?.translations, { en: { name: 'Hello', description: 'Says hello.' } })

    await catalog.list()
    assert.equal(outside.asked.length, 1)
    time = 10 * 60 * 1000
    await catalog.list()
    assert.equal(outside.asked.length, 2)
  })

  it('says the registry is unavailable when its index cannot be read', async () => {
    const catalog = new PluginCatalog({
      fetchText: async url => ({ url, text: '<html>rate limited</html>' }),
      fetchBytes: async () => {
        throw new Error('unused')
      }
    })
    await assert.rejects(catalog.list(), { code: 'catalog_unavailable' })
  })

  describe('Serveur › Plugins › Disponibles', async () => {
    const bytes = await makePackage()
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-catalog-plugins-'))
    const dataDir = mkdtempSync(path.join(tmpdir(), 'hodi-catalog-data-'))
    const installer = new PluginInstaller({ dir, keys: [], installedVersion: () => null })

    const start = async (plugins: unknown[], files: Record<string, Buffer>) => {
      const registry = await loadPlugins({
        dir,
        dataDir,
        store: new PluginStore(openDatabase(':memory:')),
        trustedKeys: [],
        log: () => {}
      })
      registries.push(registry)
      const catalog = new PluginCatalog(fakeOutside(plugins, files))
      const app = express()
      app.use((_request, response, next) => {
        Object.assign(response.locals, { serverAdmin: true, admin: true, profileId: 1 })
        next()
      })
      app.use('/api/plugins', pluginRoutes(registry, { installer, catalog }))
      const server = app.listen(0)
      servers.push(server)
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plugins`
    }

    it('lists the registry and stages a plugin whose file matches its sha256', async () => {
      const base = await start([entry({ sha256: sha(bytes) })], { [URL]: bytes })
      const listed = (await (await fetch(`${base}/catalog`)).json()) as { plugins: Record<string, unknown>[] }
      assert.deepEqual(listed.plugins, [
        {
          id: 'hello',
          name: 'Bonjour',
          description: 'Dit bonjour.',
          translations: { en: { name: 'Hello', description: 'Says hello.' } },
          version: '0.2.0',
          repo: REPO
        }
      ])

      const staged = await fetch(`${base}/catalog/hello/stage`, { method: 'POST' })
      assert.equal(staged.status, 201)
      const body = (await staged.json()) as { id: string; version: string; signed: boolean; token: string }
      assert.deepEqual([body.id, body.version, body.signed], ['hello', '0.2.0', false])
      assert.ok(body.token.length > 0)
    })

    it('refuses a file that is not the one reviewed, or not the plugin and version listed', async () => {
      const replaced = await start([entry({ sha256: sha(bytes) })], { [URL]: Buffer.concat([bytes, Buffer.from('x')]) })
      const mismatch = await fetch(`${replaced}/catalog/hello/stage`, { method: 'POST' })
      assert.deepEqual([mismatch.status, await mismatch.json()], [409, { error: 'checksum_mismatch' }])

      const older = await makePackage('0.1.0')
      const wrong = await start([entry({ sha256: sha(older) })], { [URL]: older })
      const named = await fetch(`${wrong}/catalog/hello/stage`, { method: 'POST' })
      assert.deepEqual([named.status, await named.json()], [400, { error: 'invalid_manifest' }])

      const missing = await start([entry()], {})
      assert.equal((await fetch(`${missing}/catalog/nope/stage`, { method: 'POST' })).status, 404)
      const gone = await fetch(`${missing}/catalog/hello/stage`, { method: 'POST' })
      assert.deepEqual([gone.status, await gone.json()], [502, { error: 'download_failed' }])
    })
  })
})
