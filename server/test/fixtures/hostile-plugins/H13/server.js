// H13: A plugin that crashes on start is disabled after three deaths. A hostile test plugin: the sandbox must make it fail.
throw new Error('boom at load')
export default {}
