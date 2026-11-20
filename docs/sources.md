# Sources

Hodi's news comes from the RSS and Atom feeds listed in [`sources.yml`](../sources.yml): the themes, their sources, and
the YouTube channels and podcasts of the _Videos_ page. This page explains how Hodi uses that file and what each of its
fields does, then how to check the feeds and how to suggest a new source for everyone.

## How sources work

The file fills an empty database once, when the household is set up. After that, the database holds the household's
sources, so editing the file's feeds changes nothing on an existing install. A renamed theme is the exception: it shows
after a restart.

**Base sources** are the only ones a new household and a new profile start with, in the household's language. They
can be hidden, never deleted. Every other source is a **suggestion**: a profile adds it from _Settings › Sources_, or
adds any site, feed or YouTube channel with its link. A source a profile added can be deleted by that profile or by
the admin, for the whole household.

A source may belong to several themes, and a theme with no source is hidden. Each profile sees a theme's name in its
own language. In a feed that mixes French and English, only the articles in the source's language are kept.

> [!TIP]
> Every source in the file is listed by theme in [source-list.md](source-list.md).

## Fields

`sources.yml` holds two lists: `topics`, the themes of the feed, and `listen`, the sections of the _Videos_ page. The
server checks the file when it starts, and names the field at fault (`topics[0].sources[2].domains`) when one is wrong.

### A theme or a section

- **`id`** (required): lowercase letters, digits and dashes, unique among the themes, or among the sections.
- **`label`** (required): its name, the same in every language (`Tech`) or one per language (`{ fr: Monde, en: World }`).
- **`young`**: themes only, the young profiles that see it: `[teen]`, `[child]` or both. Missing, they see none.
- **`sources`** (required): its sources, described below.

### A source

- **`id`** (required): lowercase letters, digits and dashes, unique in the whole file.
- **`name`** (required): the name shown on its cards.
- **`url`** (required): its feed in `https`. A YouTube channel's is `https://www.youtube.com/feeds/videos.xml?channel_id=…`.
- **`kind`**: `article` (the default in `topics`), `video` (the default in `listen`) or `podcast`.
- **`lang`**: the language it writes in, `fr` (the default) or `en`.
- **`domains`**: for articles, the hosts Hodi may fetch article pages from, subdomains included.
- **`reader`**: `false` when articles never open in Hodi's reader; each one then shows its summary and a link.
- **`skip`**: paths whose pages are not articles (`/fr/vidéo/`), left out without being fetched.
- **`base`**: `[fr]`, `[en]` or both, a base source for a household set up in that language.
- **`young`**: `[teen]`, `[child]` or both, in the catalogue their parents turn on in _Settings › Profiles › Manage_.
- **`young_base`**: `[teen]`, `[child]` or both, turned on for these profiles from the start.
- **`adults`**: `false` for a source made for young readers, never suggested to adults. Use it with `young`.

An article that does not open from its `domains`, because it is for subscribers only or too short, is hidden. A source
marked `reader: false` needs no `domains`, and an install that already follows it switches to the summary and link at
its next start. A young profile only sees a source in a theme it sees, through the theme's `young` field.

For example, a source every French household starts with, and teens too:

```yaml
- id: rtl-info
  name: RTL info
  url: https://www.rtl.be/rss.xml
  domains: [rtl.be]
  base: [fr]
  young: [teen]
  young_base: [teen]
```

## Check the sources

From the install's folder, this command checks every feed in the file:

```bash
docker compose exec app node dist/server/cli/check-sources.js
```

Each line shows a feed, its item count and its newest item. For articles, it adds how many of the latest three open
in the reader, or "link only" for a source marked `reader: false`. A failing feed only leaves its theme without it.

This one checks the suggestions of _Add a source_ the way its **Add** button looks them up, without adding any:

```bash
docker compose exec app node dist/server/cli/check-proposals.js
```

A `FAIL` line names the suggestion and why. Its site often still has a feed: give that feed's address as its `url`.

## Suggest a source

Open an issue with the **Source suggestion** template. You can also open a pull request that edits `sources.yml` and
runs `npm run sources:list` to update [source-list.md](source-list.md), as [CONTRIBUTING.md](../CONTRIBUTING.md)
explains. A good source:

- has a working RSS or Atom feed;
- publishes articles that open without a subscription, so they show in the reader;
- fits one of the themes, in French or English.

[← Back to the README](../README.md)
