// H8: A memory bomb stops at the plugin limit. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /grow': async () => {
      const kept = []
      for (;;) kept.push('x'.repeat(1_000_000))
    }
  }
}
