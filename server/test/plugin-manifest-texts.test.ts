import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { create as createTar } from 'tar'
import { PluginInstaller } from '../plugins/installer.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { manifestTranslations } from '../plugins/manifest-texts.ts'

const MANIFEST = {
  id: 'hello',
  name: 'Bonjour',
  version: '0.1.0',
  description: 'Dit bonjour.',
  api: PLUGIN_API,
  audience: 'all',
  provides: []
}

const folderWith = (files: Record<string, string>) => {
  const root = mkdtempSync(path.join(tmpdir(), 'hodi-texts-'))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    writeFileSync(path.join(root, name), content)
  }
  return root
}

const locale = (manifest: unknown, rest: object = {}) => JSON.stringify({ ...rest, manifest })

describe('a plugin’s name and description in other languages', () => {
  it('reads manifest.name and manifest.description from each of its locales', () => {
    const root = folderWith({
      'locales/en.json': locale({ name: ' Hello ', description: 'Says hello.' }, { hello: 'Hello' }),
      'locales/de.json': locale({ name: 'Hallo' }),
      'locales/fr.json': '{"hello":"Bonjour"}'
    })
    assert.deepEqual(manifestTranslations(root), {
      de: { name: 'Hallo' },
      en: { name: 'Hello', description: 'Says hello.' }
    })
  })

  it('keeps plugin.json’s texts where a locale is broken, empty or too long', () => {
    const root = folderWith({
      'locales/en.json': '{ not json',
      'locales/de.json': locale({ name: '', description: 42 }),
      'locales/es.json': locale({ name: 'x'.repeat(61), description: 'y'.repeat(281) }),
      'locales/it.json': locale('Ciao'),
      'locales/nl.json': locale({ name: 'x'.repeat(60), description: 'y'.repeat(280) })
    })
    assert.deepEqual(manifestTranslations(root), { nl: { name: 'x'.repeat(60), description: 'y'.repeat(280) } })
    assert.deepEqual(manifestTranslations(folderWith({ 'plugin.json': '{}' })), {})
  })

  it('shows them before the install, from the package', async () => {
    const root = folderWith({
      'plugin.json': JSON.stringify(MANIFEST),
      'locales/fr.json': locale({ name: 'Bonjour' }),
      'locales/en.json': locale({ name: 'Hello', description: 'Says hello.' })
    })
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'hodi-tgz-')), 'hello.hodi-plugin')
    await createTar({ gzip: true, file, cwd: root, portable: true }, readdirSync(root))
    const installer = new PluginInstaller({
      dir: mkdtempSync(path.join(tmpdir(), 'hodi-plugins-')),
      keys: [],
      installedVersion: () => null
    })
    const staged = await installer.stage(readFileSync(file))
    assert.deepEqual(staged.translations, {
      en: { name: 'Hello', description: 'Says hello.' },
      fr: { name: 'Bonjour' }
    })
  })
})
