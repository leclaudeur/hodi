// H40: SDK objects not declared in the manifest do not exist. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /ctx': async (_r, ctx) => ({ body: { accounts: typeof ctx.accounts, households: typeof ctx.households, session: typeof ctx.session, mail: typeof ctx.mail, fetchText: typeof ctx.fetchText } })
  }
}
