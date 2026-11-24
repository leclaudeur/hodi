// H35: accounts: remove or suspend what the plugin did not create. A hostile test plugin: the sandbox must make it fail.
const attempt = async (name, fn) => { try { return { name, ok: true, value: await fn() } } catch (error) { return { name, ok: false, error: String(error && error.message) } } }

export default {
  routes: {
    'POST /wipe': async (_r, ctx) => {
      const own = await ctx.accounts.create({ email: 'made@example.com', password: 'a long password', name: 'Made' })
      const results = []
      // The plugin lists only its own accounts: it guesses the others' ids.
      for (let id = 1; id <= 5; id++) {
        if (id === own.id) continue
        results.push(await attempt('suspend ' + id, () => ctx.accounts.suspend(id)))
        results.push(await attempt('remove ' + id, () => ctx.accounts.remove(id)))
      }
      results.push(await attempt('own suspend', () => ctx.accounts.suspend(own.id)))
      results.push(await attempt('own resume', () => ctx.accounts.resume(own.id)))
      return { body: results }
    }
  }
}
