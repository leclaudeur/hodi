import type express from 'express'
import { ipKeyGenerator, rateLimit } from 'express-rate-limit'
import ipaddr from 'ipaddr.js'
import { clientAddressOf } from './client-address.ts'

// Far above what a household's devices send (a page of cards asks for its pictures at once), far below a flood.
export const REQUESTS_PER_MINUTE = 3000

const isLoopback = (address: string) => ipaddr.isValid(address) && ipaddr.process(address).range() === 'loopback'

// Every request of one address, counted together: the login and password routes keep their own, stricter throttles.
// The address is the one the login throttle uses. This machine itself (a test, a script) is never counted.
export const requestLimit = (limit = REQUESTS_PER_MINUTE): express.RequestHandler =>
  rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: request => ipKeyGenerator(clientAddressOf(request)),
    // Both the connection and the address it names: a device on the network cannot name 127.0.0.1 to pass.
    skip: request => isLoopback(request.socket.remoteAddress ?? '') && isLoopback(clientAddressOf(request)),
    // clientAddressOf reads X-Forwarded-For itself, from a proxy it trusts: Express's own setting stays off.
    validate: { xForwardedForHeader: false },
    handler: (_request, response) => {
      response.status(429).json({ error: 'too_many_requests' })
    }
  })
