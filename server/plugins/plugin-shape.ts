import type { SandboxShape } from './sandbox/protocol.ts'

// A route's key in a plugin's table: its method and its path, with :name for a part of the path.
export const ROUTE_KEY = /^(GET|POST|PUT|PATCH|DELETE) (\/(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9]*)?)+$/

// A task's name, and how far apart it may run: every quarter of an hour at most, once a week at least.
const TASK_NAME = /^[a-z][a-z0-9-]{0,31}$/
export const TASK_MINUTES = { min: 15, max: 7 * 24 * 60 }

const checkTasks = (tasks: SandboxShape['tasks']) => {
  for (const [name, every] of Object.entries(tasks)) {
    if (!TASK_NAME.test(name)) throw new Error(`task ${name}: a name is lowercase letters, digits and dashes`)
    if (!Number.isInteger(every) || every < TASK_MINUTES.min || every > TASK_MINUTES.max)
      throw new Error(`task ${name}: every is a number of minutes, from ${TASK_MINUTES.min} to ${TASK_MINUTES.max}`)
  }
}

// A raw body only comes with a method that has one, on a route the plugin has.
const checkRawRoutes = (shape: SandboxShape) => {
  for (const [entry, maxBody] of Object.entries(shape.rawRoutes)) {
    const [group, method, route] = entry.split(' ')
    // What anyone can send stays small JSON: no upload reaches a plugin without a session.
    if (group === 'publicRoutes') throw new Error(`${method} ${route}: a public route cannot take a raw body`)
    const keys = group === 'routes' ? shape.routes : group === 'serverRoutes' ? shape.serverRoutes : []
    if (!keys.includes(`${method} ${route}`) || !['POST', 'PUT', 'PATCH'].includes(method ?? '')) {
      throw new Error(`${method} ${route} cannot take a raw body: only a POST, PUT or PATCH route can`)
    }
    if (!Number.isInteger(maxBody) || maxBody < 1)
      throw new Error(`${method} ${route}: maxBody must be a number of bytes`)
  }
}

export const checkShape = (shape: SandboxShape) => {
  checkTasks(shape.tasks)
  for (const key of [...shape.routes, ...shape.serverRoutes, ...shape.publicRoutes]) {
    if (!ROUTE_KEY.test(key)) throw new Error(`${key} is not a route: use 'GET /path', with :name for a part`)
  }
  checkRawRoutes(shape)
  // Nobody signed in asks a public route: there is no password to ask for.
  for (const entry of shape.proofRoutes) {
    const [group, method, route] = entry.split(' ')
    if (group === 'publicRoutes') throw new Error(`${method} ${route}: a public route cannot ask for a password`)
  }
}
