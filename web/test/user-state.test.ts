import { beforeEach, describe, expect, it, vi } from 'vitest'

// The toasts only report: they are not what is tested here.
vi.mock('../src/lib/toast.ts', () => ({ showError: vi.fn(), showInfo: vi.fn(), showSaved: vi.fn() }))

interface Call {
  method: string
  path: string
  body: unknown
}

// A server that answers every change, or a network that is down.
const server = (online: () => boolean) => {
  const calls: Call[] = []
  let revision = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!online()) throw new TypeError('Failed to fetch')
      calls.push({
        method: init?.method ?? 'GET',
        path: url.replace('/api/me', ''),
        body: init?.body ? JSON.parse(String(init.body)) : undefined
      })
      return new Response(JSON.stringify({ revision: ++revision }), { status: 200 })
    })
  )
  return calls
}

// Each test starts from a fresh device: the stores keep their state in the module.
const load = async () => {
  vi.resetModules()
  const userState = await import('../src/lib/user-state.ts')
  const readState = await import('../src/lib/read-state.ts')
  return { ...userState, ...readState }
}

beforeEach(() => {
  localStorage.clear()
})

describe('user state', () => {
  it('shows a change at once and sends it to the server', async () => {
    const calls = server(() => true)
    const store = await load()

    store.markRead('a', false)
    expect(store.isRead('a')).toBe(true)
    expect(await store.sendPendingChanges()).toBe(true)
    expect(calls).toEqual([{ method: 'POST', path: '/read', body: { ids: ['a'] } }])
    // Our own change: the copy is up to date with the server's revision.
    expect(store.getUserState().revision).toBe(1)
  })

  it('keeps changes made offline on the device, in order, and sends them when the network is back', async () => {
    let online = false
    const calls = server(() => online)
    const store = await load()

    store.markRead('a', false)
    store.dismissArticle('b')
    store.markUnread('a')
    expect(await store.sendPendingChanges()).toBe(false)
    // Kept across a reload.
    expect(JSON.parse(localStorage.getItem('hodi:user-outbox') ?? '[]')).toHaveLength(3)

    online = true
    expect(await store.sendPendingChanges()).toBe(true)
    expect(calls.map(call => `${call.method} ${call.path}`)).toEqual(['POST /read', 'POST /read', 'DELETE /read/a'])
    expect(store.isRead('a')).toBe(false)
    expect(store.isDismissed('b')).toBe(true)
  })

  it('sends articles opened one after the other in one request', async () => {
    let online = false
    const calls = server(() => online)
    const store = await load()

    for (const id of ['a', 'b', 'c', 'd']) store.markRead(id, false)
    await store.sendPendingChanges()
    online = true
    await store.sendPendingChanges()
    // The first was already on its way when the others came.
    expect(calls.map(call => call.body)).toEqual([{ ids: ['a'] }, { ids: ['b', 'c', 'd'] }])
  })

  it('never merges a hidden article into the read ones', async () => {
    let online = false
    const calls = server(() => online)
    const store = await load()

    store.markRead('a', false)
    store.markRead('b', false)
    store.dismissArticle('c')
    await store.sendPendingChanges()
    online = true
    await store.sendPendingChanges()
    expect(calls.map(call => call.body)).toEqual([{ ids: ['a'] }, { ids: ['b'] }, { ids: ['c'], hidden: true }])
  })

  it('drops a change the server refuses, and keeps the next ones', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url)
        return new Response('{}', { status: calls.length === 1 ? 400 : 200 })
      })
    )
    const store = await load()
    store.markRead('a', false)
    store.markRead('b', false)
    expect(await store.sendPendingChanges()).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('leaves nothing on the device after logging out', async () => {
    server(() => false)
    const store = await load()
    store.markRead('a', false)
    store.clearUserState()
    expect(store.isRead('a')).toBe(false)
    expect(localStorage.getItem('hodi:user-state')).toBeNull()
    expect(localStorage.getItem('hodi:user-outbox')).toBeNull()
  })
})

describe('read state', () => {
  it('keeps the open article listed until it is closed', async () => {
    server(() => true)
    const store = await load()
    store.markRead('a')
    expect(store.isRead('a')).toBe(true)
    expect(store.isReadAndClosed('a')).toBe(false)
    store.closeArticle('a')
    expect(store.isReadAndClosed('a')).toBe(true)
  })

  it('marks an article read once only', async () => {
    const calls = server(() => true)
    const store = await load()
    store.markRead('a', false)
    store.markRead('a', false)
    await store.sendPendingChanges()
    expect(calls).toHaveLength(1)
  })
})
