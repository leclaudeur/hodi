// H43: An unsigned plugin is installed without its web part. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /ok': async () => ({ body: { ok: true } }) } }
