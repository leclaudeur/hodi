import { describe, expect, it } from 'vitest'
import { isInHiddenTopic } from '../src/lib/preferences.ts'

describe('isInHiddenTopic', () => {
  it("tells an article of a topic the profile hid from the others'", () => {
    expect(isInHiddenTopic({ topicId: 'sport' }, { hiddenTopics: ['sport'] })).toBe(true)
    expect(isInHiddenTopic({ topicId: 'tech' }, { hiddenTopics: ['sport'] })).toBe(false)
    expect(isInHiddenTopic({ topicId: 'tech' }, { hiddenTopics: [] })).toBe(false)
  })
})
