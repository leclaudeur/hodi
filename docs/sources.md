# Sources

## How sources work

[`sources.yml`](../sources.yml) lists the themes, their suggested sources and the video channels and podcasts. It fills an empty database when the household is set up; after that, the database holds the household's sources and editing the file's feeds changes nothing for an existing install.

- **Base sources** (`base: [fr]`, `base: [en]`) are the only ones a new household and a new profile start with, in the household's language (chosen at setup). Each is written in that language (`lang`). They can be hidden, not deleted.
- The other sources are **suggestions**: a profile adds them from Réglages > Sources, or adds any site, feed or YouTube channel by link. A source added by a profile can be deleted by that profile or by the admin, for the whole household.
- A source may belong to several themes. A theme with no source is hidden.
- A theme's name (`label`) is the same in every language (`Tech`), or given per language (`{ fr: Monde, en: World }`); each profile sees it in its own language. Unlike the feeds, a renamed theme shows after a restart, even on an existing install.
- Feeds mixing French and English keep only the articles in the source's language.

Every source in the file is listed, by topic, in [source-list.md](source-list.md).

## Fields

`sources.yml` has two lists: `topics`, the themes of the feed, and `listen`, the sections of "Écouter et regarder".

### A theme (`topics`) or a section (`listen`)

| Field     | Required | What it does                                                                                                                            |
| --------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `id`      | yes      | Lowercase letters, digits and dashes, unique among themes (or sections).                                                                |
| `label`   | yes      | Its name: the same in every language (`Tech`), or one per language (`{ fr: Monde, en: World }`).                                        |
| `young`   | no       | Themes only. The kinds of young profiles that see the theme: `[teen]`, `[child]` or `[teen, child]`. Missing, no young profile sees it. |
| `sources` | yes      | Its sources, below.                                                                                                                     |

### A source

| Field        | Required     | Default                                    | What it does                                                                                                                                                                                                                          |
| ------------ | ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`         | yes          |                                            | Lowercase letters, digits and dashes, unique in the whole file: a source sits in one theme here, and profiles add it to more themes in the app.                                                                                       |
| `name`       | yes          |                                            | The name shown on its cards.                                                                                                                                                                                                          |
| `url`        | yes          |                                            | Its RSS or Atom feed, in `https`. For a YouTube channel: `https://www.youtube.com/feeds/videos.xml?channel_id=…`.                                                                                                                     |
| `kind`       | no           | `article` in `topics`, `video` in `listen` | `article`, `video` or `podcast`. `listen` takes only `video` and `podcast`.                                                                                                                                                           |
| `lang`       | no           | `fr`                                       | The language it writes in: `fr` or `en`. In a feed that mixes both, the articles in the other language are left out.                                                                                                                  |
| `domains`    | for articles |                                            | The hosts Hodi may fetch article pages from (subdomains included), to show them in its reader. An article that does not open there (subscriber-only, too short) is hidden. Not needed with `reader: false`.                           |
| `reader`     | no           | `true`                                     | `false` when the articles never open in the reader (a consent page, a bot wall): every article is listed with its feed summary and a link to the site.                                                                                |
| `skip`       | no           |                                            | Paths whose pages are not articles (`/fr/vidéo/`): their items are left out, never fetched.                                                                                                                                           |
| `base`       | no           |                                            | `[fr]`, `[en]` or both: a base source for a household set up in that language. A new household and every new profile start with it, and it can be hidden but not deleted. Every other source is only suggested in Réglages > Sources. |
| `young`      | no           |                                            | `[teen]`, `[child]` or both: the source is in the catalogue of these young profiles, for their parents to turn on in Réglages > Profils > Gérer > Sources. Only shown in a theme those profiles see (the theme's `young`).            |
| `young_base` | no           |                                            | `[teen]`, `[child]` or both: these young profiles start with the source turned on. It is then in their catalogue too, so `young` need not repeat it.                                                                                  |
| `adults`     | no           |                                            | `false`: a source made for young readers (JDE), never suggested to the adults. Use it with `young`.                                                                                                                                   |

For example, a source every French household starts with, that teens also start with:

```yaml
- id: rtl-info
  name: RTL info
  url: https://www.rtl.be/rss.xml
  domains: [rtl.be]
  base: [fr]
  young: [teen]
  young_base: [teen]
```

The server checks the file when it starts and names the field at fault (`topics[0].sources[2].domains`) when one is wrong.

## Check the sources

From the install's folder:

```bash
docker compose exec app node dist/server/cli/check-sources.js
```

Each line shows a feed, its item count, its newest item and, for articles, how many of the latest three open in the reader ("link only" for sources marked `reader: false`). A failing feed only leaves its theme without that source.

To check the suggestions offered in "Ajouter une source" the way their "Ajouter" button looks them up, without adding any:

```bash
docker compose exec app node dist/server/cli/check-proposals.js
```

A `FAIL` line names the suggestion and why; its site often still has a feed: give that feed's address as its `url` in `sources.yml`.

## Suggest a source

Open an issue with the **Source suggestion** template, or a pull request that edits `sources.yml` and runs `npm run sources:list` to update [source-list.md](source-list.md) (see [CONTRIBUTING.md](../CONTRIBUTING.md)). A good source:

- has a working RSS or Atom feed;
- publishes articles that open without a subscription, so they show in the reader;
- fits one of the themes, in French or English.

[← Back to the README](../README.md)
