// H26: An HTML string is served as JSON, never run. A hostile test plugin: the sandbox must make it fail.
export default { routes: { 'GET /html': async () => ({ body: '<script>parent.document.title = "pwned"</script>' }) } }
