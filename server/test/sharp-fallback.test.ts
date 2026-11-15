import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  dependencies: Record<string, string>
  optionalDependencies: Record<string, string>
}

// sharp's prebuilt binaries for x64 need an x86-64-v2 processor; on an older one, or a virtual machine with a generic
// CPU, it loads its WebAssembly build instead, which only works when both packages share a version.
test('the WebAssembly build of sharp follows sharp’s version', () => {
  assert.equal(manifest.optionalDependencies['@img/sharp-wasm32'], manifest.dependencies.sharp)
})
