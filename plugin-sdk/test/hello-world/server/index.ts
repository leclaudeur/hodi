import type { ServerPlugin } from '../../../server.ts'

// The server part: one table of its own, one route and one for the server's space. Hodi serves the route at
// /api/plugins/hello-world/hello, to the profiles the plugin is for, while it is on. It runs in its sandbox: its
// database is its own file, so its tables need no prefix.
const plugin: ServerPlugin = {
  migrations: ['CREATE TABLE said (at TEXT NOT NULL)'],
  routes: {
    'POST /hello': async (_request, ctx) => {
      const { greeting, loud } = ctx.settings()
      ctx.db.run('INSERT INTO said (at) VALUES (?)', [new Date().toISOString()])
      const count = Number(ctx.db.get('SELECT COUNT(*) AS count FROM said')?.count ?? 0)
      const text = String(greeting)
      ctx.log(`said hello (${count})`)
      return { body: { text: loud ? text.toUpperCase() : text, count } }
    }
  },
  // For the server's admin only, at /api/server/plugins/hello-world/said: how many hellos, for its section of /server.
  serverRoutes: {
    'GET /said': async (_request, ctx) => ({
      body: { count: Number(ctx.db.get('SELECT COUNT(*) AS count FROM said')?.count ?? 0) }
    })
  }
}

export default plugin
