// H31: fetchText refuses every internal address. A hostile test plugin: the sandbox must make it fail.
const attempt = async (ctx, url) => { try { await ctx.fetchText(url); return { url, ok: true } } catch { return { url, ok: false } } }
const urls = ['http://127.0.0.1:3000/api/profiles', 'http://localhost:3000/health', 'http://169.254.169.254/latest/meta-data/', 'http://[::1]:3000/', 'http://10.0.0.1/', 'http://0.0.0.0:3000/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://rebind.test/']
export default { routes: { 'GET /ssrf': async (_r, ctx) => ({ body: await Promise.all(urls.map(url => attempt(ctx, url))) }) } }
