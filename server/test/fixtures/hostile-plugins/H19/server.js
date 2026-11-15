// H19: Filling the disk stops at the quota. A hostile test plugin: the sandbox must make it fail.
export default {
  migrations: ['CREATE TABLE junk (data BLOB)'],
  routes: {
    'GET /fill': async (_r, ctx) => {
      try { for (;;) await ctx.db.run('INSERT INTO junk (data) VALUES (zeroblob(1000000))') } catch (error) { return { body: { stopped: String(error && error.message).slice(0, 80) } } }
    }
  }
}
