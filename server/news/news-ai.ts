import type { Catalog, Language } from './catalog.ts'
import { type PluginQuestion, SummaryRefusedError } from './summarizer.ts'
import type { NewsStore } from '../db/news-store.ts'
import { labelIn } from '../labels.ts'
import { AiLedger, type AiUsage } from './ai-ledger.ts'
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
  // Everyone's AI, in tests; aiOf, each reader's own: its account's key, none for a profile without one.
  tools: Partial<AiTools> | null
  aiOf: ((profileId: number) => AiTools | null) | undefined
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
  readonly #summaries = new Map<string, SummaryEntry>()

  constructor(options: NewsAiOptions) {
    this.#options = options
  }

  // The reader's AI: none until its account has a key.
  toolsOf(profileId: number): Partial<AiTools> | null {
    return this.#options.aiOf ? this.#options.aiOf(profileId) : this.#options.tools
  }

  canSummarize(profileId: number) {
    return this.toolsOf(profileId)?.summarize !== undefined
  }

  // Calls to the API in the last 24 hours: the reader's "IA et crédits".
  usage(profileId: number): AiUsage {
    return this.#options.ledger.usage(profileId, this.#options.now(), this.canSummarize(profileId))
  }

  // "Suggérer des sources" for a topic: one call to the API, within its daily cap. The sites still need
  // a feed and readable articles before they are offered (see source-routes.ts).
  async suggestSources(
    topicId: string,
    profileId: number,
    { current, replacing }: { current: string[]; replacing: string | null }
  ): Promise<SourceSuggestionResult> {
    const suggest = this.toolsOf(profileId)?.suggestSources
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
    const ask = this.toolsOf(profileId)?.askForPlugin
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

  // Whether this person has an AI a plugin may ask.
  pluginAiLeft(profileId: number) {
    return this.toolsOf(profileId)?.askForPlugin !== undefined
  }

  // The reader's calls of each plugin in the last 24 hours, for its IA et crédits.
  pluginAiCalls(profileId: number): Record<string, number> {
    return this.#options.ledger.pluginCalls(profileId, this.#options.now())
  }

  // Questions are not cached: each one is asked of the API, within a daily cap.
  async answerQuestion(itemId: string, question: string, profileId: number): Promise<AnswerResult> {
    const answer = this.toolsOf(profileId)?.answerQuestion
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
    if (!this.toolsOf(profileId)?.writeDailySummary) return { status: 'unavailable' }
    return this.#options.dailySummaries.latest(profileId)
  }

  // Each profile's own, from its sources and topics, without its muted words.
  async writeDailySummary(profileId: number, filter: ReaderFilter = NO_FILTER): Promise<DailySummaryResult> {
    const write = this.toolsOf(profileId)?.writeDailySummary
    if (!write) return { status: 'unavailable' }
    return this.#options.dailySummaries.write(profileId, write, async language =>
      (await this.#options.frontPage(filter, language)).sections.filter(
        section => !filter.hiddenTopics.includes(section.id)
      )
    )
  }

  // A summary the reader's account already paid for, in its language: shown closed with the article, reading it calls
  // nothing.
  storedSummary(itemId: string, profileId: number): string[] | null {
    if (!this.canSummarize(profileId)) return null
    const owner = this.#options.store?.ownerOf(profileId)
    return owner ? (this.#options.store?.getSummary(itemId, this.#options.languageOf(profileId), owner) ?? null) : null
  }

  // The API is called once per article, language and account: its later requests share the same summary, and no
  // other account sees it or pays for it.
  async getSummary(itemId: string, profileId = DEFAULT_PROFILE_ID): Promise<SummaryResult> {
    const summarize = this.toolsOf(profileId)?.summarize
    if (!summarize) return { status: 'unavailable' }

    const now = this.#options.now()
    const language = this.#options.languageOf(profileId)
    const owner = this.#options.store?.ownerOf(profileId) ?? `p${profileId}`
    const key = `${owner} ${itemId} ${language}`

    for (const [id, entry] of this.#summaries) {
      if (entry.expiresAt <= now) this.#summaries.delete(id)
    }

    const cached = this.#summaries.get(key)
    if (cached) return cached.result

    // Paid for once already: shown again for free.
    const storedPoints = this.#options.store?.getSummary(itemId, language, owner)
    if (storedPoints) return { status: 'ok', points: storedPoints }

    const loaded = await this.#options.getArticle(itemId)
    if (loaded.status !== 'ok') return { status: loaded.status }

    // Checked again: another request may have started the summary while the article loaded.
    const started = this.#summaries.get(key)
    if (started) return started.result

    if (!this.#options.ledger.take('summary', profileId, now)) return { status: 'limited' }

    const { item, article } = loaded
    const input = { title: item.title, sourceName: item.sourceName, contentHtml: article.contentHtml, language }
    const result = this.#summarize(summarize, input, { key, owner, itemId, link: item.link })

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
    { key, owner, itemId, link }: { key: string; owner: string; itemId: string; link: string }
  ) {
    return summarize(input).then(
      (points): SummaryResult => {
        this.#options.store?.saveSummary(itemId, input.language, points, this.#options.now(), owner)
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
  aiOf: ((profileId: number) => AiTools | null) | undefined
  store: NewsStore | undefined
  languageOf: (profileId: number) => Language
  householdLanguage: () => Language
  timeZone: (profileId: number) => string
  now: () => number
  log: (message: string) => void
}

// The ledger and the Résumé du jour the AI's buttons share, for the news service.
export const createNewsAi = ({ store, timeZone, ...wiring }: NewsAiWiring, news: NewsReader) => {
  const { languageOf, now, log } = wiring
  const ledger = new AiLedger({ store, now: now() })
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
