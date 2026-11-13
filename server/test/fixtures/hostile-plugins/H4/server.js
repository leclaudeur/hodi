// H4: A busy loop is stopped and Hodi keeps answering. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /spin': async () => { for (;;) {} } } }
