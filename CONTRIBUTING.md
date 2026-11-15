# Contributing

Thanks for your interest in Hodi! Bug reports, source suggestions and pull requests are all welcome. This page explains
how a contribution goes, the rules every change follows and how to run Hodi on your own machine.

## How contributions work

Every change goes through a pull request against `main`. Hodi has a single maintainer, who reviews and merges every
pull request: nobody else can merge. For anything bigger than a small fix, **open an issue first**, so we agree on the
approach before you spend time on it. A pull request that changes the product's direction without a prior discussion
may be closed.

> [!IMPORTANT]
> Never report a security problem in an issue: follow [SECURITY.md](SECURITY.md) instead.

## Adding sources

[docs/source-list.md](docs/source-list.md) lists every source Hodi knows, by topic, with its language and its site. If a
site you read is missing, open an issue with the **Source suggestion** template, or add it yourself in four steps:

1. Add it to `sources.yml` under its topic, with `lang: en` for a site in English. Every field is described in
   [docs/sources.md](docs/sources.md).
2. Check it from an install of your copy. Its articles should open in the reader, unless it is marked `reader: false`:

   ```bash
   docker compose exec app node dist/server/cli/check-sources.js
   ```

3. Run `npm run sources:list` to update the source list: a test fails when it is out of date.
4. Open a pull request, and paste what the check printed for your source.

> [!TIP]
> Sources in English are especially welcome: many topics still have only French ones.

## Improving the reader

An article that shows wrong in the reader, with a paragraph missing or a leftover "Follow us", is worth a report. Open an
issue with the **Reader problem** template, or fix it yourself with a test made from the real page.
[docs/reader.md](docs/reader.md) explains how the reader works, where each of its rules lives and how to test a fix.

## Project rules

Every change follows these rules, written for AI agents too in [AGENTS.md](AGENTS.md). How the code itself is written
is in [docs/conventions.md](docs/conventions.md).

- **Small modules**: at most 300 lines per file, 80 per function or component and a complexity under 15, or `npm run lint` fails.
- **Interface texts in the locale files**, in French (with "tu") and English; everything else in English.
- **No AI call without a click**: never an automatic, background or prefetched request, as users pay for each one.
- **Settings in the browser**, never in a configuration file or an environment variable.
- **No secrets** in the repository, in issues or in pull requests.
- **An established package before hand-written code**, compared with the alternatives in the pull request.

## Development

You need Node.js 24 or later. Without Node.js, Docker works too: the scripts in `scripts/` run the tooling in a
`node:24-alpine` container.

```bash
npm ci
npm run build && npm start    # http://localhost:3000, data in ./data
npm run dev:web               # the web app with hot reload on http://localhost:5173, API from the server above
```

The first visit shows the setup screens, with no `.env` to write. To start again from scratch, stop the server and
delete the `data` folder.

Before you open a pull request, all of these must pass, and CI runs them too:

```bash
npm run typecheck
npm run lint
npm run format:check   # npm run format fixes it
npm test
npm run build
```

> [!TIP]
> Without Node.js, the same checks run in Docker:
>
> ```bash
> ./scripts/test.sh
> ./scripts/lint.sh
> ./scripts/format.sh
> ```

## Pull requests

- **One topic per pull request**, small enough to review in one sitting.
- **[Conventional Commits](https://www.conventionalcommits.org/)** for the commits and the title: `feat:`, `fix:`, `docs:`…
- **The template filled in**: what changes and why, how you tested it, what to check after merging.
- **Screenshots of a visible change**: computer (1440 × 900), tablet (820 × 1180) and phone (390 × 844).
- **Tests with the change**, in `server/test/` for the server and `web/test/` for the web utilities.
- **The key journeys green**: `npm run test:e2e` passes ([AGENTS.md](AGENTS.md#end-to-end-tests) lists them).
- **New migrations only**, at the end of `server/db/migrations.ts`, never an edit of an existing one.
- **Docs up to date** when behaviour changes, in `README.md` or `docs/`.
- **A changelog line** under « Unreleased » in [CHANGELOG.md](CHANGELOG.md), or [the SDK's](plugin-sdk/CHANGELOG.md) for plugins.

## License

By contributing, you agree that your contributions are licensed under the [AGPL-3.0](LICENSE), like the rest of Hodi.
