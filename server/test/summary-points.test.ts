import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pointsFor } from '../news/summarizer.ts'

const words = (count: number) => Array.from({ length: count }, () => 'mot').join(' ')

describe('summary points', () => {
  it('asks for more points as the article grows, from 3 to 7', () => {
    assert.equal(pointsFor(words(200)), 3)
    assert.equal(pointsFor(words(600)), 4)
    assert.equal(pointsFor(words(1200)), 5)
    assert.equal(pointsFor(words(2000)), 6)
    assert.equal(pointsFor(words(5000)), 7)
  })
})
