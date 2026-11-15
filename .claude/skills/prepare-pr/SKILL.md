---
name: prepare-pr
description: Run Hodi's checks and write a pull request that the maintainer can review and merge. Use before opening or updating any pull request on Hodi.
---

# Prepare a pull request

Only the maintainer merges pull requests. Make each one easy to review: small, checked, and explained.

## 1. Scope

- One topic per pull request. Split unrelated changes, even small ones.
- Anything bigger than a small fix should link the issue where the approach was agreed.
- Re-read the hard rules in `AGENTS.md`: no AI call without a click, no new setup step outside the browser, French UI with "tu", new migrations only, no secrets.

## 2. Checks

All must pass:

```bash
npm run format        # then review what it changed
npm run typecheck
npm run lint          # npx eslint . | grep error, when the output is long
npm test
npm run build
```

- Server change: add or update tests in `server/test/`.
- Web utility change (`web/src/lib/`, the sanitizer): add or update tests in `web/test/`.
- Change to a key journey (listed in `AGENTS.md`, End-to-end tests): `npm run test:e2e` passes, and `e2e/hodi.spec.ts` follows the change (see the `e2e-test` skill).
- UI change: screenshots at 1440 × 900, 820 × 1180 and 390 × 844 (see the `run-hodi` skill). Attach them to the pull request, never commit them.
- Behaviour change: update `README.md` or the page in `docs/` that describes it.
- No stray files: `git status` shows only what the change needs (no `data/`, `dist/`, images or editor files).

## 3. Commits

Conventional Commits, in English: `feat(web): …`, `fix(server): …`, `docs: …`, `refactor: …`, `test: …`. The subject says what changes for the user when it can.

## 4. Changelog

Add a line under « Unreleased » in `CHANGELOG.md` for what a user or an installer would notice, and in
`plugin-sdk/CHANGELOG.md` for what a plugin author would. Never raise the SDK's `version` here: a release pull request
does it.

## 5. Description

Fill in `.github/PULL_REQUEST_TEMPLATE.md`:

- **Summary**: what changes and why, in a few sentences.
- **How it was tested**: the commands run and what was checked by hand.
- **Screenshots**: computer, tablet, phone, for any visible change.
- **After merging**: what the maintainer should check on a running install (a screen to open, a migration, a log line).

Do not ask for a merge or try to merge. Answer review comments with a fix or a short explanation.
