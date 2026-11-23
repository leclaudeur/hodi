import type { InboxItem } from '../api.ts'

// À traiter: what the server told its admins, by kind for the list's capsules, the requests still waiting first.

export type InboxKind = 'source' | 'code' | 'report' | 'plugin'

export const INBOX_KINDS: InboxKind[] = ['source', 'code', 'report', 'plugin']

const CORE_KINDS: Record<string, InboxKind> = {
  'core:source-review': 'source',
  'core:code-request': 'code',
  'core:weekly-report': 'report'
}

// A plugin's own notices are « plugin ».
export const inboxKindOf = (item: Pick<InboxItem, 'type'>): InboxKind => CORE_KINDS[item.type] ?? 'plugin'

export const isWaiting = (item: Pick<InboxItem, 'important' | 'handledAt'>) => item.important && item.handledAt === null

// The requests still waiting, then the rest, the newest first in each.
export const sortInbox = <T extends Pick<InboxItem, 'id' | 'important' | 'handledAt' | 'createdAt'>>(items: T[]) =>
  [...items].sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || b.createdAt - a.createdAt || b.id - a.id)

const INBOX_PREFIX = '#/server/inbox/'

// The item an address opens: its id from the list, or a notice's own address (« source-<id> », from an e-mail or a
// push), the newest one with it.
export const inboxItemOf = <T extends Pick<InboxItem, 'id' | 'url'>>(items: T[], key: string) =>
  /^\d+$/.test(key)
    ? (items.find(item => String(item.id) === key) ?? null)
    : (items.find(item => item.url === `${INBOX_PREFIX}${key}`) ?? null)

// The source a review item is about.
export const reviewedSourceOf = (item: Pick<InboxItem, 'url'>) =>
  item.url.startsWith(`${INBOX_PREFIX}source-`) ? item.url.slice(`${INBOX_PREFIX}source-`.length) : null
