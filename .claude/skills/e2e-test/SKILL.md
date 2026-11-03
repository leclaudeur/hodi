---
name: e2e-test
description: Run, fix or extend Hodi's end-to-end tests (Playwright, e2e/). Use when a change touches a key journey, when the e2e CI job fails, or to add a journey.
---

# End-to-end tests

`e2e/hodi.spec.ts` goes through Hodi's key journeys in Chromium, on a fresh install, one after the other. The tests share one install and depend on each other's state: they run in order (`mode: 'serial'`, one worker), so a test may use what an earlier one created.

## 1. Run them

```bash
npm run test:e2e                      # builds the web app, starts e2e/server.ts, runs Chromium
npx playwright test -g "shares"       # one test (it still needs the tests before it: run all when in doubt)
```

- First time on a machine: `npx playwright install chromium`. With a Chromium already installed elsewhere, set `PLAYWRIGHT_CHROMIUM_PATH` to its binary instead.
- On a failure, `test-results/<test>/error-context.md` has the page's accessibility tree at the failing step, and `trace.zip` the whole run (`npx playwright show-trace …`). In CI, the `e2e` job uploads both as an artifact.
- Run the suite three times before pushing a new or changed test: a test that fails once in three is broken.

## 2. What the install holds

`e2e/server.ts` starts Hodi with `startHodi(config, outside)` (`server/start.ts`): the real server and the built web app, but every request to the outside world answered by the test itself.

- **Sources** come from `e2e/sources.yml`: Alpha Info (a base source, also a teen's) and Beta Presse (adults only).
- **Made-up sites** (`*.example`) are pages in `e2e/server.ts`: a home page naming its feed at `/`, the feed at `/feed` (dated from now), and article pages. Gamma is added by a profile, Delta and Epsilon are asked for by a teen. "Le grand dossier de l’hiver" is long enough to be left half read.
- `isPublicLink` lets a pasted `*.example` link through in place of the real public-address guard. Only the test harness does this; never relax the guard in `server/`.
- Pictures, video lengths and push notifications are stubbed. Never give the tests an AI key: setup picks "Sans IA".

To add a site or an article, add it to `articles` in `e2e/server.ts`. A new article shows up in every profile that follows its source, so check the counts and "not visible" assertions of later tests.

## 3. The journeys and who does them

| Profile                     | Page in the spec | Journeys                                                                                                                                          |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alex, admin (made by setup) | `page`           | setup, reader, Enregistrés, search, new profiles, add a source, other device, phone, sends shares, answers a teen's requests, sets a teen's hours |
| Sam, adult                  | `sam`            | receives shares and reacts, private profile with a code, sign-out, Masquer and Historique, Suivis, Reprendre, English                             |
| Zoé, teen                   | `teen`           | only its sources, asks for sources, closed outside its hours                                                                                      |

The teen's hours test closes the app for Zoé: keep it last.

## 4. Writing a test

- Select by role and accessible name, in French, as a user sees the page: `getByRole('button', { name: 'Enregistrer', exact: true })`. Scope to a region (`getByRole('region', { name: 'Recherche' })`) when the same title appears twice (the reader's related articles, the list beside it).
- A text split by markup (a search hit's `<mark>`) does not match `getByText`: use the link's role and name.
- An article opened is often read at once (a short text fits the screen): it leaves the fil and Partages. Open it again through `openFromSearch`, where it stays.
- A new profile's first visit starts the guided tour, which covers the page: call `skipTour` right after `signIn`.
- Work the server does in the background (a new source's first fetch) shows through `afterReload`. Never wait with a fixed `waitForTimeout`.
- The reader keeps a reading position when it closes inside the app: go back with a link, not `goto`, which reloads the page first.
- No real site, no real key, no wait on the clock: anything that depends on the time of day computes its values from now (see the teen's hours test).
- Comments say why, in English, like the rest of the code.

## 5. After

`npm run typecheck` checks `e2e/` too (`tsconfig.e2e.json`). Then follow `prepare-pr`.
