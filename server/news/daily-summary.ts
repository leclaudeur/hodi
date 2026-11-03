import type { Language } from './catalog.ts'
import { type AiClient, askJson } from './summarizer.ts'

export interface DailySummaryStory {
  topicId: string
  topic: string
  title: string
  sourceName: string
  summary: string
  // Other sources covering the same story: a rough measure of its weight.
  coverage: number
}

export interface WrittenPoint {
  topic: string
  text: string
}

// Resolves to a short paragraph per front-page story, topic by topic, that sums up the day's news, in the
// reader's language.
export type WriteDailySummary = (stories: DailySummaryStory[], language: Language) => Promise<WrittenPoint[]>

// Feed summaries can be long: the start says enough for an overview.
const MAX_SUMMARY_LENGTH = 500

// Written in the language the AI answers in, so it is not tempted to mix the two.
const SYSTEM_PROMPTS: Record<Language, string> = {
  fr: `Tu écris « Le Résumé du jour » : l'actualité du jour, thème par thème, pour un lecteur francophone qui veut être à jour en deux minutes.
On te donne, pour chaque thème, ses sujets à la une avec le nombre de médias qui en parlent.
Pour chaque thème, écris un court paragraphe de 1 à 3 phrases en français par sujet, du plus couvert au moins couvert : un paragraphe ne parle que d'un sujet, ne mélange jamais deux sujets. Deux articles sur le même événement font un seul sujet.
Sois concret : qui, quoi, où, les chiffres clés. Pas de phrase d'introduction ni de conclusion.
Reste fidèle aux titres et aux résumés : pas d'opinion, pas d'information qui n'y figure pas.`,
  en: `You write "The Daily summary": today's news, topic by topic, for an English-speaking reader who wants to be up to date in two minutes.
For each topic you get its front-page stories, with the number of media covering each.
For each topic, write a short paragraph of 1 to 3 sentences in English per story, from the most to the least covered: a paragraph is about one story only, never two. Two articles on the same event are one story.
Be concrete: who, what, where, the key figures. No opening or closing sentence.
Stay true to the titles and summaries: no opinion, no information they do not contain.`
}

// One required field per topic, a paragraph per story in it: the answer cannot leave a topic out.
export const dailySummarySchema = (topicIds: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(topicIds.map(id => [id, { type: 'array', items: { type: 'string' } }])),
  required: topicIds,
  additionalProperties: false
})

const topicsOf = (stories: DailySummaryStory[]) => [
  ...new Map(stories.map(story => [story.topicId, story.topic])).entries()
]

export const dailySummaryPrompt = (stories: DailySummaryStory[]) =>
  topicsOf(stories)
    .map(([topicId, topic]) => {
      const items = stories
        .filter(story => story.topicId === topicId)
        .map(story => {
          const summary =
            story.summary.length > MAX_SUMMARY_LENGTH ? `${story.summary.slice(0, MAX_SUMMARY_LENGTH)}…` : story.summary
          return `<story source="${story.sourceName}" coverage="${story.coverage}">\n<title>${story.title}</title>\n${summary}\n</story>`
        })
      return `<topic field="${topicId}" name="${topic}">\n${items.join('\n')}\n</topic>`
    })
    .join('\n')

export const createDailySummaryWriter =
  (ai: AiClient): WriteDailySummary =>
  async (stories, language) => {
    const topics = topicsOf(stories)
    const answer = await askJson(ai, {
      system: SYSTEM_PROMPTS[language],
      prompt: dailySummaryPrompt(stories),
      schema: dailySummarySchema(topics.map(([topicId]) => topicId))
    })
    const fields = typeof answer === 'object' && answer !== null ? (answer as Record<string, unknown>) : {}
    const points = topics.flatMap(([topicId, topic]) => {
      const texts = Array.isArray(fields[topicId]) ? (fields[topicId] as unknown[]) : []
      return texts.flatMap(text =>
        typeof text === 'string' && text.trim() !== '' ? [{ topic, text: text.trim() }] : []
      )
    })

    if (points.length === 0) throw new Error('The daily summary is empty')

    return points
  }
