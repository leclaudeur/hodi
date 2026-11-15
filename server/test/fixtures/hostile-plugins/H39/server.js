// H39: mail: 50 per hour per plugin. A hostile test plugin: the sandbox must make it fail.
const attempt = async (name, fn) => { try { return { name, ok: true, value: await fn() } } catch (error) { return { name, ok: false, error: String(error && error.message) } } }

export default {
  routes: {
    'POST /flood': async (_r, ctx) => {
      const results = []
      for (let i = 0; i < 60; i++) results.push(await attempt(String(i), () => ctx.mail.send({ to: 'a@example.test', subject: 'n' + i, text: 'x' })))
      return { body: { sent: results.filter(r => r.ok).length, refused: results.filter(r => !r.ok).map(r => r.error)[0] ?? null } }
    }
  }
}
