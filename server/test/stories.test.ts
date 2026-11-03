import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sameStory } from '../news/stories.ts'

const story = (title: string, publishedAt: string | null = '2026-10-23T10:00:00.000Z') => ({ title, publishedAt })

describe('sameStory', () => {
  it('matches titles of one story worded differently', () => {
    const pairs = [
      [
        'Sommet du G20 : les dirigeants s’accordent sur la dette des pays pauvres',
        'G20 : accord sur la dette des pays pauvres à Johannesburg'
      ],
      [
        'Guerre en Iran : nouvelles frappes près de Téhéran',
        'Iran : de nouvelles frappes israéliennes près de Téhéran'
      ],
      ['Le gouvernement fédéral présente son budget 2027', 'Budget 2027 : le fédéral présente ses mesures'],
      ['Sommet européen', 'Sommet  Européen !']
    ]

    for (const [a, b] of pairs) assert.equal(sameStory(story(a), story(b)), true, `${a} / ${b}`)
  })

  it('keeps apart stories that only share a few words or differ by a name', () => {
    const pairs = [
      ['Le prix de l’électricité baisse en novembre', 'Le prix du gaz baisse en novembre'],
      ['Incendie à Liège : trois blessés dans un immeuble', 'Incendie à Charleroi : trois blessés dans un immeuble'],
      ['Guerre en Ukraine : Zelensky à Bruxelles', 'Guerre en Iran : nouvelles frappes près de Téhéran']
    ]

    for (const [a, b] of pairs) assert.equal(sameStory(story(a), story(b)), false, `${a} / ${b}`)
  })

  it('keeps apart similar titles published days apart', () => {
    assert.equal(
      sameStory(
        story('Guerre en Iran : nouvelles frappes près de Téhéran', '2026-10-20T10:00:00.000Z'),
        story('Iran : de nouvelles frappes israéliennes près de Téhéran', '2026-10-23T10:00:00.000Z')
      ),
      false
    )
  })
})
