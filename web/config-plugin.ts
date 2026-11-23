import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { parseConfig } from '../shared/config-file.ts'
import { webShare } from '../shared/config-web.ts'

const ID = 'virtual:hodi-config'
const RESOLVED = `\0${ID}`

// The web app's share of config.yml, read when the app is built (or served for development): `virtual:hodi-config`
// is the file checked whole, then cut to the groups the app reads (shared/config-web.ts). A change shows after the
// next build.
export const hodiConfig = (file: string): Plugin => ({
  name: 'hodi-config',
  resolveId: id => (id === ID ? RESOLVED : null),
  load(id) {
    if (id !== RESOLVED) return null
    this.addWatchFile(file)
    return `export default ${JSON.stringify(webShare(parseConfig(readFileSync(file, 'utf8'))))}`
  }
})
