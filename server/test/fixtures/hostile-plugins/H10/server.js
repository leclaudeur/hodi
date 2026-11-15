// H10: A huge response is refused by the core. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /huge': async () => ({ body: 'x'.repeat(500_000_000) }) } }
