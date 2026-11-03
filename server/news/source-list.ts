import type { Catalog, Source } from './catalog.ts'
import { siteOf } from './news-service.ts'

// docs/source-list.md: every source of sources.yml in one table, topics then "Vidéos" sections, for contributors to see
// what is already there. Written from the file by `npm run sources:list`; a test keeps the two in step.

const LANGUAGE_NAMES: Record<Source['lang'], string> = { fr: 'French', en: 'English' }
const KIND_NAMES: Record<Source['kind'], string> = { article: 'Articles', video: 'YouTube', podcast: 'Podcast' }

// A table cell: a pipe would end it early.
const cell = (text: string) => text.replace(/\|/g, '\\|')

const row = (group: string, source: Source) => {
  const site = new URL(siteOf(source))
  // A channel's address says nothing: its kind already names YouTube.
  const label = site.hostname.endsWith('youtube.com') ? 'channel' : site.hostname.replace(/^www\./, '')
  const link = `[${cell(label)}](${site.href})`
  const notes = [
    source.base?.length ? `base (${source.base.join(', ')})` : null,
    // Made for young readers: never offered to the adults.
    source.adults === false ? `young only (${(source.young ?? []).join(', ')})` : null,
    source.reader ? null : 'link only'
  ].filter(Boolean)
  return `| ${[
    group,
    cell(source.name),
    KIND_NAMES[source.kind],
    link,
    LANGUAGE_NAMES[source.lang],
    notes.join(', ')
  ].join(' | ')} |`
}

// One table for every group, rather than one per group: GitHub sizes a table to its content, so separate
// tables would each have their own width. The group's name shows on its first row only.
const table = (groups: { label: string; sources: Source[] }[]) => [
  '| Topic | Source | Kind | Site | Language | Notes |',
  '| --- | --- | --- | --- | --- | --- |',
  ...groups.flatMap(group =>
    group.sources.map((source, index) => row(index === 0 ? `**${cell(group.label)}**` : '', source))
  )
]

export const sourceListMarkdown = (catalog: Catalog) => {
  const count = (sources: Source[][]) => sources.reduce((total, list) => total + list.length, 0)
  const lines = [
    '# Source list',
    '',
    '<!-- Written by `npm run sources:list` from sources.yml: edit sources.yml, then run it again. -->',
    '',
    `Every source in [\`sources.yml\`](../sources.yml): ${count(catalog.topics.map(topic => topic.sources))} article sources in ${catalog.topics.length} topics, and ${count(catalog.listen.map(section => section.sources))} channels and podcasts in "Vidéos". A new source is checked with \`check-sources\` before it is added (see [sources.md](sources.md)).`,
    '',
    '"base" sources are the ones a new household in that language starts with; the others are offered in "Ajouter une source". "link only" sources show their feed summary and a link instead of opening in the reader.',
    '',
    '## Sources',
    ''
  ]
  // Videos and podcasts in the same table, after the articles: a second table would have its own width.
  const groups = [
    ...catalog.topics,
    ...catalog.listen.map(section => ({ ...section, label: `Vidéos › ${section.label}` }))
  ]
  lines.push(...table(groups), '')
  return lines.join('\n')
}
