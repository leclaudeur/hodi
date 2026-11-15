import { defineConfig } from 'tsdown'

// The npm package @hodi-app/plugin-sdk, built from Hodi's own code so it never drifts from it:
//   dist/bin.mjs, dist/build.mjs  the build command, with the bits of Hodi it needs (manifest checks, digest) inside
//   dist/testing.mjs, dist/worker.mjs  the test kit: Hodi's sandbox (its worker beside it) and its plugin routes
//   dist/server.d.mts           the server part's types
//   dist/web.d.mts              hodi:sdk's types: Hodi's components and hooks as the page hands them to web.js
export default defineConfig([
  {
    entry: { bin: 'bin.ts', build: 'build.ts', testing: 'testing.ts', worker: '../server/plugins/sandbox/worker.ts' },
    outDir: 'dist',
    platform: 'node',
    format: 'esm',
    dts: { entry: ['build.ts', 'testing.ts'] },
    // Packages that read files of their own (the engines' .wasm, sharp's native binary for the platform) or that Node
    // loads as they are: installed beside.
    deps: {
      neverBundle: [
        'sharp',
        'vite',
        'tar',
        'express',
        'express-rate-limit',
        'quickjs-emscripten',
        'node-sqlite3-wasm',
        'undici',
        /^@jitl\//
      ]
    },
    tsconfig: '../tsconfig.server.json'
  },
  {
    entry: { server: 'server.ts', web: 'web.ts' },
    outDir: 'dist',
    clean: false,
    dts: { emitDtsOnly: true },
    tsconfig: '../tsconfig.plugins.json'
  }
])
