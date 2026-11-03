import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { type Labelled, parseLabels } from '../labels.ts'

export type SourceKind = 'article' | 'video' | 'podcast'
export type Language = 'fr' | 'en'
// The young profiles' kinds (see db/profile-store.ts).
export type YoungKind = 'teen' | 'child'

export interface Source {
  id: string
  name: string
  url: string
  kind: SourceKind
  lang: Language
  // Hosts whose article pages Hodi may fetch for this source (subdomains included).
  domains: string[]
  // false: articles never open in the reader (consent wall...); the app shows the
  // summary with a link to the site instead of hiding them.
  reader: boolean
  // Paths whose pages are not articles (France 24's /fr/vidéo/): left out of the lists, never fetched.
  skip: string[]
  // The profile that added it ("Ajouter une source"); missing for the base sources every new profile starts with.
  addedBy?: number
  // sources.yml: the household languages it is a base source for, seeded for the whole household when it is set
  // up in one of them; the others are only offered ("Sources proposées") until a profile adds them.
  base?: Language[]
  // sources.yml: the young profiles' catalogue it is in, for their parents to turn on (Réglages > Profils > Gérer).
  young?: YoungKind[]
  // sources.yml: the young profiles of these kinds start with it on.
  youngBase?: YoungKind[]
  // sources.yml: false for a source made for young readers, never offered to the adults.
  adults?: false
}

export interface Topic extends Labelled {
  id: string
  sources: Source[]
  // sources.yml: the young profiles that see it at all; missing, none.
  young?: YoungKind[]
}

// A group of channels in "Écouter et regarder" (Actu, Science...).
export interface ListenSection extends Labelled {
  id: string
  sources: Source[]
}

export interface Catalog {
  topics: Topic[]
  // "Écouter et regarder": videos and podcasts, outside the topic tabs.
  listen: ListenSection[]
}

const ID_PATTERN = /^[a-z0-9-]+$/
const KINDS: SourceKind[] = ['article', 'video', 'podcast']
const LANGUAGES: Language[] = ['fr', 'en']
const YOUNG_KINDS: YoungKind[] = ['teen', 'child']

const youngKindsOf = (value: unknown, where: string) =>
  value === undefined
    ? []
    : asList(value, where).map((kind, index) =>
        YOUNG_KINDS.includes(kind as YoungKind)
          ? (kind as YoungKind)
          : fail(`${where}[${index}]`, `expected one of ${YOUNG_KINDS.join(', ')}`)
      )

const fail = (where: string, message: string): never => {
  throw new Error(`sources: ${where}: ${message}`)
}

const asRecord = (value: unknown, where: string) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail(where, 'expected a mapping')

const asString = (value: unknown, where: string) =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : fail(where, 'expected a non-empty string')

const asList = (value: unknown, where: string) => (Array.isArray(value) ? value : fail(where, 'expected a list'))

const parseSource = (value: unknown, where: string, defaultKind: SourceKind): Source => {
  const raw = asRecord(value, where)
  const id = asString(raw.id, `${where}.id`)
  const url = asString(raw.url, `${where}.url`)
  const kind = (raw.kind ?? defaultKind) as SourceKind
  const lang = (raw.lang ?? 'fr') as Language

  if (!ID_PATTERN.test(id)) fail(`${where}.id`, 'use lowercase letters, digits and dashes')
  if (!KINDS.includes(kind)) fail(`${where}.kind`, `expected one of ${KINDS.join(', ')}`)
  if (!LANGUAGES.includes(lang)) fail(`${where}.lang`, `expected one of ${LANGUAGES.join(', ')}`)
  if (new URL(url).protocol !== 'https:') fail(`${where}.url`, 'feeds must use https')

  const domains = (raw.domains === undefined ? [] : asList(raw.domains, `${where}.domains`)).map((domain, index) =>
    asString(domain, `${where}.domains[${index}]`).toLowerCase()
  )

  const reader =
    raw.reader === undefined || raw.reader === true
      ? true
      : raw.reader === false
        ? false
        : fail(`${where}.reader`, 'expected true or false')

  if (kind === 'article' && reader && domains.length === 0) {
    fail(`${where}.domains`, 'article sources need at least one domain to read articles from')
  }

  const skip = (raw.skip === undefined ? [] : asList(raw.skip, `${where}.skip`)).map((prefix, index) => {
    const path = asString(prefix, `${where}.skip[${index}]`)
    return path.startsWith('/') ? path : fail(`${where}.skip[${index}]`, 'expected a path starting with /')
  })

  const base =
    raw.base === undefined
      ? []
      : asList(raw.base, `${where}.base`).map((value, index) =>
          LANGUAGES.includes(value as Language)
            ? (value as Language)
            : fail(`${where}.base[${index}]`, `expected one of ${LANGUAGES.join(', ')}`)
        )

  const young = youngKindsOf(raw.young, `${where}.young`)
  const youngBase = youngKindsOf(raw.young_base, `${where}.young_base`)
  if (raw.adults !== undefined && raw.adults !== false) fail(`${where}.adults`, 'expected false, or nothing')

  return {
    id,
    name: asString(raw.name, `${where}.name`),
    url,
    kind,
    lang,
    domains,
    reader,
    skip,
    ...(base.length > 0 ? { base } : {}),
    ...(young.length > 0 ? { young } : {}),
    ...(youngBase.length > 0 ? { youngBase } : {}),
    ...(raw.adults === false ? { adults: false as const } : {})
  }
}

export const parseCatalog = (yamlText: string): Catalog => {
  const root = asRecord(parse(yamlText), 'root')
  const ids = new Set<string>()

  const unique = (source: Source, where: string) => {
    if (ids.has(source.id)) fail(where, `duplicate source id ${source.id}`)
    ids.add(source.id)
    return source
  }

  const topics = asList(root.topics, 'topics').map((value, topicIndex) => {
    const where = `topics[${topicIndex}]`
    const raw = asRecord(value, where)
    const id = asString(raw.id, `${where}.id`)

    if (!ID_PATTERN.test(id)) fail(`${where}.id`, 'use lowercase letters, digits and dashes')
    const young = youngKindsOf(raw.young, `${where}.young`)

    return {
      id,
      ...parseLabels(raw.label, `${where}.label`, fail),
      sources: asList(raw.sources, `${where}.sources`).map((source, index) =>
        unique(parseSource(source, `${where}.sources[${index}]`, 'article'), `${where}.sources[${index}]`)
      ),
      ...(young.length > 0 ? { young } : {})
    }
  })

  if (new Set(topics.map(topic => topic.id)).size !== topics.length) fail('topics', 'duplicate topic id')

  const listen = asList(root.listen ?? [], 'listen').map((value, sectionIndex) => {
    const where = `listen[${sectionIndex}]`
    const raw = asRecord(value, where)
    const id = asString(raw.id, `${where}.id`)

    if (!ID_PATTERN.test(id)) fail(`${where}.id`, 'use lowercase letters, digits and dashes')

    return {
      id,
      ...parseLabels(raw.label, `${where}.label`, fail),
      sources: asList(raw.sources, `${where}.sources`).map((source, index) => {
        const parsed = parseSource(source, `${where}.sources[${index}]`, 'video')

        if (parsed.kind === 'article') fail(`${where}.sources[${index}].kind`, 'expected video or podcast')

        return unique(parsed, `${where}.sources[${index}]`)
      })
    }
  })

  if (new Set(listen.map(section => section.id)).size !== listen.length) fail('listen', 'duplicate section id')

  return { topics, listen }
}

export const listenSources = (catalog: Catalog) => catalog.listen.flatMap(section => section.sources)

// Each source once, even one listed in several topics.
export const allSources = (catalog: Catalog) => [
  ...new Map(
    [...catalog.topics.flatMap(topic => topic.sources), ...listenSources(catalog)].map(source => [source.id, source])
  ).values()
]

export const loadCatalog = (file: string) => parseCatalog(readFileSync(file, 'utf8'))

// A link under one of the source's skipped paths, compared decoded: "/fr/vid%C3%A9o/…" is "/fr/vidéo/…".
export const isSkipped = (source: Source, link: string) => {
  if (source.skip.length === 0) return false
  try {
    const path = decodeURIComponent(new URL(link).pathname)
    return source.skip.some(prefix => path.startsWith(prefix))
  } catch {
    return false
  }
}

export const isAllowedHost = (source: Source, url: URL) => {
  const host = url.hostname.toLowerCase()
  return url.protocol === 'https:' && source.domains.some(domain => host === domain || host.endsWith(`.${domain}`))
}
