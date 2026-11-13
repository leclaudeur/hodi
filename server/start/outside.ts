import webpush, { type PushSubscription } from 'web-push'
import type { Config } from '../config.ts'
import { type FetchBytes, type FetchText, createFetchBytes, createFetchText } from '../news/fetch-text.ts'
import { type FetchVideoDuration, createFetchVideoDuration } from '../news/video-durations.ts'
import { type IsPublicUrl, isPublicUrl } from '../news/source-finder.ts'

// Everything Hodi reaches outside the server: the sites it reads and the push services. index.ts gives the real ones;
// the end-to-end tests give pages of their own (e2e/server.ts).
export interface Outside {
  fetchText: FetchText
  // Looking at a link someone pastes to add a source: a shorter wait.
  findFetchText: FetchText
  // Whether a pasted link may be fetched at all: a public https address.
  isPublicLink: IsPublicUrl
  fetchBytes: FetchBytes
  // Article pictures, made smaller: a longer wait.
  fetchPictures: FetchBytes
  // A plugin's package from Hodi's registry: up to 50 MB, a longer wait still.
  fetchPackages: FetchBytes
  fetchVideoDuration: FetchVideoDuration
  sendPush: (target: PushSubscription, payload: unknown, vapid: Config['vapid']) => Promise<void>
}

export const realOutside = (): Outside => ({
  fetchText: createFetchText(),
  findFetchText: createFetchText({ timeoutMs: 8000 }),
  isPublicLink: isPublicUrl,
  fetchBytes: createFetchBytes(),
  fetchPictures: createFetchBytes({ timeoutMs: 10_000 }),
  fetchPackages: createFetchBytes({ timeoutMs: 60_000 }),
  fetchVideoDuration: createFetchVideoDuration(),
  sendPush: async (target, payload, vapid) => {
    await webpush.sendNotification(target, JSON.stringify(payload), {
      vapidDetails: vapid,
      // An alert older than a day is no longer news.
      TTL: 24 * 60 * 60,
      urgency: 'normal'
    })
  }
})
