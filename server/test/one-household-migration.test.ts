import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'
import { migrate, versionBefore } from '../db/migrations.ts'

describe('the households merged into one', () => {
  it("moves every profile, code and plugin's AI turned off into the first household, the later ones after its own", () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, versionBefore('CREATE TEMP TABLE merged_positions'))
    db.exec(`
      INSERT INTO accounts (id, name, created_at) VALUES (2, 'Famille Martin', 0);
      DELETE FROM profiles;
      INSERT INTO profiles (id, account_id, name, color, position, created_at, role) VALUES
        (1, 1, 'Claire', 'tech', 0, 0, 'admin'),
        (2, 2, 'Marc', 'world', 0, 0, 'admin'),
        (3, 1, 'Léo', 'sport', 1, 0, 'member'),
        (4, 2, 'Lina', 'music', 1, 0, 'member');
      INSERT INTO sign_in_codes (code_hash, account_id, profile_id, created_by, reset, created_at, expires_at)
        VALUES ('h', 2, NULL, 2, 0, 0, 1);
      INSERT INTO plugin_ai_off (household_id, plugin_id) VALUES (2, 'helper'), (1, 'notes'), (2, 'notes');
    `)

    migrate(db)

    assert.deepEqual(
      db
        .prepare('SELECT name, account_id, position, role FROM profiles ORDER BY position')
        .all()
        .map(row => Object.values(row)),
      [
        ['Claire', 1, 0, 'admin'],
        ['Léo', 1, 1, 'member'],
        ['Marc', 1, 2, 'member'],
        ['Lina', 1, 3, 'member']
      ]
    )
    assert.deepEqual(
      db
        .prepare('SELECT DISTINCT account_id FROM sign_in_codes')
        .all()
        .map(row => row.account_id),
      [1]
    )
    assert.deepEqual(
      db
        .prepare('SELECT household_id, plugin_id FROM plugin_ai_off ORDER BY plugin_id')
        .all()
        .map(row => Object.values(row)),
      [
        [1, 'helper'],
        [1, 'notes']
      ]
    )
  })

  it('keeps one profile per account, its first household’s, and deletes the other with what was sent to it', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('PRAGMA foreign_keys = ON')
    migrate(db, versionBefore('CREATE TEMP TABLE merged_positions'))
    db.exec(`
      INSERT INTO accounts (id, name, created_at) VALUES (2, 'Famille Martin', 0);
      INSERT INTO users (id, email, password_hash, created_at, password_changed_at) VALUES (7, 'marc@example.com', 'hash', 0, 0);
      DELETE FROM profiles;
      INSERT INTO profiles (id, account_id, name, color, position, created_at, role, user_id) VALUES
        (1, 1, 'Marc', 'tech', 0, 0, 'admin', 7),
        (2, 2, 'Marc', 'world', 0, 0, 'admin', 7),
        (3, 2, 'Lina', 'music', 1, 0, 'member', NULL);
      INSERT INTO shares (profile_id, article_id, from_profile, item, shared_at) VALUES (2, 'a', 3, '{}', 0);
    `)

    migrate(db)

    assert.deepEqual(
      db
        .prepare('SELECT id, account_id, user_id FROM profiles ORDER BY id')
        .all()
        .map(row => Object.values(row)),
      [
        [1, 1, 7],
        [3, 1, null]
      ]
    )
    // Nothing of the profile that went stays for anyone to open: no account-less profile holds the person's shares.
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM shares').get() as { n: number }).n, 0)
  })
})
