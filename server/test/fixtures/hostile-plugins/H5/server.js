// H5: Endless host calls hit the wall-clock and call limits. A hostile test plugin: the sandbox must make it fail.
export default {
  migrations: ['CREATE TABLE t (n INTEGER)'],
  routes: { 'GET /calls': async (_request, ctx) => { for (;;) await ctx.db.query('SELECT 1') } }
}
