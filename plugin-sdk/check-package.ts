import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The package as a plugin's author gets it: packed, installed from npm's registry in a folder of its own, far from
// Hodi's node_modules, and its test kit run on the hello-world example. A package that only works beside Hodi's own
// dependencies (a module bundled without the native files it loads, a dependency left out) fails here.

const sdk = import.meta.dirname
const folder = mkdtempSync(path.join(tmpdir(), 'hodi-sdk-check-'))
const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' })

try {
  const tarball = run('npm', ['pack', '--silent', '--pack-destination', folder], sdk).trim().split('\n').at(-1)!
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name: 'sdk-check', private: true, type: 'module' }))
  run('npm', ['install', '--no-audit', '--no-fund', '--silent', path.join(folder, tarball)], folder)
  cpSync(path.join(sdk, 'test', 'hello-world'), path.join(folder, 'hello-world'), { recursive: true })
  writeFileSync(
    path.join(folder, 'check.mjs'),
    `import assert from 'node:assert/strict'
import { testPlugin } from '@hodi-app/plugin-sdk/testing'
const hodi = await testPlugin('hello-world')
try {
  const answer = await hodi.route('POST /hello')
  assert.deepEqual([answer.status, answer.body], [200, { text: 'Bonjour', count: 1 }])
} finally {
  await hodi.stop()
}
`
  )
  run('node', ['check.mjs'], folder)
  // The build command too, as a plugin's own npm run build calls it.
  run('npx', ['--no-install', 'hodi-plugin', 'build'], path.join(folder, 'hello-world'))
  console.log(`${tarball}: installs on its own, its test kit runs hello-world, hodi-plugin build builds it`)
} catch (error) {
  assert.fail(`The packed SDK does not work on its own: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  rmSync(folder, { recursive: true, force: true })
}
