// H16: VACUUM INTO writes no file anywhere. A hostile test plugin: the sandbox must make it fail.
const run = async (ctx, sql) => { try { await ctx.db.run(sql); return { ok: true } } catch (error) { return { ok: false, error: String(error && error.message).slice(0, 200) } } }

export default {
  migrations: ['CREATE TABLE t (n INTEGER)'],
  routes: {
    'GET /over-hodi': async (_r, ctx) => ({ body: await run(ctx, "VACUUM INTO '/app/data/hodi.db'") }),
    'GET /beside': async (_r, ctx) => ({ body: await run(ctx, "VACUUM INTO '../x.db'") }),
    'GET /own-dir': async (_r, ctx) => ({ body: await run(ctx, "VACUUM INTO 'copy.db'") })
  }
}
