import type { Labelled } from '../labels.ts'
import type { Catalog, Source } from './catalog.ts'
import { isYouTubeHost, siteOf } from './feed-cache.ts'

// docs/source-list.md: every source of sources.yml, one section per topic then per "Videos" section, for
// contributors to see what is already there. Written from the file by `npm run sources:list`; a test keeps the two
// in step. Lists rather than tables: GitHub sizes a table to its content, which can't be controlled.

const LANGUAGE_NAMES: Record<Source['lang'], string> = { fr: 'French', en: 'English' }
const KIND_NAMES: Record<Source['kind'], string> = { article: 'Articles', video: 'YouTube', podcast: 'Podcast' }

// A topic's emoji in its heading, by id: a topic missing here simply has none.
const TOPIC_EMOJIS: Record<string, string> = {
  // An image, not the flag itself: Windows draws flag emojis as two letters, on GitHub too.
  belgium:
    '<img src="https://github.githubassets.com/images/icons/emoji/unicode/1f1e7-1f1ea.png" alt="Belgian flag" width="20" height="20">',
  world: '🌍',
  tech: '💻',
  science: '🔬',
  'film-tv': '🎬',
  gaming: '🎮',
  ai: '🤖',
  broadcast: '📺',
  lifestyle: '✨',
  motoring: '🚗',
  sport: '⚽',
  money: '💶',
  health: '🩺',
  food: '🍳',
  travel: '✈️',
  music: '🎵',
  culture: '🎭',
  home: '🏡',
  family: '👨‍👩‍👧',
  fashion: '👗',
  climate: '🌱',
  animals: '🐾',
  other: '📦'
}

const heading = (group: Labelled & { id: string }) => {
  const emoji = TOPIC_EMOJIS[group.id]
  const name = group.labels?.en ?? group.label
  return `### ${emoji ? `${emoji} ` : ''}${name}`
}

const item = (source: Source) => {
  const site = new URL(siteOf(source))
  // A channel's address says nothing: its kind already names YouTube.
  const label = isYouTubeHost(site.hostname) ? 'channel' : site.hostname.replace(/^www\./, '')
  const details = [source.kind === 'article' ? null : KIND_NAMES[source.kind], LANGUAGE_NAMES[source.lang]]
  // The legend's marks, after the name. A source's base language is always the one it writes in.
  const marks = [
    source.base?.length ? '⭐' : null,
    // Made for young readers: never offered to the adults.
    source.adults === false ? '🧒' : null,
    source.reader ? null : '🔗'
  ].filter(Boolean)
  const name = [`**${source.name}**`, ...marks].join(' ')
  return `- ${[name, `[${label}](${site.href})`, ...details.filter(Boolean)].join(' · ')}`
}

const sections = (groups: (Labelled & { id: string; sources: Source[] })[]) =>
  groups.flatMap(group => [heading(group), '', ...group.sources.map(item), ''])

export const sourceListMarkdown = (catalog: Catalog) => {
  const count = (sources: Source[][]) => sources.reduce((total, list) => total + list.length, 0)
  const articles = count(catalog.topics.map(topic => topic.sources))
  const channels = count(catalog.listen.map(section => section.sources))
  return [
    '# Source list',
    '',
    '<!-- Written by `npm run sources:list` from sources.yml: edit sources.yml, then run it again. -->',
    '',
    'Every source in [`sources.yml`](../sources.yml), as [sources.md](sources.md) explains it:',
    '',
    `- **${articles}** article sources in **${catalog.topics.length}** topics`,
    `- **${channels}** channels and podcasts on the _Videos_ page`,
    '',
    '> [!NOTE]',
    '> - ⭐ a default source: a new household in its language starts with it; the others are in _Add a source_.',
    '> - 🧒 for young readers only, never suggested to adults.',
    '> - 🔗 link only: its articles show their summary and a link instead of opening in the reader.',
    '',
    '## Articles',
    '',
    ...sections(catalog.topics),
    '## Videos and podcasts',
    '',
    ...sections(catalog.listen),
    '[← Back to the sources](sources.md)',
    ''
  ].join('\n')
}
