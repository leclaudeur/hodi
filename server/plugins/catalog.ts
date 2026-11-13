import { createHash } from 'node:crypto'
import type { FetchBytes, FetchText } from '../news/fetch-text.ts'
import { PLUGIN_API, VERSION } from './manifest.ts'
import type { ManifestTranslations } from './manifest-texts.ts'
import { MAX_PACKAGE_BYTES } from './package.ts'

// Hodi's plugin registry (github.com/leclaudeur/hodi-plugin-registry): an index of plugins, each pinned to one release
// file by its sha256. The maintainer reviews every entry before it is listed.
export const CATALOG_URL = 'https://raw.githubusercontent.com/leclaudeur/hodi-plugin-registry/main/plugins.json'

// The registry changes a few times a month: one read per ten minutes is plenty.
const CACHE_MS = 10 * 60 * 1000

export interface CatalogEntry {
  id: string
  name: string
  description: string
  translations: ManifestTranslations
  repo: string
  version: string
  url: string
  sha256: string
}

export type CatalogErrorCode = 'catalog_unavailable' | 'not_found' | 'download_failed' | 'checksum_mismatch'

export class CatalogError extends Error {
  readonly code: CatalogErrorCode

  constructor(code: CatalogErrorCode) {
    super(code)
    this.code = code
  }
}

const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max

const translationsOf = (value: unknown): ManifestTranslations => {
  if (!value || typeof value !== 'object') return {}
  const kept: ManifestTranslations = {}
  for (const [language, entry] of Object.entries(value as Record<string, Record<string, unknown>>)) {
    if (!/^[a-z]{2}$/.test(language) || !entry || typeof entry !== 'object') continue
    const name = text(entry.name, 60) ? (entry.name as string) : undefined
    const description = text(entry.description, 280) ? (entry.description as string) : undefined
    if (name || description) kept[language] = { ...(name && { name }), ...(description && { description }) }
  }
  return kept
}

// An entry Hodi can install: written for its plugin API, its file a release of its own GitHub repository, and its
// sha256 given. Anything else is left out rather than trusted.
const entryOf = (raw: unknown): CatalogEntry | null => {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const { id, name, description, repo, version, url, sha256, api } = entry
  if (api !== PLUGIN_API || typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(id)) return null
  if (!text(name, 60) || !text(description, 280) || typeof version !== 'string' || !VERSION.test(version)) return null
  if (typeof repo !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo)) return null
  if (
    typeof url !== 'string' ||
    !url.startsWith(`${repo}/releases/download/v${version}/`) ||
    !url.endsWith('.hodi-plugin')
  )
    return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  return {
    id,
    name: name as string,
    description: description as string,
    translations: translationsOf(entry.translations),
    repo,
    version,
    url,
    sha256
  }
}

interface PluginCatalogOptions {
  fetchText: FetchText
  fetchBytes: FetchBytes
  url?: string
  now?: () => number
}

// Serveur › Plugins › Disponibles: the registry's entries, and one of their files downloaded and checked against the
// sha256 the maintainer reviewed, before Hodi reads it as a package sent by hand.
export class PluginCatalog {
  readonly #options: Required<PluginCatalogOptions>
  #cached: { at: number; entries: CatalogEntry[] } | null = null

  constructor(options: PluginCatalogOptions) {
    this.#options = { url: CATALOG_URL, now: Date.now, ...options }
  }

  async list(): Promise<CatalogEntry[]> {
    const { fetchText, url, now } = this.#options
    if (this.#cached && now() - this.#cached.at < CACHE_MS) return this.#cached.entries
    let parsed: unknown
    try {
      parsed = JSON.parse((await fetchText(url)).text)
    } catch {
      throw new CatalogError('catalog_unavailable')
    }
    const raw = (parsed as { plugins?: unknown } | null)?.plugins
    if (!Array.isArray(raw)) throw new CatalogError('catalog_unavailable')
    const entries = raw.map(entryOf).filter(entry => entry !== null)
    this.#cached = { at: now(), entries }
    return entries
  }

  async download(id: string): Promise<{ entry: CatalogEntry; bytes: Buffer }> {
    const entry = (await this.list()).find(listed => listed.id === id)
    if (!entry) throw new CatalogError('not_found')
    let bytes: Buffer
    try {
      bytes = (await this.#options.fetchBytes(entry.url, { maxBytes: MAX_PACKAGE_BYTES })).bytes
    } catch {
      throw new CatalogError('download_failed')
    }
    // The release file can be replaced on GitHub after the review: only the reviewed one is installed.
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new CatalogError('checksum_mismatch')
    return { entry, bytes }
  }
}
