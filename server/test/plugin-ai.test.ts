import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import express from 'express'
import { openDatabase } from '../db/database.ts'
import { PluginStore } from '../db/plugin-store.ts'
import { pluginRoutes } from '../http/plugin-routes.ts'
import type Anthropic from '@anthropic-ai/sdk'
import { type PluginQuestion, SummaryRefusedError, createPluginAsker } from '../news/summarizer.ts'
import {
  DEFAULT_ANSWER_TOKENS,
  MAX_AI_INPUT_BYTES,
  MAX_ANSWER,
  PLUGIN_AI_PER_HOUR,
  type PluginAskAnswer,
  pluginAi,
  pluginQuestion
} from '../plugins/ai.ts'
import { PLUGIN_API } from '../plugins/manifest.ts'
import { packageDigest } from '../plugins/package.ts'
import { type PluginRegistry, loadPlugins } from '../plugins/registry.ts'

const NOW = Date.parse('2026-11-08T12:00:00Z')

const MANIFEST = {
  id: 'helper',
  name: 'Helper',
  version: '0.1.0',
  description: 'Résume avec l’IA du foyer.',
  api: PLUGIN_API,
  audience: 'all',
  permissions: { ai: true }
}

// A plugin that tries ctx.ai everywhere: only the aiAction a click started may ask, once.
const SERVER = `
const attempt = async ctx => {
  try {
    return 'asked: ' + (await ctx.ai.ask({ prompt: 'x' }))
  } catch (error) {
    return error.message
  }
}
export default {
  routes: {
    'GET /sneak': async (_request, ctx) => ({ body: await attempt(ctx) }),
    'GET /has-ai': async (_request, ctx) => ({ body: typeof ctx.ai }),
    'GET /stashed': async () => ({ body: await attempt(globalThis.stashed) })
  },
  tasks: { sneak: { every: 15, run: async ctx => ctx.log('task: ' + (await attempt(ctx))) } },
  onArticle: async (_article, ctx) => ctx.log('hook: ' + (await attempt(ctx))),
  aiActions: {
    summarize: async ({ input, who }, ctx) => ({
      text: await ctx.ai.ask({ system: 'Sois bref.', prompt: 'Résume : ' + input.text, maxTokens: 200 }),
      who
    }),
    twice: async (_request, ctx) => {
      await ctx.ai.ask({ prompt: 'a' })
      return attempt(ctx)
    },
    huge: async (_request, ctx) => ctx.ai.ask({ prompt: 'x'.repeat(9000) }),
    odd: async (_request, ctx) => ctx.ai.ask({ prompt: 'a', model: 'the-biggest-one' }),
    stash: async (_request, ctx) => {
      globalThis.stashed = ctx
      return 'kept'
    },
    quiet: async () => 'no question',
    broken: async () => {
      throw new Error('oops')
    },
    afterFailure: async (_request, ctx) => {
      await ctx.ai.ask({ prompt: 'a' })
      return 'never'
    }
  }
}
`

const testKey = generateKeyPairSync('ed25519')
const TRUSTED = [testKey.publicKey.export({ type: 'spki', format: 'pem' }).toString()]

const registries: PluginRegistry[] = []
const servers: { close: () => void }[] = []
after(async () => {
  servers.forEach(server => server.close())
  await Promise.all(registries.map(registry => registry.stop()))
})

describe('the question a plugin may ask', () => {
  it('is plain text within its sizes, nothing more', () => {
    assert.deepEqual(pluginQuestion({ prompt: 'Résume' }), {
      system: '',
      prompt: 'Résume',
      maxTokens: DEFAULT_ANSWER_TOKENS
    })
    assert.deepEqual(pluginQuestion({ prompt: 'a', system: 'b', maxTokens: 1024 }), {
      system: 'b',
      prompt: 'a',
      maxTokens: 1024
    })
    for (const value of [
      null,
      'Résume',
      [],
      {},
      { prompt: '' },
      { prompt: '  ' },
      { prompt: 'x'.repeat(8001) },
      { prompt: 'a', system: 'x'.repeat(2001) },
      { prompt: 'a', maxTokens: 0 },
      { prompt: 'a', maxTokens: 1025 },
      { prompt: 'a', maxTokens: 1.5 },
      { prompt: 'a', model: 'another' },
      { prompt: 'a', messages: [] }
    ]) {
      assert.equal(pluginQuestion(value), null, JSON.stringify(value)?.slice(0, 60))
    }
  })
})

describe('a plugin’s question to the API', () => {
  it('sends the text alone, to the household’s model, and reads the text back', async () => {
    const requests: unknown[] = []
    let stop = 'end_turn'
    const client = {
      messages: {
        create: async (request: unknown) => {
          requests.push(request)
          return {
            stop_reason: stop,
            content: [
              { type: 'text', text: 'Un ' },
              { type: 'tool_use', name: 'x' },
              { type: 'text', text: 'résumé.' }
            ]
          }
        }
      }
    } as unknown as Anthropic
    const ask = createPluginAsker({ client, model: 'household-model' })
    assert.equal(await ask({ system: 'Sois bref.', prompt: 'Résume', maxTokens: 200 }), 'Un résumé.')
    await ask({ system: '', prompt: 'Résume', maxTokens: 10 })
    assert.deepEqual(requests, [
      {
        model: 'household-model',
        max_tokens: 200,
        system: 'Sois bref.',
        messages: [{ role: 'user', content: 'Résume' }]
      },
      { model: 'household-model', max_tokens: 10, messages: [{ role: 'user', content: 'Résume' }] }
    ])
    stop = 'refusal'
    await assert.rejects(ask({ system: '', prompt: 'Résume', maxTokens: 10 }), SummaryRefusedError)
  })
})

describe('the household’s AI for plugins', () => {
  it('lets a plugin ask a few times an hour, unless it is off or the caps are reached', async () => {
    let at = NOW
    let left = true
    const off = new Set<string>()
    const ai = pluginAi({
      isOff: (_household, plugin) => off.has(plugin),
      left: () => left,
      ask: async () => ({ status: 'ok', text: 'y'.repeat(MAX_ANSWER + 50) }),
      now: () => at
    })
    for (let index = 0; index < PLUGIN_AI_PER_HOUR; index++) {
      assert.equal((await ai.ask('helper', 1, 2, { system: '', prompt: 'a', maxTokens: 10 })).length, MAX_ANSWER)
    }
    assert.equal(ai.check('helper', 1, 2), 'limited')
    await assert.rejects(ai.ask('helper', 1, 2, { system: '', prompt: 'a', maxTokens: 10 }), /ai_limited/)
    // Another household, or another plugin, has its own hour.
    assert.equal(ai.check('helper', 7, 2), null)
    assert.equal(ai.check('other', 1, 2), null)
    at += 60 * 60 * 1000
    assert.equal(ai.check('helper', 1, 2), null)

    off.add('helper')
    assert.equal(ai.check('helper', 1, 2), 'off')
    off.clear()
    left = false
    assert.equal(ai.check('helper', 1, 2), 'limited')
  })
})

describe('ctx.ai and the AiButton', () => {
  const asked: { pluginId: string; householdId: number; profileId: number; question: PluginQuestion }[] = []
  let answer: PluginAskAnswer = { status: 'ok', text: 'Un résumé.' }
  let left = true
  let kind = 'adult'
  let store: PluginStore
  const logs: string[] = []

  beforeEach(() => {
    asked.length = 0
    logs.length = 0
    answer = { status: 'ok', text: 'Un résumé.' }
    left = true
    kind = 'adult'
  })

  const start = async ({ signed = true, manifest = MANIFEST } = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hodi-ai-plugins-'))
    const root = path.join(dir, 'helper')
    mkdirSync(root)
    writeFileSync(path.join(root, 'plugin.json'), JSON.stringify(manifest))
    writeFileSync(path.join(root, 'server.js'), SERVER)
    if (signed)
      writeFileSync(
        path.join(root, 'signature'),
        sign(null, packageDigest(root), testKey.privateKey).toString('base64')
      )
    store = new PluginStore(openDatabase(':memory:'))
    const ai = pluginAi({
      isOff: (householdId, pluginId) => store.aiOff(householdId).has(pluginId),
      left: () => left,
      ask: async (householdId, pluginId, profileId, question) => {
        asked.push({ pluginId, householdId, profileId, question })
        return answer
      }
    })
    const plugins = await loadPlugins({
      dir,
      dataDir: mkdtempSync(path.join(tmpdir(), 'hodi-ai-data-')),
      store,
      ai,
      trustedKeys: TRUSTED,
      log: line => logs.push(line)
    })
    registries.push(plugins)
    const app = express()
    app.use(express.json({ limit: '64kb' }))
    app.use((_request, response, next) => {
      Object.assign(response.locals, { profileId: 2, kind, admin: false })
      next()
    })
    app.use('/api/plugins', pluginRoutes(plugins, { ai }))
    const server = app.listen(0)
    servers.push(server)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plugins/helper`
    const click = (
      action: string,
      input: unknown = { text: 'Un long article.' },
      headers: Record<string, string> = {}
    ) =>
      fetch(`${base}/ai/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ input })
      })
    return { plugins, base, click }
  }

  it('answers a click with one question, for the profile that clicked', async () => {
    const { click } = await start()
    const response = await click('summarize')
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-security-policy'), "default-src 'none'; sandbox")
    const { answer: answered } = (await response.json()) as { answer: { text: string; who: unknown } }
    assert.equal(answered.text, 'Un résumé.')
    assert.deepEqual(answered.who, { householdId: 1, profileId: 2 })
    assert.equal(asked.length, 1)
    assert.deepEqual(asked[0], {
      pluginId: 'helper',
      householdId: 1,
      profileId: 2,
      question: { system: 'Sois bref.', prompt: 'Résume : Un long article.', maxTokens: 200 }
    })
  })

  it('refuses a second question in the same click', async () => {
    const { click } = await start()
    const response = await click('twice')
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { answer: 'ai_already_asked' })
    assert.equal(asked.length, 1)
  })

  it('never asks from a route, a task, a hook or a ctx kept from a click', async () => {
    const { plugins, base, click } = await start()
    assert.equal(await (await fetch(`${base}/sneak`)).json(), 'ai_no_click')
    await plugins.runDueTasks()
    plugins.tellArticle({ id: 'a1' } as never)
    // The hook runs on its own: wait for its line.
    for (let tries = 0; tries < 50 && !logs.some(line => line.includes('hook:')); tries++)
      await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(
      logs.some(line => line.endsWith('task: ai_no_click')),
      logs.join('\n')
    )
    assert.ok(
      logs.some(line => line.endsWith('hook: ai_no_click')),
      logs.join('\n')
    )
    assert.deepEqual(await (await click('stash')).json(), { answer: 'kept' })
    assert.equal(await (await fetch(`${base}/stashed`)).json(), 'ai_no_click')
    assert.equal(asked.length, 0)
  })

  it('refuses a question too big or with more than text', async () => {
    const { click } = await start()
    assert.equal((await click('huge')).status, 502)
    assert.equal((await click('odd')).status, 502)
    assert.equal(asked.length, 0)
  })

  it('gives an unsigned plugin no ctx.ai, whatever its manifest says', async () => {
    const { base, click } = await start({ signed: false })
    assert.equal(await (await fetch(`${base}/has-ai`)).json(), 'undefined')
    assert.equal((await click('summarize')).status, 404)
    assert.equal(asked.length, 0)
  })

  it('gives no ctx.ai to a plugin that does not ask for it', async () => {
    const { base, click } = await start({ manifest: { ...MANIFEST, permissions: {} } })
    assert.equal(await (await fetch(`${base}/has-ai`)).json(), 'undefined')
    assert.equal((await click('summarize')).status, 404)
  })

  it('checks the click before the plugin runs', async () => {
    const { click } = await start()
    assert.equal((await click('nothing')).status, 404)
    assert.equal((await click('summarize', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
    assert.equal((await click('summarize', { text: 'x'.repeat(MAX_AI_INPUT_BYTES) })).status, 413)

    kind = 'teen'
    const young = await click('summarize')
    assert.equal(young.status, 403)
    assert.deepEqual(await young.json(), { error: 'young' })
    kind = 'adult'

    store.setAiOff(1, 'helper', true)
    const off = await click('summarize')
    assert.equal(off.status, 403)
    assert.deepEqual(await off.json(), { error: 'ai_off' })
    store.setAiOff(1, 'helper', false)

    left = false
    const limited = await click('summarize')
    assert.equal(limited.status, 429)
    assert.deepEqual(await limited.json(), { error: 'ai_limited' })
    assert.equal(asked.length, 0)
  })

  it('says why the AI gave no answer, and when the plugin failed', async () => {
    const { click } = await start()
    answer = { status: 'refused' }
    const refused = await click('afterFailure')
    assert.equal(refused.status, 422)
    assert.deepEqual(await refused.json(), { error: 'ai_refused' })
    answer = { status: 'failed' }
    assert.equal((await click('afterFailure')).status, 502)

    const broken = await click('broken')
    assert.equal(broken.status, 502)
    assert.deepEqual(await broken.json(), { error: 'plugin_failed' })
    assert.deepEqual(await (await click('quiet')).json(), { answer: 'no question' })
  })
})
