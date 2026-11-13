import { describe, expect, it } from 'vitest'
import { availableOf, newerVersion, updateOf } from '../src/plugins/catalog.ts'

const listed = (id: string, version: string) => ({
  id,
  name: id,
  description: '',
  translations: {},
  version,
  repo: `https://github.com/someone/${id}`
})

describe("Hodi's plugin registry in Serveur › Plugins", () => {
  it('compares versions number by number', () => {
    expect(newerVersion('1.10.0', '1.9.2')).toBe(true)
    expect(newerVersion('0.2.2', '0.2.1')).toBe(true)
    expect(newerVersion('0.2.1', '0.2.1')).toBe(false)
    expect(newerVersion('0.2.0', '0.10.0')).toBe(false)
    expect(newerVersion('1.0', '1.0.0')).toBe(false)
  })

  it('offers the plugins the server does not have, and the newer version of one it has', () => {
    const catalog = [listed('diagnostic', '0.2.2'), listed('voice', '0.3.0')]
    expect(availableOf(catalog, [{ id: 'diagnostic', version: '0.2.1' }]).map(plugin => plugin.id)).toEqual(['voice'])
    expect(updateOf(catalog, { id: 'diagnostic', version: '0.2.1' })).toBe('0.2.2')
    expect(updateOf(catalog, { id: 'diagnostic', version: '0.2.2' })).toBeNull()
    expect(updateOf(catalog, { id: 'diagnostic', version: '0.3.0' })).toBeNull()
    // A build in development is the author's own: the registry never offers to replace it.
    expect(updateOf(catalog, { id: 'diagnostic', version: '0.2.1', dev: true })).toBeNull()
    expect(updateOf(catalog, { id: 'mine', version: '1.0.0' })).toBeNull()
  })
})
