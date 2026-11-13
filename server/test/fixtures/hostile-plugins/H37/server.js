// H37: publicRoutes rate limit per address. A hostile test plugin: the sandbox must make it fail.
export default {
  migrations: ['CREATE TABLE hits (n INTEGER)', 'INSERT INTO hits VALUES (0)'],
  publicRoutes: {
    'POST /ping': async (_r, ctx) => { ctx.db.run('UPDATE hits SET n = n + 1'); return { body: { ok: true } } },
    'GET /count': async (_r, ctx) => ({ body: ctx.db.get('SELECT n FROM hits') })
  }
}
