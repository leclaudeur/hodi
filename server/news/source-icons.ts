import type { StoredIcon } from '../db/media-queries.ts'
import { type Catalog, type Source, allSources } from './catalog.ts'
import type { FetchBytes, FetchText } from './fetch-text.ts'
import { siteNameOf } from './source-name.ts'
import { decodeEntities } from './text.ts'

// Each source's icon for its avatar, fetched once from its site and kept: the app falls back to the
// source's initials when there is none.

// Found again after this long, in case the site changed it; a site with none is asked again sooner.
const ICON_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ICON_BYTES = 256 * 1024
const MAX_CANDIDATES = 4

export interface Icon {
  contentType: string
  data: Uint8Array
}

export interface IconStore {
  getIcon: (sourceId: string) => StoredIcon | null
  saveIcon: (sourceId: string, icon: StoredIcon) => void
}

export interface SourceIconsOptions {
  fetchText: FetchText
  fetchBytes: FetchBytes
  // Absent in tests: icons then live in memory only.
  store?: IconStore
  now?: () => number
  log?: (message: string) => void
  // The name the home page gives the site, for a source that has none yet (see nameFromSite).
  siteName?: { wanted: (source: Source) => boolean; found: (source: Source, name: string) => void }
}

// The type is read from the bytes, never from the site's headers: only these images are served.
const SIGNATURES: { type: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { type: 'image/png', matches: bytes => [0x89, 0x50, 0x4e, 0x47].every((byte, index) => bytes[index] === byte) },
  { type: 'image/x-icon', matches: bytes => [0x00, 0x00, 0x01, 0x00].every((byte, index) => bytes[index] === byte) },
  { type: 'image/jpeg', matches: bytes => [0xff, 0xd8, 0xff].every((byte, index) => bytes[index] === byte) },
  { type: 'image/gif', matches: bytes => [0x47, 0x49, 0x46, 0x38].every((byte, index) => bytes[index] === byte) },
  {
    type: 'image/webp',
    matches: bytes =>
      Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' &&
      Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP'
  }
]

export const imageType = (bytes: Uint8Array) => SIGNATURES.find(signature => signature.matches(bytes))?.type ?? null

// Icons are fetched from public sites only: no plain http, no IP address, no local name.
const isPublicUrl = (url: URL) =>
  url.protocol === 'https:' &&
  !/^\[|^\d+(\.\d+){3}$/.test(url.hostname) &&
  !/(^|\.)(localhost|local|internal|lan|home|ts\.net)$/i.test(url.hostname) &&
  url.hostname.includes('.')

const attributes = (tag: string) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [
      (match[1] ?? '').toLowerCase(),
      decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
    ])
  )

// The icons a home page declares, the largest first. SVG and Safari's mask icons are left out.
export const declaredIcons = (html: string, pageUrl: string): string[] =>
  [...html.matchAll(/<link\b[^>]*>/gi)]
    .map(match => attributes(match[0]))
    .filter(link => {
      const rel = (link.rel ?? '').toLowerCase().split(/\s+/)
      return (
        (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) &&
        !rel.includes('mask-icon') &&
        !(link.type ?? '').includes('svg') &&
        link.href
      )
    })
    .flatMap(link => {
      try {
        const url = new URL(link.href ?? '', pageUrl)
        if (url.pathname.toLowerCase().endsWith('.svg')) return []
        const size = Math.max(0, ...[...(link.sizes ?? '').matchAll(/(\d+)x\d+/gi)].map(size => Number(size[1])))
        // Apple touch icons are 180 px when no size is given.
        const rel = (link.rel ?? '').toLowerCase()
        return [{ url: url.toString(), size: size || (rel.includes('apple-touch-icon') ? 180 : 16) }]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.size - a.size)
    .map(icon => icon.url)

export class SourceIcons {
  readonly #catalog: Catalog
  readonly #fetchText: FetchText
  readonly #fetchBytes: FetchBytes
  readonly #store: IconStore | undefined
  readonly #now: () => number
  readonly #log: (message: string) => void
  readonly #memory = new Map<string, StoredIcon>()
  readonly #pending = new Map<string, Promise<StoredIcon>>()
  readonly #siteName: SourceIconsOptions['siteName']
  // Sources whose home page was read for a name since Hodi started: asked once each.
  readonly #named = new Set<string>()

  constructor(
    catalog: Catalog,
    { fetchText, fetchBytes, store, now = Date.now, log = console.warn, siteName }: SourceIconsOptions
  ) {
    this.#siteName = siteName
    this.#catalog = catalog
    this.#fetchText = fetchText
    this.#fetchBytes = fetchBytes
    this.#store = store
    this.#now = now
    this.#log = log
  }

  // undefined: no such source. null: its site has no icon.
  async get(sourceId: string): Promise<Icon | null | undefined> {
    const source = allSources(this.#catalog).find(candidate => candidate.id === sourceId)
    if (!source) return undefined

    const known = this.#memory.get(sourceId) ?? this.#store?.getIcon(sourceId) ?? null
    const ttl = known?.data ? ICON_TTL_MS : MISSING_TTL_MS
    const fresh = known && known.fetchedAt > this.#now() - ttl
    // An icon kept from before: the home page is still read once for the site's name.
    if (fresh) void this.#readName(source)
    const icon = fresh ? known : await this.#refresh(source, known)

    return icon.data && icon.contentType ? { contentType: icon.contentType, data: icon.data } : null
  }

  #refresh(source: Source, known: StoredIcon | null) {
    const pending = this.#pending.get(source.id)
    if (pending) return pending

    const refresh = this.#find(source)
      .then(found => found ?? { contentType: null, data: null })
      .catch((error: unknown) => {
        this.#log(`Icon of ${source.id} failed: ${error instanceof Error ? error.message : String(error)}`)
        // The site did not answer: the icon it had stays, and it is asked again later.
        return { contentType: known?.contentType ?? null, data: known?.data ?? null }
      })
      .then(found => {
        const icon: StoredIcon = { ...found, fetchedAt: this.#now() }
        this.#memory.set(source.id, icon)
        this.#store?.saveIcon(source.id, icon)
        return icon
      })
      .finally(() => this.#pending.delete(source.id))

    this.#pending.set(source.id, refresh)
    return refresh
  }

  #wantsName(source: Source) {
    return !!this.#siteName?.wanted(source) && !this.#named.has(source.id)
  }

  #takeName(source: Source, html: string) {
    if (!this.#wantsName(source)) return
    this.#named.add(source.id)
    const name = siteNameOf(html)
    if (name) this.#siteName!.found(source, name)
  }

  async #readName(source: Source) {
    const domain = source.domains[0]
    if (!domain || !this.#wantsName(source)) return
    try {
      const page = await this.#fetchText(`https://${domain}/`)
      this.#takeName(source, page.text)
    } catch {
      // The site did not answer: its name is asked again at the next start.
    }
  }

  // The home page's own icons first, then the usual places.
  async #find(source: Source): Promise<{ contentType: string; data: Uint8Array } | null> {
    const domain = source.domains[0]
    if (!domain) return null
    const home = `https://${domain}/`

    let reached = true
    const declared = await this.#fetchText(home).then(
      page => {
        this.#takeName(source, page.text)
        return declaredIcons(page.text, page.url)
      },
      () => {
        reached = false
        return []
      }
    )
    const candidates = [...new Set([...declared, `${home}apple-touch-icon.png`, `${home}favicon.ico`])]
      .filter(candidate => isPublicUrl(new URL(candidate)))
      .slice(0, MAX_CANDIDATES)

    for (const candidate of candidates) {
      try {
        const { url, bytes } = await this.#fetchBytes(candidate, { maxBytes: MAX_ICON_BYTES })
        const contentType = imageType(bytes)
        if (contentType && isPublicUrl(new URL(url))) return { contentType, data: new Uint8Array(bytes) }
      } catch {
        // Not there: the next place may have it.
      }
    }

    // Nothing answered at all: the site is down, not without an icon.
    if (!reached) throw new Error(`${home} did not answer`)
    return null
  }
}
