// H27: A __proto__ key in a response pollutes nothing. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /proto': async () => ({ body: JSON.parse('{"__proto__": {"admin": true, "isAdmin": true}, "constructor": {"prototype": {"admin": true}}}') }) } }
