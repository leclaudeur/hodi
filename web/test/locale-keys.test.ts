import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The keys an object of a locale file holds twice. JSON keeps the last one silently, so the first text never shows.
const repeatedKeys = (file: string) => {
  const repeated: string[] = []
  // Prettier writes one key per line, each object's keys at one indentation: a stack of open objects follows them.
  const open: { indent: number; keys: Set<string>; path: string }[] = [{ indent: 0, keys: new Set(), path: '' }]
  for (const line of readFileSync(path.join(process.cwd(), 'shared/locales', file), 'utf8').split('\n')) {
    const found = /^(\s*)"([^"]+)":\s*(\{)?/.exec(line)
    if (!found) continue
    const indent = found[1]!.length
    while (open.length > 1 && open.at(-1)!.indent >= indent) open.pop()
    const parent = open.at(-1)!
    const path = parent.path ? `${parent.path}.${found[2]}` : found[2]!
    if (parent.keys.has(found[2]!)) repeated.push(path)
    parent.keys.add(found[2]!)
    if (found[3] && !line.trimEnd().endsWith('{}') && !line.trimEnd().endsWith('{},'))
      open.push({ indent: indent + 1, keys: new Set(), path })
  }
  return repeated
}

describe('the locale files', () => {
  it('hold each key once per object', () => {
    expect(repeatedKeys('fr.json')).toEqual([])
    expect(repeatedKeys('en.json')).toEqual([])
  })
})
