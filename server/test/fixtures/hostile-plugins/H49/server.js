// H49: checkPassword cannot be used to guess passwords or block sign-in. A hostile test plugin: the sandbox must make it fail.
const attempt = async (name, fn) => { try { return { name, ok: true, value: await fn() } } catch (error) { return { name, ok: false, error: String(error && error.message) } } }

export default {
  publicRoutes: {
    'POST /guess': async (request, ctx) => {
      const results = []
      for (let i = 0; i < 200; i++) results.push(await attempt(String(i), () => ctx.accounts.checkPassword(String(request.body.email), 'guess-' + i)))
      return { body: { tried: results.length, refused: results.filter(r => !r.ok).length } }
    }
  }
}
