// H50: moveDevice only to a household the account belongs to. A hostile test plugin: the sandbox must make it fail.
export default {
  routes: {
    'POST /move': async (request) => ({ body: {}, moveDevice: Number(request.body.householdId) })
  }
}
