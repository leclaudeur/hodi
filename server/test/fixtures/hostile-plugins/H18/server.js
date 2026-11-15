// H18: No SQLite extension loads. A hostile test plugin: the sandbox must make it fail.
const run = async (ctx, sql) => { try { await ctx.db.run(sql); return { ok: true } } catch (error) { return { ok: false, error: String(error && error.message).slice(0, 200) } } }

export default { routes: { 'GET /extension': async (_r, ctx) => ({ body: await run(ctx, "SELECT load_extension('/tmp/x.so')") }) } }
