import { UnauthorizedError, getJson, sendJson } from './http.ts'
import type { FeedItem, SearchItem } from './news.ts'

// Adding a source from a link, and sharing. Mirrors server/news/source-finder.ts and server/http/source-routes.ts.

export interface FoundSource {
  name: string
  url: string
  kind: FeedItem['kind']
  // From the feed: French unless it says English.
  lang: FeedItem['lang']
  reader: boolean
  origin: 'feed' | 'youtube'
  readable: { tried: number; ok: number }
  samples: string[]
}

export type FindSourceResult = (
  { status: 'ok'; source: FoundSource } | { status: 'invalid' | 'blocked' | 'none' | 'empty' | 'failed' | 'reddit' }
) & {
  // Already in the catalogue.
  followed: { id: string; name: string } | null
  // The household's sources, and how many it may follow (null: no limit).
  added: number
  limit: number | null
}

export const findSource = (url: string) => sendJson<FindSourceResult>('POST', '/sources/find', { url })

export type AddSourceError =
  'limit' | 'followed' | 'bad_section' | 'invalid' | 'blocked' | 'none' | 'empty' | 'failed' | 'reddit'

type AddSourceResult = { ok: true; id: string } | { ok: false; error: AddSourceError }

const postSource = async (path: string, body: object): Promise<AddSourceResult> => {
  const response = await fetch(`/api/sources${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (response.status === 401) throw new UnauthorizedError('Session expired')
  const result = (await response.json().catch(() => ({}))) as { id?: string; error?: AddSourceError }
  return response.ok && result.id ? { ok: true, id: result.id } : { ok: false, error: result.error ?? 'failed' }
}

// Articles go to one topic or several, videos to one section of Vidéos.
export const addSource = (url: string, section: 'topic' | 'listen', sectionIds: string[]) =>
  postSource('', { url, section, topicIds: sectionIds })

// "Sources proposées": sources.yml's sites not followed yet, by topic, added in one tap.
export interface SourceProposal {
  id: string
  name: string
  topicId: string
  lang: 'fr' | 'en'
  site: string
}

export const getProposals = async () => (await getJson<{ proposals: SourceProposal[] }>('/sources/proposals')).proposals

export const addProposal = (id: string, topicIds: string[]) =>
  postSource(`/proposals/${encodeURIComponent(id)}`, { topicIds })

// A source's topics, by the profile that added it or the admin.
export const setSourceTopics = (id: string, topicIds: string[]) =>
  sendJson<null>('PATCH', `/sources/${encodeURIComponent(id)}`, { topicIds })

// "Peu ouvertes": of each source shown, the articles or videos it listed and those the profile opened, over `days`.
// Mirrors server/news/engagement.ts.
export interface SourceEngagement {
  id: string
  articles: number
  read: number
  low: boolean
}

export const getSourceEngagement = () => getJson<{ days: number; sources: SourceEngagement[] }>('/sources/engagement')

// "Suggérer des sources": sites the AI names for a topic, each with its feed found and tried. One AI call.
// Mirrors server/http/source-routes.ts.
export type SourceSuggestions =
  | {
      status: 'ok'
      suggestions: { link: string; reason: string; source: FoundSource }[]
      added: number
      limit: number | null
    }
  | { status: 'unavailable' | 'not_found' | 'limited' | 'refused' | 'failed' }

export const suggestSources = (topicId: string, replacing: string | null) =>
  sendJson<SourceSuggestions>('POST', '/sources/suggest', { topicId, replacing })

export const removeSource = (id: string) => sendJson<null>('DELETE', `/sources/${encodeURIComponent(id)}`)

// The topics and sources changed (a source added or removed): the app asks for them again.
export const TOPICS_CHANGED = 'hodi:topics-changed'

// "Partages": articles another profile of the household sent here, newest first.
export interface ShareEntry {
  item: SearchItem
  // The profile that sent it.
  from: number
  sharedAt: number
  // The word that came with it, if any.
  note: string | null
  // The emoji sent back, if any.
  reaction: Reaction | null
}

export const getShares = () => getJson<{ items: ShareEntry[] }>('/me/shares')

// What the reader of a shared article can send back to its sender.
export const REACTIONS = ['👍', '❤️', '😂', '😮'] as const
export type Reaction = (typeof REACTIONS)[number]

// null takes it back.
export const reactToShare = (articleId: string, from: number, reaction: Reaction | null) =>
  sendJson<{ ok: true }>('POST', '/me/shares/reaction', { articleId, from, reaction })

// The reactions to what this profile sent, not shown yet.
export interface ShareReaction {
  item: SearchItem
  // The profile that reacted.
  to: number
  reaction: Reaction
  reactedAt: number
}

export const getShareReactions = () => getJson<{ items: ShareReaction[] }>('/me/shares/reactions')

export const markShareReactionsSeen = (until: number) =>
  sendJson<{ ok: true }>('POST', '/me/shares/reactions/seen', { until })

// The profiles an article can be sent to: the others that share, and did not turn this one off.
export const getShareTargets = async () => (await getJson<{ profiles: number[] }>('/me/share-targets')).profiles

export const shareArticle = (articleId: string, to: number[], note: string) =>
  sendJson<{ ok: true }>('POST', '/me/shares', { articleId, to, note })
