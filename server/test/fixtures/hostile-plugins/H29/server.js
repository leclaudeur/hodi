// H29: who carries no e-mail without the permission. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /who': async request => ({ body: { keys: Object.keys(request.who || {}).sort() } }) } }
