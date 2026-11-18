// H50: moveDevice is no longer an answer: a device never changes household. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'POST /move': async (request) => ({ body: {}, moveDevice: Number(request.body.householdId) })
  }
}
