import { Agent, fetch } from 'undici'
import { type IsAllowedUrl, PrivateAddressError, isPublicAddressUrl, publicOnlyLookup } from './address-guard.ts'

// Outgoing HTTP for feeds, article pages and source icons: short timeout, size cap, identifiable user agent, and
// never an address on the server's own network, at the first request or after any redirect.
export const USER_AGENT = 'Mozilla/5.0 (compatible; hodi/0.1; personal news reader)'

// A browser's, for the sites that turn the one above away (a site looked at when adding it, a YouTube page).
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export interface FetchedText {
  url: string
  text: string
}

export interface FetchedBytes {
  url: string
  bytes: Buffer
}

// headers: a few more, for YouTube's pages (their language, the consent cookie past the cookie wall).
export type FetchText = (
  url: string,
  options?: { userAgent?: string; headers?: Record<string, string> }
) => Promise<FetchedText>

export type FetchBytes = (url: string, options?: { maxBytes?: number }) => Promise<FetchedBytes>

export interface FetchTextOptions {
  timeoutMs?: number
  maxBytes?: number
  // Tests reach their local server through this; everything else uses the public-address check.
  isAllowed?: IsAllowedUrl
}

const MAX_REDIRECTS = 5

export class BlockedAddressError extends Error {
  constructor(url: string) {
    super(`Blocked address: ${new URL(url).hostname}`)
  }
}

const REFUSED = /^HTTP (401|403|429)$/

// Every connection resolves its name through the public-only lookup (see address-guard.ts).
const dispatcher = new Agent({ connect: { lookup: publicOnlyLookup } })

// Each redirect is followed by hand, so its address is checked before the request leaves.
const fetchChecked = async (
  url: string,
  {
    timeoutMs,
    userAgent,
    isAllowed,
    headers = {}
  }: { timeoutMs: number; userAgent: string; isAllowed: IsAllowedUrl; headers?: Record<string, string> }
) => {
  const signal = AbortSignal.timeout(timeoutMs)
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isAllowed(new URL(current)))) throw new BlockedAddressError(current)
    const response = await fetch(current, {
      headers: { ...headers, 'User-Agent': userAgent, Accept: '*/*' },
      redirect: 'manual',
      signal,
      dispatcher
    }).catch((error: unknown) => {
      if (error instanceof Error && error.cause instanceof PrivateAddressError) throw new BlockedAddressError(current)
      throw error
    })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return { url: current, response }
    await response.body?.cancel()
    current = new URL(location, current).toString()
  }
  throw new Error('Too many redirects')
}

const fetchBytes = async (
  url: string,
  {
    timeoutMs,
    maxBytes,
    userAgent,
    isAllowed,
    headers
  }: Required<FetchTextOptions> & { userAgent: string; headers?: Record<string, string> }
) => {
  const { url: finalUrl, response } = await fetchChecked(url, { timeoutMs, userAgent, isAllowed, headers })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const declared = Number(response.headers.get('content-length') ?? 0)

  if (declared > maxBytes) {
    throw new Error(`Response too large (${declared} bytes)`)
  }

  const chunks: Uint8Array[] = []
  let size = 0

  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength

    if (size > maxBytes) {
      throw new Error(`Response larger than ${maxBytes} bytes`)
    }

    chunks.push(chunk)
  }

  return { url: finalUrl, bytes: Buffer.concat(chunks) }
}

export const createFetchText =
  ({
    timeoutMs = 5000,
    maxBytes = 5 * 1024 * 1024,
    isAllowed = isPublicAddressUrl
  }: FetchTextOptions = {}): FetchText =>
  async (url, { userAgent, headers } = {}) => {
    const { url: finalUrl, bytes } = await fetchBytes(url, {
      timeoutMs,
      maxBytes,
      isAllowed,
      headers,
      userAgent: userAgent ?? USER_AGENT
    }).catch((error: unknown) => {
      // A site that turns the reader's agent away (many news sites' bot walls) is asked once more as a browser.
      if (userAgent || !(error instanceof Error && REFUSED.test(error.message))) throw error
      return fetchBytes(url, { timeoutMs, maxBytes, isAllowed, headers, userAgent: BROWSER_USER_AGENT })
    })
    return { url: finalUrl, text: bytes.toString('utf8') }
  }

export const createFetchBytes =
  ({
    timeoutMs = 5000,
    maxBytes = 5 * 1024 * 1024,
    isAllowed = isPublicAddressUrl
  }: FetchTextOptions = {}): FetchBytes =>
  (url, options = {}) =>
    fetchBytes(url, { timeoutMs, maxBytes: options.maxBytes ?? maxBytes, isAllowed, userAgent: USER_AGENT })

// YouTube's pages: as a browser in Belgium, with the consent cookie that skips the cookie wall shown in Europe. A
// video's page weighs a megabyte or two.
export const YOUTUBE_PAGE = {
  userAgent: BROWSER_USER_AGENT,
  headers: { 'Accept-Language': 'fr-BE,fr;q=0.9,en;q=0.8', Cookie: 'SOCS=CAI' }
}
export const YOUTUBE_PAGE_BYTES = 8 * 1024 * 1024
