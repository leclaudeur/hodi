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
  `,
  // Poudré's id becomes English (powder), like every id. Its devices fetch the profile's state again.
  `
  UPDATE profile_settings SET value = CAST(value AS INTEGER) + 1
  WHERE key = 'revision' AND profile_id IN (
    SELECT profile_id FROM profile_settings
    WHERE key = 'preferences' AND json_valid(value) AND json_extract(value, '$.theme') = 'poudre'
  );
  UPDATE profile_settings SET value = json_set(value, '$.theme', 'powder')
  WHERE key = 'preferences' AND json_valid(value) AND json_extract(value, '$.theme') = 'poudre';
  `,
  // The topics' ids become English, like every id and address (Belgique stays its label, its id is belgium). Every
  // place that keeps one follows: readings, points, a young profile's topics, avatar colours, sources, preferences,
  // saved and shared items, daily summaries. A profile whose own state changed gets a new revision, so that its devices fetch it again.
  `
  CREATE TEMP TABLE topic_renames (old TEXT PRIMARY KEY, new TEXT NOT NULL);
  INSERT INTO topic_renames (old, new) VALUES
    ('belgique', 'belgium'),
    ('monde', 'world'),
    ('films-series', 'film-tv'),
    ('jeux-video', 'gaming'),
    ('ia', 'ai'),
    ('auto-moto', 'motoring'),
    ('argent-conso', 'money'),
    ('sante', 'health'),
    ('cuisine', 'food'),
    ('voyage', 'travel'),
    ('musique', 'music'),
    ('maison-deco', 'home'),
    ('famille', 'family'),
    ('mode-beaute', 'fashion'),
    ('climat', 'climate'),
    ('animaux', 'animals'),
    ('divers', 'other');

  UPDATE readings SET topic_id = (SELECT new FROM topic_renames WHERE old = topic_id)
  WHERE topic_id IN (SELECT old FROM topic_renames);
  UPDATE game_events SET topic_id = (SELECT new FROM topic_renames WHERE old = topic_id)
  WHERE topic_id IN (SELECT old FROM topic_renames);
  -- "First of the theme today" is known by its day and topic, so that it never counts twice.
  UPDATE game_events
  SET ref = substr(ref, 1, instr(ref, ':')) || (SELECT new FROM topic_renames WHERE old = substr(ref, instr(ref, ':') + 1))
  WHERE kind = 'first_of_theme' AND substr(ref, instr(ref, ':') + 1) IN (SELECT old FROM topic_renames);
  UPDATE youth_topics SET topic_id = (SELECT new FROM topic_renames WHERE old = topic_id)
  WHERE topic_id IN (SELECT old FROM topic_renames);
  UPDATE profiles SET color = (SELECT new FROM topic_renames WHERE old = color)
  WHERE color IN (SELECT old FROM topic_renames);

  UPDATE sources SET section_id = (SELECT new FROM topic_renames WHERE old = section_id)
  WHERE section_id IN (SELECT old FROM topic_renames);
  UPDATE sources SET topics = (
    SELECT json_group_array(coalesce((SELECT new FROM topic_renames WHERE old = topic.value), topic.value) ORDER BY topic.key)
    FROM json_each(sources.topics) AS topic
  )
  WHERE topics IS NOT NULL AND json_valid(topics);

  -- The profiles whose own state changes, to send it again to their devices.
  CREATE TEMP TABLE renamed_profiles AS
    SELECT profile_id FROM readings WHERE topic_id IN (SELECT old FROM topic_renames)
    UNION SELECT profile_id FROM saved_articles
      WHERE json_valid(item) AND json_extract(item, '$.topicId') IN (SELECT old FROM topic_renames)
    UNION SELECT profile_settings.profile_id FROM profile_settings, json_each(profile_settings.value, '$.topicOrder') AS topic
      WHERE profile_settings.key = 'preferences' AND json_valid(profile_settings.value) AND topic.value IN (SELECT old FROM topic_renames)
    UNION SELECT profile_settings.profile_id FROM profile_settings, json_each(profile_settings.value, '$.hiddenTopics') AS topic
      WHERE profile_settings.key = 'preferences' AND json_valid(profile_settings.value) AND topic.value IN (SELECT old FROM topic_renames)
    UNION SELECT profile_id FROM profile_settings
      WHERE key = 'preferences' AND json_valid(value) AND json_extract(value, '$.accent') IN (SELECT old FROM topic_renames);

  UPDATE profile_settings SET value = json_set(value, '$.topicOrder', json((
    SELECT json_group_array(coalesce((SELECT new FROM topic_renames WHERE old = topic.value), topic.value) ORDER BY topic.key)
    FROM json_each(profile_settings.value, '$.topicOrder') AS topic
  )))
  WHERE key = 'preferences' AND json_valid(value) AND json_type(value, '$.topicOrder') = 'array';
  UPDATE profile_settings SET value = json_set(value, '$.hiddenTopics', json((
    SELECT json_group_array(coalesce((SELECT new FROM topic_renames WHERE old = topic.value), topic.value) ORDER BY topic.key)
    FROM json_each(profile_settings.value, '$.hiddenTopics') AS topic
  )))
  WHERE key = 'preferences' AND json_valid(value) AND json_type(value, '$.hiddenTopics') = 'array';
  UPDATE profile_settings
  SET value = json_set(value, '$.accent', (SELECT new FROM topic_renames WHERE old = json_extract(value, '$.accent')))
  WHERE key = 'preferences' AND json_valid(value) AND json_extract(value, '$.accent') IN (SELECT old FROM topic_renames);
  UPDATE profile_settings SET value = CAST(value AS INTEGER) + 1
  WHERE key = 'revision' AND profile_id IN (SELECT profile_id FROM renamed_profiles);

  UPDATE saved_articles SET item = json_set(item, '$.topicId', (SELECT new FROM topic_renames WHERE old = json_extract(item, '$.topicId')))
  WHERE json_valid(item) AND json_extract(item, '$.topicId') IN (SELECT old FROM topic_renames);
  UPDATE shares SET item = json_set(item, '$.topicId', (SELECT new FROM topic_renames WHERE old = json_extract(item, '$.topicId')))
  WHERE json_valid(item) AND json_extract(item, '$.topicId') IN (SELECT old FROM topic_renames);
  UPDATE daily_summaries SET points = (
    SELECT json_group_array(
      CASE WHEN json_extract(point.value, '$.topicId') IN (SELECT old FROM topic_renames)
        THEN json_set(point.value, '$.topicId', (SELECT new FROM topic_renames WHERE old = json_extract(point.value, '$.topicId')))
        ELSE json(point.value) END
      ORDER BY point.key
    )
    FROM json_each(daily_summaries.points) AS point
  )
  WHERE json_valid(points) AND json_type(points) = 'array';

  DROP TABLE topic_renames;
  DROP TABLE renamed_profiles;
  `,
  // Plugins: whether each one installed is on and the settings the admin chose; and the steps of each plugin's own
  // migrations already applied, since a plugin keeps its own list of schema changes for its own tables.
  `
  CREATE TABLE plugins (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    settings TEXT NOT NULL DEFAULT '{}',
    installed_at INTEGER NOT NULL
  );
  CREATE TABLE plugin_migrations (
    plugin_id TEXT NOT NULL,
    step INTEGER NOT NULL,
    applied_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, step)
  );
  `,
  // Personal accounts: each person signs in with their own e-mail and password instead of the household's. The first
  // one, made in the first-run screens, runs the server. A profile belongs to at most one account; young profiles
  // have none. The household now counts as set up once it has a name, not a password: set_up_at says when.
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_changed_at INTEGER NOT NULL,
    session_generation INTEGER NOT NULL DEFAULT 0,
    server_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE profiles ADD COLUMN user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
  CREATE UNIQUE INDEX profiles_user ON profiles (account_id, user_id) WHERE user_id IS NOT NULL;
  ALTER TABLE accounts ADD COLUMN set_up_at INTEGER;
  UPDATE accounts SET set_up_at = COALESCE(password_changed_at, created_at) WHERE password_hash IS NOT NULL;
  `,
  // "J'ai un code": six digits an adult of the household gives a person, valid once and for a day. Without a profile,
  // an invitation to join as a new adult; with one, that profile's person makes their account. Only a keyed hash of
  // the code is kept.
  `
  CREATE TABLE sign_in_codes (
    code_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    profile_id INTEGER REFERENCES profiles (id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES profiles (id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // Réglages > Compte et données > Appareils: each device signed in with an account, so that one can be signed out
  // on its own. Its session cookie names its row; a device whose row is gone signs in again.
  `
  CREATE TABLE user_devices (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX user_devices_user ON user_devices (user_id);
  `,
  // Réglages > Profils > a young profile > Appareils: a teen's or a child's own device, linked by a parent with a
  // code, which opens that profile only. It stays linked until it goes 90 days unused or a parent removes it.
  `
  CREATE TABLE profile_devices (
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE INDEX profile_devices_profile ON profile_devices (profile_id);
  `,
  // "Mot de passe oublié", without a mail server: the admin's code for an adult who has an account lets them choose a
  // new password, from the Connexion page.
  `
  ALTER TABLE sign_in_codes ADD COLUMN reset INTEGER NOT NULL DEFAULT 0;
  `,
  // The account's password replaces the four-digit codes and the Code parental: every adult profile asks for it
  // each time it opens. The old codes go, and every device chooses its profile again once.
  `
  UPDATE accounts SET parental_pin_hash = NULL, parental_pin_version = parental_pin_version + 1;
  UPDATE profiles SET pin_hash = NULL;
  `,
  // Serveur › Vue d'ensemble counts the different profiles that opened Hodi each day: a profile once a day, kept 31
  // days, never shown but as a number.
  `
  CREATE TABLE profile_visits (
    day TEXT NOT NULL,
    profile_id INTEGER NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
    PRIMARY KEY (day, profile_id)
  );
  `,
  // Serveur › Contenu: what the server's admin changed of how long the server keeps what it fetches. A setting
  // without a row has its default.
  `
  CREATE TABLE server_settings (
    key TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  `,
  // Serveur › E-mail: the mail server Hodi sends through, one row at most. Its password stays here like an AI key.
  `
  CREATE TABLE server_mail (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    security TEXT NOT NULL,
    user TEXT,
    password TEXT,
    sender TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  `,
  // « Mot de passe oublié »: the address the e-mail's link opens, and the links sent, each valid an hour, once. The
  // table keeps a hash of each link, keyed with the server's secret.
  `
  ALTER TABLE server_mail ADD COLUMN app_url TEXT;
  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
  // Each household its own list of sources: which feeds it follows, in which topics, in which order and added by
  // whom. A feed itself (its address, kind, language, name) stays one for the whole server, fetched once whoever
  // follows it. Every source of today is the first household's.
  `
  CREATE TABLE household_sources (
    household_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    source_id TEXT NOT NULL REFERENCES sources (id) ON DELETE CASCADE,
    section TEXT NOT NULL,
    section_id TEXT NOT NULL,
    topics TEXT,
    position INTEGER NOT NULL,
    added_by INTEGER REFERENCES profiles (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (household_id, source_id)
  );
  CREATE INDEX household_sources_source ON household_sources (source_id);
  CREATE INDEX household_sources_added_by ON household_sources (added_by);
  INSERT INTO household_sources (household_id, source_id, section, section_id, topics, position, added_by, created_at)
  SELECT 1, id, section, section_id, topics, position, added_by, created_at FROM sources;
  -- Who added a feed is now each household's to know: a profile that goes takes its household's source with it,
  -- never another household's.
  UPDATE sources SET added_by = NULL;
  `,
  // Who a plugin's data belongs to (the key that signed it, or its exact files): another plugin that only takes the
  // same id starts with none of it.
  `
  ALTER TABLE plugins ADD COLUMN data_owner TEXT;
  `,
  // Households a plugin makes (ctx.households): which plugin made it, the only one that may suspend or remove it, and
  // when it was suspended. And the household a device is on once moved there (« Changer de foyer »); null: its
  // account's first.
  `
  ALTER TABLE accounts ADD COLUMN made_by_plugin TEXT;
  ALTER TABLE accounts ADD COLUMN suspended_at INTEGER;
  ALTER TABLE user_devices ADD COLUMN household_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL;
  `,
  // When each of a plugin's scheduled tasks last ran, by task name: a restart does not run them again early.
  `
  ALTER TABLE plugins ADD COLUMN task_runs TEXT NOT NULL DEFAULT '{}';
  `,
  // Another way in than a password, which a plugin keeps for an account (« Se connecter avec Google »): the plugin's
  // own name for the person there, such as google:<id>. An account a plugin made that way has no password of its own
  // (has_password 0) until the person sets one.
  `
  CREATE TABLE account_logins (
    plugin_id TEXT NOT NULL,
    login TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (plugin_id, login)
  );
  CREATE INDEX account_logins_user ON account_logins (user_id);
  ALTER TABLE users ADD COLUMN has_password INTEGER NOT NULL DEFAULT 1;
  `,
  // Serveur › Plugins › Mode développeur: the code « npx hodi-plugin dev » sends (its hash), while the mode is on, and
  // the plugins it installed.
  `
  CREATE TABLE plugin_dev (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    code_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE plugins ADD COLUMN dev INTEGER NOT NULL DEFAULT 0;
  `,
  // A plugin's AI: which plugin each of its calls was for, and the plugins a household's admin keeps away from its AI.
  `
  ALTER TABLE ai_calls ADD COLUMN plugin_id TEXT;
  CREATE TABLE plugin_ai_off (
    household_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    plugin_id TEXT NOT NULL,
    PRIMARY KEY (household_id, plugin_id)
  );
  `,
  // What each plugin still has to forget of a deleted profile, account or household: kept until its hook answered,
  // so that a plugin off, busy or failing is asked again rather than keeping the data.
  `
  CREATE TABLE plugin_erasures (
    id INTEGER PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    hook TEXT NOT NULL,
    subject TEXT NOT NULL,
    household_id INTEGER,
    created_at INTEGER NOT NULL,
    tries INTEGER NOT NULL DEFAULT 0,
    next_try_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX plugin_erasures_plugin ON plugin_erasures (plugin_id);
  -- When a plugin was removed with its data kept: the data goes 30 days later unless it comes back.
  ALTER TABLE plugins ADD COLUMN removed_at INTEGER;
  `,
  // A young profile's device cookie now names its row's creation time too: SQLite gives a removed row's id to the
  // next one, and an old cookie must not open the device linked after it. The devices linked before keep their
  // cookie without that time until it is sent again.
  `
  ALTER TABLE profile_devices ADD COLUMN legacy INTEGER NOT NULL DEFAULT 0;
  UPDATE profile_devices SET legacy = 1;
  `,
  // « Validation en deux étapes »: the authenticator app's secret, sealed with a key from the session secret, once its
  // first code proved the app holds it; the one waiting for that code; the last 30-second step used, so a code works
  // once; and the recovery codes, as hashes, each used once.
  `
  ALTER TABLE users ADD COLUMN two_factor_secret TEXT;
  ALTER TABLE users ADD COLUMN two_factor_since INTEGER;
  ALTER TABLE users ADD COLUMN two_factor_step INTEGER;
  ALTER TABLE users ADD COLUMN two_factor_pending TEXT;
  ALTER TABLE users ADD COLUMN two_factor_pending_at INTEGER;
  CREATE TABLE recovery_codes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at INTEGER
  );
  CREATE INDEX recovery_codes_user ON recovery_codes (user_id);
  `,
  // A household's photo, set in Réglages › Foyer, as a profile's: square, small, made on the device.
  `
  ALTER TABLE accounts ADD COLUMN photo BLOB;
  ALTER TABLE accounts ADD COLUMN photo_type TEXT;
  ALTER TABLE accounts ADD COLUMN photo_version INTEGER;
  `,
  // Serveur › Vue d'ensemble beyond the visits' month and the readings' year: one row of the whole server's totals
  // per finished day, kept for good, and how many reads each theme and source had that day. Totals only, never a
  // profile's.
  `
  CREATE TABLE server_days (
    day TEXT PRIMARY KEY,
    visits INTEGER NOT NULL,
    articles INTEGER NOT NULL,
    videos INTEGER NOT NULL,
    minutes INTEGER NOT NULL,
    shares INTEGER NOT NULL,
    profiles INTEGER NOT NULL,
    accounts INTEGER NOT NULL,
    active_accounts INTEGER NOT NULL
  );
  CREATE TABLE server_day_reads (
    day TEXT NOT NULL,
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL,
    PRIMARY KEY (day, kind, id)
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
