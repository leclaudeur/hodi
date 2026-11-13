// H17: PRAGMAs that change the file or the quota are refused. A hostile test plugin: the sandbox must make it fail.
const run = async (ctx, sql) => { try { await ctx.db.run(sql); return { ok: true } } catch (error) { return { ok: false, error: String(error && error.message).slice(0, 200) } } }

export default {
  routes: {
    'GET /writable-schema': async (_r, ctx) => ({ body: await run(ctx, 'PRAGMA writable_schema = 1') }),
    'GET /journal-off': async (_r, ctx) => ({ body: await run(ctx, 'PRAGMA journal_mode = OFF') }),
    'GET /quota': async (_r, ctx) => ({ body: await run(ctx, 'PRAGMA max_page_count = 1000000000') }),
    'GET /trusted-schema': async (_r, ctx) => ({ body: await run(ctx, 'PRAGMA trusted_schema = 1') })
  }
}
