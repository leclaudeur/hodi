// H2: The global object holds no host object. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /globals': async () => {
      const global = new Function('return this')()
      const names = ['process', 'Buffer', 'require', 'module', '__dirname', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setImmediate', 'queueMicrotask_host', 'Deno', 'Bun']
      return { body: { present: names.filter(name => typeof global[name] !== 'undefined') } }
    },
    'GET /ctx-keys': async (_request, ctx) => ({ body: { keys: Object.keys(ctx).sort() } })
  }
}
