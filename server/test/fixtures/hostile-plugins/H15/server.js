// H15: ATTACH never opens Hodi database, whatever the path. A hostile test plugin: the sandbox must make it fail.
const run = async (ctx, sql) => { try { await ctx.db.run(sql); return { ok: true } } catch (error) { return { ok: false, error: String(error && error.message).slice(0, 200) } } }

export default {
  routes: {
    'GET /absolute': async (_r, ctx) => ({ body: await run(ctx, "ATTACH '/app/data/hodi.db' AS h") }),
    'GET /relative': async (_r, ctx) => ({ body: await run(ctx, "ATTACH '../../hodi.db' AS h") }),
    'GET /uri': async (_r, ctx) => ({ body: await run(ctx, "ATTACH 'file:../../hodi.db?mode=ro' AS h") }),
    'GET /memory': async (_r, ctx) => ({ body: await run(ctx, "ATTACH ':memory:' AS m") })
  }
}
