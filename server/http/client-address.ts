import { isIP } from 'node:net'
import type express from 'express'
import { isPrivateAddress } from '../news/address-guard.ts'

// The address a login attempt comes from, for its throttle. A reverse proxy on this machine or network (Caddy,
// a tunnel) connects from a private address and names the visitor in X-Forwarded-For, last entry (the one it
// added) or X-Real-IP; anyone else is known by the connection itself.
export const clientAddressOf = (request: express.Request) => {
  const socket = (request.socket.remoteAddress ?? '').replace(/^::ffff:/, '')
  if (!isPrivateAddress(socket)) return socket
  const forwarded =
    request
      .get('x-forwarded-for')
      ?.split(',')
      .map(part => part.trim())
      .filter(Boolean)
      .at(-1) ?? request.get('x-real-ip')?.trim()
  return forwarded && isIP(forwarded) ? forwarded : socket
}
