import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'
import { isAllowedHost, isSkipped, loadCatalog, parseCatalog } from '../news/catalog.ts'

const valid = `
topics:
  - id: tech
    label: Tech
    sources:
      - id: korben
        name: Korben
        url: https://korben.info/feed
        domains: [korben.info]
listen:
  - id: actu
    label: Actu
    sources:
      - id: yt-test
        name: Test
        url: https://www.youtube.com/feeds/videos.xml?channel_id=UC123
        lang: en
`

describe('parseCatalog', () => {
  it('applies defaults: articles in topics, videos in listen, French', () => {
    const catalog = parseCatalog(valid)

    assert.equal(catalog.topics[0]?.sources[0]?.kind, 'article')
    assert.equal(catalog.topics[0]?.sources[0]?.lang, 'fr')
    assert.equal(catalog.listen[0]?.sources[0]?.kind, 'video')
    assert.equal(catalog.listen[0]?.sources[0]?.lang, 'en')
  })

  it('leaves out the links under a skipped path, encoded or not', () => {
    const source = parseCatalog(
      valid.replace('        domains: [korben.info]\n', '        domains: [korben.info]\n        skip: [/fr/vidéo/]\n')
    ).topics[0]!.sources[0]!

    assert.equal(isSkipped(source, 'https://korben.info/fr/vid%C3%A9o/20261025-obama'), true)
    assert.equal(isSkipped(source, 'https://korben.info/fr/vidéo/20261025-obama'), true)
    assert.equal(isSkipped(source, 'https://korben.info/fr/am%C3%A9riques/20261025-bresil'), false)
    assert.throws(
      () =>
        parseCatalog(
          valid.replace('        domains: [korben.info]\n', '        domains: [korben.info]\n        skip: [video]\n')
        ),
      /path/
    )
  })

  it('rejects plain http feeds', () => {
    assert.throws(() => parseCatalog(valid.replace('https://korben.info/feed', 'http://korben.info/feed')), /https/)
  })

  it('requires domains for article sources', () => {
    assert.throws(() => parseCatalog(valid.replace('        domains: [korben.info]\n', '')), /domains/)
  })

  it('reads reader: false as a link-only source, which needs no domains', () => {
    const catalog = parseCatalog(valid.replace('        domains: [korben.info]\n', '        reader: false\n'))

    assert.equal(parseCatalog(valid).topics[0]?.sources[0]?.reader, true)
    assert.equal(catalog.topics[0]?.sources[0]?.reader, false)
    assert.throws(() => parseCatalog(valid.replace('domains: [korben.info]', 'reader: maybe')), /reader/)
  })

  it('still reads a file that lists subreddits, and ignores them', () => {
    const withReddit = valid.replace(
      '        domains: [korben.info]\n',
      '        domains: [korben.info]\n    reddit: [technology, r/gadgets]\n'
    )

    assert.deepEqual(parseCatalog(withReddit), parseCatalog(valid))
  })

  it('rejects duplicate source ids', () => {
    assert.throws(() => parseCatalog(valid.replace('id: yt-test', 'id: korben')), /duplicate source id korben/)
  })

  it('rejects articles in listen', () => {
    assert.throws(
      () => parseCatalog(`${valid}        kind: article\n        domains: [youtube.com]\n`),
      /video or podcast/
    )
  })

  it('reads a name for every language, or one per language', () => {
    const named = (label: string) => parseCatalog(valid.replace('label: Tech', `label: ${label}`)).topics[0]
    assert.deepEqual(named('Tech'), { ...named('Tech'), label: 'Tech' })
    assert.equal(named('Tech')?.labels, undefined)
    assert.deepEqual(named('{ fr: Monde, en: World }')?.labels, { fr: 'Monde', en: 'World' })
    assert.equal(named('{ fr: Monde, en: World }')?.label, 'Monde')
    // A language left out shows the other one.
    assert.equal(named('{ en: World }')?.label, 'World')
    assert.throws(() => named('{ nl: Wereld }'), /label.nl: expected one of fr, en/)
    assert.throws(() => named('{ fr: "" }'), /label.fr: expected a non-empty string/)
    assert.throws(() => named('[Monde]'), /label: expected a name, or one per language/)
  })

  it('reads base as the household languages a source is a base one for', () => {
    const korben = (extra: string) =>
      parseCatalog(valid.replace('domains: [korben.info]', `domains: [korben.info]\n${extra}`))
    assert.deepEqual(korben('        base: [fr, en]').topics[0]?.sources[0]?.base, ['fr', 'en'])
    assert.equal(korben('').topics[0]?.sources[0]?.base, undefined)
    assert.throws(() => korben('        base: true'), /base: expected a list/)
    assert.throws(() => korben('        base: [nl]'), /base\[0\]: expected one of fr, en/)
  })

  it('loads the sources.yml shipped with the app, with base sources in each language', () => {
    const catalog = loadCatalog(path.resolve(import.meta.dirname, '../../sources.yml'))

    assert.ok(catalog.topics.some(topic => topic.id === 'ia'))
    assert.ok(catalog.listen.some(section => section.sources.length > 0))
    for (const language of ['fr', 'en'] as const) {
      const base = catalog.topics.flatMap(topic => topic.sources.filter(source => source.base?.includes(language)))
      assert.ok(base.length > 0, language)
      // A base source is read in the household's language.
      assert.ok(
        base.every(source => source.lang === language),
        language
      )
    }
  })
})

describe('isAllowedHost', () => {
  const [source] = parseCatalog(valid).topics[0]?.sources ?? []

  it('accepts the domain and its subdomains over https only', () => {
    assert.ok(source)
    assert.equal(isAllowedHost(source, new URL('https://korben.info/a')), true)
    assert.equal(isAllowedHost(source, new URL('https://www.korben.info/a')), true)
    assert.equal(isAllowedHost(source, new URL('http://korben.info/a')), false)
    assert.equal(isAllowedHost(source, new URL('https://notkorben.info/a')), false)
    assert.equal(isAllowedHost(source, new URL('https://korben.info.evil.com/a')), false)
  })
})
