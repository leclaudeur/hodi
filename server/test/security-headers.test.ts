import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { STYLE_HASHES } from '../http/security-headers.ts'

const hashOf = (css: string) => `sha256-${createHash('sha256').update(css).digest('base64')}`
const source = (path: string) => readFileSync(new URL(`../../node_modules/${path}`, import.meta.url), 'utf8')

// A library update that changes its styles would have them blocked again: this says which hash to update.
test('the style hashes allowed by the CSP match the installed libraries', () => {
  const sonner = /__insertCSS\(("(?:[^"\\]|\\.)*")\)/.exec(source('sonner/dist/index.mjs'))
  assert.ok(sonner, 'sonner no longer inserts its CSS')
  assert.ok(STYLE_HASHES.includes(hashOf(JSON.parse(sonner[1]) as string)), 'sonner')

  // The bundle's names change with each build: the probe's ${…} are read from the constants they name.
  const overlay = source('overlayscrollbars/overlayscrollbars.mjs')
  const probe = /const \w+ = `(\.\$\{\w+\}\{scroll-behavior[^`]+)`;/.exec(overlay)?.[1]
  assert.ok(probe, 'OverlayScrollbars no longer adds its probe style')
  const valueOf = (name: string): string => {
    const constant = new RegExp(`const ${name} = (?:"([^"]*)"|\`([^\`]*)\`);`).exec(overlay)
    assert.ok(constant, `OverlayScrollbars no longer names ${name}`)
    return constant[1] ?? fill(constant[2]!)
  }
  const fill = (template: string) => template.replaceAll(/\$\{(\w+)\}/g, (_, name: string) => valueOf(name))
  const css = fill(probe)
  assert.ok(STYLE_HASHES.includes(hashOf(css)), 'overlayscrollbars')

  assert.ok(STYLE_HASHES.includes(hashOf('')), 'empty style')
})
