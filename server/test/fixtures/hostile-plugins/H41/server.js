// H41: An API 1 plugin is never imported by Node. A hostile test plugin: the sandbox must make it fail.
import { writeFileSync } from 'node:fs'
writeFileSync('/tmp/hostile-h41-ran', 'yes')
export default { routes: (router) => { router.get('/x', (_req, res) => res.json({ ran: true })) } }
