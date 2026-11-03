import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type Anthropic from '@anthropic-ai/sdk'
import { type DailySummaryStory, createDailySummaryWriter } from '../news/daily-summary.ts'

const story = (topicId: string, topic: string, title: string): DailySummaryStory => ({
  topicId,
  topic,
  title,
  sourceName: 'Source',
  summary: 'Résumé.',
  coverage: 1
})

// A client whose answer is the given JSON; the requests it got are kept.
const fakeAi = (answer: unknown) => {
  const requests: Record<string, unknown>[] = []
  const client = {
    messages: {
      create: async (request: Record<string, unknown>) => {
        requests.push(request)
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] }
      }
    }
  } as unknown as Anthropic
  return { ai: { client, model: 'test' }, requests }
}

describe('daily summary writer', () => {
  it('asks for a paragraph per story, every topic required, and returns them in order', async () => {
    const { ai, requests } = fakeAi({
      tech: ['Paragraphe puce.'],
      belgique: [' Paragraphe budget. ', 'Paragraphe grève.']
    })
    const write = createDailySummaryWriter(ai)

    const points = await write(
      [
        story('belgique', 'Belgique', 'Budget'),
        story('belgique', 'Belgique', 'Grève'),
        story('tech', 'Tech', 'Nouvelle puce')
      ],
      'fr'
    )

    assert.deepEqual(points, [
      { topic: 'Belgique', text: 'Paragraphe budget.' },
      { topic: 'Belgique', text: 'Paragraphe grève.' },
      { topic: 'Tech', text: 'Paragraphe puce.' }
    ])
    const config = requests[0]?.output_config as { format: { schema: { required: string[] } } }
    assert.deepEqual(config.format.schema.required, ['belgique', 'tech'])
    const prompt = (requests[0]?.messages as { content: string }[])[0]?.content ?? ''
    assert.match(prompt, /<topic field="belgique" name="Belgique">[\s\S]*Budget[\s\S]*Grève[\s\S]*<\/topic>/)
  })

  it("asks in the reader's language", async () => {
    const { ai, requests } = fakeAi({ tech: ['A paragraph.'] })

    await createDailySummaryWriter(ai)([story('tech', 'Tech', 'Puce')], 'en')
    assert.match(String(requests[0]?.system), /^You write "The Daily summary"/)
    await createDailySummaryWriter(ai)([story('tech', 'Tech', 'Puce')], 'fr')
    assert.match(String(requests[1]?.system), /^Tu écris « Le Résumé du jour »/)
  })

  it('leaves out empty paragraphs and fails when there is none', async () => {
    const stories = [story('belgique', 'Belgique', 'Budget'), story('tech', 'Tech', 'Puce')]

    assert.deepEqual(await createDailySummaryWriter(fakeAi({ belgique: ['Ok.', ''], tech: [' '] }).ai)(stories, 'fr'), [
      { topic: 'Belgique', text: 'Ok.' }
    ])
    await assert.rejects(createDailySummaryWriter(fakeAi({ belgique: [], tech: [''] }).ai)(stories, 'fr'))
  })
})
