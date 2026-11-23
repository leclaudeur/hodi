import { describe, expect, it } from 'vitest'
import {
  filterInbox,
  firstOpen,
  inboxHrefOf,
  inboxItemOf,
  inboxKindOf,
  isWaiting,
  reviewedSourceOf,
  sortInbox
} from '../src/lib/server-inbox.ts'

const item = (
  id: number,
  type: string,
  extra: { important?: boolean; handledAt?: number | null; url?: string } = {}
) => ({
  id,
  type,
  important: extra.important ?? true,
  handledAt: extra.handledAt ?? null,
  createdAt: id * 10,
  url: extra.url ?? '#/server/overview'
})

describe('À traiter', () => {
  it('sorts each request into its kind, a plugin’s own as plugin', () => {
    expect(inboxKindOf(item(1, 'core:source-review'))).toBe('source')
    expect(inboxKindOf(item(1, 'core:code-request'))).toBe('code')
    expect(inboxKindOf(item(1, 'plugin:village:signup'))).toBe('plugin')
  })

  it('shows what waits under Tout and each kind, and what is done under Traité, the latest done first', () => {
    const items = sortInbox([
      item(1, 'core:code-request'),
      item(2, 'core:code-request', { handledAt: 50 }),
      item(3, 'core:code-request', { handledAt: 40 }),
      item(4, 'core:source-review')
    ])
    expect(isWaiting(items[0]!)).toBe(true)
    expect(items.map(entry => entry.id)).toEqual([4, 3, 2, 1])
    expect(filterInbox(items, null).map(entry => entry.id)).toEqual([4, 1])
    expect(filterInbox(items, 'code').map(entry => entry.id)).toEqual([1])
    expect(filterInbox(items, 'plugin')).toEqual([])
    expect(filterInbox(items, 'handled').map(entry => entry.id)).toEqual([2, 3])
  })

  it('opens an item by its id, or by a notice’s address, the newest with it', () => {
    const url = '#/server/inbox/source-p1-gamma'
    const items = [item(5, 'core:source-review', { url }), item(2, 'core:source-review', { url })]
    expect(inboxItemOf(items, '2')?.id).toBe(2)
    expect(inboxItemOf(items, 'source-p1-gamma')?.id).toBe(5)
    expect(inboxItemOf(items, 'source-nope')).toBeNull()
    expect(reviewedSourceOf(items[0]!)).toBe('p1-gamma')
    expect(reviewedSourceOf(item(1, 'core:code-request', { url: '#/server/accounts/3' }))).toBeNull()
  })

  it('opens a request where it is done, and a source to judge in À traiter', () => {
    expect(inboxHrefOf(item(1, 'core:code-request', { url: '#/server/accounts/3' }))).toBe('#/server/accounts/3')
    expect(inboxHrefOf(item(2, 'plugin:village:join', { url: '#/server/plugin/village/households' }))).toBe(
      '#/server/plugin/village/households'
    )
    expect(inboxHrefOf(item(3, 'core:source-review', { url: '#/server/inbox/source-a' }))).toBe('#/server/inbox/3')
    // A plugin's request with no page of its own.
    expect(inboxHrefOf(item(4, 'plugin:club:x', { url: '#/server/notifications' }))).toBe('#/server/inbox/4')
  })

  it('opens first the newest source still to judge', () => {
    const items = [
      item(3, 'core:code-request', { url: '#/server/accounts/3' }),
      item(2, 'core:source-review', { url: '#/server/inbox/source-b', handledAt: 30 }),
      item(1, 'core:source-review', { url: '#/server/inbox/source-a' })
    ]
    expect(firstOpen(items)?.id).toBe(1)
    expect(firstOpen(items.slice(0, 2))).toBeNull()
  })
})
