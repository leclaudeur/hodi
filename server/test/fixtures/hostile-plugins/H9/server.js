// H9: Five memory bombs at once stay inside the global budget. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /grow': async () => { const kept = []; for (;;) kept.push('x'.repeat(1_000_000)) } } }
