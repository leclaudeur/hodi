// H51: publicRoutes: who is null and the body is capped. A hostile test plugin: the sandbox must make it fail.
export default {
  publicRoutes: {
    'POST /who': async request => ({ body: { who: request.who, size: JSON.stringify(request.body ?? null).length } })
  }
}
