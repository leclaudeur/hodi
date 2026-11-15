// H36: publicRoutes refuse a request from another site. A hostile test plugin: the sandbox must make it fail.
export default {
  migrations: ['CREATE TABLE hits (n INTEGER)', 'INSERT INTO hits VALUES (0)'],
  publicRoutes: {
    'POST /join': async (_r, ctx) => { ctx.db.run('UPDATE hits SET n = n + 1'); return { body: { ok: true } } },
    'GET /count': async (_r, ctx) => ({ body: ctx.db.get('SELECT n FROM hits') })
  }
}
