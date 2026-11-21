import { describe, expect, it } from 'vitest'
import { cardTopicOf } from '../src/lib/source-card.ts'

const topics = [{ id: 'world' }, { id: 'tech' }, { id: 'food' }]

describe('a source card’s topic', () => {
  it('shows its first topic and counts the others', () => {
    expect(cardTopicOf(topics, [])).toEqual({ topic: { id: 'world' }, moreTopics: 2 })
  })

  it('shows the topic browsed or filtered on first, when it has it', () => {
    expect(cardTopicOf(topics, ['food']).topic).toEqual({ id: 'food' })
    expect(cardTopicOf(topics, ['sport']).topic).toEqual({ id: 'world' })
  })

  it('shows none for a channel without a topic', () => {
    expect(cardTopicOf([], ['world'])).toEqual({ topic: null, moreTopics: 0 })
  })
})
