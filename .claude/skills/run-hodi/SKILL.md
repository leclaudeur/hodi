---
name: run-hodi
description: Build and start a fresh Hodi install, go through the setup wizard, and screenshot screens at computer, tablet and phone sizes. Use to see a UI change working or to check a screen before a pull request.
---

# Run Hodi and check a screen

Hodi's web unit tests cover its utilities only: a UI change is checked in a real browser at three sizes.

## 1. Build and start a throwaway install

```bash
npm ci
npm run build
DATA_DIR="$(mktemp -d)" PORT=3999 npm start &
```

Wait until `curl -s -m 5 http://localhost:3999/health` answers `{"status":"ok"}`. The log prints the setup code, which a request from `localhost` never needs.

## 2. Go through the setup wizard

With Playwright (Chromium), on `http://localhost:3999/`:

1. "Commencer".
2. Household name in `input[aria-label="Nom du foyer"]`, a password of 12+ characters in `Mot de passe` and `Confirme le mot de passe`, then "Continuer".
3. A first name in `input[placeholder="Ex. Léa"]`, then "Continuer".
4. "Sans IA" (never use a real API key), then "Continuer".
5. "Entrer dans Hodi".

The browser is then signed in on the admin profile. Another browser context signs in with the same password, then picks the profile.

## 3. Screenshots

Take each screen at:

| Size     | Viewport   | Context options                  |
| :------- | :--------- | :------------------------------- |
| Computer | 1440 × 900 |                                  |
| Tablet   | 820 × 1180 | `isMobile: true, hasTouch: true` |
| Phone    | 390 × 844  | `isMobile: true, hasTouch: true` |

- Settings pages have hash routes, such as `#/reglages/foyer` or `#/reglages/ia`.
- Use `colorScheme: 'dark'` and `'light'` when the change touches colours.
- Use `serviceWorkers: 'block'` if you mock API routes with `page.route`.
- Write screenshots to a temporary folder, never into the repository.

Look at every screenshot before reporting: alignment, overflow at 390 px, text in French with "tu", nothing cut off.

## 4. Clean up

Stop the server and delete its data folder and `dist/` if you do not need them.
