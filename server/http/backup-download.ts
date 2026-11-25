import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream'
import type express from 'express'
import { Zip, ZipPassThrough } from 'fflate'
import { pluginCopyDir, readPluginManifest } from '../db/plugin-backup.ts'
import { CONFIG } from '../fixed-config.ts'

// Serveur › Sauvegardes › Télécharger: the link the password makes, and the copy it sends.

// Few links wait at once: each is made by a checked password, and an unused one is dropped when it ends.
const MAX_LINKS = 20

interface Link {
  name: string
  accountId: number
  until: number
}

// Links that work once, for the account that asked, within CONFIG.backups.downloadLink.
export const downloadLinks = (now: () => number) => {
  const links = new Map<string, Link>()
  const dropEnded = () => {
    for (const [token, link] of links) if (link.until <= now()) links.delete(token)
  }
  return {
    make: (name: string, accountId: number) => {
      dropEnded()
      // The oldest goes first when too many wait.
      if (links.size >= MAX_LINKS) links.delete(links.keys().next().value!)
      const token = randomBytes(32).toString('base64url')
      links.set(token, { name, accountId, until: now() + CONFIG.backups.downloadLink })
      return token
    },
    take: (token: string, accountId: number) => {
      const link = links.get(token)
      if (!link) return null
      links.delete(token)
      return link.accountId === accountId && link.until > now() ? link.name : null
    }
  }
}

// Files sent as one zip as they are read, stored without compression (databases): what was written leaves before more
// is read. A failure once bytes have left ends the download, which the browser shows as failed.
const sendFilesAsZip = async (response: express.Response, files: { path: string; file: string }[]) => {
  let failed = false
  const archive = new Zip((error, chunk, final) => {
    if (error || failed) {
      failed = true
      response.destroy()
      return
    }
    response.write(chunk)
    if (final) response.end()
  })
  try {
    for (const { path: name, file } of files) {
      const entry = new ZipPassThrough(name)
      archive.add(entry)
      let last: Buffer | null = null
      for await (const chunk of createReadStream(file)) {
        if (last) entry.push(last)
        last = chunk as Buffer
        if (response.writableNeedDrain) await new Promise(resolve => response.once('drain', resolve))
        if (response.destroyed) throw new Error('closed')
      }
      entry.push(last ?? new Uint8Array(0), true)
    }
    archive.end()
  } catch {
    failed = true
    response.destroy()
  }
}
// The copy alone when no plugin's data was copied with it, its size known so the browser shows the progress; else one
// zip with each plugin's database, as they are on the server.
export const sendCopy = async (response: express.Response, dir: string, name: string) => {
  response.set('Cache-Control', 'no-store')
  const file = path.join(dir, name)
  const plugins = pluginCopyDir(file)
  const manifest = existsSync(plugins) ? readPluginManifest(plugins) : null
  const pluginFiles = (manifest?.plugins ?? []).flatMap(id =>
    [`${id}.db`, `${id}.db-journal`]
      .map(entry => ({ path: `plugins/${entry}`, file: path.join(plugins, entry) }))
      .filter(entry => existsSync(entry.file))
  )
  if (pluginFiles.length === 0) {
    response.set('Content-Type', 'application/vnd.sqlite3')
    response.set('Content-Length', String(statSync(file).size))
    response.set('Content-Disposition', `attachment; filename="${name}"`)
    // A copy pruned meanwhile ends the download instead of an error nobody listens to.
    pipeline(createReadStream(file), response, () => {})
    return
  }
  const files = [
    { path: name, file },
    { path: 'plugins/copy.json', file: path.join(plugins, 'copy.json') },
    ...pluginFiles
  ]
  response.set('Content-Type', 'application/zip')
  response.set('Content-Disposition', `attachment; filename="${name.replace(/\.db$/, '.zip')}"`)
  await sendFilesAsZip(response, files)
}
