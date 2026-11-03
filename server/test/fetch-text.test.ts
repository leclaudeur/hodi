import assert from 'node:assert/strict'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { isPrivateAddress, isPublicAddressUrl, publicOnlyLookup } from '../news/address-guard.ts'
import { BlockedAddressError, YOUTUBE_PAGE, createFetchBytes, createFetchText } from '../news/fetch-text.ts'

// Two local servers: "news" plays the news site, "inside" a service on the server's own network.
let news: Server
let inside: Server
let newsBase = ''
let insideBase = ''
let insideHits = 0

const listen = (server: Server) =>
  new Promise<string>(resolve =>
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`))
  )

// Only the news site's port counts as public here.
const newsOnly = async (url: URL) => url.origin === newsBase

describe('fetch text', () => {
  before(async () => {
    inside = createServer((_request, response) => {
      insideHits++
      response.end('secret')
    })
    insideBase = await listen(inside)
    news = createServer((request, response) => {
      if (request.url === '/moved') {
        response.writeHead(301, { Location: '/article' }).end()
      } else if (request.url === '/to-inside') {
        response.writeHead(302, { Location: `${insideBase}/latest/meta-data` }).end()
      } else if (request.url === '/headers') {
        response.end(`${request.headers['user-agent']}|${request.headers.cookie}|${request.headers['accept-language']}`)
      } else if (request.url === '/loop') {
        response.writeHead(302, { Location: '/loop' }).end()
      } else {
        response.end('<p>Article</p>')
      }
    })
    newsBase = await listen(news)
  })

  after(() => {
    news.close()
    inside.close()
  })

  it('follows a redirect on an allowed address and reports where it ended', async () => {
    const fetchText = createFetchText({ isAllowed: newsOnly })

    const page = await fetchText(`${newsBase}/moved`)

    assert.equal(page.url, `${newsBase}/article`)
    assert.equal(page.text, '<p>Article</p>')
  })

  it('refuses a redirect to the server’s own network before sending it', async () => {
    const fetchText = createFetchText({ isAllowed: newsOnly })

    await assert.rejects(fetchText(`${newsBase}/to-inside`), BlockedAddressError)
    assert.equal(insideHits, 0)
  })

  it('checks icons the same way', async () => {
    const fetchBytes = createFetchBytes({ isAllowed: newsOnly })

    await assert.rejects(fetchBytes(`${newsBase}/to-inside`), BlockedAddressError)
    assert.equal(insideHits, 0)
  })

  it('sends YouTube’s page headers through the same guard', async () => {
    const fetchText = createFetchText({ isAllowed: newsOnly })
    const page = await fetchText(`${newsBase}/headers`, YOUTUBE_PAGE)
    assert.equal(page.text, `${YOUTUBE_PAGE.userAgent}|SOCS=CAI|fr-BE,fr;q=0.9,en;q=0.8`)
    await assert.rejects(fetchText(`${newsBase}/to-inside`, YOUTUBE_PAGE), BlockedAddressError)
  })

  it('gives up on a redirect loop', async () => {
    const fetchText = createFetchText({ isAllowed: newsOnly })

    await assert.rejects(fetchText(`${newsBase}/loop`), /Too many redirects/)
  })

  it('checks the address it connects to, not only the one it looked up first', async () => {
    // A check that lets everything through plays a name that answered a public address to the check, then a
    // private one to the connection (DNS rebinding): the connection's own lookup still refuses it.
    const port = new URL(insideBase).port
    const fetchText = createFetchText({ isAllowed: async () => true })

    await assert.rejects(fetchText(`http://localhost:${port}/`), BlockedAddressError)
    assert.equal(insideHits, 0)
  })

  it('refuses local addresses by default', async () => {
    await assert.rejects(createFetchText()(`${insideBase}/`), BlockedAddressError)
    assert.equal(insideHits, 0)
  })
})

describe('address guard', () => {
  it('tells private addresses from public ones', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1']) {
      assert.equal(isPrivateAddress(address), true, address)
    }
    for (const address of ['::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1']) {
      assert.equal(isPrivateAddress(address), true, address)
    }
    // Benchmarking, IETF protocol and documentation ranges, broadcast, and IPv6 forms that carry an IPv4
    // address (NAT64, 6to4, Teredo, IPv4-compatible).
    for (const address of [
      '198.18.0.1',
      '192.0.0.8',
      '192.0.2.1',
      '240.0.0.1',
      '255.255.255.255',
      '64:ff9b::a00:1',
      '2002:a00:1::',
      '2001::1',
      '::10.0.0.1',
      '2001:db8::1',
      'not an address'
    ]) {
      assert.equal(isPrivateAddress(address), true, address)
    }
    for (const address of ['93.184.216.34', '2606:4700::1111']) {
      assert.equal(isPrivateAddress(address), false, address)
    }
  })

  it('refuses local names, credentials and other schemes without a lookup', async () => {
    for (const url of [
      'http://localhost/',
      'https://nas.local/',
      'https://user:pass@example.com/',
      'ftp://example.com/'
    ]) {
      assert.equal(await isPublicAddressUrl(new URL(url)), false, url)
    }
  })

  it('fails the connection lookup of a name that resolves to a private address', async () => {
    const error = await new Promise(resolve => publicOnlyLookup('localhost', {}, resolve))

    assert.match(String(error), /private address: localhost/)
  })
})
