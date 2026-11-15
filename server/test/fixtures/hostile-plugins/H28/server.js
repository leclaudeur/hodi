// H28: A request carries no cookie, header or session. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /look': async request => ({ body: { keys: Object.keys(request).sort(), headers: typeof request.headers, cookies: typeof request.cookies, session: typeof request.session } })
  }
}
