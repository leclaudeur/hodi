---
name: add-source
description: Add, fix or check a news source, YouTube channel or podcast in Hodi's sources.yml. Use when a contributor suggests a source or a feed stops working.
---

# Add or fix a source

`sources.yml` lists the themes, their sources and the channels of "Vidéos". It only fills an empty database: existing installs add sources from Réglages > Sources, so a change here helps new installs and the suggestions offered in "Ajouter une source".

## 1. Find the feed

- Prefer the site's own RSS or Atom feed, over HTTPS. Look for `<link rel="alternate" type="application/rss+xml">` in the home page, or `/feed`, `/rss`, `/rss.xml`.
- The feed should be in French or English, and match one theme (see the `topics:` ids at the top of the file).
- For a YouTube channel, use its feed `https://www.youtube.com/feeds/videos.xml?channel_id=UC…` in the matching `listen:` section, with an id starting with `yt-`.

## 2. Write the entry

Follow the comment at the top of `sources.yml`:

- `id`: lowercase, dashes, unique across the file.
- `domains`: the hosts article pages are fetched from, so they open in the reader. Required unless `reader: false`.
- `reader: false` when article pages cannot be read (consent walls, paywalls): Hodi then shows the feed's summary and a link.
- `skip`: paths that are not articles (videos, live pages).
- `base: [fr]` or `base: [en]` only for the few sources a new household in that language starts with; do not add one without the maintainer agreeing.
- Add a short comment above an entry that needs explaining, as the file does.

## 3. Check it

Without a running install, run the server tests (`catalog.test.ts` loads the file):

```bash
npm test
```

With an install running the change (`docker compose up -d --build`):

```bash
docker compose exec app node dist/server/cli/check-sources.js
docker compose exec app node dist/server/cli/check-proposals.js
```

Each line shows the feed's item count, its newest item and how many of the latest three articles open in the reader. Zero readable articles means the source should be `reader: false` or left out.

Then update the list of sources (a test fails when it is out of date):

```bash
npm run sources:list
```

## 4. Pull request

Title: `feat(sources): add <name> to <theme>` or `fix(sources): <name> feed`. Say in the description which theme, the language, and what the check printed. Then follow the `prepare-pr` skill.
