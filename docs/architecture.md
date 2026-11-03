# Architecture

Hodi is one Node.js process that serves a JSON API and a React web app, with a SQLite database, in one Docker container.

```text
browser (React PWA) ──/api──▶ Express server ──▶ SQLite (node:sqlite)
        │                         │
  service worker              news feeds, article pages, source icons (HTTPS, guarded)
  (offline lists)             AI provider (only after a click)
```

## Stack

- **Server**: Node.js 24, Express 5, TypeScript run directly by Node in tests and compiled with `tsc` for production. SQLite through the built-in `node:sqlite`.
- **Web**: React 19, Vite, CSS Modules, [lucide-react](https://lucide.dev) icons. No router library and no state library: the hash route lives in `lib/use-hash-route.ts`, and shared state in small hooks under `lib/`.
- **Languages**: [i18next](https://www.i18next.com) on both sides, with [react-i18next](https://react.i18next.com) in the web app. The texts are in `shared/locales/` (see below).
- **Tests**: `node:test` for the server (`server/test/`), Vitest with jsdom for the web utilities (`web/test/`): the sanitizer, the sync of the reader's state, routes, dates, search marks and when an article counts as read. End-to-end tests with Playwright (`e2e/`) go through the key journeys in Chromium, from setup to sharing between profiles and a teen's requests and hours (the list is in `AGENTS.md`). `e2e/server.ts` starts Hodi with its own made-up news sites, so they never depend on the internet. Screens have no unit tests: check them in a browser at the three sizes below.
- **Tooling**: ESLint, Prettier, TypeScript in strict mode. CI runs them all on every pull request.

## Shared (`shared/`)

Code that the server and the web app both import, compiled with the server and bundled with the app.

- `i18n.ts`: the interface's languages and i18next's options.
- `locales/fr.json` and `locales/en.json`: every interface text, French being the reference. A test checks that both hold the same keys. The language shown is the profile's if it chose one, else the household's (chosen in the first-run screens, changed in Réglages › Foyer). Articles keep their own language.

## Server (`server/`)

| Path        | Role                                                                                                         |
| :---------- | :----------------------------------------------------------------------------------------------------------- |
| `index.ts`  | Start-up: reads the config and starts Hodi with the real outside world (`start.ts`)                          |
| `start.ts`  | `startHodi`: database, household, news service, background jobs, setup code; `realOutside` reaches the sites |
| `app.ts`    | The Express app: security headers, login, session and profile middleware, every route                        |
| `config.ts` | The few environment variables, and the keys generated on the first start                                     |
| `auth/`     | Password hashing (scrypt), signed session cookies, login throttle                                            |
| `db/`       | `database.ts` opens SQLite, `migrations.ts` holds every schema change, one `*-store.ts` per kind of data     |
| `http/`     | Route groups: setup and household, profiles, sources, per-profile user state                                 |
| `news/`     | Feeds, article extraction, stories, videos, followed alerts, AI (`ai-providers.ts`, `summarizer.ts`)         |
| `game/`     | The household game's rules, read from `gamification.yml` (points, levels, badges, weekly challenge)          |
| `cli/`      | Maintenance commands run inside the container (`check-sources`, `check-proposals`)                           |
| `test/`     | One `*.test.ts` per module, `helpers/` for fake feeds and fetches                                            |

A few rules hold across the server:

- **Database changes** go in a new entry at the end of `db/migrations.ts`, never by editing an existing one: installs apply them in order at start.
- **Outgoing requests** go through `news/fetch-text.ts` (timeouts, size caps) and, for any URL a user gives, the SSRF guard in `news/source-finder.ts`.
- **AI** goes through the provider registry in `news/ai-providers.ts`; `NewsService.setAi()` swaps it at runtime. Every AI route answers a user's click and counts against the daily caps.
- **The household** (name, password hash, region, AI key) lives in the `accounts` table through `db/household-store.ts`.
- **Article pictures** are fetched once by the server and made smaller with [sharp](https://sharp.pixelplumbing.com) (`news/article-images.ts`): three WebP widths in `data/images/`, served by article id at `/api/images/<id>/<width>`, and a 16-pixel preview that the lists carry so a blurred picture shows at once. The pictures inside an article's text are numbered when the article is sent (`data-image`, `news/inline-images.ts`) and made at `/api/images/<id>/<n>/<width>` the first time the reader asks; the server reads their address from the kept text, never from the request. New articles' pictures are made in the background within a minute of the feeds being read; old ones are pruned with the article texts.
- **The household game** keeps one row per thing that earned points in `game_events` (`db/game-store.ts`): it outlives the pruned readings, and a thing never earns twice.

## Web (`web/src/`)

| Path       | Role                                                                                                     |
| :--------- | :------------------------------------------------------------------------------------------------------- |
| `main.tsx` | Entry: fonts, styles, service worker                                                                     |
| `App.tsx`  | Session state: setup screens, login, profile picker, then the app shell                                  |
| `api.ts`   | Every call to the server, typed                                                                          |
| `app/`     | The shell: sidebar (computer), bottom bar (phone), onboarding tour, keyboard shortcuts                   |
| `pages/`   | Top-level screens: `SetupPage`, `LoginPage`, `ProfilePicker`, then `HomePage` (the app itself)           |
| `views/`   | Screens and their parts: lists, reader, search, videos, settings sections, profiles, household           |
| `ui/`      | Shared components: `Button`, `RoundButton`, `Dialog`, `TextField`, `Toggle`, `HelpButton`, `StatusLine`… |
| `lib/`     | Hooks and helpers: preferences, read state, offline, notifications, formatting, routes                   |
| `styles/`  | `tokens.css` (colours per theme, topic colours), `base.css` (fonts, sizes, radii)                        |

Theming is done with CSS variables: `data-theme` on `<html>` (Clair, Sombre, Poudré) and an accent colour. Use the tokens from `styles/tokens.css`, never raw colours.

The layout has three sizes, from `lib/use-media.ts`:

- **Phone**: up to 600 px wide, one column and a bottom bar.
- **Tablet**: 601 to 1023 px, and 1024 to 1279 px across with a single panel.
- **Computer**: 1024 px and wider, a sidebar, a list and a reading pane.

Every screen must work at all three. To check one, take screenshots at 1440 × 900, 820 × 1180 and 390 × 844.

## Data flow

- Each profile's state (settings, saved, read, stats) is kept on the server and copied in the browser, so the app starts at once and works offline. Changes are sent in the background and the state is fetched again when the app comes back to the foreground, never by polling.
- The service worker (`web/public/sw.js`) keeps the last lists and up to 200 opened articles for offline reading.
- Background jobs on the server refresh feeds, check articles for the reader, make the new articles' pictures smaller, send followed-subject notifications and make the nightly backup.

[← Back to the README](../README.md)
