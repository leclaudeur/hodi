// H32b: Without the network permission, the main thread refuses fetchText. A hostile test plugin: the sandbox must make it fail.
// ctx.fetchText may exist in the plugin: the permission is checked host-side, never by hiding a ctx method.
export default {
  routes: {
    'GET /net': async (_r, ctx) => {
      try {
        await ctx.fetchText('https://example.com/')
        return { body: { ok: true } }
      } catch (error) {
        return { body: { ok: false, error: String(error && error.message) } }
      }
    }
  }
}
