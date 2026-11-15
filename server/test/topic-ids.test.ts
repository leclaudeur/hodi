import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { migrate, versionBefore } from '../db/migrations.ts'

const NOW = Date.UTC(2026, 10, 5, 12)

describe('English topic ids', () => {
  it('moves every stored French topic id to its English one', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db, versionBefore('CREATE TEMP TABLE topic_renames'))
    db.prepare("UPDATE profiles SET color = 'jeux-video' WHERE id = 1").run()
    db.prepare(
      `INSERT INTO readings (profile_id, article_id, source_id, source_name, topic_id, minutes, read_at)
       VALUES (1, 'a1', 'rtl', 'RTL', 'belgique', 3, ?), (1, 'a2', 'wired', 'Wired', 'tech', 3, ?)`
    ).run(NOW, NOW)
    db.prepare(
      `INSERT INTO game_events (profile_id, kind, ref, points, at, day, hour, topic_id)
       VALUES (1, 'first_of_theme', '2026-11-05:monde', 5, ?, '2026-11-05', 12, 'monde'),
              (1, 'article_read', 'a1', 1, ?, '2026-11-05', 12, 'belgique')`
    ).run(NOW, NOW)
    db.prepare("INSERT INTO youth_topics (profile_id, topic_id) VALUES (1, 'animaux')").run()
    db.prepare(
      `INSERT INTO sources (id, section, section_id, position, name, url, kind, lang, domains, reader, skip, created_at, topics)
       VALUES ('blog', 'topic', 'maison-deco', 0, 'Blog', 'https://blog.example/feed', 'rss', 'fr', '[]', 1, '[]', ?,
               '["maison-deco","tech","ia"]')`
    ).run(NOW)
    db.prepare(
      `INSERT INTO profile_settings (profile_id, key, value, updated_at)
       VALUES (1, 'preferences', ?, ?), (1, 'revision', '7', ?)`
    ).run(
      JSON.stringify({ topicOrder: ['monde', 'tech', 'belgique'], hiddenTopics: ['sante'], accent: 'films-series' }),
      NOW,
      NOW
    )
    db.prepare("INSERT INTO saved_articles (profile_id, article_id, item, saved_at) VALUES (1, 'a1', ?, ?)").run(
      JSON.stringify({ id: 'a1', topicId: 'belgique', title: 'Budget' }),
      NOW
    )
    db.prepare(
      "INSERT INTO daily_summaries (points, generated_at, created_at, profile_id, language) VALUES (?, '2026-11-05', ?, 1, 'fr')"
    ).run(
      JSON.stringify([
        { text: 'Budget', topicId: 'belgique' },
        { text: 'Puce', topicId: 'tech' }
      ]),
      NOW
    )

    migrate(db)

    const one = (sql: string) => Object.values(db.prepare(sql).get() as Record<string, unknown>)[0]
    assert.equal(one('SELECT color FROM profiles WHERE id = 1'), 'gaming')
    assert.deepEqual(
      db
        .prepare('SELECT topic_id FROM readings ORDER BY article_id')
        .all()
        .map(row => row.topic_id),
      ['belgium', 'tech']
    )
    assert.deepEqual(
      db
        .prepare('SELECT ref, topic_id FROM game_events ORDER BY kind')
        .all()
        .map(row => [row.ref, row.topic_id]),
      [
        ['a1', 'belgium'],
        ['2026-11-05:world', 'world']
      ]
    )
    assert.equal(one('SELECT topic_id FROM youth_topics'), 'animals')
    assert.equal(one('SELECT section_id FROM sources'), 'home')
    assert.deepEqual(JSON.parse(one('SELECT topics FROM sources') as string), ['home', 'tech', 'ai'])
    assert.deepEqual(JSON.parse(one("SELECT value FROM profile_settings WHERE key = 'preferences'") as string), {
      topicOrder: ['world', 'tech', 'belgium'],
      hiddenTopics: ['health'],
      accent: 'film-tv'
    })
    assert.equal(one("SELECT value FROM profile_settings WHERE key = 'revision'"), '8')
    assert.equal(JSON.parse(one('SELECT item FROM saved_articles') as string).topicId, 'belgium')
    assert.deepEqual(
      (JSON.parse(one('SELECT points FROM daily_summaries') as string) as { topicId: string }[]).map(
        point => point.topicId
      ),
      ['belgium', 'tech']
    )
  })
})
