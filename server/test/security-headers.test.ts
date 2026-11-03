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

  const overlay = source('overlayscrollbars/overlayscrollbars.mjs')
  const environment = /const L = "([^"]+)";/.exec(overlay)?.[1]
  const probe = /const t = `(\.\$\{L\}\{scroll-behavior[^`]+)`;/.exec(overlay)?.[1]
  assert.ok(environment && probe, 'OverlayScrollbars no longer adds its probe style')
  const css = probe.replaceAll('${L}', environment).replaceAll('${P}', `${environment}-scrollbar-hidden`)
  assert.ok(STYLE_HASHES.includes(hashOf(css)), 'overlayscrollbars')

  assert.ok(STYLE_HASHES.includes(hashOf('')), 'empty style')
})
