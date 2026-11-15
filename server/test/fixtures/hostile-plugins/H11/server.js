// H11: Many calls at once queue, then overflow. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /slow': async () => { const end = Date.now() + 1000; while (Date.now() < end) {} return { body: { done: true } } } } }
