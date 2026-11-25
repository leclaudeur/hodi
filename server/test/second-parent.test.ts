import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { ADMIN_PASSWORD, SAM_PASSWORD, startHousehold } from './helpers/household-env.ts'

interface Child {
  accountId: number
  profileId: number
  name: string
  parents: { name: string; handle: string | null; since: number; you: boolean }[]
  invited: { name: string; handle: string | null } | null
}

interface Invitation {
  childId: number
  childName: string
  from: string
}

describe('Mon compte › Mes enfants › Parents', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>
  let zoe: Child
  before(async () => {
    household = await startHousehold()
    household.accounts.chooseHandle(household.samAccount.id, 'sam', 0)
    const made = await household.call('/account/children', household.admin, 'POST', {
      kind: 'teen',
      name: 'Zoé',
      color: 'science',
      handle: 'zoe',
      password: 'le mot de passe de Zoé'
    })
    zoe = (await made.json()) as Child
  })
  after(() => household.close())

  const listOf = async (cookie: string) =>
    (await (await household.call('/account/children', cookie)).json()) as {
      children: Child[]
      invitations: Invitation[]
    }
  const invite = (handle: string, cookie = household.admin) =>
    household.call(`/account/children/${zoe.accountId}/parents`, cookie, 'POST', { handle })

  it('invites another adult by its @identifier, never an unknown one, a young one or a stranger’s child', async () => {
    assert.equal((await invite('personne')).status, 404)
    // A young one's account is never a parent, and the parent is told so.
    // A minor's handle answers as an unknown one: telling them apart would show which handles are minors'.
    assert.equal((await invite('zoe')).status, 404)
    // Sam is no parent of Zoé: Sam cannot invite anyone for her.
    assert.equal((await invite('sam', household.sam)).status, 404)
    const sent = await invite('@sam')
    assert.equal(sent.status, 201)
    // The invited adult's own name, with its @identifier.
    assert.deepEqual(((await sent.json()) as Child).invited, { name: 'Sam', handle: 'sam' })
    assert.deepEqual(
      (await listOf(household.sam)).invitations.map(entry => [entry.childName, entry.from]),
      [['Zoé', 'Antho']]
    )
  })

  it('changes nothing when the invited adult refuses, and makes them a parent when they accept', async () => {
    const path = `/account/children/invitations/${zoe.accountId}`
    assert.equal((await household.call(path, household.sam, 'DELETE')).status, 204)
    assert.equal((await listOf(household.admin)).children.find(child => child.name === 'Zoé')?.invited, null)
    assert.equal((await household.call(path, household.sam, 'POST')).status, 404)

    await invite('sam')
    const accepted = await household.call(path, household.sam, 'POST')
    assert.equal(accepted.status, 200)
    // Its parents the oldest first, with their @identifier and since when; the one asking is « you ».
    const parents = ((await accepted.json()) as Child).parents
    assert.deepEqual(
      parents.map(parent => [parent.name, parent.handle, parent.you]),
      [
        ['Antho', household.accounts.get(household.anthoAccount.id)?.handle ?? null, false],
        ['Sam', 'sam', true]
      ]
    )
    assert.ok(parents.every(parent => parent.since > 0))
    assert.deepEqual((await listOf(household.sam)).invitations, [])
    // Sam has the same rights now: Zoé's rules are Sam's to change too.
    const renamed = await household.call(`/profiles/${zoe.profileId}`, household.sam, 'PATCH', { name: 'Zoé B.' })
    assert.equal(renamed.status, 200)
    assert.equal((await invite('sam')).status, 409)
    // Neither deletes her behind the other's back.
    const path2 = `/account/children/${zoe.accountId}`
    assert.equal((await household.call(path2, household.admin, 'DELETE', { password: ADMIN_PASSWORD })).status, 409)
    const profile = await household.call(`/profiles/${zoe.profileId}`, household.sam, 'DELETE', {
      password: SAM_PASSWORD
    })
    assert.equal(profile.status, 409)
  })

  it('lets a parent stop being one, after their password, but never the last one', async () => {
    const leave = (cookie: string, password: string) =>
      household.call(`/account/children/${zoe.accountId}/parents/me`, cookie, 'DELETE', { password })
    assert.equal((await leave(household.sam, 'pas le bon mot de passe')).status, 403)
    assert.equal((await leave(household.sam, SAM_PASSWORD)).status, 204)
    assert.deepEqual((await listOf(household.sam)).children, [])
    assert.equal((await leave(household.admin, ADMIN_PASSWORD)).status, 409)
  })

  it('takes the young ones it is the only parent of along with a deleted account, not the others', async () => {
    const made = await household.call('/account/children', household.sam, 'POST', {
      kind: 'child',
      name: 'Noa',
      color: 'sport',
      handle: 'noa',
      password: 'le mot de passe de Noa'
    })
    const noa = (await made.json()) as Child
    const view = (await (await household.call('/account', household.sam)).json()) as {
      deletion: { children: string[] }
    }
    assert.deepEqual(view.deletion.children, ['Noa'])
    const deleted = await household.call('/account', household.sam, 'DELETE', { password: SAM_PASSWORD })
    assert.equal(deleted.status, 204)
    assert.equal(household.accounts.get(noa.accountId), null)
    assert.equal(household.profiles.get(noa.profileId), null)
    assert.ok(household.accounts.get(zoe.accountId))
  })
})

describe('a parent whose profile was deleted', () => {
  let household: Awaited<ReturnType<typeof startHousehold>>
  before(async () => {
    household = await startHousehold()
    household.accounts.chooseHandle(household.samAccount.id, 'sam', 0)
  })
  after(() => household.close())

  it('cannot be invited until they sign in again, and takes the children only they run when their account goes', async () => {
    const made = await household.call('/account/children', household.sam, 'POST', {
      kind: 'child',
      name: 'Mia',
      color: 'sport',
      handle: 'mia',
      password: 'le mot de passe de Mia'
    })
    const mia = (await made.json()) as Child
    // Only its account takes an adult's profile away now; one deleted before that is gone all the same.
    assert.ok(household.profiles.delete(household.samId))
    const lea = household.accounts.ofProfile(household.leaId)!
    const asked = await household.call(`/account/children/${lea.id}/parents`, household.admin, 'POST', {
      handle: 'sam'
    })
    assert.equal(asked.status, 404)

    // Signed in again, Sam reads with a profile of his own once more, and opens it on this device.
    assert.equal((await household.call('/session', household.sam)).status, 200)
    const own = household.accounts.profileOf(household.samAccount.id, 1)!
    const opened = await household.call('/profiles/current', household.sam, 'PUT', { id: own, password: SAM_PASSWORD })
    assert.equal(opened.status, 200)
    const signedIn = household.sam.split('; ').filter(part => !part.startsWith('hodi_profile='))
    const sam = [...signedIn, ...opened.headers.getSetCookie().map(cookie => cookie.split(';')[0])].join('; ')
    const deleted = await household.call('/account', sam, 'DELETE', { password: SAM_PASSWORD })
    assert.equal(deleted.status, 204)
    assert.equal(household.accounts.get(mia.accountId), null)
    assert.equal(household.profiles.get(mia.profileId), null)
  })
})
