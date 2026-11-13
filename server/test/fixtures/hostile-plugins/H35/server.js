// H35: households: remove or suspend what the plugin did not create. A hostile test plugin: the sandbox must make it fail.
const attempt = async (name, fn) => { try { return { name, ok: true, value: await fn() } } catch (error) { return { name, ok: false, error: String(error && error.message) } } }

export default {
  routes: {
    'POST /wipe': async (_r, ctx) => {
      const all = await ctx.households.list()
      const own = await ctx.households.create({ name: 'Plugin made', admin: null })
      const results = []
      for (const household of all) {
        results.push(await attempt('suspend ' + household.id, () => ctx.households.suspend(household.id)))
        results.push(await attempt('remove ' + household.id, () => ctx.households.remove(household.id)))
      }
      results.push(await attempt('remove own', () => ctx.households.remove(own.id)))
      return { body: results }
    }
  }
}
