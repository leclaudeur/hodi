import type { FetchBytes, FetchText } from '../../news/fetch-text.ts'

// Test doubles for outgoing HTTP: each URL maps to a body (text or bytes), an error, or a redirect.
export type FakeResponse = string | Uint8Array | Error | { redirectTo: string; text: string }

export const fakeFetch = (responses: Record<string, FakeResponse>) => {
  const calls: string[] = []

  const fetchBytes: FetchBytes = async url => {
    calls.push(url)
    const response = responses[url]

    if (response === undefined) throw new Error(`HTTP 404`)
    if (response instanceof Error) throw response
    if (typeof response === 'string') return { url, bytes: Buffer.from(response) }
    if (response instanceof Uint8Array) return { url, bytes: Buffer.from(response) }

    return { url: response.redirectTo, bytes: Buffer.from(response.text) }
  }

  const fetchText: FetchText = async url => {
    const { url: finalUrl, bytes } = await fetchBytes(url)
    return { url: finalUrl, text: bytes.toString('utf8') }
  }

  return { fetchText, fetchBytes, calls }
}

// The first bytes of a PNG file: enough for an icon to be taken as one.
export const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

export const rssFeed = (
  items: { title: string; link: string; date: string; description?: string; content?: string }[]
) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Feed</title>
${items
  .map(
    item =>
      `<item><title>${item.title}</title><link>${item.link}</link><pubDate>${item.date}</pubDate><description>${item.description ?? 'Summary'}</description>${item.content ? `<content:encoded><![CDATA[${item.content}]]></content:encoded>` : ''}</item>`
  )
  .join('\n')}
</channel></rss>`

export const articleBody = () =>
  Array.from(
    { length: 8 },
    (_, index) =>
      `<p>Paragraph ${index + 1} of a long enough article body, with plenty of words so that reader mode keeps it as the main content of the page.</p>`
  ).join('\n')

export const articlePage = (title: string, { author }: { author?: string } = {}) =>
  `<!doctype html><html><head><title>${title}</title>${author ? `<meta name="author" content="${author}">` : ''}</head><body>
<header><nav><a href="/">Home</a></nav></header>
<article><h1>${title}</h1>
${articleBody()}
</article>
<footer>Footer</footer></body></html>`
