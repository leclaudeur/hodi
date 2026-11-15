import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadCatalog } from '../news/catalog.ts'
import { sourceListMarkdown } from '../news/source-list.ts'

// Writes docs/source-list.md from sources.yml, after a source is added, changed or removed.
const catalog = loadCatalog(path.resolve(process.env.SOURCES_FILE ?? 'sources.yml'))
writeFileSync(path.resolve('docs/source-list.md'), sourceListMarkdown(catalog))
console.log('docs/source-list.md written')
