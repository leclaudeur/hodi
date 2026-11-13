import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { buildPlugin } from '../../plugin-sdk/build.ts'
import { run } from '../../plugin-sdk/cli.ts'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { unpackPackage } from '../plugins/package.ts'
import { loadPlugins } from '../plugins/registry.ts'

const HELLO_WORLD = path.join(import.meta.dirname, '..', '..', 'plugin-sdk', 'test', 'hello-world')

describe('plugin SDK', () => {
  it('bundles the packages a server part imports, and refuses those of Node', async () => {
    const source = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-deps-'))
    symlinkSync(path.join(import.meta.dirname, '..', '..', 'node_modules'), path.join(source, 'node_modules'))
    writeFileSync(
      path.join(source, 'plugin.json'),
      JSON.stringify({ id: 'deps', name: 'Deps', version: '0.1.0', description: 'Bundles clsx.', api: 2 })
    )
    mkdirSync(path.join(source, 'server'))
    writeFileSync(
      path.join(source, 'server', 'index.ts'),
      "import clsx from 'clsx'\nexport default { migrations: [clsx('a', 'b')] }\n"
    )
    const out = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-'))
    const built = await buildPlugin(source, { out })

    const into = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-sdk-plugins-')), 'deps')
    await unpackPackage(readFileSync(built.file), into, [])
    const server = readFileSync(path.join(into, 'server.js'), 'utf8')
    // A plugin's folder has no node_modules, and its sandbox loads server.js alone: clsx is inside it.
    assert.doesNotMatch(server, /^import /m)

    // Node's modules do not exist in the sandbox: the build says so instead of making a plugin that cannot load.
    writeFileSync(
      path.join(source, 'server', 'index.ts'),
      "import { join } from 'node:path'\nexport default { migrations: [join('a', 'b')] }\n"
    )
    await assert.rejects(buildPlugin(source, { out }), /Node's modules/)
  })

  it('builds web/public.tsx apart, into web-public.js and web-public.css', async () => {
    const source = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-public-'))
    symlinkSync(path.join(import.meta.dirname, '..', '..', 'node_modules'), path.join(source, 'node_modules'))
    writeFileSync(
      path.join(source, 'plugin.json'),
      JSON.stringify({
        id: 'landing',
        name: 'Landing',
        version: '0.1.0',
        description: 'Before sign-in.',
        api: 2,
        permissions: { publicRoutes: true }
      })
    )
    mkdirSync(path.join(source, 'web'))
    writeFileSync(
      path.join(source, 'web', 'index.tsx'),
      "import { definePlugin } from 'hodi:sdk'\ndefinePlugin({ settingsPage: () => 'admin only' })\n"
    )
    writeFileSync(path.join(source, 'web', 'landing.css'), '.landing-page { color: var(--text); }\n')
    writeFileSync(
      path.join(source, 'web', 'public.tsx'),
      "import { definePlugin } from 'hodi:sdk'\nimport './landing.css'\ndefinePlugin({ signedOutPage: () => 'welcome' })\n"
    )
    const built = await buildPlugin(source, { out: mkdtempSync(path.join(tmpdir(), 'hodi-sdk-')) })
    const into = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-sdk-plugins-')), 'landing')
    await unpackPackage(readFileSync(built.file), into, [])

    const pub = readFileSync(path.join(into, 'web-public.js'), 'utf8')
    assert.match(pub, /welcome/)
    // The visitor's file never carries what is for those signed in, nor the reverse.
    assert.doesNotMatch(pub, /admin only/)
    assert.doesNotMatch(readFileSync(path.join(into, 'web.js'), 'utf8'), /welcome/)
    assert.match(readFileSync(path.join(into, 'web-public.css'), 'utf8'), /landing-page/)
  })

  it('builds the hello-world example into a signed package that Hodi installs and runs', async () => {
    const keys = generateKeyPairSync('ed25519')
    const out = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-'))
    const built = await buildPlugin(HELLO_WORLD, {
      out,
      key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    })
    assert.equal(path.basename(built.file), 'hello-world-0.1.0.hodi-plugin')

    // Unpacked as Serveur › Plugins does: the key that signed it is trusted, so it is "Vérifié".
    const plugins = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-plugins-'))
    const into = path.join(plugins, 'hello-world')
    const trusted = [keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()]
    const unpacked = await unpackPackage(readFileSync(built.file), into, trusted)
    assert.equal(unpacked.manifest.id, 'hello-world')
    assert.equal(unpacked.signed, true)
    assert.deepEqual(readdirSync(into, { recursive: true }).map(String).sort(), [
      'locales',
      path.join('locales', 'en.json'),
      path.join('locales', 'fr.json'),
      'plugin.json',
      'server.js',
      'signature',
      'web.css',
      'web.js'
    ])

    // The web part reads React and hodi:sdk from the page instead of bundling them.
    const web = readFileSync(path.join(into, 'web.js'), 'utf8')
    assert.match(web, /__hodi\.sdk/)
    assert.doesNotMatch(web, /react-dom\.production|createRoot/)

    // The server part loads in its sandbox, runs its migration and answers on its route.
    const db = openDatabase(':memory:')
    const registry = await loadPlugins({
      dir: plugins,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-sdk-data-')),
      store: new PluginStore(db),
      log: () => {}
    })
    try {
      const plugin = registry.get('hello-world')!
      assert.equal(plugin.error, null)
      assert.deepEqual(plugin.shape?.routes, ['POST /hello'])
      assert.deepEqual(await plugin.sandbox!.call('routes', 'POST /hello', { who: {} }), {
        body: { text: 'Bonjour', count: 1 }
      })
    } finally {
      await registry.stop()
    }
  })

  it('builds from the command line, with "build" optional, and refuses arguments it does not know', async () => {
    const copy = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-cli-'))
    cpSync(HELLO_WORLD, copy, { recursive: true, filter: from => !from.includes(`${path.sep}dist`) })
    await run(['build', copy])
    assert.ok(existsSync(path.join(copy, 'dist', 'hello-world-0.1.0.hodi-plugin')))

    const usage = /Usage: hodi-plugin build/
    await assert.rejects(run([copy, '--key']), usage)
    await assert.rejects(run(['build', copy, copy]), usage)
    await assert.rejects(run(['build', '--watch']), usage)
  })
})
