// H7: A recursive SQL query never blocks the main thread. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /recursive': async (_request, ctx) => ({
      body: await ctx.db.query('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT count(*) AS c FROM r')
    })
  }
}
