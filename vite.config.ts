import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { brotliCompress, constants } from 'node:zlib'
import { type Plugin, defineConfig } from 'vite'

// Réglages › À propos shows the version of package.json.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// The fonts every first screen uses (latin subsets of Geist, Geist Mono and Bebas Neue) are only found once the CSS
// is parsed. Preloading them from the page starts their download with the CSS instead of after it, so the text does
// not wait or jump.
const FIRST_SCREEN_FONTS =
  /^assets\/(geist-latin-wght|geist-mono-latin-wght|bebas-neue-latin-400)-normal-[\w-]+\.woff2$/

const preloadFonts = (): Plugin => ({
  name: 'hodi-preload-fonts',
  apply: 'build',
  transformIndexHtml(_html, context) {
    return Object.keys(context.bundle ?? {})
      .filter(fileName => FIRST_SCREEN_FONTS.test(fileName))
      .map(fileName => ({
        tag: 'link',
        attrs: { rel: 'preload', href: `/${fileName}`, as: 'font', type: 'font/woff2', crossorigin: '' },
        injectTo: 'head'
      }))
  }
})

// Each script and style sheet also written brotli-compressed at the highest level, which takes too long to do on each
// request: the server sends the .br file to browsers that accept it (server/app.ts).
const precompress = (): Plugin => ({
  name: 'hodi-precompress',
  apply: 'build',
  async writeBundle(options, bundle) {
    const compress = promisify(brotliCompress)
    const files = Object.values(bundle).filter(file => /\.(js|css)$/.test(file.fileName))
    await Promise.all(
      files.map(async file => {
        const source = file.type === 'chunk' ? file.code : file.source
        const compressed = await compress(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
        await writeFile(path.join(options.dir ?? '', `${file.fileName}.br`), compressed)
      })
    )
  }
})

export default defineConfig({
  root: 'web',
  plugins: [react(), preloadFonts(), precompress()],
  define: {
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // The code every start needs in one file: split in two dozen small ones, a browser on plain HTTP (6
        // connections) waits for them in turns. Screens loaded on demand keep their own files.
        codeSplitting: { groups: [{ name: 'app', tags: ['$initial'] }] }
      }
    }
  },
  server: {
    // Forward API calls to a locally running server during development.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      '/health': 'http://127.0.0.1:3000'
    }
  }
})
