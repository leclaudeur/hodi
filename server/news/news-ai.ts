import type { Catalog, Language } from './catalog.ts'
import { type PluginQuestion, SummaryRefusedError } from './summarizer.ts'
import type { AiCallKind } from '../db/ai-queries.ts'
import type { NewsStore } from '../db/news-store.ts'
import { labelIn } from '../labels.ts'
import { type AiCaps, AiLedger, type AiUsage, type CapProfile } from './ai-ledger.ts'
import { DailySummaries } from './daily-summaries.ts'
import { NO_FILTER, type ReaderFilter } from './reader-filter.ts'
import type {
  AiTools,
  AnswerResult,
  ArticleResult,
  DailySummaryResult,
  FrontPage,
  PluginAskResult,
  SourceSuggestionResult,
  SummaryResult
} from './news-types.ts'
import { PerHousehold } from './per-household.ts'
import { errorMessage } from './article-loader.ts'

// The news' AI buttons: a summary, a question, sources to suggest, the Résumé du jour and a plugin's question. Each
// is one call to the API after a click, within its daily cap (ai-ledger.ts).

const MAX_CACHED_SUMMARIES = 200
// A summary is kept as long as its article is listed.
const SUMMARY_TTL_MS = 72 * 60 * 60 * 1000
const DEFAULT_PROFILE_ID = 1

interface SummaryEntry {
  expiresAt: number
  result: Promise<SummaryResult>
}

interface NewsAiOptions {
  // The AI of the household the service was made for.
  tools: Partial<AiTools> | null
  aiOf: (() => AiTools | null) | undefined
  ledger: AiLedger
  dailySummaries: DailySummaries
  store: NewsStore | undefined
  catalog: () => Catalog
  getArticle: (itemId: string) => Promise<ArticleResult>
  frontPage: (filter: ReaderFilter, language: Language) => Promise<FrontPage>
  languageOf: (profileId: number) => Language
  householdLanguage: () => Language
  now: () => number
  log: (message: string) => void
}

export class NewsAi {
  readonly #options: NewsAiOptions
  // Each household's AI, none until its admin gives a key. Swapped by set when the admin changes it.
  readonly #ai: PerHousehold<Partial<AiTools> | null>
  readonly #summaries = new Map<string, SummaryEntry>()

  constructor(options: NewsAiOptions) {
    this.#options = options
    this.#ai = new PerHousehold(() => (options.aiOf ? options.aiOf() : null))
    this.#ai.set(options.tools)
  }

  // A new key, provider or region from Réglages, or none (the AI's buttons go away), for the household the request
  // is for (household-scope.ts).
  set(tools: AiTools | null) {
    this.#ai.set(tools)
  }

  get tools(): Partial<AiTools> | null {
    return this.#ai.get() ?? null
  }

  get canSummarize() {
    return this.tools?.summarize !== undefined
  }

  // Calls to the API in the last 24 hours, against each daily cap: the settings' "IA et crédits".
  usage(profileId: number): AiUsage {
    return this.#options.ledger.usage(profileId, this.#options.now(), this.canSummarize)
  }

  reset(kind: AiCallKind | null, profileId: number | null) {
    this.#options.ledger.reset(kind, profileId, this.#options.now())
  }

  // "Suggérer des sources" for a topic: one call to the API, within its daily cap. The sites still need
  // a feed and readable articles before they are offered (see source-routes.ts).
  async suggestSources(
    topicId: string,
    profileId: number,
    { current, replacing }: { current: string[]; replacing: string | null }
  ): Promise<SourceSuggestionResult> {
    const suggest = this.tools?.suggestSources
    if (!suggest) return { status: 'unavailable' }
    const topic = this.#options.catalog().topics.find(candidate => candidate.id === topicId)
    if (!topic) return { status: 'not_found' }
    if (!this.#options.ledger.take('sources', profileId, this.#options.now())) return { status: 'limited' }
    try {
      const language = this.#options.languageOf(profileId)
      const languages = [...new Set([language, this.#options.householdLanguage()])]
      return {
        status: 'ok',
        sites: await suggest({ topic: labelIn(topic, language), current, replacing, language, languages })
      }
    } catch (error) {
      if (error instanceof SummaryRefusedError) return { status: 'refused' }
      this.#options.log(`Source suggestions for ${topicId} failed: ${errorMessage(error)}`)
      return { status: 'failed' }
    }
  }

  // A plugin's question, from its AiButton: one call to the API within the 'plugin' daily caps, counted for the profile
  // that clicked and the plugin that asked. Answers whether the household's AI could take it.
  async askForPlugin(pluginId: string, profileId: number, question: PluginQuestion): Promise<PluginAskResult> {
    const ask = this.tools?.askForPlugin
    if (!ask) return { status: 'unavailable' }
    if (!this.#options.ledger.take('plugin', profileId, this.#options.now(), pluginId)) return { status: 'limited' }
    try {
      return { status: 'ok', text: await ask(question) }
    } catch (error) {
      if (error instanceof SummaryRefusedError) return { status: 'refused' }
      this.#options.log(`AI for plugin ${pluginId} failed: ${errorMessage(error)}`)
      return { status: 'failed' }
    }
  }

  // Whether the 'plugin' caps still leave this profile a call today.
  pluginAiLeft(profileId: number) {
    return (
      this.tools?.askForPlugin !== undefined && this.#options.ledger.hasLeft('plugin', profileId, this.#options.now())
    )
  }

  // The household's calls of each plugin in the last 24 hours, for Réglages › IA et crédits.
  pluginAiCalls(): Record<string, number> {
    return this.#options.ledger.pluginCalls(this.#options.now())
  }

  // Questions are not cached: each one is asked of the API, within a daily cap.
  async answerQuestion(itemId: string, question: string, profileId: number): Promise<AnswerResult> {
    const answer = this.tools?.answerQuestion
    if (!answer) return { status: 'unavailable' }

    const loaded = await this.#options.getArticle(itemId)
    if (loaded.status !== 'ok') return { status: loaded.status }

    const now = this.#options.now()
    if (!this.#options.ledger.take('question', profileId, now)) return { status: 'limited' }

    const { item, article } = loaded

    try {
      const answered = await answer({
        title: item.title,
        sourceName: item.sourceName,
        contentHtml: article.contentHtml,
        question,
        language: this.#options.languageOf(profileId)
      })
      return { status: 'ok', ...answered }
    } catch (error) {
      if (error instanceof SummaryRefusedError) return { status: 'refused' }
      this.#options.log(`Question on ${item.link} failed: ${errorMessage(error)}`)
      return { status: 'failed' }
    }
  }

  // "Le Résumé du jour": the day's news in a paragraph per topic, shared by every device.
  getDailySummary(profileId: number): DailySummaryResult {
    if (!this.tools?.writeDailySummary) return { status: 'unavailable' }
    return this.#options.dailySummaries.latest(profileId)
  }

  // Each profile's own, from its sources and topics, without its muted words.
  async writeDailySummary(profileId: number, filter: ReaderFilter = NO_FILTER): Promise<DailySummaryResult> {
    const write = this.tools?.writeDailySummary
    if (!write) return { status: 'unavailable' }
    return this.#options.dailySummaries.write(profileId, write, async language =>
      (await this.#options.frontPage(filter, language)).sections.filter(
        section => !filter.hiddenTopics.includes(section.id)
      )
    )
  }

  // The API is called once per article and language: later requests in that language share the same summary.
  async getSummary(itemId: string, profileId = DEFAULT_PROFILE_ID): Promise<SummaryResult> {
    const summarize = this.tools?.summarize
    if (!summarize) return { status: 'unavailable' }

    const now = this.#options.now()
    const language = this.#options.languageOf(profileId)
    const key = `${itemId} ${language}`

    for (const [id, entry] of this.#summaries) {
      if (entry.expiresAt <= now) this.#summaries.delete(id)
    }

    const cached = this.#summaries.get(key)
    if (cached) return cached.result

    // Paid for once already: shown again for free.
    const storedPoints = this.#options.store?.getSummary(itemId, language)
    if (storedPoints) return { status: 'ok', points: storedPoints }

    const loaded = await this.#options.getArticle(itemId)
    if (loaded.status !== 'ok') return { status: loaded.status }

    // Checked again: another request may have started the summary while the article loaded.
    const started = this.#summaries.get(key)
    if (started) return started.result

    if (!this.#options.ledger.take('summary', profileId, now)) return { status: 'limited' }

    const { item, article } = loaded
    const input = { title: item.title, sourceName: item.sourceName, contentHtml: article.contentHtml, language }
    const result = this.#summarize(summarize, input, key, itemId, item.link)

    if (this.#summaries.size >= MAX_CACHED_SUMMARIES) {
      const oldest = this.#summaries.keys().next().value
      if (oldest !== undefined) this.#summaries.delete(oldest)
    }

    this.#summaries.set(key, { expiresAt: now + SUMMARY_TTL_MS, result })

    return result
  }

  #summarize(
    summarize: AiTools['summarize'],
    input: Parameters<AiTools['summarize']>[0],
    key: string,
    itemId: string,
    link: string
  ) {
    return summarize(input).then(
      (points): SummaryResult => {
        this.#options.store?.saveSummary(itemId, input.language, points, this.#options.now())
        return { status: 'ok', points }
      },
      (error: unknown): SummaryResult => {
        this.#summaries.delete(key)
        if (error instanceof SummaryRefusedError) return { status: 'refused' }
        this.#options.log(`Summary of ${link} failed: ${errorMessage(error)}`)
        return { status: 'failed' }
      }
    )
  }
}

// What the AI reads of the news: the articles it summarises and the front page the Résumé du jour is written from.
interface NewsReader {
  readonly catalog: Catalog
  getArticle: (itemId: string) => Promise<ArticleResult>
  getFrontPage: (filter: ReaderFilter, known: ReadonlySet<string>, language: Language) => Promise<FrontPage>
}

interface NewsAiWiring {
  tools: Partial<AiTools>
  aiOf: (() => AiTools | null) | undefined
  store: NewsStore | undefined
  profiles: () => CapProfile[]
  caps: AiCaps
  languageOf: (profileId: number) => Language
  householdLanguage: () => Language
  timeZone: () => string
  now: () => number
  log: (message: string) => void
}

// The ledger and the Résumé du jour the AI's buttons share, for the news service.
export const createNewsAi = ({ store, profiles, caps, timeZone, ...wiring }: NewsAiWiring, news: NewsReader) => {
  const { languageOf, now, log } = wiring
  const ledger = new AiLedger({ store, profiles, caps, now: now() })
  const dailySummaries = new DailySummaries({ store, ledger, languageOf, timeZone, now, log })
  return new NewsAi({
    ...wiring,
    ledger,
    dailySummaries,
    store,
    catalog: () => news.catalog,
    getArticle: itemId => news.getArticle(itemId),
    frontPage: (filter, language) => news.getFrontPage(filter, new Set(), language)
  })
}
