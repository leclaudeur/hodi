import { type ReactElement, isValidElement } from 'react'
import { describe, expect, it } from 'vitest'
import { rich } from '../src/ui/rich.tsx'

// The pieces of a rich text, each as its tag and text: 'text' for a plain run.
const pieces = (node: unknown) => {
  if (!isValidElement(node)) return node
  const parts = (node as ReactElement<{ children: unknown[] }>).props.children
  return parts
    .filter(part => part !== '')
    .map(part =>
      isValidElement(part)
        ? [part.type, (part as ReactElement<{ children: string }>).props.children]
        : ['text', part as string]
    )
}

describe('rich', () => {
  it('bolds names and puts screen names in italics', () => {
    expect(pieces(rich('<b>Léo</b> rejoint la <b>Famille Dupont</b> dans <i>Qui lit ?</i>.'))).toEqual([
      ['strong', 'Léo'],
      ['text', ' rejoint la '],
      ['strong', 'Famille Dupont'],
      ['text', ' dans '],
      ['em', 'Qui lit ?'],
      ['text', '.']
    ])
  })

  it('leaves a plain text, a node and nothing as they are', () => {
    expect(rich('Rien à souligner.')).toBe('Rien à souligner.')
    expect(rich('3 < 4')).toEqual(expect.anything())
    expect(pieces(rich('3 < 4'))).toEqual([['text', '3 < 4']])
    expect(rich(undefined)).toBeUndefined()
    const node = rich(42)
    expect(node).toBe(42)
  })

  it('keeps a tag it does not know as text', () => {
    expect(pieces(rich('<u>a</u> et <b>b</b>'))).toEqual([
      ['text', '<u>a</u> et '],
      ['strong', 'b']
    ])
  })
})
