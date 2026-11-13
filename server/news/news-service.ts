import type { Catalog, Language, Source } from './catalog.ts'
import { allSources } from './catalog.ts'
import type { PluginQuestion } from './summarizer.ts'
import type { AiCallKind } from '../db/ai-queries.ts'
import type { NewsStore } from '../db/news-store.ts'
import type { Trend } from './trends.ts'
import { labelIn } from '../labels.ts'
import { VideoLengths } from './video-lengths.ts'
import { CheckQueue } from './check-queue.ts'
import { CACHE_TTL_MS, FeedCache } from './feed-cache.ts'
import { AI_CAPS, type AiUsage } from './ai-ledger.ts'
import { NO_FILTER, type ReaderFilter, filtered } from './reader-filter.ts'
import type {
  AiTools,
  ArticleResult,
  DayFeed,
  FrontPage,
  ListenFeed,
  NewsServiceOptions,
  SearchItem,
  SearchResult,
  TopicFeed
} from './news-types.ts'
import { currentHouseholdId, inHousehold } from '../db/household-scope.ts'
import { ArticleLoader } from './article-loader.ts'
import { type NewsAi, createNewsAi } from './news-ai.ts'
import { DAY_MS, MAX_TOPIC_LIMIT, TopicLister } from './topic-lister.ts'
import { PerHousehold } from './per-household.ts'
import { NewsSearch } from './news-search.ts'
import { addToCatalog, moveToTopics, removeFromCatalog } from './catalog-edits.ts'
import { frontSection } from './front-page.ts'

// Feeds and checks are cached in memory for a short time; the store, when given, keeps articles,
// verdicts, reader text and AI output beyond a restart.
// Older articles are left out: the news would be outdated.
const TOPIC_WINDOW_MS = 72 * 60 * 60 * 1000
// Videos and episodes older than this are left out of "Écouter et regarder".
const LISTEN_WINDOW_MS = 60 * 24 * 60 * 60 * 1000
// Articles per page of a topic: the app asks for more with "Charger plus".
export const TOPIC_PAGE_SIZE = 30
export { MAX_TOPIC_LIMIT }
// "À la une": taken from the last day when a topic has enough stories there.
const FRONT_PAGE_WINDOW_MS = 24 * 60 * 60 * 1000
// The profile of a call made without one (tests, and the server before profiles).
const DEFAULT_PROFILE_ID = 1
const BACKGROUND_INTERVAL_MS = CACHE_TTL_MS

export class NewsService {
  // Each household's catalogue: the topics and the sources it follows.
  readonly #catalogs: PerHousehold<Catalog>
  readonly #households: () => number[]
  readonly #videoLengths: VideoLengths | null
  readonly #timeZones: PerHousehold<string>
  readonly #now: () => number
  readonly #store: NewsStore | undefined
  readonly #languageOf: (profileId: number) => Language
  readonly #feeds: FeedCache
  readonly #checks: CheckQueue
  readonly #loader: ArticleLoader
  readonly #newsAi: NewsAi
  readonly #lister: TopicLister
  readonly #search: NewsSearch
  #backgroundTimer: NodeJS.Timeout | null = null

  constructor(
    catalog: Catalog,
    {
      fetchText,
      extractPage,
      readPluginFeed,
      catalogOf,
      aiOf,
      timeZoneOf,
      households = () => [currentHouseholdId()],
      fetchVideoDuration,
      summarize,
      writeDailySummary,
      answerQuestion,
      suggestSources,
      store,
      isPaused = () => false,
      profiles = () => [{ id: DEFAULT_PROFILE_ID, admin: true }],
      aiCaps = AI_CAPS,
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
      languageOf = () => 'fr',
      householdLanguage = () => 'fr',
      windows = () => ({ articleDays: TOPIC_WINDOW_MS / DAY_MS, videoDays: LISTEN_WINDOW_MS / DAY_MS }),
      now = Date.now,
      log = console.warn
    }: NewsServiceOptions
  ) {
    this.#catalogs = new PerHousehold(() => (catalogOf ? catalogOf() : { topics: [], listen: [] }))
    this.#catalogs.set(catalog)
    this.#households = households
    this.#videoLengths = store && fetchVideoDuration ? new VideoLengths({ store, fetchVideoDuration, now, log }) : null
    this.#timeZones = new PerHousehold(() => (timeZoneOf ? timeZoneOf() : timeZone))
    this.#now = now
    this.#checks = new CheckQueue(itemId => this.getArticle(itemId), now, log)
    this.#feeds = new FeedCache({ fetchText, readPluginFeed, store, isPaused, now, log })
    this.#store = store
    this.#languageOf = languageOf
    this.#loader = new ArticleLoader({
      catalog: () => this.#catalog,
      fetchText,
      store,
      feeds: this.#feeds,
      recordExtraction: ms => this.#checks.recordExtraction(ms),
      extractPage,
      now,
      log
    })
    this.#lister = new TopicLister({
      feeds: this.#feeds,
      store,
      loader: this.#loader,
      checks: this.#checks,
      videoLengths: this.#videoLengths,
      windows,
      now
    })
    this.#search = new NewsSearch({
      catalog: () => this.#catalog,
      lister: this.#lister,
      loader: this.#loader,
      checks: this.#checks,
      store,
      videoLengths: this.#videoLengths,
      now
    })
    const tools = { summarize, writeDailySummary, answerQuestion, suggestSources }
    const timeZones = () => this.#timeZones.get()
    const wiring = { tools, aiOf, store, profiles, caps: aiCaps, languageOf, householdLanguage, now, log }
    this.#newsAi = createNewsAi({ ...wiring, timeZone: timeZones }, this)
  }

  // Articles each source listed since then ("Peu ouvertes").
  articleCountsBySource(since: number): Map<string, number> {
    return this.#store?.articleCountsBySource(new Date(since).toISOString()) ?? new Map()
  }

  setAi(tools: AiTools | null) {
    this.#newsAi.set(tools)
  }

  setTimeZone(timeZone: string) {
    this.#timeZones.set(timeZone)
  }

  // The blurred previews of the pictures the server made smaller (article-images.ts).
  setImagePreviews(previewOf: (itemId: string) => string | null) {
    this.#loader.setImagePreviews(previewOf)
  }

  setArticleListener(listener: (result: ArticleResult) => void) {
    this.#loader.setArticleListener(listener)
  }

  // An article's page as its site serves it now, for a plugin that keeps a copy (article-loader.ts).
  fetchArticlePage(itemId: string) {
    return this.#loader.fetchArticlePage(itemId)
  }

  aiUsage(profileId = DEFAULT_PROFILE_ID): AiUsage {
    return this.#newsAi.usage(profileId)
  }

  resetAiUsage({ kind = null, profileId = null }: { kind?: AiCallKind | null; profileId?: number | null }) {
    this.#newsAi.reset(kind, profileId)
  }

  // The catalogue of the household the request is for (household-scope.ts).
  get #catalog(): Catalog {
    return this.#catalogs.get()
  }

  get catalog() {
    return this.#catalog
  }

  // A source added: listed with its topics (or its section of "Vidéos") from now on. False when one is unknown.
  addSource(source: Source, section: 'topic' | 'listen', sectionIds: string[]) {
    const added = addToCatalog(this.#catalog, source, section, sectionIds)
    if (added) this.#search.forgetTrends()
    return added
  }

  // A source moved to other topics: the first one labels its articles. False when one is unknown.
  setSourceTopics(sourceId: string, topicIds: string[]) {
    const moved = moveToTopics(this.#catalog, sourceId, topicIds)
    if (moved) this.#search.forgetTrends()
    return moved
  }

  removeSource(sourceId: string) {
    removeFromCatalog(this.#catalog, sourceId)
    this.#feeds.forget(sourceId)
    this.#search.forgetTrends()
  }

  // The language the profile reads Hodi in: the AI writes in it, and topic names are given in it.
  languageOf(profileId: number) {
    return this.#languageOf(profileId)
  }

  get canSummarize() {
    return this.#newsAi.canSummarize
  }

  // fresh: fetch the feeds again unless they were fetched less than a minute ago.
  // background: unknown articles wait behind those the reader is waiting for.
  async getTopic(
    topicId: string,
    limit = TOPIC_PAGE_SIZE,
    { fresh = false, background = false, language = 'fr' as Language } = {}
  ): Promise<TopicFeed | null> {
    const topic = this.#catalog.topics.find(candidate => candidate.id === topicId)

    if (!topic) return null

    const { items, checking, hasMore } = await this.#lister.list(topic, limit, { check: true, fresh, background })

    return {
      id: topic.id,
      label: labelIn(topic, language),
      items,
      checking,
      hasMore,
      sources: this.#feeds.statuses(topic.sources)
    }
  }

  // Articles of every topic whose title or summary holds all the words (news-search.ts).
  search(query: string, language: Language = 'fr'): Promise<SearchResult> {
    return this.#search.search(query, language)
  }

  // "Historique": the articles and videos with these ids that the feeds or the store still know, in that order.
  history(ids: string[], language: Language = 'fr'): SearchItem[] {
    return this.#search.history(ids, language)
  }

  // The day's most covered subjects, without what the profile turned off.
  getTrends(filter: ReaderFilter = NO_FILTER): Promise<Trend[]> {
    return this.#search.trends(filter)
  }

  // "Le fil": every topic's articles of one day (today when none is given), in the reader's time zone,
  // or one topic's only. An empty day is skipped for the next one with articles, unless articles of it are
  // still being checked. null: no such day or topic.
  async getDay(
    day: string | null,
    timeZone: string,
    topicId: string | null = null,
    language: Language = 'fr'
  ): Promise<DayFeed | null> {
    const topics = topicId === null ? this.#catalog.topics : this.#catalog.topics.filter(topic => topic.id === topicId)
    if (topics.length === 0) return null
    return this.#lister.day(topics, day, timeZone, language)
  }

  // "À la une": the most covered stories of each topic, from the last day when there are enough.
  // filter: the profile's, so that a story it would not see leaves its place to another.
  // known: the profile's seen stories and read articles. A story it already knows, by any of its articles,
  // makes room for the next one; it comes back only when the topic has nothing newer.
  async getFrontPage(
    filter: ReaderFilter = NO_FILTER,
    known: ReadonlySet<string> = new Set(),
    language: Language = 'fr'
  ): Promise<FrontPage> {
    const recent = new Date(this.#now() - FRONT_PAGE_WINDOW_MS).toISOString()
    const hidden = filtered(filter)
    // A topic without a source the profile reads has nothing to put forward.
    const shown = this.#catalog.topics.filter(topic =>
      topic.sources.some(source => !filter.hiddenSources.includes(source.id))
    )
    const sections = await Promise.all(
      shown.map(async topic => {
        // Same listing as the topic itself: unknown articles are checked in the background.
        const listed = (await this.getTopic(topic.id)) ?? { items: [], checking: 0 }
        const items = frontSection(listed.items, { hidden, recent, known })
        return { id: topic.id, label: labelIn(topic, language), items, checking: listed.checking }
      })
    )

    return { sections }
  }

  // "Suggérer des sources" for a topic (news-ai.ts).
  suggestSources(topicId: string, profileId: number, asked: { current: string[]; replacing: string | null }) {
    return this.#newsAi.suggestSources(topicId, profileId, asked)
  }

  // A plugin's question, from its AiButton (news-ai.ts).
  askForPlugin(pluginId: string, profileId: number, question: PluginQuestion) {
    return this.#newsAi.askForPlugin(pluginId, profileId, question)
  }

  pluginAiLeft(profileId: number) {
    return this.#newsAi.pluginAiLeft(profileId)
  }

  pluginAiCalls() {
    return this.#newsAi.pluginAiCalls()
  }

  answerQuestion(itemId: string, question: string, profileId = DEFAULT_PROFILE_ID) {
    return this.#newsAi.answerQuestion(itemId, question, profileId)
  }

  // "Le Résumé du jour": the day's news in a paragraph per topic, shared by every device.
  getDailySummary(profileId = DEFAULT_PROFILE_ID) {
    return this.#newsAi.getDailySummary(profileId)
  }

  writeDailySummary(profileId = DEFAULT_PROFILE_ID, filter: ReaderFilter = NO_FILTER) {
    return this.#newsAi.writeDailySummary(profileId, filter)
  }

  // Every topic's feeds are fetched and their new articles checked every 15 minutes, so that "Suivis",
  // search and notifications see every article without the reader opening each topic first.
  startBackgroundChecks() {
    if (this.#backgroundTimer) return
    void this.checkAllTopics()
    this.#backgroundTimer = setInterval(() => void this.checkAllTopics(), BACKGROUND_INTERVAL_MS)
    this.#backgroundTimer.unref()
  }

  stopBackgroundChecks() {
    if (this.#backgroundTimer) clearInterval(this.#backgroundTimer)
    this.#backgroundTimer = null
  }

  // One pass: lists the whole window of every topic and queues what was never checked.
  async checkAllTopics() {
    // Every household's topics: a feed several follow is fetched once, its articles shared.
    await this.#checks.pass(() =>
      Promise.all(
        this.#households().flatMap(id =>
          inHousehold(id, () =>
            this.#catalog.topics.map(topic =>
              inHousehold(id, () => this.getTopic(topic.id, MAX_TOPIC_LIMIT, { background: true }))
            )
          )
        )
      )
    )
  }

  // Resolves once every queued readability check has finished.
  whenChecksIdle() {
    return this.#checks.whenIdle()
  }

  // The videos and episodes of the last days of Serveur › Contenu (60 by default), newest first, grouped by section.
  getListen(language: Language = 'fr'): Promise<ListenFeed> {
    return this.#lister.listen(this.#catalog, language)
  }

  // Reports what the last fetches returned, without triggering new ones.
  getSourceStatuses() {
    return this.#feeds.statuses(allSources(this.#catalog))
  }

  getArticle(itemId: string) {
    return this.#loader.getArticle(itemId)
  }

  // The API is called once per article and language (news-ai.ts).
  getSummary(itemId: string, profileId = DEFAULT_PROFILE_ID) {
    return this.#newsAi.getSummary(itemId, profileId)
  }
}
