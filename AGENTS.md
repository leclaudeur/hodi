# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot…) working on Hodi. Human contributors: the same rules are in [CONTRIBUTING.md](CONTRIBUTING.md).

## The project

Hodi is a self-hosted news reader for a household: RSS feeds by theme, a reader view, videos, up to 5 profiles, and optional AI features. One Node.js server (Express 5, TypeScript, `node:sqlite`) serves a JSON API and a React 19 + Vite PWA, in one Docker container. Install is `git clone` + `docker compose up -d`, then a setup wizard in the browser.

Read [docs/architecture.md](docs/architecture.md) for the code map before changing anything. [docs/features.md](docs/features.md) describes what each screen does.

## Commands

```bash
npm ci                    # install
npm run build             # server (tsc) + web (vite) into dist/
npm start                 # http://localhost:3000, data in ./data (DATA_DIR to change it)
npm run dev:web           # web app with hot reload on :5173, API proxied to :3000
npm test                  # server tests (node:test) then web unit tests (Vitest)
npm run test:server       # or test:web, one of the two
npm run test:coverage     # server tests with coverage in coverage-server.lcov (CI sends it to Codecov)
npm run test:e2e          # end-to-end tests (Playwright, Chromium): the key journeys on a fresh install
npm run sources:list      # after editing sources.yml: rewrites docs/source-list.md
npm run plugin:build -- path/to/plugin        # a plugin folder into a .hodi-plugin (see plugin-sdk/README.md)
npm run plugin-sdk:build  # the npm package @hodi-app/plugin-sdk into plugin-sdk/dist/ (a tag sdk-v<version> publishes it)
npm run typecheck
npm run lint              # ESLint; with long output, filter: npx eslint . | grep error
npm run format            # Prettier, write
npm run format:check
```

All of `typecheck`, `lint`, `format:check`, `test` and `build` must pass before you open a pull request. CI runs them.

A fresh `./data` shows the setup wizard; a request from `localhost` is never asked for the setup code. Delete `./data` (server stopped) to start again.

## Hard rules

These are not style preferences. A pull request that breaks one will not be merged.

1. **No AI call without an explicit click.** Every request to an AI provider answers a user's click on a purple (`look="ai"`) button and counts against the daily caps. Never add an automatic, background, prefetched or retried AI call. Checking a key uses a request that costs no credits. A plugin reaches the household's AI only through `AiButton` (`hodi:sdk`): its web code calls `/api/plugins/<id>/ai/<action>` from that button's click and nowhere else. The server cannot tell a click from code in the page, so the maintainer checks this before signing a plugin.
2. **No new setup step outside the browser.** No `.env`, no required environment variable, no CLI step for something a user chooses. Settings go in Réglages (admin-only ones in Réglages > Foyer or IA et crédits).
3. **Every interface text goes through the locale files.** `shared/locales/fr.json` is the reference (French says "tu"), and every key is also in `en.json` (a test checks it). Components use `useTranslation()` from react-i18next; code outside React uses `t` from `web/src/lib/i18n.ts`. Code, comments, identifiers, commits and docs are in English.
4. **Database changes are new migrations** appended to `server/db/migrations.ts`. Never edit or reorder an existing migration.
5. **Outgoing requests** use `server/news/fetch-text.ts`; any URL a user supplies goes through the SSRF guard in `server/news/source-finder.ts`. The reader only opens articles by item id, never by URL.
6. **No secrets** in code, tests, fixtures, commits or pull request text. Tests use fake keys such as `sk-test-…`.
7. **Never weaken a test to make it pass**: no skipping, no deleting assertions. Fix the code or explain in the pull request.
8. **Prefer an established package to hand-written code** when one covers the need. Before adding it, compare weekly downloads, open issues and last release, and put that comparison in the pull request.

## Code style

The full conventions (names, file and function sizes, comments) are in [docs/conventions.md](docs/conventions.md). In short:

- TypeScript strict, ES modules, imports with the `.ts`/`.tsx` extension.
- Every address is in English: API routes and the web app's hash routes (`#/settings/household`, not `#/reglages/foyer`). A route that changes name keeps its old address as a redirect in `web/src/lib/use-hash-route.ts`.
- Prettier decides formatting (no semicolons, single quotes, 120 columns). Run `npm run format` rather than formatting by hand.
- Comments explain why, in one or two plain lines above the line they concern. Never what the code already says, never the history of a change.
- At most 300 lines of code per file and 80 per function or component, with a cognitive complexity under 15: split before you go over. `npm run lint` fails on any warning.
- Small modules with one job. Server: one `*-store.ts` per kind of data, route groups in `server/http/`. Web: shared hooks in `web/src/lib/`, shared components in `web/src/ui/`.
- Server changes come with tests in `server/test/` (see `household.test.ts` for a full API test with a fake AI provider).
- Web utilities (`web/src/lib/`, the sanitizer, rules such as when an article counts as read) come with tests in `web/test/`. Components and screens have no unit tests.

## UI conventions

The design is consistent on purpose. Reuse what exists before writing new CSS.

- **Components**: `ui/Button` for every labelled button (44 px, `compact` 32 px; looks `neutral`, `primary`, `danger`, `ai`), `ui/RoundButton` for icon buttons, `ui/Dialog` for every modal (centred, footer through `ui/DialogActions`: secondary left, primary right), `ui/TextField`, `ui/Toggle`, `ui/StatusLine` for inline messages, `ui/HelpButton` for a page's explanation (the "?" beside its title), `views/settings/SettingRow` and `SectionPage` for settings.
- **Settings rows** (`SettingRow`): under the title, one 14 px line, its `value` (text colour) or else a short `hint` (grey), never both: a setting's explanation goes in the dialog that changes it. Its `action` is a labelled button at the row's end, which becomes a 38 px round with the same icon on a phone; a switch stays at the end; a `choice` (Segmented) goes across the row under the text on a phone. Every action in a row is 38 px tall.
- **Accordions** (`ui/Accordion`): one open at a time; opening one closes the others. A page's add button goes under the list, full width (Profils, Plugins, Sources).
- **Destructive actions** use `look="danger"` and ask first with `askToConfirm` from `lib/confirm.ts`.
- **Toasts** (`lib/toast.ts`) only report what happened; they never ask a question or carry a form.
- **Empty states**: a title and one line of text at most.
- **Colours** come from the CSS variables in `styles/tokens.css`, which change with the theme (Clair, Sombre, Poudré). Never hard-code a colour.
- **Icons**: `lucide-react`.
- **Captions and metadata** use the mono font (`--font-mono`).
- **Transitions** are gentle (`--duration`, `--ease`); nothing jumps.
- **Three sizes**: phone (≤ 600 px), tablet (601–1279 px) and computer (≥ 1024 px with the sidebar). Every change must work at all three.

## Checking a UI change

Unit tests cover the web utilities only: check a screen in a real browser. Playwright and Chromium work well:

- Build, start the server with a throwaway `DATA_DIR`, and go through the setup wizard once.
- Take screenshots at 1440 × 900, 820 × 1180 (touch) and 390 × 844 (touch), in the dark and light themes when colours change.
- Create the browser context with `serviceWorkers: 'block'` when you mock API routes, or the service worker answers first.
- Keep screenshots out of the repository: never commit images at the root.

## End-to-end tests

`e2e/hodi.spec.ts` (Playwright) goes through the journeys Hodi cannot do without, on a fresh install whose news sites are made up by `e2e/server.ts`: setup, reader, Enregistrés, search, profiles (adult, teen, every adult with its password, its own included), adding a source, signing in on other devices and out, a phone, sharing with and without a word and the reactions, Masquer and Historique, Suivis, Reprendre, English, and a teen's sources, requests and hours. A change to one of them keeps `npm run test:e2e` passing and updates the test. The `e2e-test` skill explains the harness and how to write a test.

## Pull requests

- Branch from `main`, one topic per pull request.
- Title and commits follow Conventional Commits: `feat(web): …`, `fix(server): …`, `docs: …`.
- Fill in `.github/PULL_REQUEST_TEMPLATE.md`: summary, how it was tested, screenshots for UI changes, what to check after merging.
- Add a line under « Unreleased » in `CHANGELOG.md` for anything a user or an installer would notice, and in `plugin-sdk/CHANGELOG.md` for anything a plugin author would. Never raise `plugin-sdk/package.json`'s `version` in a feature pull request: a small release pull request does it, right before the `sdk-v<version>` tag.
- Only the maintainer merges. Do not ask for, or attempt, a merge.

## Skills

Ready-made workflows for agents that support skills live in `.claude/skills/`:

- `run-hodi`: build and start a fresh install, go through the wizard, take screenshots at the three sizes.
- `add-source`: add or fix a source in `sources.yml` and check it.
- `prepare-pr`: the checks and the description a pull request needs.
- `e2e-test`: run, fix or extend the end-to-end tests.
