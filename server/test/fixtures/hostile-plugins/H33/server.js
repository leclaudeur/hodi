// H33: signIn only for an account this call created or checked. A hostile test plugin: the sandbox must make it fail.
const attempt = async (name, fn) => { try { return { name, ok: true, value: await fn() } } catch (error) { return { name, ok: false, error: String(error && error.message) } } }

// Accounts 1 to 20 are tried: the setup made the server admin first, then an adult.
const someone = async ctx => { for (let id = 1; id <= 20; id++) { const account = await ctx.accounts.get(id); if (account) return account } return null }
export default {
  migrations: ['CREATE TABLE seen (account_id INTEGER)'],
  publicRoutes: {
    // 1. Straight to the server admin, without any check.
    'POST /admin': async (_r, ctx) => ({ body: { tried: 'admin' }, signIn: (await someone(ctx))?.id ?? 1 }),
    // 2. An adult found by e-mail, without checkPassword.
    'POST /by-email': async (request, ctx) => ({ body: {}, signIn: (await ctx.accounts.findByEmail(String(request.body.email)))?.id }),
    // 3. checkPassword succeeds for the plugin's own account A, then signIn names another account B.
    'POST /swap': async (request, ctx) => {
      const own = await ctx.accounts.checkPassword(String(request.body.email), String(request.body.password))
      const other = await ctx.accounts.findByEmail(String(request.body.target))
      return { body: { checked: Boolean(own) }, signIn: other?.id }
    },
    // 4. An account checked in an EARLIER call, kept in the plugin's database.
    'POST /remember': async (request, ctx) => {
      const own = await ctx.accounts.checkPassword(String(request.body.email), String(request.body.password))
      if (own) ctx.db.run('INSERT INTO seen VALUES (?)', [own.id])
      return { body: { kept: Boolean(own) } }
    },
    'POST /replay': async (_r, ctx) => ({ body: {}, signIn: ctx.db.get('SELECT account_id FROM seen')?.account_id }),
    // 5. An account "created" with the e-mail of an existing one, by Google: must not take it over.
    'POST /google-takeover': async (request, ctx) => {
      const made = await attempt('create', () => ctx.accounts.create({ email: String(request.body.target), provider: 'google' }))
      return { body: made, signIn: made.ok && made.value ? made.value.id : undefined }
    },
    // 6. signIn as a string, an object, a negative or huge id.
    'POST /odd': async () => ({ body: {}, signIn: { id: 1 } })
  }
}
