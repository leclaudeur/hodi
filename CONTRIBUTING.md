# Contributing

Thanks for your interest in Hodi! Bug reports, source suggestions and pull requests are welcome.

## How contributions work

- Every change goes through a pull request against `main`. Hodi has a single maintainer, who reviews and merges every pull request; nobody else can merge.
- For anything bigger than a small fix, **open an issue first** so we can agree on the approach before you spend time on it. Pull requests that change the product's direction without a prior discussion may be closed.
- For a news source, use the **Source suggestion** issue template, or edit `sources.yml` (see [docs/sources.md](docs/sources.md)).
- For a security problem, do not open an issue: see [SECURITY.md](SECURITY.md).

## Adding sources

[docs/source-list.md](docs/source-list.md) lists every source Hodi knows, by topic, with its language. If a site you read is missing, add it:

1. Add it to `sources.yml` under its topic, with `lang: en` for an English site (the comment at the top of the file describes every field).
2. Check it from an install running your copy: `docker compose exec app node dist/server/cli/check-sources.js`. The install reads `sources.yml` from its folder, so the check sees your edit. Your source should list articles that open in the reader, or be marked `reader: false`.
3. Run `npm run sources:list` to update `docs/source-list.md`; a test fails when the list is out of date.
4. Open a pull request and paste what the check printed for your source.

Sources in English are especially welcome: many topics still have only French ones.

## Project rules

- The interface is in **French** (informal "tu") and **English**: every text lives in `shared/locales/fr.json` and `en.json`, never in a component. Code, comments, commits and docs are in **English**.
- **No AI call ever runs without an explicit click.** Never add an automatic, background or prefetched AI request: users pay for every call.
- No new configuration file or environment variable for something a user should choose: settings belong in the browser (Réglages), so the install stays `git clone` + `docker compose up`.
- No secrets in the repository, in issues or in pull requests.
- Prefer an established package to hand-written code. Compare weekly downloads, open issues and last release in the pull request that adds it.

AI coding agents follow the same rules: see [AGENTS.md](AGENTS.md).

## Development

You need Node.js 24. Or, without Node.js, Docker: the `scripts/` run the tooling in a `node:24-alpine` container.

```bash
npm ci
npm run build && npm start    # http://localhost:3000, data in ./data
npm run dev:web               # web app with hot reload on http://localhost:5173, API from the server above
```

The first visit shows the setup screens; no `.env` is needed. To start again from scratch, stop the server and delete `./data`.

Before opening a pull request, all of these must pass (CI runs them too):

```bash
npm run typecheck
npm run lint
npm run format:check   # npm run format fixes it
npm test
npm run build
```

Without Node.js: `./scripts/test.sh`, `./scripts/lint.sh` and `./scripts/format.sh`.

## Pull requests

- One topic per pull request, small enough to review in one sitting.
- Commit messages and the pull request title follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`…).
- Fill in the pull request template: what changes and why, how you tested it, and what to check after merging.
- A visible change comes with screenshots at the three sizes: computer (1440 × 900), tablet (820 × 1180) and phone (390 × 844).
- Server changes come with tests in `server/test/`; changes to the web utilities (`web/src/lib/`) with tests in `web/test/`. A change to a key journey (the list is in [AGENTS.md](AGENTS.md#end-to-end-tests)) keeps `e2e/` passing: `npm run test:e2e` (the first time, `npx playwright install chromium`).
- Update the docs (`README.md`, `docs/`) when behaviour changes.
- Database changes are new migrations at the end of `server/db/migrations.ts`, never edits of existing ones.

By contributing, you agree that your contributions are licensed under the [AGPL-3.0](LICENSE).
