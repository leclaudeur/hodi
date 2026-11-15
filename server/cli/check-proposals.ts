import path from 'node:path'
import { loadCatalog } from '../news/catalog.ts'
import { createFetchText } from '../news/fetch-text.ts'
import { createSourceFinder } from '../news/source-finder.ts'

// Adds nothing: looks up every "Sources proposées" of sources.yml as its "Ajouter" button would (the feed
// found from the site, then its latest articles tried in the reader) and reports what a profile would get.
// Exits with 1 when at least one proposal would fail to add.
const find = createSourceFinder({ fetchText: createFetchText({ timeoutMs: 8000 }) })

const STATUS_LABELS = {
  invalid: 'not a valid address',
  blocked: 'private address refused',
  none: 'no feed found on the site',
  empty: 'feed has no items',
  failed: 'site unreachable or refusing Hodi',
  reddit: 'Reddit closed its feeds'
}

const catalog = loadCatalog(path.resolve(process.env.SOURCES_FILE ?? 'sources.yml'))
const proposals = catalog.topics.flatMap(topic =>
  topic.sources.filter(source => !source.base?.length).map(source => ({ topic: topic.id, source }))
)

const checks = await Promise.all(
  proposals.map(async ({ topic, source }) => {
    const result = await find(source.url)
    if (result.status !== 'ok') return { topic, source, ok: false, detail: STATUS_LABELS[result.status] }
    if (result.source.kind !== 'article') return { topic, source, ok: false, detail: 'not an article feed' }
    const { url, readable } = result.source
    const reader = readable.tried > 0 ? `reader ${readable.ok}/${readable.tried}` : 'link only'
    return {
      topic,
      source,
      ok: true,
      detail: `${result.source.samples.length > 0 ? 'items' : 'no items'}, ${reader}, ${url}`
    }
  })
)

const width = Math.max(...proposals.map(({ topic, source }) => `${topic}/${source.id}`.length))

for (const { topic, source, ok, detail } of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'}  ${`${topic}/${source.id}`.padEnd(width)}  ${detail}`)
}

const failed = checks.filter(check => !check.ok).length

console.log(`\n${checks.length - failed}/${checks.length} proposals OK`)
process.exitCode = failed > 0 ? 1 : 0
