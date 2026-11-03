import { type LookupAddress, lookup as dnsLookup } from 'node:dns'
import { lookup } from 'node:dns/promises'
import { type LookupFunction, isIP } from 'node:net'
import ipaddr from 'ipaddr.js'

// The server fetches news on behalf of the household, never its own network: only global unicast addresses,
// whatever a feed, a page or a redirect points to. ipaddr.js names every special range (private, loopback,
// link-local, shared CGNAT, benchmarking, documentation, multicast, NAT64, 6to4, Teredo…), so the list stays
// complete without being kept by hand.

export const isPrivateAddress = (address: string): boolean => {
  if (!ipaddr.isValid(address)) return true
  // An IPv4-mapped IPv6 address is judged as the IPv4 address it carries.
  const parsed = ipaddr.process(address)
  // The deprecated IPv4-compatible form (::a.b.c.d) reaches the IPv4 address on some systems; ipaddr.js
  // leaves it in unicast.
  if (parsed.kind() === 'ipv6' && (parsed as ipaddr.IPv6).parts.slice(0, 6).every(part => part === 0)) return true
  return parsed.range() !== 'unicast'
}

export type IsAllowedUrl = (url: URL) => Promise<boolean>

// Any http(s) address whose name resolves only to public addresses: checked before each request and each redirect.
export const isPublicAddressUrl: IsAllowedUrl = async url => {
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return !isPrivateAddress(host)
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|lan|home|ts\.net)$/i.test(host)) return false
  try {
    const addresses = await lookup(host, { all: true })
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address))
  } catch {
    return false
  }
}

export class PrivateAddressError extends Error {
  constructor(hostname: string) {
    super(`Resolves to a private address: ${hostname}`)
  }
}

// The check above and the connection each resolve the name: a server answering a public address to the first and
// a private one to the second (DNS rebinding) would pass. This lookup is the one the connection itself uses, so the
// address checked is the address connected to.
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error, '', 0)
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
      return callback(new PrivateAddressError(hostname), '', 0)
    }
    if (options.all) return callback(null, addresses)
    const [first] = addresses as [LookupAddress]
    callback(null, first.address, first.family)
  })
}
