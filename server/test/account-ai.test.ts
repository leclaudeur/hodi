import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import type { Config } from '../config.ts'
import { HouseholdStore } from '../db/household-store.ts'
import { accountAiTools } from '../start/account-ai.ts'
import { startHousehold } from './helpers/household-env.ts'

describe('an account’s own AI key', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>
  before(async () => {
    household = await startHousehold()
  })
  after(() => household.close())

  const view = async (cookie: string) =>
    (await (await household.call('/account', cookie)).json()) as { ai: Record<string, unknown> | null }

  it('starts with none when the first-run screens gave none', async () => {
    assert.equal((await view(household.admin)).ai, null)
  })

  it('checks a key without keeping it', async () => {
    const good = await household.call('/account/ai/check', household.sam, 'POST', {
      provider: 'fake',
      key: 'sk-test-good12345'
    })
    assert.deepEqual(await good.json(), { result: 'ok' })
    assert.equal((await view(household.sam)).ai, null)
  })

  it('keeps a key its provider took, for that account alone, and shows only its end', async () => {
    const refused = await household.call('/account/ai', household.sam, 'PUT', {
      provider: 'fake',
      key: 'sk-test-wrong1234'
    })
    assert.equal(refused.status, 422)
    const kept = await household.call('/account/ai', household.sam, 'PUT', {
      provider: 'fake',
      key: 'sk-test-good12345'
    })
    assert.equal(kept.status, 200)
    const ai = ((await kept.json()) as { ai: Record<string, unknown> }).ai
    assert.deepEqual(ai, { provider: 'fake', providerName: 'Fausse IA', model: 'fake-1', keyHint: 'sk-test-••••2345' })
    assert.equal(JSON.stringify(await view(household.sam)).includes('sk-test-good12345'), false)
    assert.deepEqual(household.accountAi.get(household.samAccount.id), {
      provider: 'fake',
      key: 'sk-test-good12345',
      model: null
    })
    assert.equal((await view(household.admin)).ai, null)
    assert.equal(household.accountAi.ofProfile(household.samId)?.ai?.key, 'sk-test-good12345')
    // A young profile has no account, so no key.
    assert.equal(household.accountAi.ofProfile(household.leaId), null)
  })

  it('takes the key away', async () => {
    const response = await household.call('/account/ai', household.sam, 'DELETE')
    assert.equal(((await response.json()) as { ai: unknown }).ai, null)
    assert.equal(household.accountAi.get(household.samAccount.id), null)
  })

  it('needs a session', async () => {
    for (const [url, method] of [
      ['/account/ai/check', 'POST'],
      ['/account/ai', 'PUT'],
      ['/account/ai', 'DELETE']
    ] as const) {
      const response = await household.call(url, '', method, { provider: 'fake', key: 'sk-test-good12345' })
      assert.equal(response.status, 401, `${method} ${url}`)
    }
  })
})

describe('a reader’s AI tools', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>
  before(async () => {
    household = await startHousehold()
  })
  after(() => household.close())

  it('come from its account’s key, kept until the key or the region changes', () => {
    const toolsOf = accountAiTools({
      config: { timeZone: 'UTC' } as Config,
      household: new HouseholdStore(household.db),
      accounts: household.accounts,
      accountAi: household.accountAi
    })
    assert.equal(toolsOf(household.samId), null)
    household.accountAi.set(household.samAccount.id, { provider: 'anthropic', key: 'sk-test-good12345', model: null })
    const first = toolsOf(household.samId)
    assert.ok(first)
    assert.equal(toolsOf(household.samId), first)
    household.accounts.setRegion(household.samAccount.id, { timeZone: 'Asia/Tokyo' })
    assert.notEqual(toolsOf(household.samId), first)
    // A young profile has no account: no AI.
    assert.equal(toolsOf(household.leaId), null)
  })
})
