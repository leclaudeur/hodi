// H30: No network primitive inside the sandbox. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'GET /net': async () => ({ body: { fetch: typeof fetch, XMLHttpRequest: typeof XMLHttpRequest, WebSocket: typeof WebSocket, EventSource: typeof EventSource } })
  }
}
