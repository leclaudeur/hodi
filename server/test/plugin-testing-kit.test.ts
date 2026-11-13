import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { type TestPlugin, testPlugin } from '../../plugin-sdk/testing.ts'

// A plugin as an author writes one: its folder, built by the kit as `hodi-plugin build` would.
const pluginFolder = (permissions: Record<string, unknown> = {}) => {
  const folder = mkdtempSync(path.join(tmpdir(), 'hodi-kit-plugin-'))
  writeFileSync(
    path.join(folder, 'plugin.json'),
    JSON.stringify({
      id: 'kit',
      name: 'Kit',
      version: '0.1.0',
      description: 'Tried by the test kit.',
      api: 2,
      audience: 'all',
      settings: [{ key: 'greeting', type: 'text', default: 'Bonjour', maxLength: 40 }],
      permissions: { network: ['news.example.test'], ...permissions }
    })
  )
  mkdirSync(path.join(folder, 'server'))
  writeFileSync(
    path.join(folder, 'server', 'index.js'),
    `export default {
      migrations: ['CREATE TABLE notes (profile INTEGER, text TEXT)'],
      routes: {
        'POST /notes': async (request, ctx) => {
          ctx.db.run('INSERT INTO notes (profile, text) VALUES (?, ?)', [request.who.profileId, request.body.text])
          return { status: 201, body: { greeting: ctx.settings().greeting } }
        },
        'GET /me': async request => ({ body: { accountId: request.who.accountId } }),
        'GET /page': async (_request, ctx) => ({ body: (await ctx.fetchText('https://news.example.test/')).text }),
        'POST /mail': async (request, ctx) => { await ctx.mail.send({ to: request.body.to, subject: 'Hi', text: 'Hello' }); return { body: null } },
        'DELETE /notes': { proof: true, handler: async () => ({ status: 204 }) }
      },
      serverRoutes: { 'GET /count': async (_request, ctx) => ({ body: ctx.db.get('SELECT count(*) AS n FROM notes') }) },
      publicRoutes: {
        'POST /signup': async (request, ctx) => {
          const account = await ctx.accounts.create({ email: request.body.email, password: request.body.password })
          return account ? { status: 201, body: {}, signIn: account.id } : { status: 409, body: {} }
        }
      },
      tasks: { purge: { every: 60, run: async ctx => { ctx.db.run('DELETE FROM notes'); ctx.log('purged') } } },
      aiActions: { summarize: async ({ input }, ctx) => ({ text: await ctx.ai.ask({ prompt: input.text }) }) },
      onProfileDeleted: async ({ profileId }, ctx) => { ctx.db.run('DELETE FROM notes WHERE profile = ?', [profileId]) },
      exportData: async ({ profileId }, ctx) => ctx.db.query('SELECT text FROM notes WHERE profile = ?', [profileId])
    }`
  )
  return folder
}

const kits: TestPlugin[] = []
after(async () => {
  await Promise.all(kits.map(kit => kit.stop()))
})
const start = async (...args: Parameters<typeof testPlugin>) => {
  const kit = await testPlugin(...args)
  kits.push(kit)
  return kit
}

describe('the plugin test kit', () => {
  it('runs a plugin’s routes, tasks, hooks and AI as Hodi does, around a small Hodi', async () => {
    const kit = await start(pluginFolder({ accounts: true, signIn: true, publicRoutes: true, mail: true, ai: true }), {
      settings: { greeting: 'Salut' },
      sites: { 'https://news.example.test/': '<p>Une page</p>' },
      ai: question => `Résumé de : ${question.prompt}`
    })
    const lea = await kit.addPerson({ name: 'Léa' })
    const tom = await kit.addPerson({ name: 'Tom', kind: 'child' })
    assert.equal(tom.accountId, null)

    assert.deepEqual(await kit.route('POST /notes', { as: lea, body: { text: 'lait' } }).then(answer => answer.body), {
      greeting: 'Salut'
    })
    assert.deepEqual((await kit.serverRoute('GET /count')).body, { n: 1 })
    // who.accountId: the caller's account, none for a child.
    assert.deepEqual((await kit.route('GET /me', { as: lea })).body, { accountId: lea.accountId })
    assert.deepEqual((await kit.route('GET /me', { as: tom })).body, { accountId: null })
    assert.equal((await kit.route('GET /page')).body, '<p>Une page</p>')

    // E-mails and sign-ins are caught, not sent.
    await kit.route('POST /mail', { body: { to: 'marie@example.test' } })
    // A sensitive route: refused until the person's password was typed in Hodi's dialog.
    assert.deepEqual(await kit.route('DELETE /notes').then(answer => [answer.status, answer.body]), [
      403,
      { error: 'proof_required' }
    ])
    assert.equal((await kit.route('DELETE /notes', { proof: true })).status, 204)
    assert.equal(kit.mails[0]?.to, 'marie@example.test')
    const signUp = await kit.publicRoute('POST /signup', {
      body: { email: 'new@example.test', password: 'a long enough password' }
    })
    assert.equal(signUp.status, 201, JSON.stringify([signUp.body, kit.log]))
    assert.equal(kit.signedIn.length, 1)

    // A click on its AiButton, by an adult; a child cannot.
    const clicked = await kit.click('summarize', { text: 'Un long article.' }, lea)
    assert.deepEqual(clicked.body, { answer: { text: 'Résumé de : Un long article.' } })
    assert.equal(kit.questions.length, 1)
    assert.equal((await kit.click('summarize', { text: 'x' }, tom)).status, 403)

    // Its part of the copy, then forgetting the profile.
    assert.deepEqual(await kit.exportData(lea), [{ text: 'lait' }])
    await kit.profileDeleted(lea.profileId)
    assert.deepEqual(await kit.exportData(lea), [])

    await kit.route('POST /notes', { body: { text: 'pain' } })
    await kit.runTask('purge')
    assert.deepEqual((await kit.serverRoute('GET /count')).body, { n: 0 })
    assert.ok(kit.log.some(line => line.endsWith('purged')))
  })

  it('starts an unsigned build as Hodi would, without what only a verified plugin gets', async () => {
    const kit = await start(pluginFolder(), { sites: { 'https://news.example.test/': 'ok' } })
    assert.equal((await kit.route('GET /page')).status, 200)
    await assert.rejects(
      testPlugin(pluginFolder({ accounts: true }), { unsigned: true }),
      /only a verified plugin may ask for permissions\.accounts/
    )
  })
})
