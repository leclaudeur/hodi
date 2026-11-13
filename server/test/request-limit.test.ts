import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import express from 'express'
import { requestLimit } from '../http/request-limit.ts'

const serve = async () => {
  const app = express()
  app.use(requestLimit(3))
  app.get('/', (_request, response) => {
    response.json({ ok: true })
  })
  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo
  const statuses = async (count: number, headers: Record<string, string> = {}) => {
    const answers = []
    for (let i = 0; i < count; i++) answers.push((await fetch(`http://127.0.0.1:${port}/`, { headers })).status)
    return answers
  }
  return { server, statuses }
}

test('an address gets 429 past its requests of the minute, and another address is counted apart', async () => {
  const { server, statuses } = await serve()
  try {
    // A proxy on this machine names the visitor, as for the login throttle.
    assert.deepEqual(await statuses(4, { 'X-Forwarded-For': '203.0.113.5' }), [200, 200, 200, 429])
    assert.deepEqual(await statuses(1, { 'X-Forwarded-For': '203.0.113.6' }), [200])
  } finally {
    server.close()
  }
})

test('this machine itself is never counted', async () => {
  const { server, statuses } = await serve()
  try {
    assert.deepEqual(await statuses(5), [200, 200, 200, 200, 200])
  } finally {
    server.close()
  }
})
