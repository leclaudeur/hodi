import type { InboxItem } from '../api.ts'

// À traiter: the requests the server asks its admins to act on, by kind for the list's capsules. Once done, a request
// leaves them for « Traité », the last capsule, where the server keeps it a week.

export type InboxKind = 'source' | 'code' | 'plugin'

export const INBOX_KINDS: InboxKind[] = ['source', 'code', 'plugin']

// Tout (null), one kind, or what is handled.
export type InboxFilter = InboxKind | 'handled' | null

const CORE_KINDS: Record<string, InboxKind> = {
  'core:source-review': 'source',
  'core:code-request': 'code'
}

// A plugin's own requests are « plugin ».
export const inboxKindOf = (item: Pick<InboxItem, 'type'>): InboxKind => CORE_KINDS[item.type] ?? 'plugin'

export const isWaiting = (item: Pick<InboxItem, 'important' | 'handledAt'>) => item.important && item.handledAt === null

// Tout and each kind show what still waits; « Traité » what is done, the latest done first.
export const filterInbox = <T extends Pick<InboxItem, 'type' | 'important' | 'handledAt'>>(
  items: T[],
  filter: InboxFilter
) => {
  if (filter === 'handled')
    return items.filter(item => !isWaiting(item)).sort((a, b) => (b.handledAt ?? 0) - (a.handledAt ?? 0))
  return items.filter(item => isWaiting(item) && (filter === null || inboxKindOf(item) === filter))
}

// The newest first.
export const sortInbox = <T extends Pick<InboxItem, 'id' | 'createdAt'>>(items: T[]) =>
  [...items].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)

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

// Where a waiting request opens: a source to judge in À traiter itself, anything else on the page where it is done
// (the account that asked a code, a plugin's page), never a page that only leads there.
export const inboxHrefOf = (item: Pick<InboxItem, 'id' | 'url'>) =>
  item.url.startsWith('#/server/') && !item.url.startsWith(INBOX_PREFIX) && item.url !== '#/server/notifications'
    ? item.url
    : `${INBOX_PREFIX}${item.id}`

// On a computer with none chosen, À traiter opens the first source still to judge, as Comptes opens its first account.
export const firstOpen = <T extends Pick<InboxItem, 'type' | 'important' | 'handledAt' | 'url'>>(items: T[]) =>
  items.find(item => isWaiting(item) && reviewedSourceOf(item) !== null) ?? null
