import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { createSourceSuggester } from '../news/summarizer.ts'

// A client whose answer is the given JSON; the requests it got are kept.
const fakeAi = (answer: unknown) => {
  const requests: { system: string }[] = []
  const client = {
    messages: {
      create: async (request: { system: string }) => {
        requests.push(request)
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }
      }
    }
  } as unknown as Anthropic
  return { ai: { client, model: 'test' }, requests }
}

const SITE = { name: 'Gamma', url: 'https://gamma.example/', reason: 'Serious.' }

describe('source suggester', () => {
  it("asks for sites in the reader's language, and the household's when it differs", async () => {
    const { ai, requests } = fakeAi({ sites: [SITE] })
    const suggest = createSourceSuggester(ai)
    const ask = (language: 'fr' | 'en', languages: ('fr' | 'en')[]) =>
      suggest({ topic: 'World', current: [], replacing: null, language, languages })

    assert.deepEqual(await ask('en', ['en']), [SITE])
    await ask('en', ['en', 'fr'])
    await ask('fr', ['fr'])
    await ask('fr', ['fr', 'en'])

    const systems = requests.map(request => request.system)
    assert.match(systems[0]!, /Sites in English only\./)
    assert.match(systems[1]!, /Sites in English and in French, English first\./)
    assert.match(systems[2]!, /Des sites en français uniquement/)
    assert.match(systems[3]!, /Des sites en français \(Belgique, France, Suisse, Québec\) et en anglais/)
  })
})
