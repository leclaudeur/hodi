import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { needsProof } from '../http/proof-gate.ts'
import { ADMIN_PASSWORD, startHousehold } from './helpers/household-env.ts'

// Every red button of the app and of /server: refused without the password, whatever the route would answer next.
// No password at all counts nothing against the device, so the list goes through without being throttled.
const ROUTES: [string, string, Record<string, unknown>?][] = [
  ['DELETE', '/me/read'],
  ['DELETE', '/me/readings'],
  ['PUT', '/me/preferences/reset', { preferences: {} }],
  ['DELETE', '/sources/gazette'],
  ['DELETE', '/profiles/99'],
  ['DELETE', '/profiles/99/account-devices/7'],
  ['DELETE', '/account/devices/7'],
  ['DELETE', '/account/ai'],
  ['DELETE', '/server/mail'],
  ['DELETE', '/storage/texts'],
  ['POST', '/server/reports/gazette', { decision: 'unlist' }],
  ['POST', '/server/reviews/sources/gazette', { decision: 'refuse', teen: false, child: false }]
]

describe('the red buttons', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>

  before(async () => {
    household = await startHousehold()
  })
  after(() => household.close())

  for (const [method, path, body] of ROUTES) {
    it(`asks for the password before ${method} ${path}`, async () => {
      const refused = await household.call(path, household.admin, method, body ?? {})
      assert.equal(refused.status, 403)
      assert.deepEqual(await refused.json(), { error: 'invalid_password' })
    })
  }

  it('lets the route answer once the password is right, never a wrong one', async () => {
    const wrong = await household.call('/account/ai', household.admin, 'DELETE', { password: 'pas le bon' })
    assert.deepEqual([wrong.status, await wrong.json()], [403, { error: 'invalid_password' }])
    const cleared = await household.call('/account/ai', household.admin, 'DELETE', { password: ADMIN_PASSWORD })
    assert.equal(cleared.status, 200)
  })

  it('leaves alone what undoes nothing', () => {
    assert.equal(needsProof('POST', '/server/reports/gazette', { decision: 'ignore' }), false)
    assert.equal(needsProof('POST', '/server/reviews/sources/gazette', { decision: 'accept' }), false)
    assert.equal(needsProof('DELETE', '/me/read/abcdefghij012345', {}), false)
    assert.equal(needsProof('PUT', '/me/preferences', {}), false)
  })
})
