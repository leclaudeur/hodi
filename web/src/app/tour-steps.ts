import type { TopicSummary } from '../api.ts'
import { t } from '../lib/i18n.ts'
import { topicHref } from '../lib/use-hash-route.ts'

export interface Step {
  // The first screen: topics to pick, in the middle (no target).
  pick?: boolean
  // Nothing to light up: the bubble alone, in the middle, with its "Suivant".
  center?: boolean
  // What to press: the first one shown on screen.
  target: string
  title: string
  // One sentence per line, one action per sentence.
  text: string[]
  // When the target is not on this screen (a phone's settings have no topics): the way to it, and what to say.
  via?: { target: string; text: string[] }
  // Where the step makes sense: away from it (the dialog closed, another page), the tour steps back to the last
  // step that does.
  where: () => boolean
  // The step ends on a press of its target, once a source is added (the dialog then closes by itself), or on its own
  // "Compris" (nothing to press: only something to look at).
  until: 'press' | 'added' | 'next'
  // "Suivant" closes the dialog the step sits in, so the next step's target can be pressed.
  closeDialog?: boolean
}

const on = (prefix: string) => () => window.location.hash.startsWith(prefix)
const inDialog = () => document.querySelector('dialog[open] [data-tour="add-way"]') !== null
const inSheet = () => document.querySelector('dialog[open] [data-tour="level"]') !== null

// The game's two steps: the header's avatar, then the level in the sheet it opens.
const gameSteps = (): Step[] => [
  {
    target: '[data-tour="profile"]',
    title: t('tour.profile.title'),
    text: [t('tour.profile.points'), t('tour.profile.open')],
    via: {
      target: 'a[href="#/"]',
      text: [t('tour.profile.points'), t('tour.profile.via')]
    },
    where: () => true,
    until: 'press'
  },
  {
    target: 'dialog[open] [data-tour="level"]',
    title: t('tour.level.title'),
    text: [t('tour.level.grades'), t('tour.level.badges'), t('tour.level.wear')],
    where: inSheet,
    until: 'next'
  }
]

// The tour's topic: the first one picked (Sport until then). Built again when the language changes.
export const steps = ({ id, label }: TopicSummary, game: boolean): Step[] => [
  {
    pick: true,
    target: '',
    title: t('tour.welcome.title'),
    text: [t('tour.welcome.ask'), t('tour.welcome.pick')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/settings"]',
    title: t('tour.first.title'),
    text: [t('tour.first.together', { topic: label }), t('tour.first.settings')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/settings/sources"]',
    title: t('tour.sources.title'),
    text: [t('tour.sources.what'), t('tour.sources.open')],
    where: on('#/settings'),
    until: 'press'
  },
  {
    target: '[data-tour="add-source"]',
    title: t('tour.add.title'),
    text: [t('tour.add.how'), t('tour.add.press')],
    where: on('#/settings/sources'),
    until: 'press'
  },
  {
    target: '[data-tour="add-way"] [role="radio"]:last-child',
    title: t('tour.byTopic.title'),
    text: [t('tour.byTopic.noLink'), t('tour.byTopic.offers'), t('tour.byTopic.pick')],
    where: inDialog,
    until: 'press'
  },
  {
    target: `[data-tour="add-topics"] [data-topic="${id}"]`,
    title: label,
    text: [t('tour.topic.suggestions'), t('tour.topic.pick', { topic: label })],
    where: inDialog,
    until: 'press'
  },
  {
    target: '[data-tour="add-sites"]',
    title: t('tour.site.title'),
    text: [t('tour.site.feed'), t('tour.site.add')],
    where: inDialog,
    until: 'added'
  },
  {
    target: `a[href="${topicHref(id)}"]`,
    title: t('tour.direction.title', { topic: label }),
    text: [t('tour.direction.filed', { topic: label }), t('tour.direction.open')],
    via: {
      target: 'a[href="#/"]',
      text: [t('tour.direction.filed', { topic: label }), t('tour.direction.via')]
    },
    where: () => true,
    until: 'press'
  },
  ...(game ? gameSteps() : [])
]

// A teen's tour: its parents chose its sources, so it adds none. Its feed, how to ask for a source, its profile,
// then the end. A child's will be its own, with its own interface.
export const teenSteps = (game: boolean): Step[] => [
  {
    center: true,
    target: '',
    title: t('tour.teen.welcome.title'),
    text: [t('tour.teen.welcome.yours'), t('tour.teen.welcome.how')],
    where: () => true,
    until: 'next'
  },
  {
    target: '[data-tour="feed"]',
    title: t('tour.teen.feed.title'),
    text: [t('tour.teen.feed.chosen'), t('tour.teen.feed.open')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/settings"]',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.missing'), t('tour.teen.ask.settings')],
    where: () => true,
    until: 'press'
  },
  {
    target: 'a[href="#/settings/sources"]',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.sources')],
    where: on('#/settings'),
    until: 'press'
  },
  {
    target: '[data-tour="ask-source"]',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.press')],
    // On a computer, the "ask" card is in the closed "Mes demandes".
    via: { target: '[data-tour="requests"]', text: [t('tour.teen.ask.requests')] },
    where: on('#/settings/sources'),
    until: 'press'
  },
  {
    // Inside the dialog it opened: the field for the link, with its icon.
    target: ':has(> [data-tour="ask-link"])',
    title: t('tour.teen.ask.title'),
    text: [t('tour.teen.ask.paste'), t('tour.teen.ask.parents')],
    where: on('#/settings/sources'),
    until: 'next',
    closeDialog: true
  },
  ...(game ? gameSteps() : []),
  {
    center: true,
    target: '',
    title: t('tour.teen.end.title'),
    text: [t('tour.teen.end.enjoy')],
    where: () => true,
    until: 'next'
  }
]

export const SPORT: TopicSummary = { id: 'sport', label: 'Sport' }
