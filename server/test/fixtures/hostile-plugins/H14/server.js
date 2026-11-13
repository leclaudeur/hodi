// H14: A log flood is capped. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /log': async (_request, ctx) => { for (;;) ctx.log('x'.repeat(100_000)) } } }
