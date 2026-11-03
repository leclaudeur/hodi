import { YOUTUBE_PAGE, YOUTUBE_PAGE_BYTES, createFetchText } from './fetch-text.ts'
// A YouTube video's length, which its feed doesn't give: read once from its page, then kept.

export type FetchVideoDuration = (videoId: string) => Promise<number | null>

const VIDEO_ID = /^[\w-]{11}$/
const MAX_PAGE_BYTES = 4 * 1024 * 1024

// The player's data ("lengthSeconds":"754"), or the page's microdata (<meta itemprop="duration" content="PT12M34S">).
export const parseVideoDuration = (html: string): number | null => {
  const length = /"lengthSeconds":"(\d+)"/.exec(html)
  if (length) return Number(length[1]) || null

  const iso = /itemprop="duration" content="PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"/.exec(html)
  if (!iso) return null
  const [, hours = '0', minutes = '0', seconds = '0'] = iso
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) || null
}

// The consent cookie skips the cookie wall YouTube shows in Europe; nothing else is sent. The page comes through the
// address guard, size cap and timeout of every other request.
export const createFetchVideoDuration = ({ timeoutMs = 8000 } = {}): FetchVideoDuration => {
  const fetchPage = createFetchText({ timeoutMs, maxBytes: YOUTUBE_PAGE_BYTES })
  return async videoId => {
    if (!VIDEO_ID.test(videoId)) return null

    const page = await fetchPage(`https://www.youtube.com/watch?v=${videoId}`, YOUTUBE_PAGE)
    const text = page.text.slice(0, MAX_PAGE_BYTES)
    const seconds = parseVideoDuration(text)
    // Logged by the caller: a consent or "not a bot" page shows here as another address or a small page.
    if (seconds === null) throw new Error(`no length in ${page.url} (${text.length} characters)`)
    return seconds
  }
}
