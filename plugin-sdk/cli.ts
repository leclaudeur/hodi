import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildPlugin } from './build.ts'
import { runDev } from './dev.ts'

// hodi-plugin build [plugin folder] [--key private.pem] (or hodi-plugin dev, see dev.ts): the folder defaults to the current one, as in a plugin's
// own repository (hodi-plugin-template). In Hodi's repository: npm run plugin:build -- path/to/plugin.
const usage = 'Usage: hodi-plugin build [plugin folder] [--key private.pem]'

export const run = async (args: string[]) => {
  // hodi-plugin dev: see dev.ts.
  if (args[0] === 'dev') return runDev(args.slice(1))
  // "build" may be left out.
  const rest = args[0] === 'build' ? args.slice(1) : args
  const keyAt = rest.indexOf('--key')
  const keyFile = keyAt === -1 ? undefined : rest[keyAt + 1]
  if (keyAt !== -1 && !keyFile) throw new Error(usage)
  const folders = rest.filter((_arg, index) => keyAt === -1 || (index !== keyAt && index !== keyAt + 1))
  if (folders.length > 1 || folders.some(folder => folder.startsWith('-'))) throw new Error(usage)
  const built = await buildPlugin(path.resolve(folders[0] ?? '.'), {
    key: keyFile ? readFileSync(keyFile, 'utf8') : undefined
  })
  console.log(`${built.signed ? 'Signed' : 'Unsigned'} package: ${path.relative(process.cwd(), built.file)}`)
}
