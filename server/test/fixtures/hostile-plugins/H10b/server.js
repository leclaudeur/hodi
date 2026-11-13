// H10b: A response just over the cap is refused. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /big': async () => ({ body: 'x'.repeat(1_100_000) }) } }
