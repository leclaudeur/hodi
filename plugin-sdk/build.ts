import { sign } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import path from 'node:path'
import { create } from 'tar'
import { build } from 'vite'
import { parseManifest } from '../server/plugins/manifest.ts'
import { packageDigest } from '../server/plugins/package.ts'

// Turns a plugin's source folder into a .hodi-plugin that Serveur › Plugins installs:
//   plugin.json          what it is (server/plugins/manifest.ts), copied as is
//   server/index.ts      its server part, bundled into server.js (an ES module)
//   web/index.tsx        its web part, bundled into web.js (a script reading Hodi's React and hodi:sdk), and web.css
//   web/public.tsx       its places before sign-in, bundled into web-public.js and web-public.css
//   locales/, assets/    copied as they are
// With a private key (ed25519, PEM), the package is signed: Hodi says "Vérifié" when it trusts that key.

// What a plugin's web.js takes from the page instead of bundling (see web/src/plugins/host.ts).
const WEB_GLOBALS: Record<string, string> = {
  react: '__hodi.react',
  'react/jsx-runtime': '__hodi.jsxRuntime',
  'react-dom': '__hodi.reactDom',
  'hodi:sdk': '__hodi.sdk'
}

const firstOf = (dir: string, names: string[]) =>
  names.map(name => path.join(dir, name)).find(file => existsSync(file)) ?? null

export interface BuiltPlugin {
  id: string
  version: string
  // The .hodi-plugin file.
  file: string
  signed: boolean
}

export const buildPlugin = async (
  source: string,
  { out = path.join(source, 'dist'), key }: { out?: string; key?: string } = {}
): Promise<BuiltPlugin> => {
  const manifest = parseManifest(JSON.parse(readFileSync(path.join(source, 'plugin.json'), 'utf8')))
  const stage = path.join(out, manifest.id)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  cpSync(path.join(source, 'plugin.json'), path.join(stage, 'plugin.json'))

  const server = firstOf(source, ['server/index.ts', 'server/index.js'])
  if (server) {
    await build({
      configFile: false,
      logLevel: 'warn',
      // Its packages go into server.js: a plugin's folder has no node_modules. Node's own modules are refused: the
      // server part runs in its sandbox, where only its ctx reaches outside.
      ssr: { noExternal: true },
      plugins: [
        {
          name: 'hodi-no-node',
          enforce: 'pre',
          resolveId(id, importer) {
            // The bundler's own runtime may name one for packages written for Node; whatever stays in server.js is
            // checked below.
            if (isBuiltin(id) && importer && !importer.includes('rolldown/runtime')) {
              this.error(`${id}: a plugin's server part cannot use Node's modules, only its ctx`)
            }
          }
        }
      ],
      build: {
        ssr: server,
        outDir: stage,
        emptyOutDir: false,
        minify: false,
        rollupOptions: { output: { format: 'es', entryFileNames: 'server.js' } }
      }
    })
    // The sandbox loads server.js alone: an import left in it (a Node module a package asked for) would not load.
    const bundled = readFileSync(path.join(stage, 'server.js'), 'utf8')
    const left =
      /^\s*import\s[^;]*?from\s*["']([^"']+)["']/m.exec(bundled) ?? /\brequire\(\s*["']([^"']+)["']\s*\)/.exec(bundled)
    if (left) throw new Error(`server.js still imports ${left[1]}: a plugin's server part cannot use Node's modules`)
  }

  // web/index.tsx becomes web.js, for those signed in; web/public.tsx becomes web-public.js, what a visitor may
  // download (its places before sign-in).
  const webBuilds = [
    { entry: firstOf(source, ['web/index.tsx', 'web/index.ts']), name: 'web' },
    { entry: firstOf(source, ['web/public.tsx', 'web/public.ts']), name: 'web-public' }
  ]
  for (const { entry: web, name } of webBuilds) {
    if (!web) continue
    await build({
      configFile: false,
      logLevel: 'warn',
      // Production React and no process.env left in the bundle: it runs in the browser.
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: stage,
        emptyOutDir: false,
        cssCodeSplit: false,
        lib: { entry: web, formats: ['iife'], name: '__hodiPlugin', fileName: () => `${name}.js`, cssFileName: name },
        rollupOptions: { external: Object.keys(WEB_GLOBALS), output: { globals: WEB_GLOBALS } }
      }
    })
  }

  for (const folder of ['locales', 'assets']) {
    if (existsSync(path.join(source, folder)))
      cpSync(path.join(source, folder), path.join(stage, folder), { recursive: true })
  }

  // The signature covers every other file, as Hodi checks it (server/plugins/package.ts).
  if (key) writeFileSync(path.join(stage, 'signature'), sign(null, packageDigest(stage), key).toString('base64'))

  const file = path.join(out, `${manifest.id}-${manifest.version}.hodi-plugin`)
  await create({ gzip: true, file, cwd: stage, portable: true }, ['.'])
  return { id: manifest.id, version: manifest.version, file, signed: Boolean(key) }
}
