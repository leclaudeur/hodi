import { useSyncExternalStore } from 'react'
import { PROFILE_COLORS, type TopicItem, type TopicSummary } from '../api.ts'
import { type Language, isLanguage } from './i18n.ts'
import { isDismissed, isReadAndClosed } from './read-state.ts'
import { changeUserState, getUserState, subscribeUserState } from './user-state.ts'
import { foldText, wordPattern } from './word-match.ts'

// What to show and in which order, shared by every device (kept on the server, see user-state.ts).

// system: a profile that never chose, on its device's light or dark.
export type Theme = 'system' | 'light' | 'dark' | 'poudre'
export const THEMES: Theme[] = ['system', 'light', 'dark', 'poudre']

// The brand's colour: the theme's own (rust, Poudré's pink), or one of the profile colours.
export const ACCENTS = ['auto', ...PROFILE_COLORS] as const
export type Accent = (typeof ACCENTS)[number]

// The accent colours before they were the profile colours, each to the profile colour it was drawn from.
const OLD_ACCENTS: Record<string, Accent> = {
  rose: 'films-series',
  corail: 'jeux-video',
  ocre: 'belgique',
  vert: 'science',
  turquoise: 'tech',
  bleu: 'monde',
  lavande: 'broadcast'
}

export interface Preferences {
  // Articles already opened leave the topics.
  hideRead: boolean
  // Topic ids in the order of the tabs; topics missing here follow, in the server's order.
  topicOrder: string[]
  hiddenTopics: string[]
  hiddenSources: string[]
  // Articles whose title or summary holds one of these words are left out.
  mutedWords: string[]
  // Articles about these get a badge, and a tab of their own.
  followedWords: string[]
  // Clair, Sombre or Poudré.
  theme: Theme
  accent: Accent
  // Index in TEXT_SCALES (text-size.ts).
  textSize: number
  // "Partages": off, this profile neither sends nor receives articles; and the profiles not to receive from.
  sharing: boolean
  mutedSharers: number[]
  // The interface's language; null: the household's.
  language: Language | null
}

export const DEFAULT_TEXT_SIZE = 1

const DEFAULTS: Preferences = {
  hideRead: true,
  topicOrder: [],
  hiddenTopics: [],
  hiddenSources: [],
  mutedWords: [],
  followedWords: [],
  theme: 'system',
  accent: 'auto',
  textSize: DEFAULT_TEXT_SIZE,
  sharing: true,
  mutedSharers: [],
  language: null
}

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

// Whatever was stored, with anything unexpected left out.
export const parsePreferences = (stored: unknown): Preferences => {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<
    Record<keyof Preferences, unknown>
  >

  return {
    hideRead: value.hideRead !== false,
    topicOrder: strings(value.topicOrder),
    hiddenTopics: strings(value.hiddenTopics),
    hiddenSources: strings(value.hiddenSources),
    mutedWords: strings(value.mutedWords),
    followedWords: strings(value.followedWords),
    theme: THEMES.includes(value.theme as Theme) ? (value.theme as Theme) : 'system',
    accent: ACCENTS.includes(value.accent as Accent)
      ? (value.accent as Accent)
      : (OLD_ACCENTS[value.accent as string] ?? 'auto'),
    textSize: Number.isInteger(value.textSize) ? (value.textSize as number) : DEFAULT_TEXT_SIZE,
    sharing: value.sharing !== false,
    mutedSharers: Array.isArray(value.mutedSharers)
      ? value.mutedSharers.filter((id): id is number => Number.isInteger(id))
      : [],
    language: isLanguage(value.language) ? value.language : null
  }
}

// Parsed once per state change, so components get the same object until something changes.
let source: unknown = Symbol('none')
let preferences = DEFAULTS
const current = () => {
  const stored = getUserState().preferences
  if (stored !== source) {
    source = stored
    preferences = parsePreferences(stored)
  }
  return preferences
}

// Sends only what changed: the server merges it, so another device's older copy never overwrites it.
// quiet: changed from a reading screen (text size, following a search), where the screen itself shows it.
export const updatePreferences = (change: Partial<Preferences>, { quiet = false } = {}) => {
  changeUserState(state => ({ ...state, preferences: { ...current(), ...change } }), {
    method: 'PUT',
    path: '/preferences',
    body: { preferences: change },
    setting: !quiet
  })
}

// Quiet: its button says "Réglages réinitialisés" at once.
export const resetPreferences = () => updatePreferences(DEFAULTS, { quiet: true })

export const getPreferences = current

export const usePreferences = () => useSyncExternalStore(subscribeUserState, current)

// The tabs: the chosen order first, then topics added since, without the hidden ones.
export const orderTopics = <T extends TopicSummary>(topics: T[], { topicOrder, hiddenTopics }: Preferences) => {
  const rank = (topic: T) => {
    const index = topicOrder.indexOf(topic.id)
    return index === -1 ? topicOrder.length : index
  }

  return topics
    .map((topic, index) => ({ topic, index }))
    .sort((a, b) => rank(a.topic) - rank(b.topic) || a.index - b.index)
    .map(({ topic }) => topic)
    .filter(topic => !hiddenTopics.includes(topic.id))
}

// A topic with no source left to show (none added, or all hidden by the profile) shows nowhere: not in the
// menu, the filters, Le fil or the stories. Réglages > Sources still offers it, to add one.
export const hasShownSource = (topic: { sources: { id: string }[] }, { hiddenSources }: Preferences) =>
  topic.sources.some(source => !hiddenSources.includes(source.id))

// Case and accents aside: "elections" mutes "Élections".
export const isHidden = (
  item: Pick<TopicItem, 'id' | 'sourceId' | 'title' | 'summary'>,
  { hideRead, hiddenSources, mutedWords }: Preferences
) => {
  if (hiddenSources.includes(item.sourceId) || isDismissed(item.id)) return true
  // The article open now stays (dimmed), so the list beside it moves no card.
  if (hideRead && isReadAndClosed(item.id)) return true
  if (mutedWords.length === 0) return false

  const text = foldText(`${item.title} ${item.summary}`)
  return mutedWords.some(word => wordPattern(word).test(text))
}

// Every followed subject an article is about: Suivis lists it under each.
export const followedWordsOf = (item: TopicItem, { followedWords }: Preferences) => {
  if (followedWords.length === 0) return []

  const text = foldText(`${item.title} ${item.summary}`)
  return followedWords.filter(word => wordPattern(word).test(text))
}

export const followedWordOf = (item: TopicItem, preferences: Preferences) =>
  followedWordsOf(item, preferences)[0] ?? null
