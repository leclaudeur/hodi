import type { Profile } from '../db/profile-store.ts'
import { slug } from '../http/source-routes.ts'
import type { SourceStore } from '../db/source-store.ts'
import type { UserStore } from '../db/user-store.ts'
import type { YouthStore } from '../db/youth-store.ts'
import type { Catalog, Source, YoungKind } from './catalog.ts'
import type { NewsService } from './news-service.ts'

// A young profile reads the sources and themes its parents turned on, and nothing else: whatever else the
// household follows is off in its preferences, and stays off whatever its devices send (lock). Its parents pick
// from sources.yml's catalogue for its kind (young, young_base) and from what it asked for.

export interface YouthSourcesOptions {
  youth: YouthStore
  news: NewsService
  store: SourceStore
  // sources.yml.
  file: Catalog
  users: (profileId: number) => UserStore
  // Every profile of the household, to turn a new source off for the others.
  profiles: () => Profile[]
  now: () => number
}

export interface CatalogueTopic {
  id: string
  label: string
  sources: { id: string; name: string; site: string; on: boolean }[]
}

const kindOf = (profile: Profile) => profile.kind as YoungKind

// The catalogue's group of YouTube channels, which has no theme: its label is the interface's.
export const CHANNELS = 'channels'

// A source's home page, from its first domain or its feed's host.
const siteOf = (source: Source) => `https://${source.domains[0] ?? new URL(source.url).hostname}/`

export class YouthSources {
  readonly #options: YouthSourcesOptions

  constructor(options: YouthSourcesOptions) {
    this.#options = options
  }

  // The themes the file shows to this kind of young reader.
  topicsFor(kind: YoungKind) {
    return this.#options.file.topics.filter(topic => topic.young?.includes(kind))
  }

  // What its parents choose from, theme by theme: the file's sources for its kind, then what it was given beyond
  // them (a source it asked for). Last, the YouTube channels it was given, under the id 'channels'.
  catalogue(profile: Profile): CatalogueTopic[] {
    const { youth, news } = this.#options
    const allowed = new Set(youth.allowedSources(profile.id))
    const kind = kindOf(profile)
    const given = news.catalog.listen.flatMap(section => section.sources).filter(source => allowed.has(source.id))
    const channels: CatalogueTopic[] =
      given.length === 0
        ? []
        : [
            {
              id: CHANNELS,
              label: '',
              sources: given.map(source => ({ id: source.id, name: source.name, site: source.url, on: true }))
            }
          ]
    return [...this.#topicsCatalogue(profile, kind, allowed), ...channels]
  }

  #topicsCatalogue(profile: Profile, kind: YoungKind, allowed: Set<string>): CatalogueTopic[] {
    const { news } = this.#options
    return this.topicsFor(kind).map(topic => {
      const own = topic.sources.filter(source => source.young?.includes(kind) || source.youngBase?.includes(kind))
      const given = (news.catalog.topics.find(candidate => candidate.id === topic.id)?.sources ?? []).filter(
        source => allowed.has(source.id) && !own.some(candidate => candidate.id === source.id)
      )
      return {
        id: topic.id,
        label: topic.label,
        sources: [...own, ...given].map(source => ({
          id: source.id,
          name: source.name,
          site: siteOf(source),
          on: allowed.has(source.id)
        }))
      }
    })
  }

  // A new young profile, or one made young: its kind's base sources, once.
  start(profile: Profile) {
    if (profile.kind === 'adult') return
    if (!this.#options.youth.hasSources(profile.id)) {
      const kind = kindOf(profile)
      const base = this.topicsFor(kind).flatMap(topic =>
        topic.sources.filter(source => source.youngBase?.includes(kind)).map(source => source.id)
      )
      this.setSources(profile, [...new Set(base)], null)
      return
    }
    this.sync(profile)
  }

  // Its parents' choice. A source of the file not yet in the household's catalogue comes in, off for everyone
  // else. byId: the parent who turned it on, who may remove it later as one it added.
  setSources(profile: Profile, ids: string[], byId: number | null) {
    const { youth } = this.#options
    const before = new Set(youth.allowedSources(profile.id))
    const kept = ids.filter(id => this.#ensure(id, byId ?? this.#adminId()))
    youth.setAllowedSources(profile.id, kept)
    this.sync(
      profile,
      kept.filter(id => !before.has(id))
    )
  }

  setHiddenTopics(profile: Profile, ids: string[]) {
    const allowed = new Set(this.topicsFor(kindOf(profile)).map(topic => topic.id))
    this.#options.youth.setHiddenTopics(
      profile.id,
      ids.filter(id => allowed.has(id))
    )
    this.sync(profile)
  }

  // What stays off for a young profile, whatever it asks: the sources and themes its parents did not turn on.
  lock(profile: Profile) {
    if (profile.kind === 'adult') return null
    const { youth, news, file } = this.#options
    const allowed = new Set(youth.allowedSources(profile.id))
    const shown = new Set(this.topicsFor(kindOf(profile)).map(topic => topic.id))
    const hiddenByParents = youth.hiddenTopics(profile.id)
    return {
      hiddenSources: news
        .getSourceStatuses()
        .map(source => source.id)
        .filter(id => !allowed.has(id)),
      hiddenTopics: [
        ...file.topics.map(topic => topic.id).filter(id => !shown.has(id)),
        ...hiddenByParents.filter(id => shown.has(id))
      ]
    }
  }

  // Writes the lock into its preferences, keeping what it turned off itself; opened: sources just turned on by its
  // parents, shown again even if it had hidden them.
  sync(profile: Profile, opened: string[] = []) {
    const lock = this.lock(profile)
    if (!lock) return
    const { youth, users, now } = this.#options
    const user = users(profile.id)
    const preferences = user.preferences() ?? {}
    const allowed = new Set(youth.allowedSources(profile.id))
    const ownSources = ((preferences.hiddenSources as string[] | undefined) ?? []).filter(
      id => allowed.has(id) && !opened.includes(id)
    )
    const ownTopics = ((preferences.hiddenTopics as string[] | undefined) ?? []).filter(
      id => !lock.hiddenTopics.includes(id)
    )
    user.setPreferences(
      {
        hiddenSources: [...new Set([...ownSources, ...lock.hiddenSources])],
        hiddenTopics: [...new Set([...ownTopics, ...lock.hiddenTopics])]
      },
      now()
    )
  }

  // Every young profile again, after the household's catalogue changed.
  syncAll() {
    this.#options
      .profiles()
      .filter(profile => profile.kind !== 'adult')
      .forEach(profile => this.sync(profile))
  }

  // A source a teen asked for, now in the catalogue (added under the topics given, or a section of "Vidéos" for a
  // channel, if it was not) and on for it.
  accept(profile: Profile, source: Source, section: 'topic' | 'listen', sectionIds: string[], byId: number) {
    const { news, store } = this.#options
    const known = store.findByUrl(source.url)
    let id = known?.id
    if (!id) {
      // Named as a source the parent added: theirs to remove. A feed another household follows keeps its id.
      const feed = store.feedOf(source.url)
      id = feed?.id ?? `p${byId}-${slug(source.name)}`
      for (let suffix = 2; !feed && store.isTaken(id); suffix++) id = `p${byId}-${slug(source.name)}-${suffix}`
      const added = { ...source, id, addedBy: byId }
      if (!news.addSource(added, section, sectionIds)) return false
      store.add(added, section, sectionIds, this.#options.now())
      this.#hideForOthers(id, profile.id)
    }
    this.setSources(profile, [...this.#options.youth.allowedSources(profile.id), id], byId)
    return true
  }

  // Whether the source is in the household's catalogue, after adding it from the file when it was not.
  #ensure(id: string, byId: number | null) {
    const { news, store, file, now } = this.#options
    if (news.getSourceStatuses().some(source => source.id === id)) return true
    const topic = file.topics.find(candidate => candidate.sources.some(source => source.id === id))
    const source = topic?.sources.find(candidate => candidate.id === id)
    if (!topic || !source || byId === null) return false
    const added = { ...source, addedBy: byId }
    if (!news.addSource(added, 'topic', [topic.id])) return false
    store.add(added, 'topic', [topic.id], now())
    this.#hideForOthers(id, null)
    return true
  }

  // A source brought in for a young profile is off for every other one (adults turn it on if they want it).
  #hideForOthers(id: string, exceptId: number | null) {
    const { users, profiles, now } = this.#options
    for (const profile of profiles()) {
      if (profile.id === exceptId) continue
      const user = users(profile.id)
      const hidden = user.hiddenSources()
      if (!hidden.includes(id)) user.setPreferences({ hiddenSources: [...hidden, id] }, now())
    }
  }

  #adminId() {
    return this.#options.profiles().find(profile => profile.role === 'admin')?.id ?? null
  }
}
