// H46: An upload over its route limit never reaches the sandbox. A hostile test plugin: the sandbox must make it fail.
// Adapted to the final raw route shape ({ raw, maxBody, handler }); /big asks for more than Hodi's 10 MB ceiling.
let reached = 0
const capture = async request => { reached += 1; return { body: { size: request.body.length } } }
export default {
  routes: {
    'PUT /capture': { raw: true, maxBody: 5000000, handler: capture },
    'PUT /big': { raw: true, maxBody: 50000000, handler: capture },
    'GET /reached': async () => ({ body: { reached } })
  }
}
