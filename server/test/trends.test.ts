import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { trendsOf } from '../news/trends.ts'

const titles = (topicId: string, list: string[]) => list.map(title => ({ title, topicId }))

describe('trends', () => {
  it('finds the phrases most titles share, longest first, as the sources write them', () => {
    const trends = trendsOf([
      ...titles('gaming', [
        'Forza Horizon 6, premier jeu de course à viser le GOTY',
        'Test : Forza Horizon 6 au Japon',
        'Forza Horizon 6 : 20 minutes de gameplay',
        'Forza Horizon 6 cartonne sur Steam'
      ]),
      ...titles('belgium', [
        'Le fédéral boucle son budget 2027',
        'Budget 2027 : les syndicats inquiets',
        'Ce que contient le budget 2027'
      ]),
      ...titles('tech', ['Apple présente un MacBook', 'Linux 7.2 accélère ARM'])
    ])

    assert.deepEqual(trends, [
      { label: 'Forza Horizon 6', count: 4, topicId: 'gaming' },
      { label: 'Budget 2027', count: 3, topicId: 'belgium' }
    ])
  })

  it('leaves out common words and phrases fewer than three titles share', () => {
    assert.deepEqual(
      trendsOf(
        titles('world', [
          'Le nouveau gouvernement annonce',
          'Le nouveau plan annonce',
          'Le nouveau budget annonce',
          'Sommet du G20 à Rio',
          'Sommet du G20 : accord'
        ])
      ),
      []
    )
  })

  it('counts an article once however often its title repeats the phrase', () => {
    assert.deepEqual(trendsOf(titles('ai', ['Claude, Claude et Claude', 'Claude encore', 'Gemini'])), [])
  })
})
