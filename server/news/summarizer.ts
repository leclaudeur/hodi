import Anthropic from '@anthropic-ai/sdk'
import { parseHTML } from 'linkedom'
import type { Language } from './catalog.ts'

export const DEFAULT_SUMMARY_MODEL = 'claude-haiku-5-5'
// Key points of a summary, by the article's length: a short piece keeps 3, a long one up to 7, so neither is
// padded nor cut down too far.
const POINTS_BY_WORDS: [maxWords: number, points: number][] = [
  [350, 3],
  [800, 4],
  [1500, 5],
  [2500, 6]
]
const MAX_POINTS = 7

export const pointsFor = (text: string) => {
  const words = text.split(/\s+/).filter(Boolean).length
  return POINTS_BY_WORDS.find(([maxWords]) => words <= maxWords)?.[1] ?? MAX_POINTS
}

export interface SummaryInput {
  title: string
  sourceName: string
  contentHtml: string
  // The reader's language (the profile's, else the household's): the AI writes in it, whatever the article's.
  language: Language
}

// Resolves to the key points of the article, in the reader's language.
export type Summarize = (input: SummaryInput) => Promise<string[]>

export class SummaryRefusedError extends Error {}

// Each prompt is written in the language the AI answers in, so it is not tempted to mix the two.
const SUMMARY_PROMPTS: Record<Language, { system: string; ask: (points: number) => string }> = {
  fr: {
    system: `Tu résumes des articles de presse pour un lecteur francophone qui veut savoir l'essentiel en quelques secondes.
Écris en français, quelle que soit la langue de l'article.
Donne le nombre de points clés demandé, du plus important au moins important. Chaque point tient en une phrase, deux au plus quand une nuance, un chiffre ou un contexte le demande : ne coupe pas ce qui compte pour faire court.
Reste fidèle à l'article : pas d'opinion, pas d'information qui n'y figure pas.`,
    ask: points => `Donne ${points} points clés.`
  },
  en: {
    system: `You summarize news articles for an English-speaking reader who wants the gist in a few seconds.
Write in English, whatever the article's language.
Give the number of key points asked for, from the most to the least important. Each point is one sentence, two at most when a nuance, a figure or some context calls for it: don't cut what matters to keep it short.
Stay true to the article: no opinion, no information it does not contain.`,
    ask: points => `Give ${points} key points.`
  }
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    points: { type: 'array', items: { type: 'string' } }
  },
  required: ['points'],
  additionalProperties: false
}

// The article's text, one paragraph per block, for the prompt.
export const articleText = (contentHtml: string) => {
  const { document } = parseHTML(`<!doctype html><html><body>${contentHtml}</body></html>`)
  const blocks = [...document.querySelectorAll('h2, h3, h4, p, li, blockquote')]
    .map(block => block.textContent?.replace(/\s+/g, ' ').trim() ?? '')
    .filter(Boolean)

  return blocks.length > 0 ? blocks.join('\n\n') : (document.body.textContent?.trim() ?? '')
}

export interface AiClient {
  client: Anthropic
  model: string
  // Where the reader is, for the date in prompts and the web search's results: the server's time zone,
  // and its country when the household picked one.
  timeZone?: string
  country?: string | null
}

export const createAiClient = ({
  apiKey,
  model,
  timeZone,
  country
}: {
  apiKey: string
  model: string
  timeZone?: string
  country?: string | null
}): AiClient => ({
  client: new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 }),
  model,
  timeZone,
  country
})

// One request whose answer follows the JSON schema; refusals and cut-off answers throw.
export const askJson = async (
  { client, model }: AiClient,
  { system, prompt, schema }: { system: string; prompt: string; schema: Record<string, unknown> }
): Promise<unknown> => {
  const response = await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    // These tasks are easy: low effort keeps them fast and cheap.
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: prompt }]
  })

  if (response.stop_reason === 'refusal') throw new SummaryRefusedError('The model declined to answer')
  if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off')

  return JSON.parse(response.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join(''))
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

// The non-empty strings of a list field in the answer.
export const stringList = (answer: unknown, field: string) => {
  const list = isRecord(answer) ? answer[field] : null
  return Array.isArray(list)
    ? list
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
        .map(entry => entry.trim())
    : []
}

export const createSummarizer = (ai: AiClient): Summarize => {
  return async ({ title, sourceName, contentHtml, language }) => {
    const text = articleText(contentHtml)
    const wanted = pointsFor(text)
    const prompts = SUMMARY_PROMPTS[language]
    const answer = await askJson(ai, {
      system: prompts.system,
      prompt: `<article source="${sourceName}">\n<title>${title}</title>\n${text}\n</article>\n\n${prompts.ask(wanted)}`,
      schema: SUMMARY_SCHEMA
    })
    const points = stringList(answer, 'points')

    if (points.length === 0) throw new Error('The summary is empty')

    return points.slice(0, wanted + 1)
  }
}

// A page the answer drew on, linked under it.
export interface AnswerSource {
  url: string
  title: string
}

// An answer to a question about an article, in the reader's language, with the web pages it used.
export type AnswerQuestion = (
  input: SummaryInput & { question: string }
) => Promise<{ answer: string; sources: AnswerSource[] }>

const QUESTION_PROMPTS: Record<Language, { system: string; today: (date: string) => string }> = {
  fr: {
    system: `Tu réponds aux questions d'un lecteur francophone sur un article de presse qu'il est en train de lire.
Il a souvent déjà lu l'article : il veut aller plus loin (contexte, historique, qui sont les acteurs, ce qui s'est passé depuis, chiffres à jour).
Ta formation s'arrête bien avant la date du jour : pour ce qui est récent ou qui a pu changer, cherche sur le web plutôt que de répondre de mémoire. Si l'article suffit, ne cherche pas.
Réponds en français en tutoyant le lecteur, en 5 phrases au plus, simplement et sans jargon, sans titres ni listes.
Si la question n'a rien à voir avec l'article, réponds quand même brièvement.`,
    today: date => `Nous sommes le ${date}.`
  },
  en: {
    system: `You answer an English-speaking reader's questions about a news article they are reading.
They have often read the article already: they want to go further (context, background, who the people involved are, what happened since, up-to-date figures).
Your training stops well before today's date: for anything recent or that may have changed, search the web rather than answering from memory. If the article is enough, don't search.
Answer in English, in a friendly tone, in 5 sentences at most, simply and without jargon, with no headings or lists.
If the question has nothing to do with the article, still answer briefly.`,
    today: date => `Today is ${date}.`
  }
}

// A few searches cover a question; each costs $0.01 on top of the tokens.
const MAX_SEARCHES = 3
// A long search turn can be paused by the API; it is resumed this many times at most.
const MAX_CONTINUATIONS = 2

export const createQuestionAnswerer = ({
  client,
  model,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  country = null
}: AiClient): AnswerQuestion => {
  const userLocation = { type: 'approximate' as const, timezone: timeZone, ...(country ? { country } : {}) }

  return async ({ title, sourceName, contentHtml, question, language }) => {
    const prompts = QUESTION_PROMPTS[language]
    const today = new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone }).format(new Date())
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `${prompts.today(today)}\n\n<article source="${sourceName}">\n<title>${title}</title>\n${articleText(contentHtml)}\n</article>\n\n<question>${question}</question>`
      }
    ]
    const blocks: Anthropic.ContentBlock[] = []

    for (let turn = 0; ; turn++) {
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        system: prompts.system,
        output_config: { effort: 'low' },
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: MAX_SEARCHES,
            user_location: userLocation
          }
        ],
        messages
      })

      if (response.stop_reason === 'refusal') throw new SummaryRefusedError('The model declined to answer')
      if (response.stop_reason === 'max_tokens') throw new Error('The answer was cut off')

      blocks.push(...response.content)
      if (response.stop_reason !== 'pause_turn' || turn >= MAX_CONTINUATIONS) break

      // Paused mid-search: send the turn back as is to let it carry on.
      messages.push({ role: 'assistant', content: response.content })
    }

    // The answer follows the last search; text before it only announces the searches.
    const lastSearch = blocks.findLastIndex(block => block.type !== 'text')
    const texts = blocks.slice(lastSearch + 1).flatMap(block => (block.type === 'text' ? [block] : []))
    const answer = texts
      .map(block => block.text)
      .join('')
      .trim()
    if (!answer) throw new Error('The answer is empty')

    // Cited pages, once each, in the order they are cited.
    const sources = new Map<string, AnswerSource>()
    for (const citation of texts.flatMap(block => block.citations ?? [])) {
      if (citation.type === 'web_search_result_location' && !sources.has(citation.url)) {
        sources.set(citation.url, { url: citation.url, title: citation.title ?? new URL(citation.url).hostname })
      }
    }

    return { answer, sources: [...sources.values()] }
  }
}

// "Suggérer des sources": sites for a topic, from the model's knowledge. Each is then looked for a feed
// and tried in the reader before it is offered, so a wrong or dead one never reaches the reader.
export interface SuggestedSite {
  name: string
  url: string
  reason: string
}

export type SuggestSources = (input: {
  topic: string
  // The reader's language: sites in it first, and the reasons written in it.
  language: Language
  // The languages of the sites: the reader's, then the household's when it differs.
  languages: Language[]
  // The topic's sources the profile reads, to suggest in their vein, and never again.
  current: string[]
  // A little-read source being replaced, if any.
  replacing: string | null
}) => Promise<SuggestedSite[]>

const SOURCES_PROMPTS: Record<
  Language,
  { system: (languages: Language[]) => string; none: string; replace: (name: string) => string }
> = {
  fr: {
    system: languages => `Tu proposes des sources d'actualité à suivre par flux RSS pour un lecteur belge francophone.
Propose 6 sites pour le thème donné : des médias ou blogs sérieux, actifs et publiant souvent, avec de préférence un flux RSS public.
${
  languages.includes('en')
    ? "Des sites en français (Belgique, France, Suisse, Québec) et en anglais, le français d'abord."
    : 'Des sites en français uniquement (Belgique, France, Suisse, Québec).'
}
Pas de site déjà suivi, pas de site entièrement payant, pas d'agrégateur.
Pour chaque site : son nom, l'adresse de sa page d'accueil (https), et une phrase courte qui dit ce qu'il apporte.`,
    none: 'aucun',
    replace: name => `${name} (peu lu par ce lecteur : propose autre chose)`
  },
  en: {
    system: languages => `You suggest news sources to follow by RSS feed for an English-speaking reader.
Suggest 6 sites for the given topic: serious media or blogs, active and publishing often, preferably with a public RSS feed.
${languages.includes('fr') ? 'Sites in English and in French, English first.' : 'Sites in English only.'}
No site already followed, no fully paywalled site, no aggregator.
For each site: its name, the address of its home page (https), and a short sentence saying what it brings.`,
    none: 'none',
    replace: name => `${name} (little read by this reader: suggest something else)`
  }
}

const SOURCES_SCHEMA = {
  type: 'object',
  properties: {
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, url: { type: 'string' }, reason: { type: 'string' } },
        required: ['name', 'url', 'reason'],
        additionalProperties: false
      }
    }
  },
  required: ['sites'],
  additionalProperties: false
}

const MAX_SUGGESTED = 6

export const createSourceSuggester =
  (ai: AiClient): SuggestSources =>
  async ({ topic, current, replacing, language, languages }) => {
    const prompts = SOURCES_PROMPTS[language]
    const answer = await askJson(ai, {
      system: prompts.system(languages),
      prompt: [
        `<topic>${topic}</topic>`,
        `<followed>${current.join(', ') || prompts.none}</followed>`,
        replacing ? `<replacing>${prompts.replace(replacing)}</replacing>` : ''
      ]
        .filter(Boolean)
        .join('\n'),
      schema: SOURCES_SCHEMA
    })
    const sites = isRecord(answer) && Array.isArray(answer.sites) ? answer.sites : []
    return sites
      .filter(
        (site): site is SuggestedSite =>
          isRecord(site) &&
          typeof site.name === 'string' &&
          typeof site.url === 'string' &&
          typeof site.reason === 'string' &&
          /^https?:\/\//i.test(site.url)
      )
      .slice(0, MAX_SUGGESTED)
      .map(site => ({ name: site.name.trim(), url: site.url.trim(), reason: site.reason.trim() }))
  }

// A plugin's question (ctx.ai.ask): plain text in, plain text out, no tool and no web search, within maxTokens.
export interface PluginQuestion {
  system: string
  prompt: string
  maxTokens: number
}

export const createPluginAsker =
  ({ client, model }: AiClient) =>
  async ({ system, prompt, maxTokens }: PluginQuestion): Promise<string> => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }]
    })
    if (response.stop_reason === 'refusal') throw new SummaryRefusedError('The model declined to answer')
    return response.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
  }
