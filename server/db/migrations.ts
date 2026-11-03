import type { DatabaseSync } from 'node:sqlite'

// Each migration runs once, in order; PRAGMA user_version records how many have run.
// Never edit a migration once it is deployed: add a new one.
const MIGRATIONS: string[] = [
  `
  -- Every item a feed ever listed. Rows are kept for good; their heavy columns are cleared after a while.
  CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    lang TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    link TEXT NOT NULL,
    published_at TEXT,
    image TEXT,
    media TEXT,
    -- Full article HTML from the feed, for sites that block their article pages; cleared once checked.
    feed_content TEXT,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    -- Readability verdict: NULL until checked, then 0 or 1.
    readable INTEGER,
    page_image TEXT
  );
  CREATE INDEX articles_source_published ON articles (source_id, published_at);

  -- Reader mode text, so an article opens without fetching its page again.
  CREATE TABLE article_content (
    article_id TEXT PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
    title TEXT,
    byline TEXT,
    content_html TEXT NOT NULL,
    text_length INTEGER NOT NULL,
    image TEXT,
    extracted_at INTEGER NOT NULL
  );

  -- AI output is paid for once: shown again for free.
  CREATE TABLE ai_summaries (
    article_id TEXT PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
    points TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE daily_briefs (
    id INTEGER PRIMARY KEY,
    points TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Each call to the API, for the daily caps to survive a restart.
  CREATE TABLE ai_calls (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX ai_calls_kind_at ON ai_calls (kind, at);
  `,
  `
  -- The reader's own state, shared by every device (one user: whoever has the password).
  -- Small JSON documents by key: 'preferences' for now.
  CREATE TABLE user_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- "Enregistrés": the item as the card showed it, so the card stays even without an article row.
  CREATE TABLE saved_articles (
    article_id TEXT PRIMARY KEY,
    item TEXT NOT NULL,
    -- Reader text brought from a device, for articles saved before the server kept them.
    article TEXT,
    saved_at INTEGER NOT NULL
  );

  CREATE TABLE read_articles (
    article_id TEXT PRIMARY KEY,
    read_at INTEGER NOT NULL
  );
  CREATE INDEX read_articles_read_at ON read_articles (read_at);

  -- One row per article opened in the reader, on the day it was first opened: the stats.
  CREATE TABLE readings (
    article_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    topic_id TEXT,
    minutes INTEGER NOT NULL,
    read_at INTEGER NOT NULL
  );
  CREATE INDEX readings_read_at ON readings (read_at);

  -- Each device's push subscription and what it is told about, so alerts resume after a restart.
  CREATE TABLE push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    settings TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  `
  -- Known once the article is extracted: shown on its card.
  ALTER TABLE articles ADD COLUMN reading_minutes INTEGER;
  ALTER TABLE articles ADD COLUMN author TEXT;
  CREATE INDEX articles_published ON articles (published_at);
  -- About 1,380 characters a minute (230 words): the same estimate as for new articles.
  UPDATE articles SET
    reading_minutes = (SELECT MAX(1, CAST(ROUND(text_length / 1380.0) AS INTEGER)) FROM article_content
      WHERE article_id = articles.id),
    author = (SELECT CASE WHEN length(trim(byline)) BETWEEN 1 AND 80 THEN trim(byline) END FROM article_content
      WHERE article_id = articles.id)
  WHERE readable = 1;

  -- Full-text search over every stored title and summary, accents and case aside.
  CREATE VIRTUAL TABLE articles_fts USING fts5 (
    title, summary,
    content = 'articles', content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  INSERT INTO articles_fts (rowid, title, summary) SELECT rowid, title, summary FROM articles;
  CREATE TRIGGER articles_fts_insert AFTER INSERT ON articles BEGIN
    INSERT INTO articles_fts (rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
  END;
  CREATE TRIGGER articles_fts_update AFTER UPDATE OF title, summary ON articles BEGIN
    INSERT INTO articles_fts (articles_fts, rowid, title, summary) VALUES ('delete', old.rowid, old.title, old.summary);
    INSERT INTO articles_fts (rowid, title, summary) VALUES (new.rowid, new.title, new.summary);
  END;
  CREATE TRIGGER articles_fts_delete AFTER DELETE ON articles BEGIN
    INSERT INTO articles_fts (articles_fts, rowid, title, summary) VALUES ('delete', old.rowid, old.title, old.summary);
  END;

  -- Each source's icon, fetched once from its site. data NULL: the site has none, asked again later.
  CREATE TABLE source_icons (
    source_id TEXT PRIMARY KEY,
    content_type TEXT,
    data BLOB,
    fetched_at INTEGER NOT NULL
  );
  `,
  `
  -- Hidden from the lists without being opened (a swipe, "Masquer"): read, and brought back from the history.
  ALTER TABLE read_articles ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  `,
  `
  -- A YouTube video's length, read once from its page (its feed has none). seconds NULL: not found, asked again later.
  CREATE TABLE video_durations (
    video_id TEXT PRIMARY KEY,
    seconds INTEGER,
    fetched_at INTEGER NOT NULL
  );
  `,
  `
  -- A seen video or episode counts in the stats beside the articles, minutes being its length.
  ALTER TABLE readings ADD COLUMN kind TEXT NOT NULL DEFAULT 'article';
  `,
  `
  -- Profiles, as on Netflix: one household (the password), several readers, each with their own state.
  -- What was here becomes the first profile's.
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  INSERT INTO accounts (id, name, created_at) VALUES (1, 'Foyer', CAST(unixepoch('subsec') * 1000 AS INTEGER));

  CREATE TABLE profiles (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    -- A topic's colour for the avatar's initial when there is no photo.
    color TEXT NOT NULL,
    -- A square picture, made small on the device before it is sent.
    photo BLOB,
    photo_type TEXT,
    photo_version INTEGER,
    position INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX profiles_account ON profiles (account_id, position);
  INSERT INTO profiles (id, account_id, name, color, position, created_at)
  VALUES (1, 1, 'Admin', 'monde', 0, CAST(unixepoch('subsec') * 1000 AS INTEGER));

  -- Every table of the reader's state gets the profile it belongs to, in its key.
  CREATE TABLE profile_settings (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, key)
  );
  INSERT INTO profile_settings SELECT 1, key, value, updated_at FROM user_settings;
  DROP TABLE user_settings;

  CREATE TABLE saved_new (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    item TEXT NOT NULL,
    article TEXT,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, article_id)
  );
  INSERT INTO saved_new SELECT 1, article_id, item, article, saved_at FROM saved_articles;
  DROP TABLE saved_articles;
  ALTER TABLE saved_new RENAME TO saved_articles;
  CREATE INDEX saved_articles_article ON saved_articles (article_id);

  CREATE TABLE read_new (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    read_at INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, article_id)
  );
  INSERT INTO read_new SELECT 1, article_id, read_at, hidden FROM read_articles;
  DROP TABLE read_articles;
  ALTER TABLE read_new RENAME TO read_articles;
  CREATE INDEX read_articles_read_at ON read_articles (profile_id, read_at);

  CREATE TABLE readings_new (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    topic_id TEXT,
    minutes INTEGER NOT NULL,
    read_at INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'article',
    PRIMARY KEY (profile_id, article_id)
  );
  INSERT INTO readings_new
  SELECT 1, article_id, source_id, source_name, topic_id, minutes, read_at, kind FROM readings;
  DROP TABLE readings;
  ALTER TABLE readings_new RENAME TO readings;
  CREATE INDEX readings_read_at ON readings (profile_id, read_at);

  -- A device's subscription alerts the profile open on it.
  CREATE TABLE push_new (
    endpoint TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    settings TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  INSERT INTO push_new SELECT endpoint, 1, settings, updated_at FROM push_subscriptions;
  DROP TABLE push_subscriptions;
  ALTER TABLE push_new RENAME TO push_subscriptions;
  CREATE INDEX push_subscriptions_profile ON push_subscriptions (profile_id);
  `,
  // Each AI call counts against the profile that asked as well as the household. Earlier calls were the first profile's.
  `
  ALTER TABLE ai_calls ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1;
  `,
  // The sources' catalogue: sources.yml's, written again at each start, and later those a profile adds.
  // section: 'topic' or 'listen', section_id the topic's or the listen section's id.
  `
  CREATE TABLE sources (
    id TEXT PRIMARY KEY,
    section TEXT NOT NULL,
    section_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    kind TEXT NOT NULL,
    lang TEXT NOT NULL,
    domains TEXT NOT NULL,
    reader INTEGER NOT NULL,
    skip TEXT NOT NULL,
    -- null: from sources.yml.
    added_by INTEGER REFERENCES profiles (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX sources_added_by ON sources (added_by);
  `,
  // Each profile's own Bref du jour, written from its sources. The earlier ones were the first profile's.
  `
  ALTER TABLE daily_briefs ADD COLUMN profile_id INTEGER NOT NULL DEFAULT 1;
  CREATE INDEX daily_briefs_profile ON daily_briefs (profile_id, created_at);
  `,
  // One admin per household, its first profile: it manages the profiles and the shared data.
  `
  ALTER TABLE profiles ADD COLUMN role TEXT NOT NULL DEFAULT 'member';
  UPDATE profiles SET role = 'admin' WHERE id IN (SELECT MIN(id) FROM profiles GROUP BY account_id);
  `,
  // A PIN on the admin's profile, asked in "Qui lit ?". pin_version changes with it: the devices that knew the
  // old one choose the profile again.
  `
  ALTER TABLE profiles ADD COLUMN pin_hash TEXT;
  ALTER TABLE profiles ADD COLUMN pin_version INTEGER NOT NULL DEFAULT 0;
  `,
  // "À la une" stories a profile has looked at, on any device: they make room for the next ones.
  `
  CREATE TABLE seen_stories (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, article_id)
  );
  CREATE INDEX seen_stories_seen_at ON seen_stories (seen_at);
  `,
  // One-time steps already done: 'catalog' once sources.yml has filled the sources table. From then on the
  // database holds the sources, and the file only starts a new one.
  `
  CREATE TABLE seeds (
    name TEXT PRIMARY KEY,
    done_at INTEGER NOT NULL
  );
  `,
  // A source in several topics: their ids, as a JSON list, the first one where its articles are labelled.
  // section_id stays the first topic (or the "Vidéos" section).
  `
  ALTER TABLE sources ADD COLUMN topics TEXT;
  UPDATE sources SET topics = json_array(section_id) WHERE section = 'topic';
  `,
  // What was really read of an article: done once 80 % of it scrolled by or half its estimated time spent (NULL
  // before this was tracked: counted as read), how far it went, where it was left, and the estimated minutes
  // (minutes is then the time really spent).
  `
  ALTER TABLE readings ADD COLUMN done INTEGER;
  ALTER TABLE readings ADD COLUMN progress REAL;
  ALTER TABLE readings ADD COLUMN position REAL;
  ALTER TABLE readings ADD COLUMN estimate REAL;
  `,
  // An article in progress taken off "Reprendre" with its cross: it is not offered there again.
  `
  ALTER TABLE readings ADD COLUMN set_aside INTEGER NOT NULL DEFAULT 0;
  `,
  // An AI call the admin put back to 0: 1, it no longer counts for its profile (the household still counts it);
  // 2, it counts for no one.
  `
  ALTER TABLE ai_calls ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0;
  `,
  // "Partages": an article a profile sent to another one, with the card as it was then (the feeds move on).
  `
  CREATE TABLE shares (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    article_id TEXT NOT NULL,
    from_profile INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    item TEXT NOT NULL,
    shared_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, article_id, from_profile)
  );
  CREATE INDEX shares_shared_at ON shares (shared_at);
  `,
  // A word with a share ("Regarde ça pour samedi"), shown on its card.
  `
  ALTER TABLE shares ADD COLUMN note TEXT;
  `,
  // A share read stays, out of "Partages", for the emoji its reader sends back; the sender sees it once.
  `
  ALTER TABLE shares ADD COLUMN read_at INTEGER;
  ALTER TABLE shares ADD COLUMN reaction TEXT;
  ALTER TABLE shares ADD COLUMN reacted_at INTEGER;
  ALTER TABLE shares ADD COLUMN reaction_seen INTEGER NOT NULL DEFAULT 0;
  `,
  // A profile the admin just added opens on the guided tour, on whichever device it is first opened.
  `
  ALTER TABLE profiles ADD COLUMN tour_pending INTEGER NOT NULL DEFAULT 0;
  `,
  // A Reddit post opened from a topic, kept as it was then for "Historique": Bref does not store Reddit's posts.
  `
  CREATE TABLE opened_posts (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    post_id TEXT NOT NULL,
    post TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, post_id)
  );
  CREATE INDEX opened_posts_opened_at ON opened_posts (opened_at);
  `,
  // "Historique" lists the articles only after all: the Reddit posts opened are no longer kept.
  `
  DROP TABLE opened_posts;
  `,
  // The household's settings, made in the first-run screens and changed in
  // Réglages > Foyer: no password yet means the install still waits for them.
  `
  ALTER TABLE accounts ADD COLUMN password_hash TEXT;
  ALTER TABLE accounts ADD COLUMN password_changed_at INTEGER;
  ALTER TABLE accounts ADD COLUMN time_zone TEXT;
  ALTER TABLE accounts ADD COLUMN country TEXT;
  ALTER TABLE accounts ADD COLUMN ai_provider TEXT;
  ALTER TABLE accounts ADD COLUMN ai_key TEXT;
  ALTER TABLE accounts ADD COLUMN ai_model TEXT;
  `,
  // Reddit closed its feeds (13 November 2026): the subreddits the profiles added go, their posts age out.
  `
  DELETE FROM sources WHERE url LIKE 'https://www.reddit.com/%' OR url LIKE 'https://old.reddit.com/%';
  `,
  // The household game: what earned points, kept after the readings are pruned. One row per thing that earned
  // (its kind and ref: an article, a day, a share), with the household's day and hour of then.
  `
  CREATE TABLE game_events (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    points INTEGER NOT NULL,
    at INTEGER NOT NULL,
    day TEXT NOT NULL,
    hour INTEGER NOT NULL,
    topic_id TEXT,
    PRIMARY KEY (profile_id, kind, ref)
  );
  CREATE INDEX game_events_day ON game_events (profile_id, day);
  `,
  // The admin can turn the household game off (Réglages > Foyer); it starts on.
  `
  ALTER TABLE accounts ADD COLUMN game INTEGER NOT NULL DEFAULT 1;
  `,
  // "Déconnecter les autres appareils": raising it changes the key every session is signed with.
  `
  ALTER TABLE accounts ADD COLUMN session_generation INTEGER NOT NULL DEFAULT 0;
  `,
  // The interface's language for the whole household, chosen in the first-run screens; a profile may pick another.
  `
  ALTER TABLE accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'fr';
  `,
  // The AI writes in the reader's language: an article keeps one summary per language, and a Bref du jour
  // says which language it is in. Everything written so far was French.
  `
  CREATE TABLE ai_summaries_by_language (
    article_id TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
    language TEXT NOT NULL,
    points TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (article_id, language)
  );
  INSERT INTO ai_summaries_by_language (article_id, language, points, created_at)
    SELECT article_id, 'fr', points, created_at FROM ai_summaries;
  DROP TABLE ai_summaries;
  ALTER TABLE ai_summaries_by_language RENAME TO ai_summaries;
  ALTER TABLE daily_briefs ADD COLUMN language TEXT NOT NULL DEFAULT 'fr';
  `,
  // Young profiles: a teen or a child, managed by the household's adults; a child wears a drawn avatar.
  `
  ALTER TABLE profiles ADD COLUMN kind TEXT NOT NULL DEFAULT 'adult';
  ALTER TABLE profiles ADD COLUMN avatar TEXT;
  `,
  // The Code parental: once the household has young profiles, it opens every adult without a PIN of its own.
  `
  ALTER TABLE accounts ADD COLUMN parental_pin_hash TEXT;
  ALTER TABLE accounts ADD COLUMN parental_pin_version INTEGER NOT NULL DEFAULT 0;
  `,
  // A young profile's rules, set by its parents, and the seconds it spent on screen each day.
  `
  CREATE TABLE youth_rules (
    profile_id INTEGER PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE,
    daily_minutes INTEGER,
    window_start TEXT,
    window_end TEXT,
    quiet_start TEXT,
    quiet_end TEXT,
    explain_per_day INTEGER NOT NULL
  );
  CREATE TABLE youth_time (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    seconds INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, day)
  );
  `,
  // A young profile's sources and themes, its parents' choice, and the sources a teen asked them for.
  `
  CREATE TABLE youth_sources (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    source_id TEXT NOT NULL,
    PRIMARY KEY (profile_id, source_id)
  );
  CREATE TABLE youth_sources_set (
    profile_id INTEGER PRIMARY KEY REFERENCES profiles (id) ON DELETE CASCADE
  );
  CREATE TABLE youth_topics (
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL,
    PRIMARY KEY (profile_id, topic_id)
  );
  CREATE TABLE source_requests (
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    at INTEGER NOT NULL,
    decided_at INTEGER
  );
  `,
  // How the household writes the time of day: 24 (21:00) or 12 (9:00 PM), for every profile and device.
  `
  ALTER TABLE accounts ADD COLUMN hour_cycle INTEGER NOT NULL DEFAULT 24;
  `,
  // A teen sees its parents' answer once, on top of its Réglages: seen once shown there.
  `
  ALTER TABLE source_requests ADD COLUMN seen INTEGER NOT NULL DEFAULT 0;
  `,
  // The game's test command is gone: the points and badges it made up go with it.
  `
  DELETE FROM game_events WHERE ref LIKE 'seed:%';
  `,
  // The daily summary ("Résumé du jour") and its AI calls, named "brief" before the app became Hodi.
  `
  ALTER TABLE daily_briefs RENAME TO daily_summaries;
  DROP INDEX daily_briefs_profile;
  CREATE INDEX daily_summaries_profile ON daily_summaries (profile_id, created_at);
  UPDATE ai_calls SET kind = 'dailySummary' WHERE kind = 'brief';
  `,
  // The temporary level command is gone too: the points it made up go with it.
  `
  DELETE FROM game_events WHERE ref LIKE 'seed:%';
  `,
  // Article pictures made smaller on the server (the files are in the data folder): a tiny blurred preview shown
  // while the picture loads, or a mark that the original could not be fetched or read.
  `
  CREATE TABLE article_images (
    article_id TEXT PRIMARY KEY REFERENCES articles (id) ON DELETE CASCADE,
    preview TEXT,
    failed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  `
]

// target: a version before the last, for tests that fill an older schema then migrate it.
export const migrate = (db: DatabaseSync, target = MIGRATIONS.length) => {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }

  MIGRATIONS.slice(version, target).forEach((sql, index) => {
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.exec(`PRAGMA user_version = ${version + index + 1}`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  })
}

export const SCHEMA_VERSION = MIGRATIONS.length

// The version just before the first migration whose SQL holds this text, for tests that start from an older schema.
export const versionBefore = (sql: string) => MIGRATIONS.findIndex(migration => migration.includes(sql))
