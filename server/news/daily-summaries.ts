import type { NewsStore } from '../db/news-store.ts'
import type { AiLedger } from './ai-ledger.ts'
import type { Language } from './catalog.ts'
import type { DailySummaryStory, WriteDailySummary, WrittenPoint } from './daily-summary.ts'
import { dayOf } from './days.ts'
import type { DailySummaryPoint, DailySummaryResult, FrontPageSection } from './news-types.ts'
import { SummaryRefusedError } from './summarizer.ts'

// A request this soon after the last one gets that one back.
const MIN_AGE_MS = 30 * 60 * 1000
// The front page must have this many stories before the daily summary is written, unless every topic is checked.
const MIN_STORIES = 12

interface Written {
  createdAt: number
  language: Language
  dailySummary: { points: DailySummaryPoint[]; generatedAt: string }
}

interface DailySummariesOptions {
  store: NewsStore | undefined
  ledger: AiLedger
  languageOf: (profileId: number) => Language
  timeZone: () => string
  now: () => number
  log: (message: string) => void
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

const storiesOf = (sections: FrontPageSection[]): DailySummaryStory[] =>
  sections.flatMap(section =>
    section.items.map(item => ({
      topicId: section.id,
      topic: section.label,
      title: item.title,
      sourceName: item.sourceName,
      summary: item.summary,
      coverage: item.related.length + 1
    }))
  )

// A topic whose articles are still being checked would be left out of the daily summary.
const isWaiting = (sections: FrontPageSection[], stories: DailySummaryStory[]) => {
  const checking = sections.some(section => section.checking > 0)
  const topicWaiting = sections.some(section => section.checking > 0 && section.items.length === 0)
  return stories.length === 0 || (checking && (stories.length < MIN_STORIES || topicWaiting))
}

// In the front page's order, each point with its topic's id so the app can follow the reader's settings.
const pointsOf = (written: WrittenPoint[], sections: FrontPageSection[]) => {
  const rank = (point: DailySummaryPoint) => {
    const index = sections.findIndex(section => section.id === point.topicId)
    return index === -1 ? sections.length : index
  }
  return written
    .map(point => ({ ...point, topicId: sections.find(section => section.label === point.topic)?.id ?? null }))
    .sort((a, b) => rank(a) - rank(b))
}

// "Le Résumé du jour": each profile's last one, the one being written, and writing a new one.
export class DailySummaries {
  readonly #options: DailySummariesOptions
  readonly #written = new Map<number, Written>()
  readonly #pending = new Map<number, Promise<DailySummaryResult>>()

  constructor(options: DailySummariesOptions) {
    this.#options = options
    // The last daily summary survives a restart.
    for (const [profileId, saved] of options.store?.latestDailySummaries<DailySummaryPoint>() ?? []) {
      this.#written.set(profileId, {
        createdAt: saved.createdAt,
        language: saved.language,
        dailySummary: { points: saved.points, generatedAt: saved.generatedAt }
      })
    }
  }

  // Reading it costs nothing. One written in another language (the profile changed its own since) counts as none.
  latest(profileId: number): DailySummaryResult {
    const last = this.#todays(profileId, this.#options.now())
    return last ? { status: 'ok', ...last.dailySummary } : { status: 'none' }
  }

  // Writes it from the front page; only ever on the reader's request, as it uses the API.
  async write(
    profileId: number,
    write: WriteDailySummary,
    frontPage: (language: Language) => Promise<FrontPageSection[]>
  ): Promise<DailySummaryResult> {
    const { ledger, languageOf, now: clock } = this.#options
    const now = clock()
    const language = languageOf(profileId)
    const last = this.#todays(profileId, now)
    if (last && last.createdAt > now - MIN_AGE_MS) return { status: 'ok', ...last.dailySummary }
    const writing = this.#pending.get(profileId)
    if (writing) return writing

    const sections = await frontPage(language)
    const stories = storiesOf(sections)
    if (isWaiting(sections, stories)) return { status: 'pending' }
    // Another request may have started the daily summary while the front page loaded.
    const started = this.#pending.get(profileId)
    if (started) return started
    if (!ledger.take('dailySummary', profileId, now)) return this.#latestOr(last, { status: 'limited' })

    const pending = write(stories, language)
      .then(
        written => this.#keep(profileId, { createdAt: now, language, points: pointsOf(written, sections) }),
        (error: unknown) => {
          this.#options.log(`Daily summary failed: ${errorMessage(error)}`)
          // The last daily summary is better than nothing.
          return this.#latestOr(last, { status: error instanceof SummaryRefusedError ? 'refused' : 'failed' })
        }
      )
      .finally(() => this.#pending.delete(profileId))
    this.#pending.set(profileId, pending)
    return pending
  }

  #latestOr(last: Written | null, fallback: DailySummaryResult): DailySummaryResult {
    return last ? { status: 'ok', ...last.dailySummary } : fallback
  }

  #keep(
    profileId: number,
    { createdAt, language, points }: { createdAt: number; language: Language; points: DailySummaryPoint[] }
  ): DailySummaryResult {
    const dailySummary = { points, generatedAt: new Date(createdAt).toISOString() }
    this.#written.set(profileId, { createdAt, language, dailySummary })
    this.#options.store?.saveDailySummary({ ...dailySummary, createdAt, language }, profileId)
    return { status: 'ok', ...dailySummary }
  }

  // The profile's daily summary of today, in its current language: shown until midnight in the server's time zone.
  #todays(profileId: number, now: number) {
    const { languageOf, timeZone } = this.#options
    const last = this.#written.get(profileId)
    const today = last && dayOf(last.createdAt, timeZone()) === dayOf(now, timeZone())
    return last && today && last.language === languageOf(profileId) ? last : null
  }
}
