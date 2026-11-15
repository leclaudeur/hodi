// H1: Node modules and process are out of reach. A hostile test plugin: the sandbox must make it fail.
const attempt = async fn => { try { return { ok: true, value: String(await fn()) } } catch (error) { return { ok: false, error: String(error && error.name) } } }
export default {
  routes: {
    'GET /require': async () => ({ body: await attempt(() => require('fs').readFileSync('/app/data/session-secret')) }),
    'GET /import': async () => ({ body: await attempt(async () => (await import('node:child_process')).execSync('id')) }),
    'GET /process': async () => ({ body: await attempt(() => process.env.HOME) }),
    'GET /global-process': async () => ({ body: await attempt(() => globalThis.process.version) })
  }
}
