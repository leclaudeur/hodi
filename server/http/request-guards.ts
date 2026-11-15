import express, { type RequestHandler } from 'express'
import { userBodyLimit } from './user-routes.ts'

// A change comes from Hodi's own pages only. Cookies are SameSite=Lax, which lets another site on the same domain
// (a sibling subdomain) send them with its own POST; browsers say where a request comes from in Sec-Fetch-Site. A
// request without it (an older browser, « npx hodi-plugin dev », curl) goes on, as one typed in the address bar.
export const sameSiteOnly: RequestHandler = (request, response, next) => {
  const site = request.get('Sec-Fetch-Site')
  const safe = request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS'
  if (safe || site === undefined || site === 'same-origin' || site === 'none') {
    next()
    return
  }
  response.status(403).json({ error: 'cross_site' })
}

// A push subscription with the followed subjects, or the reader's state, needs more room.
const parsers = new Map<string, RequestHandler>()
const json = (limit: string) => {
  let parser = parsers.get(limit)
  if (!parser) parsers.set(limit, (parser = express.json({ limit })))
  return parser
}
export const jsonBodies: RequestHandler = (request, response, next) => {
  const limit = request.path.startsWith('/me/')
    ? userBodyLimit(request.path)
    : request.path === '/push/subscription'
      ? '8kb'
      : // A plugin's settings, and what its own routes receive.
        request.path.startsWith('/plugins/') ||
          request.path.startsWith('/server/plugins/') ||
          request.path.startsWith('/public/plugins/')
        ? '64kb'
        : '1kb'
  json(limit)(request, response, next)
}
